/**
 * Wo man unterwegs war – nur auf diesem Gerät, für die Fragen danach
 * („War der Parkplatz kostenlos?“). Gefragt wird nur zu Orten, an denen man
 * nachweislich vorbeigekommen ist; ohne Aufzeichnung keine Fragen.
 *
 * In den Einstellungen abschaltbar; ausgeschaltet wird die Aufzeichnung
 * gelöscht. Nach 14 Tagen verfällt sie von selbst.
 *
 *   wmap.trace   [[lon, lat, sekunden], …]
 *   wmap.trips   [{ id, start, end, profile, destination, reroutes, asked }]
 */
import { local } from './store.js';
import { distance } from './geo.js';

const SETTING = 'wmap.contribute';
const TRACE = 'wmap.trace';
const TRIPS = 'wmap.trips';
const KEEP_S = 14 * 24 * 3600;
const MAX_POINTS = 20000;
const MIN_STEP_M = 8;
const MAX_ACCURACY_M = 40;

const now = () => Math.round(Date.now() / 1000);

/** Mitmachen bei OSM: Standort aufzeichnen und danach fragen. Standard: an. */
export const contribute = {
  get: () => local.get(SETTING, true) !== false,
  set(on) {
    local.set(SETTING, !!on);
    if (!on) { trace.clear(); trips.clear(); }
  },
};

let points = null;         // erst beim ersten Zugriff laden
let dirty = 0;

function load() {
  points ??= (local.get(TRACE, []) ?? []).filter((p) => p[2] > now() - KEEP_S);
  return points;
}

function flush() {
  if (!dirty || !points) return;
  if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
  local.set(TRACE, points);
  dirty = 0;
}
// Nicht bei jedem Punkt schreiben – aber auch nichts verlieren
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);

export const trace = {
  /** Standortmeldung; ungenaue und fast gleiche Punkte fallen weg. */
  add({ point, accuracy }) {
    if (!contribute.get() || !point || (accuracy ?? 0) > MAX_ACCURACY_M) return;
    const pts = load();
    const last = pts.at(-1);
    const t = now();
    if (last && distance(last, point) < MIN_STEP_M && t - last[2] < 60) return;
    pts.push([+point[0].toFixed(6), +point[1].toFixed(6), t]);
    if (++dirty >= 15) flush();
  },
  /** Punkte zwischen zwei Zeitpunkten (Sekunden). */
  between(from, to = now()) {
    flush();
    return load().filter((p) => p[2] >= from && p[2] <= to);
  },
  clear() { points = []; dirty = 0; local.set(TRACE, []); },
};

/* ── Fahrten ──────────────────────────────────────────────────────────────── */

const allTrips = () => (local.get(TRIPS, []) ?? []).filter((t) => t.start > now() - KEEP_S);
const saveTrips = (list) => local.set(TRIPS, list);
let currentId = null;

export const trips = {
  start({ profile, destination }) {
    if (!contribute.get()) return;
    const list = allTrips();
    currentId = now();
    list.push({ id: currentId, start: currentId, end: null, profile, destination, reroutes: [], asked: false });
    saveTrips(list);
  },
  /** Verfahren: Standort und das Stück der geplanten Route, das man nicht nahm. */
  reroute({ point, planned }) {
    if (!currentId) return;
    const list = allTrips();
    const trip = list.find((t) => t.id === currentId);
    if (!trip || trip.reroutes.length >= 5) return;
    trip.reroutes.push({ t: now(), point, planned: planned.slice(0, 40).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) });
    saveTrips(list);
  },
  end({ arrived }) {
    if (!currentId) return null;
    flush();
    const list = allTrips();
    const trip = list.find((t) => t.id === currentId);
    currentId = null;
    if (!trip) return null;
    trip.end = now();
    trip.arrived = !!arrived;
    saveTrips(list);
    return trip;
  },
  /** Beendete Fahrten, zu denen noch nicht gefragt wurde. */
  open: () => allTrips().filter((t) => t.end && !t.asked),
  markAsked(id) {
    const list = allTrips();
    const trip = list.find((t) => t.id === id);
    if (trip) { trip.asked = true; saveTrips(list); }
  },
  clear() { currentId = null; saveTrips([]); },
};
