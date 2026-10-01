/**
 * Autobildschirm (Android Auto). Die App zeigt dort Googles Vorlagen – Suche,
 * Listen, Ort, Routenwahl, Anweisung –, gezeichnet vom Auto
 * (tools/android/car/*.kt). Nur die Karte malt WMap selbst: diese Seite mit
 * `?car`, in einem eigenen WebView auf der Kartenfläche des Autos, ohne
 * Suchleiste, Blätter und Knöpfe (html.car-mode, css/app/car.css).
 *
 * Kotlin fragt hier nach – Suche, Kategorien, Orte, Routen, Touren – und
 * bekommt Daten zurück; die Fachlogik ist dieselbe wie in der App:
 *
 *   Kotlin → Seite   wmapCar.call(id, 'methode', [argumente])
 *   Seite → Kotlin   WMapCar.post('reply', { id, ok, value | error })
 *                    WMapCar.post('guidance' | 'navEnd' | 'ask' | 'toast' | 'list', …)
 *
 * Kurze Fragen (Pillen, „Immer noch Stau?“) und Hinweise erscheinen im Auto
 * als dessen Hinweise mit „Ja“/„Nein“ (osm/quick-ask.js, ui/dialogs.js).
 * Dialoge, die auf einen Klick warten, gibt es hier nicht.
 *
 * Im Browser (Tests: index.html?car) landet alles in window.__carOut.
 */
import { byId, matchCategory } from '../core/categories.js';
import * as geocode from '../services/geocode.js';
import * as overpass from '../services/overpass.js';
import * as osm from '../osm/objects.js';
import { describePoi, categoryFor } from '../ui/poi-info.js';
import { places, PLACE_KINDS } from '../data/saved.js';
import { recent, tours } from '../data/store.js';
import { shareSync } from '../data/car-share.js';
import { theme } from '../core/theme.js';
import { capFps } from '../core/fps.js';
import { osmRef, BASE_POI_LAYERS } from '../map/map.js';
import { bboxAround, distance, fmtDistance, fmtDuration } from '../core/geo.js';
import { PROFILES } from '../core/config.js';
import { maneuverIcon } from '../services/routing.js';
import { current, fitTo, map, parseTags, showHl, state } from '../app/core.js';
import { tilePoints } from '../app/category.js';
import { clearPlace, featureFromPoint, showPlace } from '../app/place.js';
import { enterRoute, leaveRouteMode, setProfile } from '../app/route-plan.js';
import { clearRoutes, computeRoutes, fitRoute, selectRoute } from '../app/route-results.js';
import { prefs as routePrefs, reloadPrefs, setPref } from '../ui/route-prefs.js';
import { nav, navTour, startNav } from '../app/nav.js';
import { closeSheet } from '../app/views.js';
import { startDrive, pauseDrive, resumeDrive, hudInsets, recenterIcon } from './drive.js';

// Das Auto zeigt ein Video der Karte, meist mit 30 Bildern je Sekunde – mehr zu zeichnen kostet nur
// Rechenzeit und Wärme (core/fps.js). 20 reichen für eine ruhige Fahrt.
const CAR_FPS = 20;
const GESTURE_FPS = 30;
capFps(CAR_FPS);
// „Ziel erreicht“ bleibt so lange stehen, dann endet die Navigation von selbst
const ARRIVED_MS = 30000;

const bridge = window.WMapCar ?? null;
const send = (type, data) => {
  if (bridge) bridge.post(type, JSON.stringify(data ?? null));
  else (window.__carOut ??= []).push({ type, data });
};

/** Kategorien für „In der Nähe“ – was man im Auto sucht */
const NEARBY = ['parking', 'fuel', 'charging', 'rest', 'toilets', 'cafe', 'fastfood', 'restaurant', 'supermarket', 'bakery', 'pharmacy', 'hotel'];
const RADIUS_M = 4000;

/** Treffer der letzten Liste – Kotlin wählt per Schlüssel */
const hits = new Map();
let seq = 0;
const keep = (f) => { const key = `h${++seq}`; hits.set(key, f); return key; };

const here = () => state.position ?? map.getCenter().toArray();
const dist = (p) => (state.position ? distance(state.position, p) : null);
const ORIGINAL = { originalEvent: new Event('car') };

/* ── Symbole als Bild: das Auto kennt keine Schrift mit Symbolen ─────────── */

const ICONS = new Map();
async function icon(name, color = '#ffffff', size = 96) {
  const key = `${name}|${color}|${size}`;
  if (ICONS.has(key)) return ICONS.get(key);
  const font = `${Math.round(size * 0.8)}px "Material Symbols Rounded"`;
  try { await document.fonts.load(font, name); } catch { /* dann eben so */ }
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, size / 2, size / 2);
  const png = c.toDataURL('image/png').split(',')[1];
  ICONS.set(key, png);
  return png;
}

/** Zeilen mit ihrem Symbol als Bild (Feld png) */
const withPng = async (items) => Promise.all(items.map(async (it) => (it.icon
  ? { ...it, png: await icon(it.icon, it.color ?? '#8ab4f8', 64) } : it)));

/* ── Orte ────────────────────────────────────────────────────────────────── */

/** Photon-Feature, Kategorie-Treffer oder Kartensymbol → Zeile für die Liste */
function row(f, { icon: ic, color, sub } = {}) {
  const d = f.properties._point ? { title: f.properties.name, subtitle: '', type: '', icon: 'location_on' } : geocode.describe(f);
  const m = dist(f.geometry.coordinates);
  return {
    key: keep(f), title: d.title, icon: ic ?? d.icon ?? 'location_on', color: color ?? null,
    sub: sub ?? [m !== null ? fmtDistance(m) : null, d.type, d.subtitle].filter(Boolean).join(' · '),
    point: f.geometry.coordinates, dist: m,
  };
}

/** Ort mit allem, was das Auto zeigen kann – Details aus OSM, wenn es sie gibt */
async function details(f) {
  const d = f.properties._point ? { title: f.properties.name, subtitle: '', type: '' } : geocode.describe(f);
  let tags = f.properties._tags ?? (f.properties.osm_key ? { [f.properties.osm_key]: f.properties.osm_value } : {});
  const { osm_type: type, osm_id: id } = f.properties;
  if (!f.properties._tags && type && id) {
    try { tags = await osm.tags(type, id); f.properties._tags = tags; } catch { /* dann ohne */ }
  }
  const info = describePoi(tags, { name: d.title, fallbackType: d.type });
  let address = d.subtitle;
  if (!address) {
    try { const r = await geocode.reverse(f.geometry.coordinates); if (r) address = [geocode.describe(r).title, geocode.describe(r).subtitle].filter(Boolean).join(', '); } catch { /* ohne Adresse */ }
  }
  const m = dist(f.geometry.coordinates);
  const cat = info.category ?? categoryFor(tags);
  const saved = places.all().some((p) => distance(p.point, f.geometry.coordinates) < 15);
  return {
    key: keep(f), title: info.name, type: info.type ?? d.type ?? '', address, status: info.status ?? '',
    open: info.open, dist: m, distText: m !== null ? fmtDistance(m) : '', point: f.geometry.coordinates,
    icon: cat?.icon ?? 'location_on', color: cat?.color ?? '#e8590c', saved,
    png: await icon(cat?.icon ?? 'location_on', cat?.color ?? '#e8590c', 96),
    facts: info.facts.filter((x) => !x.unknown && !x.value.includes('\n')).slice(0, 3).map((x) => ({ label: x.label, value: x.value })),
  };
}

/** Ort auf der Karte zeigen (Marker, Umriss, hinfliegen) und beschreiben */
async function openPlace(f) {
  pauseDrive();
  showPlace(f, { fly: true, over: nav.active, push: false });
  return details(f);
}

/** Was liegt an dieser Stelle der Karte? (wie map-clicks.js, ohne Blatt) */
function hitAt(x, y) {
  const layers = ['hl-dot', 'poi-dot', ...BASE_POI_LAYERS].filter((id) => map.getLayer(id));
  const box = [[x - 12, y - 12], [x + 12, y + 12]];
  const hit = layers.length ? map.queryRenderedFeatures(box, { layers })[0] : null;
  if (!hit) return null;
  if (hit.layer.id === 'hl-dot' || hit.layer.id === 'poi-dot') return featureFromPoint(hit);
  const ref = osmRef(hit);
  const pr = hit.properties;
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: hit.geometry.coordinates },
    properties: {
      name: pr['name:de'] ?? pr.name_de ?? pr.name, osm_type: ref?.type, osm_id: ref?.id,
      osm_key: pr.class === 'shop' ? 'shop' : 'amenity', osm_value: pr.subclass,
    },
  };
}

/* ── Kategorien ──────────────────────────────────────────────────────────── */

let catCtl = null;
function catRows(cat, points) {
  const ref = here();
  return points
    .map((p) => ({ p, m: distance(ref, p.geometry.coordinates) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 30)
    .map(({ p, m }, i) => {
      const info = describePoi(parseTags(p.properties.tags), { name: p.properties.name });
      const f = featureFromPoint(p);
      // Nummer am Namen und am Punkt auf der Karte – „Parkplatz, (3)“ in der Liste ist die 3 auf der Karte;
      // mit Komma und in Klammern, damit sie nicht wie ein Teil des Namens aussieht
      return {
        key: keep(f), nr: i + 1, title: `${info.name}, (${i + 1})`, icon: cat.icon, color: cat.color, point: p.geometry.coordinates, dist: m,
        sub: [fmtDistance(m), info.status].filter(Boolean).join(' · '),
      };
    });
}

/** Die Treffer der Liste als nummerierte Punkte auf der Karte (statt der Symbole – die sagen nicht, welcher es ist) */
let numbered = [];
function showNumbers(rows = []) {
  numbered.forEach((n) => n.marker.remove());
  numbered = rows.map((r) => {
    const el = document.createElement('div');
    el.className = 'car-hit';
    el.textContent = r.nr;
    el.style.setProperty('--c', r.color ?? '#1a73e8');
    return { key: r.key, marker: new maplibregl.Marker({ element: el }).setLngLat(r.point).addTo(map) };
  });
}
/** Treffer und ihre Nummern weg */
function clearHits() {
  showHl({});
  showNumbers();
}

/**
 * Karte auf die Treffer: von oben, herausgezoomt, mit dem eigenen Standort –
 * sonst bliebe sie in der Nahansicht der freien Fahrt und zeigte keinen
 * davon. Die nächsten reichen; die Liste des Autos verdeckt einen Teil
 * (carInsets). „Zentrieren“ bzw. zurück zur Karte folgt wieder dem Standort.
 */
function fitHits(points) {
  if (!points.length || nav.active) return;
  const ref = here();
  const near = points.map((p) => p.geometry.coordinates).sort((a, b) => distance(ref, a) - distance(ref, b)).slice(0, 8);
  const xs = [ref[0], ...near.map((p) => p[0])], ys = [ref[1], ...near.map((p) => p[1])];
  pauseDrive();
  fitTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 16, { flat: true });
}

/**
 * Sofort, was die Kartenkacheln kennen; Overpass ergänzt danach (Ereignis
 * „list“ mit derselben Nummer – Kotlin tauscht die Liste aus). Die Karte
 * zoomt auf die Treffer heraus.
 */
async function category(id) {
  const cat = byId(id);
  if (!cat) throw new Error('Unbekannte Kategorie');
  catCtl?.abort();
  catCtl = new AbortController();
  const { signal } = catCtl;
  const bounds = bboxAround(here(), RADIUS_M);
  const token = ++seq;
  const tiles = await tilePoints(cat, bounds, signal).catch(() => []);
  const first = catRows(cat, tiles);
  showHl({});
  showNumbers(first);
  fitHits(tiles);
  overpass.inBbox(cat, bounds, { signal }).then(({ shapes, points }) => {
    if (signal.aborted) return;
    const ids = new Set(points.map((p) => p.properties.id));
    const all = [...points, ...tiles.filter((p) => p.properties.id && !ids.has(p.properties.id))];
    const rows = catRows(cat, all);
    showHl({ shapes });
    showNumbers(rows);
    fitHits(all);
    withPng(rows).then((items) => send('list', { token, title: cat.label, items, final: true }));
  }).catch(async (err) => {
    if (err.name !== 'AbortError') send('list', { token, title: cat.label, items: await withPng(first), final: true, error: tiles.length ? null : err.message });
  });
  return { token, title: cat.label, items: await withPng(first), final: false };
}

/* ── Suche ───────────────────────────────────────────────────────────────── */

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const KIND_ORDER = ['home', 'work', 'fav', 'stop'];
const KIND_COLOR = { home: '#8ab4f8', work: '#8ab4f8', fav: '#fdd663', stop: '#81c995' };

function savedRows(text = '', limit = 6) {
  const w = fold(text).split(/\s+/).filter(Boolean);
  return places.all()
    .filter((p) => !w.length || w.every((x) => fold(`${p.name} ${p.label} ${PLACE_KINDS[p.kind]?.label ?? ''}`).includes(x)))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .slice(0, limit)
    .map((p) => {
      const f = { type: 'Feature', geometry: { type: 'Point', coordinates: p.point }, properties: { name: p.name, _point: true } };
      const m = dist(p.point);
      return {
        ...row(f), kind: 'target', place: p.kind, icon: PLACE_KINDS[p.kind]?.icon ?? 'star', color: KIND_COLOR[p.kind] ?? null,
        sub: [m !== null ? fmtDistance(m) : null, p.label].filter(Boolean).join(' · '),
      };
    });
}

let searchCtl = null;
async function search(text) {
  const q = String(text ?? '').trim();
  // Leer: zuletzt gefahren – Zuhause, Arbeit und Gemerktes stehen als Zeile „Lesezeichen“ darüber (bookmarks)
  if (q.length < 2) return { items: await withPng(methods.recentTargets()) };
  searchCtl?.abort();
  searchCtl = new AbortController();
  const found = await geocode.search(q, { center: here(), zoom: Math.max(map.getZoom(), 12), limit: 8, signal: searchCtl.signal });
  const items = found.map((f) => row(f));
  const cat = matchCategory(q, { loose: true });
  if (cat && !cat.place) {
    const c = cat.category;
    const item = { kind: 'category', id: c.id, title: c.label, icon: c.icon, color: c.color, sub: 'In der Nähe' };
    if (cat.strong) items.unshift(item); else items.splice(2, 0, item);
  }
  return { items: await withPng([...savedRows(q), ...items]) };
}

/* ── Routen ──────────────────────────────────────────────────────────────── */

const routeRows = () => state.routes.map((r) => {
  const tags = [];
  if (r.hasHighway) tags.push('Autobahn');
  else if (state.routes.some((x) => x.hasHighway)) tags.push('ohne Autobahn');
  if (r.hasToll) tags.push('Maut');
  if (r.hasFerry) tags.push('Fähre');
  return { id: r.id, time: r.time, length: r.length, title: `${fmtDuration(r.time)} · ${fmtDistance(r.length)}`, sub: tags.join(' · ') };
});

/** Warten, bis die Planung (app/route-results.js) fertig ist */
async function routesReady() {
  const failed = () => {
    const el = document.querySelector('[data-view="route"] .route-status.error');
    return el && !el.hidden ? el.textContent : null;
  };
  for (let i = 0; i < 240; i += 1) {
    if (state.routes.length) return { title: state.waypoints.at(-1)?.label ?? 'Ziel', routes: routeRows(), selected: state.selected };
    const err = failed();
    if (err) throw new Error(err);
    await new Promise((r) => setTimeout(r, 125));
  }
  throw new Error('Die Route ließ sich nicht berechnen');
}

async function routeTo(key) {
  const f = hits.get(key);
  if (!f) throw new Error('Ort nicht mehr bekannt');
  const title = f.properties._point ? f.properties.name : geocode.describe(f).title;
  return routeToPoint(f.geometry.coordinates, title);
}

async function routeToPoint(point, label) {
  if (nav.active) nav.stop();
  pauseDrive();
  clearPlace();
  clearHits();
  // Autobahn, Maut, Fähren: wie zuletzt eingestellt – am Handy oder hier
  reloadPrefs();
  clearRoutes({ keepSheet: true });
  navTour.set(null);
  setProfile('car');
  // Der Standort läuft im Auto ständig mit – nicht erst auf eine neue Meldung warten
  const from = state.position ? { label: 'Mein Standort', point: state.position, me: false } : { label: 'Mein Standort', point: null, me: true };
  enterRoute({ waypoints: [from, { label, point, me: false }], push: false });
  return routesReady();
}

/* ── Touren ──────────────────────────────────────────────────────────────── */

/** Fürs Auto geplant? – Wander- und Radtouren gehören nicht auf den Autobildschirm */
const forCar = (t) => PROFILES[t.profile]?.costing === 'auto';

function tourList() {
  return tours.all().filter((t) => t.points?.length >= 2 && forCar(t)).slice(0, 40).map((t) => ({
    id: t.id, title: t.name || 'Tour',
    sub: [t.stats?.length ? fmtDistance(t.stats.length) : null, PROFILES[t.profile]?.label].filter(Boolean).join(' · '),
    icon: PROFILES[t.profile]?.icon ?? 'route',
  }));
}

/** Geplante Tour als Route (wie „?tour=“ in app.js) – gerechnet wird mit dem Auto */
async function tour(id) {
  const t = tours.get(id);
  if (!t?.points?.length) throw new Error('Die Tour gibt es auf diesem Gerät nicht');
  if (!forCar(t)) throw new Error('Die Tour ist nicht fürs Auto geplant');
  if (nav.active) nav.stop();
  pauseDrive();
  clearPlace();
  clearHits();
  reloadPrefs();
  clearRoutes({ keepSheet: true });
  setProfile('car');
  navTour.set(t);
  const n = t.points.length;
  enterRoute({ waypoints: t.points.map((point, i) => ({ label: i === 0 ? `Start: ${t.name}` : i === n - 1 ? t.name : `${t.name} · ${i}`, point, me: false })), push: false });
  return routesReady();
}

/* ── Karte: Gesten und Knöpfe des Autos ───────────────────────────────────── */

/** „Zentrieren“: wieder dem eigenen Standort folgen – mit Route die Navigation */
function recenter() {
  // Folgt die Karte schon: geneigt ↔ flach (wie der Knopf in der Navigation am Handy)
  if (nav.active) document.querySelector('#nav .nav-recenter')?.click();
  else resumeDrive({ toggle: true });
}
/** Selbst verschoben oder gezoomt: nicht zurückreißen */
const gesture = { dx: 0, dy: 0, zoom: 0, at: null, frame: null };
function applyGesture() {
  if (gesture.frame !== null) return;
  gesture.frame = requestAnimationFrame(() => {
    const { dx, dy, zoom, at } = gesture;
    Object.assign(gesture, { dx: 0, dy: 0, zoom: 0, at: null, frame: null });
    if (dx || dy) map.panBy([dx, dy], { duration: 0 }, ORIGINAL);
    if (zoom) map.zoomTo(map.getZoom() + zoom, { duration: 0, around: at ? map.unproject(at) : undefined }, ORIGINAL);
  });
}

let gestureTimer = null;
function hold() {
  nav.pauseFollow();
  pauseDrive();
  // Mit dem Finger auf der Karte zählt jedes Bild – solange öfter zeichnen, sonst ruckelt das Verschieben
  capFps(GESTURE_FPS);
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(() => capFps(CAR_FPS), 1200);
}

/** Freie Fläche der Karte (Rest verdecken die Vorlagen des Autos), CSS-Pixel */
function setInsets(ins) {
  map.carInsets = { top: 0, right: 0, bottom: 0, left: 0, ...ins };
  hudInsets(map.carInsets);
  map.resize();
  if (!nav.active && state.routes.length) fitRoute();
}

/* ── Anweisungen der Navigation an das Auto ───────────────────────────────── */

// Mit dem Pfeil als Bild – das Auto zeigt ihn groß neben der Entfernung
let arrivedTimer = null;
addEventListener('wmap:guidance', async (e) => {
  const g = e.detail;
  const name = g.arrived ? 'sports_score' : g.type === 'via' ? 'flag' : maneuverIcon({ type: g.type });
  if (g.arrived && arrivedTimer === null) {
    arrivedTimer = setTimeout(() => { arrivedTimer = null; if (nav.active) nav.stop(); }, window.__carArrivedMs ?? ARRIVED_MS);
  }
  send('guidance', { ...g, icon: await icon(name, '#ffffff', 128) });
});
let wasNav = false;
new MutationObserver(() => {
  const now = document.body.classList.contains('navigating');
  if (now === wasNav) return;
  wasNav = now;
  clearTimeout(arrivedTimer);
  arrivedTimer = null;
  send(now ? 'navStart' : 'navEnd', { destination: state.waypoints.at(-1)?.label ?? '' });
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/* ── Fragen und Hinweise ─────────────────────────────────────────────────── */

const asks = new Map();
let askSeq = 0;
/** osm/quick-ask.js: Pille bzw. Karte → Hinweis im Auto; → 'yes' | 'no' | null */
window.wmapCarAsk = (opts, setClose) => new Promise((resolve) => {
  const id = ++askSeq;
  // Pille wie am Handy: ✕ (schließen, nicht mehr fragen) und „Bestätigen“
  const options = opts.pill
    ? [{ value: 'no', label: 'Schließen', close: true }, { value: 'yes', label: 'Bestätigen' }]
    : (opts.options ?? []).slice(0, 2).map((o) => ({ value: o.value, label: o.label }));
  // Nur ein Knopf: daneben das ✕ – das Auto erlaubt je Hinweis zwei
  if (!opts.pill && options.length === 1) options.unshift({ value: null, label: 'Schließen', close: true });
  if (opts.input || !options.length) { resolve(null); return; }
  const done = (v) => { if (!asks.has(id)) return; asks.delete(id); send('askEnd', { id }); resolve(v); };
  asks.set(id, done);
  setClose?.(() => done(null));
  icon(opts.icon ?? 'help', '#ffffff').then((png) => send('ask', {
    id, title: opts.title, sub: opts.sub ?? '', icon: png, options, timeout: opts.timeout ?? (opts.pill ? 12000 : 15000),
  }));
});
window.wmapCarToast = (text) => send('toast', { text });

/* ── Schnittstelle ───────────────────────────────────────────────────────── */

const methods = {
  init({ dark = null, insets = null } = {}) {
    if (dark !== null) theme.force(dark);
    if (insets) setInsets(insets);
    closeSheet();
    startDrive();
    return { navigating: nav.active, tours: tourList().length };
  },
  dark: (on) => theme.force(on),
  insets: setInsets,
  /** Standort (wieder) abfragen – nach der Freigabe am Handy */
  locate() { startDrive(); return true; },
  // Verschieben und Zoomen mit dem Finger: Das Auto meldet viele kleine Schritte – je Bild einer,
  // zusammengefasst (sonst arbeitet eine träge Seite jeden einzeln nach und die Karte läuft dem Finger hinterher)
  pan(dx, dy) {
    hold();
    gesture.dx += dx; gesture.dy += dy;
    applyGesture();
  },
  zoom(factor, x, y) {
    hold();
    gesture.zoom += Math.log2(factor);
    if (x !== undefined) gesture.at = [x, y];
    applyGesture();
  },
  zoomBy(d) { hold(); map.zoomTo(map.getZoom() + d, { duration: 300 }); },
  /** Wischen mit Schwung: weiterrollen, langsamer werdend */
  fling(vx, vy) {
    hold();
    map.panBy([vx * 0.25, vy * 0.25], { duration: 700, easing: (t) => 1 - (1 - t) ** 3 }, ORIGINAL);
  },
  recenter,
  async click(x, y) {
    // Routenwahl: eine andere Route antippen wählt sie
    if (!nav.active && state.routes.length > 1) {
      const line = map.getLayer('route-alt') ? map.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]], { layers: ['route-alt'] })[0] : null;
      if (line) {
        const id = Number(line.properties.id);
        selectRoute(id, { fit: false });
        send('routeSelected', { id });
        return null;
      }
    }
    // Nummerierter Treffer: der nächste unter dem Finger
    const near = numbered.map((n) => { const p = map.project(n.marker.getLngLat()); return { n, d: Math.hypot(p.x - x, p.y - y) }; })
      .filter((h) => h.d <= 26).sort((a, b) => a.d - b.d)[0];
    if (near && hits.get(near.n.key)) return openPlace(hits.get(near.n.key));
    const f = hitAt(x, y);
    return f ? openPlace(f) : null;
  },
  categories: () => withPng(NEARBY.map(byId).filter(Boolean).map((c) => ({ id: c.id, title: c.label, icon: c.icon, color: c.color }))),
  category,
  search,
  /** Lesezeichen als Kacheln: Zuhause, Arbeit, Gemerktes, Haltestellen – ein Tipp führt zur Routenwahl */
  async bookmarks() {
    shareSync();
    const rows = savedRows('', 60);
    return { items: await Promise.all(rows.map(async (r) => ({ ...r, png: await icon(r.icon, r.color ?? '#8ab4f8', 96) }))) };
  },
  recentTargets() {
    const seen = new Set();
    return recent.list('route')
      .map((r) => r.to).filter((t) => t?.point && !t.me)
      .filter((t) => { const k = t.point.map((v) => v.toFixed(4)).join(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 6)
      .map((t) => ({ ...row({ type: 'Feature', geometry: { type: 'Point', coordinates: t.point }, properties: { name: t.label, _point: true } }), kind: 'target', icon: 'history' }));
  },
  /** „Ziel wählen“: Zuhause, Arbeit, Lesezeichen, zuletzt gefahren */
  async targets() {
    shareSync();
    return { items: await withPng([...savedRows(), ...methods.recentTargets()]) };
  },
  async place(key) {
    const f = hits.get(key);
    if (!f) throw new Error('Ort nicht mehr bekannt');
    return openPlace(f);
  },
  save(key) {
    const f = hits.get(key);
    if (!f) return false;
    const title = f.properties._point ? f.properties.name : geocode.describe(f).title;
    places.save({ kind: 'fav', name: title, point: f.geometry.coordinates });
    return true;
  },
  routeTo,
  routeToPoint,
  selectRoute(id) { selectRoute(id, { fit: true }); return true; },
  /** Filter der Routenplanung fürs Auto: was vermieden wird (true = vermeiden) */
  routePrefs() {
    reloadPrefs();
    return { highways: !routePrefs.highways, tolls: !routePrefs.tolls, ferries: !routePrefs.ferries };
  },
  setRoutePref(key, avoid) {
    if (!['highways', 'tolls', 'ferries'].includes(key)) throw new Error('Unbekannte Einstellung');
    setPref(key, !avoid);
    return true;
  },
  /** Nach einer geänderten Einstellung: dieselbe Strecke neu rechnen */
  async routesAgain() {
    clearRoutes({ keepSheet: true });
    computeRoutes();
    return routesReady();
  },
  async start() {
    if (!current()) throw new Error('Keine Route gewählt');
    await startNav();
    return true;
  },
  stop() { if (nav.active) nav.stop(); return true; },
  /** Ganze Route zeigen (Navigation) – „Zentrieren“ holt zurück */
  overview() { document.querySelector('#nav .nav-overview')?.click(); return true; },
  /** Ansagen an/aus → true, wenn jetzt stumm */
  mute() {
    const b = document.querySelector('#nav .nav-mute');
    b?.click();
    return b?.querySelector('.msr')?.textContent === 'volume_off';
  },
  /** Zurück zur Karte: Planung, Ort und Treffer weg */
  clear() {
    if (!nav.active) { leaveRouteMode(); clearRoutes({ keepSheet: true }); }
    clearPlace();
    catCtl?.abort();
    clearHits();
    closeSheet();
    if (!nav.active) resumeDrive();
    return true;
  },
  /** Meine Touren – die fürs Auto geplanten; mit Text nur die, deren Name passt */
  async tours(text = '') {
    shareSync();
    const w = fold(text).split(/\s+/).filter(Boolean);
    const list = tourList().filter((t) => w.every((x) => fold(`${t.title} ${t.sub}`).includes(x)));
    return { items: await withPng(list) };
  },
  tour,
  answer(id, value) { asks.get(id)?.(value ?? null); return true; },
  icon,
  async icons(list) { return Promise.all(list.map(([n, c, s]) => icon(n, c, s))); },
};

window.wmapCar = {
  call(id, method, args = []) {
    const fn = methods[method];
    Promise.resolve()
      .then(() => { if (!fn) throw new Error(`Unbekannt: ${method}`); return fn(...args); })
      .then((value) => send('reply', { id, ok: true, value: value ?? null }),
        (err) => send('reply', { id, ok: false, error: err?.message ?? String(err) }));
  },
};

// Standort-Knopf: sein Symbol an das Auto melden, wenn es sich ändert
let shownIcon = null;
setInterval(() => {
  const name = recenterIcon();
  if (name === shownIcon) return;
  shownIcon = name;
  send('recenter', { icon: name });
}, 400);

// Grafik verloren (kommt im Auto vor, z. B. nach dem Wechsel der Fläche):
// kommt sie nicht gleich wieder, die Seite neu laden – sonst bleibt die Karte weiß
map.on('webglcontextlost', () => {
  console.warn('WebGL-Kontext verloren');
  const t = setTimeout(() => location.reload(), 3000);
  map.once('webglcontextrestored', () => clearTimeout(t));
});

// Stand der Karte gleich melden: Kotlin wartet darauf, bevor es fragt
if (map.loaded()) send('ready', {}); else map.once('load', () => send('ready', {}));
export { methods as carMethods };
