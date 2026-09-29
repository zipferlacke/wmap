/**
 * Einstellungen (settings.html): Hell/dunkel, Berechtigungen (Android-App), Offline-Karten, Datensparmodus,
 * Konto (OpenStreetMap, zugleich WMap-Konto; löschen), Mitmachen bei OSM, Stimme, Spritpreise, Verlauf. Eine eigene
 * Seite ohne Karte – alles bleibt in diesem Browser, die Karte liest es beim
 * nächsten Öffnen.
 */
import { offlineSetting } from '../data/offline.js';
import { contribute, trace } from '../data/trace.js';
import { account, login } from '../osm/api.js';
import { queue, anonNotes } from '../osm/survey.js';
import { OSM_AUTH } from '../core/config.js';
import { esc } from '../core/geo.js';
import { navSettings } from '../nav/navigation.js';
import { historySetting } from '../data/tracks.js';
import { theme } from '../core/theme.js';
import { mountAppBar } from '../ui/appbar.js';
import { dataSaver } from '../map/map.js';
import { openVoiceDialog } from '../nav/navigation.js';
import { fuelKey } from '../services/media.js';
import { local, recent } from '../data/store.js';
import { konto } from '../services/konto.js';
import { myOsmStats, allOsmStats, statsText } from '../osm/stats.js';
import { toast } from '../ui/dialogs.js';
import { permissionsHere, showPermissions } from '../ui/permissions.js';

const root = document.querySelector('.settings');
// Browser am Rechner (Firefox, Chrome, Edge): WMap für „geo:“-Links anmelden.
// Die installierte Web-App meldet sich über das Manifest an, die App selbst über Tauri.
const geoHandler = 'registerProtocolHandler' in navigator && !window.__TAURI__;

let loginError = '';   // an Ort und Stelle zeigen, nicht nur kurz als Meldung
let jumped = false;    // #osm: einmal hinscrollen, nicht bei jedem Neuzeichnen
const render = () => {
  const user = account.user();
  // Testserver: nur Karte bearbeiten, ein WMap-Konto gibt es dort nicht
  const osmIn = account.loggedIn(), wmapIn = konto.loggedIn() || account.server() !== 'live';
  root.innerHTML = `
    <section>
      <h3>Darstellung</h3>
      <label class="settings-select">
        <span><strong>Hell oder dunkel</strong><small>Für Karte und App. „Wie das System“ folgt dem Modus deines Geräts, auch wenn er abends wechselt.</small></span>
        <select name="theme">
          ${[['system', 'Wie das System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<option value="${v}" ${theme.get() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      ${geoHandler ? `<button type="button" class="button settings-row" data-act="geo"><span class="msr">pin_drop</span> Karten-Links (geo:) mit WMap öffnen</button>` : ''}
      ${permissionsHere ? `<button type="button" class="button settings-row" data-act="perms"><span class="msr">verified_user</span> Berechtigungen – Standort, Health Connect</button>` : ''}
    </section>

    <section>
      <h3>Unterwegs</h3>
      ${toggle('offline', 'Karte für die Navigation offline speichern',
        'Beim Start der Navigation wird die Karte entlang der Strecke geladen – Funklöcher fallen dann nicht auf.', offlineSetting.get())}
      <label class="settings-select">
        <span><strong>Zoom in der Navigation</strong><small>Automatisch: in der Stadt nah, auf der Autobahn weiter weg, vor dem Abbiegen näher heran.</small></span>
        <select name="navzoom">
          ${[['auto', 'Automatisch'], ['near', 'Näher'], ['far', 'Mehr Überblick']].map(([v, l]) => `<option value="${v}" ${navSettings.zoom === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      ${toggle('nav3d', '3D-Ansicht in der Navigation', 'Geneigt aus Fahrersicht; aus: flach von oben.', navSettings.threeD)}
      ${toggle('saver', 'Datensparmodus', 'Keine 3D-Höhendaten und keine Offline-Karten.', dataSaver())}
      <button type="button" class="button settings-row" data-act="voice"><span class="msr">record_voice_over</span> Stimme für Ansagen</button>
      <button type="button" class="button settings-row" data-act="fuel"><span class="msr">local_gas_station</span> Spritpreise einrichten</button>
      <a class="button settings-row" href="./offline.html"><span class="msr">download_for_offline</span> Offline-Karten: Gebiete aufs Gerät laden</a>
    </section>

    <section id="osm">
      <h3>Konto</h3>
      <p class="settings-hint">WMap nimmt dein OpenStreetMap-Konto – zum Eintragen und Verbessern von Orten, zum Teilen und Bewerten von Touren und für eigene Plugins. Bei WMap gibt es kein eigenes Passwort; alles andere geht ohne Konto.</p>
      <div class="settings-account">
        ${osmIn && wmapIn
          ? `<p><span class="msr">account_circle</span> Angemeldet als <strong>${esc(user?.name ?? konto.user()?.name ?? '?')}</strong></p>
             <button type="button" class="button" data-act="logout">Abmelden</button>`
          : !account.clientId()
            ? `<p class="settings-error"><span class="msr">info</span> Die Anmeldung ist hier noch nicht eingerichtet: WMap braucht eine OAuth-Client-ID von ${esc(account.conf().web.replace(/^https:\/\//, ''))} (siehe „Für Entwickler“). Bis dahin kannst du Antworten anonym als Hinweis senden.</p>`
            : osmIn || wmapIn
              ? `<p><span class="msr">sync_problem</span> <span>${osmIn ? `Bei OpenStreetMap angemeldet als <strong>${esc(user?.name ?? '?')}</strong>, das WMap-Konto fehlt noch` : 'Die Anmeldung bei OpenStreetMap fehlt'} – bitte einmal neu anmelden.</span></p>
                 <button type="button" class="button primary" data-act="login"><span class="msr">login</span> Neu anmelden</button>
                 <button type="button" class="button" data-act="logout">Abmelden</button>`
              : `<p>${queue.size() ? `${queue.size()} Antworten warten aufs Hochladen.` : 'Noch kein Konto? Das legst du bei der Anmeldung auf openstreetmap.org an.'}</p>
                 <button type="button" class="button primary" data-act="login"><span class="msr">login</span> Mit OpenStreetMap anmelden</button>`}
        ${loginError ? `<p class="settings-error"><span class="msr">error</span> ${esc(loginError)}</p>` : ''}
      </div>
      <a class="button settings-row" href="./deleteKonto.html"><span class="msr">delete_forever</span> Konto löschen – mit Touren, Plugins und Bewertungen</a>
      <details class="settings-dev" ${account.clientId() ? '' : 'open'}>
        <summary>Für Entwickler</summary>
        <label>Server
          <select data-act="server">${Object.entries(OSM_AUTH).map(([k, v]) => `<option value="${k}" ${account.server() === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        </label>
        <label>OAuth-Client-ID
          <input type="text" data-act="client" value="${esc(account.clientId())}" placeholder="bei ${esc(account.conf().web.replace(/^https:\/\//, ''))} registrieren" spellcheck="false">
        </label>
        <p>Weiterleitungs-URL: <code>${esc(account.redirectUri())}</code></p>
        <p>Das WMap-Konto geht nur mit openstreetmap.org und der Client-ID von WMap; auf dem Testserver kannst du nur Karte bearbeiten ausprobieren.</p>
      </details>
    </section>

    <section>
      <h3>Mitmachen bei OpenStreetMap</h3>
      ${toggle('contribute', 'Weg aufzeichnen und danach fragen',
        'WMap merkt sich auf diesem Gerät, wo du warst (14 Tage), und fragt danach kurz nach – z. B. ob ein Parkplatz etwas kostet. Nichts verlässt das Gerät, bevor du antwortest und hochlädst.',
        contribute.get())}
      <button type="button" class="button settings-row" data-act="clear-trace"><span class="msr">delete</span> Aufzeichnung löschen</button>
      ${toggle('anon', 'Ohne Konto als Hinweis senden',
        'Ohne Konto gehen deine Antworten anonym als Hinweis an OpenStreetMap – Mapper tragen sie dann ein. Mit Konto direkt in die Karte.',
        anonNotes.get())}
      <p class="settings-hint osm-stats">${statsLine()}</p>
    </section>

    <section>
      <h3>Daten</h3>
      ${toggle('history', 'Jede Navigation merken',
        'Auch normale Navigationen landen unter Aufgezeichnete Touren. Geplante Touren, die du startest, und „Aufzeichnen“ werden immer gespeichert.',
        historySetting.get())}
      <a class="button settings-row" href="./sync.html"><span class="msr">sync</span> Sicherung &amp; Synchronisation – Ordner, Health Connect, ZIP</a>
      <a class="button settings-row" href="./wege.html"><span class="msr">timeline</span> Aufgezeichnete Wege ansehen</a>
      <button type="button" class="button settings-row" data-act="history"><span class="msr">history</span> Suchverlauf löschen</button>
    </section>`;
  // Aus „Ort eintragen/bearbeiten“ ohne Konto: gleich zum OSM-Konto
  if (location.hash === '#osm' && !jumped) {
    jumped = true;
    requestAnimationFrame(() => root.querySelector('#osm')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
};

// Zurück von der Anmeldung (App): osm/login-return.js löst ein, hier neu zeichnen
addEventListener('wmap:login', (e) => {
  loginError = e.detail.wmapError ? `Bei OpenStreetMap angemeldet, aber das WMap-Konto ging nicht: ${e.detail.wmapError}` : '';
  render();
});

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'offline') offlineSetting.set(t.checked);
  if (t.name === 'theme') theme.set(t.value);
  if (t.name === 'navzoom') navSettings.zoom = t.value;
  if (t.name === 'nav3d') navSettings.threeD = t.checked;
  if (t.name === 'saver') {
    // Die Karte schaltet beim nächsten Öffnen (map/map.js liest dieselbe Einstellung)
    local.set('wmap.datasaver', t.checked);
    toast(t.checked ? 'Datensparmodus an – keine 3D-Höhendaten' : 'Datensparmodus aus');
  }
  if (t.name === 'contribute') contribute.set(t.checked);
  if (t.name === 'anon') anonNotes.set(t.checked);
  if (t.name === 'history') historySetting.set(t.checked);
  if (t.dataset.act === 'server') { account.setServer(t.value); render(); }
  if (t.dataset.act === 'client') { account.setClientId(t.value); loginError = ''; render(); }
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
      toast('Der Browser fragt jetzt, ob WMap Karten-Links öffnen darf');
    } catch (err) { toast(`Geht in diesem Browser nicht (${err.message})`); }
  }
  if (act === 'history') { recent.clear(); toast('Suchverlauf gelöscht'); }
  if (act === 'clear-trace') { trace.clear(); toast('Aufzeichnung gelöscht'); }
  if (act === 'logout') { await konto.logout(); render(); }
  if (act === 'login') {
    loginError = '';
    try {
      const user = await login();
      if (user.wmapError) loginError = `Bei OpenStreetMap angemeldet, aber das WMap-Konto ging nicht: ${user.wmapError}`;
      else toast(`Angemeldet als ${user.name}`);
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
    mine ? `Du hast über WMap ${esc(mine)}.` : 'Noch keine Beiträge von diesem Gerät.',
    all ? `Alle zusammen: ${esc(all)}.` : '',
  ].filter(Boolean).join(' ') + ' <span class="muted">Gezählt wird anonym, nur die Anzahl – ohne Konto, Gerät oder Ort.</span>';
}
allOsmStats().then((s) => {
  allStats = s;
  const el = root.querySelector('.osm-stats');
  if (el) el.innerHTML = statsLine();
}).catch(() => {});

function setFuelKey() {
  const key = prompt('Tankerkönig-API-Schlüssel (kostenlos unter creativecommons.tankerkoenig.de).\n'
    + 'Er bleibt nur in diesem Browser gespeichert. Leer lassen zum Entfernen.', fuelKey());
  if (key === null) return;
  local.set('wmap.tankerkoenig', key.trim());
  toast(key.trim() ? 'Spritpreise eingerichtet' : 'Spritpreise ausgeschaltet');
}

function toggle(name, label, hint, on) {
  return `<label class="settings-toggle">
      <span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span>
      <input type="checkbox" name="${name}" data-shape="toggle" ${on ? 'checked' : ''}>
    </label>`;
}

mountAppBar();
render();
