/**
 * Berechtigungen in der Android-App: erklären, wofür – und darunter gleich
 * der Knopf dazu. Der Dialog kommt
 *   - nach dem Willkommen beim ersten Start (ui/news.js),
 *   - wenn etwas den Standort bzw. Health Connect braucht, das noch nicht
 *     freigegeben ist (core/native.js, services/health.js, map/map.js),
 *   - aus den Einstellungen („Berechtigungen“).
 * Was schon erlaubt ist, steht mit Häkchen da und führt in die Einstellungen
 * von Android bzw. Health Connect – dort lässt es sich widerrufen.
 *
 *   permissionsHere        gibt es den Dialog hier? (nur Android-App)
 *   showPermissions({ reason: 'location' | 'health' | null })
 *   locationAccess()       Standort erlaubt? Sonst erst der Dialog → true/false
 */
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { healthAvailable, healthStatus, healthRequest, healthSettings } from '../services/health.js';

const core = window.__TAURI__?.core;
export const permissionsHere = !!core && /Android/i.test(navigator.userAgent);

/* ── Standort ─────────────────────────────────────────────────────────────── */

/** → 'granted' | 'coarse' | 'prompt' | 'off' (Standort am Gerät aus) */
async function locationState() {
  try {
    const p = await core.invoke('plugin:geolocation|check_permissions');
    if (p.location === 'granted') return 'granted';
    if (p.coarseLocation === 'granted') return 'coarse';
    return 'prompt';
  } catch (err) {
    return /disabled/i.test(String(err)) ? 'off' : 'prompt';
  }
}

async function requestLocation() {
  try { await core.invoke('plugin:geolocation|request_permissions', { permissions: ['location'] }); } catch { /* Zustand zeigt es */ }
}

let asked = false;   // Android fragt nach zweimal Nein nicht mehr – dann in die Einstellungen

/**
 * Vor jedem Zugriff auf den Standort (core/native.js). Nicht erlaubt: erst
 * der Dialog. `ask: false` (Start der Karte): still ablehnen.
 */
export async function locationAccess({ ask: prompt = true } = {}) {
  if (!permissionsHere) return true;
  const st = await locationState();
  if (st === 'granted' || st === 'coarse') return true;
  if (!prompt) return false;
  await showPermissions({ reason: 'location' });
  return ['granted', 'coarse'].includes(await locationState());
}

/* ── Dialog ───────────────────────────────────────────────────────────────── */

const STATE = { granted: 'check_circle', coarse: 'warning', prompt: 'radio_button_unchecked', off: 'location_off', none: 'block' };

async function locationItem(reason) {
  const st = await locationState();
  const status = {
    granted: 'Erlaubt',
    coarse: 'Nur ungefähr – für Navigation und Aufzeichnung bitte „Genauer Standort“ einschalten',
    prompt: asked ? 'Nicht erlaubt – Android fragt nicht mehr, bitte in den Einstellungen erlauben' : 'Noch nicht erlaubt',
    off: 'Der Standort ist am Gerät ausgeschaltet',
  }[st];
  const button = st === 'granted' ? ['app', 'settings', 'In den Einstellungen ändern', false]
    : st === 'off' ? ['location', 'location_on', 'Standort einschalten', true]
      : st === 'coarse' || asked ? ['app', 'settings', 'In den Einstellungen erlauben', true]
        : ['location', 'my_location', 'Standort erlauben', true];
  return item({
    id: 'location', icon: 'my_location', title: 'Standort', state: st, status, wanted: reason === 'location',
    text: 'Für deinen Punkt auf der Karte, Routen ab „Mein Standort“, die Navigation und das Aufzeichnen von Wegen. '
      + 'WMap speichert ihn nur auf deinem Gerät.',
    button,
  });
}

async function healthItem(reason) {
  if (!healthAvailable) return '';
  let st;
  try { st = await healthStatus(); } catch (err) { st = { available: false, reason: String(err?.message ?? err) }; }
  const text = 'Liest Trainings anderer Apps – Fitbit, Strava, Samsung Health … – samt Route, damit du sie unter '
    + 'Meine Touren als Wege siehst. WMap liest nur und schreibt nichts zurück.';
  if (!st.available) return item({ id: 'health', icon: 'favorite', title: 'Health Connect', state: 'none', status: st.reason, text, wanted: reason === 'health' });
  if (!st.read) {
    return item({
      id: 'health', icon: 'favorite', title: 'Health Connect', state: 'prompt', status: 'Noch nicht freigegeben', text, wanted: reason === 'health',
      button: ['health-request', 'favorite', 'Health Connect freigeben', true],
    });
  }
  const routes = st.routes ? '' : `<p class="perm-hint"><span class="msr">info</span> Routen: Health Connect fragt noch bei jedem Training einzeln.
      Unter <strong>Health Connect → WMap → Trainingsrouten</strong> „Immer erlauben“ wählen – dann kommen alle ohne Rückfrage.</p>`;
  return item({
    id: 'health', icon: 'favorite', title: 'Health Connect', state: st.routes ? 'granted' : 'coarse', wanted: reason === 'health',
    status: st.routes ? 'Trainings und Routen erlaubt' : 'Trainings erlaubt, Routen mit Rückfrage',
    text, extra: routes,
    button: ['health', 'settings', st.routes ? 'In Health Connect ändern' : 'Health Connect öffnen', !st.routes],
  });
}

function item({ id, icon, title, state, status, text, wanted, button = null, extra = '' }) {
  const [act, bIcon, label, primary] = button ?? [];
  return `<section class="perm-item${wanted ? ' wanted' : ''}" data-perm="${id}">
      <h3><span class="msr">${icon}</span> ${esc(title)}</h3>
      <p>${esc(text)}</p>
      <p class="perm-state ${state}"><span class="msr">${STATE[state]}</span> ${esc(status)}</p>
      ${extra}
      ${button ? `<button type="button" class="button${primary ? ' primary' : ''}" data-perm-act="${act}"><span class="msr">${bIcon}</span> ${esc(label)}</button>` : ''}
    </section>`;
}

const INTRO = {
  location: 'Dafür braucht WMap deinen Standort.',
  health: 'Dafür braucht WMap Zugriff auf Health Connect.',
};

/**
 * Der Dialog. Nach dem Zurückkommen aus den Einstellungen von Android bzw.
 * Health Connect frischt er sich selbst auf.
 */
export async function showPermissions({ reason = null } = {}) {
  if (!permissionsHere) return;
  const body = async () => `${await locationItem(reason)}${await healthItem(reason)}`;
  await ask({
    icon: 'verified_user', title: 'Berechtigungen', className: 'news perms',
    html: `<p>${esc(INTRO[reason] ?? 'WMap fragt nur, was eine Funktion wirklich braucht.')}
        Alles lässt sich später unter <strong>Einstellungen → Berechtigungen</strong> ändern.</p>
      <div class="perm-list">${await body()}</div>`,
    buttons: [{ value: 'ok', label: reason ? 'Fertig' : 'Weiter', primary: true }],
    setup(dlg) {
      const list = dlg.querySelector('.perm-list');
      const refresh = async () => { if (dlg.isConnected) list.innerHTML = await body(); };
      const back = () => { if (document.visibilityState === 'visible') refresh(); };
      document.addEventListener('visibilitychange', back);
      dlg.addEventListener('close', () => document.removeEventListener('visibilitychange', back), { once: true });
      list.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-perm-act]')?.dataset.permAct;
        if (!act) return;
        if (act === 'location') {
          const was = await locationState();
          if (was === 'off') await healthSettings('location').catch(() => {});
          else { await requestLocation(); asked = !['granted', 'coarse'].includes(await locationState()); }
          if (['granted', 'coarse'].includes(await locationState())) dispatchEvent(new Event('wmap:location'));
        }
        if (act === 'app' || act === 'health') await healthSettings(act).catch(() => {});
        if (act === 'health-request') await healthRequest().catch(() => {});
        refresh();
      });
    },
  });
}
