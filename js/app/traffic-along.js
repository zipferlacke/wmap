/**
 * Verkehrslage der Autobahn GmbH und „Entlang der Route“ (Kategorien am Weg).
 */
import { PROFILES } from '../core/config.js';
import { showPois, showTraffic } from '../map/map.js';
import { trafficAlong } from '../services/traffic.js';
import * as overpass from '../services/overpass.js';
import { byId } from '../core/categories.js';
import { reportsIn, reportsShared } from '../nav/reports.js';
import { nearestOnLine, simplifyTo, bbox, fmtDistance, fmtClock, esc } from '../core/geo.js';
import { renderResultList, tilePointsAlong } from './category.js';
import { $, $$, afterLayout, current, map, state, viewPadding } from './core.js';
import { showTrafficItem } from './place.js';
import { computeRoutes } from './route-results.js';

/* ── Verkehrslage (Autobahn) ──────────────────────────────────────────────── */

let trafficCtl = null;
export let trafficItems = [];
export const TRAFFIC_LABEL = {
  closure: 'Sperrung', roadworks: 'Baustelle', warning: 'Meldung', jam: 'Stau', accident: 'Unfall', hazard: 'Gefahr',
};
export const TRAFFIC_ICON = {
  closure: ['block', '#e03131'], roadworks: ['construction', '#f08c00'], warning: ['warning', '#e8590c'],
  jam: ['traffic', '#e8590c'], accident: ['car_crash', '#e03131'], hazard: ['warning', '#e8590c'],
};

export async function loadTraffic(r) {
  const box = $('.traffic');
  trafficCtl?.abort();
  showTraffic(map, []);
  box.hidden = true;
  if (state.profile !== 'car' || !r.hasHighway) return;
  trafficCtl = new AbortController();
  try {
    const items = await trafficAlong(r, { signal: trafficCtl.signal });
    if (current() !== r) return;
    items.forEach((t, i) => { t.i = i; });
    trafficItems = items;
    showTraffic(map, items);
    box.hidden = !items.length;
    const blocked = items.filter((t) => t.blocked);
    const alert = $('.traffic-alert', box);
    alert.hidden = !blocked.length;
    alert.innerHTML = blocked.length ? `<span class="msr">block</span> ${blocked.length === 1 ? 'Eine Vollsperrung' : `${blocked.length} Vollsperrungen`} auf der Route
      <button type="button" class="button primary avoid-closures">Umfahren</button>` : '';
    $('.traffic-list', box).innerHTML = items.map((t, i) => {
      const [icon, color] = TRAFFIC_ICON[t.kind];
      // Zeitraum und Art stehen meist in den ersten Zeilen
      const detail = t.lines.find((l) => /^-\s|gesperrt|Fahrstreifen|Stau|Unfall/i.test(l)) ?? t.lines.find((l) => /\d{2}\.\d{2}\./.test(l)) ?? '';
      return `<li><button type="button" data-i="${i}">
        <span class="dot msr" style="--c:${color}">${icon}</span>
        <span class="sg-text"><strong>${esc(TRAFFIC_LABEL[t.kind])}${t.blocked ? ' · Vollsperrung' : ''}: ${esc(t.road)} ${esc(t.title)}</strong>
        <small>${esc([`bei ${fmtDistance(t.along)}`, t.subtitle, detail.replace(/^-\s*/, '')].filter(Boolean).join(' · '))}</small></span>
      </button></li>`;
    }).join('');
    $('.traffic-list', box).onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const t = items[Number(b.dataset.i)];
      showTrafficItem(t);
      afterLayout(() => map.flyTo({ center: t.point, zoom: 14, padding: viewPadding(), duration: 900 }));
    };
    $('.avoid-closures', box)?.addEventListener('click', () => {
      state.avoid.push(...blocked.map((t) => t.point));
      computeRoutes();
    });
  } catch { /* Verkehrslage ist Zugabe */ }
}

/* ── Entlang der Route ────────────────────────────────────────────────────── */

let alongCtl = null;

$('.along').addEventListener('click', (e) => {
  const cat = byId(e.target.closest('[data-cat]')?.dataset.cat);
  if (!cat) return;
  if (state.along?.id === cat.id) {
    state.along = null;
    alongCtl?.abort();
    showPois(map, []);
    $('.along-list').innerHTML = '';
    $$('.along .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    return;
  }
  runAlong(cat);
});

export async function runAlong(cat) {
  const r = current();
  if (!r) return;
  state.along = cat;
  $$('.along .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === cat.id)));
  const list = $('.along-list');
  list.innerHTML = `<li class="muted">Suche ${esc(cat.label)} entlang der Route …</li>`;

  alongCtl?.abort();
  alongCtl = new AbortController();
  const { signal } = alongCtl;
  const radius = PROFILES[state.profile].radius;
  const still = () => state.along === cat && current() === r && !signal.aborted;
  const render = (points, final) => {
    const near = points.sort((a, b) => a.properties.along - b.properties.along);
    showPois(map, near);
    if (!near.length) {
      list.innerHTML = `<li class="muted">${final ? `Keine ${esc(cat.label)} entlang der Route` : `Suche ${esc(cat.label)} entlang der Route …`}</li>`;
      return;
    }
    renderResultList(list, near.slice(0, 80), cat,
      (p) => `bei ${fmtDistance(p.properties.along)} · ${fmtDistance(p.properties.offset)} abseits`);
  };
  // Sofort aus den Kacheln, Overpass ergänzt
  let fromTiles = [];
  const instant = tilePointsAlong(cat, r, radius, signal).then((pts) => {
    fromTiles = pts;
    if (still() && pts.length) render(pts, false);
  }).catch(() => {});
  try {
    const { points } = await overpass.alongLine(cat, simplifyTo(r.coords, 150), radius, { signal });
    await instant;
    if (!still()) return;
    for (const p of points) {
      const s = nearestOnLine(r.coords, r.cum, p.geometry.coordinates);
      p.properties.along = s.along;
      p.properties.offset = s.offset;
    }
    // Der Korridor der vereinfachten Linie ist etwas großzügig – nachschärfen
    const near = points.filter((p) => p.properties.offset <= radius * 1.3);
    const ids = new Set(near.map((p) => p.properties.id));
    render([...near, ...fromTiles.filter((p) => p.properties.id && !ids.has(p.properties.id))], true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    await instant;
    if (!still()) return;
    if (fromTiles.length) render(fromTiles, true);
    else list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
}


/** Meldungen anderer entlang der Route (nur mit Meldeserver). */
export async function loadSharedReports(route) {
  if (!reportsShared() || !route) return;
  const [w, s, e, n] = bbox(route.coords);
  const items = await reportsIn([w - 0.01, s - 0.01, e + 0.01, n + 0.01]).catch(() => []);
  const near = items.filter((r) => nearestOnLine(route.coords, route.cum, r.point).offset < 60);
  trafficItems = [...trafficItems.filter((t) => !t.shared), ...near.map((r) => ({
    kind: r.kind, shared: true, road: '', title: `${r.count}× gemeldet`, point: r.point, lines: [`Gemeldet von ${r.count} ${r.count === 1 ? 'Person' : 'Personen'}, zuletzt ${fmtClock(new Date(r.at))}`],
  }))].map((t, i) => ({ ...t, i }));
  showTraffic(map, trafficItems);
}
