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
import { esc } from '../core/geo.js';
import { cadName } from '../data/track-look.js';
import { encodeShare } from '../data/store.js';
import { readFiles, takeFile, fileOf } from '../data/import-files.js';
import { importAsk, importSummary } from '../ui/import-ask.js';

const root = document.querySelector('.import');
const SHARE = 'wmap-share';
const DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const km = (m) => `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

/** [{ name, text, tour, track, id, dup, gain, saved, merged, note, error }] */
const files = [];
let busy = null;   // { i, n } während alle übernommen werden
const valueName = (t, k) => ({ hr: 'Puls', cad: cadName(t), pow: 'Leistung' }[k]);
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
      <p class="sync-status error"><span class="msr">error</span><span>Lässt sich nicht öffnen: ${esc(f.error)}</span></p></section>`;
  }
  const facts = [km(f.tour.stats.length), f.track ? DAY.format(f.track.start) : 'ohne Zeiten'].join(' · ');
  const g = f.dup && !f.merged ? f.gain : null;
  const recorded = f.saved
    ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.saved)}"><span class="msr">visibility</span> Gespeichert – ansehen</a>`
    : f.merged
      ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">visibility</span> Ergänzt – ansehen</a>`
      : g?.any
        ? `<button type="button" class="button primary" data-act="merge" data-i="${i}"><span class="msr">merge</span> Mit der vorhandenen Tour zusammenführen …</button>`
        : f.dup
          ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">content_copy</span> Gibt es schon – ansehen</a>`
          : f.track ? `<button type="button" class="button primary" data-act="track" data-i="${i}"><span class="msr">directions_walk</span> Als aufgezeichnete Tour speichern</button>` : '';
  return `<section>
    <h3><span class="msr">route</span> ${esc(f.tour.name)}</h3>
    <p class="settings-hint">${esc(facts)} · ${esc(f.name)}</p>
    ${!f.track ? '<p class="settings-hint">Ohne Zeiten in der Datei geht sie nur als geplante Tour.</p>' : ''}
    ${f.dup && !f.saved ? `<p class="settings-hint">Diesen Weg hast du schon: „${esc(f.dup.name)}“.${g?.any ? ` ${esc(more(f))}` : f.merged ? '' : f.kept ? ' Nichts übernommen – die vorhandenen Werte bleiben.' : ' Die Datei hat nichts, was hier fehlt.'}</p>` : ''}
    ${f.note ? `<p class="sync-status error"><span class="msr">error</span><span>${esc(f.note)}</span></p>` : ''}
    <div class="sync-actions">
      ${f.track && !f.saved && !f.merged ? `<button type="button" class="button" data-act="view" data-i="${i}"><span class="msr">visibility</span> Ansehen</button>` : ''}
      ${recorded}
      <button type="button" class="button${f.track ? '' : ' primary'}" data-act="tour" data-i="${i}"><span class="msr">edit_road</span> Als geplante Tour öffnen</button>
    </div>
  </section>`;
}

/** Was die Datei mehr oder anders hat als der Weg hier – in Worten */
function more(f) {
  const g = f.gain, out = [];
  if (g.add.length) out.push(`${g.add.map((k) => valueName(f.dup, k)).join(', ')} (fehlt hier)`);
  if (g.marks) out.push('Runden der Uhr (fehlen hier)');
  if (g.points[1] > g.points[0]) out.push(`genauere Strecke (${g.points[1]} statt ${g.points[0]} Punkte)`);
  if (g.differ.length) out.push(`${g.differ.map((k) => valueName(f.dup, k)).join(', ')} weicht ab`);
  return out.length ? `Die Datei hat mehr: ${out.join(' · ')}.` : 'Die Datei weicht ab.';
}

/** Übersicht über alle Dateien und „Übernehmen …“ */
function summary() {
  const ok = files.filter((f) => !f.error && f.track);
  const fresh = ok.filter((f) => !f.dup && !f.saved), plus = ok.filter((f) => f.dup && f.gain?.any && !f.merged);
  const same = ok.filter((f) => f.dup && !f.gain?.any && !f.merged), did = ok.filter((f) => f.saved || f.merged);
  const bad = files.filter((f) => f.error).length, plain = files.filter((f) => !f.error && !f.track).length;
  const line = [
    fresh.length && `${fresh.length} neu`, plus.length && `${plus.length} zu einer Tour, die es schon gibt`,
    same.length && `${same.length} gibt es schon`, did.length && `${did.length} übernommen`,
    plain && `${plain} ohne Zeiten (nur als geplante Tour)`, bad && `${bad} nicht lesbar`,
  ].filter(Boolean).join(' · ');
  const todo = fresh.length + plus.length;
  return `<section class="import-all">
    <h3><span class="msr">library_add</span> ${files.length} Dateien</h3>
    <p class="settings-hint">${esc(line)}</p>
    <div class="sync-actions">
      ${busy ? `<p class="settings-hint">${busy.i ? `Übernehme ${busy.i} von ${busy.n} …` : 'Warte auf deine Antwort …'}</p>`
    : todo ? `<button type="button" class="button primary" data-act="all"><span class="msr">done_all</span> ${todo === 1 ? 'Eine Datei' : `Alle ${todo}`} übernehmen …</button>` : ''}
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
      <h3><span class="msr">upload_file</span> GPX- oder FIT-Datei öffnen</h3>
      <p class="settings-hint">Wähle eine GPX- oder FIT-Datei – z. B. von Garmin, Zepp, Komoot oder einer anderen App. Mit Zeiten kannst du sie als aufgezeichnete Tour speichern, sonst als geplante Tour öffnen.</p>
    </section>`}
    <section>
      <div class="sync-actions">
        <label class="button"><span class="msr">folder_open</span> ${files.length ? 'Weitere Datei wählen' : 'Datei wählen'}<input type="file" accept=".gpx,.fit,application/gpx+xml" multiple hidden data-file="gpx"></label>
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
    if (!did && !f.note) toast(f.kept ? 'Nichts übernommen – die vorhandenen Werte bleiben' : f.dup ? 'Diesen Weg gibt es schon' : 'Nichts zu übernehmen');
    if (did && f.saved && files.length === 1) { location.href = `./wege.html?id=${encodeURIComponent(f.saved)}`; return; }
    if (did) toast(f.saved ? `„${f.track.name}“ gespeichert` : `„${f.dup.name}“ ergänzt`);
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
        got.push(await fileOf(res, decodeURIComponent(res.headers.get('X-Name') ?? 'Datei.gpx')));
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
