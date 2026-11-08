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
import { CAR, $, afterLayout, chipHtml, current, debounce, fitTo, map, markerEl, myPosition, releaseLock, sheet, state, viewPadding } from './core.js';
import { parkingNear } from './drive-target.js';
import { nav } from './nav.js';
import { compactRoute, isSet, transitWhen } from './route-plan.js';
import { loadTraffic, runAlong } from './traffic-along.js';
import { closeSheet, openSheet } from './views.js';
import { t } from '../core/i18n.js';

/* ── Routen berechnen und zeigen ──────────────────────────────────────────── */

export let routeCtl = null;
let altMarkers = [];
let parkMarker = null;

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
  routeStatus(t('route.status.computing'));
  try {
    const points = await Promise.all(state.waypoints.map((w) => (w.me ? myPosition() : w.point)));
    // Mit dem Auto zu einem Geschäft, Lokal …: gefahren wird bis zum Parkplatz davor (app/drive-target.js)
    const park = PROFILES[state.profile].costing === 'auto' && state.waypoints.at(-1).poi
      ? await parkingNear(points.at(-1), { signal }) : null;
    if (signal.aborted) return;
    const drive = park ? [...points.slice(0, -1), park.point] : points;
    // Bus & Bahn: Verbindungen nach Fahrplan (Zwischenziele zählen hier nicht)
    const routes = PROFILES[state.profile].transit
      ? await journeys(points[0], points.at(-1), { ...transitWhen(), params: transitParams(), change: prefs.change, fastest: prefs.fastest, signal })
      : await getRoutes(drive, state.profile, {
        highways: prefs.highways, avoid: state.avoid.map((p) => avoidRing(p)), signal,
      });
    if (signal.aborted) return;
    state.points = points;
    state.drive = drive;
    state.routes = routes;
    routeStatus(null);
    showPark(park, state.waypoints.at(-1).label);
    compactRoute(true);
    selectRoute(routes[0].id, { fit: true });
    // Im Auto erst mit „Los“ (car/car.js): dort rechnet schon das Ansehen eines Orts die Route –
    // „zuletzt gefahren“ soll nur Ziele enthalten, zu denen man gefahren ist
    if (!CAR) rememberRoute();
  } catch (err) {
    if (err.name === 'AbortError') return;
    clearRoutes({ keepSheet: true });
    // Netzfehler des Browsers („Load failed“, „Failed to fetch“) nie roh zeigen
    const net = err instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(err.message ?? '');
    routeStatus(net ? t('route.status.failed') : err.message, true, { retry: net || !!err.retry });
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
  showPark(null);
  const view = $('[data-view="route"]');
  view.classList.add('empty');
  if (!keepSheet && sheet.dataset.current === 'route') closeSheet();
}

/** Die Fahrt endet am Parkplatz vor dem Ziel: „P“ auf der Karte, ein Satz im Sheet – die Nadel bleibt am Ort */
function showPark(park, label = '') {
  parkMarker?.remove();
  parkMarker = park ? new maplibregl.Marker({ element: markerEl('park', 'local_parking') }).setLngLat(park.point).addTo(map) : null;
  const el = $('[data-view="route"] .route-park');
  el.hidden = !park;
  el.innerHTML = park ? `<span class="msr">local_parking</span> ${t('route.park', { distance: fmtDistance(park.dist), place: esc(label.split(',')[0]) })}` : '';
}

/** `retry`: Server nicht erreichbar o. Ä. – mit Knopf „Erneut versuchen“ (im Auto ohne: dort gibt es keine eigene Oberfläche) */
function routeStatus(text, error = false, { retry = false } = {}) {
  const view = $('[data-view="route"]');
  const el = $('.route-status', view);
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('error', error);
  if (retry && !CAR) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'button route-retry', innerHTML: `<span class="msr">refresh</span> ${t('route.status.retry')}` });
    b.addEventListener('click', () => computeRoutes());
    el.append(b);
  }
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
  const wps = state.waypoints.map(({ label, point, me: isMe, poi }) => ({ label, point: isMe ? null : point, me: isMe, ...(poi ? { poi: true } : {}) }));
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
function transitTags(trip) {
  const tags = [];
  if (trip.fastest) tags.push(transitWhen().arrive ? t('route.tags.latest') : t('route.tags.fastest'));
  if (trip.changes && trip.relaxed) tags.push(t('route.tags.change', { min: prefs.change }));
  else if (trip.changes && Number.isFinite(trip.buffer)) tags.push(t('route.tags.tight', { min: Math.max(0, Math.round(trip.buffer)) }));
  return tags;
}

/*
 * Frühere Verbindungen: nach Ankunft fragen – so kommen die letzten vor der ersten gezeigten ohne Lücke, egal wie
 * weit sie zurückliegen (bei „Abfahrt ab“ müsste man den Abstand raten).
 */
let earlierBusy = false;
async function loadEarlier() {
  const routes = state.routes;
  if (earlierBusy || !routes[0]?.transit) return;
  earlierBusy = true;
  renderRouteSheet();
  const first = routes[0].transit;
  try {
    const list = await journeys(state.points[0], state.points.at(-1), {
      when: new Date(first.arr - 60000), arrive: true, params: transitParams(), change: prefs.change, signal: routeCtl?.signal,
    });
    if (state.routes !== routes) return;
    const known = new Set(routes.map((x) => x.transit.key));
    const found = list.filter((x) => x.transit.dep < first.dep && !known.has(x.transit.key));
    if (found.length) {
      let id = Math.max(...routes.map((x) => x.id));
      for (const x of found) {
        id += 1;
        x.id = id;
        // „Schnellste“ gilt für die zuerst gesuchten – hier hieße es nur: die schnellste dieser Nachfrage
        x.transit.fastest = false;
      }
      state.routes = [...found, ...routes];
      earlierBusy = false;
      selectRoute(state.selected);
      return;
    }
    toast(t('route.earlier.none'));
  } catch (err) {
    if (err.name === 'AbortError' || state.routes !== routes) return;
    toast(t('route.earlier.failed'));
  } finally {
    earlierBusy = false;
  }
  renderRouteSheet();
}

function renderTransitSheet(view, r) {
  const trip = r.transit;
  $('.sum-time', view).textContent = `${clock(trip.dep)} – ${clock(trip.arr)}`;
  $('.sum-dist', view).textContent = `${fmtDuration(r.time)} · ${changesText(trip)}`;
  $('.sum-tags', view).innerHTML = transitTags(trip).map((x) => `<span class="badge">${esc(x)}</span>`).join('');
  // Die gewählte Verbindung klappt direkt unter sich ihre Abschnitte auf
  $('.route-options', view).innerHTML = `<button type="button" class="button transit-earlier" data-earlier${earlierBusy ? ' disabled' : ''}>
      <span class="msr${earlierBusy ? ' spin' : ''}">${earlierBusy ? 'progress_activity' : 'expand_less'}</span> ${t('route.earlier.title')}</button>
    ${state.routes.map((x) => `
    <button type="button" role="option" class="route-opt transit-opt" data-id="${x.id}" aria-selected="${x.id === r.id}">
      <strong>${clock(x.transit.dep)} – ${clock(x.transit.arr)}</strong>
      <span class="legs">${x.transit.legs.filter((l) => !l.walk || l.duration > 300).map(legBadge).join('<span class="msr">chevron_right</span>')}</span>
      <small>${esc([fmtDuration(x.time), changesText(x.transit), ...transitTags(x.transit)].join(' · '))}</small>
    </button>
    ${x.id === r.id ? `<ol class="step-list transit-legs">${transitLegsHtml(trip, state.leg, prefs.change)}</ol>` : ''}`).join('')}`;
  $('.along', view).innerHTML = '';
  // Die Wegbeschreibung unten entfällt – sie steht oben bei der Verbindung
  $('.steps .step-list', view).innerHTML = '';
  const saved = connections.all().some((c) => c.key === trip.key);
  $('.transit-actions', view).innerHTML = `
    <button type="button" class="button" data-transit-act="save"${saved ? ' disabled' : ''}><span class="msr">${saved ? 'bookmark_added' : 'bookmark_add'}</span> ${saved ? t('place.actions.saved') : t('place.actions.save')}</button>
    ${trip.booking ? `<a class="button" href="${esc(trip.booking)}" target="_blank" rel="noopener"><span class="msr">confirmation_number</span> ${t('route.ticket')}</a>` : ''}`;
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
  if (r.noHighway && mixed) tags.push(t('route.tags.no_highway'));
  else if (r.hasHighway) tags.push(t('route.tags.highway'));
  if (r.hasToll) tags.push(t('route.tags.toll'));
  if (r.hasFerry) tags.push(t('route.tags.ferry'));
  return tags;
}

function renderRouteSheet() {
  const view = $('[data-view="route"]');
  const r = current();
  view.classList.toggle('transit', !!r.transit);
  if (r.transit) { renderTransitSheet(view, r); return; }
  const climbing = state.profile !== 'car' && r.ascent ? ` · ${t('route.ascent', { m: r.ascent })}` : '';
  $('.sum-time', view).textContent = fmtDuration(r.time);
  $('.sum-dist', view).textContent = `${fmtDistance(r.length)}${climbing}`;
  $('.sum-tags', view).innerHTML = routeTags(r).map((tag) => `<span class="badge">${esc(tag)}</span>`).join('');

  const fastest = Math.min(...state.routes.map((x) => x.time));
  $('.route-options', view).innerHTML = state.routes.length < 2 ? '' : state.routes.map((x) => `
    <button type="button" role="option" class="route-opt" data-id="${x.id}" aria-selected="${x.id === r.id}">
      <strong>${fmtDuration(x.time)}</strong>
      <span>${fmtDistance(x.length)}</span>
      <small>${esc([x.time === fastest ? t('route.tags.fastest') : null, ...routeTags(x)].filter(Boolean).join(' · ') || t('route.tags.alternative'))}</small>
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
  const wp = (w, p) => ({ label: w.me ? t('map.my_location') : (w.label || t('route.waypoint.point')), point: p });
  connections.save(r, wp(state.waypoints[0], state.points[0]), wp(state.waypoints.at(-1), state.points.at(-1)));
  toast(t('route.connection_saved'), { action: { label: t('common.view'), run: () => { location.href = './wege.html?tab=bahn'; } } });
  renderRouteSheet();
});

$('.route-options').addEventListener('click', (e) => {
  if (e.target.closest('[data-earlier]')) { loadEarlier(); return; }
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
  const names = state.waypoints.map((w) => (w.me ? t('route.share.my_location') : w.label?.split(',')[0] || t('route.waypoint.point')));
  const pts = state.points.length === state.waypoints.length ? state.points : state.waypoints.map((w) => w.point);
  share({
    title: t('route.share.title'),
    text: t('route.share.text', { from: names[0], to: names.at(-1), profile: PROFILES[state.profile].label, time: fmtDuration(r.time), distance: fmtDistance(r.length) }),
    url: () => routeUrl({ profile: state.profile, waypoints: state.waypoints.map((w, i) => ({ ...w, point: w.point ?? pts[i], me: false, label: w.me ? t('route.share.start') : w.label })) }),
  }, toast);
});

$('.save-tour')?.addEventListener('click', () => {
  const r = current();
  if (!r) return;
  const profile = { foot: 'walk', bike: 'tour', car: 'drive' }[state.profile];
  const names = state.waypoints.map((w) => w.label).filter(Boolean);
  const tour = tours.save({
    id: tours.newId(),
    name: names.length >= 2 ? `${names[0]} → ${names.at(-1)}` : t('route.new_tour'),
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
    el.innerHTML = `<strong>${diff === 0 ? t('route.alternative.same') : `${diff > 0 ? '+' : '−'}${fmtDuration(Math.abs(diff) * 60)}`}</strong>`
      + (r.noHighway && state.routes.some((x) => x.hasHighway) ? `<small>${t('route.tags.no_highway')}</small>` : '');
    el.addEventListener('click', (e) => { e.stopPropagation(); selectRoute(r.id); });
    altMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(best.p).addTo(map));
  }
}
