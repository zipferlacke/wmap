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
import { offerInbox, offerOthers } from '../ui/folder-inbox.js';
import { findDuplicates, removeDuplicates, valueKinds } from '../data/duplicates.js';
import { locale, t } from '../core/i18n.js';

const root = document.querySelector('.sync');
const WHEN = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ms) => (ms ? WHEN.format(ms) : t('sync.never'));
let connecting = false;
let importing = false;
let progress = null;        // Health Connect: { i, n }
const nativeHere = !!window.__TAURI__?.core;

const AUTO = [['off', t('sync.auto.options.off')], ['start', t('sync.auto.options.start')], ['every30', t('sync.auto.options.every30')]];
const KEEP = [['30', t('sync.folder.keep.options.days30')], ['90', t('sync.folder.keep.options.days90')], ['365', t('sync.folder.keep.options.year')], ['all', t('sync.folder.keep.options.all')]];
const autoSelect = (name, value, hint) => `<label class="settings-select">
    <span><strong>${t('sync.auto.title')}</strong><small>${esc(hint)}</small></span>
    <select name="${name}">${AUTO.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </label>`;

const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/** „Gleiche ab … 40 von 96 (42 %) · noch etwa 1 Min.“ */
function progressText(p) {
  // Was gerade geschieht: erst die Liste des Ordners, dann (einmalig) der Umzug, dann Datei für Datei
  const what = p?.what === 'lift' ? t('sync.progress.lift') : t('sync.progress.sync');
  if (!p?.n) return p?.what === 'list' ? t('sync.progress.list') : t('sync.progress.what', { what });
  const pct = Math.floor((p.i / p.n) * 100);
  const took = Date.now() - p.since;
  let rest = '';
  if (p.i >= 3 && took > 2000 && p.i < p.n) {
    const s = Math.round(((p.n - p.i) * took) / p.i / 1000);
    rest = s < 20 ? t('sync.progress.rest.soon') : s < 90 ? t('sync.progress.rest.seconds', { n: Math.round(s / 10) * 10 }) : t('sync.progress.rest.minutes', { n: Math.round(s / 60) });
  }
  return t('sync.progress.state', { what, i: p.i, n: p.n, pct, rest });
}
const progressBar = (p) => `<div class="sync-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p?.n ?? 0}" aria-valuenow="${p?.i ?? 0}">
    <i style="width:${p?.n ? Math.round((p.i / p.n) * 100) : 5}%"></i></div>`;

/* ── Ordner ───────────────────────────────────────────────────────────────── */

const TREE = `<details class="sync-tree"><summary>${t('sync.folder.tree.title')}</summary><pre>${t('sync.folder.tree.code')}</pre>
  <p class="settings-hint">${t('sync.folder.tree.hint')}</p></details>`;

/*
 * Knöpfe: Importieren liest einen Ordner einmal ein (App: Ordnerdialog,
 * Browser: Ordnerauswahl), eine ausgepackte ZIP mit wmap-sicherung.json ganz;
 * „ZIP einspielen“ nimmt den Export direkt. Exportieren gibt alles als ZIP.
 */
const importButton = () => (nativeHere
  ? `<button type="button" class="button" data-act="import" ${importing ? 'disabled' : ''}><span class="msr">drive_folder_upload</span> ${t('sync.folder.import')}</button>`
  : `<label class="button"><span class="msr">drive_folder_upload</span> ${t('sync.folder.import')}<input type="file" webkitdirectory multiple hidden data-file="folder"></label>`);
const exportButton = `<button type="button" class="button" data-act="backup"><span class="msr">folder_zip</span> ${t('sync.folder.export')}</button>`;
const zipLink = `<p class="settings-hint sync-zip">${t('sync.folder.restore.text')}
    <label class="sync-link">${t('sync.folder.restore.pick')}<input type="file" accept=".zip,.json,application/zip,application/json" hidden data-file="restore"></label></p>`;

/** „Unbekannte Dateien“: was keine Tour ist oder sich nicht lesen ließ – selbst nachsehen, nach 30 Tagen löscht WMap sie */
function brokenHtml(i) {
  const list = Object.entries(i.broken ?? {}).sort((a, b) => a[1] - b[1]);
  const reveal = i.native ? `<div class="sync-actions"><button type="button" class="button" data-act="reveal"><span class="msr">folder_open</span> ${t('sync.folder.broken.reveal')}</button></div>` : '';
  // Andere Dateien, die (noch) liegen bleiben
  const others = (i.others ?? []).map((p) => p.split('/').pop());
  const othersHtml = others.length ? `<div class="folder-others">${status('folder_delete', t('sync.folder.others.state', { n: others.length, files: esc(others.slice(0, 5).join(', ')), more: others.length > 5 ? ' …' : '' }), 'warn')}
    <div class="sync-actions"><button type="button" class="button" data-act="others"><span class="msr">drive_file_move</span> ${t('sync.folder.others.tidy')}</button></div></div>` : '';
  if (!list.length) return othersHtml;
  const until = new Date(list[0][1] + 30 * 24 * 3600 * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const names = list.map(([p]) => p.split('/').pop());
  return `${othersHtml}<div class="folder-broken">${status('report', t('sync.folder.broken.state', { n: list.length, files: esc(names.slice(0, 5).join(', ')), more: names.length > 5 ? ' …' : '', until }), 'warn')}
    ${reveal}</div>`;
}

async function folderHtml() {
  if (!folder.supported) {
    return `<section>
      <h3><span class="msr">folder</span> ${t('sync.folder.title')}</h3>
      ${status('folder_off', t('sync.folder.unsupported'), 'warn')}
      <div class="sync-actions">${importButton()}${exportButton}</div>
      ${zipLink}
      ${TREE}
    </section>`;
  }
  const i = await folder.info().catch((err) => ({ connected: false, error: { message: err.message } }));
  if (!i.connected) {
    return `<section>
      <h3><span class="msr">folder</span> ${t('sync.folder.title')}</h3>
      ${connecting ? status('sync', t('sync.folder.connecting'), 'busy')
        : importing ? status('sync', t('sync.folder.importing'), 'busy')
          : status('folder', t('sync.folder.none'))}
      ${i.error ? status('error', t('sync.error.message', { error: esc(i.error.message) }), 'error') : ''}
      <div class="sync-actions">
        <button type="button" class="button primary" data-act="connect" ${connecting ? 'disabled' : ''}><span class="msr">sync</span> ${t('sync.folder.connect')}</button>
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
  const shelf = { total: list.length, cards: list.filter((x) => x.stub).length };
  const p = folder.progress;
  return `<section>
    <h3><span class="msr">folder_open</span> ${t('sync.folder.title')}</h3>
    ${status('folder_open', t('sync.folder.connected', { name: esc(i.name) }))}
    ${busy ? `<div class="folder-progress">${status('sync', progressText(p), 'busy')}${progressBar(p)}</div>`
      : again ? status('folder_managed', t('sync.folder.permission'), 'warn')
        : i.pending ? status('sync_problem', t('sync.folder.pending'), 'warn')
          : status('schedule', i.last ? t('sync.last_with', { when: when(i.last), result: esc(syncSummary(i.result)) }) : t('sync.last', { when: when(i.last) }))}
    ${busy ? `<p class="settings-hint">${t('sync.folder.busy_hint')}</p>` : ''}
    ${i.error && !busy ? status('error', t('sync.folder.error_at', { when: when(i.error.at), error: esc(i.error.message) }), 'error') : ''}
    ${i.inbox.length && !busy ? `<div class="folder-inbox">${status('drive_folder_upload', t('sync.folder.inbox.state', { n: i.inbox.length, files: esc(i.inbox.slice(0, 3).map((x) => x.file).join(', ')), more: i.inbox.length > 3 ? ' …' : '' }), 'warn')}
      <div class="sync-actions"><button type="button" class="button primary" data-act="inbox"><span class="msr">checklist</span> ${t('sync.folder.inbox.view')}</button></div></div>` : ''}
    ${brokenHtml(i)}
    <div class="sync-actions">
      <button type="button" class="button${again ? ' primary' : ''}" data-act="sync" ${busy ? 'disabled' : ''}><span class="msr">sync</span> ${again ? t('sync.folder.allow_sync') : t('sync.folder.sync_now')}</button>
      <button type="button" class="button" data-act="change" ${busy ? 'disabled' : ''}><span class="msr">drive_file_move</span> ${t('sync.folder.change')}</button>
      ${exportButton}
      <button type="button" class="button" data-act="disconnect"><span class="msr">link_off</span> ${t('sync.folder.disconnect.button')}</button>
    </div>
    ${autoSelect('folder-auto', folder.auto, t('sync.folder.auto_hint'))}
    <label class="settings-select">
      <span><strong>${t('sync.folder.keep.title')}</strong><small>${t('sync.folder.keep.hint')}${shelf.cards ? t('sync.folder.keep.shelf', { cards: shelf.cards, total: shelf.total }) : ''}</small></span>
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
    : !st.read ? status('favorite', t('sync.health.not_granted'), 'warn')
      : status('check_circle', `${t('sync.health.granted.title')}${st.routes ? t('sync.health.granted.routes_always') : t('sync.health.granted.routes_ask')}${st.values ? t('sync.health.granted.values') : ''}`);
  const bar = busy ? progressBar(progress) : '';
  return `<section>
    <h3><span class="msr">favorite</span> Health Connect</h3>
    ${line}
    ${busy ? status('sync', progress?.n ? t('sync.health.taking', { i: progress.i, n: progress.n }) : t('sync.health.reading'), 'busy')
      : status('schedule', last?.at && !last.error ? t('sync.last_with', { when: when(last.at), result: `${last.added ? t('sync.health.imported', { n: last.added }) : t('sync.health.nothing_new')}${last.denied ? t('sync.health.denied', { n: last.denied }) : ''}` }) : t('sync.last', { when: when(last?.at) }))}
    ${last?.error && !busy ? status('error', t('sync.error.message', { error: esc(last.error) }), 'error') : ''}
    ${bar}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="health" ${busy || !st.available ? 'disabled' : ''}><span class="msr">${busy ? 'sync' : 'download'}</span> ${busy ? t('sync.health.fetching') : t('sync.health.fetch')}</button>
      <button type="button" class="button" data-act="perms"><span class="msr">verified_user</span> ${t('sync.health.permissions')}</button>
    </div>
    ${last?.denied && !busy ? status('info', t('sync.health.denied_hint')) : ''}
    ${autoSelect('health-auto', healthSync.auto, t('sync.health.auto_hint'))}
  </section>`;
}

/* ── Doppelte ─────────────────────────────────────────────────────────────── */

/** Welche Aufzeichnung je doppelter Tour bleibt und von welcher die Gesundheitsdaten kommen (IDs) – gemerkt, solange die Seite offen ist */
const dupKeep = new Set();
const dupVals = new Set();
const VALUE_NAME = { hr: t('sync.dups.values.hr'), cad: t('sync.dups.values.cad'), pow: t('sync.dups.values.pow') };

/** Woher eine Aufzeichnung kommt – „Health Connect · Zepp“, „GPX-Datei“, „Mit WMap aufgezeichnet“ */
const dupOrigin = (x) => (x.kind === 'health' ? (x.source?.app ? t('sync.dups.origin.health_app', { app: appName(x.source.app) }) : t('sync.dups.origin.health'))
  : x.kind === 'gpx' ? t('sync.dups.origin.gpx') : x.kind === 'nav' ? t('sync.dups.origin.nav') : t('sync.dups.origin.wmap'));
const dupPoints = (x) => (x.stub ? x.n : x.times?.length) || 0;
/** Strecke: Kilometer, Dauer, wie fein aufgezeichnet */
const dupFacts = (x) => [
  fmtDistance(x.length), fmtDuration((trackEnd(x) - x.start) / 1000),
  dupPoints(x) ? t('sync.dups.points', { count: dupPoints(x).toLocaleString(locale) }) : '',
].filter(Boolean).join(' · ');
/** Gesundheitsdaten: was gemessen wurde, beim Puls der Schnitt */
function dupValues(x) {
  const hr = (x.hr ?? []).filter((v) => v > 0);
  return valueKinds(x).map((k) => (k === 'hr' && hr.length ? t('sync.dups.values.hr_avg', { avg: Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) }) : VALUE_NAME[k])).join(' · ');
}
const dupDate = (x) => new Date(x.start).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function duplicatesHtml() {
  if (folder.busy || healthSyncing()) return '';
  const d = await findDuplicates().catch(() => null);
  if (!d?.count) return '';
  const what = [
    d.tracks.length ? t('sync.dups.recorded', { n: d.tracks.reduce((n, g) => n + g.length - 1, 0) }) : '',
    d.tours.length ? t('sync.dups.planned', { n: d.tours.reduce((n, g) => n + g.length - 1, 0) }) : '',
  ].filter(Boolean).join(t('sync.dups.and'));
  // Zu wählen gibt es nur bei zwei verschiedenen Aufzeichnungen (Uhr und Handy);
  // dieselbe Aufzeichnung zweimal (aus dem Ordner wieder eingelesen) braucht keine Frage
  const groups = d.tracks.map((g, i) => {
    if (g.every((x) => sameTrack(g[0], x))) return '';
    const keep = g.find((x) => dupKeep.has(x.id)) ?? g[0];
    // Gesundheitsdaten: zu wählen nur, wenn mehrere Aufzeichnungen welche haben
    const measured = g.filter((x) => valueKinds(x).length);
    const from = measured.find((x) => dupVals.has(x.id)) ?? (measured.includes(keep) ? keep : measured[0]);
    return `<fieldset class="dup-group">
      <legend>${esc(keep.name || t('sync.dups.no_name'))} <small>${esc(dupDate(keep))}</small></legend>
      <p class="dup-q"><span class="msr">route</span> ${t('sync.dups.route_from')}</p>
      ${g.map((x) => `<label class="dup-option">
        <input type="radio" name="dup-${i}" value="${esc(x.id)}" ${x === keep ? 'checked' : ''}>
        <span><strong>${esc(dupOrigin(x))}</strong><small>${esc(dupFacts(x))}</small></span>
      </label>`).join('')}
      ${measured.length > 1 ? `<p class="dup-q"><span class="msr">monitor_heart</span> ${t('sync.dups.values_from')}</p>
      ${measured.map((x) => `<label class="dup-option dup-values">
        <input type="radio" name="dupv-${i}" value="${esc(x.id)}" ${x === from ? 'checked' : ''}>
        <span><strong>${esc(dupOrigin(x))}</strong><small>${esc(dupValues(x))}</small></span>
      </label>`).join('')}`
    : measured.length ? `<p class="dup-q dup-one"><span class="msr">monitor_heart</span> ${t('sync.dups.values_one', { origin: esc(dupOrigin(measured[0])), values: esc(dupValues(measured[0])) })}</p>` : ''}
    </fieldset>`;
  }).join('');
  return `<section class="sync-dups" id="doppelt">
    <h3><span class="msr">content_copy</span> ${t('sync.dups.title')}</h3>
    ${status('content_copy', t('sync.dups.state', { what, n: d.count }), 'warn')}
    ${groups ? `<p class="settings-hint">${t('sync.dups.hint')}</p>
    <div class="dup-list">${groups}</div>` : ''}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="dedupe"><span class="msr">merge</span> ${t('sync.dups.merge.button')}</button>
    </div>
  </section>`;
}

let painting = null;
async function render() {
  // Mehrere Anlässe kurz nacheinander: einmal zeichnen
  painting ??= (async () => {
    await null;
    root.innerHTML = `${await folderHtml()}${await healthHtml()}${await duplicatesHtml()}
      <p class="settings-hint sync-note"><span class="msr">lock</span> ${t('sync.note')}</p>`;
  })().finally(() => { painting = null; });
  return painting;
}

const importText = (r) => (r.imported ? `${t('sync.import.taken', { n: r.imported })}${r.skipped ? t('sync.import.skipped', { n: r.skipped }) : ''}` : r.skipped ? t('sync.import.all_there') : t('sync.import.none'));

/* ── Knöpfe ───────────────────────────────────────────────────────────────── */

root.addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'connect' || act === 'change') {
    if (act === 'change') {
      const v = await ask({ icon: 'drive_file_move', title: t('sync.folder.change_ask.title'), text: t('sync.folder.change_ask.text'),
        buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('sync.folder.change_ask.button'), primary: true }] });
      if (v !== 'yes') return;
    }
    connecting = true; render();
    try {
      const r = await folder.connect();
      if (r?.needsPermission) toast(t('sync.toast.no_permission'));
      else if (r) toast(t('sync.toast.connected', { result: syncSummary(r) }));
    } catch (err) { if (err.name !== 'AbortError') toast(t('sync.toast.connect_failed', { error: err.message })); }
    connecting = false; render();
  }
  if (act === 'inbox') { offerInbox((await folder.info()).inbox, true); return; }
  if (act === 'others') { offerOthers((await folder.info()).others, true); return; }
  if (act === 'reveal') {
    folder.reveal('Unbekannte Dateien').catch(() => toast(t('sync.toast.reveal_failed')));
    return;
  }
  if (act === 'sync') {
    try {
      const r = await folder.sync({ interactive: true });
      if (r?.needsPermission) toast(t('sync.toast.no_permission'));
      else if (r) toast(t('sync.toast.synced', { result: syncSummary(r) }));
    } catch (err) { toast(t('sync.toast.sync_failed', { error: err.message })); }
    render();
  }
  if (act === 'disconnect') {
    const v = await ask({ icon: 'link_off', title: t('sync.folder.disconnect.title'), text: t('sync.folder.disconnect.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('sync.folder.disconnect.button'), primary: true }] });
    if (v !== 'yes') return;
    await folder.disconnect();
    toast(t('sync.folder.disconnect.done'));
    render();
  }
  if (act === 'import') {
    importing = true; render();
    try { toast(importText(await importFolder())); } catch (err) { if (err.name !== 'AbortError') toast(t('sync.toast.import_failed', { error: err.message })); }
    importing = false; render();
  }
  if (act === 'health') {
    progress = null;
    const p = syncHealth({ onProgress: (i, n) => { progress = { i, n }; render(); } });
    render();
    try {
      const r = await p;
      toast(r.added ? t('sync.health.toast_added', { n: r.added }) : t('sync.health.toast_nothing'));
    } catch (err) { toast(String(err?.message ?? err)); }
    progress = null;
    render();
  }
  if (act === 'perms') { await showPermissions({ reason: 'health' }); render(); }
  if (act === 'dedupe') {
    const d = await findDuplicates();
    const v = await ask({ icon: 'merge', title: t('sync.dups.merge.title', { n: d.count }),
      text: t('sync.dups.merge.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('sync.dups.merge.button'), primary: true }] });
    if (v !== 'yes') return;
    const picked = (sel) => [...root.querySelectorAll(`${sel} input:checked`)].map((el) => el.value);
    const n = await removeDuplicates(picked('.dup-option:not(.dup-values)'), picked('.dup-values'));
    dupKeep.clear();
    dupVals.clear();
    toast(t('sync.dups.merge.done', { n }));
    render();
  }
  if (act === 'backup') {
    const format = await ask({
      icon: 'folder_zip', title: t('sync.export.title'), className: 'stacked',
      text: t('sync.export.text'),
      buttons: [
        { value: 'gpx', label: t('sync.export.gpx'), icon: 'draft', primary: true },
        { value: 'fit', label: t('sync.export.fit'), icon: 'watch' },
        { value: 'no', label: t('common.cancel') },
      ],
    });
    if (format !== 'gpx' && format !== 'fit') return;
    zipBackup({ format }).then((blob) => download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}${format === 'fit' ? '-fit' : ''}.zip`, blob, 'application/zip'))
      .catch((err) => toast(t('sync.toast.backup_failed', { error: err.message })));
  }
});

root.addEventListener('change', async (e) => {
  const target = e.target;
  if (target.closest('.dup-option')) {
    // Wahl merken – die Seite zeichnet sich bei jedem Abgleich neu
    const set = target.closest('.dup-values') ? dupVals : dupKeep;
    for (const el of target.closest('.dup-group').querySelectorAll(`input[name="${target.name}"]`)) set.delete(el.value);
    set.add(target.value);
    return;
  }
  if (target.name === 'folder-keep') {
    folder.keep = target.value;
    toast(target.value === 'all' ? t('sync.folder.keep.toast_all') : t('sync.folder.keep.toast', { span: Object.fromEntries(KEEP)[target.value].toLowerCase() }));
    folder.sync().catch(() => {}).finally(render);
    return;
  }
  const label = Object.fromEntries(AUTO)[target.value];
  if (target.name === 'folder-auto') { folder.auto = target.value; toast(t('sync.toast.auto_folder', { label })); }
  if (target.name === 'health-auto') {
    healthSync.auto = target.value;
    toast(t('sync.toast.auto_health', { label }));
    if (target.value !== 'off' && !healthSyncing()) syncHealth({ quiet: true }).catch(() => {}).finally(render);
    render();
  }
  const inp = target.closest('[data-file]');
  if (!inp) return;
  // Leerer Ordner: der Browser meldet dann gar keine Dateien – trotzdem Bescheid geben
  if (!inp.files?.length) { toast(inp.dataset.file === 'folder' ? t('sync.toast.folder_empty') : t('sync.toast.no_file')); return; }
  try {
    if (inp.dataset.file === 'folder') {
      toast(importText(await importFolder(inp.files)));
    } else {
      const f = inp.files[0];
      const n = /\.zip$/i.test(f.name) || f.type === 'application/zip' ? await restoreZip(f) : await restore(await f.text());
      toast(t('sync.toast.restored', { n }));
    }
  } catch (err) { toast(err.message); }
  inp.value = '';
});
// Ordnerwahl abgebrochen oder leer (manche Browser melden dann kein „change“)
root.addEventListener('cancel', (e) => { if (e.target.matches?.('[data-file="folder"]')) toast(t('sync.toast.no_folder')); }, true);

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
    folder.sync().then((r) => { if (r) toast(t('sync.toast.connected', { result: syncSummary(r) })); }).catch((err) => toast(t('sync.toast.sync_failed', { error: err.message })));
  }
}
addEventListener('wmap:health', () => render());
// Aus den Einstellungen von Android bzw. Health Connect zurück: Stand neu
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); firstSync(); } });

mountAppBar();
await render();
firstSync();
autoSync();
