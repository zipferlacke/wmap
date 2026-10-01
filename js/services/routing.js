/**
 * Routing über Valhalla.
 *
 * Bis zu fünf Routen zur Auswahl. Ist beim Auto die Autobahn erlaubt, wird
 * zusätzlich immer eine Route ohne Autobahn gerechnet – außer eine der
 * Alternativen kommt schon ohne aus.
 */
import { API, PROFILES, MAX_ROUTES } from '../core/config.js';
import { decodePolyline, encodePolyline, cumulative, simplifyTo } from '../core/geo.js';
import { valhallaPrefs } from '../ui/route-prefs.js';

const ELEVATION_STEP = 30;   // Meter zwischen zwei Höhenwerten

export function costingOptions(profile, { highways = true } = {}) {
  const p = PROFILES[profile];
  const opts = { ...(p.options ?? {}) };
  if (p.costing === 'auto') opts.use_highways = highways ? 1 : 0;
  return { [p.costing]: opts };
}

function body(points, profile, { highways = true, alternates = 0, avoid = [], heading = null } = {}) {
  const costing = PROFILES[profile].costing;
  const locations = points.map(([lon, lat]) => ({ lon, lat, type: 'break' }));
  // Fahrtrichtung am Start: Valhalla nimmt dann die Straße, auf der man
  // gerade in diese Richtung fährt – statt einer Wende oder der Gegenfahrbahn
  if (Number.isFinite(heading)) Object.assign(locations[0], { heading: Math.round((heading + 360) % 360), heading_tolerance: 45 });
  return {
    // Gesperrte Stellen umfahren (Ringe aus [lon, lat])
    ...(avoid.length ? { exclude_polygons: avoid } : {}),
    locations,
    costing,
    // Dazu Maut, Fähren, unbefestigte Wege aus den Routen-Einstellungen
    costing_options: { [costing]: { ...costingOptions(profile, { highways })[costing], ...valhallaPrefs(costing) } },
    units: 'kilometers',
    language: 'de-DE',
    directions_options: { units: 'kilometers', language: 'de-DE' },
    // Alternativen gibt Valhalla nur für eine Strecke ohne Zwischenziele
    alternates: points.length === 2 ? alternates : 0,
    elevation_interval: ELEVATION_STEP,
  };
}

export async function request(payload, signal, endpoint = 'route') {
  const res = await fetch(`${API.valhalla}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error_code === 442 ? 'Keine Route zwischen diesen Punkten gefunden'
      : data.error_code === 171 || data.error_code === 170 ? 'Punkt liegt nicht in der Nähe eines Wegs'
        : data.error_code === 154 ? 'Die Strecke ist für dieses Profil zu lang'
          : data.error || `Routing fehlgeschlagen (${res.status})`;
    throw new Error(msg);
  }
  if (endpoint !== 'route') return data;
  return [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
}

/**
 * Routen berechnen.
 * @param {Array<[lon,lat]>} points  Start, Zwischenziele, Ziel
 * @returns {Promise<Route[]>}      die erste ist die empfohlene
 */
export async function getRoutes(points, profile, { highways = true, avoid = [], signal } = {}) {
  const car = PROFILES[profile].costing === 'auto';
  if (tooLong(points, profile)) return [{ ...(await longRoute(points, profile, signal)), id: 0, noHighway: false }];
  const main = request(body(points, profile, { highways: car ? highways : true, alternates: MAX_ROUTES - 1, avoid }), signal);
  // Parallel, damit die Auswahl nicht auf eine zweite Anfrage warten muss
  const extra = car && highways
    ? request(body(points, profile, { highways: false, avoid }), signal).catch(() => [])
    : Promise.resolve([]);

  const [trips, noHighwayTrips] = await Promise.all([main, extra]);
  const routes = trips.map((t) => parseTrip(t));

  if (car && highways && !routes.some((r) => !r.hasHighway) && noHighwayTrips[0]) {
    const r = parseTrip(noHighwayTrips[0]);
    if (!r.hasHighway || !routes.some((x) => similar(x, r))) {
      if (routes.length >= MAX_ROUTES) routes.pop();
      routes.push(r);
    }
  }

  const unique = [];
  for (const r of routes) if (!unique.some((u) => similar(u, r))) unique.push(r);
  unique.forEach((r, i) => { r.id = i; r.noHighway = car && !r.hasHighway; });
  return unique.slice(0, MAX_ROUTES);
}

/**
 * Unterwegs neu berechnen: nur die beste Route, eine Anfrage, und die
 * Fahrtrichtung am Start zählt. Findet Valhalla in dieser Richtung nichts
 * (Sackgasse, Einbahnstraße), geht es ohne Richtung noch einmal.
 */
export async function reroute(points, profile, { highways = true, heading = null, signal } = {}) {
  const car = PROFILES[profile].costing === 'auto';
  if (tooLong(points, profile)) return { ...(await longRoute(points, profile, signal)), noHighway: false };
  const payload = (h) => body(points, profile, { highways: car ? highways : true, heading: h });
  let trips;
  try {
    trips = await request(payload(heading), signal);
  } catch (err) {
    if (err.name === 'AbortError' || !Number.isFinite(heading)) throw err;
    trips = await request(payload(null), signal);
  }
  const route = parseTrip(trips[0]);
  route.noHighway = car && !route.hasHighway;
  return route;
}

/*
 * Lange Strecken zu Fuß und mit dem Rad (Göttingen → Hamburg): Valhalla
 * lehnt ab, wenn die Luftlinie über alle Punkte zu lang ist. Dann jedes
 * Stück für sich rechnen und zu lange Stücke teilen (segment, wie im
 * Tourenplaner) – eine Route, keine Alternativen.
 */
function tooLong(points, profile) {
  const max = MAX_STRAIGHT[PROFILES[profile]?.costing];
  if (!max) return false;
  let d = 0;
  for (let i = 1; i < points.length; i += 1) d += straight(points[i - 1], points[i]);
  return d > max;
}

async function longRoute(points, profile, signal) {
  const parts = await Promise.all(points.slice(1).map((p, i) => segment(points[i], p, profile, { signal })));
  const r = withCum(joinSegments(parts, profile));
  // Nur die echten Zwischenziele melden „angekommen“ – nicht die Nahtstellen
  let last = -1;
  r.maneuvers = r.maneuvers.filter((m, i) => {
    const arrive = [4, 5, 6].includes(m.type);
    if (arrive && i < r.maneuvers.length - 1) return false;
    const depart = [1, 2, 3].includes(m.type);
    if (depart && last >= 0) return false;
    last = i;
    return true;
  });
  return { ...r, hasHighway: false, hasToll: false, hasFerry: parts.some((x) => x.hasFerry) };
}

/** Zwei Routen, die sich nur in Nachkommastellen unterscheiden, sind eine. */
function similar(a, b) {
  return Math.abs(a.length - b.length) / a.length < 0.005 && Math.abs(a.time - b.time) / a.time < 0.01;
}

/**
 * Valhalla-Trip → Route.
 *
 * Mehrere Abschnitte (bei Zwischenzielen) werden zu einer Linie verbunden;
 * die Indizes der Manöver werden dabei auf die gemeinsame Linie umgerechnet.
 */
function parseTrip(trip) {
  const coords = [];
  const maneuvers = [];
  const elevation = [];
  let offsetM = 0;

  trip.legs.forEach((leg, li) => {
    const shape = decodePolyline(leg.shape);
    const base = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? shape.slice(1) : shape));
    for (const m of leg.maneuvers) {
      // Zwischenziele: „Ziel erreicht“ nur am echten Ende
      const via = li < trip.legs.length - 1 && [4, 5, 6].includes(m.type);
      maneuvers.push({
        ...m,
        via,
        begin: base + m.begin_shape_index,
        end: base + m.end_shape_index,
      });
    }
    const step = leg.elevation_interval ?? ELEVATION_STEP;
    const legLength = leg.summary.length * 1000;
    (leg.elevation ?? []).forEach((h, i) => {
      if (h === null || h === undefined || h < -500) return;
      elevation.push([(offsetM + Math.min(i * step, legLength)) / 1000, h]);
    });
    offsetM += legLength;
  });

  const cum = cumulative(coords);
  // Valhalla rechnet Längen selbst – für die Navigation zählen unsere Meter
  for (const m of maneuvers) m.at = cum[m.begin];

  return {
    coords,
    cum,
    maneuvers,
    elevation,
    ...climb(elevation),
    length: trip.summary.length * 1000,
    time: trip.summary.time,
    hasHighway: !!trip.summary.has_highway,
    hasToll: !!trip.summary.has_toll,
    hasFerry: !!trip.summary.has_ferry,
    bounds: [trip.summary.min_lon, trip.summary.min_lat, trip.summary.max_lon, trip.summary.max_lat],
  };
}

/**
 * Anstieg und Abstieg.
 *
 * Rohdaten im 30-m-Raster rauschen; jede Zacke mitzuzählen ergibt zu viele
 * Höhenmeter. Darum erst glätten und dann nur Änderungen zählen, die eine
 * kleine Schwelle übersteigen.
 *
 * Start und Ziel bleiben dabei, wie sie sind (zu den Enden hin wird das
 * Fenster schmaler), und der Rest unter der Schwelle zählt am Ende mit: So
 * ist Anstieg − Abstieg genau der Höhenunterschied von Start und Ziel – bei
 * einem Rundweg gleich viel hinauf wie hinunter.
 */
function climb(elevation) {
  if (elevation.length < 2) return { ascent: 0, descent: 0, minEle: null, maxEle: null };
  const h = elevation.map(([, v]) => v);
  const smooth = h.map((_, i) => {
    const r = Math.min(2, i, h.length - 1 - i);
    let s = 0;
    for (let k = i - r; k <= i + r; k += 1) s += h[k];
    return s / (2 * r + 1);
  });
  let ascent = 0, descent = 0, ref = smooth[0];
  const THRESHOLD = 2;
  for (const v of smooth) {
    const d = v - ref;
    if (d > THRESHOLD) { ascent += d; ref = v; } else if (d < -THRESHOLD) { descent -= d; ref = v; }
  }
  const rest = smooth[smooth.length - 1] - ref;
  if (rest > 0) ascent += rest; else descent -= rest;
  return {
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    // reduce statt Math.min(...h): lange Routen haben zehntausende Werte
    minEle: Math.round(h.reduce((a, b) => (b < a ? b : a))),
    maxEle: Math.round(h.reduce((a, b) => (b > a ? b : a))),
  };
}

/**
 * Höhenprofil zu einer beliebigen Linie (aufgezeichnete Wege).
 * → { elevation: [[km, m], …], ascent, descent, minEle, maxEle }
 */
export async function heightsAlong(coords, { signal } = {}) {
  const line = coords.length > 2000 ? simplifyTo(coords, 2000) : coords;
  const data = await request({ encoded_polyline: encodePolyline(line), range: true, resample_distance: ELEVATION_STEP }, signal, 'height');
  const elevation = (data.range_height ?? []).filter(([, h]) => h !== null && h > -500).map(([m, h]) => [m / 1000, h]);
  return { elevation, ...climb(elevation) };
}

/* ── Erreichbarkeit ───────────────────────────────────────────────────────── */

/**
 * Was ist in `values` Minuten bzw. Kilometern erreichbar?
 * → GeoJSON-Features, größte Fläche zuerst (so liegen die kleinen obenauf).
 */
export async function isochrone(point, profile, { metric = 'time', values = [15], signal } = {}) {
  const [lon, lat] = point;
  const data = await request({
    locations: [{ lon, lat }],
    costing: PROFILES[profile].costing,
    costing_options: costingOptions(profile),
    contours: values.map((v) => (metric === 'time' ? { time: v } : { distance: v })),
    polygons: true,
    denoise: 0.3,
    generalize: 40,
  }, signal, 'isochrone');
  return (data.features ?? [])
    .map((f) => ({ ...f, properties: { value: f.properties.contour, metric } }))
    .sort((a, b) => b.properties.value - a.properties.value);
}

/* ── Touren: Abschnitte zwischen gesetzten Punkten ────────────────────────── */

const segmentCache = new Map();

/**
 * Route zwischen zwei Punkten, zwischengespeichert. Beim Verschieben eines
 * Punkts werden so nur die zwei angrenzenden Abschnitte neu gerechnet.
 */
/*
 * Valhalla (FOSSGIS) rechnet höchstens so weit Luftlinie am Stück – zu Fuß
 * 100 km, mit dem Rad 150 km. Längere Abschnitte teilt segment() selbst.
 */
const MAX_STRAIGHT = { pedestrian: 90000, bicycle: 135000 };

/**
 * Ein Abschnitt a → b. Zu lang für den Server? Dann in gleich lange Stücke
 * teilen und wieder zusammensetzen – so gehen auch Fernwanderwege und
 * mehrtägige Radtouren mit wenigen gesetzten Punkten.
 */
export async function segment(a, b, profile, { signal } = {}) {
  const max = MAX_STRAIGHT[PROFILES[profile]?.costing];
  const d = straight(a, b);
  if (max && d > max) {
    const n = Math.ceil(d / max);
    const pts = Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    const parts = await Promise.all(pts.slice(1).map((p, i) => piece(pts[i], p, profile, signal)));
    return withCum(joinSegments(parts, profile));
  }
  return piece(a, b, profile, signal);
}

const withCum = (r) => ({ ...r, cum: cumulative(r.coords) });

function straight([x1, y1], [x2, y2]) {
  const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
  return Math.hypot((x2 - x1) * k, y2 - y1) * 111320;
}

async function piece(a, b, profile, signal) {
  const key = `${profile}|${a.map((v) => v.toFixed(6))}|${b.map((v) => v.toFixed(6))}`;
  if (!segmentCache.has(key)) {
    const job = request(body([a, b], profile), signal).then(([trip]) => parseTrip(trip));
    segmentCache.set(key, job);
    job.catch(() => segmentCache.delete(key));
  }
  return segmentCache.get(key);
}

/**
 * Abschnitte zu einer Tour verbinden. Zeit bei Wanderprofilen nach DIN 33466
 * (4 km/h, 300 Hm/h hoch, 500 Hm/h runter) – das passt zu Wegweisern und
 * Wanderkarten besser als die reine Gehgeschwindigkeit.
 */
export function joinSegments(parts, profile) {
  const coords = [];
  const elevation = [];
  const maneuvers = [];
  let offsetM = 0;
  let time = 0;
  for (const r of parts) {
    const base = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? r.coords.slice(1) : r.coords));
    for (const [km, h] of r.elevation) elevation.push([offsetM / 1000 + km, h]);
    for (const m of r.maneuvers) maneuvers.push({ ...m, begin: base + m.begin, end: base + m.end });
    offsetM += r.length;
    time += r.time;
  }
  const cum = cumulative(coords);
  for (const m of maneuvers) m.at = cum[m.begin];
  const c = climb(elevation);
  if (PROFILES[profile].hikeTime) time = hikingTime(offsetM, c.ascent, c.descent);
  return {
    coords, cum, elevation, maneuvers, ...c,
    length: offsetM,
    time,
    bounds: coords.length ? bboxOf(coords) : null,
  };
}

export function hikingTime(meters, ascent, descent) {
  const horizontal = meters / 1000 / 4;
  const vertical = ascent / 300 + descent / 500;
  return (Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2) * 3600;
}

function bboxOf(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/* ── Wegtypen und Beläge ──────────────────────────────────────────────────── */

const SURFACE = {
  paved_smooth: 'Asphalt', paved: 'Befestigt', paved_rough: 'Pflaster',
  compacted: 'Verdichtet', dirt: 'Erdweg', gravel: 'Schotter', path: 'Naturpfad', impassable: 'Unwegsam',
};

function wayType(e) {
  if (e.use === 'cycleway') return 'Radweg';
  if (e.use === 'footway' || e.use === 'sidewalk' || e.use === 'pedestrian') return 'Fußweg';
  if (e.use === 'path' || e.use === 'mountain_bike') return (e.sac_scale ?? 0) >= 2 ? 'Bergpfad' : 'Pfad';
  if (e.use === 'track') return 'Feldweg';
  if (e.use === 'steps') return 'Treppe';
  if (e.use === 'ferry') return 'Fähre';
  if (['motorway', 'trunk'].includes(e.road_class)) return 'Schnellstraße';
  if (['primary', 'secondary'].includes(e.road_class)) return 'Hauptstraße';
  if (e.use === 'living_street' || e.road_class === 'residential') return 'Wohnstraße';
  return 'Nebenstraße';
}

/**
 * Anteile von Belag und Wegtyp entlang einer Linie – wie bei Komoot.
 * → { surfaces: [[name, meter], …], ways: [[name, meter], …] } absteigend
 */
export async function wayInfo(coords, profile, { signal } = {}) {
  const payload = {
    // Valhalla nimmt beim Abgleich nur begrenzt viele Punkte an
    encoded_polyline: encodePolyline(coords.length > 4000 ? simplifyTo(coords, 4000) : coords),
    costing: PROFILES[profile].costing,
    costing_options: costingOptions(profile),
    shape_match: 'map_snap',
    filters: { attributes: ['edge.surface', 'edge.use', 'edge.road_class', 'edge.length', 'edge.sac_scale'], action: 'include' },
  };
  const data = await request(payload, signal, 'trace_attributes');
  const surfaces = new Map(), ways = new Map();
  for (const e of data.edges ?? []) {
    const m = (e.length ?? 0) * 1000;
    const s = SURFACE[e.surface] ?? 'Unbekannt';
    surfaces.set(s, (surfaces.get(s) ?? 0) + m);
    const w = wayType(e);
    ways.set(w, (ways.get(w) ?? 0) + m);
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  return { surfaces: sorted(surfaces), ways: sorted(ways) };
}

/**
 * Aufgezeichneten Weg auf die Straßen legen (Map-Matching).
 * → { edges: [{ way_id, length (km), names, road_class, use }],
 *     matched: [{ type: 'matched'|'unmatched'|'interpolated', distance_from_trace_point }] }
 * matched[i] gehört zu points[i].
 */
export async function matchTrace(points, profile, { signal } = {}) {
  const payload = {
    shape: points.map(([lon, lat, t]) => ({ lon, lat, ...(t ? { time: t } : {}) })),
    costing: PROFILES[profile].costing,
    costing_options: costingOptions(profile),
    shape_match: 'map_snap',
    trace_options: { search_radius: 35, gps_accuracy: 12 },
    filters: {
      attributes: ['edge.way_id', 'edge.length', 'edge.names', 'edge.road_class', 'edge.use',
        'matched.type', 'matched.distance_from_trace_point', 'matched.edge_index'],
      action: 'include',
    },
  };
  const data = await request(payload, signal, 'trace_attributes');
  return { edges: data.edges ?? [], matched: data.matched_points ?? [] };
}

/* ── Manöver → Icon ───────────────────────────────────────────────────────── */

const ICONS = {
  1: 'navigation', 2: 'navigation', 3: 'navigation',
  4: 'sports_score', 5: 'sports_score', 6: 'sports_score',
  7: 'straight', 8: 'straight', 22: 'straight', 17: 'straight',
  9: 'turn_slight_right', 10: 'turn_right', 11: 'turn_sharp_right',
  12: 'u_turn_right', 13: 'u_turn_left',
  14: 'turn_sharp_left', 15: 'turn_left', 16: 'turn_slight_left',
  18: 'ramp_right', 19: 'ramp_left', 20: 'ramp_right', 21: 'ramp_left',
  23: 'fork_right', 24: 'fork_left',
  25: 'merge', 37: 'merge', 38: 'merge',
  26: 'roundabout_right', 27: 'roundabout_right',
  28: 'directions_boat', 29: 'directions_boat',
};

export const maneuverIcon = (m) => (m.via ? 'flag' : ICONS[m.type] ?? 'straight');
