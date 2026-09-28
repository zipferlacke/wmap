/**
 * Ort im Sheet: Details, Knöpfe, Bild und Preise; Punkt auf der Karte; Verkehrsmeldung.
 */
import { showHighlight } from '../map.js';
import * as geocode from '../geocode.js';
import { byId } from '../categories.js';
import { describePoi, poiCard, categoryFor } from '../poi-info.js';
import * as osm from '../osm.js';
import { placeMedia, fuelPrices, fuelKey } from '../media.js';
import { isStop } from '../transit.js';
import { places } from '../saved.js';
import { share, placeUrl } from '../share.js';
import { toast } from '../ui.js';
import { editPlace, addPlace } from '../osm-edit.js';
import { bboxAround, esc } from '../geo.js';
import { clearCategory, runCategory } from './category.js';
import { $, afterLayout, chipHtml, current, extentToBounds, fitTo, lastHl, map, markerEl, parseTags, q, sheet, showHl, state, viewPadding } from './core.js';
import { showLayerInfo } from './map-clicks.js';
import { nav } from './nav.js';
import { clearReach, openReach, reach } from './reach.js';
import { addVia, enterRoute, leaveRouteMode, setWaypoint } from './route-plan.js';
import { rememberPlace, togglePlace } from './search.js';
import { resetStop, showStop, transitLine } from './stops.js';
import { TRAFFIC_ICON, TRAFFIC_LABEL } from './traffic-along.js';
import { back, closeAll, openSheet, remember, replaceTop, stack } from './views.js';

/* ── Ort ──────────────────────────────────────────────────────────────────── */

let placeMarker = null;
let placeCtl = null;

const NEARBY = ['parking', 'fuel', 'charging', 'restaurant', 'cafe', 'bakery', 'supermarket', 'toilets', 'bus', 'hotel'];

/*
 * Liegt ein Ort über einer anderen Ansicht (Liste, Planung, Navigation),
 * merkt sich overState, was darunter hervorgehoben war.
 */
let overState = null;

/** Darübergelegten Ort vergessen (alles zu – closeAll) */
export function resetOver() { overState = null; }

/** Ortsmarker weg – z. B. wenn die Routenplanung übernimmt */
export function removePlaceMarker() {
  placeMarker?.remove();
  placeMarker = null;
}

/** Gibt es gerade etwas, über das sich ein Ort legen soll? */
export const overContext = () => nav.active || state.mode === 'route' || !!state.category || !!reach.features?.length
  || ['survey', 'navsearch', 'category', 'reach'].includes(sheet.dataset.current);

/** Darübergelegten Ort schließen, die Hervorhebung darunter zurückholen. */
export function closeOver() {
  if (!overState) return;
  transitLine.clear();
  placeMarker?.remove();
  placeMarker = null;
  placeCtl?.abort();
  state.place = null;
  showHl(overState.hl);
  overState = null;
}

/**
 * Ort zeigen: Marker, Sheet mit Details, Hervorhebung der echten Form.
 * @param opts.over  über die aktuelle Ansicht legen (Liste, Planung, Navigation)
 *                   statt sie zu schließen – Zurück führt dorthin
 * @param opts.fly   Karte hinbewegen
 */
export async function showPlace(f, { push = true, fly = true, over = false } = {}) {
  if (!over) {
    leaveRouteMode();
    clearCategory();
    clearReach();
    overState = null;
  } else {
    overState ??= { hl: lastHl };
  }
  state.place = f;
  const d = f.properties._point ? { title: f.properties.name, type: '', subtitle: '' } : geocode.describe(f);
  const p = f.geometry.coordinates;
  if (!over) {
    q.value = d.title;
    $('#q-clear').hidden = false;
  }
  if (push) {
    const entry = () => showPlace(f, { push: false, fly: false, over });
    if (over && stack.at(-1)?.view === 'place') replaceTop('place', entry);
    else remember('place', entry);
    if (!over && !f.properties._point) rememberPlace(f);
  }

  const view = $('[data-view="place"]');
  $('.place-title', view).textContent = d.title;
  $('.place-sub', view).textContent = [d.type, d.subtitle].filter(Boolean).join(' · ');
  $('.nearby', view).innerHTML = NEARBY.map((id) => chipHtml(byId(id))).join('');
  $('.nearby-wrap', view).hidden = nav.active || state.mode === 'route';
  paintPlaceActions();
  const facts = $('.place-facts', view);
  facts.innerHTML = '';
  $('.place-layers', view).innerHTML = '';
  resetStop();
  $('.place-transit', view).innerHTML = '';
  openSheet('place');

  placeMarker?.remove();
  placeMarker = new maplibregl.Marker({ element: markerEl('place', 'location_on'), anchor: 'bottom' })
    .setLngLat(p).addTo(map);

  const bounds = extentToBounds(f.properties.extent);
  if (fly) {
    if (bounds) afterLayout(() => fitTo(bounds));
    else afterLayout(() => map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 16), padding: viewPadding(), duration: 1200 }));
  }

  const show = (tags) => {
    const info = describePoi(tags, { name: d.title, fallbackType: d.type });
    facts.innerHTML = info.facts.length || info.status || info.website ? poiCard(info) : '';
    if (!d.type && info.type) $('.place-sub', view).textContent = [info.type, d.subtitle].filter(Boolean).join(' · ');
  };

  // Über einer Liste bleibt deren Hervorhebung; der Umriss kommt dazu
  const under = over ? overState.hl : {};
  showHl(under);
  const media = $('.place-media', view);
  media.replaceChildren();
  const { osm_type: type, osm_id: id } = f.properties;
  const huge = bounds && (bounds[2] - bounds[0] > 4 || bounds[3] - bounds[1] > 4);
  if (f.properties._tags) { show(f.properties._tags); }
  else if (!f.properties._point) {
    // Erst das, was wir schon wissen – die Details kommen nach
    show(f.properties.osm_key ? { [f.properties.osm_key]: f.properties.osm_value } : {});
  }
  if (!type || !id) return;

  placeCtl?.abort();
  placeCtl = new AbortController();
  const { signal } = placeCtl;
  const still = () => state.place === f && !signal.aborted;

  // Umriss nebenher – bei Relationen (Fluss, Stadt) kann das dauern
  if (!huge) {
    osm.shape(type, id, { signal }).then(({ shapes }) => {
      if (!still()) return;
      const mine = shapes.map((x) => ({ ...x, properties: { ...x.properties, color: '#e8590c' } }));
      showHighlight(map, { shapes: [...(under.shapes ?? []), ...mine], points: under.points ?? [] });
    }).catch(() => {});
  }

  facts.classList.add('loading');
  try {
    const tags = f.properties._tags ?? await osm.tags(type, id, { signal });
    if (!still()) return;
    f.properties._tags = tags;
    show(tags);
    facts.classList.remove('loading');
    if (isStop(tags)) showStop(f, tags, d.title, signal);
    await enrich(tags, p, media, signal);
  } catch { /* Details sind Zugabe */ } finally {
    facts.classList.remove('loading');
  }
}

/**
 * Knöpfe je nach Lage: normal Route/Start/Erreichbar, in der Planung
 * Ziel/Zwischenziel/Start, in der Navigation Zwischenstopp.
 */
export function paintPlaceActions() {
  const f = state.place;
  if (!f) return;
  const point = f.geometry.coordinates;
  const label = f.properties._point ? 'Punkt auf der Karte' : geocode.describe(f).title;
  const wp = { label, point, me: false };
  const toRoute = (fn) => () => { if (stack.at(-1)?.view === 'place') back(); fn(); };
  let list;
  if (nav.active) {
    list = [['add_location_alt', 'Zwischenstopp einlegen', true, () => { nav.addStop(point); closeAll(); }]];
  } else if (state.mode === 'route') {
    list = [
      ['location_on', 'Als Ziel', true, toRoute(() => setWaypoint(state.waypoints.length - 1, wp))],
      current() && ['add_location_alt', 'Zwischenziel', false, toRoute(() => addVia(point, label))],
      ['trip_origin', 'Als Start', false, toRoute(() => setWaypoint(0, wp))],
    ];
  } else {
    list = [
      ['directions', 'Route', true, () => enterRoute({ to: wp })],
      ['trip_origin', 'Als Start', false, () => enterRoute({ from: wp })],
      ['radar', 'Erreichbar', false, () => openReach({ origin: point, label })],
      [places.find(point) ? 'bookmark_added' : 'bookmark_add', places.find(point) ? 'Gemerkt' : 'Merken', false,
        () => togglePlace(f, point, label, f.properties._point ? '' : geocode.describe(f).subtitle)],
      ['share', 'Teilen', false, () => share({ title: label, text: label, url: () => placeUrl(point, label) }, toast)],
      // OpenStreetMap: Ort aus OSM bearbeiten, am freien Punkt einen neuen eintragen
      f.properties._point
        ? ['add_business', 'Hier eintragen', false, () => addPlace(point, { address: f.properties._address ?? {}, toast })]
        : f.properties.osm_type && f.properties.osm_id && ['edit_location_alt', 'Bearbeiten', false, () => editPlace({
          osm: { type: { N: 'node', W: 'way', R: 'relation' }[f.properties.osm_type] ?? f.properties.osm_type, id: Number(f.properties.osm_id) },
          tags: f.properties._tags ?? {}, point, title: label,
        }, { toast }).then(() => { if (state.place === f && f.properties._tags) showPlace(f, { push: false, fly: false, over: !!overState }); })],
    ];
  }
  const box = $('[data-view="place"] .actions');
  box.replaceChildren(...list.filter(Boolean).map(([icon, text, primary, fn]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `button${primary ? ' primary' : ''}`;
    b.innerHTML = `<span class="msr">${icon}</span> ${esc(text)}`;
    b.addEventListener('click', fn);
    return b;
  }));
}

/** Langes Drücken / Rechtsklick: der Punkt als Ort, Name per Rückwärtssuche. */
export function showPoint(point) {
  const f = { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { name: 'Punkt auf der Karte', _point: true } };
  showPlace(f, { over: overContext(), fly: false });
  $('[data-view="place"] .place-sub').textContent = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
  showLayerInfo(point, $('[data-view="place"] .place-layers'));
  geocode.reverse(point).then((r) => {
    if (state.place !== f || !r) return;
    // Adresse als Vorschlag, falls hier ein Ort eingetragen wird
    f.properties._address = r.properties;
    const d = geocode.describe(r);
    $('[data-view="place"] .place-sub').textContent = `bei ${[d.title, d.subtitle].filter(Boolean).join(', ')}`;
  }).catch(() => {});
}

/**
 * Bild, Kurzbeschreibung aus Wikipedia und – bei Tankstellen – aktuelle
 * Preise. Alles optional; was es nicht gibt, bleibt weg.
 */
async function enrich(tags, point, box, signal) {
  const jobs = [placeMedia(tags, { signal }).then((m) => {
    if (signal.aborted || (!m.image && !m.extract)) return;
    box.insertAdjacentHTML('afterbegin', `
      ${m.image ? `<img class="place-img" src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      ${m.extract ? `<p class="place-extract">${esc(m.extract)}${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</p>` : ''}`);
    // Kaputte Bildlinks still entfernen
    box.querySelector('.place-img')?.addEventListener('error', (e) => e.target.remove());
  })];
  if (categoryFor(tags)?.id === 'fuel' && fuelKey()) {
    jobs.push(fuelPrices(point, { signal }).then((pr) => {
      if (signal.aborted || !pr) return;
      const eur = (v) => (typeof v === 'number' && v > 0 ? `${v.toFixed(3).replace('.', ',').replace(/(\d)$/, '<sup>$1</sup>')} €` : '–');
      box.insertAdjacentHTML('beforeend', `
        <div class="fuel-prices${pr.open ? '' : ' closed'}">
          <div><small>Super E5</small><strong>${eur(pr.e5)}</strong></div>
          <div><small>Super E10</small><strong>${eur(pr.e10)}</strong></div>
          <div><small>Diesel</small><strong>${eur(pr.diesel)}</strong></div>
          <p>${pr.open ? 'Preise live' : 'Gerade geschlossen'} · Quelle: MTS-K über Tankerkönig</p>
        </div>`);
    }).catch(() => {}));
  }
  // Abfahrten an Bahnhöfen kommen mit allen anderen Haltestellen aus dem
  // Fahrplan (showStop, EFA) – eine eigene Zugliste wäre doppelt
  await Promise.all(jobs);
}

export function clearPlace() {
  transitLine.clear();
  state.place = null;
  placeMarker?.remove();
  placeMarker = null;
  placeCtl?.abort();
  showHl({});
}

export const placeWaypoint = (f) => ({ label: geocode.describe(f).title, point: f.geometry.coordinates, me: false });

/** Feature im Photon-Format aus einem Overpass-Punkt (Kategorie-Treffer). */
export function featureFromPoint(p) {
  const [type, id] = String(p.properties.id ?? '').split('/');
  const tags = parseTags(p.properties.tags);
  const cat = categoryFor(tags);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p.geometry.coordinates },
    properties: {
      name: p.properties.name || cat?.one, osm_type: { node: 'N', way: 'W', relation: 'R' }[type], osm_id: Number(id),
      // Sofort-Treffer aus den Kacheln kennen nur die Art – Details holt showPlace
      _tags: p.properties.prelim ? undefined : tags,
    },
  };
}

$('.nearby').addEventListener('click', (e) => {
  const cat = byId(e.target.closest('[data-cat]')?.dataset.cat);
  if (!cat || !state.place) return;
  const d = state.place.properties._point ? { title: 'diesem Punkt' } : geocode.describe(state.place);
  runCategory(cat, null, { bounds: bboxAround(state.place.geometry.coordinates, 1500), label: `bei ${d.title}`, fit: true });
});


/** Meldung der Autobahn GmbH im Sheet: Art, Abschnitt, Beschreibung. */
export function showTrafficItem(t) {
  overState ??= { hl: lastHl };
  const [icon, color] = TRAFFIC_ICON[t.kind];
  const view = $('[data-view="place"]');
  state.place = null;
  const entry = () => showTrafficItem(t);
  if (stack.at(-1)?.view === 'place') replaceTop('place', entry); else remember('place', entry);
  $('.place-title', view).innerHTML = `<span class="msr" style="color:${color}">${icon}</span> ${esc(TRAFFIC_LABEL[t.kind])}${t.blocked ? ' · Vollsperrung' : ''}`;
  $('.place-sub', view).textContent = `${t.road} ${t.title}`.trim();
  $('.actions', view).replaceChildren();
  $('.place-media', view).replaceChildren();
  $('.nearby-wrap', view).hidden = true;
  $('.place-facts', view).innerHTML = `<p class="traffic-text">${t.lines.slice(0, 14).map(esc).join('<br>')}</p>
    <small class="muted">Quelle: Autobahn GmbH des Bundes</small>`;
  openSheet('place');
  placeMarker?.remove();
  placeMarker = new maplibregl.Marker({ element: markerEl('place', icon), anchor: 'bottom' }).setLngLat(t.point).addTo(map);
}
