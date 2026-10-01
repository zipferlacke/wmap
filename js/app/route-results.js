/**
 * Routen berechnen und zeigen: Auswahl, Höhenprofil, Wegbeschreibung, Bus & Bahn.
 */
import { PROFILES } from '../core/config.js';
import { showRoutes, showPois, showHover, showTraffic } from '../map/map.js';
import { avoidRing } from '../services/traffic.js';
import { routeCategories } from '../core/categories.js';
import { getRoutes, maneuverIcon } from '../services/routing.js';
import { ElevationProfile } from '../ui/elevation.js';
import { recent, tours, shapeOf } from '../data/store.js';
import { journeys, refineJourney } from '../services/departures.js';
import { legBadge, changesText, transitLegsHtml } from '../ui/transit-legs.js';
import { prefs, transitParams } from '../ui/route-prefs.js';
import { connections } from '../data/saved.js';
import { share, routeUrl, clock } from '../ui/share.js';
import { toast } from '../ui/dialogs.js';
import { nearestOnLine, pointAt, simplifyTo, bbox, fmtDistance, fmtDuration, esc } from '../core/geo.js';
import { CAR, $, afterLayout, chipHtml, current, debounce, fitTo, map, myPosition, releaseLock, sheet, state, viewPadding } from './core.js';
import { nav } from './nav.js';
import { compactRoute, isSet, transitWhen } from './route-plan.js';
import { loadTraffic, runAlong } from './traffic-along.js';
import { closeSheet, openSheet } from './views.js';

/* ── Routen berechnen und zeigen ──────────────────────────────────────────── */

export let routeCtl = null;
let altMarkers = [];

export const elevation = new ElevationProfile($('[data-view="route"] .elevation'), {
  onHover(km) {
    const r = current();
    if (!r || km === null) { showHover(map, null); return; }
    // Kilometer des Profils (Valhalla) auf unsere Geometrie umrechnen
    const total = r.cum[r.cum.length - 1];
    showHover(map, pointAt(r.coords, r.cum, km * 1000 * (total / (r.length || total))));
  },
});

export async function computeRoutes() {
  routeCtl?.abort();
  if (state.waypoints.length < 2 || !state.waypoints.every(isSet)) { clearRoutes(); return; }
  routeCtl = new AbortController();
  const { signal } = routeCtl;

  openSheet('route');
  routeStatus('Route wird berechnet …');
  try {
    const points = await Promise.all(state.waypoints.map((w) => (w.me ? myPosition() : w.point)));
    // Bus & Bahn: Verbindungen nach Fahrplan (Zwischenziele zählen hier nicht)
    const routes = PROFILES[state.profile].transit
      ? await journeys(points[0], points.at(-1), { ...transitWhen(), params: transitParams(), change: prefs.change, fastest: prefs.fastest, signal })
      : await getRoutes(points, state.profile, {
        highways: prefs.highways, avoid: state.avoid.map((p) => avoidRing(p)), signal,
      });
    if (signal.aborted) return;
    state.points = points;
    state.routes = routes;
    routeStatus(null);
    compactRoute(true);
    selectRoute(routes[0].id, { fit: true });
    // Im Auto erst mit „Los“ (car/car.js): dort rechnet schon das Ansehen eines Orts die Route –
    // „zuletzt gefahren“ füllte sich sonst mit Zielen, zu denen man nie gefahren ist
    if (!CAR) rememberRoute();
  } catch (err) {
    if (err.name === 'AbortError') return;
    clearRoutes({ keepSheet: true });
    routeStatus(err.message, true);
  }
}

export function clearRoutes({ keepSheet = false } = {}) {
  state.routes = [];
  state.along = null;
  showRoutes(map, [], -1);
  showPois(map, []);
  showTraffic(map, []);
  $('.traffic').hidden = true;
  showHover(map, null);
  altMarkers.forEach((m) => m.remove());
  altMarkers = [];
  const view = $('[data-view="route"]');
  view.classList.add('empty');
  if (!keepSheet && sheet.dataset.current === 'route') closeSheet();
}

function routeStatus(text, error = false) {
  const view = $('[data-view="route"]');
  const el = $('.route-status', view);
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('error', error);
  view.classList.toggle('loading', !!text && !error);
}

/** Alle Routen mittig in den freien Bereich zwischen Suchleiste und Sheet. */
export function fitRoute() {
  const all = state.routes.map((x) => x.bounds);
  if (!all.length) return;
  fitTo([Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))], 16, { flat: true });
}

/** Die geplante Strecke in den Verlauf („Zuletzt genutzt“, letzte Ziele im Auto) */
export function rememberRoute() {
  if (state.waypoints.length < 2) return;
  const wps = state.waypoints.map(({ label, point, me: isMe }) => ({ label, point: isMe ? null : point, me: isMe }));
  recent.add({
    kind: 'route', profile: state.profile, waypoints: wps, from: wps[0], to: wps.at(-1),
    title: `${wps[0].label} → ${wps.at(-1).label}`,
  });
}

/*
 * Das Sheet wächst nach dem Einpassen oft noch (Höhenprofil, Chips laden
 * nach). Solange das kurz nach einer neuen Route passiert, wird neu
 * eingepasst – die Route bleibt mittig im freien Bereich.
 */
let refitUntil = 0;
function fitRouteSettled() {
  refitUntil = Date.now() + 2000;
  afterLayout(fitRoute);
}
new ResizeObserver(debounce(() => {
  if (Date.now() < refitUntil && sheet.dataset.current === 'route' && !nav.active) fitRoute();
}, 150)).observe(sheet);

export function selectRoute(id, { fit = false } = {}) {
  state.selected = id;
  state.leg = null;
  const r = current();
  if (!r) return;
  $('[data-view="route"]').classList.remove('empty');
  showRoutes(map, state.routes, id, state.leg);
  renderRouteSheet();
  altLabels();
  elevation.show(r.transit ? null : r);
  loadTraffic(r);
  if (state.along) runAlong(state.along); else { showPois(map, []); $('.along-list').innerHTML = ''; }
  // Erst wenn das Sheet seine endgültige Höhe hat, ist klar, wie viel Karte übrig ist
  if (fit) fitRouteSettled();
  // Bus & Bahn: echten Verlauf und Fußwege der gewählten Verbindung nachladen
  if (r.transit && !r.refined) {
    refineJourney(r).then((changed) => {
      if (!changed || current() !== r) return;
      showRoutes(map, state.routes, r.id, state.leg);
      const box = $('[data-view="route"] .transit-legs');
      if (box) box.innerHTML = transitLegsHtml(r.transit, state.leg, prefs.change);
    }).catch(() => {});
  }
}

/*
 * Bus & Bahn: oben die Verbindungen (Abfahrt–Ankunft, Linien, Umstiege,
 * „Schnellste“ bzw. „≥ N min umsteigen“), darunter die Abschnitte der
 * gewählten – jeder aufklappbar mit Halten bzw. Fußweg. Ein Abschnitt
 * (in der Liste oder auf der Karte angetippt) wird hervorgehoben und
 * eingepasst.
 */
function transitTags(t) {
  const tags = [];
  if (t.fastest) tags.push(transitWhen().arrive ? 'Späteste Abfahrt' : 'Schnellste');
  if (t.changes && t.relaxed) tags.push(`≥ ${prefs.change} min umsteigen`);
  else if (t.changes && Number.isFinite(t.buffer)) tags.push(`knapp: ${Math.max(0, Math.round(t.buffer))} min umsteigen`);
  return tags;
}

function renderTransitSheet(view, r) {
  const t = r.transit;
  $('.sum-time', view).textContent = `${clock(t.dep)} – ${clock(t.arr)}`;
  $('.sum-dist', view).textContent = `${fmtDuration(r.time)} · ${changesText(t)}`;
  $('.sum-tags', view).innerHTML = transitTags(t).map((x) => `<span class="badge">${esc(x)}</span>`).join('');
  // Die gewählte Verbindung klappt direkt unter sich ihre Abschnitte auf
  $('.route-options', view).innerHTML = state.routes.map((x) => `
    <button type="button" role="option" class="route-opt transit-opt" data-id="${x.id}" aria-selected="${x.id === r.id}">
      <strong>${clock(x.transit.dep)} – ${clock(x.transit.arr)}</strong>
      <span class="legs">${x.transit.legs.filter((l) => !l.walk || l.duration > 300).map(legBadge).join('<span class="msr">chevron_right</span>')}</span>
      <small>${esc([fmtDuration(x.time), changesText(x.transit), ...transitTags(x.transit)].join(' · '))}</small>
    </button>
    ${x.id === r.id ? `<ol class="step-list transit-legs">${transitLegsHtml(t, state.leg, prefs.change)}</ol>` : ''}`).join('');
  $('.along', view).innerHTML = '';
  // Die Wegbeschreibung unten entfällt – sie steht jetzt oben bei der Verbindung
  $('.steps .step-list', view).innerHTML = '';
  const saved = connections.all().some((c) => c.key === t.key);
  $('.transit-actions', view).innerHTML = `
    <button type="button" class="button" data-transit-act="save"${saved ? ' disabled' : ''}><span class="msr">${saved ? 'bookmark_added' : 'bookmark_add'}</span> ${saved ? 'Gemerkt' : 'Merken'}</button>
    ${t.booking ? `<a class="button" href="${esc(t.booking)}" target="_blank" rel="noopener"><span class="msr">confirmation_number</span> Ticket bei der Bahn</a>` : ''}`;
}

/** Abschnitt hervorheben, aufklappen und einpassen (null: alle wieder gleich) */
export function focusTransitLeg(i) {
  const r = current();
  if (!r?.transit) return;
  state.leg = state.leg === i ? null : i;
  showRoutes(map, state.routes, r.id, state.leg);
  const view = $('[data-view="route"]');
  const box = $('.transit-legs', view);
  if (box) box.innerHTML = transitLegsHtml(r.transit, state.leg, prefs.change);
  const l = r.transit.legs[state.leg];
  if (l?.coords.length > 1) {
    fitTo(bbox(l.coords), 17);
    $(`.transit-legs [data-leg="${state.leg}"]`, view)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (state.leg === null) fitRoute();
}

function routeTags(r) {
  const tags = [];
  // „ohne Autobahn“ sagt nur etwas, wenn eine andere Route welche fährt
  const mixed = state.routes.some((x) => x.hasHighway) && state.routes.some((x) => !x.hasHighway);
  if (r.noHighway && mixed) tags.push('ohne Autobahn');
  else if (r.hasHighway) tags.push('Autobahn');
  if (r.hasToll) tags.push('Maut');
  if (r.hasFerry) tags.push('Fähre');
  return tags;
}

function renderRouteSheet() {
  const view = $('[data-view="route"]');
  const r = current();
  view.classList.toggle('transit', !!r.transit);
  if (r.transit) { renderTransitSheet(view, r); return; }
  const climbing = state.profile !== 'car' && r.ascent ? ` · ↗ ${r.ascent} m` : '';
  $('.sum-time', view).textContent = fmtDuration(r.time);
  $('.sum-dist', view).textContent = `${fmtDistance(r.length)}${climbing}`;
  $('.sum-tags', view).innerHTML = routeTags(r).map((t) => `<span class="badge">${esc(t)}</span>`).join('');

  const fastest = Math.min(...state.routes.map((x) => x.time));
  $('.route-options', view).innerHTML = state.routes.length < 2 ? '' : state.routes.map((x) => `
    <button type="button" role="option" class="route-opt" data-id="${x.id}" aria-selected="${x.id === r.id}">
      <strong>${fmtDuration(x.time)}</strong>
      <span>${fmtDistance(x.length)}</span>
      <small>${esc([x.time === fastest ? 'Schnellste' : null, ...routeTags(x)].filter(Boolean).join(' · ') || 'Alternative')}</small>
    </button>`).join('');

  $('.along', view).innerHTML = routeCategories(state.profile)
    .map((c) => chipHtml(c, state.along?.id === c.id)).join('');

  $('.steps .step-list', view).innerHTML = r.maneuvers.map((m, i) => `
    <li><button type="button" data-i="${i}">
      <span class="msr">${maneuverIcon(m)}</span>
      <span class="sg-text"><span>${esc(m.instruction)}</span>
      ${m.length ? `<small>${fmtDistance(m.length * 1000)}</small>` : ''}</span>
    </button></li>`).join('');
}

// Abschnitt der gewählten Verbindung antippen: aufklappen und hinzoomen
$('.route-options').addEventListener('click', (e) => {
  const head = e.target.closest('.leg-head');
  if (!head) return;
  e.stopImmediatePropagation();
  focusTransitLeg(Number(head.closest('[data-leg]').dataset.leg));
});
$('.transit-actions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-transit-act]')?.dataset.transitAct;
  const r = current();
  if (act !== 'save' || !r?.transit) return;
  const wp = (w, p) => ({ label: w.me ? 'Mein Standort' : (w.label || 'Punkt'), point: p });
  connections.save(r, wp(state.waypoints[0], state.points[0]), wp(state.waypoints.at(-1), state.points.at(-1)));
  toast('Verbindung gemerkt – unter Meine Touren → Verbindungen', { action: { label: 'Ansehen', run: () => { location.href = './wege.html?tab=bahn'; } } });
  renderRouteSheet();
});

$('.route-options').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) selectRoute(Number(b.dataset.id));
});

$('.step-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  const r = current();
  if (!b || !r) return;
  const m = r.maneuvers[Number(b.dataset.i)];
  releaseLock();
  map.flyTo({ center: r.coords[m.begin], zoom: 17, padding: viewPadding(), duration: 900 });
});

/** Route als Tour übernehmen und im Tourenplaner öffnen. */
$('.share-route')?.addEventListener('click', async () => {
  const r = current();
  if (!r) return;
  const names = state.waypoints.map((w) => (w.me ? 'meinem Standort' : w.label?.split(',')[0] || 'Punkt'));
  const pts = state.points.length === state.waypoints.length ? state.points : state.waypoints.map((w) => w.point);
  share({
    title: 'Route',
    text: `Route von ${names[0]} nach ${names.at(-1)} (${PROFILES[state.profile].label}, ${fmtDuration(r.time)}, ${fmtDistance(r.length)})`,
    url: () => routeUrl({ profile: state.profile, waypoints: state.waypoints.map((w, i) => ({ ...w, point: w.point ?? pts[i], me: false, label: w.me ? 'Start' : w.label })) }),
  }, toast);
});

$('.save-tour')?.addEventListener('click', () => {
  const r = current();
  if (!r) return;
  const profile = { foot: 'walk', bike: 'tour', car: 'drive' }[state.profile];
  const names = state.waypoints.map((w) => w.label).filter(Boolean);
  const tour = tours.save({
    id: tours.newId(),
    name: names.length >= 2 ? `${names[0]} → ${names.at(-1)}` : 'Neue Tour',
    description: '',
    profile,
    points: state.points,
    shape: shapeOf(simplifyTo(r.coords, 1500)),
    stats: { length: r.length, time: r.time, ascent: r.ascent, descent: r.descent },
  });
  location.href = `./tour.html?id=${encodeURIComponent(tour.id)}`;
});

/** Beschriftung „+12 min“ an der Stelle, wo die Alternative am weitesten abweicht. */
function altLabels() {
  altMarkers.forEach((m) => m.remove());
  altMarkers = [];
  const main = current();
  // Bus & Bahn: die Verbindungen fahren meist denselben Weg – Zeiten stehen in der Liste
  if (main?.transit) return;
  for (const r of state.routes) {
    if (r.id === state.selected) continue;
    let best = null;
    const step = Math.max(1, Math.floor(r.coords.length / 60));
    for (let i = step; i < r.coords.length - step; i += step) {
      const d = nearestOnLine(main.coords, main.cum, r.coords[i]).offset;
      if (!best || d > best.d) best = { d, p: r.coords[i] };
    }
    if (!best) continue;
    const diff = Math.round((r.time - main.time) / 60);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'alt-label';
    el.innerHTML = `<strong>${diff === 0 ? '±0 min' : `${diff > 0 ? '+' : '−'}${fmtDuration(Math.abs(diff) * 60)}`}</strong>`
      + (r.noHighway && state.routes.some((x) => x.hasHighway) ? '<small>ohne Autobahn</small>' : '');
    el.addEventListener('click', (e) => { e.stopPropagation(); selectRoute(r.id); });
    altMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(best.p).addTo(map));
  }
}
