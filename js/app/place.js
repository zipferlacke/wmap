/**
 * Ort im Sheet: Details, Knöpfe, Bild und Preise; Punkt auf der Karte; Verkehrsmeldung.
 */
import { carLink, sendToCar } from '../data/car-link.js';
import { showHighlight } from '../map/map.js';
import * as geocode from '../services/geocode.js';
import { byId } from '../core/categories.js';
import { describePoi, poiCard, categoryFor } from '../ui/poi-info.js';
import * as osm from '../osm/objects.js';
import { placeMedia, fuelPrices, fuelKey } from '../services/media.js';
import { chargerAt } from '../services/charging.js';
import { chargerHtml } from './charging.js';
import { isStop } from '../services/transit.js';
import { places } from '../data/saved.js';
import { share, placeUrl } from '../ui/share.js';
import { toast } from '../ui/dialogs.js';
import { editPlace, addPlace } from '../osm/edit.js';
import { bboxAround, distance, esc } from '../core/geo.js';
import { fmtDms, fmtLatLon, fmtMgrs, fmtPlus, fmtUtm } from '../core/coords.js';
import { local } from '../data/store.js';
import { clearCategory, runCategory } from './category.js';
import { $, afterLayout, chipHtml, current, extentToBounds, fitTo, lastHl, map, markerEl, parseTags, q, releaseLock, sheet, showHl, state, viewPadding } from './core.js';
import { isPoi } from './drive-target.js';
import { showLayerInfo } from './map-clicks.js';
import { nav } from './nav.js';
import { clearReach, openReach, reach } from './reach.js';
import { addVia, enterRoute, leaveRouteMode, setWaypoint } from './route-plan.js';
import { rememberPlace, togglePlace } from './search.js';
import { resetStop, showStop, transitLine } from './stops.js';
import { TRAFFIC_ICON, TRAFFIC_LABEL } from './traffic-along.js';
import { back, closeAll, openSheet, remember, replaceTop, stack } from './views.js';
import { t, locale } from '../core/i18n.js';

/* ── Ort ──────────────────────────────────────────────────────────────────── */

/**
 * Koordinaten jedes Orts, gleich unter dem Namen: Breite/Länge und MGRS (UTMREF – das Gitter von NATO, Bundeswehr,
 * Feuerwehr, THW) immer, aufgeklappt dazu UTM, Plus Code und Grad/Minuten/Sekunden. Ein Tipp kopiert. Ob
 * aufgeklappt, merkt sich WMap.
 */
const MORE_FORMATS = [[t('place.coords.formats.utm'), fmtUtm], [t('place.coords.formats.plus'), fmtPlus], [t('place.coords.formats.dms'), fmtDms]];
const COORDS_OPEN = 'wmap.coordsOpen';
function paintCoords(box, p) {
  const open = !!local.get(COORDS_OPEN, false);
  const btn = (text, icon = 'content_copy') => `<button type="button" class="coord" data-copy="${esc(text)}" title="${t('place.coords.copy')}"><span class="msr">${icon}</span>${esc(text)}</button>`;
  const mgrs = fmtMgrs(p);
  box.innerHTML = `<div class="coord-main">${btn(fmtLatLon(p), 'my_location')}${mgrs ? btn(mgrs, 'grid_4x4') : ''}
      <button type="button" class="coord-more" aria-expanded="${open}" title="${t('place.coords.more')}"><span class="msr">expand_more</span></button></div>
    <dl class="coord-list"${open ? '' : ' hidden'}>${MORE_FORMATS.map(([label, fmt]) => [label, fmt(p)]).filter(([, v]) => v)
      .map(([label, v]) => `<div><dt>${esc(label)}</dt><dd>${btn(v)}</dd></div>`).join('')}</dl>`;
}
{
  const box = $('[data-view="place"] .place-coords');
  box.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const text = copy.dataset.copy;
      navigator.clipboard?.writeText(text).then(() => toast(t('place.coords.copied', { text })), () => toast(t('place.coords.copy_failed')));
      return;
    }
    const more = e.target.closest('.coord-more');
    if (!more) return;
    const open = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(open));
    box.querySelector('.coord-list').hidden = !open;
    local.set(COORDS_OPEN, open);
  });
}

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
  paintCoords($('.place-coords', view), p);
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
    else afterLayout(() => { releaseLock(); map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 16), padding: viewPadding(), duration: 1200 }); });
  }

  // Ohne Namen (Parkplatz, Bank, Toilette …) steht groß, was es ist – nicht „Ort“; die Art klein darunter bleibt
  const unnamed = !f.properties.name && !f.properties._point && !f.properties.street;
  const show = (tags) => {
    const info = describePoi(tags, { name: unnamed ? '' : d.title, fallbackType: d.type });
    facts.innerHTML = info.facts.length || info.status || info.website ? poiCard(info) : '';
    const title = unnamed && (tags.name || tags.brand || info.type);
    if (title) {
      f.properties.name = title;
      $('.place-title', view).textContent = title;
      if (!over) q.value = title;
    }
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
  // Ladesäule aus der Ladesäulen-Datenbank (ohne OSM-ID): Belegung steht schon fest
  if (f.properties._charger) media.insertAdjacentHTML('beforeend', chargerHtml(f.properties._charger));
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

/** Ort aus OSM bearbeiten */
function editCurrentPlace() {
  const f = state.place;
  if (!f?.properties.osm_type || !f.properties.osm_id) return;
  editPlace({
    osm: { type: { N: 'node', W: 'way', R: 'relation' }[f.properties.osm_type] ?? f.properties.osm_type, id: Number(f.properties.osm_id) },
    tags: f.properties._tags ?? {}, point: f.geometry.coordinates, title: geocode.describe(f).title,
  }, { toast }).then(() => { if (state.place === f && f.properties._tags) showPlace(f, { push: false, fly: false, over: !!overState }); });
}

/**
 * Knöpfe je nach Lage: normal Route/Start/Erreichbar, in der Planung
 * Ziel/Zwischenziel/Start, in der Navigation Zwischenstopp.
 */
export function paintPlaceActions() {
  const f = state.place;
  if (!f) return;
  const point = f.geometry.coordinates;
  // Freier Punkt: „Punkt auf der Karte“ (als Wegpunkt später nach der Adresse benannt) – ein geteilter Ort oder
  // geo:-Link behält seinen Namen
  const label = f.properties._point ? (f.properties.name || t('map.point_on_map')) : geocode.describe(f).title;
  const wp = { label, point, me: false, ...(isPoi(f) ? { poi: true } : {}) };
  const toRoute = (fn) => () => { if (stack.at(-1)?.view === 'place') back(); fn(); };
  let list;
  if (nav.active) {
    list = [['add_location_alt', t('place.actions.add_stop'), true, () => { nav.addStop(point); closeAll(); }]];
  } else if (state.mode === 'route') {
    list = [
      ['location_on', t('place.actions.as_destination'), true, toRoute(() => setWaypoint(state.waypoints.length - 1, wp))],
      current() && ['add_location_alt', t('route.form.add_via'), false, toRoute(() => addVia(point, label))],
      ['trip_origin', t('place.actions.as_start'), false, toRoute(() => setWaypoint(0, wp))],
    ];
  } else {
    list = [
      // Route, Teilen, Erreichbar, Merken, Bearbeiten – „Als Start“ gibt es in der Routenplanung
      ['directions', t('place.actions.route'), true, () => enterRoute({ to: wp })],
      // Mit Android Auto verbunden: der Ort geht ans Auto – dort Route, Parkplatz davor und „Los“
      carLink.connected && ['directions_car', t('place.actions.to_car'), false, () => sendToCar({ type: 'place', point, label, poi: !!wp.poi }, toast)],
      ['share', t('place.actions.share'), false, () => share({ title: label, text: label, url: () => placeUrl(point, label), geo: { point, name: label } }, toast)],
      ['radar', t('reach.title'), false, () => openReach({ origin: point, label })],
      ['streetview', t('place.actions.look_around'), false, () => { closeAll(); dispatchEvent(new CustomEvent('wmap:street', { detail: point })); }],
      [places.find(point) ? 'bookmark_added' : 'bookmark_add', places.find(point) ? t('place.actions.saved') : t('place.actions.save'), false,
        () => togglePlace(f, point, label, f.properties._point ? '' : geocode.describe(f).subtitle)],
      // OpenStreetMap: Ort aus OSM bearbeiten, am freien Punkt einen neuen eintragen
      f.properties._point
        ? ['add_business', t('place.actions.add_here'), false, () => addPlace(point, { address: f.properties._address ?? {}, toast })]
        : f.properties.osm_type && f.properties.osm_id && ['edit_location_alt', t('place.actions.edit'), false, () => editCurrentPlace()],
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

const HOUSE_M = 40;

/** Langes Drücken / Rechtsklick (oder Koordinate in der Suche): der Punkt als Ort, Adresse per Rückwärtssuche. */
export function showPoint(point, { fly = false, name = '', zoom = null } = {}) {
  const f = { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { name: name || t('map.point_on_map'), _point: true } };
  showPlace(f, { over: overContext(), fly: fly && !zoom });
  if (fly && zoom) map.flyTo({ center: point, zoom, padding: viewPadding(), duration: 1200 });
  $('[data-view="place"] .place-sub').textContent = t('place.address_searching');
  showLayerInfo(point, $('[data-view="place"] .place-layers'));
  const sub = (text) => { if (state.place === f) $('[data-view="place"] .place-sub').textContent = text; };
  geocode.reverse(point).then((r) => {
    if (state.place !== f) return;
    if (!r) { sub(''); return; }
    // Adresse als Vorschlag, falls hier ein Ort eingetragen wird
    f.properties._address = r.properties;
    const d = geocode.describe(r);
    // Auf ein Haus gedrückt (Adresse mit Hausnummer höchstens 40 m entfernt): Die Adresse ist der Titel, der Ort
    // darunter – auch als Name beim Teilen, Merken und als Wegpunkt. Sonst „Punkt auf der Karte“, „bei …“
    const p = r.properties;
    const house = !name && p.street && p.housenumber && distance(point, r.geometry.coordinates) <= HOUSE_M;
    if (house) {
      // Nur die Adresse – ein Geschäft im Haus (Name des Treffers) ist nicht das, worauf gedrückt wurde
      const address = geocode.describe({ properties: { ...p, name: undefined } });
      f.properties.name = address.title;
      $('[data-view="place"] .place-title').textContent = address.title;
      sub(address.subtitle);
      paintPlaceActions();
      return;
    }
    sub(t('map.near_place', { place: [d.title, d.subtitle].filter(Boolean).join(', ') }));
  }).catch(() => sub(''));
}

/**
 * Bild, Kurzbeschreibung aus Wikipedia, bei Tankstellen aktuelle Preise,
 * bei Ladesäulen Stecker und Belegung. Alles optional; was es nicht gibt, bleibt weg.
 */
async function enrich(tags, point, box, signal) {
  const jobs = [placeMedia(tags, { signal }).then((m) => {
    if (signal.aborted || (!m.image && !m.extract)) return;
    box.insertAdjacentHTML('afterbegin', `
      ${m.image ? `<img class="place-img" src="${esc(m.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      ${m.extract ? `<p class="place-extract">${esc(m.extract)}${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">${t('place.wikipedia')}</a>` : ''}</p>` : ''}`);
    // Kaputte Bildlinks still entfernen
    box.querySelector('.place-img')?.addEventListener('error', (e) => e.target.remove());
  })];
  if (categoryFor(tags)?.id === 'fuel' && fuelKey()) {
    jobs.push(fuelPrices(point, { signal }).then((pr) => {
      if (signal.aborted || !pr) return;
      const eur = (v) => (typeof v === 'number' && v > 0 ? `${v.toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/(\d)$/, '<sup>$1</sup>')} ${t('place.fuel.euro')}` : '–');
      box.insertAdjacentHTML('beforeend', `
        <div class="fuel-prices${pr.open ? '' : ' closed'}">
          <div><small>${t('place.fuel.e5')}</small><strong>${eur(pr.e5)}</strong></div>
          <div><small>${t('place.fuel.e10')}</small><strong>${eur(pr.e10)}</strong></div>
          <div><small>${t('place.fuel.diesel')}</small><strong>${eur(pr.diesel)}</strong></div>
          <p>${pr.open ? t('place.fuel.live') : t('place.fuel.closed')} · ${t('place.fuel.source')}</p>
        </div>`);
    }).catch(() => {}));
  }
  if (categoryFor(tags)?.id === 'charging') {
    jobs.push(chargerAt(point, { signal }).then((s) => {
      if (!signal.aborted && s) box.insertAdjacentHTML('beforeend', chargerHtml(s));
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

export const placeWaypoint = (f) => ({ label: geocode.describe(f).title, point: f.geometry.coordinates, me: false, ...(isPoi(f) ? { poi: true } : {}) });

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
  const d = state.place.properties._point ? { title: t('place.nearby.this_point') } : geocode.describe(state.place);
  runCategory(cat, null, { bounds: bboxAround(state.place.geometry.coordinates, 1500), label: t('map.near_place', { place: d.title }), fit: true });
});


/** Meldung der Autobahn GmbH im Sheet: Art, Abschnitt, Beschreibung. */
export function showTrafficItem(item) {
  overState ??= { hl: lastHl };
  const [icon, color] = TRAFFIC_ICON[item.kind];
  const view = $('[data-view="place"]');
  state.place = null;
  const entry = () => showTrafficItem(item);
  if (stack.at(-1)?.view === 'place') replaceTop('place', entry); else remember('place', entry);
  $('.place-title', view).innerHTML = `<span class="msr" style="color:${color}">${icon}</span> ${esc(TRAFFIC_LABEL[item.kind])}${item.blocked ? ` · ${t('traffic.blocked')}` : ''}`;
  $('.place-sub', view).textContent = `${item.road} ${item.title}`.trim();
  $('.actions', view).replaceChildren();
  $('.place-media', view).replaceChildren();
  $('.nearby-wrap', view).hidden = true;
  $('.place-facts', view).innerHTML = `<p class="traffic-text">${item.lines.slice(0, 14).map(esc).join('<br>')}</p>
    <small class="muted">${t('traffic.source')}</small>`;
  openSheet('place');
  placeMarker?.remove();
  placeMarker = new maplibregl.Marker({ element: markerEl('place', icon), anchor: 'bottom' }).setLngLat(item.point).addTo(map);
}
