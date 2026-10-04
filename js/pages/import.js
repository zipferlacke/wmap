/**
 * GPX öffnen (import.html). Die Dateien kommen
 *
 *   App (Android, Rechner)   über „Öffnen mit“, „Teilen“ bzw. Doppelklick –
 *                            das Plugin „folder“ hält sie bereit (opened);
 *                            core/theme.js schickt beim Start hierher
 *   installierte Web-App     Dateizuordnung (manifest file_handlers →
 *                            launchQueue) bzw. Teilen-Menü am Handy
 *                            (share_target → sw.js legt sie in „wmap-share“)
 *   sonst                    über die Dateiauswahl hier
 *
 * Je Datei:
 *   Als aufgezeichnete Tour  vorher auf Doppelte prüfen (WMap-ID bzw. gleicher
 *   speichern                Weg), dann speichern und gleich zeigen – geht nur
 *                            mit Zeiten in der Datei
 *   Gibt es schon            hat die Datei mehr als der Weg hier, ergänzt sie
 *                            ihn (data/duplicates.js gain/enrich): Fehlende
 *                            Messwerte kommen ohne Rückfrage dazu. Nicht
 *                            eindeutig sind eine genauere Strecke und
 *                            abweichende Messwerte – dafür stehen oben zwei
 *                            Fragen, die für alle Dateien gelten
 *
 * Bei mehreren Dateien: oben die Übersicht und „Alle übernehmen“.
 *   Als geplante Tour öffnen nur öffnen (tour.html#t=…, wie eine geteilte
 *                            Tour) – gespeichert wird erst mit Speichern dort
 */
import { mountAppBar } from '../ui/appbar.js';
import { toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { tracks, parseGpx, sameTrack, bulk } from '../data/tracks.js';
import { gain, enrich } from '../data/duplicates.js';
import { cadName } from '../data/track-look.js';
import { devLog } from '../core/devlog.js';
import { encodeShare } from '../data/store.js';
import { tourFromGpx } from '../data/folder.js';

const root = document.querySelector('.import');
const SHARE = 'wmap-share';
const TIMED = /<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/;
const DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const km = (m) => `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

/** [{ name, text, tour, track, id, dup, gain, saved, merged, note, error }] */
const files = [];
/** Antworten auf die beiden Fragen – gelten für alle Dateien */
const opt = { shape: true, values: false };
let busy = null;   // { i, n } während „Alle übernehmen“
const valueName = (t, k) => ({ hr: 'Puls', cad: cadName(t), pow: 'Leistung' }[k]);

/** Neue Dateien ({ name, text }) aufnehmen und prüfen */
export async function addFiles(list) {
  const t0 = performance.now();
  devLog(`GPX öffnen: ${list.length} Datei(en)`);
  const all = await tracks.all();
  for (const { name, text } of list) {
    const f = { name: name || 'Datei.gpx', text };
    try {
      f.tour = tourFromGpx(text, f.name);
      if (!f.tour) throw new Error('Keine Strecke in der Datei');
      if (TIMED.test(text)) {
        f.track = parseGpx(text)[0] ?? null;
        // Aus WMap exportiert: die ID steht im Stichwort wmap:…
        f.id = text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? f.track?.id;
        f.dup = f.track ? all.find((t) => t.id === f.id || sameTrack(t, f.track)) ?? null : null;
        if (f.dup) f.gain = gain(f.dup, f.track);
      }
    } catch (err) { f.error = err.message; }
    devLog('  ', f.name, f.error ? `nicht lesbar: ${f.error}` : !f.track ? 'ohne Zeiten' : !f.dup ? 'neu' : f.gain.any ? `ergänzt „${f.dup.name}“: ${more(f)}` : `gibt es schon („${f.dup.name}“), nichts Neues`,
      f.dup ? `· hier ${f.dup.stub ? 'Karteikarte' : 'ganz'}, Messwerte hier [${(f.dup.stub ? f.dup.has ?? [] : ['hr', 'cad', 'pow'].filter((k) => f.dup[k]?.some((v) => v > 0))).join(',')}], Datei [${['hr', 'cad', 'pow'].filter((k) => f.track?.[k]?.some((v) => v > 0)).join(',')}], Punkte ${f.gain.points.join(' / ')}` : '');
    files.push(f);
  }
  devLog(`GPX öffnen: geprüft in ${Math.round(performance.now() - t0)} ms`);
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
        ? `<button type="button" class="button primary" data-act="merge" data-i="${i}"><span class="msr">merge</span> In die vorhandene Tour übernehmen</button>`
        : f.dup
          ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">content_copy</span> Gibt es schon – ansehen</a>`
          : f.track ? `<button type="button" class="button primary" data-act="track" data-i="${i}"><span class="msr">directions_walk</span> Als aufgezeichnete Tour speichern</button>` : '';
  return `<section>
    <h3><span class="msr">route</span> ${esc(f.tour.name)}</h3>
    <p class="settings-hint">${esc(facts)} · ${esc(f.name)}</p>
    ${!f.track ? '<p class="settings-hint">Ohne Zeiten in der Datei geht sie nur als geplante Tour.</p>' : ''}
    ${f.dup && !f.saved ? `<p class="settings-hint">Diesen Weg hast du schon: „${esc(f.dup.name)}“.${g?.any ? ` Die Datei hat mehr: ${esc(more(f))}.` : f.merged ? '' : f.kept ? ' Nichts übernommen – die vorhandenen Werte bleiben.' : ' Die Datei hat nichts, was hier fehlt.'}</p>` : ''}
    ${f.note ? `<p class="sync-status error"><span class="msr">error</span><span>${esc(f.note)}</span></p>` : ''}
    <div class="sync-actions">
      ${recorded}
      <button type="button" class="button${f.track ? '' : ' primary'}" data-act="tour" data-i="${i}"><span class="msr">edit_road</span> Als geplante Tour öffnen</button>
    </div>
  </section>`;
}

/** Was die Datei mehr hat als der Weg hier – in Worten */
function more(f) {
  const g = f.gain, out = [];
  if (g.add.length) out.push(`${g.add.map((k) => valueName(f.dup, k)).join(', ')} (fehlt hier)`);
  if (g.shape) out.push(`genauere Strecke (${g.points[1]} statt ${g.points[0]} Punkte)`);
  if (g.differ.length) out.push(`${g.differ.map((k) => valueName(f.dup, k)).join(', ')} weicht ab`);
  return out.join(' · ');
}

/** Übersicht über alle Dateien, die beiden Fragen und „Alle übernehmen“ */
function summary() {
  const ok = files.filter((f) => !f.error && f.track);
  const fresh = ok.filter((f) => !f.dup && !f.saved), plus = ok.filter((f) => f.dup && f.gain?.any && !f.merged);
  const same = ok.filter((f) => f.dup && !f.gain?.any && !f.merged), did = ok.filter((f) => f.saved || f.merged);
  const bad = files.filter((f) => f.error).length, plain = files.filter((f) => !f.error && !f.track).length;
  const line = [
    fresh.length && `${fresh.length} neu`, plus.length && `${plus.length} ergänzen eine vorhandene Tour`,
    same.length && `${same.length} gibt es schon`, did.length && `${did.length} übernommen`,
    plain && `${plain} ohne Zeiten (nur als geplante Tour)`, bad && `${bad} nicht lesbar`,
  ].filter(Boolean).join(' · ');
  const todo = fresh.length + plus.length;
  const askShape = plus.some((f) => f.gain.shape), askValues = plus.some((f) => f.gain.differ.length);
  return `<section class="import-all">
    <h3><span class="msr">library_add</span> ${files.length} Dateien</h3>
    <p class="settings-hint">${esc(line)}</p>
    ${plus.length ? '<p class="settings-hint">Messwerte, die einer vorhandenen Tour fehlen, kommen dazu. Name, Art und Farbe der Tour bleiben.</p>' : ''}
    ${askShape ? `<label class="settings-toggle"><span><strong>Genauere Strecke aus der Datei nehmen</strong><small>Hat die Datei deutlich mehr Punkte, gelten ihre Strecke, Zeit und Kilometer</small></span>
      <input type="checkbox" data-opt="shape" data-shape="toggle" ${opt.shape ? 'checked' : ''}></label>` : ''}
    ${askValues ? `<label class="settings-toggle"><span><strong>Abweichende Messwerte aus der Datei nehmen</strong><small>Sonst bleiben Puls, Frequenz und Leistung der vorhandenen Tour</small></span>
      <input type="checkbox" data-opt="values" data-shape="toggle" ${opt.values ? 'checked' : ''}></label>` : ''}
    <div class="sync-actions">
      ${busy ? `<p class="settings-hint">Übernehme ${busy.i} von ${busy.n} …</p>`
    : todo ? `<button type="button" class="button primary" data-act="all"><span class="msr">done_all</span> Alle ${todo} übernehmen</button>` : ''}
    </div>
  </section>`;
}

/** Eine Datei übernehmen: neu speichern oder die vorhandene Tour ergänzen → hat sich etwas getan? */
async function take(f) {
  if (f.error || !f.track || f.saved || f.merged) return false;
  // Kurz vorher noch einmal: vielleicht kam der Weg inzwischen über den Ordner
  const dup = (await tracks.all()).find((t) => t.id === f.id || sameTrack(t, f.track)) ?? null;
  if (!dup) {
    const t = { ...f.track, id: f.id ?? f.track.id, updated: Date.now() };
    await tracks.put(t);
    f.saved = t.id;
    return true;
  }
  f.dup = dup;
  f.gain = gain(dup, f.track);
  if (!f.gain.any) return false;
  let full;
  // Liegt die Tour nur im Ordner (Karteikarte): erst ganz holen
  try { full = await tracks.full(dup); } catch (err) { f.note = `Die vorhandene Tour liegt im Ordner – ${err.message}`; return false; }
  f.gain = gain(full, f.track);
  const next = enrich(full, f.track, opt);
  devLog('Übernehmen:', f.name, '→', `„${full.name}“`, next === full ? 'nichts geändert' : 'ergänzt', opt);
  // Nichts übernommen (z. B. weicht nur der Puls ab und der vorhandene soll bleiben)
  if (next === full) { f.gain = { ...f.gain, any: false }; f.kept = true; return false; }
  await tracks.put({ ...next, updated: Date.now() });
  f.merged = true;
  return true;
}

function render() {
  root.innerHTML = `${files.length > 1 ? summary() : ''}${files.length ? files.map(card).join('') : `<section>
      <h3><span class="msr">upload_file</span> GPX-Datei öffnen</h3>
      <p class="settings-hint">Wähle eine GPX-Datei – z. B. von Garmin, Komoot oder einer anderen App. Mit Zeiten kannst du sie als aufgezeichnete Tour speichern, sonst als geplante Tour öffnen.</p>
    </section>`}
    <section>
      <div class="sync-actions">
        <label class="button"><span class="msr">folder_open</span> ${files.length ? 'Weitere Datei wählen' : 'Datei wählen'}<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx"></label>
      </div>
    </section>`;
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || busy) return;
  const f = files[Number(b.dataset.i)];
  if (!f && b.dataset.act !== 'all') return;
  if (b.dataset.act === 'all') {
    const todo = files.filter((x) => !x.error && x.track && !x.saved && !x.merged && (!x.dup || x.gain?.any));
    let n = 0;
    bulk.active += 1;   // der Ordner-Abgleich wartet, bis alle gespeichert sind
    try {
      for (const [k, x] of todo.entries()) {
        busy = { i: k + 1, n: todo.length };
        if (k % 5 === 0) render();
        try { if (await take(x)) n += 1; } catch (err) { x.note = err.message; }
      }
    } finally { bulk.active -= 1; busy = null; }
    toast(`${n} ${n === 1 ? 'Datei' : 'Dateien'} übernommen`);
    render();
    return;
  }
  if (b.dataset.act === 'track' || b.dataset.act === 'merge') {
    const did = await take(f);
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
  const o = e.target.closest('[data-opt]');
  if (o) { opt[o.dataset.opt] = o.checked; return; }
  const inp = e.target.closest('[data-file="gpx"]');
  if (!inp?.files?.length) return;
  await addFiles(await Promise.all([...inp.files].map(async (x) => ({ name: x.name, text: await x.text() }))));
});

/* ── Woher die Dateien kommen ─────────────────────────────────────────────── */

async function incoming() {
  const got = [];
  // App: „Öffnen mit“, „Teilen“, Doppelklick
  const core = window.__TAURI__?.core;
  if (core) {
    const r = await core.invoke('plugin:folder|opened', { peek: false }).catch(() => null);
    got.push(...(r?.files ?? []));
  }
  // Web-App: Teilen-Menü (sw.js hat die Dateien abgelegt)
  if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
    try {
      const cache = await caches.open(SHARE);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        got.push({ name: decodeURIComponent(res.headers.get('X-Name') ?? 'Datei.gpx'), text: await res.text() });
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
    const list = await Promise.all((p.files ?? []).map(async (h) => { const x = await h.getFile(); return { name: x.name, text: await x.text() }; }));
    if (list.length) addFiles(list);
  });
}

mountAppBar();
render();
const first = await incoming();
if (first.length) await addFiles(first);
