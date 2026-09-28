/**
 * Haltestellen: Abfahrten nach Fahrplan, Steige, Fahrt im Detail, Linien aus OSM.
 */
import { linesAt, transitHtml, mountTransitLine, lineStopsHtml, colorOf } from '../services/transit.js';
import { departures, samePlatform, tripCourse } from '../services/departures.js';
import { clock } from '../ui/share.js';
import { toast } from '../ui/dialogs.js';
import { distance, esc } from '../core/geo.js';
import { $, afterLayout, fitTo, map } from './core.js';

// Haltestelle → Linien; eine davon komplett auf der Karte
export const transitLine = mountTransitLine(map);
let stop = null;                 // angetippte Haltestelle: Linien, Abfahrten, Ansicht

/** Neuer Ort: keine Haltestelle mehr */
export function resetStop() { stop = null; }

/* ── Haltestellen: welche Linien halten hier, eine davon auf der Karte ───── */

/**
 * Haltestelle. Schnell zuerst der Fahrplan (EFA, gut ¼ s): seine Steige
 * haben Koordinaten – der nächste zum angetippten Punkt ist diese Seite der
 * Straße, also eine Richtung. Daraus „Linien an diesem Steig“ (Linie →
 * Ziel, nächste Abfahrt) und die Abfahrten. OSM (Overpass, oft Sekunden)
 * läuft nebenher: Linienfarben und der Verlauf auf der Karte; ohne Fahrplan
 * (Ausland) zeigt es die Linien wie bisher.
 */
export async function showStop(f, tags, title, signal) {
  const point = f.geometry.coordinates;
  const name = tags.name ?? title;
  stop = {
    point, name, here: [], all: null, scope: 'here', more: false, active: transitLine.shown, activeLine: null,
    side: tags.local_ref ?? (tags.public_transport === 'platform' ? tags.ref : null) ?? null,
    ifopt: tags['ref:IFOPT'] ?? '', deps: null, depMore: false, error: null, depError: null, osm: null,
  };
  const mine = stop;
  paintStop();
  const ref = f.properties.osm_type && f.properties.osm_id ? { type: f.properties.osm_type, id: f.properties.osm_id } : null;
  // OSM: mit Fahrplan nur für die Linienfarben (im Hintergrund), ohne ihn die Linien selbst
  const osmLines = (background) => {
    stop.osm = linesAt(point, name, { ref, background, signal }).then(({ here, all }) => {
      if (stop !== mine) return;
      Object.assign(stop, { here, all });
      paintStop();
    }).catch((err) => { if (err.name !== 'AbortError' && stop === mine) { stop.error = err.message; stop.all = []; paintStop(); } });
  };
  departures(point, { name, ifopt: stop.ifopt, signal }).then(({ list }) => {
    if (stop !== mine) return;
    stop.deps = list;
    paintStop();
    osmLines(list.length > 0);
  }).catch((err) => {
    if (err.name === 'AbortError' || stop !== mine) return;
    stop.depError = err.message;
    paintStop();
    osmLines(false);
  });
}

const lineCount = (list) => new Set(list.map((r) => `${r.route}|${r.ref ?? r.name}`)).size;

/**
 * Steige dieser Seite → Set der EFA-Kennungen, oder null (nur ein Steig,
 * oder keiner nah genug). Erst über den IFOPT aus OSM, sonst der nächste
 * Steig (und alle, die kaum weiter weg sind – ein Mast, zwei Kennungen).
 */
function sideOf(s) {
  const plats = new Map();
  for (const d of s.deps ?? []) if (d.platformId && !plats.has(d.platformId)) plats.set(d.platformId, d.platformPoint);
  if (plats.size < 2) return null;
  if (s.ifopt.split(':').length > 3) {
    const ids = [...plats.keys()].filter((id) => samePlatform(id, s.ifopt));
    if (ids.length) return new Set(ids);
  }
  const near = [...plats].filter(([, p]) => p).map(([id, p]) => [id, distance(p, s.point)]).sort((a, b) => a[1] - b[1]);
  if (!near.length || near[0][1] > 80) return null;
  return new Set(near.filter(([, d]) => d <= near[0][1] + 8).map(([id]) => id));
}

const tripKey = (x) => `${x.lineId}|${x.tripCode}|${+x.time}`;

/** Passende OSM-Linie zu einer Abfahrt (gleiche Nummer, Ziel passt) */
function relFor(x, all = stop?.all ?? []) {
  const same = all.filter((r) => String(r.ref ?? '') === x.line);
  return same.find((r) => (r.to ?? '').includes(x.to) || x.to.includes(r.to ?? '\u0000')) ?? same[0] ?? null;
}

/** Steige der Haltestelle aus den Abfahrten → [{ label, ids }] nach Namen sortiert */
function platformsOf(s) {
  const by = new Map();
  for (const d of s.deps ?? []) {
    const k = d.platform || d.platformId;
    if (!k) continue;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k).add(d.platformId);
  }
  return [...by].map(([label, ids]) => ({ label, ids }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'de', { numeric: true }));
}

/*
 * Haltestelle: nur noch die Abfahrten, zeitlich sortiert. Oben die Wahl des
 * Steigs – „Hier“ (die angetippte Seite, also eine Richtung; Vorgabe), jeder
 * einzelne Steig oder alle. Eine Abfahrt antippen zeigt die Fahrt auf der
 * Karte und darunter, wann sie wo ist.
 */
function paintStop() {
  const box = $('[data-view="place"] .place-transit');
  if (!stop) { box.innerHTML = ''; return; }
  const s = stop;
  if (s.deps?.length || (s.deps === null && !s.depError)) {
    const side = s.deps?.length ? sideOf(s) : null;
    const plats = platformsOf(s);
    const pick = s.pick ?? (side ? 'here' : 'all');
    const ids = pick === 'here' ? side : null;
    const deps = s.deps ? (ids ? s.deps.filter((d) => ids.has(d.platformId)) : s.deps) : null;
    const hereLabel = side ? plats.filter((p) => [...p.ids].some((id) => side.has(id))).map((p) => p.label).join(', ') : '';
    const chip = (v, label, icon = '') => `<button type="button" class="chip" data-pick="${esc(v)}" aria-pressed="${pick === v}">${icon ? `<span class="msr">${icon}</span>` : ''}${esc(label)}</button>`;
    // Nur „Hier“ und „Alle Steige“ – einzelne Steige machen große Bahnhöfe unübersichtlich
    const chips = side ? `<div class="chip-row dep-filter">
      ${chip('here', `Hier${hereLabel ? ` · Steig ${hereLabel}` : ''}`, 'my_location')}
      ${chip('all', 'Alle Steige')}
    </div>` : '';
    box.innerHTML = `<h3 class="section-title">Abfahrten</h3>${chips}${departuresHtml(s, deps, pick !== 'all')}`;
    if (s.activeLine) {
      box.querySelector(`[data-key="${CSS.escape(String(s.active))}"]`)
        ?.insertAdjacentHTML('afterend', s.activeLine.course ? tripDetailHtml(s.activeLine) : lineStopsHtml(s.activeLine));
    }
    return;
  }
  let lines;
  if (s.error) lines = `<h3 class="section-title">Linien hier</h3><p class="muted">Gerade nicht abrufbar (${esc(s.error)})</p>`;
  else if (!s.all) lines = '<h3 class="section-title">Linien hier</h3><p class="muted"><span class="msr spin">progress_activity</span> Welche Linien hier halten …</p>';
  else if (!s.all.length) lines = '';
  else {
    // Ohne Fahrplan (Ausland, EFA gestört): die Linien aus OSM
    const osmHere = s.scope === 'here' && s.here.length;
    const list = osmHere ? s.here : s.all;
    const other = lineCount(s.all) > lineCount(s.here) && s.here.length;
    lines = transitHtml(list, {
      active: s.active, all: s.more,
      title: osmHere ? `Linien an diesem Steig${s.side ? ` (${s.side})` : ''}` : s.here.length ? 'Alle Linien der Haltestelle' : 'Linien hier',
      extra: other ? `<button type="button" class="link-button transit-scope" data-transit="scope">${osmHere
        ? `<span class="msr">unfold_more</span> Alle ${lineCount(s.all)} Linien der Haltestelle` : '<span class="msr">unfold_less</span> Nur dieser Steig'}</button>` : '',
    });
  }
  box.innerHTML = lines;
  if (s.activeLine) box.querySelector(`[data-line="${s.active}"]`)?.insertAdjacentHTML('afterend', lineStopsHtml(s.activeLine));
}

/** Fahrt im Detail: alle Halte mit Zeit – schon gefahrene blass, dieser Halt fett */
function tripDetailHtml({ stops, next }) {
  const at = next ? stops.length - next.length : -1;
  return `<ol class="trip-detail">${stops.map((x, i) => `<li class="${i < at ? 'past' : ''}${i === at ? ' here' : ''}">
    <time>${x.time ? clock(x.time) : ''}</time><span>${esc(x.name)}</span></li>`).join('')}</ol>`;
}

function departuresHtml(s, deps, filtered) {
  if (s.depError) return `<p class="muted">Fahrplan gerade nicht abrufbar (${esc(s.depError)})</p>`;
  if (!deps) return '<p class="muted"><span class="msr spin">progress_activity</span> Fahrplan wird geladen …</p>';
  if (!deps.length) return '<p class="muted">An diesem Steig in nächster Zeit keine Abfahrten</p>';
  const now = Date.now();
  const rows = deps.slice(0, s.depMore ? 40 : 12).map((x) => {
    // Passende Linie aus OSM: Farbe, und antippen zeigt sie auf der Karte
    const rel = relFor(x, s.all ?? []);
    const at = x.delay ? new Date(+x.time + x.delay * 60000) : x.time;
    const mins = Math.round((at - now) / 60000);
    return `<li><button type="button" class="dep-row" data-dep="${s.deps.indexOf(x)}" data-key="${esc(tripKey(x))}" aria-pressed="${tripKey(x) === s.active}">
      <time>${clock(x.time)}${x.delay ? `<b class="${x.delay > 0 ? 'late' : 'early'}">${x.delay > 0 ? '+' : ''}${x.delay}</b>` : ''}</time>
      <span class="transit-badge" style="--c:${esc(rel ? colorOf(rel) : x.color)}">${esc(x.line)}</span>
      <span class="dep-to">${x.cancelled ? '<s>' : ''}${esc(x.to)}${x.cancelled ? '</s> fällt aus' : ''}</span>
      <small>${mins >= 0 && mins < 60 ? `in ${mins} min` : ''}${x.platform ? ` · Steig ${esc(x.platform)}` : ''}</small>
    </button></li>`;
  }).join('');
  return `<ul class="dep-list">${rows}</ul>
    ${deps.length > 12 && !s.depMore ? '<button type="button" class="button transit-more" data-transit="deps"><span class="msr">expand_more</span> Weitere Abfahrten</button>' : ''}
    <p class="muted dep-source">Fahrplan: NVBW EFA-BW${deps.some((x) => x.delay !== null) ? ' · mit Echtzeit' : ''}${filtered ? ' · nur dieser Steig' : ''}</p>`;
}

$('[data-view="place"] .place-transit').addEventListener('click', async (e) => {
  if (!stop) return;
  const act = e.target.closest('[data-transit]')?.dataset.transit;
  if (act === 'all') { stop.more = true; paintStop(); return; }
  if (act === 'deps') { stop.depMore = true; paintStop(); return; }
  if (act === 'scope') { stop.scope = stop.scope === 'here' ? 'all' : 'here'; paintStop(); return; }
  const pick = e.target.closest('[data-pick]')?.dataset.pick;
  if (pick) { stop.pick = pick; paintStop(); return; }
  const depBtn = e.target.closest('[data-dep]');
  if (depBtn) { showTrip(stop.deps[Number(depBtn.dataset.dep)], depBtn); return; }
  const btn = e.target.closest('[data-line]');
  if (!btn) return;
  const id = Number(btn.dataset.line);
  if (transitLine.shown === id) {
    transitLine.clear();
    stop.active = null; stop.activeLine = null;
    paintStop();
    return;
  }
  const icon = $('.msr', btn);
  if (icon) { icon.textContent = 'progress_activity'; icon.classList.add('spin'); }
  const mine = stop;
  try {
    // Ab dieser Haltestelle kräftig – der Weg bis hierher blass
    const line = await transitLine.show(id, { from: stop.point });
    if (stop !== mine) return;
    stop.active = id; stop.activeLine = line;
    stop.more = true;
    paintStop();
    if (line.bounds) afterLayout(() => fitTo(line.bounds.flat(), 16));
  } catch (err) {
    if (err.name === 'AbortError') return;
    toast(`Linie gerade nicht abrufbar (${err.message})`);
    paintStop();
  }
});

/**
 * Eine Fahrt aus den Abfahrten auf der Karte: Verlauf und Halte mit Zeiten
 * aus dem Fahrplan (schnell). Kennt der ihn nicht, die passende OSM-Linie.
 */
async function showTrip(x, btn) {
  if (!x) return;
  const key = tripKey(x);
  if (stop.active === key) {
    transitLine.clear();
    stop.active = null; stop.activeLine = null;
    paintStop();
    return;
  }
  btn?.classList.add('loading');
  const mine = stop;
  try {
    const course = await tripCourse(x);
    if (stop !== mine) return;
    const rel = relFor(x, stop.all ?? []);
    const line = transitLine.showCourse(key, { ...course, color: rel ? colorOf(rel) : x.color });
    stop.active = key; stop.activeLine = { ...line, course: true };
    paintStop();
    if (line.bounds) afterLayout(() => fitTo(line.bounds.flat(), 16));
  } catch (err) {
    if (stop !== mine) return;
    // Ersatz: Linie aus OSM (dauert länger)
    await stop.osm;
    const rel = stop === mine && relFor(x, stop.all ?? []);
    if (!rel) { toast(`Verlauf von ${x.line} gerade nicht abrufbar`); paintStop(); return; }
    try {
      const line = await transitLine.show(rel.id, { from: stop.point });
      if (stop !== mine) return;
      stop.active = key; stop.activeLine = line;
      paintStop();
      if (line.bounds) afterLayout(() => fitTo(line.bounds.flat(), 16));
    } catch (e2) { if (e2.name !== 'AbortError') { toast(`Linie gerade nicht abrufbar (${e2.message})`); paintStop(); } }
  }
}
