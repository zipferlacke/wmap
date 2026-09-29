/**
 * Sicherung & Abgleich (sync.html) – Kachel in der Übersicht:
 *
 *   Ordner          verbinden, jetzt abgleichen, trennen; automatisch: aus,
 *                   beim Öffnen, beim Öffnen und alle 30 Minuten; letzter
 *                   Abgleich, Fehler, was im Ordner liegt (data/folder.js) –
 *                   ohne Ordner-Zugriff (Firefox, Safari): GPX einlesen, teilen
 *   Health Connect  Trainings holen (Fortschritt am Knopf, am Ende nur eine
 *                   Meldung), automatisch wie oben, Freigaben (nur Android-App)
 *   Sicherung       alles als ZIP speichern bzw. einspielen
 */
import { mountAppBar } from '../ui/appbar.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { download } from '../data/store.js';
import { restore } from '../data/tracks.js';
import { folder, zipBackup, restoreZip, importLoose, shareAll, canShareFiles, syncSummary } from '../data/folder.js';
import { healthAvailable, healthStatus, healthSync, syncHealth, healthSyncing } from '../services/health.js';
import { showPermissions } from '../ui/permissions.js';
import { autoSync } from '../data/auto-sync.js';

const root = document.querySelector('.sync');
const WHEN = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ms) => (ms ? WHEN.format(ms) : 'noch nie');
let connecting = false;
let progress = null;        // Health Connect: { i, n }

const AUTO = [['off', 'Aus – nur von Hand'], ['start', 'Beim Öffnen von WMap'], ['every30', 'Beim Öffnen und alle 30 Minuten']];
const autoSelect = (name, value, hint) => `<label class="settings-select">
    <span><strong>Automatisch</strong><small>${esc(hint)}</small></span>
    <select name="${name}">${AUTO.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </label>`;

const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/* ── Ordner ───────────────────────────────────────────────────────────────── */

const TREE = `<details class="sync-tree"><summary>Was im Ordner liegt</summary><pre>WMap/
├─ settings.json            Einstellungen
├─ Geplante Touren/         je Tour eine GPX-Datei
├─ Aufgezeichnete Touren/
│  └─ 2026/09 September/    je Weg eine GPX-Datei (mit Puls &amp; Co.)
├─ Bus &amp; Bahn/              je gemerkte Verbindung eine JSON-Datei
└─ Lesezeichen.json         Zuhause, Arbeit, Lesezeichen und Listen</pre>
  <p class="settings-hint">Jede WMap, die denselben Ordner verbindet, liest ihn ein und gleicht mit ab. Heißt der Ordner selbst „WMap“, entfällt die Ebene.
    GPX-Dateien von woanders (Garmin, Komoot …) dürfen irgendwo darin liegen.</p></details>`;

async function folderHtml() {
  if (!folder.supported) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${status('folder_off', 'Dieser Browser darf nicht in einen Ordner schreiben – fest verbinden und abgleichen geht in der <strong>WMap-App</strong> '
        + '(Android, Linux, macOS, Windows) und in Chrome bzw. Edge.', 'warn')}
      <p class="settings-hint">Hier kannst du einmalig GPX-Dateien aus einem Ordner übernehmen${canShareFiles() ? ' und alles als Dateien teilen – z. B. in Proton Drive oder Nextcloud' : ''}.</p>
      <div class="sync-actions">
        <label class="button"><span class="msr">drive_folder_upload</span> GPX aus Ordner einlesen<input type="file" webkitdirectory multiple hidden data-file="folder"></label>
        ${canShareFiles() ? '<button type="button" class="button" data-act="share"><span class="msr">ios_share</span> Alles teilen</button>' : ''}
      </div>
      ${TREE}
    </section>`;
  }
  const i = await folder.info().catch((err) => ({ connected: false, error: { message: err.message } }));
  if (!i.connected) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${connecting ? status('sync', 'Ordner wird verbunden …', 'busy')
        : status('folder', 'Kein Ordner verbunden. Verbinde einen Ordner, den dein Sync-Programm abgleicht (Nextcloud, Proton Drive, Google Drive, Syncthing …) – '
          + 'dann haben alle deine Geräte dieselben Touren, Wege, Verbindungen, Lesezeichen und Einstellungen.')}
      ${i.error ? status('error', `Fehler: ${esc(i.error.message)}`, 'error') : ''}
      <div class="sync-actions"><button type="button" class="button primary" data-act="connect" ${connecting ? 'disabled' : ''}><span class="msr">create_new_folder</span> Ordner verbinden</button></div>
      ${TREE}
    </section>`;
  }
  const again = i.permission !== 'granted';
  const busy = folder.busy || connecting;
  return `<section>
    <h3><span class="msr">folder_open</span> Ordner</h3>
    ${status('folder_open', `Verbunden mit <strong>${esc(i.name)}</strong>`)}
    ${busy ? status('sync', 'Gleiche ab …', 'busy')
      : again ? status('folder_managed', 'Der Browser braucht wieder deine Erlaubnis für den Ordner.', 'warn')
        : status('schedule', `Letzter Abgleich: ${when(i.last)}${i.last ? ` – ${esc(syncSummary(i.result))}` : ''}`)}
    ${i.error && !busy ? status('error', `Fehler am ${when(i.error.at)}: ${esc(i.error.message)}`, 'error') : ''}
    <div class="sync-actions">
      <button type="button" class="button${again ? ' primary' : ''}" data-act="sync" ${busy ? 'disabled' : ''}><span class="msr">sync</span> ${again ? 'Erlauben und abgleichen' : 'Jetzt abgleichen'}</button>
      <button type="button" class="button" data-act="disconnect"><span class="msr">link_off</span> Trennen</button>
    </div>
    ${autoSelect('folder-auto', folder.auto, 'Beim Öffnen gleicht WMap ab und kurz nach jeder Änderung; auf Wunsch zusätzlich alle 30 Minuten, solange WMap offen ist.')}
    ${TREE}
  </section>`;
}

/* ── Health Connect ───────────────────────────────────────────────────────── */

async function healthHtml() {
  if (!healthAvailable) return '';
  const st = await healthStatus().catch((err) => ({ available: false, reason: err.message }));
  const last = healthSync.last();
  const busy = healthSyncing();
  const line = !st.available ? status('block', esc(st.reason), 'warn')
    : !st.read ? status('favorite', 'Noch nicht freigegeben – WMap darf Health Connect noch nicht lesen.', 'warn')
      : status('check_circle', `Freigegeben${st.routes ? ', Routen immer' : ', Routen mit Rückfrage'}${st.values ? ', mit Puls &amp; Co.' : ''}`);
  const bar = busy ? `<div class="sync-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${progress?.n ?? 0}" aria-valuenow="${progress?.i ?? 0}">
      <i style="width:${progress?.n ? Math.round((progress.i / progress.n) * 100) : 5}%"></i></div>` : '';
  return `<section>
    <h3><span class="msr">favorite</span> Health Connect</h3>
    ${line}
    ${busy ? status('sync', progress?.n ? `Übernehme ${progress.i} von ${progress.n} Trainings …` : 'Lese Health Connect …', 'busy')
      : status('schedule', `Letzter Abgleich: ${when(last?.at)}${last?.at && !last.error ? ` – ${last.added ? `${last.added} importiert` : 'nichts Neues'}${last.denied ? `, ${last.denied} Routen nicht freigegeben` : ''}` : ''}`)}
    ${last?.error && !busy ? status('error', `Fehler: ${esc(last.error)}`, 'error') : ''}
    ${bar}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="health" ${busy || !st.available ? 'disabled' : ''}><span class="msr">${busy ? 'sync' : 'download'}</span> ${busy ? 'Hole Trainings …' : 'Trainings holen'}</button>
      <button type="button" class="button" data-act="perms"><span class="msr">verified_user</span> Berechtigungen</button>
    </div>
    ${last?.denied && !busy ? status('info', 'Für Routen mit Rückfrage: in Health Connect WMap antippen und die Trainingsrouten auf „Immer erlauben“ stellen.') : ''}
    ${autoSelect('health-auto', healthSync.auto, 'Neue Trainings mit Route kommen von selbst als Wege dazu – ohne Rückfragen.')}
  </section>`;
}

/* ── Sicherung ────────────────────────────────────────────────────────────── */

const backupHtml = () => `<section>
    <h3><span class="msr">folder_zip</span> Sicherung</h3>
    <p class="settings-hint">Alles in einer ZIP-Datei – dieselbe Ordnung wie im Ordner, dazu eine vollständige Sicherung. Zum Mitnehmen auf ein anderes Gerät oder fürs Archiv.</p>
    <div class="sync-actions">
      <button type="button" class="button" data-act="backup"><span class="msr">folder_zip</span> Sicherung speichern (ZIP)</button>
      <label class="button"><span class="msr">settings_backup_restore</span> Sicherung laden<input type="file" accept=".zip,.json,application/zip,application/json" hidden data-file="restore"></label>
    </div>
  </section>`;

let painting = null;
async function render() {
  // Mehrere Anlässe kurz nacheinander: einmal zeichnen
  painting ??= (async () => {
    await null;
    root.innerHTML = `${await folderHtml()}${await healthHtml()}${backupHtml()}
      <p class="settings-hint sync-note"><span class="msr">lock</span> Alles bleibt auf deinen Geräten – WMap hat dafür keinen Server. Was im Ordner liegt, gleicht nur dein eigenes Sync-Programm ab.</p>`;
  })().finally(() => { painting = null; });
  return painting;
}

/* ── Knöpfe ───────────────────────────────────────────────────────────────── */

root.addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'connect') {
    connecting = true; render();
    try {
      const r = await folder.connect();
      if (r?.needsPermission) toast('Ohne Erlaubnis kein Abgleich');
      else if (r) toast(`Ordner verbunden – ${syncSummary(r)}`);
    } catch (err) { if (err.name !== 'AbortError') toast(`Verbinden ging nicht: ${err.message}`); }
    connecting = false; render();
  }
  if (act === 'sync') {
    try {
      const r = await folder.sync({ interactive: true });
      if (r?.needsPermission) toast('Ohne Erlaubnis kein Abgleich');
      else if (r) toast(`Abgeglichen – ${syncSummary(r)}`);
    } catch (err) { toast(`Abgleich ging nicht: ${err.message}`); }
    render();
  }
  if (act === 'disconnect') {
    const v = await ask({ icon: 'link_off', title: 'Ordner trennen?', text: 'WMap gleicht dann nicht mehr ab. Die Dateien im Ordner und alles in WMap bleiben, wie es ist.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Trennen', primary: true }] });
    if (v !== 'yes') return;
    await folder.disconnect();
    toast('Ordner getrennt – die Dateien bleiben, wo sie sind');
    render();
  }
  if (act === 'share') { try { await shareAll(); } catch (err) { if (err.name !== 'AbortError') toast(err.message); } }
  if (act === 'health') {
    progress = null;
    const p = syncHealth({ onProgress: (i, n) => { progress = { i, n }; render(); } });
    render();
    try {
      const r = await p;
      toast(r.added ? `${r.added} ${r.added === 1 ? 'Training' : 'Trainings'} importiert` : 'Nichts Neues in Health Connect');
    } catch (err) { toast(String(err?.message ?? err)); }
    progress = null;
    render();
  }
  if (act === 'perms') { await showPermissions({ reason: 'health' }); render(); }
  if (act === 'backup') {
    zipBackup().then((blob) => download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'application/zip'))
      .catch((err) => toast(`Sicherung ging nicht: ${err.message}`));
  }
});

root.addEventListener('change', async (e) => {
  const t = e.target;
  const label = Object.fromEntries(AUTO)[t.value];
  if (t.name === 'folder-auto') { folder.auto = t.value; toast(`Ordner: ${label}`); }
  if (t.name === 'health-auto') {
    healthSync.auto = t.value;
    toast(`Health Connect: ${label}`);
    if (t.value !== 'off' && !healthSyncing()) syncHealth({ quiet: true }).catch(() => {}).finally(render);
    render();
  }
  const inp = t.closest('[data-file]');
  if (!inp) return;
  // Leerer Ordner: der Browser meldet dann gar keine Dateien – trotzdem Bescheid geben
  if (!inp.files?.length) { toast(inp.dataset.file === 'folder' ? 'In dem Ordner sind keine Dateien' : 'Keine Datei gewählt'); return; }
  try {
    if (inp.dataset.file === 'folder') {
      const r = await importLoose(inp.files);
      toast(r.imported ? `${r.imported} übernommen${r.skipped ? `, ${r.skipped} gab es schon` : ''}` : r.skipped ? 'Alles schon da' : 'Keine GPX-Dateien im Ordner');
    } else {
      const f = inp.files[0];
      const n = /\.zip$/i.test(f.name) || f.type === 'application/zip' ? await restoreZip(f) : await restore(await f.text());
      toast(`${n} Einträge aus der Sicherung übernommen`);
    }
  } catch (err) { toast(err.message); }
  inp.value = '';
});
// Ordnerwahl abgebrochen oder leer (manche Browser melden dann kein „change“)
root.addEventListener('cancel', (e) => { if (e.target.matches?.('[data-file="folder"]')) toast('Kein Ordner gewählt'); }, true);

addEventListener('wmap:folder', () => render());
addEventListener('wmap:health', () => render());
// Aus den Einstellungen von Android bzw. Health Connect zurück: Stand neu
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

mountAppBar();
await render();
autoSync();
