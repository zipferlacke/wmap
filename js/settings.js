/**
 * Einstellungen (settings.html): Hell/dunkel, Offline-Karten, Datensparmodus,
 * Mitmachen bei OSM samt Konto, Stimme, Spritpreise, Verlauf. Eine eigene
 * Seite ohne Karte – alles bleibt in diesem Browser, die Karte liest es beim
 * nächsten Öffnen.
 */
import { offlineSetting } from './offline.js';
import { contribute, trace } from './trace.js';
import { account, login } from './osm-api.js';
import { queue, anonNotes } from './survey.js';
import { OSM_AUTH } from './config.js';
import { esc } from './geo.js';
import { navSettings } from './navigation.js';
import { historySetting } from './tracks.js';
import { mountFolder } from './folder.js';
import { theme } from './theme.js';
import { mountAppBar } from './appbar.js';
import { dataSaver } from './map.js';
import { openVoiceDialog } from './navigation.js';
import { fuelKey } from './media.js';
import { local, recent } from './store.js';

const root = document.querySelector('.settings');

function toast(text) {
  let el = document.getElementById('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

let loginError = '';   // an Ort und Stelle zeigen, nicht nur kurz als Meldung
const render = () => {
  const user = account.user();
  root.innerHTML = `
    <section>
      <h3>Darstellung</h3>
      <label class="settings-select">
        <span><strong>Hell oder dunkel</strong><small>Für Karte und App. „Wie das System“ folgt dem Modus deines Geräts, auch wenn er abends wechselt.</small></span>
        <select name="theme">
          ${[['system', 'Wie das System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<option value="${v}" ${theme.get() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
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
    </section>

    <section>
      <h3>Mitmachen bei OpenStreetMap</h3>
      ${toggle('contribute', 'Weg aufzeichnen und danach fragen',
        'WMap merkt sich auf diesem Gerät, wo du warst (14 Tage), und fragt danach kurz nach – z. B. ob ein Parkplatz etwas kostet. Nichts verlässt das Gerät, bevor du antwortest und hochlädst.',
        contribute.get())}
      <button type="button" class="button settings-row" data-act="clear-trace"><span class="msr">delete</span> Aufzeichnung löschen</button>
      ${toggle('anon', 'Ohne Konto als Hinweis senden',
        'Ohne OSM-Konto gehen deine Antworten anonym als Hinweis an OpenStreetMap – Mapper tragen sie dann ein. Mit Konto direkt in die Karte.',
        anonNotes.get())}
      <div class="settings-account">
        ${account.loggedIn()
          ? `<p><span class="msr">account_circle</span> Angemeldet als <strong>${esc(user?.name ?? '?')}</strong></p>
             <button type="button" class="button" data-act="logout">Abmelden</button>`
          : account.clientId()
            ? `<p>Antworten landen bei OpenStreetMap unter deinem Namen. ${queue.size() ? `${queue.size()} warten aufs Hochladen.` : ''}</p>
               <button type="button" class="button primary" data-act="login"><span class="msr">login</span> Bei OpenStreetMap anmelden</button>`
            : `<p class="settings-error"><span class="msr">info</span> Die Anmeldung ist hier noch nicht eingerichtet: WMap braucht eine OAuth-Client-ID von ${esc(account.conf().web.replace(/^https:\/\//, ''))} (siehe „Für Entwickler“). Bis dahin kannst du Antworten anonym als Hinweis senden (Schalter oben).</p>`}
        ${loginError ? `<p class="settings-error"><span class="msr">error</span> ${esc(loginError)}</p>` : ''}
      </div>
      <details class="settings-dev" ${account.clientId() ? '' : 'open'}>
        <summary>Für Entwickler</summary>
        <label>Server
          <select data-act="server">${Object.entries(OSM_AUTH).map(([k, v]) => `<option value="${k}" ${account.server() === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        </label>
        <label>OAuth-Client-ID
          <input type="text" data-act="client" value="${esc(account.clientId())}" placeholder="bei ${esc(account.conf().web.replace(/^https:\/\//, ''))} registrieren" spellcheck="false">
        </label>
        <p>Weiterleitungs-URL: <code>${esc(account.redirectUri())}</code></p>
      </details>
    </section>

    <section>
      <h3>Daten</h3>
      ${toggle('history', 'Fahrten merken',
        'Navigierte Strecken landen unter Meine Touren → Aufgezeichnet – nur auf diesem Gerät, über Jahre. Mit Sicherungsdatei auf ein anderes Gerät.',
        historySetting.get())}
      <div class="settings-folder"></div>
      <a class="button settings-row" href="./wege.html"><span class="msr">timeline</span> Aufgezeichnete Wege ansehen</a>
      <button type="button" class="button settings-row" data-act="history"><span class="msr">history</span> Suchverlauf löschen</button>
    </section>`;
  mountFolder(root.querySelector('.settings-folder'), { toast });
};

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'offline') offlineSetting.set(t.checked);
  if (t.name === 'theme') theme.set(t.value);
  if (t.name === 'navzoom') navSettings.zoom = t.value;
  if (t.name === 'nav3d') navSettings.threeD = t.checked;
  if (t.name === 'saver') {
    // Die Karte schaltet beim nächsten Öffnen (map.js liest dieselbe Einstellung)
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
  if (act === 'fuel') setFuelKey();
  if (act === 'history') { recent.clear(); toast('Suchverlauf gelöscht'); }
  if (act === 'clear-trace') { trace.clear(); toast('Aufzeichnung gelöscht'); }
  if (act === 'logout') { account.logout(); render(); }
  if (act === 'login') {
    loginError = '';
    try {
      const user = await login();
      toast(`Angemeldet als ${user.name}`);
    } catch (err) { loginError = err.message; }
    render();
  }
});

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
