/**
 * Kategorien („Parkplätze“): Treffer aus Kacheln und Overpass, Trefferlisten.
 */
import { osmRef } from '../map/map.js';
import { poisInBounds, poisAlong } from '../map/tile-pois.js';
import * as geocode from '../services/geocode.js';
import * as overpass from '../services/overpass.js';
import { accessOf, describePoi, inCategory, openState } from '../ui/poi-info.js';
import { recent } from '../data/store.js';
import { toast } from '../ui/dialogs.js';
import { nearestOnLine, pointAt, bboxAround, distance, fmtDistance, esc } from '../core/geo.js';
import { $, afterLayout, extentToBounds, fitTo, map, parseTags, q, sheet, showHl, state, viewBounds, viewPadding } from './core.js';
import { clearPlace, featureFromPoint, showPlace } from './place.js';
import { clearReach } from './reach.js';
import { leaveRouteMode } from './route-plan.js';
import { openSheet, remember } from './views.js';
import { t } from '../core/i18n.js';
import { chargeFilter, freeChip, runChargers, saveFilter } from './charging.js';

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
      if (!f) { toast(t('search.toast.not_found', { text: placeText })); return; }
      area = {
        bounds: extentToBounds(f.properties.extent) ?? bboxAround(f.geometry.coordinates, 3000),
        label: t('map.in_place', { place: geocode.describe(f).title }),
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
    recent.add({ kind: 'category', category: cat.id, place: placeText, title: cat.label, subtitle: placeText ? t('map.in_place', { place: placeText }) : t('category.recent_nearby') });
  }
  q.value = cat.label;
  $('#q-clear').hidden = false;
  $('#search-here').hidden = true;
  $('.cat-title', view).innerHTML = `<span class="msr" style="color:${cat.color}">${cat.icon}</span> ${esc(cat.label)}`;
  $('.cat-sub', view).textContent = t('category.searching', { area: area.label });
  $('.cat-list', view).innerHTML = '';
  openSheet('category');
  if (fit) afterLayout(() => fitTo(area.bounds, 15));

  catCtl?.abort();
  catCtl = new AbortController();
  const { signal } = catCtl;
  const current_ = () => state.category?.category === cat && !signal.aborted;

  const center = [(area.bounds[0] + area.bounds[2]) / 2, (area.bounds[1] + area.bounds[3]) / 2];
  const ref = state.position && distance(state.position, center) < 20000 ? state.position : center;
  const redo = () => { if (current_()) runCategory(cat, null, { ...area, push: false }); };
  const charging = cat.id === 'charging';
  // Ladesäulen mit „Nur freie“: aus der Ladesäulen-Datenbank (Belegung), sonst – und wenn sie nicht antwortet – aus der Karte
  if (charging && chargeFilter.free) {
    const onPick = (f) => showPlace(f, { over: true, fly: false });
    if (await runChargers({ cat, ref, view, signal, current: current_, onPick, redo })) return;
    toast(t('category.charging.failed'));
  }
  const show = (allShapes, all, final) => {
    all.forEach((p) => { p.properties.dist = distance(ref, p.geometry.coordinates); });
    all.sort((a, b) => a.properties.dist - b.properties.dist);
    const f = filterHits(all, allShapes);
    const { points, shapes } = f;
    numberHits(points);
    showHl({ shapes, points });
    const hidden = all.length - points.length;
    const hiddenText = hidden ? ` · ${t('category.hidden', { n: hidden })}` : '';
    $('.cat-sub', view).textContent = !final
      ? t('category.found_so_far', { n: points.length, area: area.label })
      : points.length ? `${t('category.found', { n: `${points.length}${all.length >= 400 ? '+' : ''}`, area: area.label })}${hiddenText}`
        : `${t('category.none', { category: cat.label, area: area.label })}${hiddenText}`;
    renderResultList($('.cat-list', view), points.slice(0, 80), cat, (p) => t('category.distance', { distance: fmtDistance(p.properties.dist) }),
      { filter: f, redo: () => { if (state.category?.category === cat) show(allShapes, all, final); },
        ...(charging ? { extra: freeChip(), onExtra: () => { chargeFilter.free = !chargeFilter.free; saveFilter(); redo(); } } : {}) });
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
    $('.cat-sub', view).textContent = !fromTiles.length ? t('category.failed', { error: err.message })
      : `${t('category.found', { n: fromTiles.length, area: area.label })}${cat.kind === 'point' ? '' : ` · ${t('category.no_shapes')}`}`;
  }
}

/*
 * Treffer aus den Vektorkacheln – ohne Overpass, also sofort (map/tile-pois.js).
 * Die Kacheln führen Parkplätze, Tankstellen, Läden usw. als Punkte mit
 * `subclass` (= OSM-Wert). Flächen und Einzelheiten ergänzt Overpass danach.
 */
const TILE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'highway', 'railway', 'historic', 'natural', 'man_made'];

/** Kachel-Punkt → Treffer im Overpass-Format (gleiche Liste, gleiche Symbole). */
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

function tileHit(cat, { id, props, point }) {
  const sub = props.subclass;
  if (!sub) return null;
  const tags = Object.fromEntries(TILE_KEYS.map((k) => [k, sub]));
  const name = props['name:de'] ?? props.name_de ?? props.name ?? '';
  // Suche nach Namen („Rewe“): der Name zählt, nicht die Art
  if (cat.byName ? !fold(name).includes(fold(cat.byName)) : !inCategory(cat, tags)) return null;
  const r = osmRef({ id });
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

/* ── Filter der Trefferlisten ─────────────────────────────────────────────── */

/*
 * Standardmäßig fehlt, was man nicht nutzen kann: Private (Parkplätze und andere ohne Zugang, nur Anwohner …) und
 * was gerade geschlossen hat (nach opening_hours – ohne Angabe gilt es als offen). Chips über der Liste holen sie
 * dazu, dann grau – auf der Karte wie in der Liste. Kundenparkplätze bleiben drin, mit Hinweis. Gilt für alle
 * Listen (In der Nähe, Entlang der Route, unterwegs, Erreichbar), bis die Seite neu lädt.
 */
export const hitFilter = { open: true, priv: false };
const GREY = '#9aa0a6';

/**
 * Punkte (und ihre Flächen) filtern und die übrigen einfärben.
 * → { points, shapes, closed, priv, hours } – closed/priv: so viele gibt es (gezeigt oder nicht), hours: ob
 *   überhaupt Öffnungszeiten dabei sind (sonst kein Chip „Nur offene“)
 */
export function filterHits(points, shapes = []) {
  let closed = 0, priv = 0, hours = false;
  const gone = new Set();
  const out = points.filter((p) => {
    const tags = parseTags(p.properties.tags);
    const isPriv = accessOf(tags).kind === 'private';
    const st = openState(tags.opening_hours);
    if (st) hours = true;
    const isClosed = st?.open === false;
    if (isPriv) priv += 1;
    if (isClosed) closed += 1;
    // Flächen teilen sich die Eigenschaften mit ihrem Punkt (services/overpass.js) – die Farbe gilt für beide
    p.properties.color0 ??= p.properties.color;
    p.properties.color = isPriv || isClosed ? GREY : p.properties.color0;
    if ((isPriv && !hitFilter.priv) || (isClosed && hitFilter.open)) { gone.add(p.properties.id); return false; }
    return true;
  });
  return { points: out, shapes: shapes.filter((f) => !gone.has(f.properties.id)), closed, priv, hours };
}

/** Chips über der Liste: `extra`, „Nur offene“ (an), „Private“ (aus) – nur, wenn es etwas zu filtern gibt */
function filterChips(f, extra = '') {
  const chips = extra ? [extra] : [];
  if (f.hours || f.closed) {
    chips.push(`<button type="button" class="chip" data-hf="open" aria-pressed="${hitFilter.open}"><span class="msr">schedule</span> ${t('category.filter.only_open')}${
      hitFilter.open && f.closed ? ` <small>${t('category.filter.closed', { n: f.closed })}</small>` : ''}</button>`);
  }
  if (f.priv) {
    chips.push(`<button type="button" class="chip" data-hf="priv" aria-pressed="${hitFilter.priv}"><span class="msr">lock</span> ${t('category.filter.also_private')} <small>${f.priv}</small></button>`);
  }
  return chips.length ? `<li class="hit-filters chip-row" role="group" aria-label="${t('category.filter.title')}">${chips.join('')}</li>` : '';
}

/**
 * Trefferliste für Kategorie, Erreichbarkeit und „Entlang der Route“. `opts.filter` (aus filterHits) und
 * `opts.redo()` (alles neu filtern und zeigen): dann stehen die Filter-Chips oben. `opts.extra`: ein weiterer Chip
 * (mit data-free), `opts.onExtra()` beim Antippen.
 */
export function renderResultList(ul, points, cat, meta, { filter = null, redo = null, extra = '', onExtra = null } = {}) {
  ul.innerHTML = (filter && redo ? filterChips(filter, extra) : '') + points.map((p, i) => {
    const info = describePoi(parseTags(p.properties.tags), { name: p.properties.name });
    const c = cat?.byName ? info.category ?? cat : cat ?? info.category;
    // Der Zugang steht schon als Hinweis da – nicht noch einmal als Angabe
    const known = info.facts.filter((f) => !f.unknown && !f.value.includes('\n') && !(info.access.text && f.label === t('poi.facts.access'))).slice(0, 2).map((f) => f.value);
    // Ausgegraut (privat, geschlossen – filterHits): auch in der Liste grau
    const grey = p.properties.color === GREY;
    return `<li${grey ? ' class="hit-muted"' : ''}><button type="button" data-i="${i}">
      <span class="dot msr" style="--c:${grey ? GREY : c?.color ?? '#e8590c'}">${c?.icon ?? 'location_on'}</span>
      <span class="sg-text"><strong>${esc(info.name)}${p.properties.nr ? `, (${p.properties.nr})` : ''}</strong>
      <small>${esc([meta(p), info.status, info.access.text, ...known].filter(Boolean).join(' · '))}</small></span>
    </button></li>`;
  }).join('');
  ul.onclick = (e) => {
    const hf = e.target.closest('[data-hf]')?.dataset.hf;
    if (hf && redo) { hitFilter[hf] = !hitFilter[hf]; redo(); return; }
    if (onExtra && e.target.closest('[data-free]')) { onExtra(); return; }
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const p = points[Number(b.dataset.i)];
    showPlace(featureFromPoint(p), { over: true, fly: false });
    afterLayout(() => map.flyTo({ center: p.geometry.coordinates, zoom: Math.max(map.getZoom(), 16), padding: viewPadding(), duration: 900 }));
  };
}
