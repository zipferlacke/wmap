/**
 * Kartenseite – gemeinsamer Kern: Karte, Zustand und Hilfen, die alle Teile brauchen.
 * Hängt von keinem anderen Teil unter app/ ab.
 */
import { PROFILES } from '../config.js';
import { geo } from '../native.js';
import { createMap, showHighlight } from '../map.js';
import { local } from '../store.js';
import { bboxAround, esc } from '../geo.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

/*
 * Startansicht: dort weitermachen, wo man aufgehört hat. Liegt der letzte
 * Besuch länger als einen Tag zurück, ist der eigene Standort wahrscheinlich
 * interessanter – dann dorthin, sobald er bekannt ist.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const lastView = local.get('wmap.view');
export const freshView = lastView && Date.now() - lastView.at < DAY_MS;
export const { map, geolocate } = createMap('map', lastView ? {
  center: lastView.center, zoom: lastView.zoom, pitch: lastView.pitch ?? 0, bearing: lastView.bearing ?? 0,
} : {});

export const state = {
  mode: 'search',
  profile: PROFILES[local.get('wmap.profile')]?.nav ? local.get('wmap.profile') : 'car',
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

export function myPosition() {
  return new Promise((resolve, reject) => {
    if (!geo.available()) { reject(new Error('Standort wird nicht unterstützt')); return; }
    geo.once(
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
export function viewPadding() {
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
