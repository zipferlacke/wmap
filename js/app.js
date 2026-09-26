/**
 * WMap – Einstieg. Verbindet Karte, Suche, Routenplanung, Bottom-Sheet und
 * Navigation. Die Fachlogik steckt in den einzelnen Modulen, hier nur der
 * Ablauf der Oberfläche.
 */
import { PROFILES } from './config.js';
import {
  createMap, showRoutes, showHighlight, showPois, showHover, showReach, ROUTE_COLOR, BASE_POI_LAYERS, osmRef,
  dataSaver, setDataSaver, showTraffic,
} from './map.js';
import { trafficAlong, avoidRing } from './traffic.js';
import { poisInBounds, poisAlong } from './tile-pois.js';
import { keyboardControl } from './keys.js';
import * as geocode from './geocode.js';
import * as overpass from './overpass.js';
import { CATEGORIES, byId, routeCategories, matchCategory } from './categories.js';
import { getRoutes, maneuverIcon, isochrone } from './routing.js';
import { ElevationProfile } from './elevation.js';
import { Navigation, openVoiceDialog, navSettings } from './navigation.js';
import { describePoi, poiCard, categoryFor } from './poi-info.js';
import * as osm from './osm.js';
import { placeMedia, fuelPrices, fuelKey, isTrainStation, trainDepartures } from './media.js';
import { local, recent, tours, shapeOf } from './store.js';
import { Sheet } from './sheet.js';
import { mountAppNav } from './appnav.js';
import { ask } from './ui.js';
import { quickAsk } from './quick-ask.js';
import { report, answered, reportsIn, reportsShared, REPORT_KINDS } from './reports.js';
import { answerParking, anonNotes } from './survey.js';
import { account } from './osm-api.js';
import { SurveyView } from './survey-ui.js';
import { openSettings } from './settings.js';
import { contribute, trace, trips } from './trace.js';
import { finishLogin } from './osm-api.js';
import {
  registerOffline, saveRouteOffline, offlineSetting, rememberNav, forgetNav, savedNav,
} from './offline.js';
import {
  nearestOnLine, pointAt, simplifyTo, bboxAround, bbox, distance, fmtDistance, fmtDuration, fmtClock, esc, cumulative,
} from './geo.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

/*
 * Startansicht: dort weitermachen, wo man aufgehört hat. Liegt der letzte
 * Besuch länger als einen Tag zurück, ist der eigene Standort wahrscheinlich
 * interessanter – dann dorthin, sobald er bekannt ist.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const lastView = local.get('wmap.view');
const freshView = lastView && Date.now() - lastView.at < DAY_MS;
const { map, geolocate } = createMap('map', lastView ? {
  center: lastView.center, zoom: lastView.zoom, pitch: lastView.pitch ?? 0, bearing: lastView.bearing ?? 0,
} : {});

const state = {
  mode: 'search',
  profile: PROFILES[local.get('wmap.profile')]?.nav ? local.get('wmap.profile') : 'car',
  highways: local.get('wmap.highways', true) !== false,
  waypoints: [],        // { label, point: [lon, lat] | null, me: bool }
  points: [],           // aufgelöste Punkte der letzten Berechnung
  routes: [],
  selected: 0,
  place: null,          // gewählter Ort (Photon-Feature oder daraus gebaut)
  category: null,       // { category, bounds, label }
  along: null,          // Kategorie entlang der Route
  avoid: [],            // Punkte, die umfahren werden sollen (Vollsperrungen)
  position: null,       // letzter bekannter Standort
};

const current = () => state.routes.find((r) => r.id === state.selected) ?? null;

// Für die Konsole und Tests: window.__wmap.map
window.__wmap = { map, state };

/* ══════════════════════════════════════════════════════════════════════════
   Hilfen
   ══════════════════════════════════════════════════════════════════════════ */

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Nach dem nächsten Layout – erst dann haben Sheet und Leiste ihre echte Größe. */
const afterLayout = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

/** Kurze Meldung oben; mit `action` bleibt sie länger und hat einen Knopf. */
function toast(text, { action } = {}) {
  let el = $('#toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-action', textContent: action.label });
    b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), action ? 9000 : 3500);
}

geolocate.on('geolocate', (pos) => { state.position = [pos.coords.longitude, pos.coords.latitude]; });

function myPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Standort wird nicht unterstützt')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { state.position = [p.coords.longitude, p.coords.latitude]; resolve(state.position); },
      (err) => (state.position ? resolve(state.position)
        : reject(new Error(err.code === 1 ? 'Standortfreigabe verweigert' : 'Standort nicht verfügbar'))),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

/**
 * Der freie Teil der Karte: unter der Suchleiste, über dem Sheet, links vom
 * Rand, rechts neben den Knöpfen. Alles, was eingepasst wird, landet mittig darin.
 */
function viewPadding() {
  const h = map.getContainer().clientHeight;
  const panel = $('#search').getBoundingClientRect();
  const sheet = $('#sheet');
  // Etwas mehr Luft oben: die Zielnadel ragt über ihren Punkt hinaus
  let top = panel.bottom + 44;
  let bottom = (sheet.open ? sheet.getBoundingClientRect().height : 0) + 24;
  // Bleibt zu wenig übrig, lieber etwas verdecken als gar nichts zeigen
  if (top + bottom > h - 100) bottom = Math.max(24, h - 100 - top);
  if (top + bottom > h - 100) top = 24;
  return { top, bottom, left: 24, right: 64 };
}

/**
 * @param flat  flach und nach Norden (Übersicht einer Route) – die
 *              3D-Automatik kippt die Karte danach nicht gleich wieder
 */
function fitTo([w, s, e, n], maxZoom = 16, { flat = false } = {}) {
  if (flat) map.quietFit = true;
  const padding = viewPadding();
  // Geneigt und mit viel Rand findet MapLibre oft keine Lösung und tut dann
  // gar nichts („cannot fit“). Darum flach einpassen – nah genug dran neigt
  // die 3D-Automatik danach wieder.
  const opts = { padding, maxZoom, pitch: 0, ...(flat ? { bearing: 0 } : {}) };
  if (map.cameraForBounds([[w, s], [e, n]], opts)) {
    map.fitBounds([[w, s], [e, n]], { ...opts, duration: 800 });
  } else {
    // Selten findet MapLibre direkt nach einem Flug mit Gelände keine Lösung –
    // dann den Zoom selbst ausrechnen (Mercator genügt dafür)
    const { clientWidth: cw, clientHeight: ch } = map.getContainer();
    const fw = Math.max(80, cw - padding.left - padding.right);
    const fh = Math.max(80, ch - padding.top - padding.bottom);
    const latRad = (((s + n) / 2) * Math.PI) / 180;
    const zx = Math.log2((fw / 512) * (360 / Math.max(e - w, 1e-6)));
    const zy = Math.log2((fh / 512) * (360 / Math.max((n - s) / Math.cos(latRad), 1e-6)));
    map.flyTo({ center: [(w + e) / 2, (s + n) / 2], zoom: Math.min(maxZoom, zx, zy), pitch: 0, padding, duration: 1000 });
  }
}

/** Photon-Ausdehnung [west, nord, ost, süd] → [west, süd, ost, nord] */
const extentToBounds = (ext) => (ext ? [ext[0], ext[3], ext[2], ext[1]] : null);

function viewBounds() {
  if (map.getZoom() < 11) return { bounds: bboxAround(map.getCenter().toArray(), 5000), label: 'im Umkreis von 5 km' };
  const b = map.getBounds();
  return { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], label: 'im Kartenausschnitt' };
}

const parseTags = (t) => (typeof t === 'string' ? JSON.parse(t || '{}') : t ?? {});

/*
 * Hervorhebung auf der Karte. Die letzte wird gemerkt: Öffnet man aus einer
 * Liste heraus einen Ort, bleibt die Liste darunter – beim Zurück kommt ihre
 * Hervorhebung wieder.
 */
let lastHl = {};
function showHl(data = {}) {
  lastHl = data;
  showHighlight(map, data);
}

/* ══════════════════════════════════════════════════════════════════════════
   Bottom-Sheet mit Zurück
   ══════════════════════════════════════════════════════════════════════════ */

const sheet = $('#sheet');
const sheetCtl = new Sheet(sheet, {
  onResize: () => recenter(),
  topLimit: () => $('#search').getBoundingClientRect().bottom,
});

/*
 * Jede Ansicht, die man öffnet, landet auf einem Stapel – mit einer Funktion,
 * die sie wiederherstellt. „Zurück“ (Knopf im Sheet oder Zurück-Taste des
 * Handys) holt die vorige. Der Browser-Verlauf läuft mit, damit die
 * Zurück-Taste nicht die Seite verlässt.
 */
const stack = [];

function remember(view, restore) {
  stack.push({ view, restore });
  history.pushState({ wmap: stack.length }, '');
  paintBack();
}

function back() {
  if (history.state?.wmap) history.back();   // → popstate → goBack()
  else goBack();
}

function goBack() {
  const popped = stack.pop();
  if (popped?.view === 'place') closeOver();
  const prev = stack.at(-1);
  if (prev) prev.restore(); else closeAll();
  paintBack();
}

window.addEventListener('popstate', () => { if (stack.length) goBack(); });

/**
 * Eine Ansicht ersetzen statt draufzulegen – z. B. ein zweiter Ort direkt
 * nach dem ersten, damit Zurück zur Liste führt und nicht zum ersten Ort.
 */
function replaceTop(view, restore) {
  stack[stack.length - 1] = { view, restore };
  paintBack();
}

function paintBack() {
  $('.sheet-back', sheet).hidden = stack.length < 2;
}

function openSheet(view) {
  if (sheet.dataset.current !== view) sheetCtl.reset();
  $$('.view', sheet).forEach((v) => { v.hidden = v.dataset.view !== view; });
  sheet.dataset.current = view;
  // show() statt showModal(): kein Hintergrund, die Karte bleibt bedienbar
  if (!sheet.open) sheet.show();
  paintBack();
}

function closeSheet() {
  if (sheet.open) sheet.close();
  delete sheet.dataset.current;
}

/** Alles zu: Sheet, Hervorhebungen, Planung. In der Navigation nur das Sheet. */
function closeAll() {
  if (nav.active) {
    stack.length = 0;
    clearPlace();
    overState = null;
    showPois(map, []);
    closeSheet();
    paintBack();
    return;
  }
  stack.length = 0;
  overState = null;
  leaveRouteMode();
  clearPlace();
  clearCategory();
  clearReach();
  q.value = '';
  $('#q-clear').hidden = true;
  closeSheet();
  paintBack();
}

$('.sheet-back', sheet).addEventListener('click', back);
$$('.close-sheet', sheet).forEach((b) => b.addEventListener('click', closeAll));

/** Nach Größenänderung: eine Route bleibt mittig im freien Bereich. */
function recenter() {
  if (sheet.dataset.current === 'route' && current()) fitRoute();
}
window.addEventListener('resize', debounce(recenter, 300));

/* ══════════════════════════════════════════════════════════════════════════
   Vorschläge unter den Eingabefeldern
   ══════════════════════════════════════════════════════════════════════════ */

const suggest = {
  el: $('#suggest'),
  items: [],
  active: -1,

  show(items) {
    this.items = items;
    this.active = -1;
    let section = null;
    this.el.innerHTML = items.map((it, i) => {
      const head = it.section && it.section !== section ? `<li class="sg-section" role="presentation">${esc(it.section)}</li>` : '';
      section = it.section ?? section;
      return `${head}
      <li role="option" id="sg-${i}" data-i="${i}">
        <button type="button" data-i="${i}">
          <span class="msr" style="${it.color ? `color:${esc(it.color)}` : ''}">${esc(it.icon)}</span>
          <span class="sg-text"><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</span>
          ${it.type ? `<span class="sg-type">${esc(it.type)}</span>` : ''}
        </button>
      </li>`;
    }).join('');
    this.el.hidden = !items.length;
  },
  hide() { this.el.hidden = true; this.el.replaceChildren(); this.items = []; this.active = -1; },
  move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    $$('li[data-i]', this.el).forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === this.active));
    $(`li[data-i="${this.active}"]`, this.el)?.scrollIntoView({ block: 'nearest' });
  },
  pick(i = this.active) {
    const it = this.items[i < 0 ? 0 : i];
    this.hide();
    // Noch laufende Suchen verwerfen und den Fokus lösen – sonst taucht die
    // Liste mit einer verspäteten Antwort über dem Ergebnis wieder auf
    searchSeq += 1;
    document.activeElement?.blur?.();
    it?.run();
  },
};
// pointerdown statt click: sonst verliert das Feld vorher den Fokus und die Liste ist weg
suggest.el.addEventListener('pointerdown', (e) => e.preventDefault());
suggest.el.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) suggest.pick(Number(b.dataset.i));
});

function keyNav(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); suggest.move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); suggest.move(-1); }
  else if (e.key === 'Escape') suggest.hide();
  else return false;
  return true;
}

let searchSeq = 0;
let searchCtl = null;

/** Photon-Treffer (und in der Suche: eine passende Kategorie) als Vorschläge. */
async function placeSuggestions(text, onPick, { withCategory = true, extra = [] } = {}) {
  const seq = ++searchSeq;
  const query = text.trim();
  if (query.length < 2) return extra;
  searchCtl?.abort();
  searchCtl = new AbortController();
  let results = [];
  try {
    results = await geocode.search(query, { center: map.getCenter().toArray(), zoom: map.getZoom(), signal: searchCtl.signal });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    toast(err.message);
  }
  if (seq !== searchSeq) return null;

  const places = results.map((f) => {
    const d = geocode.describe(f);
    return { icon: d.icon, title: d.title, subtitle: d.subtitle, type: d.type, run: () => onPick(f) };
  });
  const cat = withCategory ? matchCategory(query, { loose: true }) : null;
  if (!cat) return [...extra, ...places];
  const catItem = {
    icon: cat.category.icon, color: cat.category.color, title: cat.category.label,
    subtitle: cat.place ? `in ${cat.place}` : 'hier in der Gegend', type: 'Kategorie',
    run: () => runCategory(cat.category, cat.place, { rememberAs: query }),
  };
  // „Parkplatz“ oder „Parkplätze in Göttingen“ → Kategorie zuerst;
  // „Park Sanssouci“ → erst der eine Park, die Kategorie danach
  return cat.strong ? [...extra, catItem, ...places] : [...extra, ...places.slice(0, 2), catItem, ...places.slice(2)];
}

/* ── Zuletzt genutzt ──────────────────────────────────────────────────────── */

const RECENT_SECTION = 'Zuletzt genutzt';

/** Einträge aus dem Verlauf als Vorschläge. `onPlace` bekommt das Photon-Feature. */
function recentItems(onPlace, kinds = ['place', 'category', 'route']) {
  return recent.list(kinds).slice(0, 7).map((e) => {
    if (e.kind === 'place') {
      return { section: RECENT_SECTION, icon: e.icon ?? 'history', title: e.title, subtitle: e.subtitle, run: () => onPlace(e.feature) };
    }
    if (e.kind === 'category') {
      const cat = byId(e.category);
      return cat && {
        section: RECENT_SECTION, icon: cat.icon, color: cat.color, title: cat.label, subtitle: e.subtitle, type: 'Kategorie',
        run: () => runCategory(cat, e.place, { rememberAs: e.place ? `${cat.label} in ${e.place}` : cat.label }),
      };
    }
    return {
      section: RECENT_SECTION, icon: PROFILES[e.profile]?.icon ?? 'directions', title: e.title, subtitle: 'Route', type: 'Route',
      run: () => {
        if (PROFILES[e.profile]?.nav) setProfile(e.profile);
        enterRoute({ waypoints: e.waypoints.map((w) => ({ ...w })) });
      },
    };
  }).filter(Boolean);
}

/** Ort in den Verlauf – nur das Nötige des Photon-Features. */
function rememberPlace(f) {
  const d = geocode.describe(f);
  recent.add({
    kind: 'place', title: d.title, subtitle: d.subtitle || d.type, icon: d.icon, point: f.geometry.coordinates,
    feature: { type: 'Feature', geometry: f.geometry, properties: { ...f.properties, _tags: undefined } },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Suche
   ══════════════════════════════════════════════════════════════════════════ */

const q = $('#q');

function discoverItems() {
  return [{
    section: 'Entdecken', icon: 'radar', color: '#2f9e44', title: 'Was ist von hier erreichbar?',
    subtitle: 'in Minuten oder Kilometern ab deinem Standort', run: () => openReach(),
  }];
}

const updateSearchSuggestions = debounce(async () => {
  const text = q.value.trim();
  const items = text.length < 2
    ? [...discoverItems(), ...recentItems((f) => showPlace(f))]
    : await placeSuggestions(q.value, (f) => showPlace(f));
  if (items && document.activeElement === q) suggest.show(items);
}, 160);

q.addEventListener('input', () => {
  $('#q-clear').hidden = !q.value;
  updateSearchSuggestions();
});
q.addEventListener('focus', () => updateSearchSuggestions());
q.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== q) suggest.hide(); }, 150));
q.addEventListener('keydown', keyNav);

/* Enter: mit den Pfeiltasten Gewähltes nehmen, sonst frisch nach genau dem Text suchen */
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (suggest.active >= 0) { suggest.pick(); return; }
  if (!q.value.trim()) return;
  const items = await placeSuggestions(q.value, (f) => showPlace(f));
  suggest.hide();
  q.blur();
  if (items?.length) items[0].run(); else toast('Nichts gefunden');
});

$('#q-clear').addEventListener('click', () => {
  closeAll();
  q.focus();
});

$('#to-route').addEventListener('click', () => {
  enterRoute({ to: state.place ? placeWaypoint(state.place) : null });
});

/* ── Ort ──────────────────────────────────────────────────────────────────── */

let placeMarker = null;
let placeCtl = null;

const NEARBY = ['parking', 'fuel', 'charging', 'restaurant', 'cafe', 'bakery', 'supermarket', 'toilets', 'bus', 'hotel'];

/*
 * Liegt ein Ort über einer anderen Ansicht (Liste, Planung, Navigation),
 * merkt sich overState, was darunter hervorgehoben war.
 */
let overState = null;

/** Gibt es gerade etwas, über das sich ein Ort legen soll? */
const overContext = () => nav.active || state.mode === 'route' || !!state.category || !!reach.features?.length
  || ['survey', 'navsearch', 'category', 'reach'].includes(sheet.dataset.current);

/** Darübergelegten Ort schließen, die Hervorhebung darunter zurückholen. */
function closeOver() {
  if (!overState) return;
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
async function showPlace(f, { push = true, fly = true, over = false } = {}) {
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
    await enrich(tags, p, media, signal);
  } catch { /* Details sind Zugabe */ } finally {
    facts.classList.remove('loading');
  }
}

/**
 * Knöpfe je nach Lage: normal Route/Start/Erreichbar, in der Planung
 * Ziel/Zwischenziel/Start, in der Navigation Zwischenstopp.
 */
function paintPlaceActions() {
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
function showPoint(point) {
  const f = { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { name: 'Punkt auf der Karte', _point: true } };
  showPlace(f, { over: overContext(), fly: false });
  $('[data-view="place"] .place-sub').textContent = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
  geocode.reverse(point).then((r) => {
    if (state.place !== f || !r) return;
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
  if (isTrainStation(tags)) {
    box.insertAdjacentHTML('beforeend', '<section class="departures"><h4><span class="msr">train</span> Abfahrten</h4><p class="muted">Lade …</p></section>');
    const sec = box.querySelector('.departures');
    jobs.push(trainDepartures(tags, { signal }).then((list) => {
      if (signal.aborted) return;
      sec.innerHTML = `<h4><span class="msr">train</span> Abfahrten</h4>${list.length ? `<ul>${list.map((d) => `
        <li class="${d.cancelled ? 'cancelled' : ''}">
          <span class="dep-time">${esc(d.time)}${d.delay ? ` <em class="${d.delay >= 5 ? 'late' : ''}">+${d.delay}</em>` : ''}</span>
          <span class="dep-train">${esc(d.train)}</span>
          <span class="dep-dest">${esc(d.destination)}${d.cancelled ? ' · fällt aus' : ''}</span>
          <span class="dep-platform${d.platformChanged ? ' changed' : ''}">${d.platform ? `Gl. ${esc(d.platform)}` : ''}</span>
        </li>`).join('')}</ul>` : '<p class="muted">Gerade keine Abfahrten</p>'}
        <small class="muted">Züge · Daten: DB (IRIS) über dbf.finalrewind.org</small>`;
    }).catch((err) => { if (!signal.aborted) sec.querySelector('.muted').textContent = err.message; }));
  }
  await Promise.all(jobs);
}

function clearPlace() {
  state.place = null;
  placeMarker?.remove();
  placeMarker = null;
  placeCtl?.abort();
  showHl({});
}

const placeWaypoint = (f) => ({ label: geocode.describe(f).title, point: f.geometry.coordinates, me: false });

/** Feature im Photon-Format aus einem Overpass-Punkt (Kategorie-Treffer). */
function featureFromPoint(p) {
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

/* ── Kategorie ────────────────────────────────────────────────────────────── */

let catCtl = null;

const chipHtml = (cat, pressed = false) => `
  <button type="button" class="chip" data-cat="${cat.id}" aria-pressed="${pressed}" style="--chip:${cat.color}">
    <span class="msr">${cat.icon}</span>${esc(cat.label)}
  </button>`;

/**
 * @param opts.rememberAs  Suchtext – dann kommt die Suche in den Verlauf
 */
async function runCategory(cat, placeText = null, { bounds = null, label = null, fit = false, push = true, rememberAs = null } = {}) {
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
 * Treffer aus den Vektorkacheln – ohne Overpass, also sofort (tile-pois.js).
 * Die Kacheln führen Parkplätze, Tankstellen, Läden usw. als Punkte mit
 * `subclass` (= OSM-Wert). Flächen und Einzelheiten ergänzt Overpass danach.
 */
const TILE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'highway', 'railway', 'historic', 'natural', 'man_made'];

/** Kachel-Punkt → Treffer im Overpass-Format (gleiche Liste, gleiche Symbole). */
function tileHit(cat, { id, props, point }) {
  const sub = props.subclass;
  if (!sub) return null;
  const tags = Object.fromEntries(TILE_KEYS.map((k) => [k, sub]));
  if (categoryFor(tags)?.id !== cat.id) return null;
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
async function tilePointsAlong(cat, route, radius, signal, { from = 0, to = Infinity } = {}) {
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

async function tilePoints(cat, bounds, signal) {
  return dedupeHits((await poisInBounds(map, bounds, { signal })).map((f) => tileHit(cat, f)));
}

function clearCategory() {
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

/** Trefferliste für Kategorie, Erreichbarkeit und „Entlang der Route“. */
function renderResultList(ul, points, cat, meta) {
  ul.innerHTML = points.map((p, i) => {
    const info = describePoi(parseTags(p.properties.tags), { name: p.properties.name });
    const c = cat ?? info.category;
    const known = info.facts.filter((f) => !f.unknown && !f.value.includes('\n')).slice(0, 2).map((f) => f.value);
    return `<li><button type="button" data-i="${i}">
      <span class="dot msr" style="--c:${c?.color ?? '#e8590c'}">${c?.icon ?? 'location_on'}</span>
      <span class="sg-text"><strong>${esc(info.name)}</strong>
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

/* ══════════════════════════════════════════════════════════════════════════
   Erreichbarkeit
   ══════════════════════════════════════════════════════════════════════════ */

const REACH_VALUES = { time: [5, 10, 15, 30, 60], distance: [1, 2, 5, 10, 25] };
const REACH_COLORS = ['#2f9e44', '#f59f00', '#e8590c'];     // innen → außen
const reach = { origin: null, label: 'Mein Standort', profile: 'bike', metric: 'time', value: 15, cat: null, features: [] };
let reachCtl = null;
let reachMarker = null;

function openReach({ origin = null, label = 'Mein Standort' } = {}, { push = true } = {}) {
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

function clearReach() {
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

/* ══════════════════════════════════════════════════════════════════════════
   Routenplanung
   ══════════════════════════════════════════════════════════════════════════ */

const me = () => ({ label: 'Mein Standort', point: null, me: true });
const empty = () => ({ label: '', point: null, me: false });
const isSet = (w) => w.me || !!w.point;

function enterRoute({ to = null, from = null, waypoints = null, push = true } = {}) {
  const wasRoute = state.mode === 'route';
  state.mode = 'route';
  $('#search-form').hidden = true;
  $('#route-form').hidden = false;
  suggest.hide();
  placeMarker?.remove();
  placeMarker = null;
  clearCategory();
  clearReach();
  if (waypoints) state.waypoints = waypoints;
  if (!state.waypoints.length) state.waypoints = [me(), empty()];
  if (from) state.waypoints[0] = from;
  if (to) state.waypoints[state.waypoints.length - 1] = to;
  for (const wp of [from, to]) if (wp?.label === 'Punkt auf der Karte') nameLater(wp);
  if (push && !wasRoute) {
    remember('route', () => {
      if (state.mode !== 'route') enterRoute({ waypoints: state.waypoints.map((w) => ({ ...w })), push: false });
      else if (state.routes.length) openSheet('route');
      else closeSheet();
    });
  }
  renderWaypoints();
  if (state.waypoints.every(isSet)) computeRoutes();
  else {
    closeSheet();
    $$('#waypoints input')[state.waypoints.findIndex((w) => !isSet(w))]?.focus();
  }
}

/** Planung verlassen, ohne das Sheet anzufassen (für Zurück und andere Ansichten). */
function leaveRouteMode() {
  if (state.mode !== 'route') return;
  state.mode = 'search';
  routeCtl?.abort();
  state.waypoints = [];
  state.avoid = [];
  renderWaypoints();
  clearRoutes({ keepSheet: true });
  $('#route-form').hidden = true;
  $('#route-form').classList.remove('compact');
  $('#search-form').hidden = false;
  suggest.hide();
}

/**
 * Nach der Berechnung klappt die Planung zu einer Zeile „Start → Ziel“
 * zusammen – auf dem Handy bleibt mehr Karte. Antippen klappt sie wieder auf.
 */
function compactRoute(on) {
  const form = $('#route-form');
  // Wer gerade tippt, soll nicht plötzlich vor einer Zeile stehen
  if (on && form.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  form.classList.toggle('compact', on);
  if (!on) return;
  const first = state.waypoints[0];
  const last = state.waypoints.at(-1);
  $('.route-line-from').textContent = first?.me ? 'Mein Standort' : first?.label ?? '';
  $('.route-line-to').textContent = `${last?.label ?? ''}${state.waypoints.length > 2 ? ` (+${state.waypoints.length - 2})` : ''}`;
  $('.route-line-profile').textContent = PROFILES[state.profile]?.icon ?? 'directions';
}
$('.route-line-text').addEventListener('click', () => {
  compactRoute(false);
  afterLayout(() => { if (current()) fitRoute(); });
});
$('.route-line-back').addEventListener('click', () => $('#route-close').click());

$('#route-close').addEventListener('click', () => {
  // Kam man von einem Ort, geht es dorthin zurück; sonst alles zu
  if (stack.length > 1) back();
  else closeAll();
});

$('#swap').addEventListener('click', () => {
  state.waypoints.reverse();
  renderWaypoints();
  computeRoutes();
});

$('#add-via').addEventListener('click', () => {
  state.waypoints.splice(state.waypoints.length - 1, 0, empty());
  renderWaypoints();
  $$('#waypoints input')[state.waypoints.length - 2]?.focus();
});

/* Profil (group-radio aus wuefl-libs) und Autobahn (Toggle aus wuefl-libs) */
function setProfile(p) {
  state.profile = p;
  local.set('wmap.profile', p);
  $$('input[name="profile"]').forEach((r) => { r.checked = r.value === p; });
  $('.hw-toggle').hidden = p !== 'car';
}
$$('input[name="profile"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  setProfile(r.value);
  state.along = null;
  computeRoutes();
}));
setProfile(state.profile);

$('#highways').checked = state.highways;
$('#highways').addEventListener('change', (e) => {
  state.highways = e.target.checked;
  local.set('wmap.highways', state.highways);
  computeRoutes();
});

/* Wegpunkte als Eingabefelder und Marker */
let wpMarkers = [];

function wpKind(i) {
  if (i === 0) return { kind: 'start', icon: 'trip_origin', placeholder: 'Start wählen' };
  if (i === state.waypoints.length - 1) return { kind: 'dest', icon: 'location_on', placeholder: 'Ziel wählen' };
  return { kind: 'via', icon: 'radio_button_checked', placeholder: 'Zwischenziel wählen' };
}

function renderWaypoints() {
  const ol = $('#waypoints');
  ol.innerHTML = state.waypoints.map((w, i) => {
    const k = wpKind(i);
    return `<li class="wp ${k.kind}" data-i="${i}">
      <span class="msr wp-icon">${w.me ? 'my_location' : k.icon}</span>
      <input type="text" value="${esc(w.label)}" placeholder="${k.placeholder}" aria-label="${k.placeholder}"
        class="${w.me ? 'is-me' : ''}" enterkeyhint="search">
      ${k.kind === 'via' ? '<button type="button" class="button wp-remove" data-shape="round no-background" title="Entfernen"><span class="msr">close</span></button>' : ''}
    </li>`;
  }).join('');
  $('#add-via').hidden = state.waypoints.length >= 7;

  wpMarkers.forEach((m) => m.remove());
  wpMarkers = state.waypoints.map((w, i) => {
    if (!w.point) return null;
    const k = wpKind(i);
    const m = new maplibregl.Marker({
      element: markerEl(k.kind, k.icon, k.kind === 'via' ? String(i) : ''),
      anchor: k.kind === 'dest' ? 'bottom' : 'center',
      draggable: true,
    }).setLngLat(w.point).addTo(map);
    m.on('dragend', () => {
      setWaypoint(i, { label: 'Punkt auf der Karte', point: m.getLngLat().toArray(), me: false }, { reverse: true });
    });
    return m;
  }).filter(Boolean);
}

function markerEl(kind, icon, text = '') {
  const el = document.createElement('div');
  el.className = `wp-marker ${kind}`;
  el.innerHTML = text ? `<span class="wp-num">${esc(text)}</span>` : `<span class="msr">${icon}</span>`;
  return el;
}

/** Wegpunkt setzen, optional den Namen per Rückwärtssuche nachreichen. */
function setWaypoint(i, wp, { reverse = false } = {}) {
  state.waypoints[i] = wp;
  renderWaypoints();
  computeRoutes();
  const nextEmpty = state.waypoints.findIndex((w) => !isSet(w));
  if (nextEmpty >= 0) $$('#waypoints input')[nextEmpty]?.focus();
  if (reverse) nameLater(wp);
}

/** Für Punkte aus der Karte den Namen per Rückwärtssuche nachreichen. */
function nameLater(wp) {
  if (!wp?.point) return;
  geocode.reverse(wp.point).then((f) => {
    const i = state.waypoints.indexOf(wp);
    if (!f || i < 0) return;
    wp.label = geocode.describe(f).title;
    const input = $$('#waypoints input')[i];
    if (input && document.activeElement !== input) input.value = wp.label;
  }).catch(() => {});
}

const updateRouteSuggestions = debounce(async (input, i) => {
  const extra = [{
    icon: 'my_location', color: ROUTE_COLOR, title: 'Mein Standort', subtitle: 'aktueller GPS-Standort',
    run: () => setWaypoint(i, me()),
  }];
  const onPlace = (f) => setWaypoint(i, placeWaypoint(f));
  const items = input.value.trim().length < 2
    ? [...extra, ...recentItems(onPlace, ['place'])]
    : await placeSuggestions(input.value, onPlace, { withCategory: false, extra });
  if (items && document.activeElement === input) suggest.show(items);
}, 160);

const wpList = $('#waypoints');
wpList.addEventListener('input', (e) => {
  const li = e.target.closest('li');
  if (li) updateRouteSuggestions(e.target, Number(li.dataset.i));
});
wpList.addEventListener('focusin', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName !== 'INPUT') return;
  e.target.select();
  updateRouteSuggestions(e.target, Number(li.dataset.i));
});
wpList.addEventListener('focusout', () => setTimeout(() => {
  if (!wpList.contains(document.activeElement)) suggest.hide();
}, 150));

/*
 * Enter in Start/Ziel: genau nach dem Text im Feld suchen und den ersten
 * Treffer nehmen – nicht den ersten Vorschlag („Mein Standort“ steht dort oben).
 */
wpList.addEventListener('keydown', async (e) => {
  if (keyNav(e)) return;
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (suggest.active >= 0) { suggest.pick(); return; }
  const input = e.target;
  const i = Number(input.closest('li')?.dataset.i);
  const text = input.value.trim();
  if (!text || Number.isNaN(i)) return;
  searchSeq += 1;                      // offene Vorschläge verwerfen
  suggest.hide();
  if (/^mein standort$/i.test(text)) { setWaypoint(i, me()); return; }
  try {
    const [f] = await geocode.search(text, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 });
    if (f) setWaypoint(i, placeWaypoint(f)); else toast(`„${text}“ nicht gefunden`);
  } catch (err) { toast(err.message); }
});
wpList.addEventListener('click', (e) => {
  const rm = e.target.closest('.wp-remove');
  if (!rm) return;
  state.waypoints.splice(Number(rm.closest('li').dataset.i), 1);
  renderWaypoints();
  computeRoutes();
});

/** Zwischenziel an der passenden Stelle entlang der Route einfügen. */
function addVia(point, label) {
  const r = current();
  const at = (p) => (r && p ? nearestOnLine(r.coords, r.cum, p).along : Infinity);
  const target = at(point);
  let pos = state.waypoints.length - 1;
  for (let i = 1; i < state.waypoints.length - 1; i += 1) {
    if (at(state.waypoints[i].point) > target) { pos = i; break; }
  }
  state.waypoints.splice(pos, 0, { label, point, me: false });
  renderWaypoints();
  computeRoutes();
}

/* ── Routen berechnen und zeigen ──────────────────────────────────────────── */

let routeCtl = null;
let altMarkers = [];

const elevation = new ElevationProfile($('[data-view="route"] .elevation'), {
  onHover(km) {
    const r = current();
    if (!r || km === null) { showHover(map, null); return; }
    // Kilometer des Profils (Valhalla) auf unsere Geometrie umrechnen
    const total = r.cum[r.cum.length - 1];
    showHover(map, pointAt(r.coords, r.cum, km * 1000 * (total / (r.length || total))));
  },
});

async function computeRoutes() {
  routeCtl?.abort();
  if (state.waypoints.length < 2 || !state.waypoints.every(isSet)) { clearRoutes(); return; }
  routeCtl = new AbortController();
  const { signal } = routeCtl;

  openSheet('route');
  routeStatus('Route wird berechnet …');
  try {
    const points = await Promise.all(state.waypoints.map((w) => (w.me ? myPosition() : w.point)));
    const routes = await getRoutes(points, state.profile, {
      highways: state.highways, avoid: state.avoid.map((p) => avoidRing(p)), signal,
    });
    if (signal.aborted) return;
    state.points = points;
    state.routes = routes;
    routeStatus(null);
    compactRoute(true);
    selectRoute(routes[0].id, { fit: true });
    const wps = state.waypoints.map(({ label, point, me: isMe }) => ({ label, point: isMe ? null : point, me: isMe }));
    recent.add({
      kind: 'route', profile: state.profile, waypoints: wps, from: wps[0], to: wps.at(-1),
      title: `${wps[0].label} → ${wps.at(-1).label}`,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    clearRoutes({ keepSheet: true });
    routeStatus(err.message, true);
  }
}

function clearRoutes({ keepSheet = false } = {}) {
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
function fitRoute() {
  const all = state.routes.map((x) => x.bounds);
  if (!all.length) return;
  fitTo([Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))], 16, { flat: true });
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

function selectRoute(id, { fit = false } = {}) {
  state.selected = id;
  const r = current();
  if (!r) return;
  $('[data-view="route"]').classList.remove('empty');
  showRoutes(map, state.routes, id);
  renderRouteSheet();
  altLabels();
  elevation.show(r);
  loadTraffic(r);
  if (state.along) runAlong(state.along); else { showPois(map, []); $('.along-list').innerHTML = ''; }
  // Erst wenn das Sheet seine endgültige Höhe hat, ist klar, wie viel Karte übrig ist
  if (fit) fitRouteSettled();
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

  $('.step-list', view).innerHTML = r.maneuvers.map((m, i) => `
    <li><button type="button" data-i="${i}">
      <span class="msr">${maneuverIcon(m)}</span>
      <span class="sg-text"><span>${esc(m.instruction)}</span>
      ${m.length ? `<small>${fmtDistance(m.length * 1000)}</small>` : ''}</span>
    </button></li>`).join('');
}

$('.route-options').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) selectRoute(Number(b.dataset.id));
});

$('.step-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  const r = current();
  if (!b || !r) return;
  const m = r.maneuvers[Number(b.dataset.i)];
  map.flyTo({ center: r.coords[m.begin], zoom: 17, padding: viewPadding(), duration: 900 });
});

/** Route als Tour übernehmen und im Tourenplaner öffnen. */
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

/* ── Verkehrslage (Autobahn) ──────────────────────────────────────────────── */

let trafficCtl = null;
let trafficItems = [];
const TRAFFIC_LABEL = {
  closure: 'Sperrung', roadworks: 'Baustelle', warning: 'Meldung', jam: 'Stau', accident: 'Unfall', hazard: 'Gefahr',
};
const TRAFFIC_ICON = {
  closure: ['block', '#e03131'], roadworks: ['construction', '#f08c00'], warning: ['warning', '#e8590c'],
  jam: ['traffic', '#e8590c'], accident: ['car_crash', '#e03131'], hazard: ['warning', '#e8590c'],
};

async function loadTraffic(r) {
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

async function runAlong(cat) {
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

/* ══════════════════════════════════════════════════════════════════════════
   Karte: Klicks und langes Drücken – alles erscheint unten im Sheet,
   auf der Karte bleibt nur die Markierung
   ══════════════════════════════════════════════════════════════════════════ */

/** Klick auf ein Symbol der Karte selbst (Parkplatz, Laden, Haltestelle …). */
function openBasePoi(feat) {
  const ref = osmRef(feat);
  const pr = feat.properties;
  const point = feat.geometry.coordinates;
  const name = pr['name:de'] ?? pr.name_de ?? pr.name;
  const f = {
    type: 'Feature', geometry: { type: 'Point', coordinates: point },
    properties: {
      name, osm_type: ref?.type, osm_id: ref?.id,
      osm_key: pr.class === 'shop' ? 'shop' : 'amenity', osm_value: pr.subclass,
    },
  };
  showPlace(f, { over: overContext(), fly: false });
}

map.on('contextmenu', (e) => showPoint(e.lngLat.toArray()));

/* Langes Drücken auf dem Handy entspricht dem Rechtsklick */
{
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  map.on('touchstart', (e) => {
    cancel();
    if (e.points.length !== 1) return;
    timer = setTimeout(() => showPoint(e.lngLat.toArray()), 550);
  });
  map.on('touchend', cancel);
  map.on('touchmove', cancel);
  map.on('movestart', cancel);
}

const CLICKABLE = ['traffic-icon', 'poi-dot', 'hl-dot', 'route-alt', 'hl-fill', ...BASE_POI_LAYERS];

/** Meldung der Autobahn GmbH im Sheet: Art, Abschnitt, Beschreibung. */
function showTrafficItem(t) {
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

map.on('click', (e) => {
  // In der Navigation: Orte antippen ja, Routen wechseln nein
  const layers = CLICKABLE.filter((id) => map.getLayer(id) && !(nav.active && id === 'route-alt'));
  const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
  const id = hit?.layer.id;
  if (id === 'traffic-icon') { const t = trafficItems[hit.properties.i]; if (t) showTrafficItem(t); return; }
  if (id === 'poi-dot' || (id === 'hl-dot' && (state.category || reach.cat))) {
    showPlace(featureFromPoint(hit), { over: true, fly: false });
    return;
  }
  if (id === 'route-alt') { selectRoute(Number(hit.properties.id)); return; }
  if (id === 'hl-fill' && state.category) {
    // Fläche angeklickt: den zugehörigen Punkt nehmen (gleiche OSM-ID)
    const pt = map.querySourceFeatures('highlight-points').find((x) => x.properties.id === hit.properties.id);
    if (pt) showPlace(featureFromPoint(pt), { over: true, fly: false });
    return;
  }
  if (BASE_POI_LAYERS.includes(id)) { openBasePoi(hit); return; }
  // Planung: ein Klick in die Karte füllt das erste leere Feld
  if (state.mode === 'route' && !nav.active) {
    const i = state.waypoints.findIndex((w) => !isSet(w));
    if (i >= 0) setWaypoint(i, { label: 'Punkt auf der Karte', point: e.lngLat.toArray(), me: false }, { reverse: true });
  }
});

/* Maus über der Route → Stelle im Höhenprofil */
map.on('mousemove', 'route-main', (e) => {
  const r = current();
  if (!r || nav.active) return;
  const s = nearestOnLine(r.coords, r.cum, e.lngLat.toArray());
  showHover(map, s.point);
  elevation.showAt((s.along / 1000) * ((r.length || 1) / r.cum[r.cum.length - 1]));
});
map.on('mouseleave', 'route-main', () => {
  showHover(map, null);
  elevation.showAt(null);
});

/* ══════════════════════════════════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════════════════════════════════ */

const SIMULATING = new URLSearchParams(location.search).has('sim');
const nav = new Navigation(map, $('#nav'), {
  onExit({ arrived }) {
    forgetNav();
    // Mitmachen: Fahrt abschließen und schauen, ob es Fragen gibt
    if (trips.end({ arrived })) askAfterTrip();
    // Nach dem Fortsetzen (neu geladen) gibt es keine geplanten Routen mehr
    if (!current()) return;
    openSheet('route');
    selectRoute(state.selected, { fit: true });
  },
  onRoute(route, { again, ...opts }) {
    rememberNav({ route, ...opts, destination: navDestination });
    if (!again) loadSharedReports(route);
    // again: nur Spuren/Tempolimits nachgeladen – Karte ist schon gespeichert
    if (!again) keepOffline(route);
  },
  onSearch: () => openNavSearch(),
  // Simulierte Fahrten (?sim) nicht aufzeichnen – dort war niemand
  onFix: (fix) => {
    if (!SIMULATING) trace.add(fix);
    checkTrafficPassed(fix.point);
  },
  onArrive: (point, profile) => { if (profile === 'car') askParking(point); },
  onReport: (point) => reportHere(point),
  onReroute: (ev) => trips.reroute(ev),
});

let navDestination = '';
$('.start-nav').addEventListener('click', async () => {
  const r = current();
  if (!r) return;
  await askContributeOnce();
  navDestination = state.waypoints.at(-1)?.label ?? '';
  suggest.hide();
  closeSheet();
  if (!SIMULATING) trips.start({ profile: state.profile, destination: navDestination });
  nav.start(r, { profile: state.profile, highways: state.highways, targets: state.points.slice(1) });
});

/*
 * Offline: Karte entlang der Route vorladen, damit Funklöcher unterwegs
 * nicht auffallen. Nicht im Datensparmodus und nicht, wenn abgeschaltet.
 */
let offlineJob = null;
const offlineBadge = $('#nav .nav-offline');
function paintOffline(state, text = '') {
  const [icon, title] = {
    loading: ['download', 'Karte für die Strecke wird gespeichert'],
    ok: ['offline_pin', 'Karte für die Strecke ist offline gespeichert'],
    off: ['cloud_off', 'Offline – neu berechnen geht erst wieder mit Netz'],
  }[state] ?? [];
  offlineBadge.hidden = !icon;
  offlineBadge.className = `nav-offline ${state ?? ''}`;
  offlineBadge.title = title ?? '';
  if (icon) offlineBadge.innerHTML = `<span class="msr">${icon}</span>${esc(text)}`;
}
async function keepOffline(route) {
  if (!offlineSetting.get() || dataSaver() || !navigator.onLine) return;
  const job = offlineJob = {};
  paintOffline('loading', '0 %');
  try {
    const res = await saveRouteOffline(map, route, {
      onProgress: (done, total) => { if (offlineJob === job) paintOffline('loading', `${Math.round((done / total) * 100)} %`); },
    });
    if (offlineJob !== job) return;
    paintOffline(res.failed ? null : 'ok');
  } catch { if (offlineJob === job) paintOffline(null); }
}
window.addEventListener('offline', () => { if (nav.active) paintOffline('off'); });
window.addEventListener('online', () => { if (nav.active) paintOffline(null); });

/* ══════════════════════════════════════════════════════════════════════════
   Unterwegs kurz fragen und melden – wie bei Google
   ══════════════════════════════════════════════════════════════════════════ */

/** Was mit einer Antwort passiert – steht klein unter der Frage. */
function whereItGoes() {
  if (account.loggedIn()) return 'Geht mit deinem OSM-Konto direkt in die Karte.';
  return anonNotes.get() ? 'Geht ohne Konto als Hinweis an OpenStreetMap.' : 'Wird gespeichert, bis du dich bei OSM anmeldest.';
}

/*
 * An einer gemeldeten Baustelle, Sperrung oder einem Stau vorbei: danach
 * einmal fragen, ob sie noch da ist. Erst nah dran (150 m), dann weiter weg
 * (250 m) – so fragt es erst, wenn man es gesehen hat.
 */
const passing = new Map();
function checkTrafficPassed(point) {
  if (!nav.active || !contribute.get()) return;
  for (const t of trafficItems) {
    const ref = `t:${t.road}|${t.title}|${t.point.map((v) => v.toFixed(4)).join(',')}`;
    const d = distance(point, t.point);
    if (d < 150) passing.set(ref, true);
    else if (d > 250 && passing.get(ref) && !answered(ref)) {
      passing.set(ref, false);
      askStillThere(t, ref);
    }
  }
}

async function askStillThere(t, ref) {
  const kind = t.kind === 'warning' ? 'hazard' : t.kind;
  const title = { roadworks: 'Ist die Baustelle noch da?', closure: 'Ist hier noch gesperrt?', jam: 'Ist hier noch Stau?',
    accident: 'Ist der Unfall noch da?' }[t.kind] ?? 'Gibt es hier noch eine Behinderung?';
  const v = await quickAsk({
    icon: TRAFFIC_ICON[t.kind]?.[0] ?? 'warning', title, sub: [t.road, t.title].filter(Boolean).join(' '),
    options: [{ value: 'yes', label: 'Ja', icon: 'check' }, { value: 'no', label: 'Nein', icon: 'close' }],
    note: reportsShared() ? 'Hilft allen, die hier später fahren.' : '',
  });
  if (!v) return;
  await report({ kind, point: t.point, answer: v, ref });
  toast('Danke!');
}

/** „Melden“ in der Navigation: was ist hier los? */
async function reportHere(point) {
  if (!point) return;
  const v = await quickAsk({
    icon: 'add_alert', title: 'Was möchtest du melden?', timeout: 20000,
    options: Object.entries(REPORT_KINDS).map(([value, k]) => ({ value, label: k.label, icon: k.icon })),
    note: reportsShared() ? 'Andere sehen deine Meldung für ein paar Stunden.'
      : 'Noch ohne Meldeserver – die Meldung bleibt vorerst auf diesem Gerät.',
  });
  if (!v) return;
  const res = await report({ kind: v, point });
  toast(res.shared ? `${REPORT_KINDS[v].label} gemeldet – danke!` : `${REPORT_KINDS[v].label} vermerkt`);
}

/** Meldungen anderer entlang der Route (nur mit Meldeserver). */
async function loadSharedReports(route) {
  if (!reportsShared() || !route) return;
  const [w, s, e, n] = bbox(route.coords);
  const items = await reportsIn([w - 0.01, s - 0.01, e + 0.01, n + 0.01]).catch(() => []);
  const near = items.filter((r) => nearestOnLine(route.coords, route.cum, r.point).offset < 60);
  trafficItems = [...trafficItems.filter((t) => !t.shared), ...near.map((r) => ({
    kind: r.kind, shared: true, road: '', title: `${r.count}× gemeldet`, point: r.point, lines: [`Gemeldet von ${r.count} ${r.count === 1 ? 'Person' : 'Personen'}, zuletzt ${fmtClock(new Date(r.at))}`],
  }))].map((t, i) => ({ ...t, i }));
  showTraffic(map, trafficItems);
}

/*
 * Am Ziel mit dem Auto: Parkplatz in der Nähe? Dann kurz nachfragen, was in
 * OSM noch fehlt – kostenlos? wie teuer? für alle? – und optional ein
 * Vermerk für andere.
 */
async function askParking(dest) {
  if (!contribute.get() || !navigator.onLine) return;
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi', filter: ['==', ['get', 'class'], 'parking'] });
  let best = null;
  for (const f of feats) {
    const d = distance(dest, f.geometry.coordinates);
    if (d < 200 && (!best || d < best.d)) best = { f, d };
  }
  const ref = best && osmRef(best.f);
  if (!ref) return;
  let tags;
  try { tags = await osm.tags(ref.type, ref.id); } catch { return; }
  if (tags.amenity !== 'parking' || (tags.fee && tags.access)) return;
  const osmType = { N: 'node', W: 'way', R: 'relation' }[ref.type] ?? ref.type;
  const p = { osm: { type: osmType, id: Number(ref.id) }, name: tags.name ?? 'Parkplatz', point: best.f.geometry.coordinates, tags };
  const what = tags.name ? `„${tags.name}“` : 'der Parkplatz hier';
  const note = whereItGoes();
  const out = {};

  if (!tags.fee) {
    const fee = await quickAsk({
      icon: 'local_parking', title: `Ist ${what} kostenlos?`, sub: 'Du bist gerade angekommen', note,
      options: [{ value: 'no', label: 'Kostenlos', icon: 'money_off', primary: true }, { value: 'yes', label: 'Kostet etwas', icon: 'payments' }, { value: '?', label: 'Weiß nicht' }],
    });
    if (!fee) return;
    if (fee !== '?') out.fee = fee;
    if (fee === 'yes') {
      const price = await quickAsk({
        icon: 'payments', title: 'Wie viel ungefähr?', note,
        options: [...['1', '1.5', '2', '3'].map((v) => ({ value: v, label: `${v.replace('.', ',')} €/Std.` })), { value: 'other', label: 'Anders …' }],
      });
      if (price === 'other') {
        const text = await quickAsk({ icon: 'payments', title: 'Was kostet es?', input: true, placeholder: 'z. B. 1,50 € pro Stunde oder 6 € am Tag', timeout: 60000 });
        const m = text?.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\s*(?:pro|je|\/)?\s*(stunde|std|h|tag|d)?/i);
        if (m) out.charge = `${Number(m[1].replace(',', '.')).toFixed(2)} EUR/${/^(tag|d)$/i.test(m[2] ?? '') ? 'day' : 'hour'}`;
        else if (text) out.remark = `Preis: ${text}`;
      } else if (price) out.charge = `${Number(price).toFixed(2)} EUR/hour`;
    }
  }
  if (!tags.access) {
    const access = await quickAsk({
      icon: 'lock_open', title: 'Kann dort jeder parken?', note,
      options: [{ value: 'yes', label: 'Ja, alle', primary: true }, { value: 'customers', label: 'Nur Kunden' }, { value: 'private', label: 'Privat' }],
    });
    if (access) out.access = access;
  }
  if (Object.keys(out).length) {
    const remark = await quickAsk({
      icon: 'edit_note', title: 'Noch etwas für andere?', sub: 'z. B. Schranke, Höhenbegrenzung, nur bis 20 Uhr', input: true,
      placeholder: 'Vermerk (freiwillig)', options: [{ value: '', label: 'Nein, danke' }], timeout: 20000,
    });
    if (remark) out.remark = [out.remark, remark].filter(Boolean).join(' · ');
    answerParking(p, out);
    survey.sync();
    toast('Danke! Das hilft allen, die hier parken wollen.');
  }
}

/* Unterwegs: was liegt vor mir an der Strecke? */
let navSearchCtl = null;
function openNavSearch() {
  if (!nav.active) return;
  stack.length = 0;
  remember('navsearch', () => openSheet('navsearch'));
  const view = $('[data-view="navsearch"]');
  $('.navsearch-cats', view).innerHTML = routeCategories(nav.profile).map((c) => chipHtml(c)).join('');
  $('.navsearch-list', view).innerHTML = '';
  openSheet('navsearch');
}
$('.navsearch-cats').addEventListener('click', async (e) => {
  const cat = byId(e.target.closest('[data-cat]')?.dataset.cat);
  const r = nav.route;
  if (!cat || !r) return;
  $$('.navsearch-cats .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === cat.id)));
  const list = $('.navsearch-list');
  list.innerHTML = `<li class="muted">Suche ${esc(cat.label)} vor dir …</li>`;
  navSearchCtl?.abort();
  navSearchCtl = new AbortController();
  // Nur, was noch vor einem liegt (höchstens 150 km)
  const from = nav.along;
  const startI = nearestOnLine(r.coords, r.cum, pointAt(r.coords, r.cum, from)).index;
  let endI = r.cum.findIndex((m) => m > from + 150000);
  if (endI < 0) endI = r.coords.length;
  const rest = r.coords.slice(startI, endI);
  const { signal } = navSearchCtl;
  const radius = PROFILES[nav.profile]?.radius ?? 400;
  const render = (points, final) => {
    const ahead = points.filter((p) => p.properties.along > 0).sort((a, b) => a.properties.along - b.properties.along);
    showPois(map, ahead);
    if (!ahead.length) {
      list.innerHTML = `<li class="muted">${final ? `Keine ${esc(cat.label)} vor dir an der Strecke` : `Suche ${esc(cat.label)} vor dir …`}</li>`;
      return;
    }
    renderResultList(list, ahead.slice(0, 60), cat, (p) => `in ${fmtDistance(p.properties.along)} · ${fmtDistance(p.properties.offset)} abseits`);
  };
  // Sofort aus den Kacheln (meist schon offline gespeichert), Overpass ergänzt
  let fromTiles = [];
  const instant = tilePointsAlong(cat, r, radius, signal, { from, to: from + 150000 }).then((pts) => {
    fromTiles = pts.map((p) => ({ ...p, properties: { ...p.properties, along: p.properties.along - from } }));
    if (!signal.aborted && fromTiles.length) render(fromTiles, false);
  }).catch(() => {});
  try {
    const { points } = await overpass.alongLine(cat, simplifyTo(rest, 150), radius, { signal });
    await instant;
    if (signal.aborted) return;
    const near = points.map((p) => {
      const s = nearestOnLine(r.coords, r.cum, p.geometry.coordinates, startI, endI);
      Object.assign(p.properties, { along: s.along - from, offset: s.offset });
      return p;
    }).filter((p) => p.properties.offset <= radius * 1.3);
    const ids = new Set(near.map((p) => p.properties.id));
    render([...near, ...fromTiles.filter((p) => p.properties.id && !ids.has(p.properties.id))], true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    await instant;
    if (fromTiles.length) render(fromTiles, true);
    else list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
});

/* Nach einem Neuladen mitten in der Fahrt (auch offline): weiter navigieren? */
async function resumeNav() {
  const saved = savedNav();
  // Ein Link mit eigenem Ziel (auch die Screenshots) geht vor
  if (!saved || nav.active || /[?&](view|q|from|to|reach)=/.test(location.search)) return;
  const answer = await ask({
    icon: 'navigation', title: 'Navigation fortsetzen?',
    text: saved.destination ? `Weiter nach ${saved.destination}.` : 'Die letzte Fahrt wurde nicht beendet.',
    buttons: [{ value: 'no', label: 'Beenden' }, { value: 'yes', label: 'Fortsetzen', icon: 'navigation', primary: true }],
  });
  if (answer !== 'yes') { forgetNav(); return; }
  const route = { ...saved.route, cum: cumulative(saved.route.coords) };
  navDestination = saved.destination ?? '';
  if (!SIMULATING) trips.start({ profile: saved.profile, destination: navDestination });
  nav.start(route, { profile: saved.profile, highways: saved.highways, targets: saved.targets });
}
registerOffline();

/* ══════════════════════════════════════════════════════════════════════════
   Startansicht, Menü oben rechts, Maße
   ══════════════════════════════════════════════════════════════════════════ */

// Mit Link-Parametern (siehe fromUrl) bestimmt der Link, wohin es geht
if (!freshView && !/[?&](view|q|from|to|reach)=/.test(location.search)) {
  myPosition()
    .then((p) => map.flyTo({ center: p, zoom: 14, pitch: 0, duration: 1800 }))
    .catch(() => { /* ohne Standort bleibt die letzte bzw. die Startansicht */ });
}

map.on('moveend', debounce(() => {
  if (nav.active) return;
  local.set('wmap.view', {
    center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), at: Date.now(),
  });
}, 400));

keyboardControl(map, {
  onManual: () => nav.pauseFollow(),
  onEscape: () => { if (!nav.active) return false; nav.resumeFollow(); return true; },
});

function keysDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog confirm';
  const rows = [['W / S', 'vor / zurück'], ['A / D', 'nach links / rechts'], ['Q / E', 'drehen'],
    ['R / F', 'nach oben / unten schauen'], ['Leertaste', 'höher'], ['Shift', 'tiefer'],
    ['Esc', 'normale Ansicht – in der Navigation: zum eigenen Standort']];
  dlg.innerHTML = `<h2><span class="msr">keyboard</span> Tastatur</h2>
    <table class="keys-table">${rows.map(([k, v]) => `<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`).join('')}</table>
    <div class="confirm-actions"><button type="button" class="button primary" value="ok">Verstanden</button></div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target.closest('button')) { dlg.close(); dlg.remove(); } });
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.showModal();
}

const appNav = mountAppNav();
appNav.addItem('radar', 'Erreichbarkeit', () => openReach());
const surveyItem = appNav.addItem('volunteer_activism', 'Mitmachen', () => openSurvey());
appNav.addItem('keyboard', 'Tastatur', keysDialog);
appNav.addItem('settings', 'Einstellungen', () => openSettings({
  toast,
  dataSaver,
  setDataSaver: (on) => {
    setDataSaver(map, on);
    toast(on ? 'Datensparmodus an – keine 3D-Höhendaten' : 'Datensparmodus aus');
  },
  onVoice: openVoiceDialog,
  onFuelKey: () => {
    const key = prompt('Tankerkönig-API-Schlüssel (kostenlos unter creativecommons.tankerkoenig.de).\n'
      + 'Er bleibt nur in diesem Browser gespeichert. Leer lassen zum Entfernen.', fuelKey());
    if (key === null) return;
    local.set('wmap.tankerkoenig', key.trim());
    toast(key.trim() ? 'Spritpreise eingerichtet' : 'Spritpreise ausgeschaltet');
  },
  onClearHistory: () => { recent.clear(); toast('Verlauf gelöscht'); },
  onContribute: () => { paintSurveyCount(survey.count); if (sheet.dataset.current === 'survey') survey.render(); },
}));

/* ══════════════════════════════════════════════════════════════════════════
   Mitmachen bei OpenStreetMap
   ══════════════════════════════════════════════════════════════════════════ */

const survey = new SurveyView($('[data-view="survey"]'), { map, toast, onCount: paintSurveyCount });

function paintSurveyCount(n) {
  surveyItem.innerHTML = `<span class="msr">volunteer_activism</span>Mitmachen${n ? ` <span class="badge">${n}</span>` : ''}`;
  appNav.el.querySelector('.appnav-btn').classList.toggle('has-badge', n > 0);
}
paintSurveyCount(survey.count);

function openSurvey({ push = true } = {}) {
  leaveRouteMode();
  clearPlace();
  clearCategory();
  clearReach();
  if (push) remember('survey', () => openSurvey({ push: false }));
  openSheet('survey');
  survey.render();
  survey.refresh();
}

/** Nach einer Fahrt: Fragen suchen und anbieten. */
async function askAfterTrip() {
  const n = await survey.refresh();
  if (n) toast(`${n} ${n === 1 ? 'kurze Frage' : 'kurze Fragen'} zu deinem Weg`, { action: { label: 'Ansehen', run: () => openSurvey() } });
}

/** Beim ersten Navigieren einmal erklären, dass der Weg aufgezeichnet wird. */
async function askContributeOnce() {
  // Simulation (Screenshots, Tests): nichts dazwischenschieben
  if (!contribute.get() || local.get('wmap.contribute.seen') || SIMULATING) return;
  local.set('wmap.contribute.seen', true);
  const v = await ask({
    icon: 'volunteer_activism', title: 'Mitmachen bei OpenStreetMap',
    text: 'WMap merkt sich deinen Weg auf diesem Gerät und stellt dir danach kurze Fragen – etwa, ob der '
      + 'Parkplatz etwas kostet oder die Bäckerei noch so geöffnet hat. Deine Antworten verbessern die Karte '
      + 'für alle. Die Aufzeichnung verlässt das Gerät nicht und lässt sich in den Einstellungen abschalten.',
    buttons: [{ value: 'no', label: 'Nicht aufzeichnen' }, { value: 'yes', label: 'Einverstanden', primary: true }],
  });
  if (v === 'no') contribute.set(false);
}

// Standort auch ohne Navigation (Knopf „Mein Standort“, z. B. beim Spaziergang)
geolocate.on('geolocate', (pos) => trace.add({
  point: [pos.coords.longitude, pos.coords.latitude], accuracy: pos.coords.accuracy,
}));

// Rückkehr von der OSM-Anmeldung ohne Popup
finishLogin().then((user) => {
  if (!user) return;
  toast(`Angemeldet als ${user.name}`);
  openSurvey();
  survey.sync({ loud: true });
}).catch((err) => toast(err.message));

// Beim Start: Liegengebliebenes hochladen und nach neuen Fragen sehen
setTimeout(() => { survey.sync(); survey.refresh(); }, 4000);

/* Suchleiste: Controls rechts oben rücken darunter (mobil) */
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--panel-h', `${Math.round($('#search').getBoundingClientRect().bottom)}px`);
}).observe($('#search'));

/* Kategorien für die Hilfe im Suchfeld */
q.title = `Auch Kategorien: ${CATEGORIES.slice(0, 12).map((c) => c.one).join(', ')} …`;

/* ══════════════════════════════════════════════════════════════════════════
   Aufruf per Link
   ?view=lon,lat,zoom,neigung,richtung   Kamera
   ?q=Parkplatz                           Suche
   ?from=Göttingen&to=Kassel&profile=bike Route (auch „lon,lat“)
   ?reach=lon,lat                         Erreichbarkeit ab einem Punkt
   ?action=route                          Planung öffnen (App-Verknüpfung)
   Auch für die Screenshots in tools/takeshots.json.
   ══════════════════════════════════════════════════════════════════════════ */

async function fromUrl() {
  const p = new URLSearchParams(location.search);
  const view = p.get('view')?.split(',').map(Number);
  if (view?.length >= 3 && view.every(Number.isFinite)) {
    map.jumpTo({ center: [view[0], view[1]], zoom: view[2], pitch: view[3] ?? 0, bearing: view[4] ?? 0 });
  }
  const find = async (text) => {
    // Auch Koordinaten „lon,lat“ – praktisch für Tests und geteilte Links
    const xy = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (xy) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(xy[1]), Number(xy[2])] }, properties: { name: 'Punkt auf der Karte' } };
    }
    return (await geocode.search(text, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 }))[0];
  };
  try {
    if (p.get('from') || p.get('to')) {
      if (PROFILES[p.get('profile')]?.nav) setProfile(p.get('profile'));
      const [a, b] = await Promise.all([p.get('from') ? find(p.get('from')) : null, p.get('to') ? find(p.get('to')) : null]);
      enterRoute({ from: a ? placeWaypoint(a) : null, to: b ? placeWaypoint(b) : null });
    } else if (p.get('reach')) {
      const [lon, lat] = p.get('reach').split(',').map(Number);
      openReach({ origin: [lon, lat], label: 'Punkt auf der Karte' });
    } else if (p.get('q')) {
      q.value = p.get('q');
      const items = await placeSuggestions(q.value, (f) => showPlace(f));
      items?.[0]?.run();
    } else if (p.get('action') === 'route') {
      enterRoute();
    }
  } catch (err) { toast(err.message); }
}
if (map.loaded()) fromUrl(); else map.once('load', fromUrl);
if (map.loaded()) resumeNav(); else map.once('load', resumeNav);
