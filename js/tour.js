/**
 * Tourenplaner: Punkte in die Karte setzen, dazwischen wird je nach Profil
 * über passende Wege geroutet (Rennrad auf Asphalt, Gravel über Schotter,
 * Wandern über Pfade …). Unten stehen immer Zahlen, Höhenprofil und die
 * Anteile von Wegtypen und Belägen.
 *
 * Aufruf:  tour.html            neue Tour
 *          tour.html?id=…       gespeicherte Tour bearbeiten
 *          tour.html#t=…        geteilte Tour ansehen (nur lesen, übernehmbar)
 *
 * Hintergrund (tour.backgrounds): bekannte Wege aus Entdecken und eigene
 * Touren liegen unter der Planung – so, wie sie in OSM bzw. gespeichert
 * sind. Punkte nah an einem Hintergrund rasten auf ihm ein, und liegen zwei
 * Punkte nacheinander darauf, folgt die Strecke dazwischen genau ihm statt
 * dem Routing. „So übernehmen“ nimmt den ganzen Verlauf. Hintergründe werden
 * mit der Tour gespeichert; entfernt man einen, ist er weg.
 */
import { PROFILES } from './config.js';
import { createMap, showRoutes, showHover } from './map.js';
import { segment, joinSegments, wayInfo, heightsAlong, hikingTime } from './routing.js';
import { ElevationProfile } from './elevation.js';
import { tours, shapeOf, coordsOf, encodeShare, decodeShare, toGpx, download, local } from './store.js';
import { sheet as sidePanel } from '../libs/wuefl-libs/userDialog/userDialog.js';
import { mountLayerMenu } from './layer-menu.js';
import { ask } from './ui.js';
import * as geocode from './geocode.js';
import { distance, nearestOnLine, pointAt, simplifyTo, bbox, cumulative, fmtDistance, fmtDuration, esc } from './geo.js';
import { setupStages } from './tour-stages.js';
import { tourLine, originalRoute, searchTours } from './known-tours.js';
import './folder.js';   // gespeicherte Touren landen auch im verbundenen Ordner

const $ = (s, root = document) => root.querySelector(s);

function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ══════════════════════════════════════════════════════════════════════════
   Tour laden
   ══════════════════════════════════════════════════════════════════════════ */

const TOUR_PROFILES = Object.entries(PROFILES).filter(([, p]) => p.tour).map(([id]) => id);
const shareCode = new URLSearchParams(location.hash.slice(1)).get('t');
const idParam = new URLSearchParams(location.search).get('id');

let tour = null;
let readOnly = false;
if (shareCode) {
  try {
    tour = { ...(await decodeShare(shareCode)), id: null };
    // Nur eine Vorlage (aus Entdecken): gleich selbst planen
    readOnly = !(tour.backgrounds?.length && !tour.points.length);
  } catch { toast('Der Link ist unvollständig oder beschädigt'); }
} else if (idParam) {
  tour = tours.get(idParam);
  if (!tour) toast('Tour nicht gefunden – hier geht es mit einer neuen los');
}
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

const sheet = $('#sheet');
sheet.show();
document.activeElement?.blur();                // kein Fokusrahmen um den Griff
// Panel wie bei Meine Touren: Rechner links (Breite ziehen, ganz einklappen), Handy unten
let fitTimer = null;
const panel = sidePanel(sheet, { min: 300, key: 'wmap.tourPanel', onChange: () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitRoute, 280); } });
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
if (readOnly) { $('.save-label').textContent = 'Übernehmen'; $('#save .msr').textContent = 'library_add'; }

function paintTitle() {
  document.title = `${tour.name || 'Neue Tour'} – WMap`;
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

/* Profile als Chips */
function paintProfiles() {
  $('.tour-profiles').innerHTML = TOUR_PROFILES.map((id) => {
    const p = PROFILES[id];
    return `<button type="button" class="chip" role="radio" data-profile="${id}" aria-pressed="${id === tour.profile}"
      aria-checked="${id === tour.profile}"><span class="msr">${p.icon}</span>${esc(p.label)}</button>`;
  }).join('');
}
paintProfiles();
$('.tour-profiles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-profile]');
  if (!b || b.dataset.profile === tour.profile) return;
  tour.profile = b.dataset.profile;
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
  if (tour.fixed) { tour.fixed = false; toast('Eigene Änderung – die Strecke wird jetzt neu berechnet'); }
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
  hint.textContent = n === 0 ? 'Tippe in die Karte, um den Start zu setzen' : 'Und jetzt das nächste Ziel antippen';
}

function pointPopup(i) {
  popup?.remove();
  const el = document.createElement('div');
  el.className = 'popup context';
  const entries = [['delete', 'Punkt entfernen', () => change(() => tour.points.splice(i, 1))]];
  if (i > 0) entries.push(['trip_origin', 'Hier starten', () => change(() => { tour.points = tour.points.slice(i).concat(tour.points.slice(0, i)); })]);
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
  // Etappen-Modus: Tippen auf die Linie setzt ein Tagesende (auch bei geteilten Touren)
  if (stages.click(e)) return;
  if (readOnly || e.originalEvent?.target?.closest?.('.wp-marker')) return;
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

/* Ort suchen und als nächsten Punkt anhängen */
const searchInput = $('#tour-search');
const results = $('.tour-search-results');
let searchCtl = null;
const runSearch = debounce(async () => {
  const q = searchInput.value.trim();
  searchCtl?.abort();
  if (q.length < 3) { results.hidden = true; return; }
  searchCtl = new AbortController();
  try {
    const found = await geocode.search(q, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 5, signal: searchCtl.signal });
    results.innerHTML = found.map((f, i) => {
      const d = geocode.describe(f);
      return `<li><button type="button" class="button" data-i="${i}"><span class="msr">add_location_alt</span>
        <span><strong>${esc(d.title)}</strong>${d.subtitle ? `<small>${esc(d.subtitle)}</small>` : ''}</span></button></li>`;
    }).join('') || '<li class="muted">Nichts gefunden</li>';
    results.hidden = false;
    results._found = found;
  } catch { /* abgebrochen */ }
}, 300);
searchInput.addEventListener('input', runSearch);
$('.tour-search').addEventListener('submit', (e) => { e.preventDefault(); results.querySelector('button')?.click(); });
results.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const f = results._found[+b.dataset.i];
  change(() => tour.points.push(f.geometry.coordinates.slice(0, 2)));
  searchInput.value = '';
  results.hidden = true;
  toast(`„${geocode.describe(f).title}“ als ${tour.points.length === 1 ? 'Start' : `Punkt ${tour.points.length}`} gesetzt`);
  // Zum gefundenen Ort, mittig im freien Teil der Karte
  map.flyTo({ center: tour.points.at(-1), zoom: Math.max(map.getZoom(), 14), padding: viewPadding(), duration: 1200 });
});

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
      const t = tours.get(def.id);
      if (!t?.shape) throw new Error('Diese Tour gibt es nicht mehr');
      g.sections = [coordsOf(t.shape)];
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
      <span><strong>${esc(g.def.name || (g.def.type === 'tour' ? 'Eigene Tour' : 'Bekannter Weg'))}</strong>
        <small>${g.error ? esc(g.error) : g.loading ? 'Wird geladen …' : g.def.type === 'tour' ? 'eigene Tour'
          : `aus OpenStreetMap${g.sections.length > 1 ? ` · ${g.sections.length} Stücke${g.track ? '' : ', Verlauf wird verbunden …'}` : ''}`}</small></span>
      ${tour.fixed || g.loading || g.error ? '' : `<button type="button" class="button${empty ? ' primary' : ''}" data-bg="take" data-i="${i}" title="Ganzen Verlauf übernehmen"><span class="msr">done_all</span> So übernehmen</button>`}
      <button type="button" class="button" data-shape="round no-background" data-bg="remove" data-i="${i}" title="Aus dem Hintergrund nehmen"><span class="msr">close</span></button>
    </li>`).join('');
  box.innerHTML = `
    <span class="section-title">Hintergrund</span>
    ${bgs.length && empty ? '<p class="muted">Setze deine Punkte selbst – auf dem Hintergrund folgt die Strecke genau dem Weg, daneben wird geroutet. Oder übernimm den ganzen Verlauf.</p>' : ''}
    ${bgs.length ? `<ul class="bg-list">${rows}</ul>` : ''}
    <div class="tour-tools">
      <button type="button" class="button" data-bg="add" aria-expanded="${adding}"><span class="msr">add</span> Weg oder Tour dazulegen</button>
      ${bgs.length ? `<button type="button" class="button" data-bg="toggle"><span class="msr">${bgOn ? 'visibility_off' : 'visibility'}</span> ${bgOn ? 'Ausblenden' : 'Einblenden'}</button>` : ''}
      ${bgs.length && !empty ? '<button type="button" class="button" data-bg="fresh"><span class="msr">edit_road</span> Neu planen</button>' : ''}
    </div>
    ${adding ? `<form class="tour-search bg-search" autocomplete="off"><span class="msr">search</span>
      <input type="search" placeholder="Bekannter Weg oder eigene Tour …" aria-label="Weg oder Tour suchen"></form>
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
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t, ay + dy * t);
    if (d > ON_TEMPLATE) continue;
    const along = cum[i] + (cum[i + 1] - cum[i]) * t;
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
  button.innerHTML = '<span class="msr spin">progress_activity</span> Wird übernommen …';
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
  } catch (err) { toast(`Ließ sich nicht übernehmen (${err.message})`); }
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
    toast('Setze deine Punkte – der Hintergrund bleibt');
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
  const mine = tours.all().filter((t) => t.id !== tour.id && t.shape && t.name?.toLowerCase().includes(low)).slice(0, 5)
    .map((t) => ({ def: { type: 'tour', id: t.id, name: t.name }, icon: 'bookmark', sub: `Eigene Tour${t.stats?.length ? ` · ${fmtDistance(t.stats.length)}` : ''}` }));
  const row = (x) => `<li><button type="button" class="button" data-add='${esc(JSON.stringify(x.def))}'><span class="msr">${x.icon}</span>
    <span>${esc(x.def.name)}<small>${esc(x.sub)}</small></span></button></li>`;
  list.innerHTML = mine.map(row).join('') + (q.length >= 3 ? '<li class="muted">Bekannte Wege werden gesucht …</li>' : '');
  if (q.length < 3) return;
  bgCtl?.abort();
  bgCtl = new AbortController();
  const kind = KIND_OF[tour.profile] ?? 'hike';
  try {
    const ways = (await searchTours(q, kind, { signal: bgCtl.signal })).slice(0, 8)
      .map((w) => ({ def: { type: 'way', id: w.id, kind, name: w.name }, icon: 'route', sub: [w.network, w.ref].filter(Boolean).join(' · ') }));
    list.innerHTML = [...mine, ...ways].map(row).join('') || '<li class="muted">Nichts gefunden</li>';
  } catch (err) {
    if (err.name !== 'AbortError') list.innerHTML = mine.map(row).join('') + `<li class="muted">Wege gerade nicht abrufbar (${esc(err.message)})</li>`;
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
  status('Route wird berechnet …');
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
  status('Originalverlauf – ändern, indem du Punkte verschiebst oder hinzufügst', false);
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
  $('.st-up').textContent = route ? `${route.ascent} m` : '–';
  $('.st-down').textContent = route ? `${route.descent} m` : '–';
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
  box.innerHTML = '<p class="muted">Wegtypen werden ermittelt …</p>';
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
    box.innerHTML = block('Wegtypen', info.ways) + block('Beläge', info.surfaces);
  } catch {
    box.innerHTML = '';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Speichern, Teilen, Export, Löschen
   ══════════════════════════════════════════════════════════════════════════ */

async function defaultName() {
  if (!tour.points.length) return `Tour vom ${new Date().toLocaleDateString('de-DE')}`;
  try {
    const f = await geocode.reverse(tour.points[0]);
    const d = f && geocode.describe(f);
    const place = f?.properties.city ?? f?.properties.town ?? f?.properties.village ?? d?.title;
    if (place) return `${PROFILES[tour.profile].label} ab ${place}`;
  } catch { /* dann eben mit Datum */ }
  return `Tour vom ${new Date().toLocaleDateString('de-DE')}`;
}

function snapshotTour(preview) {
  return {
    ...tour,
    name: tour.name || 'Neue Tour',
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
  b.title = state === 'saved' ? 'Gespeichert – findest du unter „Meine Touren“' : state === 'dirty' ? 'Speichert …' : 'Tour speichern';
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
  tour.id = null;
  saveState('new');
  history.replaceState(null, '', './tour.html');
  renderMarkers();
}

$('#save').addEventListener('click', async () => {
  if (readOnly) adopt();
  if (tour.points.length < 2) { toast('Setze mindestens zwei Punkte'); return; }
  await save(await capturePreview());
  toast('Tour gespeichert');
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

/* Teilen: Link trägt die Tour selbst */
const shareDialog = $('#share-dialog');
async function shareTour() {
  if (tour.points.length < 2) { toast('Erst eine Strecke planen'); return; }
  const code = await encodeShare({ ...tour, name: tour.name || nameInput.value || 'Tour' });
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#t=${code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: tour.name, text: `Tour: ${tour.name}`, url }); return; } catch { /* dann Dialog */ }
  }
  $('#share-link').value = url;
  shareDialog.showModal();
  $('#share-link').select();
}
shareDialog.addEventListener('click', async (e) => {
  const b = e.target.closest('button[value]');
  if (!b) return;
  if (b.value === 'copy') {
    try { await navigator.clipboard.writeText($('#share-link').value); toast('Link kopiert'); } catch {
      $('#share-link').select();
      document.execCommand?.('copy');
      toast('Link markiert – bitte kopieren');
    }
  }
  shareDialog.close();
});

/* GPX mit Höhen */
function exportGpx() {
  if (!route) { toast('Erst eine Strecke planen'); return; }
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
  const name = tour.name || 'tour';
  const file = `${name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '') || 'tour'}.gpx`;
  download(file, toGpx({ ...tour, name }, route.coords, eleAt));
}

/** Tour für alle auf WMap teilen (Entdecken → Von anderen) – sofort sichtbar */
async function publishTour() {
  if (!route) { toast('Erst eine Strecke planen'); return; }
  const { ensureLogin } = await import('./konto.js');
  const { api } = await import('./api.js');
  const v = await ask({
    icon: 'public', title: 'Tour veröffentlichen',
    text: 'Andere sehen sie sofort unter „Entdecken → Von anderen“ und können sie bewerten. Dein Name steht dabei.',
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Veröffentlichen', primary: true }],
  });
  if (v !== 'yes' || !await ensureLogin('Zum Veröffentlichen')) return;
  if (!tour.name) { tour.name = await defaultName(); nameInput.value = tour.name; }
  try {
    const r = await api(['tours', 'save'], {
      id: tour.serverId ?? undefined, name: tour.name, description: tour.description ?? '', profile: tour.profile,
      shape: shapeOf(simplifyTo(route.coords, 1500)), length: route.length, ascent: route.ascent ?? 0, bbox: route.bounds, publish: true,
    });
    tour.serverId = r.id;
    scheduleSave();
    toast('Veröffentlicht – unter „Entdecken“ zu sehen');
  } catch (err) { toast(err.message); }
}

function deleteTour() {
  if (!tour.id) { location.href = './wege.html?tab=geplant'; return; }
  if (!confirm(`„${tour.name}“ wirklich löschen?`)) return;
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


