/**
 * GPX und FIT öffnen (import.html). Die Dateien kommen
 *
 *   App (Android, Rechner)   über „Öffnen mit“, „Teilen“ bzw. Doppelklick –
 *                            das Plugin „folder“ hält sie bereit (opened);
 *                            core/theme.js schickt beim Start hierher
 *   installierte Web-App     Dateizuordnung (manifest file_handlers →
 *                            launchQueue) bzw. Teilen-Menü am Handy
 *                            (share_target → sw.js legt sie in „wmap-share“)
 *   sonst                    über die Dateiauswahl hier
 *
 * Eine einzelne geöffnete Datei wird gleich gezeigt (preview): mit Zeiten als
 * Aufzeichnung in „Meine Touren“ (wege.html#datei – dort „Als aufgezeichnete
 * Tour speichern“ oder „Als geplante Tour öffnen“), sonst im Planer.
 *
 * Je Datei:
 *   Als aufgezeichnete Tour  vorher auf Doppelte prüfen (WMap-ID bzw. gleicher
 *   speichern                Weg), dann speichern und gleich zeigen – geht nur
 *                            mit Zeiten in der Datei
 *   Gibt es schon            zusammenführen – mit Haken, was aus der Datei
 *                            kommt (ui/merge-ask.js)
 *   Als geplante Tour öffnen nur öffnen (tour.html#t=…, wie eine geteilte
 *                            Tour) – gespeichert wird erst mit Speichern dort
 *
 * Bei mehreren Dateien kommt gleich die Frage für alle (ui/import-ask.js: die
 * genaueren Daten überall / selbst einstellen / abbrechen); oben steht die
 * Übersicht, von dort geht es später weiter.
 */
import { mountAppBar } from '../ui/appbar.js';
import { toast } from '../ui/dialogs.js';
import { esc, fmtDistance } from '../core/geo.js';
import { imperial } from '../core/units.js';
import { cadName } from '../data/track-look.js';
import { encodeShare } from '../data/store.js';
import { readFiles, takeFile, fileOf } from '../data/import-files.js';
import { importAsk, importSummary } from '../ui/import-ask.js';
import { locale, t } from '../core/i18n.js';

const root = document.querySelector('.import');
const SHARE = 'wmap-share';
const DAY = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const km = (m) => (imperial() ? fmtDistance(m) : t('import.unit.km', { v: (m / 1000).toLocaleString(locale, { maximumFractionDigits: m < 10000 ? 1 : 0 }) }));

/** [{ name, text, tour, track, id, dup, gain, saved, merged, note, error }] */
const files = [];
let busy = null;   // { i, n } während alle übernommen werden
const valueName = (track, k) => ({ hr: t('import.values.hr'), cad: cadName(track), pow: t('import.values.pow') }[k]);
const open = () => files.filter((f) => !f.error && f.track && !f.saved && !f.merged && (!f.dup || f.gain?.any));

/** Neue Dateien ({ name, text } – FIT: { name, bytes }) aufnehmen und prüfen; mehrere: gleich fragen */
export async function addFiles(list, ask = list.length > 1) {
  files.push(...await readFiles(list));
  render();
  if (ask && open().length) await takeAll();
}

/** Alle offenen übernehmen – mit der Frage für alle (ui/import-ask.js) */
async function takeAll() {
  if (busy) return;
  busy = { i: 0, n: open().length };
  let out = null;
  try {
    out = await importAsk(files, { step: (i, n) => { busy = { i, n }; if (i % 5 === 1) render(); } });
  } finally { busy = null; }
  if (out) toast(importSummary(out));
  render();
}

function card(f, i) {
  if (f.error) {
    return `<section><h3><span class="msr">error</span> ${esc(f.name)}</h3>
      <p class="sync-status error"><span class="msr">error</span><span>${t('import.card.error', { error: esc(f.error) })}</span></p></section>`;
  }
  const facts = [km(f.tour.stats.length), f.track ? DAY.format(f.track.start) : t('import.card.no_times')].join(' · ');
  const g = f.dup && !f.merged ? f.gain : null;
  const recorded = f.saved
    ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.saved)}"><span class="msr">visibility</span> ${t('import.card.saved')}</a>`
    : f.merged
      ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">visibility</span> ${t('import.card.merged')}</a>`
      : g?.any
        ? `<button type="button" class="button primary" data-act="merge" data-i="${i}"><span class="msr">merge</span> ${t('import.card.merge')}</button>`
        : f.dup
          ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">content_copy</span> ${t('import.card.exists')}</a>`
          : f.track ? `<button type="button" class="button primary" data-act="track" data-i="${i}"><span class="msr">directions_walk</span> ${t('import.card.save_track')}</button>` : '';
  return `<section>
    <h3><span class="msr">route</span> ${esc(f.tour.name)}</h3>
    <p class="settings-hint">${esc(facts)} · ${esc(f.name)}</p>
    ${!f.track ? `<p class="settings-hint">${t('import.card.plan_only')}</p>` : ''}
    ${f.dup && !f.saved ? `<p class="settings-hint">${t('import.card.dup.known', { name: esc(f.dup.name) })}${g?.any ? ` ${esc(more(f))}` : f.merged ? '' : f.kept ? ` ${t('import.card.dup.kept')}` : ` ${t('import.card.dup.nothing')}`}</p>` : ''}
    ${f.note ? `<p class="sync-status error"><span class="msr">error</span><span>${esc(f.note)}</span></p>` : ''}
    <div class="sync-actions">
      ${f.track && !f.saved && !f.merged ? `<button type="button" class="button" data-act="view" data-i="${i}"><span class="msr">visibility</span> ${t('import.card.view')}</button>` : ''}
      ${recorded}
      <button type="button" class="button${f.track ? '' : ' primary'}" data-act="tour" data-i="${i}"><span class="msr">edit_road</span> ${t('import.card.open_plan')}</button>
    </div>
  </section>`;
}

/** Was die Datei mehr oder anders hat als der Weg hier – in Worten */
function more(f) {
  const g = f.gain, out = [];
  if (g.add.length) out.push(t('import.more.missing', { values: g.add.map((k) => valueName(f.dup, k)).join(', ') }));
  if (g.marks) out.push(t('import.more.marks'));
  if (g.points[1] > g.points[0]) out.push(t('import.more.points', { file: g.points[1], here: g.points[0] }));
  if (g.differ.length) out.push(t('import.more.differ', { values: g.differ.map((k) => valueName(f.dup, k)).join(', ') }));
  return out.length ? t('import.more.has', { list: out.join(' · ') }) : t('import.more.differs');
}

/** Übersicht über alle Dateien und „Übernehmen …“ */
function summary() {
  const ok = files.filter((f) => !f.error && f.track);
  const fresh = ok.filter((f) => !f.dup && !f.saved), plus = ok.filter((f) => f.dup && f.gain?.any && !f.merged);
  const same = ok.filter((f) => f.dup && !f.gain?.any && !f.merged), did = ok.filter((f) => f.saved || f.merged);
  const bad = files.filter((f) => f.error).length, plain = files.filter((f) => !f.error && !f.track).length;
  const line = [
    fresh.length && t('import.summary.fresh', { n: fresh.length }), plus.length && t('import.summary.plus', { n: plus.length }),
    same.length && t('import.summary.same', { n: same.length }), did.length && t('import.summary.done', { n: did.length }),
    plain && t('import.summary.plain', { n: plain }), bad && t('import.summary.bad', { n: bad }),
  ].filter(Boolean).join(' · ');
  const todo = fresh.length + plus.length;
  return `<section class="import-all">
    <h3><span class="msr">library_add</span> ${t('import.summary.title', { n: files.length })}</h3>
    <p class="settings-hint">${esc(line)}</p>
    <div class="sync-actions">
      ${busy ? `<p class="settings-hint">${busy.i ? t('import.summary.taking', { i: busy.i, n: busy.n }) : t('import.summary.waiting')}</p>`
    : todo ? `<button type="button" class="button primary" data-act="all"><span class="msr">done_all</span> ${t('import.summary.take', { n: todo })}</button>` : ''}
    </div>
  </section>`;
}

/** Ansehen, bevor etwas gespeichert wird: mit Zeiten wie eine Aufzeichnung (wege.html#datei), sonst im Planer */
async function preview(f, replace = false) {
  let url;
  if (f.track) {
    sessionStorage.setItem('wmap.import', JSON.stringify({ ...f.track, id: f.id ?? f.track.id }));
    url = './wege.html#datei';
  } else url = `./tour.html#t=${await encodeShare(f.tour)}`;
  if (replace) location.replace(url); else location.href = url;
}

function render() {
  root.innerHTML = `${files.length > 1 ? summary() : ''}${files.length ? files.map(card).join('') : `<section>
      <h3><span class="msr">upload_file</span> ${t('import.empty.title')}</h3>
      <p class="settings-hint">${t('import.empty.text')}</p>
    </section>`}
    <section>
      <div class="sync-actions">
        <label class="button"><span class="msr">folder_open</span> ${files.length ? t('import.pick.more') : t('import.pick.first')}<input type="file" accept=".gpx,.fit,application/gpx+xml" multiple hidden data-file="gpx"></label>
      </div>
    </section>`;
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || busy) return;
  const f = files[Number(b.dataset.i)];
  if (!f && b.dataset.act !== 'all') return;
  if (b.dataset.act === 'all') { await takeAll(); return; }
  if (b.dataset.act === 'view') { await preview(f); return; }
  if (b.dataset.act === 'track' || b.dataset.act === 'merge') {
    let did;
    if (b.dataset.act === 'merge') {
      // Eine Datei: gleich die Haken (ui/import-ask.js)
      const out = await importAsk([f]);
      if (!out || out.later) return;   // abgebrochen bzw. später: nichts passiert
      did = out.merged > 0;
    } else did = await takeFile(f);
    if (!did && !f.note) toast(f.kept ? t('import.toast.kept') : f.dup ? t('import.toast.exists') : t('import.toast.nothing'));
    if (did && f.saved && files.length === 1) { location.href = `./wege.html?id=${encodeURIComponent(f.saved)}`; return; }
    if (did) toast(f.saved ? t('import.toast.saved', { name: f.track.name }) : t('import.toast.merged', { name: f.dup.name }));
    render();
  }
  if (b.dataset.act === 'tour') {
    // Wie eine geteilte Tour: ansehen, gespeichert wird erst dort
    location.href = `./tour.html#t=${await encodeShare(f.tour)}`;
  }
});

root.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-file="gpx"]');
  if (!inp?.files?.length) return;
  await addFiles(await Promise.all([...inp.files].map(fileOf)));
});

/* ── Woher die Dateien kommen ─────────────────────────────────────────────── */

async function incoming() {
  const got = [];
  // App: „Öffnen mit“, „Teilen“, Doppelklick
  const core = window.__TAURI__?.core;
  if (core) {
    const r = await core.invoke('plugin:folder|opened', { peek: false }).catch(() => null);
    // FIT kommt in Base64 (`data`)
    got.push(...(r?.files ?? []).map((f) => (f.data ? { name: f.name, bytes: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)).buffer } : f)));
  }
  // Web-App: Teilen-Menü (sw.js hat die Dateien abgelegt)
  if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
    try {
      const cache = await caches.open(SHARE);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        got.push(await fileOf(res, decodeURIComponent(res.headers.get('X-Name') ?? t('import.default_file'))));
      }
      await caches.delete(SHARE);
    } catch { /* dann eben über die Auswahl */ }
    history.replaceState(null, '', './import.html');
  }
  return got;
}

// Web-App: Dateizuordnung (auch später, wenn das Fenster schon offen ist)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (p) => {
    const list = await Promise.all((p.files ?? []).map(async (h) => fileOf(await h.getFile())));
    if (list.length) await addFiles(list);
    if (list.length === 1 && files.length === 1 && !files[0].error) preview(files[0], true);
  });
}

mountAppBar();
render();
const first = await incoming();
if (first.length) await addFiles(first);
// Eine Datei geöffnet („Öffnen mit“, „Teilen“): erst ansehen – gespeichert wird dort auf Wunsch
if (first.length === 1 && files.length === 1 && !files[0].error) preview(files[0], true);
