/**
 * Kurze Fragen unterwegs – in der Navigation und ohne sie, wenn man mit dem
 * Standortpunkt unterwegs ist (alongMap) – als Pille (osm/quick-ask.js):
 * links ✕, die Frage, rechts „Bestätigen“; sie läuft von selbst ab.
 * Unbeantwortet steht die Frage danach am Ende in der Liste (osm/survey.js
 * askLater). ✕ heißt vergessen – kommt man wieder vorbei, darf sie wiederkommen.
 *
 *   Neue Straße? / Neuer Weg?  ≥ 200 m am Stück mehr als 30 m neben jedem Weg
 *                              der Karte (Kartenkacheln, Schicht
 *                              „transportation“) – nur in Bewegung und bei
 *                              guter Genauigkeit (≤ 20 m); Rauschen im Stand
 *                              zählt nicht
 *   Gesperrt?                  nach einer Neuberechnung ≥ 100 m neben der
 *                              alten Route (zurück auf ihr: keine Frage) –
 *                              nur in der Navigation
 *   Gibt es … noch?            Laden oder Lokal direkt am Weg (zu Fuß 15 m,
 *                              Rad 20 m, Auto 25 m und nur langsamer als
 *                              30 km/h), seit über zwei Jahren unbestätigt –
 *                              nach dem Vorbeikommen. Im Auto nur an der
 *                              Straße, auf der man fährt: Liegt eine andere
 *                              Straße näher am Laden (Rückseite, Parallel-
 *                              straße), wird nicht gefragt
 *
 * Die Läden kommen aus den Kartenkacheln (kein Netz); erst nach dem
 * Vorbeikommen fragt eine kleine Anfrage bei der OSM-API nach genau diesem
 * Ort, wann er zuletzt bestätigt wurde. Ohne Navigation zählt die
 * Fortbewegung nach dem Tempo (bis 9 km/h zu Fuß, bis 25 km/h Rad, sonst Auto).
 *
 * Nur mit „Mitmachen“. Die Pillen je Fortbewegung an/aus (Einstellungen →
 * Unterwegs); aus heißt: „Neuer Weg?“ und „Gesperrt?“ gleich in die Liste,
 * „Gibt es … noch?“ gar nicht. Zwischen zwei Pillen 2 min oder 1 km –
 * Meldungen („Immer noch Stau?“, app/report.js) kommen trotzdem sofort.
 */
import { quickAsk } from '../osm/quick-ask.js';
import { answer, askLater, forget, alongSetting, existsQuestion } from '../osm/survey.js';
import { element } from '../osm/objects.js';
import { contribute } from '../data/trace.js';
import { distance, simplifyTo, cumulative, nearestOnLine } from '../core/geo.js';
import { osmRef } from '../map/map.js';
import { map } from './core.js';

const OFF_WAY_M = 30;
const OFF_RUN_M = 200;
const DETOUR_M = 100;
const DETOUR_WATCH_MS = 3 * 60 * 1000;
const GAP_MS = 2 * 60 * 1000;            // Abstand zwischen zwei Pillen: 2 min …
const GAP_M = 1000;                      // … oder 1 km
const CHECK_MS = 5000;                   // Kacheln nach Wegen fragen: höchstens alle 5 s …
const CHECK_M = 25;                      // … bzw. 25 m
const NEAR = { car: 25, bike: 20, foot: 15 };
const PLACES_M = 80;                     // Läden aus den Kacheln: so weit um den Standort
const FRONT_M = 8;                       // Auto: liegt eine andere Straße so viel näher am Laden, zählt er nicht
// Punkte der Karte, die weder Laden noch Lokal sind (die OSM-API prüft danach ohnehin)
const NO_SHOP = /^(parking|bicycle_parking|bus|railway|aerialway|ferry_terminal|harbor|place_of_worship|school|college|kindergarten|university|park|playground|pitch|stadium|swimming|golf|zoo|toilets|drinking_water|information|town_hall|townhall|police|fire_station|hospital|doctors|dentist|cemetery|castle|monument|memorial|attraction|museum|campsite|lodging|fuel|charging_station|atm|shelter|viewpoint|entrance|office|community_centre|theatre|cinema|waste_basket|recycling|bench)$/;
// Straßen fürs Auto (Schicht transportation) – Fußwege, Zufahrten, Parkplatzgassen zählen nicht
const CAR_ROAD = /^(motorway|trunk|primary|secondary|tertiary|minor)$/;
const CAR_SLOW = 30 / 3.6;               // im Auto nur so langsam, sonst sieht man den Laden nicht

/** Zustand der laufenden Navigation bzw. (free) des Wegs mit dem Standortpunkt */
let s = null;

const state = (profile, free = false) => ({
  profile, free, v: 0, last: 0, since: 0, prev: null, busy: false, run: [], offAsked: false, checked: null,
  detour: null, places: [], passing: new Map(), asked: new Set(), harvested: null, line: null, cum: null, track: [],
});

const pillsOn = () => !!s && alongSetting.get(s.profile);

export function alongStart(route, profile) {
  if (!contribute.get()) return;
  // Neuberechnung: dieselbe Fahrt, nur die Route (für die Straße am Laden) ist neu
  if (!s || s.free) s = state(profile);
  s.line = route.coords;
  s.cum = route.cum ?? cumulative(route.coords);
}

export function alongStop() {
  s = null;
}

/** Jede Meldung der Navigation ({ point, raw, speed, accuracy }) */
export function alongFix(fix) {
  if (!s) return;
  const p = fix.raw ?? fix.point;
  if (s.prev) s.since += distance(s.prev, p);
  s.prev = p;
  // Ohne Route: die letzten Meter als „Straße, auf der man fährt“
  if (!s.line && (!s.track.length || distance(s.track.at(-1), p) > 5)) s.track = [...s.track.slice(-40), p];
  offWay(fix, p);
  watchDetour(p);
  if (pillsOn()) {
    harvest(p);
    passPlaces(p, fix.speed ?? 0);
  }
}

/**
 * Ohne Navigation mit dem Standortpunkt unterwegs (app/mitmachen.js) – jede
 * geglättete Meldung (core/smooth.js; im Stand kommen kaum welche).
 */
export function alongMap(pos) {
  if (s && !s.free) return;                        // die Navigation fragt selbst
  if (!contribute.get()) { s = null; return; }
  const c = pos.coords;
  const p = [c.longitude, c.latitude];
  s ??= state('foot', true);
  // Fortbewegung nach dem Tempo – geglättet, damit eine Ampel nicht umschaltet
  const v = Number.isFinite(c.speed) ? c.speed : 0;
  s.v = s.prev ? s.v * 0.8 + v * 0.2 : v;
  s.profile = s.v > 7 ? 'car' : s.v > 2.5 ? 'bike' : 'foot';
  alongFix({ point: p, speed: v, accuracy: c.accuracy });
}

/** Neuberechnung ({ point, planned }): ab jetzt schauen, wie weit man von der alten Route weg ist */
export function alongReroute({ point, planned }) {
  if (!s || !planned?.length || planned.length < 2) return;
  s.detour = { planned, cum: cumulative(planned), point, t: Date.now() };
}

/* ── Neuer Weg? ─────────────────────────────────────────────────────────── */

function offWay(fix, p) {
  // Nur verlässliche Meldungen in Bewegung – sonst weder zählen noch zurücksetzen
  if ((fix.accuracy ?? 99) > 20 || !(fix.speed > 1) || map.getZoom() < 14 || !map.areTilesLoaded()) return;
  // Die Karte muss die Stelle zeigen – sonst fände die Abfrage dort auch keinen Weg
  if (!map.getBounds().contains(p)) return;
  // Die Abfrage läuft nur über die geladenen Kacheln (kein Netz), kostet aber
  // Rechenzeit – darum nicht bei jeder Meldung
  const c0 = s.checked;
  if (c0 && Date.now() - c0.t < CHECK_MS && distance(c0.p, p) < CHECK_M) return;
  s.checked = { t: Date.now(), p };
  if (nearWay(p)) { s.run = []; s.offAsked = false; return; }
  s.run.push(p);
  if (s.offAsked) return;
  const c = cumulative(s.run);
  if (c[c.length - 1] < OFF_RUN_M) return;
  s.offAsked = true;
  const mid = s.run[Math.floor(s.run.length / 2)];
  const q = {
    key: `missing_way:${mid[0].toFixed(4)},${mid[1].toFixed(4)}`, quest: 'missing_way', name: 'Weg abseits der Karte',
    point: [mid[0], mid[1]], line: simplifyTo(s.run, 12).map(([x, y]) => [x, y]), mode: s.profile, at: Date.now(),
  };
  pill(q, { icon: 'add_road', title: s.profile === 'car' ? 'Neue Straße?' : 'Neuer Weg?', yes: s.profile === 'car' ? 'road' : 'way', later: true });
}

/** Liegt ein Weg der Karte (Straße, Weg, Pfad …) näher als 30 m? */
function nearWay([lon, lat]) {
  const dy = OFF_WAY_M / 111320;
  const dx = dy / Math.cos((lat * Math.PI) / 180);
  const px = [[lon - dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon + dx, lat - dy]].map((q) => map.project(q));
  const xs = px.map((q) => q.x);
  const ys = px.map((q) => q.y);
  const box = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  return map.queryRenderedFeatures(box).some((f) => f.sourceLayer === 'transportation');
}

/* ── Gesperrt? ──────────────────────────────────────────────────────────── */

function watchDetour(p) {
  const d = s.detour;
  if (!d) return;
  if (Date.now() - d.t > DETOUR_WATCH_MS) { s.detour = null; return; }
  const off = nearestOnLine(d.planned, d.cum, p).offset;
  if (off <= 25) { s.detour = null; return; }     // doch zurück auf die alte Route
  if (off < DETOUR_M) return;
  s.detour = null;
  const at = d.planned[Math.min(3, d.planned.length - 1)] ?? d.point;
  const q = {
    key: `detour:${at[0].toFixed(4)},${at[1].toFixed(4)}`, quest: 'detour', name: 'Abweichung von der Route',
    point: at, line: d.planned, mode: s.profile, at: Date.now(),
  };
  pill(q, { icon: 'block', title: 'Gesperrt?', yes: 'blocked', later: true });
}

/* ── Gibt es … noch? ────────────────────────────────────────────────────── */

/** Läden und Lokale in der Nähe aus den geladenen Kacheln – alle 5 s bzw. 25 m */
function harvest(p) {
  const h = s.harvested;
  if (h && Date.now() - h.t < CHECK_MS && distance(h.p, p) < CHECK_M) return;
  s.harvested = { t: Date.now(), p };
  if (map.getZoom() < 14) return;
  s.places = s.places.filter((q) => distance(p, q.point) < 300);
  const known = new Set(s.places.map((q) => q.key));
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })) {
    const pr = f.properties;
    if (!pr?.name || NO_SHOP.test(pr.class ?? '') || f.geometry?.type !== 'Point') continue;
    const point = f.geometry.coordinates;
    if (distance(p, point) > PLACES_M) continue;
    const ref = osmRef(f);
    const key = ref && `${ref.type}${ref.id}`;
    if (!key || known.has(key) || s.asked.has(key)) continue;
    known.add(key);
    s.places.push({ key, ref, name: pr.name, point });
  }
}

function passPlaces(p, speed) {
  const near = NEAR[s.profile] ?? 20;
  for (const q of s.places) {
    const d = distance(p, q.point);
    if (d < near) {
      // Langsamstes Tempo in der Nähe merken – im Auto nur fragen, wenn man etwas sehen konnte;
      // und ob der Laden an unserer Straße liegt (jetzt ist er sicher auf der Karte zu sehen)
      const was = s.passing.get(q.key);
      s.passing.set(q.key, { slowest: Math.min(speed, was?.slowest ?? Infinity), front: was?.front ?? (s.profile !== 'car' || facesUs(q.point)) });
    } else if (d > near + 40 && s.passing.has(q.key)) {
      const { slowest, front } = s.passing.get(q.key);
      s.passing.delete(q.key);
      s.places = s.places.filter((x) => x !== q);
      s.asked.add(q.key);
      if (s.profile === 'car' && (slowest >= CAR_SLOW || !front)) continue;
      askExists(q);
      return;
    }
  }
}

/** Erst jetzt bei der OSM-API: Laden oder Lokal? Seit über zwei Jahren unbestätigt? */
function askExists(q) {
  if (!navigator.onLine) return;
  const run = s;
  element(q.ref.type, q.ref.id).then((el) => {
    const ask = s === run && existsQuestion(el, q.point);
    if (ask) pill({ ...ask, at: Date.now() }, { icon: 'storefront', title: `Gibt es ${ask.name} noch?`, yes: 'yes' });
  }).catch(() => {});
}

/**
 * Liegt der Laden an der Straße, auf der man fährt? Nein, wenn eine andere
 * Straße fürs Auto deutlich näher liegt – dann steht er an der (Rückseite, Parallelstraße).
 */
function facesUs(point) {
  const line = s.line ?? s.track;
  if (!line || line.length < 2) return true;
  const ours = nearestOnLine(line, s.line ? s.cum : cumulative(line), point).offset;
  const [lon, lat] = point;
  const dy = (ours + 15) / 111320;
  const dx = dy / Math.cos((lat * Math.PI) / 180);
  const a = map.project([lon - dx, lat + dy]);
  const b = map.project([lon + dx, lat - dy]);
  const box = [[Math.min(a.x, b.x), Math.min(a.y, b.y)], [Math.max(a.x, b.x), Math.max(a.y, b.y)]];
  let other = Infinity;
  for (const f of map.queryRenderedFeatures(box)) {
    if (f.sourceLayer !== 'transportation' || !CAR_ROAD.test(f.properties?.class ?? '')) continue;
    const g = f.geometry;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const part of parts) if (part.length > 1) other = Math.min(other, nearestOnLine(part, cumulative(part), point).offset);
  }
  // Unsere eigene Straße ist auch dabei – nur eine deutlich nähere andere zählt
  return !(other < ours - FRONT_M);
}

/* ── Pille ──────────────────────────────────────────────────────────────── */

/**
 * Fragen – oder, wenn gerade nicht (Pillen aus, eine läuft, die letzte ist
 * keine 2 min bzw. 1 km her): `later` in die Liste für danach, sonst gar nicht.
 */
function pill(q, { icon, title, yes, later = false }) {
  const free = pillsOn() && !s.busy && (!s.last || Date.now() - s.last >= GAP_MS || s.since >= GAP_M);
  if (!free) { if (later) askLater(q); return; }
  s.busy = true;
  s.last = Date.now();
  s.since = 0;
  const run = s;
  quickAsk({ pill: true, icon, title, timeout: 12000 }).then((v) => {
    run.busy = false;
    if (v === 'yes') answer(q, yes);
    else if (v === 'no') forget(q);
    else askLater(q);
  });
}
