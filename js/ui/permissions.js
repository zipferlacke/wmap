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
 *   recordingNotice()      Hinweis zur Benachrichtigung beim Aufzeichnen, danach das Fenster von Android
 */
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { healthAvailable, healthStatus, healthRequest, healthSettings } from '../services/health.js';
import { t } from '../core/i18n.js';

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

/**
 * Beim Start der Karte in der App: gleich das Fenster von Android (ohne den Dialog davor), einmal je Sitzung –
 * wer ablehnt, wird erst beim Tipp auf den Standort-Knopf wieder gefragt. → erlaubt?
 */
export async function locationAtStart() {
  if (!permissionsHere) return true;
  const st = await locationState();
  if (st === 'granted' || st === 'coarse') return true;
  if (st !== 'prompt') return false;
  try { if (sessionStorage.getItem('wmap.location.asked')) return false; sessionStorage.setItem('wmap.location.asked', '1'); } catch { /* ohne Speicher: fragen */ }
  await requestLocation();
  return ['granted', 'coarse'].includes(await locationState());
}

/* ── Benachrichtigung beim Aufzeichnen ────────────────────────────────────── */

/** → 'granted' | 'prompt' | 'none' (App kennt die Abfrage nicht – vor 2.2.0) */
async function notificationState() {
  try { return (await core.invoke('plugin:geolocation|notification_state')).state; } catch { return 'none'; }
}

let noteBlocked = false;   // Android zeigt sein Fenster nicht mehr (zweimal abgelehnt) – dann in die Einstellungen

/**
 * Das Fenster von Android. Kommt die Antwort sofort und heißt nicht „erlaubt“, hat Android es gar nicht mehr
 * gezeigt – dann öffnen sich die Einstellungen der App, dort lässt es sich erlauben.
 */
async function requestNotification() {
  const t0 = Date.now();
  let st = 'prompt';
  try { st = (await core.invoke('plugin:geolocation|request_notification')).state; } catch { /* Zustand zeigt es */ }
  noteBlocked = st !== 'granted' && Date.now() - t0 < 500;
  if (noteBlocked) await healthSettings('app').catch(() => {});
  return st;
}

/**
 * Vor dem Start einer Aufzeichnung: erst der Hinweis, wofür die Benachrichtigung da ist – „Erlauben“ holt das
 * Fenster von Android (bzw. die Einstellungen, wenn Android nicht mehr fragt). „Später“ (auch ✕): weiter ohne.
 * Solange sie nicht erlaubt ist, kommt der Hinweis bei jedem Aufzeichnen wieder. Die Aufzeichnung beginnt
 * erst danach.
 */
export async function recordingNotice() {
  if (!permissionsHere || (await notificationState()) !== 'prompt') return;
  const v = await ask({
    icon: 'notifications', title: t('permissions.notice.title'), className: 'news',
    html: `<p>${t('permissions.notice.p1')}</p>
      <p>${t('permissions.notice.p2')}</p>
      <p class="muted">${t('permissions.notice.p3')}</p>`,
    buttons: [{ value: 'later', label: t('common.later') }, { value: 'allow', label: t('permissions.notice.allow'), icon: 'notifications', primary: true }],
  });
  if (v === 'allow') await requestNotification();
}

async function notificationItem() {
  const st = await notificationState();
  if (st === 'none') return '';
  const denied = st !== 'granted' && noteBlocked;
  return item({
    id: 'notifications', icon: 'notifications', title: t('permissions.notification.title'), state: st,
    status: st === 'granted' ? t('permissions.status.granted') : denied ? t('permissions.status.blocked') : t('permissions.status.not_yet'),
    text: t('permissions.notification.text'),
    button: st === 'granted' ? ['app', 'settings', t('permissions.button.change'), false]
      : denied ? ['app', 'settings', t('permissions.button.allow_settings'), true]
        : ['notifications', 'notifications', t('permissions.notification.allow'), false],
  });
}

/* ── Dialog ───────────────────────────────────────────────────────────────── */

const STATE = { granted: 'check_circle', coarse: 'warning', prompt: 'radio_button_unchecked', off: 'location_off', none: 'block' };

async function locationItem(reason) {
  const st = await locationState();
  const status = {
    granted: t('permissions.status.granted'),
    coarse: t('permissions.location.coarse'),
    prompt: asked ? t('permissions.status.blocked') : t('permissions.status.not_yet'),
    off: t('permissions.location.off'),
  }[st];
  const button = st === 'granted' ? ['app', 'settings', t('permissions.button.change'), false]
    : st === 'off' ? ['location', 'location_on', t('permissions.location.turn_on'), true]
      : st === 'coarse' || asked ? ['app', 'settings', t('permissions.button.allow_settings'), true]
        : ['location', 'my_location', t('permissions.location.allow'), true];
  return item({
    id: 'location', icon: 'my_location', title: t('permissions.location.title'), state: st, status, wanted: reason === 'location',
    text: t('permissions.location.text'),
    button,
  });
}

async function healthItem(reason) {
  if (!healthAvailable) return '';
  let st;
  try { st = await healthStatus(); } catch (err) { st = { available: false, reason: String(err?.message ?? err) }; }
  const text = t('permissions.health.text');
  if (!st.available) return item({ id: 'health', icon: 'favorite', title: t('permissions.health.title'), state: 'none', status: st.reason, text, wanted: reason === 'health' });
  if (!st.read) {
    return item({
      id: 'health', icon: 'favorite', title: t('permissions.health.title'), state: 'prompt', status: t('permissions.health.not_granted'), text, wanted: reason === 'health',
      button: ['health-request', 'favorite', t('permissions.health.grant'), true],
    });
  }
  const routes = st.routes
    ? `<p class="perm-hint"><span class="msr">info</span> ${t('permissions.health.hint_change')}</p>`
    : `<p class="perm-hint"><span class="msr">info</span> ${t('permissions.health.hint_routes')}</p>`;
  const values = st.values ? '' : `<p class="perm-hint"><span class="msr">info</span> ${t('permissions.health.hint_values')}</p>`;
  const all = st.routes && st.values;
  return item({
    id: 'health', icon: 'favorite', title: t('permissions.health.title'), state: all ? 'granted' : 'coarse', wanted: reason === 'health',
    status: all ? t('permissions.health.all')
      : [st.routes ? t('permissions.health.routes_yes') : t('permissions.health.routes_ask'), st.values ? t('permissions.health.values_yes') : t('permissions.health.values_no')].join(' · '),
    text, extra: routes + values,
    button: !st.values ? ['health-request', 'favorite', t('permissions.health.grant_values'), true]
      : ['health', 'settings', st.routes ? t('permissions.health.change') : t('permissions.health.open'), !st.routes],
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
  location: t('permissions.intro.location'),
  health: t('permissions.intro.health'),
};

/**
 * Der Dialog. Nach dem Zurückkommen aus den Einstellungen von Android bzw.
 * Health Connect frischt er sich selbst auf.
 */
export async function showPermissions({ reason = null } = {}) {
  if (!permissionsHere) return;
  const body = async () => `${await locationItem(reason)}${await notificationItem()}${await healthItem(reason)}`;
  await ask({
    icon: 'verified_user', title: t('permissions.title'), className: 'news perms',
    html: `<p>${esc(INTRO[reason] ?? t('permissions.intro.default'))}
        ${t('permissions.intro.change_later')}</p>
      <div class="perm-list">${await body()}</div>`,
    buttons: [{ value: 'ok', label: reason ? t('common.done') : t('common.next'), primary: true }],
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
        if (act === 'notifications') await requestNotification();
        if (act === 'app' || act === 'health') await healthSettings(act).catch(() => {});
        if (act === 'health-request') await healthRequest().catch(() => {});
        refresh();
      });
    },
  });
}
