/**
 * Sicherung & Synchronisation (sync.html) – Kachel in der Übersicht:
 *
 *   Ordner          ohne Ordner: synchronisieren (verbinden), einmal
 *                   importieren, als ZIP exportieren; mit Ordner: welcher,
 *                   jetzt abgleichen, ändern, exportieren, trennen; automatisch:
 *                   aus, beim Öffnen, beim Öffnen und alle 30 Minuten; „In der
 *                   App behalten“ (letzte 30/90/365 Tage oder alles – Älteres
 *                   liegt nur im Ordner, in der App die Karteikarte); letzter
 *                   Abgleich, Fehler, Ordnerstruktur erklärt (data/folder.js) –
 *                   ohne Ordner-Zugriff (Firefox, Safari): nur importieren
 *                   und exportieren
 *   Health Connect  Trainings holen (Fortschritt am Knopf, am Ende nur eine
 *                   Meldung), automatisch wie oben, Freigaben (nur Android-App)
 *   Doppelte        nur wenn es welche gibt: je Tour wählen, wessen Strecke (GPS) bleibt und –
 *                   bei mehreren mit Messwerten – wessen Gesundheitsdaten (data/duplicates.js)
 */
import { mountAppBar } from '../ui/appbar.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc, fmtDistance, fmtDuration } from '../core/geo.js';
import { download } from '../data/store.js';
import { restore, trackEnd, sameTrack, tracks } from '../data/tracks.js';
import { folder, zipBackup, restoreZip, importFolder, syncSummary } from '../data/folder.js';
import { healthAvailable, healthStatus, healthSync, syncHealth, healthSyncing, appName } from '../services/health.js';
import { showPermissions } from '../ui/permissions.js';
import { autoSync } from '../data/auto-sync.js';
import { offerInbox } from '../ui/folder-inbox.js';
import { findDuplicates, removeDuplicates, valueKinds } from '../data/duplicates.js';

const root = document.querySelector('.sync');
const WHEN = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ms) => (ms ? WHEN.format(ms) : 'noch nie');
let connecting = false;
let importing = false;
let progress = null;        // Health Connect: { i, n }
const nativeHere = !!window.__TAURI__?.core;

const AUTO = [['off', 'Aus – nur von Hand'], ['start', 'Beim Öffnen von WMap'], ['every30', 'Beim Öffnen und alle 30 Minuten']];
const KEEP = [['30', 'Letzte 30 Tage'], ['90', 'Letzte 90 Tage'], ['365', 'Letztes Jahr'], ['all', 'Alles']];
const autoSelect = (name, value, hint) => `<label class="settings-select">
    <span><strong>Automatisch</strong><small>${esc(hint)}</small></span>
    <select name="${name}">${AUTO.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </label>`;

const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/** „Gleiche ab … 40 von 96 (42 %) · noch etwa 1 Min.“ */
function progressText(p) {
  // Was gerade geschieht: erst die Liste des Ordners, dann (einmalig) der Umzug, dann Datei für Datei
  const what = p?.what === 'lift' ? 'Ziehe aus dem Unterordner „WMap“ um' : 'Gleiche ab';
  if (!p?.n) return p?.what === 'list' ? 'Lese den Ordner …' : `${what} …`;
  const pct = Math.floor((p.i / p.n) * 100);
  const took = Date.now() - p.since;
  let rest = '';
  if (p.i >= 3 && took > 2000 && p.i < p.n) {
    const s = Math.round(((p.n - p.i) * took) / p.i / 1000);
    rest = s < 20 ? ' · gleich fertig' : s < 90 ? ` · noch etwa ${Math.round(s / 10) * 10} s` : ` · noch etwa ${Math.round(s / 60)} Min.`;
  }
  return `${what} … ${p.i} von ${p.n} (${pct} %)${rest}`;
}
const progressBar = (p) => `<div class="sync-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p?.n ?? 0}" aria-valuenow="${p?.i ?? 0}">
    <i style="width:${p?.n ? Math.round((p.i / p.n) * 100) : 5}%"></i></div>`;

/* ── Ordner ───────────────────────────────────────────────────────────────── */

const TREE = `<details class="sync-tree"><summary>Ordnerstruktur erklärt</summary><pre>Dein Ordner/
├─ settings.json            Einstellungen
├─ Geplante Touren/         je Tour eine GPX-Datei
├─ Aufgezeichnete Touren/
│  └─ 2026/09 September/    je Weg eine GPX-Datei (mit Puls &amp; Co.) oder die FIT-Datei der Uhr
├─ Bus &amp; Bahn/              je gemerkte Verbindung eine JSON-Datei
├─ Lesezeichen.json         Zuhause, Arbeit, Lesezeichen und Listen
├─ Unbekannte Dateien/         was sich nicht lesen ließ – nach 30 Tagen gelöscht
└─ Inhalt.json              Verzeichnis für den schnellen Abgleich</pre>
  <p class="settings-hint">Jede WMap, die denselben Ordner verbindet, liest ihn ein und gleicht mit ab. Nimm einen Ordner nur für WMap.
    GPX- und FIT-Dateien von woanders (Uhr, Garmin, Komoot …) legst du einfach hinein, egal wohin: WMap fragt, was damit geschehen soll, und sortiert sie an ihren Platz –
    auch aus eigenen Unterordnern. Eine FIT-Datei bleibt, wie die Uhr sie schrieb. Andere Dateien (Fotos, Dokumente) fasst WMap nicht an.
    Löschst du eine Tourendatei, verschwindet der Eintrag auch in WMap.</p></details>`;

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

/** „Unbekannte Dateien“: was sich nicht lesen ließ – selbst nachsehen, nach 30 Tagen löscht WMap sie */
function brokenHtml(i) {
  const list = Object.entries(i.broken ?? {}).sort((a, b) => a[1] - b[1]);
  if (!list.length) return '';
  const until = new Date(list[0][1] + 30 * 24 * 3600 * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  const names = list.map(([p]) => p.split('/').pop());
  return `<div class="folder-broken">${status('report', `${list.length === 1 ? 'Eine Datei ließ' : `${list.length} Dateien ließen`} sich nicht lesen und ${list.length === 1 ? 'liegt' : 'liegen'} im Ordner unter „Unbekannte Dateien“:
      ${esc(names.slice(0, 5).join(', '))}${names.length > 5 ? ' …' : ''}. Schau selbst nach, ob etwas Wichtiges dabei ist – WMap löscht sie 30 Tage nach dem Fund (die erste am ${until}).`, 'warn')}
    ${i.native ? '<div class="sync-actions"><button type="button" class="button" data-act="reveal"><span class="msr">folder_open</span> Im Dateimanager öffnen</button></div>' : ''}</div>`;
}

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
  const list = await tracks.all().catch(() => []);
  const shelf = { total: list.length, cards: list.filter((t) => t.stub).length };
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
    ${i.inbox.length && !busy ? `<div class="folder-inbox">${status('drive_folder_upload', `${i.inbox.length === 1 ? 'Eine neue Datei liegt' : `${i.inbox.length} neue Dateien liegen`} im Ordner und ${i.inbox.length === 1 ? 'wartet' : 'warten'} auf deine Entscheidung: ${esc(i.inbox.slice(0, 3).map((x) => x.file).join(', '))}${i.inbox.length > 3 ? ' …' : ''}`, 'warn')}
      <div class="sync-actions"><button type="button" class="button primary" data-act="inbox"><span class="msr">checklist</span> Neue Dateien ansehen</button></div></div>` : ''}
    ${brokenHtml(i)}
    <div class="sync-actions">
      <button type="button" class="button${again ? ' primary' : ''}" data-act="sync" ${busy ? 'disabled' : ''}><span class="msr">sync</span> ${again ? 'Erlauben und abgleichen' : 'Jetzt abgleichen'}</button>
      <button type="button" class="button" data-act="change" ${busy ? 'disabled' : ''}><span class="msr">drive_file_move</span> Ordner ändern</button>
      ${exportButton}
      <button type="button" class="button" data-act="disconnect"><span class="msr">link_off</span> Trennen</button>
    </div>
    ${autoSelect('folder-auto', folder.auto, 'Beim Öffnen gleicht WMap ab und kurz nach jeder Änderung; auf Wunsch zusätzlich alle 30 Minuten, solange WMap offen ist.')}
    <label class="settings-select">
      <span><strong>In der App behalten</strong><small>Aufgezeichnete Touren aus dieser Zeit liegen ganz in der App, ältere nur im Ordner – in der App bleibt eine Karteikarte (Name, Strecke, Zeit, grober Verlauf), der Rest kommt beim Öffnen aus dem Ordner.
        Was du in „Meine Touren“ als „offline verfügbar“ markierst, bleibt immer ganz in der App. Geplante Touren bleiben es ohnehin.${shelf.cards ? ` Gerade: ${shelf.cards} von ${shelf.total} nur im Ordner.` : ''}</small></span>
      <select name="folder-keep">${KEEP.map(([v, l]) => `<option value="${v}" ${v === folder.keep ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
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

/** Welche Aufzeichnung je doppelter Tour bleibt und von welcher die Gesundheitsdaten kommen (IDs) – gemerkt, solange die Seite offen ist */
const dupKeep = new Set();
const dupVals = new Set();
const VALUE_NAME = { hr: 'Puls', cad: 'Frequenz', pow: 'Leistung' };

/** Woher eine Aufzeichnung kommt – „Health Connect · Zepp“, „GPX-Datei“, „Mit WMap aufgezeichnet“ */
const dupOrigin = (t) => (t.kind === 'health' ? `Health Connect${t.source?.app ? ` · ${appName(t.source.app)}` : ''}`
  : t.kind === 'gpx' ? 'GPX-Datei' : t.kind === 'nav' ? 'Bei der Navigation aufgezeichnet' : 'Mit WMap aufgezeichnet');
const dupPoints = (t) => (t.stub ? t.n : t.times?.length) || 0;
/** Strecke: Kilometer, Dauer, wie fein aufgezeichnet */
const dupFacts = (t) => [
  fmtDistance(t.length), fmtDuration((trackEnd(t) - t.start) / 1000),
  dupPoints(t) ? `${dupPoints(t).toLocaleString('de-DE')} Punkte` : '',
].filter(Boolean).join(' · ');
/** Gesundheitsdaten: was gemessen wurde, beim Puls der Schnitt */
function dupValues(t) {
  const hr = (t.hr ?? []).filter((v) => v > 0);
  return valueKinds(t).map((k) => (k === 'hr' && hr.length ? `Puls (Ø ${Math.round(hr.reduce((a, b) => a + b, 0) / hr.length)})` : VALUE_NAME[k])).join(' · ');
}
const dupDate = (t) => new Date(t.start).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function duplicatesHtml() {
  if (folder.busy || healthSyncing()) return '';
  const d = await findDuplicates().catch(() => null);
  if (!d?.count) return '';
  const what = [
    d.tracks.length ? `${d.tracks.reduce((n, g) => n + g.length - 1, 0)} aufgezeichnete` : '',
    d.tours.length ? `${d.tours.reduce((n, g) => n + g.length - 1, 0)} geplante` : '',
  ].filter(Boolean).join(' und ');
  // Zu wählen gibt es nur bei zwei verschiedenen Aufzeichnungen (Uhr und Handy);
  // dieselbe Aufzeichnung zweimal (aus dem Ordner wieder eingelesen) braucht keine Frage
  const groups = d.tracks.map((g, i) => {
    if (g.every((t) => sameTrack(g[0], t))) return '';
    const keep = g.find((t) => dupKeep.has(t.id)) ?? g[0];
    // Gesundheitsdaten: zu wählen nur, wenn mehrere Aufzeichnungen welche haben
    const measured = g.filter((t) => valueKinds(t).length);
    const from = measured.find((t) => dupVals.has(t.id)) ?? (measured.includes(keep) ? keep : measured[0]);
    return `<fieldset class="dup-group">
      <legend>${esc(keep.name || 'Ohne Namen')} <small>${esc(dupDate(keep))}</small></legend>
      <p class="dup-q"><span class="msr">route</span> Strecke (GPS) von</p>
      ${g.map((t) => `<label class="dup-option">
        <input type="radio" name="dup-${i}" value="${esc(t.id)}" ${t === keep ? 'checked' : ''}>
        <span><strong>${esc(dupOrigin(t))}</strong><small>${esc(dupFacts(t))}</small></span>
      </label>`).join('')}
      ${measured.length > 1 ? `<p class="dup-q"><span class="msr">monitor_heart</span> Gesundheitsdaten von</p>
      ${measured.map((t) => `<label class="dup-option dup-values">
        <input type="radio" name="dupv-${i}" value="${esc(t.id)}" ${t === from ? 'checked' : ''}>
        <span><strong>${esc(dupOrigin(t))}</strong><small>${esc(dupValues(t))}</small></span>
      </label>`).join('')}`
    : measured.length ? `<p class="dup-q dup-one"><span class="msr">monitor_heart</span> Gesundheitsdaten: ${esc(dupOrigin(measured[0]))} – ${esc(dupValues(measured[0]))}</p>` : ''}
    </fieldset>`;
  }).join('');
  return `<section class="sync-dups" id="doppelt">
    <h3><span class="msr">content_copy</span> Doppelte Touren</h3>
    ${status('content_copy', `${what} ${d.count === 1 ? 'Tour gibt' : 'Touren gibt'} es doppelt – etwa mit der Uhr und dem Handy aufgezeichnet oder aus Health Connect und aus dem Ordner.`, 'warn')}
    ${groups ? `<p class="settings-hint">Diese Touren gibt es aus mehreren Quellen. Wähle je Tour, wessen Strecke bleibt – ihre Zeit und Kilometer gelten. Gesundheitsdaten (Puls, Frequenz, Leistung) kommen dazu; haben mehrere Aufzeichnungen welche, wählst du auch, von welcher.</p>
    <div class="dup-list">${groups}</div>` : ''}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="dedupe"><span class="msr">merge</span> Zusammenführen</button>
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
  if (act === 'inbox') { offerInbox((await folder.info()).inbox, true); return; }
  if (act === 'reveal') {
    folder.reveal('Unbekannte Dateien').catch(() => toast('Der Dateimanager ließ sich nicht öffnen – der Ordner heißt „Unbekannte Dateien“'));
    return;
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
    const v = await ask({ icon: 'link_off', title: 'Ordner trennen?', text: 'WMap gleicht dann nicht mehr ab. Die Dateien im Ordner bleiben, wie sie sind; Touren, die nur im Ordner lagen, holt WMap vorher in die App.',
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
    const v = await ask({ icon: 'merge', title: `${d.count} doppelte ${d.count === 1 ? 'Tour' : 'Touren'} zusammenführen?`,
      text: 'Von jeder doppelten Tour bleibt die gewählte Strecke mit den gewählten Gesundheitsdaten. Auf anderen Geräten verschwinden die Doppelten beim nächsten Abgleich ebenfalls.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Zusammenführen', primary: true }] });
    if (v !== 'yes') return;
    const picked = (sel) => [...root.querySelectorAll(`${sel} input:checked`)].map((el) => el.value);
    const n = await removeDuplicates(picked('.dup-option:not(.dup-values)'), picked('.dup-values'));
    dupKeep.clear();
    dupVals.clear();
    toast(`${n} doppelte ${n === 1 ? 'Tour' : 'Touren'} zusammengeführt`);
    render();
  }
  if (act === 'backup') {
    const format = await ask({
      icon: 'folder_zip', title: 'Exportieren als', className: 'stacked',
      text: 'Alle Touren in einer ZIP-Datei. Aufgezeichnete Touren als GPX (enthält alles, was WMap weiß) oder als FIT (Format der Sportuhren: Punkte, Puls, Frequenz, Leistung, Runden, Sportart). Geplante Touren sind immer GPX.',
      buttons: [
        { value: 'gpx', label: 'Aufzeichnungen als GPX', icon: 'draft', primary: true },
        { value: 'fit', label: 'Aufzeichnungen als FIT', icon: 'watch' },
        { value: 'no', label: 'Abbrechen' },
      ],
    });
    if (format !== 'gpx' && format !== 'fit') return;
    zipBackup({ format }).then((blob) => download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}${format === 'fit' ? '-fit' : ''}.zip`, blob, 'application/zip'))
      .catch((err) => toast(`Sicherung ging nicht: ${err.message}`));
  }
});

root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.closest('.dup-option')) {
    // Wahl merken – die Seite zeichnet sich bei jedem Abgleich neu
    const set = t.closest('.dup-values') ? dupVals : dupKeep;
    for (const el of t.closest('.dup-group').querySelectorAll(`input[name="${t.name}"]`)) set.delete(el.value);
    set.add(t.value);
    return;
  }
  if (t.name === 'folder-keep') {
    folder.keep = t.value;
    toast(t.value === 'all' ? 'Alle Touren bleiben ganz in der App' : `In der App: ${Object.fromEntries(KEEP)[t.value].toLowerCase()} – Älteres liegt im Ordner`);
    folder.sync().catch(() => {}).finally(render);
    return;
  }
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
