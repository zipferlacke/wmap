/**
 * Tourenplaner: Punkte in die Karte setzen, dazwischen wird je nach Profil
 * über passende Wege geroutet (Rennrad auf Asphalt, Gravel über Schotter,
 * Wandern über Pfade …). Unten stehen immer Zahlen, Höhenprofil und die
 * Anteile von Wegtypen und Belägen.
 *
 * Aufruf:  tour.html            neue Tour
 *          tour.html?id=…       gespeicherte Tour bearbeiten
 *          tour.html#t=…        geteilte Tour ansehen (nur lesen, übernehmbar)
 *          tour.html#k=….….…    gemeinsam planen: die Tour liegt verschlüsselt 30 Tage auf dem Server, wer den Link
 *                               hat, plant mit – jede Änderung geht zurück, alle 20 s kommt der Stand der anderen
 *
 * Hintergrund (tour.backgrounds): bekannte Wege aus Entdecken und eigene
 * Touren liegen unter der Planung – so, wie sie in OSM bzw. gespeichert
 * sind. Punkte nah an einem Hintergrund rasten auf ihm ein, und liegen zwei
 * Punkte nacheinander darauf, folgt die Strecke dazwischen genau ihm statt
 * dem Routing. „So übernehmen“ nimmt den ganzen Verlauf. Hintergründe werden
 * mit der Tour gespeichert; entfernt man einen, ist er weg.
 */
import { fmtLatLon, fmtMgrs } from '../core/coords.js';
import { PROFILES } from '../core/config.js';
import { createMap, showRoutes, showHover } from '../map/map.js';
import { segment, joinSegments, wayInfo, heightsAlong, hikingTime } from '../services/routing.js';
import { ElevationProfile } from '../ui/elevation.js';
import { tours, shapeOf, coordsOf, encodeShare, decodeShare, toGpx, download, local } from '../data/store.js';
import { sidePanel } from '../ui/side-panel.js';
import { mountLayerMenu } from '../ui/layer-menu.js';
import { ask, toast } from '../ui/dialogs.js';
import { share, pageUrl, myName } from '../ui/share.js';
import { shortLink, resolveShort, collabLink, collabUrl, collabGet, collabPut, collabState, COLLAB_OPEN } from '../data/short-link.js';
import { mergeTours, resolve as resolveMerge } from '../data/tour-merge.js';
import * as geocode from '../services/geocode.js';
import { distance, nearestOnLine, pointAt, simplifyTo, bbox, cumulative, fmtDistance, fmtDuration, esc } from '../core/geo.js';
import { setupStages } from '../ui/tour-stages.js';
import { tourLine, originalRoute, searchTours } from '../services/known-tours.js';
import { locale, t } from '../core/i18n.js';
import '../data/folder.js';   // gespeicherte Touren landen auch im verbundenen Ordner

const $ = (s, root = document) => root.querySelector(s);

const debounce = (fn, ms) => {
  let tk;
  return (...a) => { clearTimeout(tk); tk = setTimeout(() => fn(...a), ms); };
};

/* ══════════════════════════════════════════════════════════════════════════
   Tour laden
   ══════════════════════════════════════════════════════════════════════════ */

const TOUR_PROFILES = Object.entries(PROFILES).filter(([, p]) => p.tour).map(([id]) => id);
// Kurzer Link (#k=…): der Inhalt kommt vom Server und steht danach als #t=… in der Adresse
const shortError = await resolveShort();
const shareCode = new URLSearchParams(location.hash.slice(1)).get('t');
const idParam = new URLSearchParams(location.search).get('id');

let tour = null;
let readOnly = false;
// Gemeinsam planen: gerade über den Link geöffnet (data/short-link.js) – gibt es die Tour hier schon, die nehmen
let collabOpen = null;
try { collabOpen = JSON.parse(sessionStorage.getItem(COLLAB_OPEN) ?? 'null'); sessionStorage.removeItem(COLLAB_OPEN); } catch { /* ohne */ }
const known = collabOpen && tours.all().find((tk) => tk.collab?.id === collabOpen.id);
let joining = null;   // Link mit einer eigenen Tour verbunden: { code, rev, editor } – unten zusammengeführt
if (known) {
  tour = known;
  if (collabOpen.expires) tour.collab = { ...tour.collab, expires: collabOpen.expires };
  history.replaceState(null, '', `./tour.html?id=${encodeURIComponent(known.id)}`);
} else if (collabOpen && shareCode) {
  try {
    const tk = await decodeShare(shareCode);
    const collab = { id: collabOpen.id, key: collabOpen.key, token: collabOpen.token, rev: collabOpen.rev, by: collabOpen.editor ?? null, expires: collabOpen.expires ?? null };
    const into = await joinWhere(tk, collabOpen.editor);
    if (into) {
      tour = { ...into, collab };
      joining = { code: collabOpen.code, rev: collabOpen.rev, editor: collabOpen.editor };
      history.replaceState(null, '', `./tour.html?id=${encodeURIComponent(into.id)}`);
    } else tour = { ...tk, id: null, collab };
  } catch { toast(t('tour.toast.bad_link')); }
} else if (shareCode) {
  try {
    tour = { ...(await decodeShare(shareCode)), id: null };
    // Nur eine Vorlage (aus Entdecken): gleich selbst planen
    readOnly = !(tour.backgrounds?.length && !tour.points.length);
  } catch { toast(t('tour.toast.bad_link')); }
} else if (idParam) {
  tour = tours.get(idParam);
  if (!tour) toast(t('tour.toast.not_found'));
}
if (typeof shortError === 'string') toast(shortError);
tour ??= { id: null, name: '', description: '', profile: local.get('wmap.tourProfile', 'hike'), points: [] };
tour.backgrounds ??= [];
if (!TOUR_PROFILES.includes(tour.profile)) tour.profile = 'hike';

document.body.classList.toggle('readonly', readOnly);

/* ══════════════════════════════════════════════════════════════════════════
   Karte und Panel
   ══════════════════════════════════════════════════════════════════════════ */

const lastView = local.get('wmap.view');
const start = tour.points.length ? bbox(tour.points) : null;
const { map } = createMap('map', {
  center: start ? [(start[0] + start[2]) / 2, (start[1] + start[3]) / 2] : lastView?.center ?? [9.93, 51.53],
  zoom: start ? 11 : Math.max(lastView?.zoom ?? 5, 5),
  snapshot: true,
  // Beim Planen stört das automatische Neigen – der Nutzer setzt Punkte
  auto3d: false,
});

window.__wmap = { map };                         // für Konsole und Tests
mountLayerMenu(map, { toast });                  // Satellit, Wanderwege, Plugins

// Panel wie bei Meine Touren: Rechner links (Breite ziehen, ganz einklappen), Handy unten.
// Kopf: ←, Name der Tour (statt eines Titels), Speichern, ✕
let fitTimer = null;
const nameField = $('#tour-name');
const saveButton = $('#save');
const panel = sidePanel($('#sheet-src'), {
  id: 'sheet', label: t('tour.panel.label'), className: 'tour-panel', key: 'wmap.tourPanel',
  barLeft: { icon: '<span class="msr">arrow_back</span>', title: t('tour.panel.back'), onClick: () => { location.href = './wege.html?tab=geplant'; } },
  barRight: { icon: '<span class="msr">close</span>', title: t('tour.panel.close'), onClick: () => { location.href = './index.html'; } },
  onChange: () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitRoute, 280); },
});
const sheet = panel.dialog;
sheet.querySelector('.uD-header').classList.add('tour-bar');
panel.title.replaceChildren(nameField);
panel.left.querySelector('button')?.setAttribute('data-back', '');   // Zurück-Taste wie ← (core/back.js)
panel.right.prepend(saveButton);
document.activeElement?.blur();                // kein Fokusrahmen um den Griff
const mobile = () => matchMedia('(max-width: 700px)').matches;

/** Freier Kartenausschnitt neben bzw. über dem Panel */
function viewPadding() {
  const r = sheet.open && !panel.collapsed ? sheet.getBoundingClientRect() : null;
  if (!r) return { top: 60, bottom: 60, left: 40, right: 64 };
  if (!mobile()) return { top: 40, bottom: 40, left: r.width + 40, right: 64 };
  const h = map.getContainer().clientHeight;
  return { top: 60, bottom: Math.min(r.height + 20, h - 160), left: 20, right: 56 };
}

function fitRoute() {
  const b = route?.bounds ?? (tour.points.length > 1 ? bbox(tour.points) : null);
  if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: viewPadding(), maxZoom: 15, duration: 700 });
  else if (tour.points.length === 1) map.easeTo({ center: tour.points[0], zoom: Math.max(map.getZoom(), 13), padding: viewPadding() });
}

const nameInput = $('#tour-name');
const descInput = $('#tour-desc');
nameInput.value = tour.name;
descInput.value = tour.description ?? '';
nameInput.readOnly = descInput.readOnly = readOnly;
// Geteilte Tour: noch nicht bei mir – Speichern mit Ausrufezeichen, Erklärung im Tooltip
if (readOnly) {
  $('#save').classList.add('unsaved');
  $('#save').title = t('tour.save_state.shared');
  $('#save').setAttribute('aria-label', $('#save').title);
}

function paintTitle() {
  document.title = t('tour.window_title', { name: tour.name || t('tour.new_name') });
}
paintTitle();

/* Teilen, GPX, Veröffentlichen, Löschen – unten im Panel */
$('.tour-more').addEventListener('click', (e) => {
  const act = e.target.closest('[data-tour]')?.dataset.tour;
  if (act === 'share') shareTour();
  if (act === 'gpx') exportGpx();
  if (act === 'publish') publishTour();
  if (act === 'delete') deleteTour();
});

/* Anleitung als Notiz am i-Knopf: auf dem Rechner darunter, auf dem Handy volle Breite */
const help = $('#tour-help');
help.addEventListener('toggle', (e) => {
  if (e.newState !== 'open') return;
  const b = $('.tour-help-btn').getBoundingClientRect();
  const wide = matchMedia('(min-width: 701px)').matches;
  help.style.top = `${Math.round(b.bottom + 8)}px`;
  help.style.left = wide ? `${Math.round(Math.min(b.left, innerWidth - help.offsetWidth - 12))}px` : '';
});

/* Profil als Auswahlliste – daneben das Symbol der gewählten Art */
function paintProfiles() {
  const select = $('.tour-profiles');
  select.innerHTML = TOUR_PROFILES.map((id) => `<option value="${id}" ${id === tour.profile ? 'selected' : ''}>${esc(PROFILES[id].label)}</option>`).join('');
  $('.tour-profile-pick .msr').textContent = PROFILES[tour.profile]?.icon ?? 'route';
}
paintProfiles();
$('.tour-profiles').addEventListener('change', (e) => {
  if (!PROFILES[e.target.value] || e.target.value === tour.profile) return;
  tour.profile = e.target.value;
  local.set('wmap.tourProfile', tour.profile);
  paintProfiles();
  recompute();
});

/* ══════════════════════════════════════════════════════════════════════════
   Punkte setzen
   ══════════════════════════════════════════════════════════════════════════ */

const undoStack = [];

function change(fn) {
  const prev = tour.points.map((p) => p.slice());
  prev.fixed = !!tour.fixed;
  undoStack.push(prev);
  if (undoStack.length > 50) undoStack.shift();
  fn();
  // Wer Punkte ändert, plant selbst – der feste Verlauf wird neu gerechnet
  if (tour.fixed) { tour.fixed = false; toast(t('tour.toast.own_change')); }
  recompute();
}

$('#undo').addEventListener('click', () => {
  const prev = undoStack.pop();
  if (!prev) return;
  tour.points = prev;
  tour.fixed = prev.fixed && !!tour.shape;
  recompute();
});
$('#reverse').addEventListener('click', () => change(() => tour.points.reverse()));
$('#roundtrip').addEventListener('click', () => {
  if (tour.points.length < 2) return;
  change(() => tour.points.push(tour.points[0].slice()));
});
$('#clear').addEventListener('click', () => {
  if (!tour.points.length) return;
  change(() => { tour.points = []; });
});

let markers = [];
let popup = null;

function markerEl(i, n) {
  const el = document.createElement('div');
  const kind = i === 0 ? 'start' : i === n - 1 ? 'dest' : 'via';
  el.className = `wp-marker ${kind}`;
  el.innerHTML = kind === 'start' ? '<span class="msr">trip_origin</span>'
    : kind === 'dest' ? '<span class="msr">sports_score</span>' : `<span class="wp-num">${i}</span>`;
  return el;
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  const n = tour.points.length;
  markers = tour.points.map((p, i) => {
    const el = markerEl(i, n);
    const m = new maplibregl.Marker({ element: el, draggable: !readOnly }).setLngLat(p).addTo(map);
    m.on('dragend', () => change(() => { tour.points[i] = snapPoint(m.getLngLat().toArray()) ?? m.getLngLat().toArray(); }));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (readOnly) return;
      pointPopup(i);
    });
    return m;
  });
  $('#undo').disabled = !undoStack.length;
  const hint = $('.tour-hint');
  hint.hidden = readOnly || n >= 2;
  hint.textContent = n === 0 ? t('tour.hint.start') : t('tour.hint.next');
}

/** Rundweg: Start und Ziel liegen aufeinander */
const isRound = () => tour.points.length > 2 && distance(tour.points[0], tour.points.at(-1)) < 1;

/**
 * Punkt i zum Start: im Rundweg dreht sich die Runde (er wird Start und
 * Ziel), sonst rückt er nach vorn und der Rest bleibt in seiner Folge.
 */
function makeStart(i) {
  if (isRound()) {
    const loop = tour.points.slice(0, -1);
    const k = i % loop.length;
    const r = loop.slice(k).concat(loop.slice(0, k));
    tour.points = [...r, r[0].slice()];
  } else {
    const [p] = tour.points.splice(i, 1);
    tour.points.unshift(p);
  }
}

/** Menü am Punkt: entfernen, zum Start oder Ziel machen, Rundweg daraus */
function pointPopup(i) {
  popup?.remove();
  const el = document.createElement('div');
  el.className = 'popup context';
  const n = tour.points.length, round = isRound();
  // Wo der Punkt liegt: Breite/Länge und MGRS (NATO-Gitter) – antippen kopiert
  const where = [fmtLatLon(tour.points[i]), fmtMgrs(tour.points[i])].filter(Boolean).join(' · ');
  const at = document.createElement('button');
  at.type = 'button';
  at.className = 'popup-coords';
  at.title = t('tour.point.copy');
  at.innerHTML = `<span class="msr">content_copy</span> ${esc(where)}`;
  at.addEventListener('click', () => navigator.clipboard?.writeText(where).then(() => toast(t('tour.point.copied', { where })), () => {}));
  el.append(at);
  const entries = [['delete', t('tour.point.remove'), () => change(() => tour.points.splice(i, 1))]];
  if (i === 0 && n > 1 && !round) entries.push(['sports_score', t('tour.point.also_dest'), () => change(() => tour.points.push(tour.points[0].slice()))]);
  if (i > 0 && !(round && i === n - 1)) entries.push(['trip_origin', round ? t('tour.point.start_end') : t('tour.point.make_start'), () => change(() => makeStart(i))]);
  if (i < n - 1 && !round) {
    entries.push(['sports_score', t('tour.point.make_dest'), () => change(() => { const [p] = tour.points.splice(i, 1); tour.points.push(p); })]);
  }
  for (const [icon, text, fn] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="msr">${icon}</span> ${esc(text)}`;
    b.addEventListener('click', () => { popup?.remove(); fn(); });
    el.append(b);
  }
  popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setLngLat(tour.points[i]).setDOMContent(el).addTo(map);
}

map.on('click', (e) => {
  // Zusammenführen: Tippen wählt eine Fassung, setzt keinen Punkt
  if (picking) { picking(e); return; }
  // Etappen-Modus: Tippen auf die Linie setzt ein Tagesende (auch bei geteilten Touren)
  if (stages.click(e)) return;
  if (readOnly || e.originalEvent?.target?.closest?.('.wp-marker')) return;
  // Vorschau eines Suchtreffers offen: erst die schließen
  if (found) { clearFound(); return; }
  // Nah an der Vorlage getippt: genau auf den Originalweg
  const p = snapPoint(e.lngLat.toArray(), e.point) ?? e.lngLat.toArray();
  // Auf die Linie getippt: dort einen Punkt einfügen statt hinten anhängen
  const onLine = route && map.getLayer('route-main')
    && map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['route-main'] }).length;
  if (onLine) {
    const along = nearestOnLine(route.coords, route.cum, p).along;
    const i = route.stops.findIndex((m) => m > along);
    change(() => tour.points.splice(i < 1 ? tour.points.length - 1 : i, 0, p));
    return;
  }
  change(() => tour.points.push(p));
});

/*
 * Ort suchen: der Treffer kommt erst als Vorschau auf die Karte – mit Menü:
 * anhängen, als Start, dort einfügen, wo er den kleinsten Umweg macht, oder
 * verwerfen. Nichts landet ungefragt in der Tour.
 */
const searchInput = $('#tour-search');
const results = $('.tour-search-results');
let searchCtl = null;
let found = null;           // { marker, popup } – der gerade gezeigte Treffer
const runSearch = debounce(async () => {
  const q = searchInput.value.trim();
  searchCtl?.abort();
  if (q.length < 3) { results.hidden = true; return; }
  searchCtl = new AbortController();
  try {
    const hits = await geocode.search(q, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 5, signal: searchCtl.signal });
    results.innerHTML = hits.map((f, i) => {
      const d = geocode.describe(f);
      return `<li><button type="button" class="button" data-i="${i}"><span class="msr">location_on</span>
        <span><strong>${esc(d.title)}</strong>${d.subtitle ? `<small>${esc(d.subtitle)}</small>` : ''}</span></button></li>`;
    }).join('') || `<li class="muted">${t('tour.search.none')}</li>`;
    results.hidden = false;
    results._found = hits;
  } catch { /* abgebrochen */ }
}, 300);
searchInput.addEventListener('input', runSearch);
$('.tour-search').addEventListener('submit', (e) => { e.preventDefault(); results.querySelector('button')?.click(); });
results.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const f = results._found[+b.dataset.i];
  searchInput.value = '';
  results.hidden = true;
  showFound(f.geometry.coordinates.slice(0, 2), geocode.describe(f).title);
});

function clearFound() {
  found?.popup.remove();
  found?.marker.remove();
  found = null;
}

/** Stelle mit dem kleinsten Umweg für einen neuen Punkt (zwischen zwei Punkten oder hinten) */
function bestSlot(p) {
  const pts = tour.points;
  let best = pts.length, cost = pts.length ? distance(pts.at(-1), p) : 0;
  for (let i = 1; i < pts.length; i += 1) {
    const c = distance(pts[i - 1], p) + distance(p, pts[i]) - distance(pts[i - 1], pts[i]);
    if (c < cost) { cost = c; best = i; }
  }
  return best;
}

function showFound(p, title) {
  clearFound();
  popup?.remove();
  const el = document.createElement('div');
  el.className = 'wp-marker found';
  el.innerHTML = '<span class="msr">location_on</span>';
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(p).addTo(map);
  const box = document.createElement('div');
  box.className = 'popup context';
  const n = tour.points.length;
  const entries = n === 0 ? [['trip_origin', t('tour.found.start'), () => tour.points.push(p)]] : [
    ['add_location_alt', t('tour.found.append'), () => tour.points.push(p)],
    ...(n >= 2 && bestSlot(p) < n ? [['alt_route', t('tour.found.insert'), () => tour.points.splice(bestSlot(p), 0, p)]] : []),
    ['trip_origin', t('tour.found.start'), () => tour.points.unshift(p)],
  ];
  box.innerHTML = `<strong class="popup-title">${esc(title)}</strong>`;
  for (const [icon, text, fn] of [...entries, ['close', t('tour.found.discard'), null]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="msr">${icon}</span> ${esc(text)}`;
    b.addEventListener('click', () => {
      clearFound();
      if (!fn) return;
      change(fn);
      toast(t('tour.found.added', { title }));
    });
    box.append(b);
  }
  const pop = new maplibregl.Popup({ offset: 38, closeButton: false, closeOnClick: false }).setLngLat(p).setDOMContent(box).addTo(map);
  found = { marker, popup: pop };
  // Zum gefundenen Ort, mittig im freien Teil der Karte
  map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 14), padding: viewPadding(), duration: 1200 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Route, Zahlen, Wege
   ══════════════════════════════════════════════════════════════════════════ */

let route = null;
let seq = 0;

/* Fahr- bzw. Gehzeit: Wandern nach Höhenmetern, sonst mit festem Tempo (m/s) */
const PACE = { hike: null, walk: null, road: 7, tour: 4.5, gravel: 5, mtb: 4, drive: 16 };
const timeFor = (m, up, down) => (PACE[tour.profile] ? m / PACE[tour.profile] : hikingTime(m, up, down));

const stages = setupStages({
  map, box: $('.tour-stages'), button: $('#stages'),
  getRoute: () => route, getTour: () => tour, timeFor, toast, onChange: () => scheduleSave(),
});
function routeChanged() {
  $('#stages').hidden = !route || route.length < 5000;
  stages.refresh();
  paintBackgrounds();
}

/* ══════════════════════════════════════════════════════════════════════════
   Hintergrund: bekannte Wege und eigene Touren unter der Planung
   ══════════════════════════════════════════════════════════════════════════ */

const BG = 'backgrounds';
const BG_COLORS = ['#be4bdb', '#1098ad', '#f08c00', '#5c7cfa', '#e64980'];
const ON_TEMPLATE = 15;                 // Meter: so nah gilt ein Punkt als „auf dem Hintergrund“
const KIND_OF = { hike: 'hike', walk: 'hike', road: 'bike', tour: 'bike', gravel: 'bike', mtb: 'mtb', drive: 'bike' };
const bgs = [];                         // geladen: { def, color, sections, secCum, track, cum, loading, error }
let bgOn = true;
const keyOf = (b) => `${b.type}:${b.id}`;

/**
 * Laden: die Stücke zum Zeichnen (so, wie sie in OSM stehen) und die
 * durchgehende Linie („Track“) zum Folgen – bei Wegen aus mehreren Stücken
 * der Reihe nach verbunden (kommt nach, dauert bei Lücken etwas).
 */
async function loadBackground(def, { fit = false } = {}) {
  const g = { def, color: BG_COLORS[bgs.length % BG_COLORS.length], sections: [], secCum: [], track: null, cum: null, loading: true };
  bgs.push(g);
  paintBackgrounds();
  try {
    if (def.type === 'tour') {
      const tk = tours.get(def.id);
      if (!tk?.shape) throw new Error(t('tour.bg.gone'));
      g.sections = [coordsOf(tk.shape)];
    } else {
      g.sections = (await tourLine(def.id, { kind: def.kind })).sections;
    }
    g.secCum = g.sections.map((c) => cumulative(c));
    if (g.sections.length === 1) { g.track = g.sections[0]; g.cum = g.secCum[0]; }
    else {
      originalRoute(def.id, def.kind).then(({ line }) => {
        g.track = line;
        g.cum = cumulative(line);
        paintBackgrounds();
        if (!tour.fixed && tour.points.length > 1) recompute();
      }).catch(() => {});
    }
  } catch (err) { g.error = err.message; }
  g.loading = false;
  drawBackgrounds();
  paintBackgrounds();
  if (fit && g.sections.length) fitBackground(g);
  if (!tour.fixed && tour.points.length > 1) recompute();
  return g;
}

function fitBackground(g) {
  const b = bbox(g.sections.flat());
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: viewPadding(), duration: 600, maxZoom: 14 });
}

function drawBackgrounds() {
  const data = { type: 'FeatureCollection', features: bgs.flatMap((g, gi) => g.sections.map((c, i) => ({
    type: 'Feature', properties: { g: gi, i, color: g.color }, geometry: { type: 'LineString', coordinates: c },
  }))) };
  if (map.getSource(BG)) map.getSource(BG).setData(data);
  // Stil gerade nicht bereit (Nachladen, Umfärben) – sobald die Karte ruht
  else if (!map.isStyleLoaded()) { map.once('idle', drawBackgrounds); return; }
  else {
    map.addSource(BG, { type: 'geojson', data });
    map.addLayer({
      id: BG, type: 'line', source: BG, layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 6, 14, 13] },
    }, map.getLayer('route-alt') ? 'route-alt' : undefined);
  }
  if (map.getLayer(BG)) map.setLayoutProperty(BG, 'visibility', bgOn ? 'visible' : 'none');
}

let adding = false;
function paintBackgrounds() {
  const box = $('.tour-original');
  box.hidden = readOnly && !bgs.length;
  if (box.hidden) return;
  const empty = !tour.points.length;
  const rows = bgs.map((g, i) => `
    <li><i style="background:${g.color}"></i>
      <span><strong>${esc(g.def.name || (g.def.type === 'tour' ? t('tour.bg.own_tour') : t('tour.bg.known_way')))}</strong>
        <small>${g.error ? esc(g.error) : g.loading ? t('tour.bg.loading') : g.def.type === 'tour' ? t('tour.bg.own_tour_small')
          : `${t('tour.bg.from_osm')}${g.sections.length > 1 ? `${t('tour.bg.pieces', { n: g.sections.length })}${g.track ? '' : t('tour.bg.joining')}` : ''}`}</small></span>
      ${tour.fixed || g.loading || g.error ? '' : `<button type="button" class="button${empty ? ' primary' : ''}" data-bg="take" data-i="${i}" title="${t('tour.bg.take.title')}"><span class="msr">done_all</span> ${t('tour.bg.take.button')}</button>`}
      <button type="button" class="button" data-shape="round no-background" data-bg="remove" data-i="${i}" title="${t('tour.bg.remove')}"><span class="msr">close</span></button>
    </li>`).join('');
  box.innerHTML = `
    <span class="section-title">${t('tour.bg.title')}</span>
    ${bgs.length && empty ? `<p class="muted">${t('tour.bg.hint')}</p>` : ''}
    ${bgs.length ? `<ul class="bg-list">${rows}</ul>` : ''}
    <div class="tour-tools">
      <button type="button" class="button" data-bg="add" aria-expanded="${adding}"><span class="msr">add</span> ${t('tour.bg.add')}</button>
      ${bgs.length ? `<button type="button" class="button" data-bg="toggle"><span class="msr">${bgOn ? 'visibility_off' : 'visibility'}</span> ${bgOn ? t('tour.bg.hide') : t('tour.bg.show')}</button>` : ''}
      ${bgs.length && !empty ? `<button type="button" class="button" data-bg="fresh"><span class="msr">edit_road</span> ${t('tour.bg.fresh')}</button>` : ''}
    </div>
    ${adding ? `<form class="tour-search bg-search" autocomplete="off"><span class="msr">search</span>
      <input type="search" placeholder="${t('tour.bg.search.placeholder')}" aria-label="${t('tour.bg.search.label')}"></form>
      <ul class="tour-search-results bg-results"></ul>` : ''}`;
  if (adding) box.querySelector('.bg-search input').focus();
}

/* ── Stellen auf einer Linie und Stücke dazwischen ──────────────────────── */

/**
 * Alle Durchgänge einer Linie an einem Punkt (näher als ON_TEMPLATE) – ein
 * Rundweg oder ein doppelt begangenes Stück kommt mehrmals vorbei.
 * → [{ along, offset }]
 */
function passes(line, cum, p) {
  const kx = Math.cos((p[1] * Math.PI) / 180) * 111320, ky = 110540;
  const out = [];
  let last = -2;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i], b = line[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const l2 = dx * dx + dy * dy;
    const tk = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * tk, ay + dy * tk);
    if (d > ON_TEMPLATE) continue;
    const along = cum[i] + (cum[i + 1] - cum[i]) * tk;
    if (i === last + 1 && out.length) { if (d < out.at(-1).offset) out[out.length - 1] = { along, offset: d }; }
    else out.push({ along, offset: d });
    last = i;
  }
  return out;
}

/**
 * Beide Punkte auf derselben Linie? → das Stück dazwischen: der kürzere Weg
 * entlang der Linie, bei einem Rundweg auch über Start/Ziel hinweg.
 */
function between(line, cum, a, b) {
  const A = passes(line, cum, a), B = passes(line, cum, b);
  if (!A.length || !B.length) return null;
  const total = cum.at(-1);
  const ring = line.length > 3 && distance(line[0], line.at(-1)) < 50;
  let best = null;
  for (const x of A) for (const y of B) {
    const d = Math.abs(y.along - x.along);
    if (d < 5) continue;
    if (!best || d < best.len) best = { len: d, from: x.along, to: y.along, wrap: false };
    if (ring && total - d < best.len) best = { len: total - d, from: x.along, to: y.along, wrap: true };
  }
  if (!best) return null;
  const part = (lo, hi) => {
    const out = [pointAt(line, cum, lo)];
    for (let k = 0; k < line.length; k += 1) if (cum[k] > lo && cum[k] < hi) out.push(line[k]);
    out.push(pointAt(line, cum, hi));
    return out;
  };
  const { from, to } = best;
  if (!best.wrap) return from < to ? part(from, to) : part(to, from).reverse();
  // Über den Start des Rundwegs: vom Punkt bis zum Ende, dann vom Anfang weiter
  return from > to ? [...part(from, total), ...part(0, to).slice(1)] : [...part(to, total), ...part(0, from).slice(1)].reverse();
}

/** Punkt nah an einem Hintergrund → genau darauf (10 Pixel beim Tippen und Ziehen) */
function snapPoint(p, screen = map.project(p)) {
  if (!bgOn || !map.getLayer(BG)) return null;
  const hit = map.queryRenderedFeatures([[screen.x - 10, screen.y - 10], [screen.x + 10, screen.y + 10]], { layers: [BG] })[0];
  const g = hit && bgs[hit.properties.g];
  const c = g?.sections[hit.properties.i];
  return c ? nearestOnLine(c, g.secCum[hit.properties.i], p).point : null;
}

const heightCache = new Map();

/**
 * Liegen beide Punkte auf einem Hintergrund, ist die Strecke dazwischen
 * genau dessen Verlauf – im Format von segment(). Sonst null (→ routen).
 */
async function templatePart(a, b) {
  for (const g of bgs) {
    if (g.loading || g.error) continue;
    // Erst der durchgehende Track, sonst ein einzelnes Stück
    const lines = [...(g.track ? [[g.track, g.cum]] : []), ...g.sections.map((c, i) => [c, g.secCum[i]])];
    for (const [line, cum] of lines) {
      const coords = between(line, cum, a, b);
      if (!coords) continue;
      const c = cumulative(coords);
      const length = c.at(-1);
      const key = `${coords[0]}|${coords.at(-1)}|${coords.length}`;
      if (!heightCache.has(key)) heightCache.set(key, heightsAlong(coords).catch(() => ({ elevation: [] })));
      const { elevation } = await heightCache.get(key);
      return { coords, cum: c, length, time: length / (PACE[tour.profile] ?? 1.1), elevation, maneuvers: [], template: true };
    }
  }
  return null;
}

/* ── Knöpfe ───────────────────────────────────────────────────────────── */

async function takeBackground(g, button) {
  if (readOnly) adopt();
  button.disabled = true;
  button.innerHTML = `<span class="msr spin">progress_activity</span> ${t('tour.bg.take.busy')}`;
  try {
    const line = g.track ?? (g.def.type === 'way' ? (await originalRoute(g.def.id, g.def.kind)).line : g.sections[0]);
    const prev = tour.points.map((p) => p.slice());
    prev.fixed = !!tour.fixed;
    undoStack.push(prev);
    tour.points = simplifyTo(line, 20);
    tour.shape = shapeOf(line.length > 1500 ? simplifyTo(line, 1500) : line);
    tour.fixed = true;
    tour.stages = [];
    if (!tour.name) { tour.name = g.def.name; nameInput.value = tour.name; paintTitle(); }
    await recompute({ fit: true });
  } catch (err) { toast(t('tour.bg.take.failed', { error: err.message })); }
  paintBackgrounds();
}

$('.tour-original').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bg]');
  const act = b?.dataset.bg;
  if (!act) {
    const pick = e.target.closest('[data-add]');
    if (pick) addBackground(JSON.parse(pick.dataset.add));
    return;
  }
  const g = bgs[Number(b.dataset.i)];
  if (act === 'toggle') { bgOn = !bgOn; drawBackgrounds(); }
  if (act === 'add') adding = !adding;
  if (act === 'remove' && g) {
    if (readOnly) adopt();
    bgs.splice(bgs.indexOf(g), 1);
    tour.backgrounds = tour.backgrounds.filter((x) => keyOf(x) !== keyOf(g.def));
    drawBackgrounds();
    scheduleSave();
    if (!tour.fixed && tour.points.length > 1) recompute();
  }
  if (act === 'take' && g) { await takeBackground(g, b); return; }
  if (act === 'fresh') {
    if (readOnly) adopt();
    // Von vorn: der Hintergrund bleibt, die eigene Strecke entsteht Punkt für Punkt
    tour.fixed = false;
    tour.stages = [];
    change(() => { tour.points = []; });
    bgOn = true;
    drawBackgrounds();
    toast(t('tour.bg.fresh_toast'));
  }
  paintBackgrounds();
});

function addBackground(def) {
  adding = false;
  if (tour.backgrounds.some((x) => keyOf(x) === keyOf(def))) { paintBackgrounds(); return; }
  if (readOnly) adopt();
  tour.backgrounds.push(def);
  loadBackground(def, { fit: true });
  scheduleSave();
}

/* Suche: eigene Touren (sofort) und bekannte Wege (Waymarked Trails) */
let bgCtl = null;
const bgSearch = debounce(async (q) => {
  const list = $('.tour-original .bg-results');
  if (!list) return;
  const low = q.toLowerCase();
  const mine = tours.all().filter((tk) => tk.id !== tour.id && tk.shape && tk.name?.toLowerCase().includes(low)).slice(0, 5)
    .map((tk) => ({ def: { type: 'tour', id: tk.id, name: tk.name }, icon: 'bookmark', sub: tk.stats?.length ? t('tour.bg.own_tour_length', { length: fmtDistance(tk.stats.length) }) : t('tour.bg.own_tour') }));
  const row = (x) => `<li><button type="button" class="button" data-add='${esc(JSON.stringify(x.def))}'><span class="msr">${x.icon}</span>
    <span>${esc(x.def.name)}<small>${esc(x.sub)}</small></span></button></li>`;
  list.innerHTML = mine.map(row).join('') + (q.length >= 3 ? `<li class="muted">${t('tour.bg.search.busy')}</li>` : '');
  if (q.length < 3) return;
  bgCtl?.abort();
  bgCtl = new AbortController();
  const kind = KIND_OF[tour.profile] ?? 'hike';
  try {
    const ways = (await searchTours(q, kind, { signal: bgCtl.signal })).slice(0, 8)
      .map((w) => ({ def: { type: 'way', id: w.id, kind, name: w.name }, icon: 'route', sub: [w.network, w.ref].filter(Boolean).join(' · ') }));
    list.innerHTML = [...mine, ...ways].map(row).join('') || `<li class="muted">${t('tour.search.none')}</li>`;
  } catch (err) {
    if (err.name !== 'AbortError') list.innerHTML = mine.map(row).join('') + `<li class="muted">${t('tour.bg.search.failed', { error: esc(err.message) })}</li>`;
  }
}, 300);
$('.tour-original').addEventListener('input', (e) => { if (e.target.closest('.bg-search')) bgSearch(e.target.value.trim()); });
$('.tour-original').addEventListener('submit', (e) => e.preventDefault());

const startBackgrounds = () => {
  paintBackgrounds();
  const first = !tour.points.length;
  tour.backgrounds.forEach((def, i) => loadBackground(def, { fit: first && i === 0 }));
};
if (map.loaded()) startBackgrounds(); else map.once('load', startBackgrounds);

const elevation = new ElevationProfile($('.elevation', sheet), {
  onHover(km) {
    if (!route || km === null) { showHover(map, null); return; }
    const total = route.cum[route.cum.length - 1];
    showHover(map, pointAt(route.coords, route.cum, km * 1000 * (total / (route.length || total))));
  },
});

map.on('mousemove', 'route-main', (e) => {
  if (!route) return;
  const s = nearestOnLine(route.coords, route.cum, e.lngLat.toArray());
  showHover(map, s.point);
  elevation.showAt((s.along / 1000) * ((route.length || 1) / route.cum[route.cum.length - 1]));
});
map.on('mouseleave', 'route-main', () => { showHover(map, null); elevation.showAt(null); });

function status(text, error = false) {
  const el = $('.tour-status');
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('error', error);
}

async function recompute({ fit = false } = {}) {
  const my = ++seq;
  renderMarkers();
  if (tour.points.length < 2) {
    route = null;
    showRoutes(map, [], -1);
    elevation.show(null);
    paintStats();
    routeChanged();
    $('.tour-ways').innerHTML = '';
    status(null);
    scheduleSave();
    return;
  }
  if (tour.fixed && tour.shape) { await fixedRoute(my); return; }
  status(t('tour.status.computing'));
  try {
    const pairs = tour.points.slice(1).map((b, i) => [tour.points[i], b]);
    // Auf der Vorlage genau ihr folgen, sonst routen
    const parts = await Promise.all(pairs.map(async ([a, b]) => (await templatePart(a, b)) ?? segment(a, b, tour.profile)));
    if (my !== seq) return;
    route = { ...joinSegments(parts, tour.profile), id: 0 };
    // Wo entlang der Linie die gesetzten Punkte liegen – für „Punkt einfügen“
    let acc = 0;
    route.stops = [0, ...parts.map((p) => (acc += p.cum[p.cum.length - 1]))];
    showRoutes(map, [route], 0);
    elevation.show(route);
    paintStats();
    routeChanged();
    status(null);
    if (fit) fitRoute();
    loadWays(my);
    scheduleSave();
  } catch (err) {
    if (my === seq) status(err.message, true);
  }
}

/**
 * Fester Verlauf (bekannter Weg, GPX): die Linie so, wie sie ist – nur
 * Höhen und Zeit dazu. Neu gerechnet wird erst, wenn man Punkte ändert.
 */
async function fixedRoute(my) {
  const coords = coordsOf(tour.shape);
  const cum = cumulative(coords);
  const length = cum[cum.length - 1];
  route = { id: 0, coords, cum, length, bounds: bbox(coords), elevation: [], ascent: 0, descent: 0, minEle: null, maxEle: null, maneuvers: [] };
  // Wo die Punkte auf der Linie liegen – für „auf die Linie tippen = Punkt einfügen“
  route.stops = tour.points.map((p) => nearestOnLine(coords, cum, p).along);
  const pace = { hike: null, walk: null, road: 7, tour: 4.5, gravel: 5, mtb: 4, drive: 16 }[tour.profile];
  route.time = pace ? length / pace : hikingTime(length, 0, 0);
  showRoutes(map, [route], 0);
  paintStats();
  routeChanged();
  status(t('tour.status.original'), false);
  scheduleSave();
  try {
    const h = await heightsAlong(coords);
    if (my !== seq) return;
    Object.assign(route, h);
    if (!pace) route.time = hikingTime(length, h.ascent, h.descent);
    elevation.show({ ...route, length });
    paintStats();
    routeChanged();
  } catch { /* ohne Höhen */ }
  loadWays(my);
}

function paintStats() {
  $('.st-length').textContent = route ? fmtDistance(route.length) : '–';
  $('.st-time').textContent = route ? fmtDuration(route.time) : '–';
  $('.st-up').textContent = route ? t('tour.unit.m', { v: route.ascent }) : '–';
  $('.st-down').textContent = route ? t('tour.unit.m', { v: route.descent }) : '–';
}

/* Wegtypen und Beläge als Balken – wie viel Asphalt, Schotter, Pfad … */
const WAY_COLORS = {
  Radweg: '#1c7ed6', Fußweg: '#74c0fc', Pfad: '#2f9e44', Bergpfad: '#5c3d1e', Feldweg: '#a9791b', Treppe: '#868e96',
  Fähre: '#15aabf', Schnellstraße: '#c92a2a', Hauptstraße: '#f76707', Wohnstraße: '#fab005', Nebenstraße: '#ced4da',
  Asphalt: '#495057', Befestigt: '#868e96', Pflaster: '#adb5bd', Verdichtet: '#c9a36b', Erdweg: '#8b5e34',
  Schotter: '#b08968', Naturpfad: '#40c057', Unwegsam: '#e03131', Unbekannt: '#dee2e6',
};

async function loadWays(my) {
  const box = $('.tour-ways');
  box.innerHTML = `<p class="muted">${t('tour.ways.loading')}</p>`;
  try {
    const info = await wayInfo(route.coords, tour.profile);
    if (my !== seq) return;
    const block = (title, rows) => {
      const total = rows.reduce((a, [, m]) => a + m, 0) || 1;
      const main = rows.filter(([, m]) => m / total >= 0.005);
      return `<div class="ways-block">
        <h3 class="section-title">${title}</h3>
        <div class="ways-bar">${main.map(([n, m]) => `<span style="flex:${m};background:${WAY_COLORS[n] ?? '#adb5bd'}" title="${esc(n)}"></span>`).join('')}</div>
        <ul class="ways-legend">${main.map(([n, m]) => `
          <li><i style="background:${WAY_COLORS[n] ?? '#adb5bd'}"></i>${esc(n)} <b>${fmtDistance(m)}</b></li>`).join('')}</ul>
      </div>`;
    };
    box.innerHTML = block(t('tour.ways.types'), info.ways) + block(t('tour.ways.surfaces'), info.surfaces);
  } catch {
    box.innerHTML = '';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Speichern, Teilen, Export, Löschen
   ══════════════════════════════════════════════════════════════════════════ */

async function defaultName() {
  if (!tour.points.length) return t('tour.default_name.date', { date: new Date().toLocaleDateString(locale) });
  try {
    const f = await geocode.reverse(tour.points[0]);
    const d = f && geocode.describe(f);
    const place = f?.properties.city ?? f?.properties.town ?? f?.properties.village ?? d?.title;
    if (place) return t('tour.default_name.place', { profile: PROFILES[tour.profile].label, place });
  } catch { /* dann eben mit Datum */ }
  return t('tour.default_name.date', { date: new Date().toLocaleDateString(locale) });
}

function snapshotTour(preview) {
  return {
    ...tour,
    name: tour.name || t('tour.new_name'),
    shape: route ? shapeOf(simplifyTo(route.coords, 1500)) : null,
    stats: route ? { length: route.length, time: route.time, ascent: route.ascent, descent: route.descent } : null,
    preview: preview === undefined ? tour.preview ?? null : preview,
  };
}

/**
 * Zustand des Speichern-Knopfs – man sieht immer, ob alles gesichert ist:
 *   new     noch keine Strecke      Diskette (grau)
 *   dirty   geändert                drehende Pfeile (gleich automatisch)
 *   saved   gesichert               grüner Haken
 */
function saveState(state) {
  const b = $('#save');
  if (readOnly) return;
  b.dataset.state = state;
  // Nur das Symbol: grüner Haken = gesichert, dreht = speichert, Diskette = noch nicht
  b.querySelector('.msr').textContent = state === 'saved' ? 'check_circle' : state === 'dirty' ? 'sync' : 'save';
  b.title = state === 'saved' ? t('tour.save_state.saved') : state === 'dirty' ? t('tour.save_state.dirty') : t('tour.save');
  b.setAttribute('aria-label', b.title);
}
saveState(tour.id ? 'saved' : 'new');

/** Automatisch speichern, sobald es eine Strecke gibt – nichts geht verloren. */
const autoSave = debounce(async () => {
  if (readOnly || tour.points.length < 2) return;
  await save();
}, 900);
function scheduleSave() {
  if (readOnly) return;
  if (tour.points.length < 2) { saveState(tour.id ? 'dirty' : 'new'); if (!tour.id) return; }
  else saveState('dirty');
  autoSave();
}

async function save(preview) {
  if (!tour.name) {
    tour.name = await defaultName();
    if (document.activeElement !== nameInput) nameInput.value = tour.name;
    paintTitle();
  }
  const isNew = !tour.id;
  tour.id ??= tours.newId();
  try {
    const saved = tours.save(snapshotTour(preview));
    tour.preview = saved.preview;
    tour.created = saved.created;
  } catch (err) { toast(err.message); return; }
  if (isNew) history.replaceState(null, '', `./tour.html?id=${encodeURIComponent(tour.id)}`);
  saveState('saved');
  if (tour.collab) pushCollab();
}

/** Vorschaubild: Route einpassen, Karte zeichnen lassen, Bild verkleinern. */
async function capturePreview() {
  if (!route) return null;
  const b = route.bounds;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 50, duration: 0, pitch: 0, bearing: 0 });
  await new Promise((r) => map.once('idle', r));
  try {
    const src = map.getCanvas();
    const W = 480, H = 300;
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const s = Math.max(W / src.width, H / src.height);
    c.getContext('2d').drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;     // Kachelserver ohne CORS → kein Bild, die Liste zeichnet dann die Linie
  } finally {
    fitRoute();
  }
}

/** Geteilte Tour als eigene übernehmen – ab jetzt bearbeitbar */
function adopt() {
  readOnly = false;
  document.body.classList.remove('readonly');
  nameInput.readOnly = descInput.readOnly = false;
  $('#save').classList.remove('unsaved');
  $('#save').title = t('tour.save');
  $('#save').removeAttribute('aria-label');
  tour.id = null;
  saveState('new');
  history.replaceState(null, '', './tour.html');
  renderMarkers();
}

$('#save').addEventListener('click', async () => {
  if (readOnly) adopt();
  if (tour.points.length < 2) { toast(t('tour.toast.min_points')); return; }
  await save(await capturePreview());
  toast(t('tour.toast.saved'));
});

nameInput.addEventListener('input', () => {
  tour.name = nameInput.value.trim();
  paintTitle();
  scheduleSave();
});
descInput.addEventListener('input', () => {
  tour.description = descInput.value;
  scheduleSave();
});

/* Teilen: Link trägt die Tour selbst – oder gemeinsam planen (Link zum Mitplanen) */
async function shareTour() {
  if (tour.points.length < 2) { toast(t('tour.toast.need_route')); return; }
  const name = tour.name || nameInput.value || t('tour.default_tour');
  const live = !collabOff(tour.collab);
  const how = readOnly ? 'view' : await ask({
    icon: 'share', title: t('tour.share.title'),
    text: live ? t('tour.share.live') : t('tour.share.text'),
    buttons: [{ value: 'view', label: t('tour.share.view'), icon: 'visibility' }, { value: 'collab', label: live ? t('tour.share.collab_link') : t('tour.collab.title'), icon: 'group', primary: true }],
  });
  if (!how) return;
  const code = await encodeShare({ ...tour, name });
  if (how === 'view') {
    share({ title: t('tour.share.title'), text: t('tour.share.message', { name }), url: `${pageUrl('tour.html')}#t=${code}`, short: () => shortLink('tour', code) }, toast);
    return;
  }
  // Abgelaufen: ein neuer Link
  if (!live) {
    const me = await myName();
    try {
      const { collab } = await collabLink(code, me);
      tour.collab = collab;
      lastCollabCode = await normCode(code);
      await save();
    } catch (err) { toast(err.message || t('tour.collab.link_failed')); return; }
  }
  share({ title: t('tour.collab.title'), text: t('tour.collab.message', { name }), url: collabUrl(tour.collab),
    note: t('tour.collab.note') }, toast);
  paintCollab();
}

/* ── Gemeinsam planen: eigene Änderungen zurück, die der anderen holen ──────── */

// So steht es auf dem Server (gepackt) – gleich: nichts zu schicken. Lag die Tour schon hier, ist sie womöglich
// älter als der Link: dann unbekannt, pullCollab holt den neuesten Stand
// Immer in der Form, in der diese App selbst packt (normCode): Vom Server kommt dieselbe Tour womöglich anders gepackt
// (Name leer, Reihenfolge …) – ohne das schickte schon das Öffnen „eine Änderung“, und die anderen sahen „… hat geändert“
const mineCode = () => encodeShare({ ...tour, name: tour.name || t('tour.default_tour') });
const normCode = async (code) => { const tk = await decodeShare(code); return encodeShare({ ...tk, name: tk.name || t('tour.default_tour') }); };
let lastCollabCode = !known && !joining && collabOpen?.code ? await normCode(collabOpen.code).catch(() => null) : null;
let collabBusy = false;
let collabAgain = false;   // während des Schickens wieder geändert: danach gleich noch einmal

function paintCollab() {
  const box = $('.tour-collab');
  if (!box) return;
  box.hidden = !tour.collab;
  if (!tour.collab) return;
  const st = collabState(tour.collab);
  box.querySelector('.msr').textContent = st.icon;
  box.querySelector('span:last-child').innerHTML = `<b>${t('tour.collab.chip')}</b> <span class="collab-chip${st.gone ? ' gone' : ''}">${esc(st.text)}</span>${
    tour.collab.editor ? `<small>${t('tour.collab.last_editor', { name: esc(tour.collab.editor) })}</small>` : ''}`;
}

/**
 * Link zum Mitplanen, die Tour gibt es hier noch nicht: als neue Tour – oder mit einer eigenen verbinden (z. B. dieselbe
 * Runde schon selbst geplant) → die eigene Tour | null (neue)
 */
async function joinWhere(tk, by) {
  const mine = tours.all().filter((x) => !x.collab);
  if (!mine.length) return null;
  // Gleicher Name zuerst, sonst die zuletzt geänderte
  mine.sort((a, b) => (b.name === tk.name) - (a.name === tk.name) || (b.updated ?? 0) - (a.updated ?? 0));
  const v = await ask({
    icon: 'group_add', title: t('tour.collab.title'), className: 'stacked',
    text: by ? t('tour.collab.join.invited_by', { by, name: tk.name }) : t('tour.collab.join.invited', { name: tk.name }),
    html: `<label class="collab-into"><span>${t('tour.collab.join.into')}</span>
      <select>${mine.map((x) => `<option value="${esc(x.id)}">${esc(x.name || t('tour.default_tour'))}</option>`).join('')}</select></label>`,
    buttons: [
      { value: 'new', label: t('tour.collab.join.new'), icon: 'add_road', primary: true },
      { value: 'join', label: t('tour.collab.join.merge'), icon: 'merge', run: (dlg, done) => done(`join:${dlg.querySelector('.collab-into select').value}`) },
    ],
  });
  return v?.startsWith('join:') ? tours.get(v.slice(5)) : null;
}

/** Eine Fassung übernehmen (vom Server oder zusammengeführt) und neu zeichnen */
async function applyTour(tk) {
  Object.assign(tour, { name: tk.name, description: tk.description, profile: TOUR_PROFILES.includes(tk.profile) ? tk.profile : tour.profile,
    points: tk.points, backgrounds: tk.backgrounds ?? [], fixed: !!tk.fixed, shape: tk.shape });
  nameInput.value = tour.name;
  descInput.value = tour.description;
  paintTitle();
  paintProfiles();
  startBackgrounds();
  await recompute({ fit: false });
}

async function applyRemote(code, rev, editor) {
  tour.collab = { ...tour.collab, rev, editor };
  lastCollabCode = await normCode(code);
  await applyTour(await decodeShare(code));
  paintCollab();
  toast(t('tour.collab.changed', { name: editor || t('tour.collab.someone') }));
}

/* Beide haben dieselbe Stelle geändert: beide Fassungen auf der Karte, gepunktet – die eigene blau, die der anderen
   orange, jeweils mit dem Punkt davor und danach, die beide behalten haben (direkt von Punkt zu Punkt). Gewählt: kräftig,
   die andere blass */
const MINE = '#1a73e8', THEIRS = '#e8590c';
let picking = null;          // Auswahl auf der Karte läuft: (side) => void – ein Tipp setzt dann keinen Punkt
function showConflict(cf, sel = null) {
  const lines = cf ? [['mine', MINE], ['theirs', THEIRS]].map(([side, color]) => ({
    side, color, pts: [cf.before, ...cf[side], cf.after].filter(Boolean),
  })) : [];
  const fc = { type: 'FeatureCollection', features: lines.flatMap(({ side, color, pts }) => {
    const props = { side, color, on: sel === side ? 1 : sel ? 0 : 0.5 };
    return [
      { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts } },
      ...pts.map((p) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: p } })),
    ];
  }) };
  if (!map.getSource('collab-diff')) {
    if (!cf) return;
    map.addSource('collab-diff', { type: 'geojson', data: fc });
    // Breite Linie unsichtbar darunter: leichter zu treffen
    map.addLayer({ id: 'collab-diff-hit', type: 'line', source: 'collab-diff', filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#000', 'line-width': 28, 'line-opacity': 0 } });
    map.addLayer({ id: 'collab-diff-line', type: 'line', source: 'collab-diff', filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-dasharray': [0.1, 1.8],
        'line-width': ['interpolate', ['linear'], ['get', 'on'], 0, 5, 0.5, 6, 1, 8],
        'line-opacity': ['interpolate', ['linear'], ['get', 'on'], 0, 0.3, 0.5, 0.95, 1, 1] } });
    map.addLayer({ id: 'collab-diff-dot', type: 'circle', source: 'collab-diff', filter: ['==', '$type', 'Point'],
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['get', 'on'], 0, 5, 1, 8],
        'circle-opacity': ['interpolate', ['linear'], ['get', 'on'], 0, 0.3, 0.5, 1, 1, 1], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  } else map.getSource('collab-diff').setData(fc);
}

/** Tipp auf die Karte während der Auswahl: welche Fassung liegt unter dem Finger → 'mine' | 'theirs' | null */
function sideAt(e) {
  const box = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
  const hit = map.queryRenderedFeatures(box, { layers: ['collab-diff-dot', 'collab-diff-hit'] });
  return hit[0]?.properties.side ?? null;
}

/**
 * Dieselben Punkte: Auswahl auf der Karte – Leiste unten („So übernehmen“), die Karte bleibt frei zum Ansehen und
 * Antippen. Auch die beiden Chips in der Leiste wählen → 'mine' | 'theirs' | null (später)
 */
function pickOnMap(cf, who, step) {
  return new Promise((done) => {
    let sel = null;
    const bar = document.createElement('div');
    bar.className = 'collab-pickbar';
    bar.setAttribute('role', 'dialog');
    bar.innerHTML = `<p><b>${t('tour.merge.title', { step: esc(step) })}</b> ${t('tour.merge.points', { who: esc(who) })}</p>
      <div class="pick-sides">
        <button type="button" class="pick-side" data-side="mine"><i style="background:${MINE}"></i>${t('tour.merge.mine')}</button>
        <button type="button" class="pick-side" data-side="theirs"><i style="background:${THEIRS}"></i>${t('tour.merge.theirs', { who: esc(who) })}</button>
      </div>
      <div class="pick-go"><button type="button" class="button" data-pick="later">${t('tour.merge.later')}</button>
        <button type="button" class="button primary" data-pick="go" disabled><span class="msr">check</span> ${t('tour.bg.take.button')}</button></div>`;
    document.body.append(bar);
    const choose = (side) => {
      sel = side;
      showConflict(cf, sel);
      bar.querySelectorAll('.pick-side').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === sel)));
      bar.querySelector('[data-pick=go]').disabled = !sel;
    };
    const finish = (v) => { picking = null; bar.remove(); done(v); };
    bar.addEventListener('click', (e) => {
      const side = e.target.closest('.pick-side')?.dataset.side;
      if (side) return choose(side);
      const act = e.target.closest('[data-pick]')?.dataset.pick;
      if (act === 'go' && sel) finish(sel);
      else if (act === 'later') finish(null);
    });
    picking = (e) => { const side = sideAt(e); if (side) choose(side); };
    showConflict(cf);
    const all = [cf.before, ...cf.mine, ...cf.theirs, cf.after].filter(Boolean);
    const b = bbox(all);
    requestAnimationFrame(() => {
      const h = map.getContainer().clientHeight;
      const pad = { top: 70, left: 40, right: 64, bottom: Math.min(bar.getBoundingClientRect().height + 40, h - 140) };
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, maxZoom: 17, duration: 500 });
    });
  });
}

/** Eine Frage beim Zusammenführen → 'mine' | 'theirs' | null (abgebrochen) */
function askConflict(cf, who, n, total) {
  const step = total > 1 ? t('tour.merge.step', { n, total }) : '';
  if (cf.key === 'points') return pickOnMap(cf, who, step);
  showConflict(null);
  const val = (v) => (cf.key === 'profile' ? PROFILES[v]?.label ?? v : cf.key === 'fixed' ? (v.fixed ? t('tour.merge.fixed') : t('tour.merge.free')) : v || t('tour.merge.empty'));
  const what = { name: t('tour.merge.what.name'), description: t('tour.merge.what.description'), profile: t('tour.merge.what.profile'), fixed: t('tour.merge.what.fixed') }[cf.key];
  return ask({
    icon: 'merge', title: t('tour.merge.title', { step }), className: 'collab-pick stacked',
    text: t('tour.merge.other', { who, what }),
    buttons: [
      { value: 'mine', icon: 'person', label: t('tour.merge.mine_value', { v: val(cf.mine) }), primary: true },
      { value: 'theirs', icon: 'group', label: t('tour.merge.theirs_value', { who, v: val(cf.theirs) }) },
    ],
  });
}

/**
 * Inzwischen hat jemand anders geändert (`r` vom Server): zusammenführen. Was nur eine Seite geändert hat, kommt
 * ohne Frage hinein; gefragt wird nur, wo beide dieselbe Stelle anders geändert haben (data/tour-merge.js).
 * → true: zusammengeführt (danach geht der eigene Teil zum Server) | false: abgebrochen
 */
async function mergeRemote(r) {
  const who = r.editor || t('tour.merge.others');
  const base = lastCollabCode ? await decodeShare(lastCollabCode).catch(() => null) : null;
  const merged = mergeTours(base, { ...tour, name: tour.name || t('tour.default_tour') }, await decodeShare(r.code));
  const picks = [];
  try {
    for (const [i, cf] of merged.conflicts.entries()) {
      const p = await askConflict(cf, who, i + 1, merged.conflicts.length);
      if (!p) return false;
      picks.push(p);
    }
  } finally { showConflict(null); }
  const c = tour.collab;
  c.rev = r.rev; c.editor = r.editor;
  lastCollabCode = await normCode(r.code);
  await applyTour(resolveMerge(merged, picks));
  tours.save(snapshotTour());
  paintCollab();
  toast(merged.conflicts.length ? t('tour.merge.done', { who }) : t('tour.merge.both', { name: r.editor || t('tour.collab.someone') }));
  return true;
}

/* Nach Ablauf (30 Tage ohne Änderung) ist die Kopie auf dem Server weg – die Tour bleibt bei jedem, der sie hat,
   nur gemeinsam geht es nicht mehr: einmal Bescheid sagen, dann nichts mehr schicken oder holen */
const collabOff = (c) => !c || c.gone || collabState(c).gone;
function collabGone(err) {
  if (!['server.share.collab_gone', 'server.share.link_gone'].includes(err?.key)) return false;
  tour.collab = { ...tour.collab, gone: true };
  tours.save(snapshotTour());
  paintCollab();
  toast(t('tour.collab.expired'));
  return true;
}

async function pushCollab() {
  const c = tour.collab;
  if (collabOff(c) || readOnly) return;
  // Nie zweimal zugleich: sonst kam das zweite Schicken mit demselben Stand als „gleichzeitig geändert“ zurück
  if (collabBusy) { collabAgain = true; return; }
  collabBusy = true;
  try {
    const code = await mineCode();
    if (code === lastCollabCode) return;
    const me = await myName();
    const r = await collabPut(c, code, me);
    if (r.ok) { c.rev = r.rev; c.editor = me; c.expires = r.expires ?? c.expires; lastCollabCode = code; tours.save(snapshotTour()); paintCollab(); return; }
    // Der Server hat schon genau das (die Antwort aufs letzte Schicken ging verloren): nichts zu fragen
    if (await normCode(r.code) === code) { c.rev = r.rev; c.editor = r.editor; lastCollabCode = code; tours.save(snapshotTour()); paintCollab(); return; }
    // Inzwischen hat jemand anders geändert: zusammenführen, danach den eigenen Teil zurück zum Server.
    // Abgebrochen: bleibt hier, wie es ist – beim nächsten Speichern kommt die Frage wieder
    collabAgain = await mergeRemote(r);
  } catch (err) {
    if (!collabGone(err)) toast(err.message || t('tour.collab.push_failed'));
  } finally {
    collabBusy = false;
    if (collabAgain) { collabAgain = false; pushCollab(); }
  }
}

async function pullCollab() {
  const c = tour.collab;
  if (collabOff(c) || collabBusy || document.visibilityState !== 'visible') return;
  try {
    const r = await collabGet(c);
    if (r.expires && r.expires !== c.expires) { c.expires = r.expires; paintCollab(); }
    if (r.rev <= c.rev) return;
    const theirs = await normCode(r.code);
    // Inhaltlich derselbe Stand (jemand hat nur geöffnet, oder es ist der eigene): still übernehmen, keine Meldung
    if (theirs === lastCollabCode || theirs === await mineCode()) { c.rev = r.rev; lastCollabCode = theirs; return; }
    // Hier noch nicht gesichert: erst die eigene Änderung schicken – dann fragt pushCollab
    if ($('#save').dataset.state === 'dirty') return;
    // Gespeichert, aber nicht beim Server angekommen (kein Netz): nicht überschreiben – schicken, das führt zusammen
    if (lastCollabCode && await mineCode() !== lastCollabCode) { pushCollab(); return; }
    await applyRemote(r.code, r.rev, r.editor);
    tours.save(snapshotTour());
  } catch (err) { collabGone(err); /* sonst nächstes Mal */ }
}
setInterval(pullCollab, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullCollab(); });

/* GPX mit Höhen */
function exportGpx() {
  if (!route) { toast(t('tour.toast.need_route')); return; }
  const total = route.cum[route.cum.length - 1] || 1;
  const ele = route.elevation;
  const eleAt = (i) => {
    if (!ele.length) return null;
    const km = (route.cum[i] / 1000) * ((route.length || total) / total);
    let lo = 0, hi = ele.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ele[mid][0] <= km) lo = mid; else hi = mid; }
    const [k0, h0] = ele[lo], [k1, h1] = ele[hi];
    return k1 === k0 ? h0 : h0 + ((h1 - h0) * (km - k0)) / (k1 - k0);
  };
  const name = tour.name || t('tour.file_default');
  const file = `${name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '') || t('tour.file_default')}.gpx`;
  download(file, toGpx({ ...tour, name }, route.coords, eleAt));
}

/** Tour für alle auf WMap teilen (Entdecken → Von anderen) – sofort sichtbar */
async function publishTour() {
  if (!route) { toast(t('tour.toast.need_route')); return; }
  const { ensureLogin } = await import('../services/konto.js');
  const { api } = await import('../services/api.js');
  const v = await ask({
    icon: 'public', title: t('tour.publish.title'),
    text: t('tour.publish.text'),
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('tour.more.publish'), primary: true }],
  });
  if (v !== 'yes' || !await ensureLogin(t('tour.publish.login_reason'))) return;
  if (!tour.name) { tour.name = await defaultName(); nameInput.value = tour.name; }
  try {
    const r = await api(['tours', 'save'], {
      id: tour.serverId ?? undefined, name: tour.name, description: tour.description ?? '', profile: tour.profile,
      shape: shapeOf(simplifyTo(route.coords, 1500)), length: route.length, ascent: route.ascent ?? 0, bbox: route.bounds, publish: true,
    });
    tour.serverId = r.id;
    scheduleSave();
    toast(t('tour.publish.done'));
  } catch (err) { toast(err.message); }
}

function deleteTour() {
  if (!tour.id) { location.href = './wege.html?tab=geplant'; return; }
  if (!confirm(t('tour.delete_confirm', { name: tour.name }))) return;
  tours.remove(tour.id);
  location.href = './wege.html?tab=geplant';
}

/* Beim Verlassen das Vorschaubild nachziehen, falls es noch keins gibt */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden' && !readOnly && tour.id && !tour.preview && route) {
    await save(await capturePreview());
  }
});

/* ── Los ─────────────────────────────────────────────────────────────────── */

map.on('load', () => recompute({ fit: true }));

// Gemeinsame Tour: über den Link geöffnet – gleich hier speichern; dann den neuesten Stand holen
if (tour.collab) {
  if (joining) {
    // Mit der eigenen Tour verbunden: beide Fassungen zusammenführen (ohne gemeinsamen Stand – gefragt wird, wo sie sich
    // unterscheiden), dann geht das Ergebnis an alle. Abgebrochen: die eigene Tour bleibt, wie sie war, ohne Link
    if (!map.loaded()) await new Promise((ok) => map.once('load', ok));
    if (await mergeRemote(joining)) { pushCollab(); toast(t('tour.collab.joined')); }
    else { delete tour.collab; tours.save(snapshotTour()); }
  } else if (!tour.id) { await save(); toast(t('tour.collab.opened')); }
  paintCollab();
  if (tour.collab) pullCollab();
}

/* Beim Planen flach von oben: Straßennamen eine Stufe früher und dichter als
   auf der geneigten Hauptkarte – man orientiert sich an ihnen */
map.on('style.load', () => {
  for (const [id, min] of [['highway-name-path', 14.5], ['highway-name-minor', 13.5], ['highway-name-major', 11]]) {
    if (!map.getLayer(id)) continue;
    map.setLayerZoomRange(id, min, 24);
    map.setLayoutProperty(id, 'symbol-spacing', 300);
    map.setLayoutProperty(id, 'text-padding', 6);
  }
});


