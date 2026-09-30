/**
 * Sicherung & Synchronisation (sync.html) – Kachel in der Übersicht:
 *
 *   Ordner          ohne Ordner: synchronisieren (verbinden), einmal
 *                   importieren, als ZIP exportieren; mit Ordner: welcher,
 *                   jetzt abgleichen, ändern, exportieren, trennen; automatisch:
 *                   aus, beim Öffnen, beim Öffnen und alle 30 Minuten; letzter
 *                   Abgleich, Fehler, Ordnerstruktur erklärt (data/folder.js) –
 *                   ohne Ordner-Zugriff (Firefox, Safari): nur importieren
 *                   und exportieren
 *   Health Connect  Trainings holen (Fortschritt am Knopf, am Ende nur eine
 *                   Meldung), automatisch wie oben, Freigaben (nur Android-App)
 *   Doppelte        nur wenn es welche gibt: „Duplikate entfernen“ (data/duplicates.js)
 */
import { mountAppBar } from '../ui/appbar.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { download } from '../data/store.js';
import { restore } from '../data/tracks.js';
import { folder, zipBackup, restoreZip, importFolder, syncSummary } from '../data/folder.js';
import { healthAvailable, healthStatus, healthSync, syncHealth, healthSyncing } from '../services/health.js';
import { showPermissions } from '../ui/permissions.js';
import { autoSync } from '../data/auto-sync.js';
import { findDuplicates, removeDuplicates } from '../data/duplicates.js';

const root = document.querySelector('.sync');
const WHEN = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ms) => (ms ? WHEN.format(ms) : 'noch nie');
let connecting = false;
let importing = false;
let progress = null;        // Health Connect: { i, n }
const nativeHere = !!window.__TAURI__?.core;

const AUTO = [['off', 'Aus – nur von Hand'], ['start', 'Beim Öffnen von WMap'], ['every30', 'Beim Öffnen und alle 30 Minuten']];
const autoSelect = (name, value, hint) => `<label class="settings-select">
    <span><strong>Automatisch</strong><small>${esc(hint)}</small></span>
    <select name="${name}">${AUTO.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </label>`;

const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/** „Gleiche ab … 40 von 96 (42 %) · noch etwa 1 Min.“ */
function progressText(p) {
  if (!p?.n) return 'Gleiche ab …';
  const pct = Math.floor((p.i / p.n) * 100);
  const took = Date.now() - p.since;
  let rest = '';
  if (p.i >= 3 && took > 2000 && p.i < p.n) {
    const s = Math.round(((p.n - p.i) * took) / p.i / 1000);
    rest = s < 20 ? ' · gleich fertig' : s < 90 ? ` · noch etwa ${Math.round(s / 10) * 10} s` : ` · noch etwa ${Math.round(s / 60)} Min.`;
  }
  return `Gleiche ab … ${p.i} von ${p.n} (${pct} %)${rest}`;
}
const progressBar = (p) => `<div class="sync-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p?.n ?? 0}" aria-valuenow="${p?.i ?? 0}">
    <i style="width:${p?.n ? Math.round((p.i / p.n) * 100) : 5}%"></i></div>`;

/* ── Ordner ───────────────────────────────────────────────────────────────── */

const TREE = `<details class="sync-tree"><summary>Ordnerstruktur erklärt</summary><pre>WMap/
├─ settings.json            Einstellungen
├─ Geplante Touren/         je Tour eine GPX-Datei
├─ Aufgezeichnete Touren/
│  └─ 2026/09 September/    je Weg eine GPX-Datei (mit Puls &amp; Co.)
├─ Bus &amp; Bahn/              je gemerkte Verbindung eine JSON-Datei
└─ Lesezeichen.json         Zuhause, Arbeit, Lesezeichen und Listen</pre>
  <p class="settings-hint">Jede WMap, die denselben Ordner verbindet, liest ihn ein und gleicht mit ab. Heißt der Ordner selbst „WMap“, entfällt die Ebene.
    GPX-Dateien von woanders (Garmin, Komoot …) dürfen irgendwo darin liegen.</p></details>`;

/*
 * Knöpfe: Importieren liest einen Ordner einmal ein (App: Ordnerdialog,
 * Browser: Ordnerauswahl), eine ausgepackte ZIP mit wmap-sicherung.json ganz;
 * „ZIP einspielen“ nimmt den Export direkt. Exportieren gibt alles als ZIP.
 */
const importButton = () => (nativeHere
  ? `<button type="button" class="button" data-act="import" ${importing ? 'disabled' : ''}><span class="msr">drive_folder_upload</span> Aus Ordner importieren</button>`
  : '<label class="button"><span class="msr">drive_folder_upload</span> Aus Ordner importieren<input type="file" webkitdirectory multiple hidden data-file="folder"></label>');
const exportButton = '<button type="button" class="button" data-act="backup"><span class="msr">folder_zip</span> Exportieren (ZIP)</button>';
const zipLink = `<p class="settings-hint sync-zip">Export als ZIP wieder einspielen:
    <label class="sync-link">ZIP wählen<input type="file" accept=".zip,.json,application/zip,application/json" hidden data-file="restore"></label></p>`;

async function folderHtml() {
  if (!folder.supported) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${status('folder_off', 'Dauerhaft synchronisieren geht in der <strong>WMap-App</strong> (Android, Linux, macOS, Windows) und in Chrome bzw. Edge. '
        + 'Hier kannst du einmal importieren oder alles als ZIP exportieren.', 'warn')}
      <div class="sync-actions">${importButton()}${exportButton}</div>
      ${zipLink}
      ${TREE}
    </section>`;
  }
  const i = await folder.info().catch((err) => ({ connected: false, error: { message: err.message } }));
  if (!i.connected) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${connecting ? status('sync', 'Ordner wird verbunden …', 'busy')
        : importing ? status('sync', 'Importiere …', 'busy')
          : status('folder', 'Kein Ordner synchronisiert. Nimm einen Ordner, den dein Sync-Programm abgleicht (Nextcloud, Proton Drive, Google Drive, Syncthing …) – '
            + 'dann haben alle deine Geräte dieselben Touren, Wege, Verbindungen, Lesezeichen und Einstellungen.')}
      ${i.error ? status('error', `Fehler: ${esc(i.error.message)}`, 'error') : ''}
      <div class="sync-actions">
        <button type="button" class="button primary" data-act="connect" ${connecting ? 'disabled' : ''}><span class="msr">sync</span> Ordner synchronisieren</button>
        ${importButton()}
        ${exportButton}
      </div>
      ${zipLink}
      ${TREE}
    </section>`;
  }
  const again = i.permission !== 'granted';
  const busy = folder.busy || connecting;
  const p = folder.progress;
  return `<section>
    <h3><span class="msr">folder_open</span> Ordner</h3>
    ${status('folder_open', `Synchronisiert mit <strong>${esc(i.name)}</strong>`)}
    ${busy ? `<div class="folder-progress">${status('sync', progressText(p), 'busy')}${progressBar(p)}</div>`
      : again ? status('folder_managed', 'Der Browser braucht wieder deine Erlaubnis für den Ordner.', 'warn')
        : i.pending ? status('sync_problem', 'Der letzte Abgleich wurde unterbrochen – er läuft beim nächsten Öffnen einer Seite weiter.', 'warn')
          : status('schedule', `Letzter Abgleich: ${when(i.last)}${i.last ? ` – ${esc(syncSummary(i.result))}` : ''}`)}
    ${busy ? '<p class="settings-hint">Du kannst WMap weiter benutzen. Wechselst du die Seite, macht die nächste dort weiter, wo dieser Abgleich aufgehört hat.</p>' : ''}
    ${i.error && !busy ? status('error', `Fehler am ${when(i.error.at)}: ${esc(i.error.message)}`, 'error') : ''}
    <div class="sync-actions">
      <button type="button" class="button${again ? ' primary' : ''}" data-act="sync" ${busy ? 'disabled' : ''}><span class="msr">sync</span> ${again ? 'Erlauben und abgleichen' : 'Jetzt abgleichen'}</button>
      <button type="button" class="button" data-act="change" ${busy ? 'disabled' : ''}><span class="msr">drive_file_move</span> Ordner ändern</button>
      ${exportButton}
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
  const bar = busy ? progressBar(progress) : '';
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

/* ── Doppelte ─────────────────────────────────────────────────────────────── */

async function duplicatesHtml() {
  if (folder.busy || healthSyncing()) return '';
  const d = await findDuplicates().catch(() => null);
  if (!d?.count) return '';
  const what = [
    d.tracks.length ? `${d.tracks.reduce((n, g) => n + g.length - 1, 0)} aufgezeichnete` : '',
    d.tours.length ? `${d.tours.reduce((n, g) => n + g.length - 1, 0)} geplante` : '',
  ].filter(Boolean).join(' und ');
  return `<section class="sync-dups">
    <h3><span class="msr">content_copy</span> Doppelte Touren</h3>
    ${status('content_copy', `${what} ${d.count === 1 ? 'Tour gibt' : 'Touren gibt'} es doppelt – etwa aus Health Connect und aus dem Ordner einer früheren App.`, 'warn')}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="dedupe"><span class="msr">delete_sweep</span> Duplikate entfernen</button>
    </div>
  </section>`;
}

let painting = null;
async function render() {
  // Mehrere Anlässe kurz nacheinander: einmal zeichnen
  painting ??= (async () => {
    await null;
    root.innerHTML = `${await folderHtml()}${await healthHtml()}${await duplicatesHtml()}
      <p class="settings-hint sync-note"><span class="msr">lock</span> Alles bleibt auf deinen Geräten – WMap hat dafür keinen Server. Was im Ordner liegt, gleicht nur dein eigenes Sync-Programm ab.</p>`;
  })().finally(() => { painting = null; });
  return painting;
}

const importText = (r) => (r.imported ? `${r.imported} übernommen${r.skipped ? `, ${r.skipped} gab es schon` : ''}` : r.skipped ? 'Alles schon da' : 'Keine GPX-Dateien im Ordner');

/* ── Knöpfe ───────────────────────────────────────────────────────────────── */

root.addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'connect' || act === 'change') {
    if (act === 'change') {
      const v = await ask({ icon: 'drive_file_move', title: 'Anderen Ordner nehmen?', text: 'WMap gleicht danach mit dem neuen Ordner ab und schreibt alles hinein. Der alte Ordner bleibt, wie er ist.',
        buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Ordner wählen', primary: true }] });
      if (v !== 'yes') return;
    }
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
  if (act === 'import') {
    importing = true; render();
    try { toast(importText(await importFolder())); } catch (err) { if (err.name !== 'AbortError') toast(`Importieren ging nicht: ${err.message}`); }
    importing = false; render();
  }
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
  if (act === 'dedupe') {
    const d = await findDuplicates();
    const v = await ask({ icon: 'delete_sweep', title: `${d.count} ${d.count === 1 ? 'Duplikat' : 'Duplikate'} entfernen?`,
      text: 'Von jeder doppelten Tour bleibt eine – die mit den meisten Angaben (Puls, Herkunft aus Health Connect). Auf anderen Geräten verschwinden die Doppelten beim nächsten Abgleich ebenfalls.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Entfernen', primary: true }] });
    if (v !== 'yes') return;
    const n = await removeDuplicates();
    toast(`${n} ${n === 1 ? 'Duplikat' : 'Duplikate'} entfernt`);
    render();
  }
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
      toast(importText(await importFolder(inp.files)));
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
addEventListener('wmap:folder-progress', (e) => {
  // Fortschritt: nur Zeile und Balken, nicht die ganze Seite neu
  const box = root.querySelector('.folder-progress');
  if (e.detail?.done || !box) { render(); return; }
  box.innerHTML = `${status('sync', progressText(e.detail), 'busy')}${progressBar(e.detail)}`;
});
/** Verbunden, aber noch nie abgeglichen (z. B. gerade aus dem Ordnerdialog zurück): jetzt */
async function firstSync() {
  const i = await folder.info().catch(() => null);
  if (i?.connected && !i.last && !folder.busy && i.permission === 'granted') {
    folder.sync().then((r) => { if (r) toast(`Ordner verbunden – ${syncSummary(r)}`); }).catch((err) => toast(`Abgleich ging nicht: ${err.message}`));
  }
}
addEventListener('wmap:health', () => render());
// Aus den Einstellungen von Android bzw. Health Connect zurück: Stand neu
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); firstSync(); } });

mountAppBar();
await render();
firstSync();
autoSync();
