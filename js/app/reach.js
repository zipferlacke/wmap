/**
 * Erreichbarkeit: Ringe in Minuten oder Kilometern, Orte darin.
 */
import { PROFILES } from '../config.js';
import { showReach } from '../map.js';
import * as overpass from '../overpass.js';
import { byId } from '../categories.js';
import { isochrone } from '../routing.js';
import { simplifyTo, bbox, esc } from '../geo.js';
import { clearCategory, renderResultList, tilePoints } from './category.js';
import { $, $$, afterLayout, chipHtml, fitTo, map, markerEl, myPosition, q, showHl } from './core.js';
import { clearPlace } from './place.js';
import { leaveRouteMode } from './route-plan.js';
import { openSheet, remember } from './views.js';

/* ══════════════════════════════════════════════════════════════════════════
   Erreichbarkeit
   ══════════════════════════════════════════════════════════════════════════ */

const REACH_VALUES = { time: [5, 10, 15, 30, 60], distance: [1, 2, 5, 10, 25] };
const REACH_COLORS = ['#2f9e44', '#f59f00', '#e8590c'];     // innen → außen
export const reach = { origin: null, label: 'Mein Standort', profile: 'bike', metric: 'time', value: 15, cat: null, features: [] };
let reachCtl = null;
let reachMarker = null;

export function openReach({ origin = null, label = 'Mein Standort' } = {}, { push = true } = {}) {
  leaveRouteMode();
  clearPlace();
  clearCategory();
  reach.origin = origin;
  reach.label = label;
  if (push) remember('reach', () => (reach.features?.length && reach.origin === origin ? openSheet('reach') : openReach({ origin, label }, { push: false })));
  q.value = '';
  $('#q-clear').hidden = true;
  openSheet('reach');
  paintReachControls();
  computeReach({ fit: true });
}

function paintReachControls() {
  const view = $('[data-view="reach"]');
  $$('input[name="reach-profile"]', view).forEach((r) => { r.checked = r.value === reach.profile; });
  $$('input[name="reach-metric"]', view).forEach((r) => { r.checked = r.value === reach.metric; });
  const unit = reach.metric === 'time' ? 'min' : 'km';
  $('.reach-values', view).innerHTML = REACH_VALUES[reach.metric].map((v) => `
    <button type="button" class="chip" data-v="${v}" aria-pressed="${v === reach.value}" style="--chip:#2f9e44">${v} ${unit}</button>`).join('');
  $('.reach-cats', view).innerHTML = ['parking', 'bakery', 'supermarket', 'restaurant', 'cafe', 'playground', 'viewpoint', 'charging', 'toilets']
    .map((id) => chipHtml(byId(id), reach.cat?.id === id)).join('');
}

/** Drei Ringe: ein, zwei und drei Drittel des gewählten Werts. */
function reachSteps(v) {
  const steps = [v / 3, (2 * v) / 3, v].map((x) => (reach.metric === 'time' ? Math.round(x) : Math.round(x * 10) / 10));
  return [...new Set(steps.filter((x) => x > 0))];
}

async function computeReach({ fit = false } = {}) {
  const view = $('[data-view="reach"]');
  const sub = $('.reach-sub', view);
  const unit = reach.metric === 'time' ? 'min' : 'km';
  sub.textContent = `Von ${reach.label} · ${PROFILES[reach.profile].label} · wird berechnet …`;
  reachCtl?.abort();
  reachCtl = new AbortController();
  const { signal } = reachCtl;
  try {
    const origin = reach.origin ?? await myPosition();
    const steps = reachSteps(reach.value);
    const features = await isochrone(origin, reach.profile, { metric: reach.metric, values: steps, signal });
    if (signal.aborted) return;
    const ascending = [...steps].sort((a, b) => a - b);
    for (const f of features) {
      const i = ascending.findIndex((v) => Math.abs(v - f.properties.value) < 1e-6);
      f.properties.color = REACH_COLORS[Math.max(0, REACH_COLORS.length - ascending.length + i)];
    }
    reach.features = features;
    showReach(map, features);
    reachMarker?.remove();
    reachMarker = new maplibregl.Marker({ element: markerEl('start', reach.origin ? 'place' : 'my_location') })
      .setLngLat(origin).addTo(map);
    sub.textContent = `Von ${reach.label} · ${PROFILES[reach.profile].label} · bis ${reach.value} ${unit}`;
    $('.reach-legend', view).innerHTML = [...features].reverse().map((f) => `
      <span><i style="background:${f.properties.color}"></i>bis ${String(f.properties.value).replace('.', ',')} ${unit}</span>`).join('');
    if (fit && features[0]) afterLayout(() => fitTo(bbox(outerRings(features[0].geometry).flat())));
    if (reach.cat) searchInReach(reach.cat);
  } catch (err) {
    if (err.name !== 'AbortError') sub.textContent = err.message;
  }
}

const outerRings = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function searchInReach(cat) {
  reach.cat = cat;
  paintReachControls();
  const list = $('.reach-list');
  const outer = reach.features[0];
  if (!outer) return;
  list.innerHTML = `<li class="muted">Suche ${esc(cat.label)} im erreichbaren Bereich …</li>`;
  const signal = reachCtl?.signal;
  const unit = reach.metric === 'time' ? 'min' : 'km';
  const small = [...reach.features].reverse();              // kleinste zuerst
  const ring = outerRings(outer.geometry).sort((a, b) => b.length - a.length)[0];
  // Nach Ring (5/10/15 min) einsortieren; Kachel-Treffer erst auf die Fläche beschneiden
  const assign = (p) => {
    const hit = small.find((f) => outerRings(f.geometry).some((r) => insideRing(p.geometry.coordinates, r)));
    p.properties.reach = hit?.properties.value ?? reach.value;
    return p;
  };
  const inside = (points) => points.filter((p) => insideRing(p.geometry.coordinates, ring)).map(assign);
  const render = (points, final) => {
    points.sort((a, b) => a.properties.reach - b.properties.reach);
    showHl({ points });
    if (!points.length) {
      list.innerHTML = `<li class="muted">${final ? `Keine ${esc(cat.label)} erreichbar` : `Suche ${esc(cat.label)} im erreichbaren Bereich …`}</li>`;
      return;
    }
    renderResultList(list, points.slice(0, 80), cat, (p) => `bis ${String(p.properties.reach).replace('.', ',')} ${unit}`);
  };
  // Sofort aus den Kacheln, Overpass ergänzt
  let fromTiles = [];
  const instant = tilePoints(cat, bbox(ring), signal).then((pts) => {
    fromTiles = inside(pts);
    if (reach.cat === cat && fromTiles.length) render(fromTiles, false);
  }).catch(() => {});
  try {
    // Overpass braucht eine einfache Umrandung – die größte Fläche, vereinfacht
    const { points } = await overpass.inPolygon(cat, simplifyTo(ring, 120), { signal });
    await instant;
    if (reach.cat !== cat) return;
    const found = points.map(assign);
    const ids = new Set(found.map((p) => p.properties.id));
    render([...found, ...fromTiles.filter((p) => p.properties.id && !ids.has(p.properties.id))], true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    await instant;
    if (reach.cat !== cat) return;
    if (fromTiles.length) render(fromTiles, true);
    else list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
}

export function clearReach() {
  reachCtl?.abort();
  reach.features = [];
  reach.cat = null;
  showReach(map, []);
  reachMarker?.remove();
  reachMarker = null;
  $('.reach-list').innerHTML = '';
}

{
  const view = $('[data-view="reach"]');
  view.addEventListener('change', (e) => {
    if (e.target.name === 'reach-profile') reach.profile = e.target.value;
    if (e.target.name === 'reach-metric') {
      reach.metric = e.target.value;
      reach.value = reach.metric === 'time' ? 15 : 5;
    }
    paintReachControls();
    computeReach({ fit: true });
  });
  $('.reach-values', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    reach.value = Number(b.dataset.v);
    paintReachControls();
    computeReach({ fit: true });
  });
  $('.reach-cats', view).addEventListener('click', (e) => {
    const cat = byId(e.target.closest('[data-cat]')?.dataset.cat);
    if (!cat) return;
    if (reach.cat?.id === cat.id) {
      reach.cat = null;
      showHl({});
      $('.reach-list').innerHTML = '';
      paintReachControls();
      return;
    }
    searchInReach(cat);
  });
}
