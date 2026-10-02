/**
 * Kategorien („Parkplätze“): Treffer aus Kacheln und Overpass, Trefferlisten.
 */
import { osmRef } from '../map/map.js';
import { poisInBounds, poisAlong } from '../map/tile-pois.js';
import * as geocode from '../services/geocode.js';
import * as overpass from '../services/overpass.js';
import { describePoi, inCategory } from '../ui/poi-info.js';
import { recent } from '../data/store.js';
import { toast } from '../ui/dialogs.js';
import { nearestOnLine, pointAt, bboxAround, distance, fmtDistance, esc } from '../core/geo.js';
import { $, afterLayout, extentToBounds, fitTo, map, parseTags, q, sheet, showHl, state, viewBounds, viewPadding } from './core.js';
import { clearPlace, featureFromPoint, showPlace } from './place.js';
import { clearReach } from './reach.js';
import { leaveRouteMode } from './route-plan.js';
import { openSheet, remember } from './views.js';

/* ── Kategorie ────────────────────────────────────────────────────────────── */

let catCtl = null;


/**
 * @param opts.rememberAs  Suchtext – dann kommt die Suche in den Verlauf
 */
export async function runCategory(cat, placeText = null, { bounds = null, label = null, fit = false, push = true, rememberAs = null } = {}) {
  const view = $('[data-view="category"]');
  let area = bounds ? { bounds, label } : null;

  if (!area && placeText) {
    try {
      const [f] = await geocode.search(placeText, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 });
      if (!f) { toast(`„${placeText}“ nicht gefunden`); return; }
      area = {
        bounds: extentToBounds(f.properties.extent) ?? bboxAround(f.geometry.coordinates, 3000),
        label: `in ${geocode.describe(f).title}`,
      };
      fit = true;
    } catch (err) { toast(err.message); return; }
  }
  area ??= viewBounds();
  leaveRouteMode();
  clearPlace();
  clearReach();
  state.category = { category: cat, ...area };
  if (push) {
    remember('category', () => (state.category?.category === cat ? openSheet('category')
      : runCategory(cat, null, { ...area, fit: true, push: false })));
  }
  if (rememberAs) {
    recent.add({ kind: 'category', category: cat.id, place: placeText, title: cat.label, subtitle: placeText ? `in ${placeText}` : 'in der Nähe' });
  }
  q.value = cat.label;
  $('#q-clear').hidden = false;
  $('#search-here').hidden = true;
  $('.cat-title', view).innerHTML = `<span class="msr" style="color:${cat.color}">${cat.icon}</span> ${esc(cat.label)}`;
  $('.cat-sub', view).textContent = `Suche ${area.label} …`;
  $('.cat-list', view).innerHTML = '';
  openSheet('category');
  if (fit) afterLayout(() => fitTo(area.bounds, 15));

  catCtl?.abort();
  catCtl = new AbortController();
  const { signal } = catCtl;
  const current_ = () => state.category?.category === cat && !signal.aborted;

  const center = [(area.bounds[0] + area.bounds[2]) / 2, (area.bounds[1] + area.bounds[3]) / 2];
  const ref = state.position && distance(state.position, center) < 20000 ? state.position : center;
  const show = (shapes, points, final) => {
    points.forEach((p) => { p.properties.dist = distance(ref, p.geometry.coordinates); });
    points.sort((a, b) => a.properties.dist - b.properties.dist);
    numberHits(points);
    showHl({ shapes, points });
    $('.cat-sub', view).textContent = !final
      ? `${points.length} gefunden ${area.label} …`
      : points.length ? `${points.length}${points.length >= 400 ? '+' : ''} gefunden ${area.label}` : `Keine ${cat.label} ${area.label}`;
    renderResultList($('.cat-list', view), points.slice(0, 80), cat, (p) => `${fmtDistance(p.properties.dist)} entfernt`);
  };

  // Sofort: die Punkte aus den Kartenkacheln des Suchbereichs – unabhängig
  // davon, was die Karte gerade zeigt (auch während sie noch hinfliegt)
  let final = false;
  let fromTiles = [];
  const t0 = performance.now();
  const instant = tilePoints(cat, area.bounds, signal).then((pts) => {
    fromTiles = pts;
    if (final || !current_() || !pts.length) return;
    show([], pts, false);
    console.debug(`[WMap] ${cat.id}: ${pts.length} aus Kacheln in ${Math.round(performance.now() - t0)} ms`);
  }).catch(() => {});

  try {
    const { shapes, points } = await overpass.inBbox(cat, area.bounds, { signal });
    if (!current_()) return;
    await instant;
    final = true;
    // Was nur die Kacheln kennen (Overpass unvollständig), bleibt dabei
    const ids = new Set(points.map((p) => p.properties.id));
    show(shapes, [...points, ...fromTiles.filter((p) => p.properties.id && !ids.has(p.properties.id))], true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    await instant;
    if (!current_()) return;
    // Overpass ausgefallen: die Treffer aus den Kacheln bleiben stehen
    // Mit Treffern aus den Kacheln still bleiben – nur fehlende Flächen erwähnen
    $('.cat-sub', view).textContent = !fromTiles.length ? `${err.message} – bitte gleich noch einmal`
      : `${fromTiles.length} gefunden ${area.label}${cat.kind === 'point' ? '' : ' · Umrisse gerade nicht abrufbar'}`;
  }
}

/*
 * Treffer aus den Vektorkacheln – ohne Overpass, also sofort (map/tile-pois.js).
 * Die Kacheln führen Parkplätze, Tankstellen, Läden usw. als Punkte mit
 * `subclass` (= OSM-Wert). Flächen und Einzelheiten ergänzt Overpass danach.
 */
const TILE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'highway', 'railway', 'historic', 'natural', 'man_made'];

/** Kachel-Punkt → Treffer im Overpass-Format (gleiche Liste, gleiche Symbole). */
function tileHit(cat, { id, props, point }) {
  const sub = props.subclass;
  if (!sub) return null;
  const tags = Object.fromEntries(TILE_KEYS.map((k) => [k, sub]));
  if (!inCategory(cat, tags)) return null;
  const r = osmRef({ id });
  const name = props['name:de'] ?? props.name_de ?? props.name ?? '';
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: point },
    properties: {
      id: r ? `${{ N: 'node', W: 'way', R: 'relation' }[r.type]}/${r.id}` : '',
      name, category: cat.id, color: cat.color, prelim: true,
      tags: JSON.stringify({ ...tags, ...(name ? { name } : {}) }),
    },
  };
}

function dedupeHits(hits) {
  const seen = new Set();
  return hits.filter((h) => {
    if (!h) return false;
    const key = h.properties.id || h.geometry.coordinates.map((v) => v.toFixed(5)).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kachel-Treffer im Korridor um eine Linie, mit Lage entlang der Route. */
export async function tilePointsAlong(cat, route, radius, signal, { from = 0, to = Infinity } = {}) {
  const i0 = Math.max(0, nearestOnLine(route.coords, route.cum, pointAt(route.coords, route.cum, from)).index - 1);
  let i1 = route.cum.findIndex((m) => m > to);
  if (i1 < 0) i1 = route.coords.length;
  const part = route.coords.slice(i0, i1 + 1);
  const hits = dedupeHits((await poisAlong(map, part, radius, { signal })).map((f) => tileHit(cat, f)));
  for (const p of hits) {
    const s = nearestOnLine(route.coords, route.cum, p.geometry.coordinates, i0, i1);
    Object.assign(p.properties, { along: s.along, offset: s.offset });
  }
  return hits.filter((p) => p.properties.offset <= radius);
}

export async function tilePoints(cat, bounds, signal) {
  return dedupeHits((await poisInBounds(map, bounds, { signal })).map((f) => tileHit(cat, f)));
}

export function clearCategory() {
  state.category = null;
  catCtl?.abort();
  $('#search-here').hidden = true;
  showHl({});
}

$('#search-here').addEventListener('click', () => {
  if (state.category) runCategory(state.category.category, null, { ...viewBounds(), push: false });
});

map.on('moveend', (e) => {
  // Nur nach eigener Bewegung anbieten, nicht nach fitBounds
  if (state.category && e.originalEvent && sheet.dataset.current === 'category') $('#search-here').hidden = false;
});

/**
 * Nummer je Treffer in der Reihenfolge der Liste – sie steht am Namen („Parkplatz, (3)“) und am Symbol
 * auf der Karte (map/map.js, Ebenen hl-nr und poi-nr), damit man den Eintrag der Liste auf der Karte
 * wiederfindet. Nur für die Treffer, die die Liste zeigt.
 */
export function numberHits(points, limit = 80) {
  points.forEach((p, i) => { if (i < limit) p.properties.nr = i + 1; else delete p.properties.nr; });
  return points;
}

/** Trefferliste für Kategorie, Erreichbarkeit und „Entlang der Route“. */
export function renderResultList(ul, points, cat, meta) {
  ul.innerHTML = points.map((p, i) => {
    const info = describePoi(parseTags(p.properties.tags), { name: p.properties.name });
    const c = cat ?? info.category;
    const known = info.facts.filter((f) => !f.unknown && !f.value.includes('\n')).slice(0, 2).map((f) => f.value);
    return `<li><button type="button" data-i="${i}">
      <span class="dot msr" style="--c:${c?.color ?? '#e8590c'}">${c?.icon ?? 'location_on'}</span>
      <span class="sg-text"><strong>${esc(info.name)}${p.properties.nr ? `, (${p.properties.nr})` : ''}</strong>
      <small>${esc([meta(p), info.status, ...known].filter(Boolean).join(' · '))}</small></span>
    </button></li>`;
  }).join('');
  ul.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const p = points[Number(b.dataset.i)];
    showPlace(featureFromPoint(p), { over: true, fly: false });
    afterLayout(() => map.flyTo({ center: p.geometry.coordinates, zoom: Math.max(map.getZoom(), 16), padding: viewPadding(), duration: 900 }));
  };
}
