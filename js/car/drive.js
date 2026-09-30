/**
 * Autobildschirm ohne Route („freie Fahrt“) – wie in der Navigation: Pfeil
 * statt Punkt, auf der Straße, die Karte folgt geneigt in Fahrtrichtung.
 * Dazu immer sichtbar (auch beim Navigieren): Tempo, Tempolimit und unten der
 * Straßenname. Android Auto blendet seine Knöpfe nach ein paar Sekunden aus –
 * das hier bleibt, es gehört zur Karte.
 *
 *   Straße   die nächste Autostraße aus den Kartenkacheln (≤ 30 m), passend
 *            zur Fahrtrichtung – ohne Netz, bei jeder Meldung
 *   Limit    Valhalla /locate (edge_info.speed_limit), höchstens alle 10 s
 *            bzw. nach 150 m oder einer neuen Straße
 *
 * Mit Route übernimmt die Navigation Pfeil und Kamera (nav/navigation.js);
 * Tempo und Limit kommen dann von ihr.
 */
import { trustedSpeed, glideMarker } from '../core/smooth.js';
import { distance } from '../core/geo.js';
import { API } from '../core/config.js';
import { map, state, SIMULATING } from '../app/core.js';
import { nav } from '../app/nav.js';
import { alongMap } from '../app/ask-along.js';
import { trace } from '../data/trace.js';
import { local } from '../data/store.js';

const ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
const SNAP_M = 30;
const LIMIT_MS = 10000;
const LIMIT_M = 150;

const rad = Math.PI / 180;
const angle = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
const bearingOf = ([x1, y1], [x2, y2]) => {
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * rad);
  return (Math.atan2(dx, y2 - y1) / rad + 360) % 360;
};

/**
 * Nächste Autostraße: { point, bearing, name, d } oder null. Die Form steht in
 * der Ebene „transportation“, der Name in „transportation_name“.
 */
function snap(p, heading) {
  const road = nearest(p, heading, 'transportation');
  if (road) road.name = nearest(road.point, heading, 'transportation_name')?.name ?? '';
  return road;
}

function nearest(p, heading, layer) {
  const k = Math.cos(p[1] * rad) * 111320;
  const toM = ([x, y]) => [(x - p[0]) * k, (y - p[1]) * 111320];
  let best = null;
  let feats = [];
  try {
    feats = map.querySourceFeatures('openmaptiles', { sourceLayer: layer, filter: ['match', ['get', 'class'], ROADS, true, false] });
  } catch { return null; }
  for (const f of feats) {
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i += 1) {
        const a = toM(line[i - 1]);
        const b = toM(line[i]);
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const len2 = vx * vx + vy * vy;
        if (!len2) continue;
        // Grob vorsortieren: Abschnitt weit weg → weiter
        if (Math.min(Math.abs(a[0]), Math.abs(b[0])) > 200 && Math.sign(a[0]) === Math.sign(b[0])) continue;
        const t = Math.max(0, Math.min(1, -(a[0] * vx + a[1] * vy) / len2));
        const q = [a[0] + t * vx, a[1] + t * vy];
        const d = Math.hypot(q[0], q[1]);
        if (d > SNAP_M) continue;
        const dir = bearingOf(line[i - 1], line[i]);
        // Richtung passt nicht (beide Fahrtrichtungen zählen): schlechter
        const off = heading === null ? 0 : Math.min(angle(dir, heading), angle(dir + 180, heading));
        const score = d + (off > 50 ? 25 : off / 5);
        if (!best || score < best.score) {
          const point = [p[0] + q[0] / k, p[1] + q[1] / 111320];
          const along = heading === null || angle(dir, heading) <= 90 ? dir : (dir + 180) % 360;
          best = { score, d, point, bearing: along, name: f.properties['name:de'] ?? f.properties.name ?? '' };
        }
      }
    }
  }
  return best;
}

/* ── Anzeige: Tempo, Limit, Straße ───────────────────────────────────────── */

const box = document.createElement('div');
box.className = 'car-hud';
box.innerHTML = `
  <div class="car-speed"><span class="car-limit" hidden></span><span class="car-kmh"><strong>0</strong><small>km/h</small></span></div>
  <div class="car-street" hidden></div>`;
map.getContainer().append(box);
const $ = (s) => box.querySelector(s);

function paint({ kmh, limit, street }) {
  $('.car-kmh strong').textContent = String(kmh);
  $('.car-limit').hidden = !limit;
  $('.car-limit').textContent = limit ?? '';
  $('.car-speed').classList.toggle('over', !!limit && kmh > limit + 3);
  $('.car-street').hidden = !street || nav.active;
  $('.car-street').textContent = street ?? '';
}

/** Freie Fläche (Vorlagen des Autos) – Anzeige und Pfeil richten sich danach */
export function hudInsets(i) {
  box.style.setProperty('--car-right', `${i.right}px`);
  box.style.setProperty('--car-bottom', `${i.bottom}px`);
  box.style.setProperty('--car-left', `${i.left}px`);
}

/* ── Fahrt ───────────────────────────────────────────────────────────────── */

const trust = trustedSpeed();
let marker = null;
let following = true;
let heading = null;
let last = null;
let savedAt = 0;           // wann der Standort zuletzt für den nächsten Start gemerkt wurde
let limit = { value: null, at: 0, point: null, street: '' };
let current = { kmh: 0, street: '' };

function arrow() {
  const el = document.createElement('div');
  el.className = 'nav-me car-me';
  el.innerHTML = '<span class="msr">navigation</span>';
  const m = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  glideMarker(m, 900);
  return m;
}

async function lookUpLimit(point, street) {
  const now = Date.now();
  if (!navigator.onLine) return;
  if (now - limit.at < LIMIT_MS && street === limit.street && limit.point && distance(limit.point, point) < LIMIT_M) return;
  limit = { ...limit, at: now, point, street };
  try {
    const loc = { lat: point[1], lon: point[0], radius: 25, ...(heading !== null ? { heading: Math.round(heading), heading_tolerance: 60 } : {}) };
    const res = await fetch(`${API.valhalla}/locate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [loc], costing: 'auto', verbose: true }),
    });
    const edge = (await res.json())?.[0]?.edges?.[0];
    limit.value = edge?.edge_info?.speed_limit || null;
  } catch { /* ohne Limit weiter */ }
}

function camera(point, kmh, dt) {
  if (!following || nav.active) return;
  const zoom = kmh < 30 ? 17 : kmh < 60 ? 16.4 : kmh < 90 ? 15.8 : 15.2;
  const ins = map.carInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const h = map.getContainer().clientHeight;
  const free = Math.max(100, h - ins.top - ins.bottom);
  map.easeTo({
    center: point, zoom, pitch: flat ? 0 : 50, bearing: heading ?? map.getBearing(),
    padding: { top: ins.top + free * 0.5, bottom: ins.bottom + 16, left: ins.left, right: ins.right },
    duration: Math.max(300, Math.min(1500, dt)), easing: (t) => t,
  });
}

function onFix(pos) {
  const c = pos.coords;
  const raw = [c.longitude, c.latitude];
  const now = pos.timestamp || Date.now();
  state.position = raw;
  const v = trust(raw, c.speed, c.accuracy, now) ?? 0;
  const kmh = Math.round(v * 3.6);
  // Fahrtrichtung: vom GPS, wenn es schnell genug ist, sonst aus der Bewegung
  if (Number.isFinite(c.heading) && v >= 2) heading = c.heading;
  else if (last && distance(last.raw, raw) >= 8) heading = bearingOf(last.raw, raw);
  // Auf die Straße erst, wenn das Auto fährt (ab ~7 km/h) – im Stand, wo das GPS ihn sieht
  const road = v >= 2 ? snap(raw, heading) : null;
  const point = road && road.d <= Math.max(SNAP_M, c.accuracy ?? 0) ? road.point : raw;
  if (road) heading = road.bearing;
  const dt = last ? now - last.t : 1000;
  // Straßenname auch im Stand (ohne einzurasten)
  const street = road?.name ?? (v < 2 ? snap(raw, heading)?.name ?? '' : '');
  last = { raw, t: now, street };
  current = { kmh, street };
  // Für den nächsten Start: dort beginnen, wo das Auto zuletzt war (app/core.js)
  if (!SIMULATING && now - savedAt > 15000) { savedAt = now; local.set('wmap.carPos', [+raw[0].toFixed(5), +raw[1].toFixed(5), Math.round(heading ?? 0)]); }

  if (!SIMULATING) {
    trace.add({ point: raw, accuracy: c.accuracy });
    alongMap(pos);
  }
  if (nav.active) { marker?.remove(); marker = null; return; }
  if (!marker) {
    marker = arrow().setLngLat(point).addTo(map);
    // Erster Standort: hin, geneigt
    if (following) map.jumpTo({ center: point, zoom: 16.5, pitch: flat ? 0 : 50, bearing: heading ?? 0 });
  } else marker.setLngLat(point);
  marker.setRotation((heading ?? 0));
  camera(point, kmh, dt);
  lookUpLimit(point, current.street).then(() => { if (!nav.active) paint({ kmh: current.kmh, limit: limit.value, street: current.street }); });
  paint({ kmh, limit: limit.value, street: current.street });
}

/*
 * Navigation beginnt: Der Pfeil der freien Fahrt weicht sofort dem der Navigation – nicht erst mit der
 * nächsten Standortmeldung (im Stand kommt die selten, so lange lagen zwei Pfeile übereinander).
 * Navigation endet: gleich wieder da, am letzten Standort.
 */
new MutationObserver(() => {
  if (document.body.classList.contains('navigating')) { marker?.remove(); marker = null; return; }
  if (!marker && last) {
    marker = arrow().setLngLat(last.raw).addTo(map);
    marker.setRotation(heading ?? 0);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/** Mit Route: Tempo und Limit wie in der Navigation (nav/navigation.js malt sie in #nav) */
setInterval(() => {
  if (!nav.active) return;
  const kmh = Number(document.querySelector('#nav .nav-kmh strong')?.textContent) || 0;
  const lim = document.querySelector('#nav .nav-limit');
  paint({ kmh, limit: lim && !lim.hidden ? Number(lim.textContent) || null : null, street: '' });
}, 1000);

let watch = null;
/** Standort abfragen (nach der Freigabe am Handy erneut) */
export function startDrive() {
  if (watch !== null || !navigator.geolocation) return;
  watch = navigator.geolocation.watchPosition(onFix, (err) => {
    watch = null;
    if (err.code === 1) window.wmapCarToast?.('Standort am Handy in WMap erlauben');
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

/** Karte selbst verschoben, Ort oder Route gezeigt: nicht zurückreißen, bis „Zentrieren“ */
export function pauseDrive() { following = false; }
let flat = false;
/**
 * „Zentrieren“: wieder folgen. Folgt die Karte schon, wechselt der Knopf
 * zwischen geneigt und flach – wie in der Navigation am Handy (Neigen mit
 * zwei Fingern reicht das Auto nicht an die App weiter).
 */
export function resumeDrive({ toggle = false } = {}) {
  if (toggle && following) flat = !flat;
  following = true;
  if (last && !nav.active) camera(marker?.getLngLat().toArray() ?? last.raw, current.kmh, 600);
}
export const driving = () => following;

/**
 * Symbol des Standort-Knopfs wie in der Navigation am Handy: ◎ solange die
 * Karte nicht folgt, sonst Pfeil (geneigt) bzw. Kompass (flach). Mit Route
 * zeigt ihn die Navigation selbst (#nav .nav-recenter).
 */
export function recenterIcon() {
  if (nav.active) return document.querySelector('#nav .nav-recenter .msr')?.textContent || 'my_location';
  return !following ? 'my_location' : flat ? 'explore' : 'navigation';
}
