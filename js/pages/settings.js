/**
 * Einstellungen (settings.html): Hell/dunkel, Berechtigungen (Android-App), Offline-Karten, Datensparmodus,
 * Konto (OpenStreetMap, zugleich WMap-Konto; löschen), Mitmachen bei OSM, Stimme, Spritpreise, Verlauf, welche
 * aufgezeichneten Touren auf der Karte liegen (data/track-look.js). Eine eigene
 * Seite ohne Karte – alles bleibt in diesem Browser, die Karte liest es beim
 * nächsten Öffnen.
 */
import { offlineSetting } from '../data/offline.js';
import { contribute, trace } from '../data/trace.js';
import { account, login } from '../osm/api.js';
import { queue, anonNotes, alongSetting } from '../osm/survey.js';
import { OSM_AUTH } from '../core/config.js';
import { esc } from '../core/geo.js';
import { navSettings } from '../nav/navigation.js';
import { historySetting } from '../data/tracks.js';
import { trackShow, SHOW_OPTIONS } from '../data/track-look.js';
import { theme } from '../core/theme.js';
import { mountAppBar } from '../ui/appbar.js';
import { dataSaver, sharpness, SHARPNESS } from '../map/map.js';
import { openVoiceDialog } from '../nav/navigation.js';
import { fuelKey } from '../services/media.js';
import { local, recent } from '../data/store.js';
import { konto } from '../services/konto.js';
import { myOsmStats, allOsmStats, statsText } from '../osm/stats.js';
import { toast } from '../ui/dialogs.js';
import { permissionsHere, showPermissions } from '../ui/permissions.js';
import { lang, languages, locale, setLanguage, t } from '../core/i18n.js';
import { CLOCK_KEY, UNITS_KEY, clockSystem, refreshUnits, unitSystem } from '../core/units.js';
import { statsSetting } from '../services/usage.js';

const root = document.querySelector('.settings');
// Browser am Rechner (Firefox, Chrome, Edge): WMap für „geo:“-Links anmelden.
// Die installierte Web-App meldet sich über das Manifest an, die App selbst über Tauri.
const geoHandler = 'registerProtocolHandler' in navigator && !window.__TAURI__;

let loginError = '';   // an Ort und Stelle zeigen, nicht nur kurz als Meldung
let jumped = false;    // #osm: einmal hinscrollen, nicht bei jedem Neuzeichnen
const langs = await languages();
const render = () => {
  const user = account.user();
  // Testserver: nur Karte bearbeiten, ein WMap-Konto gibt es dort nicht
  const osmIn = account.loggedIn(), wmapIn = konto.loggedIn() || account.server() !== 'live';
  root.innerHTML = `
    <section>
      <h3>${t('settings.look.title')}</h3>
      <label class="settings-select">
        <span><strong>${t('settings.look.theme.title')}</strong><small>${t('settings.look.theme.hint')}</small></span>
        <select name="theme">
          ${[['system', t('settings.look.theme.options.system')], ['light', t('settings.look.theme.options.light')], ['dark', t('settings.look.theme.options.dark')]].map(([v, l]) => `<option value="${v}" ${theme.get() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      ${langs.length > 1 ? `<label class="settings-select">
        <span><strong>${t('settings.look.language.title')}</strong></span>
        <select name="language">
          ${langs.map((l) => `<option value="${l.code}" ${lang === l.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </label>` : ''}
      <label class="settings-select">
        <span><strong>${t('settings.look.units.title')}</strong></span>
        <select name="units">
          ${['metric', 'imperial'].map((v) => `<option value="${v}" ${unitSystem() === v ? 'selected' : ''}>${t(`settings.look.units.options.${v}`)}</option>`).join('')}
        </select>
      </label>
      <label class="settings-select">
        <span><strong>${t('settings.look.clock.title')}</strong></span>
        <select name="clock">
          ${['24', '12'].map((v) => `<option value="${v}" ${clockSystem() === v ? 'selected' : ''}>${t(`settings.look.clock.options.${v}`)}</option>`).join('')}
        </select>
      </label>
      ${geoHandler ? `<button type="button" class="button settings-row" data-act="geo"><span class="msr">pin_drop</span> ${t('settings.look.geo')}</button>` : ''}
      ${permissionsHere ? `<button type="button" class="button settings-row" data-act="perms"><span class="msr">verified_user</span> ${t('settings.look.permissions')}</button>` : ''}
    </section>

    <section>
      <h3>${t('settings.way.title')}</h3>
      ${toggle('offline', t('settings.way.offline.title'),
        t('settings.way.offline.hint'), offlineSetting.get())}
      <label class="settings-select">
        <span><strong>${t('settings.way.zoom.title')}</strong><small>${t('settings.way.zoom.hint')}</small></span>
        <select name="navzoom">
          ${[['auto', t('settings.way.zoom.options.auto')], ['near', t('settings.way.zoom.options.near')], ['far', t('settings.way.zoom.options.far')]].map(([v, l]) => `<option value="${v}" ${navSettings.zoom === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      ${toggle('nav3d', t('settings.way.nav3d.title'), t('settings.way.nav3d.hint'), navSettings.threeD)}
      <div class="settings-select settings-along">
        <span><strong>${t('settings.way.along.title')}</strong><small>${t('settings.way.along.hint')}</small></span>
        <span class="settings-checks">${[['foot', t('settings.way.along.options.foot')], ['bike', t('settings.way.along.options.bike')], ['car', t('settings.way.along.options.car')]].map(([m, l]) => `
          <label><input type="checkbox" name="along" value="${m}" ${alongSetting.get(m) ? 'checked' : ''}> ${l}</label>`).join('')}</span>
      </div>
      ${toggle('saver', t('settings.way.saver.title'), t('settings.way.saver.hint'), dataSaver())}
      ${window.WMapAndroid?.shareSet ? toggle('carlog', t('settings.way.carlog.title'), t('settings.way.carlog.hint'), window.WMapAndroid.shareGet('carlog') === '1') : ''}
      <button type="button" class="button settings-row" data-act="voice"><span class="msr">record_voice_over</span> ${t('settings.way.voice')}</button>
      <button type="button" class="button settings-row" data-act="fuel"><span class="msr">local_gas_station</span> ${t('settings.way.fuel.title')}</button>
      <a class="button settings-row" href="./offline.html"><span class="msr">download_for_offline</span> ${t('settings.way.offline_maps')}</a>
    </section>

    <section id="osm">
      <h3>${t('settings.account.title')}</h3>
      <p class="settings-hint">${t('settings.account.intro')}</p>
      <div class="settings-account">
        ${osmIn && wmapIn
          ? `<p><span class="msr">account_circle</span> ${t('settings.account.signed_in', { name: `<strong>${esc(user?.name ?? konto.user()?.name ?? '?')}</strong>` })}</p>
             <button type="button" class="button" data-act="logout">${t('settings.account.logout')}</button>`
          : !account.clientId()
            ? `<p class="settings-error"><span class="msr">info</span> ${t('settings.account.not_set_up', { web: esc(account.conf().web.replace(/^https:\/\//, '')) })}</p>`
            : osmIn || wmapIn
              ? `<p><span class="msr">sync_problem</span> <span>${osmIn ? t('settings.account.wmap_missing', { name: `<strong>${esc(user?.name ?? '?')}</strong>` }) : t('settings.account.login_missing')} – ${t('settings.account.login_again')}</span></p>
                 <button type="button" class="button primary" data-act="login"><span class="msr">login</span> ${t('settings.account.relogin')}</button>
                 <button type="button" class="button" data-act="logout">${t('settings.account.logout')}</button>`
              : `<p>${queue.size() ? t('settings.account.queue', { n: queue.size() }) : t('settings.account.none')}</p>
                 <button type="button" class="button primary" data-act="login"><span class="msr">login</span> ${t('settings.account.login')}</button>`}
        ${loginError ? `<p class="settings-error"><span class="msr">error</span> ${esc(loginError)}</p>` : ''}
      </div>
      <a class="button settings-row" href="./deleteKonto.html"><span class="msr">delete_forever</span> ${t('settings.account.delete')}</a>
      <details class="settings-dev" ${account.clientId() ? '' : 'open'}>
        <summary>${t('settings.account.developer.title')}</summary>
        <label>${t('settings.account.developer.server')}
          <select data-act="server">${Object.entries(OSM_AUTH).map(([k, v]) => `<option value="${k}" ${account.server() === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        </label>
        <label>${t('settings.account.developer.client.title')}
          <input type="text" data-act="client" value="${esc(account.clientId())}" placeholder="${t('settings.account.developer.client.hint', { web: esc(account.conf().web.replace(/^https:\/\//, '')) })}" spellcheck="false">
        </label>
        <p>${t('settings.account.developer.redirect')}: <code>${esc(account.redirectUri())}</code></p>
        <p>${t('settings.account.developer.hint')}</p>
      </details>
    </section>

    <section>
      <h3>${t('settings.contribute.title')}</h3>
      ${toggle('contribute', t('settings.contribute.trace.title'),
        t('settings.contribute.trace.hint'),
        contribute.get())}
      <button type="button" class="button settings-row" data-act="clear-trace"><span class="msr">delete</span> ${t('settings.contribute.clear')}</button>
      ${toggle('anon', t('settings.contribute.anon.title'),
        t('settings.contribute.anon.hint'),
        anonNotes.get())}
      <p class="settings-hint osm-stats">${statsLine()}</p>
    </section>

    <section>
      <h3>${t('settings.data.title')}</h3>
      ${toggle('history', t('settings.data.history.title'),
        t('settings.data.history.hint'),
        historySetting.get())}
      ${toggle('stats', t('settings.data.stats.title'), t('settings.data.stats.hint'), statsSetting.get())}
      <label class="settings-select">
        <span><strong>${t('settings.data.trackshow.title')}</strong><small>${t('settings.data.trackshow.hint')}</small></span>
        <select name="trackshow">
          ${SHOW_OPTIONS.map(([v, l]) => `<option value="${v}" ${trackShow.get() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <a class="button settings-row" href="./sync.html"><span class="msr">sync</span> ${t('settings.data.sync')}</a>
      <a class="button settings-row" href="./wege.html"><span class="msr">timeline</span> ${t('settings.data.tracks')}</a>
      <button type="button" class="button settings-row" data-act="history"><span class="msr">history</span> ${t('settings.data.clear_history')}</button>
      <button type="button" class="button settings-row" data-act="repair"><span class="msr">build</span> ${t('settings.data.repair.title')}</button>
      <p class="settings-hint">${t('settings.data.repair.hint')}</p>
    </section>

    <section>
      <h3>${t('settings.map.title')}</h3>
      <label class="settings-select">
        <span><strong>${t('settings.map.sharpness.title')}</strong><small>${t('settings.map.sharpness.hint', { dpr: (Math.round((window.devicePixelRatio || 1) * 100) / 100).toLocaleString(locale) })}</small></span>
        <select name="sharpness">
          ${SHARPNESS.map(([v, l]) => `<option value="${v}" ${sharpness.get() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </section>`;
  // Aus „Ort eintragen/bearbeiten“ ohne Konto: gleich zum OSM-Konto
  if (location.hash === '#osm' && !jumped) {
    jumped = true;
    requestAnimationFrame(() => root.querySelector('#osm')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
};

// Zurück von der Anmeldung (App): osm/login-return.js löst ein, hier neu zeichnen
addEventListener('wmap:login', (e) => {
  loginError = e.detail.wmapError ? t('settings.account.wmap_failed', { error: e.detail.wmapError }) : '';
  render();
});

root.addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'language') { setLanguage(el.value); location.reload(); }
  if (el.name === 'units') { local.set(UNITS_KEY, el.value); refreshUnits(); }
  if (el.name === 'clock') { local.set(CLOCK_KEY, el.value); refreshUnits(); }
  if (el.name === 'offline') offlineSetting.set(el.checked);
  if (el.name === 'theme') theme.set(el.value);
  if (el.name === 'navzoom') navSettings.zoom = el.value;
  if (el.name === 'nav3d') navSettings.threeD = el.checked;
  // Liegt im gemeinsamen Speicher von Android – das Auto liest es dort (tools/android/car/CarLog.kt)
  if (el.name === 'carlog') window.WMapAndroid?.shareSet?.('carlog', el.checked ? '1' : '');
  if (el.name === 'along') alongSetting.set(el.value, el.checked);
  if (el.name === 'saver') {
    // Die Karte schaltet beim nächsten Öffnen (map/map.js liest dieselbe Einstellung)
    local.set('wmap.datasaver', el.checked);
    toast(el.checked ? t('settings.toast.saver_on') : t('settings.toast.saver_off'));
  }
  if (el.name === 'contribute') contribute.set(el.checked);
  if (el.name === 'anon') anonNotes.set(el.checked);
  if (el.name === 'history') historySetting.set(el.checked);
  if (el.name === 'stats') { statsSetting.markAsked(); statsSetting.set(el.checked); }
  // Neuer Zeitraum: von Hand ein- und ausgeblendete Jahre gelten nicht weiter
  if (el.name === 'sharpness') { sharpness.set(el.value); toast(t('settings.toast.next_open')); }
  if (el.name === 'trackshow') { trackShow.set(el.value); local.set('wmap.tracks.years', {}); }
  if (el.dataset.act === 'server') { account.setServer(el.value); render(); }
  if (el.dataset.act === 'client') { account.setClientId(el.value); loginError = ''; render(); }
});
root.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'voice') openVoiceDialog();
  if (act === 'perms') showPermissions();
  if (act === 'fuel') setFuelKey();
  if (act === 'geo') {
    try {
      navigator.registerProtocolHandler('geo', new URL('./index.html?geo=%s', location.href).href);
      toast(t('settings.toast.geo'));
    } catch (err) { toast(t('settings.toast.geo_failed', { error: err.message })); }
  }
  if (act === 'history') { recent.clear(); toast(t('settings.toast.history_cleared')); }
  // Gekapselt (core/updater.js): funktioniert auch bei einem fehlerhaften Update
  if (act === 'repair') {
    if (!window.wmapUpdater) { location.reload(); return; }
    const label = b.innerHTML;
    b.disabled = true;
    b.innerHTML = `<span class="msr">hourglass_top</span> ${t('settings.data.repair.running')}`;
    const r = await window.wmapUpdater.check().catch(() => null);
    if (r) { toast(r.text); b.disabled = false; b.innerHTML = label; }
  }
  if (act === 'clear-trace') { trace.clear(); toast(t('settings.toast.trace_cleared')); }
  if (act === 'logout') { await konto.logout(); render(); }
  if (act === 'login') {
    loginError = '';
    try {
      const user = await login();
      if (user.wmapError) loginError = t('settings.account.wmap_failed', { error: user.wmapError });
      else toast(t('settings.toast.signed_in', { name: user.name }));
    } catch (err) { loginError = err.message; }
    render();
  }
});

/* Beiträge: eigene sofort, alle über WMap nachgeladen (einmal je Seitenaufruf) */
let allStats = null;
function statsLine() {
  const mine = statsText(myOsmStats());
  const all = allStats && statsText(allStats.osm);
  return [
    mine ? t('settings.contribute.stats.mine', { stats: esc(mine) }) : t('settings.contribute.stats.none'),
    all ? t('settings.contribute.stats.all', { stats: esc(all) }) : '',
  ].filter(Boolean).join(' ') + ` <span class="muted">${t('settings.contribute.stats.anon_count')}</span>`;
}
allOsmStats().then((s) => {
  allStats = s;
  const el = root.querySelector('.osm-stats');
  if (el) el.innerHTML = statsLine();
}).catch(() => {});

function setFuelKey() {
  const key = prompt(t('settings.way.fuel.prompt'), fuelKey());
  if (key === null) return;
  local.set('wmap.tankerkoenig', key.trim());
  toast(key.trim() ? t('settings.toast.fuel_on') : t('settings.toast.fuel_off'));
}

function toggle(name, label, hint, on) {
  return `<label class="settings-toggle">
      <span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span>
      <input type="checkbox" name="${name}" data-shape="toggle" ${on ? 'checked' : ''}>
    </label>`;
}

mountAppBar();
render();
// Ergebnis von „App prüfen und neu laden“ (core/updater.js) – die Seite hat danach neu geladen
{ const note = window.wmapUpdater?.note(); if (note) toast(note.text); }
