/**
 * Kartenseite – gemeinsamer Kern: Karte, Zustand und Hilfen, die alle Teile brauchen.
 * Hängt von keinem anderen Teil unter app/ ab.
 */
import { PROFILES } from '../core/config.js';
import { geo } from '../core/native.js';
import { createMap, showHighlight } from '../map/map.js';
import { local } from '../data/store.js';
import { bboxAround, esc } from '../core/geo.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

/*
 * Startansicht: dort weitermachen, wo man aufgehört hat (gleich danach ggf.
 * der neuere Ausschnitt aus dem Ordner bzw. der eigene Standort – app.js).
 */
/** Autobildschirm (Android Auto, car/car.js): nur die Karte, die Vorlagen zeichnet das Auto */
export const CAR = new URLSearchParams(location.search).has('car');
if (CAR) document.documentElement.classList.add('car-mode');

const lastView = local.get('wmap.view');
// Im Auto gleich am Standort beginnen – nicht beim Globus oder beim letzten Ausschnitt der App: Android gibt den
// letzten bekannten Standort mit (?at=lon,lat – car/CarWeb.kt), sonst gilt der zuletzt im Auto gemerkte (car/drive.js)
const carAt = CAR ? new URLSearchParams(location.search).get('at')?.split(',').map(Number) ?? local.get('wmap.carPos') : null;
const carStart = Array.isArray(carAt) && carAt.length >= 2 && carAt.slice(0, 2).every(Number.isFinite);
export const { map, geolocate } = createMap('map', carStart ? {
  center: [carAt[0], carAt[1]], zoom: 16.5, pitch: 50, bearing: Number.isFinite(carAt[2]) ? carAt[2] : 0,
} : lastView ? {
  center: lastView.center, zoom: lastView.zoom, pitch: lastView.pitch ?? 0, bearing: lastView.bearing ?? 0,
} : {});

export const state = {
  mode: 'search',
  // Im Auto immer das Auto – die letzte Wahl am Handy (Rad, zu Fuß) gilt dort nicht
  profile: !CAR && PROFILES[local.get('wmap.profile')]?.nav ? local.get('wmap.profile') : 'car',
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

export const current = () => state.routes.find((r) => r.id === state.selected) ?? null;

// Für die Konsole und Tests: window.__wmap.map
window.__wmap = { map, state };

/* ══════════════════════════════════════════════════════════════════════════
   Hilfen
   ══════════════════════════════════════════════════════════════════════════ */

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Nach dem nächsten Layout – erst dann haben Sheet und Leiste ihre echte Größe. */
export const afterLayout = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

geolocate.on('geolocate', (pos) => { state.position = [pos.coords.longitude, pos.coords.latitude]; });

/*
 * Der eigene Standort steht von Anfang an auf der Karte – auch in der Routenansicht, wo „Mein Standort“
 * keinen eigenen Startpunkt hat. Bisher erschien der Punkt erst nach einem Tipp auf den Standort-Knopf.
 * Nur mit schon erteilter Freigabe (gefragt wird hier nicht), und die Karte bleibt, wo sie ist: MapLibres
 * Knopf startet im Zustand „im Hintergrund“ (Punkt folgt, Kamera nicht) – ein Tipp darauf springt wie
 * gewohnt hin. Greift dafür wie map/location-dot.js auf Interna von MapLibre 5.x zu.
 */
async function showDot() {
  if (CAR || geolocate._watchState !== 'OFF') return;
  let granted = false;
  try {
    if (geo.native) granted = await (await import('../ui/permissions.js')).locationAccess({ ask: false });
    else granted = (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted';
  } catch { granted = false; }
  if (!granted || geolocate._watchState !== 'OFF' || !geolocate.trigger()) return;
  geolocate._watchState = 'BACKGROUND';
  const btn = geolocate._geolocateButton;
  btn?.classList.remove('maplibregl-ctrl-geolocate-waiting', 'maplibregl-ctrl-geolocate-active');
  btn?.classList.add('maplibregl-ctrl-geolocate-background');
}
map.once('load', () => setTimeout(showDot, 300));

/** `ask: false`: ohne Freigabe nicht nachfragen (Start der Karte) */
export function myPosition({ ask = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!geo.available()) { reject(new Error('Standort wird nicht unterstützt')); return; }
    geo.once(
      (p) => { state.position = [p.coords.longitude, p.coords.latitude]; resolve(state.position); },
      (err) => (state.position ? resolve(state.position)
        : reject(new Error(err.code === 1 ? 'Standortfreigabe verweigert' : 'Standort nicht verfügbar'))),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000, ask },
    );
  });
}

/**
 * Der freie Teil der Karte: unter der Suchleiste, über dem Sheet, links vom
 * Rand, rechts neben den Knöpfen. Alles, was eingepasst wird, landet mittig darin.
 */
export function viewPadding() {
  // Auto: frei ist, was seine Vorlagen nicht verdecken (car/car.js)
  if (map.carInsets) {
    const i = map.carInsets;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const pad = { top: i.top + 24, bottom: i.bottom + 24, left: i.left + 24, right: i.right + 24 };
    // Kleiner Bildschirm, breite Liste: mindestens 160 × 120 frei lassen
    const over = pad.left + pad.right - (w - 160);
    if (over > 0) { pad.left = Math.max(0, pad.left - over); }
    if (pad.top + pad.bottom > h - 120) { pad.top = 12; pad.bottom = 12; }
    return pad;
  }
  // Rechner: Dialoge stehen links unter der Suche – die Karte rechts ist frei
  const sheet = $('#sheet');
  if (!matchMedia('(max-width: 700px)').matches && sheet.open) {
    const r = sheet.getBoundingClientRect();
    return { top: 60, bottom: 40, left: r.right - map.getContainer().getBoundingClientRect().left + 24, right: 64 };
  }
  const h = map.getContainer().clientHeight;
  const panel = $('#search').getBoundingClientRect();
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
export function fitTo([w, s, e, n], maxZoom = 16, { flat = false } = {}) {
  if (flat) map.quietFit = true;
  const padding = viewPadding();
  // Ein Rand, den die Karte noch trägt (freie Fahrt im Auto, Folgen der Navigation), zählt MapLibre zum neuen
  // dazu – die Route läge dann winzig in einem Bruchteil der freien Fläche
  const old = map.getPadding();
  if (old.top || old.bottom || old.left || old.right) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  // Geneigt und mit viel Rand findet MapLibre oft keine Lösung und tut dann
  // gar nichts („cannot fit“). Darum flach einpassen – nah genug dran neigt
  // die 3D-Automatik danach wieder.
  const opts = { padding, maxZoom, pitch: 0, ...(flat ? { bearing: 0 } : {}) };
  // MapLibre wirft teils statt „passt nicht“ zu melden (sehr wenig Platz)
  let fits = null;
  try { fits = map.cameraForBounds([[w, s], [e, n]], opts); } catch { fits = null; }
  if (fits) {
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
export const extentToBounds = (ext) => (ext ? [ext[0], ext[3], ext[2], ext[1]] : null);

export function viewBounds() {
  if (map.getZoom() < 11) return { bounds: bboxAround(map.getCenter().toArray(), 5000), label: 'im Umkreis von 5 km' };
  const b = map.getBounds();
  return { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], label: 'im Kartenausschnitt' };
}

export const parseTags = (t) => (typeof t === 'string' ? JSON.parse(t || '{}') : t ?? {});

/*
 * Hervorhebung auf der Karte. Die letzte wird gemerkt: Öffnet man aus einer
 * Liste heraus einen Ort, bleibt die Liste darunter – beim Zurück kommt ihre
 * Hervorhebung wieder.
 */
export let lastHl = {};
export function showHl(data = {}) {
  lastHl = data;
  showHighlight(map, data);
}
export const sheet = $('#sheet');
export const q = $('#q');
export const chipHtml = (cat, pressed = false) => `
  <button type="button" class="chip" data-cat="${cat.id}" aria-pressed="${pressed}" style="--chip:${cat.color}">
    <span class="msr">${cat.icon}</span>${esc(cat.label)}
  </button>`;
export function markerEl(kind, icon, text = '') {
  const el = document.createElement('div');
  el.className = `wp-marker ${kind}`;
  el.innerHTML = text ? `<span class="wp-num">${esc(text)}</span>` : `<span class="msr">${icon}</span>`;
  return el;
}
export const SIMULATING = new URLSearchParams(location.search).has('sim');
