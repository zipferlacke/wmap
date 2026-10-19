/**
 * Haltestellen aus den Kartenkacheln – für Street View (map/street-shops.js) und die 3D-Karte (map/buildings.js),
 * ohne Overpass:
 *   Bus und Straßenbahn  poi bus_stop / tram_stop; Straßenbahn-Halte liegen auf dem Gleis – sie rücken an den
 *                        nächsten Bahnsteig (transportation path/platform, bis 25 m)
 *   Wartehäuschen        ein Unterstand (poi shelter) bis 12 m daneben
 *   Lage                 Richtung der nächsten Straße und Seite (einmal je Haltestelle berechnet, gemerkt)
 * Dieselbe Haltestelle nur einmal (gleicher Name bis 12 m – Kacheln doppelt, Bahnsteig und Halt).
 */
const RAD = Math.PI / 180;

export function meters(a, b) {
  const k = 111320, kx = k * Math.cos(a[1] * RAD);
  return [(b[0] - a[0]) * kx, (b[1] - a[1]) * k];
}

/** Nächster Punkt einer Linie → { point, d (m) } */
export function closest(p, line) {
  let best = { point: line[0], d: Infinity };
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = meters(p, line[i - 1]), [bx, by] = meters(p, line[i]);
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { point: [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t], d };
  }
  return best;
}

const nameOf = (p) => p['name:de'] ?? p.name_de ?? p.name ?? '';

/** Ist das Kachel-Objekt (poi) eine Haltestelle bzw. ein Unterstand? */
export const isStopPoi = (p) => (p.class === 'bus' && p.subclass === 'bus_stop') || p.subclass === 'tram_stop';
export const isShelterPoi = (p) => p.subclass === 'shelter';
export const stopOf = (f) => ({ point: f.geometry.coordinates, name: nameOf(f.properties), shelter: false, rail: f.properties.subclass === 'tram_stop', feat: f });

/** Haltestellen und Unterstände im Umkreis aus den Kacheln → { raw, shelters } */
export function scanStops(map, pos, radius) {
  const raw = [], shelters = [];
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi', filter: ['in', ['get', 'subclass'], ['literal', ['bus_stop', 'tram_stop', 'shelter']]] })) {
    if (f.geometry.type !== 'Point' || Math.hypot(...meters(pos, f.geometry.coordinates)) > radius) continue;
    if (isStopPoi(f.properties)) raw.push(stopOf(f));
    else if (isShelterPoi(f.properties)) shelters.push(f.geometry.coordinates);
  }
  return { raw, shelters };
}

const beside = new Map();       // Haltestelle → { dir, away }

/**
 * Haltestellen setzen → [{ point, name, shelter, rail, feat, dir, away }]; `dir` null: keine Straße bis 25 m
 * (Kacheln noch nicht da – dann beim nächsten Mal neu).
 */
export function placeStops(map, raw, shelters, pos, radius) {
  const platforms = [];
  if (raw.some((x) => x.rail)) {
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation', filter: ['==', ['get', 'subclass'], 'platform'] })) {
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' || g.type === 'Polygon' ? g.coordinates : [];
      for (const l of lines) if (Math.hypot(...meters(pos, l[0])) < radius + 100) platforms.push(l);
    }
  }
  const out = [];
  for (const x of raw) {
    let point = x.point;
    if (x.rail) {
      let best = 25;
      for (const l of platforms) {
        const c = closest(x.point, l);
        if (c.d < best) { best = c.d; point = c.point; }
      }
    }
    const shelter = shelters.some((s) => Math.hypot(...meters(point, s)) < 12);
    const twin = out.find((y) => y.name === x.name && Math.hypot(...meters(y.point, point)) < 12);
    if (twin) { twin.shelter ||= shelter; continue; }
    const k = `${point[0].toFixed(6)},${point[1].toFixed(6)},${x.rail}`;
    let r = beside.get(k);
    if (!r) { r = roadBeside(map, point, x.rail); if (r.dir != null) beside.set(k, r); }
    out.push({ ...x, point, shelter, ...r });
  }
  if (beside.size > 2000) beside.clear();
  return out;
}

/** Richtung der nächsten Straße (bis 25 m) und auf welcher Seite die Haltestelle liegt → { dir, away } */
function roadBeside(map, point, rail = false) {
  let best = 25, dir = null, side = 1;
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
    // Auch Fußgängerzonen – Busse fahren durch manche (Göttingen); Gleise nur für Straßenbahnen
    if (f.properties.class === 'ferry' || (!rail && ['rail', 'transit'].includes(f.properties.class))) continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i += 1) {
        const [ax, ay] = meters(point, line[i - 1]), [bx, by] = meters(point, line[i]);
        const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
        if (!l) continue;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d >= best) continue;
        best = d;
        dir = Math.atan2(dx, dy) / RAD;
        // Haltestelle links (+) oder rechts (−) der Fahrtrichtung – das Häuschen steht weiter weg von der Straße
        side = dx * (0 - ay) - dy * (0 - ax) > 0 ? -1 : 1;
      }
    }
  }
  return { dir, away: side };
}
