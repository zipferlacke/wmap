/**
 * Einstellungen: Offline-Karten, Datensparmodus, Mitmachen bei OSM samt
 * Konto, Stimme, Spritpreise, Verlauf. Alles bleibt in diesem Browser.
 */
import { offlineSetting } from './offline.js';
import { contribute, trace } from './trace.js';
import { account, login } from './osm-api.js';
import { queue, anonNotes } from './survey.js';
import { OSM_AUTH } from './config.js';
import { esc } from './geo.js';
import { navSettings } from './navigation.js';

/**
 * @param ctx.dataSaver / setDataSaver   Datensparmodus lesen/schalten
 * @param ctx.onVoice, onFuelKey, onClearHistory, onContribute
 */
export function openSettings(ctx) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog settings';
  const render = () => {
    const user = account.user();
    dlg.innerHTML = `
      <header class="settings-head">
        <h2><span class="msr">settings</span> Einstellungen</h2>
        <button type="button" class="button" data-shape="round no-background" data-act="close" title="Schließen"><span class="msr">close</span></button>
      </header>

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
        ${toggle('saver', 'Datensparmodus', 'Keine 3D-Höhendaten und keine Offline-Karten.', ctx.dataSaver())}
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
            : `<p>Antworten landen bei OpenStreetMap unter deinem Namen. ${queue.size() ? `${queue.size()} warten aufs Hochladen.` : ''}</p>
               <button type="button" class="button primary" data-act="login"><span class="msr">login</span> Bei OpenStreetMap anmelden</button>`}
        </div>
        <details class="settings-dev">
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
        <button type="button" class="button settings-row" data-act="history"><span class="msr">history</span> Suchverlauf löschen</button>
      </section>`;
  };
  render();
  document.body.append(dlg);

  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'offline') offlineSetting.set(t.checked);
    if (t.name === 'navzoom') navSettings.zoom = t.value;
    if (t.name === 'nav3d') navSettings.threeD = t.checked;
    if (t.name === 'saver') ctx.setDataSaver(t.checked);
    if (t.name === 'contribute') { contribute.set(t.checked); ctx.onContribute?.(); }
    if (t.name === 'anon') anonNotes.set(t.checked);
    if (t.dataset.act === 'server') { account.setServer(t.value); render(); }
    if (t.dataset.act === 'client') account.setClientId(t.value);
  });
  dlg.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') { dlg.close(); return; }
    if (act === 'voice') ctx.onVoice();
    if (act === 'fuel') ctx.onFuelKey();
    if (act === 'history') ctx.onClearHistory();
    if (act === 'clear-trace') { trace.clear(); ctx.toast('Aufzeichnung gelöscht'); }
    if (act === 'logout') { account.logout(); render(); }
    if (act === 'login') {
      try {
        const user = await login();
        ctx.toast(`Angemeldet als ${user.name}`);
        ctx.onContribute?.();
      } catch (err) { ctx.toast(err.message); }
      render();
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function toggle(name, label, hint, on) {
  return `<label class="settings-toggle">
      <span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span>
      <input type="checkbox" name="${name}" data-shape="toggle" ${on ? 'checked' : ''}>
    </label>`;
}
