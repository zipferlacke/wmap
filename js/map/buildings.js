/**
 * 3D-Häuser – eine eigene WebGL-Ebene statt MapLibres „building-3d“, in der normalen Karte wie auf dem Luftbild.
 *
 * Warum selbst: MapLibre stellt jedes Objekt der Kacheln auf die Bodenhöhe an seiner Mitte. Die Kacheln fassen
 * aber kleine Häuser gleicher Höhe zu einem Objekt zusammen (am Birkenweg in Rittmarshausen über 60 Häuser in
 * einem) – alle standen dann auf der Höhe eines Punkts mitten im Ort, mit feinem Gelände in der Luft oder im
 * Boden. Häuser aus Teilen (building:part) bekamen je Teil eine andere Höhe, und wo zwei Körper ineinander
 * stecken (dasselbe Haus einmal mit 12 m, einmal als 5-m-Stück), flackerten die Wände.
 *
 * Hier steht jedes Haus für sich, mit einer Bodenhöhe für alles, was dazugehört:
 *   Teile eines Hauses        die Höhe seines Umrisses (das Objekt mit `hide_3d`, selbst nicht gezeichnet)
 *   Stücke aus Nachbarkacheln  ein Haus über einer Kachelgrenze kommt zerschnitten – dieselbe Kennung, eine Höhe
 *   Körper in einem größeren  steckt die Mitte eines Hauses in einem anderen, die Höhe des größeren
 * Gemessen wird das Gelände an der Mitte (bei mehreren Stücken der gemeinsamen). Stecken Körper ineinander, liegen
 * ihre Wände oft in derselben Ebene – dann kämpfen sie ums Pixel (Streifen). Darum rückt in einer Gruppe jeder
 * niedrigere Körper 10 cm je Rang nach innen, die Wand des höheren liegt vorn. Die Wände reichen 10 m in den
 * Boden, so bleibt am Hang unten keine Lücke. Teile, die erst in der Höhe beginnen (render_min_height), schweben
 * wie gewollt darüber.
 *
 *   Karte     Wände in warmen Tönen (hohe Häuser kühler), Dächer rot, braun oder grau – je Haus leicht anders;
 *             im Dunkeln fast grau. Licht fest aus Südwest, unten etwas dunkler
 *   Luftbild  graue Wände, auf dem Dach das Luftbild des Ausschnitts (dieselben Quellen wie die
 *             Satellitenkarte: amtliche Luftbilder der Länder, sonst Sentinel-2)
 *
 * Pro Bild wird nichts gerechnet: Häuser und Luftbild liegen fertig auf der Grafikkarte, jedes Bild ist ein
 * Zeichenaufruf. Neu gebaut wird nur, wenn sich Ort oder Zoom merklich ändern, Kacheln nachkommen, das Gelände
 * an- oder ausgeht oder das Design wechselt – Drehen und Neigen nicht. Das Luftbild ist ein fester Block aus
 * 8×8 Kacheln um die Mitte; es wird erst ersetzt, wenn die Mitte ihn verlässt.
 */
import earcut from '../../libs/earcut/earcut.js';

const ID = 'wmap-buildings';
const MIN_ZOOM = 14;
const TILE = 256;
const MAX_TEX = 2048;                     // höchstens 8×8 Kacheln – Speicher und Abrufe klein
const SAT_WALL = [0.66, 0.67, 0.69];     // Grau der Wände auf dem Luftbild
const SINK = 10;                          // so tief reichen die Wände in den Boden (m)
const EAVE = 0.8;                         // Dachkante: oberster Streifen der Wand in Dachfarbe (m)
const INSET = 0.1;                        // ineinander steckende Körper: so weit rückt der niedrigere je Rang ein (m)

// Licht aus Südwest (Azimut 225°, wie map.setLight in map/map.js) – Richtung zum Licht in Ost/Nord
const LIGHT = (() => { const a = (225 * Math.PI) / 180; return [Math.sin(a), Math.cos(a)]; })();

const VERT = `
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec4 a_color;
uniform mat4 u_matrix;
varying vec2 v_uv; varying vec4 v_color;
void main() { v_uv = a_uv; v_color = a_color; gl_Position = u_matrix * vec4(a_pos, 1.0); }`;
const FRAG = `
precision mediump float;
uniform sampler2D u_tex; uniform float u_hasTex;
varying vec2 v_uv; varying vec4 v_color;
void main() {
  // a < 0.5: Dach mit Luftbild (außerhalb der Textur die Farbe selbst)
  if (v_color.a < 0.5) {
    bool inside = u_hasTex > 0.5 && v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
    gl_FragColor = inside ? vec4(texture2D(u_tex, v_uv).rgb, 1.0) : vec4(v_color.rgb, 1.0);
  } else {
    gl_FragColor = vec4(v_color.rgb, 1.0);
  }
}`;

/* ── Farben ─────────────────────────────────────────────────────────────── */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const WALLS = ['#d6c7b1', '#cbbba5', '#dbd0c0', '#c7b8a4'].map(hex);
const WALLS_HIGH = ['#aab1bd', '#9ea7b5', '#b3b6be'].map(hex);
const ROOFS = ['#a8624d', '#8e5a4a', '#7d7f86', '#b07a5c'].map(hex);
const ROOF_HIGH = hex('#8d939c');

/** Wie map/map.js darken für Häuser: hell → dunkel, Farbe fast weg */
function dark([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const nl = 0.08 + (1 - l) * 0.45, ns = s * 0.3;
  const c = (1 - Math.abs(2 * nl - 1)) * ns, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = nl - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r1 + m, g1 + m, b1 + m];
}

/* ── Luftbild als eine Textur für den Ausschnitt ────────────────────────── */

const merc = (lng, lat) => maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
const tileBounds = (x, y, z) => {
  const n = 2 ** z, R = 20037508.342789244;
  return [x / n * 2 * R - R, R - (y + 1) / n * 2 * R, (x + 1) / n * 2 * R - R, R - y / n * 2 * R];
};
const lngOf = (x, z) => (x / 2 ** z) * 360 - 180;
const latOf = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Kacheln z/x0..x1/y0..y1 in eine Leinwand – je Kachel erst Sentinel-2 (nur
 * bis Zoom 14, darüber vergrößert), darüber die amtlichen Luftbilder, in deren
 * Gebiet die Kachel liegt. Außerhalb ihres Landes sind die durchsichtig, so
 * bleibt an Landesgrenzen nichts schwarz.
 */
async function paintTexture(sources, z, x0, x1, y0, y1, signal) {
  const c = Object.assign(document.createElement('canvas'), { width: (x1 - x0 + 1) * TILE, height: (y1 - y0 + 1) * TILE });
  const ctx = c.getContext('2d');
  const jobs = [];
  const base = sources.find((s) => !s.bounds);
  const draw = (url, sx, sy, sw, dx, dy) => loadImage(url).then((img) => img && (sw ? ctx.drawImage(img, sx, sy, sw, sw, dx, dy, TILE, TILE) : ctx.drawImage(img, dx, dy, TILE, TILE)));
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const lng = lngOf(x + 0.5, z), lat = latOf(y + 0.5, z);
      const dx = (x - x0) * TILE, dy = (y - y0) * TILE;
      // Erst Sentinel-2 (nur bis Zoom 14, das passende Stück der Elternkachel) …
      const pz = Math.min(z, base.maxzoom ?? 14), k = 2 ** (z - pz), part = base.tileSize / k;
      const under = draw(base.tiles.replace('{z}', pz).replace('{x}', Math.floor(x / k)).replace('{y}', Math.floor(y / k)), (x % k) * part, (y % k) * part, part, dx, dy);
      // … darüber die amtlichen Luftbilder, deren Gebiet die Kachel berührt –
      // außerhalb ihres Landes sind sie durchsichtig
      const regions = sources.filter((s) => s.bounds && z >= (s.minzoom ?? 0)
        && lng >= s.bounds[0] && lng <= s.bounds[2] && lat >= s.bounds[1] && lat <= s.bounds[3]);
      const tops = regions.map((r) => loadImage(r.tiles.replace('{bbox-epsg-3857}', tileBounds(x, y, z).join(',')).replace('WIDTH=512&HEIGHT=512', `WIDTH=${TILE}&HEIGHT=${TILE}`)));
      jobs.push(under.then(() => Promise.all(tops)).then((imgs) => imgs.forEach((img) => img && ctx.drawImage(img, dx, dy, TILE, TILE))));
    }
  }
  await Promise.all(jobs);
  if (signal.aborted) return null;
  return c;
}

/* ── Häuser sammeln: jedes für sich, mit einer Bodenhöhe ────────────────── */

const ringCenter = (ring) => { let x = 0, y = 0; const n = ring.length - 1; for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; } return [x / n, y / n]; };
const ringBox = (ring) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of ring) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
function inRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const areaOf = (ring) => { let a = 0; for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a / 2; };
// Kleine Zahl je Haus für die Farbe – aus der Lage, nicht aus der Kennung (die teilen sich zusammengefasste Häuser)
const tint = (p) => Math.abs(Math.round(p[0] * 1e5) * 7 + Math.round(p[1] * 1e5) * 13);

/**
 * Geländehöhe an einem Punkt – schnell. `queryTerrainElevation` bestimmt bei jedem Aufruf neu, welche Kacheln im
 * Bild sind, nur um die Zoomstufe des Geländes zu finden (am Handy Sekunden für eine Stadt). Hier wird diese
 * Stufe einmal abgehört, danach gilt sie für alle Häuser – dieselbe Höhe wie bei `queryTerrainElevation`.
 */
function groundOf(map) {
  const t = map.terrain;
  const slow = (p) => map.queryTerrainElevation?.(p) ?? 0;
  if (!t?.getElevationForLngLatZoom) return slow;
  let z = null;
  const own = t.getElevationForLngLatZoom;
  t.getElevationForLngLatZoom = function (lngLat, zoom) { z = zoom; return own.call(this, lngLat, zoom); };
  try { map.queryTerrainElevation(map.getCenter()); } finally { t.getElevationForLngLatZoom = own; }
  if (z == null) return slow;
  return (p) => t.getElevationForLngLatZoom(new maplibregl.LngLat(p[0], p[1]), z);
}

/* ── In Häppchen: lange Arbeit in Stücke, dazwischen zeichnet die Karte weiter ── */

const STALE = Symbol('stale');
/** Nach 8 ms Arbeit eine Pause bis zum nächsten Durchlauf; gilt die Arbeit danach nicht mehr (`alive`), Abbruch */
function pacer(alive) {
  let t = performance.now();
  return {
    due: () => performance.now() - t > 8,
    async rest() {
      await new Promise((r) => setTimeout(r, 0));
      if (!alive()) throw STALE;
      t = performance.now();
    },
  };
}
const NO_PACE = { due: () => false, rest: async () => {} };

/**
 * → [{ key, rings, height, min, ground, tint, rank }] – jedes Haus (jedes Polygon, auch aus zusammengefassten
 * Objekten) einmal, mit der gemeinsamen Bodenhöhe seiner Gruppe
 */
export async function collectBuildings(map, pace = NO_PACE) {
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
  const outlines = [];
  const solids = [];
  const seen = new Set();
  for (const f of feats) {
    if (pace.due()) await pace.rest();
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    const height = Math.max(3, Number(f.properties.render_height) || 6);
    const min = Number(f.properties.render_min_height) || 0;
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      const key = `${outer[0]}|${outer.length}|${height}|${min}|${f.properties.hide_3d ? 1 : 0}`;
      if (seen.has(key)) continue;           // gleiche Fläche aus der Nachbarkachel
      seen.add(key);
      const item = { key, rings, height, min, center: ringCenter(outer), box: ringBox(outer), area: Math.abs(areaOf(outer)), n: outer.length };
      // Ein Haus über einer Kachelgrenze: gleiche Kennung, eigenes Polygon je Kachel. Zusammengefasste Häuser
      // (MultiPolygon) teilen sich die Kennung auch – die gehören nicht zusammen
      if (f.id != null && f.geometry.type === 'Polygon') item.idKey = `${f.id}`;
      (f.properties.hide_3d ? outlines : solids).push(item);
    }
  }
  // Gruppen: Union-Find über die Häuser (Index) – Umrisse bekommen eigene Plätze dahinter
  const all = [...solids, ...outlines];
  const parent = all.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  // Raster nach Lage (Zellen von etwa 35 m), damit nicht jedes Haus gegen jedes geprüft wird
  const CELL = 0.0005;
  const cellOf = (x, y) => Math.floor(x / CELL) * 1e6 + Math.floor(y / CELL);
  const grid = new Map();
  for (let i = 0; i < all.length; i += 1) {
    const b = all[i].box;
    for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x += 1) {
      for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y += 1) {
        const c = x * 1e6 + y;
        const list = grid.get(c);
        if (list) list.push(i); else grid.set(c, [i]);
      }
    }
  }
  const byId = new Map();
  for (let i = 0; i < solids.length; i += 1) {
    if (pace.due()) await pace.rest();
    const s = solids[i];
    if (s.idKey) { if (byId.has(s.idKey)) join(i, byId.get(s.idKey)); else byId.set(s.idKey, i); }
    // In einem Umriss (Teil eines Hauses) oder in einem größeren Körper: dessen Gruppe
    const cell = grid.get(cellOf(s.center[0], s.center[1])) ?? [];
    let host = -1, hostArea = Infinity;
    for (const j of cell) {
      if (j === i) continue;
      const o = all[j];
      const isOutline = j >= solids.length;
      if (!isOutline && o.area <= s.area) continue;
      if (!inBox(s.center, o.box) || !inRing(s.center, o.rings[0])) continue;
      // Ein Umriss geht vor; sonst der kleinste umgebende Körper
      const rank = isOutline ? -1 : o.area;
      if (rank < hostArea) { host = j; hostArea = rank; }
    }
    if (host >= 0) join(i, host);
  }
  // Bodenhöhe je Gruppe: am Umriss, sonst an der gemeinsamen Mitte aller Stücke
  const groups = new Map();
  all.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { outline: null, x: 0, y: 0, w: 0, color: null });
    const g = groups.get(r);
    if (i >= solids.length) { if (!g.outline || it.area > g.outline.area) g.outline = it; return; }
    g.x += it.center[0] * it.n; g.y += it.center[1] * it.n; g.w += it.n;
    if (!g.color || it.area > g.colorArea) { g.color = it.center; g.colorArea = it.area; }
  });
  const ground = groundOf(map);
  for (const g of groups.values()) {
    if (pace.due()) await pace.rest();
    const at = g.outline ? g.outline.center : g.w ? [g.x / g.w, g.y / g.w] : null;
    g.ground = at ? ground(at) : 0;
    g.tint = tint(g.outline ? g.outline.center : g.color ?? at ?? [0, 0]);
  }
  // Rang in der Gruppe: der höchste 0, dann absteigend (bei gleicher Höhe der größere zuerst)
  const members = new Map();
  solids.forEach((s, i) => { const r = find(i); if (!members.has(r)) members.set(r, []); members.get(r).push(i); });
  const rank = new Array(solids.length).fill(0);
  for (const list of members.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => solids[b].height - solids[a].height || solids[b].area - solids[a].area).forEach((i, k) => { rank[i] = k; });
  }
  return solids.map((s, i) => { const g = groups.get(find(i)); return { key: s.key, rings: s.rings, height: s.height, min: s.min, ground: g.ground, tint: g.tint, rank: rank[i] }; });
}

/* ── Häuser als Dreiecke ────────────────────────────────────────────────── */

// Web-Mercator wie maplibregl.MercatorCoordinate – ohne ein Objekt je Ecke
const mercX = (lng) => (180 + lng) / 360;
const mercY = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

/**
 * Ein Haus → Float32Array: je Ecke x, y, z (relativ zum Ursprung), u, v, r, g, b, a
 *   a = 0: Dach mit Luftbild (nur `sat`), sonst die Farbe
 */
function houseMesh(hs, origin, unit, { sat, darkMode, tex }) {
  const look = (c) => (darkMode ? dark(c) : c);
  const high = hs.height >= 40;
  const wall = sat ? SAT_WALL : look(high ? WALLS_HIGH[hs.tint % 3] : WALLS[hs.tint % 4]);
  const roof = sat ? SAT_WALL.map((v) => v * 1.08) : look(hs.height >= 25 ? ROOF_HIGH : ROOFS[hs.tint % 4]);
  const zTop = (hs.ground + hs.height) * unit;
  const zEave = (hs.ground + Math.max(hs.min, hs.height - EAVE)) * unit;
  const zBase = (hs.ground + (hs.min > 0 ? hs.min : -SINK)) * unit;
  // Ecken in Mercator; eingerückt (rank > 0): jede Ecke zur Mitte des Hauses hin
  const outer = hs.rings[0];
  let cx = 0, cy = 0;
  for (let i = 0; i < outer.length - 1; i += 1) { cx += mercX(outer[i][0]); cy += mercY(outer[i][1]); }
  cx /= outer.length - 1; cy /= outer.length - 1;
  const pull = hs.rank * INSET * unit;
  const flat = [], holes = [], rings = [];
  for (const ring of hs.rings) {
    if (flat.length) holes.push(flat.length / 2);
    const pts = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      let x = mercX(ring[i][0]), y = mercY(ring[i][1]);
      if (pull) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        const k = d > pull * 2 ? 1 - pull / d : 0.5;
        x = cx + dx * k; y = cy + dy * k;
      }
      pts.push(x, y); flat.push(x, y);
    }
    rings.push(pts);
  }
  const tris = earcut(flat, holes);
  let n = tris.length;
  for (const pts of rings) n += (pts.length / 2) * 12;
  const out = new Float32Array(n * 9);
  let o = 0;
  const put = (x, y, z, u, v, c, a) => {
    out[o++] = x - origin.x; out[o++] = y - origin.y; out[o++] = z; out[o++] = u; out[o++] = v;
    out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2]; out[o++] = a;
  };
  rings.forEach((pts, r) => {
    // Außenring und Löcher: Richtung der Außenseite aus dem Umlaufsinn (Breite wächst nach Norden)
    const ccw = areaOf(hs.rings[r]) > 0;
    const outward = r === 0 ? ccw : !ccw;
    const k = pts.length / 2;
    for (let i = 0; i < k; i += 1) {
      const j = (i + 1) % k;
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
      // Normale nach außen in Ost/Nord: Kante (dx, -dy) gedreht
      const ex = bx - ax, ny = -(by - ay), len = Math.hypot(ex, ny) || 1;
      const nx = outward ? ny / len : -ny / len, nn = outward ? -ex / len : ex / len;
      const lit = Math.max(0, nx * LIGHT[0] + nn * LIGHT[1]);
      const shade = 0.72 + 0.3 * lit;
      const lo = wall.map((v) => v * shade * 0.86), hi = wall.map((v) => v * shade);
      put(ax, ay, zBase, 0, 0, lo, 1); put(bx, by, zBase, 0, 0, lo, 1); put(bx, by, zEave, 0, 0, hi, 1);
      put(ax, ay, zBase, 0, 0, lo, 1); put(bx, by, zEave, 0, 0, hi, 1); put(ax, ay, zEave, 0, 0, hi, 1);
      // Dachkante in Dachfarbe (nur Karte)
      const eave = sat ? hi : roof.map((v) => v * (0.82 + 0.18 * lit));
      put(ax, ay, zEave, 0, 0, eave, 1); put(bx, by, zEave, 0, 0, eave, 1); put(bx, by, zTop, 0, 0, eave, 1);
      put(ax, ay, zEave, 0, 0, eave, 1); put(bx, by, zTop, 0, 0, eave, 1); put(ax, ay, zTop, 0, 0, eave, 1);
    }
  });
  // Dach: Fläche auf Dachhöhe – Luftbild oder Farbe
  for (const i of tris) {
    const x = flat[2 * i], y = flat[2 * i + 1];
    const u = tex ? (x - tex.x0) / (tex.x1 - tex.x0) : -1, v = tex ? (y - tex.y0) / (tex.y1 - tex.y0) : -1;
    put(x, y, zTop, u, v, roof, sat ? 0 : 1);
  }
  return out;
}

/**
 * Alle Häuser → { data: Float32Array, next: Zwischenspeicher }. Ein Haus, das schon im Zwischenspeicher liegt
 * (gleiche Fläche, Bodenhöhe, Rang, Farbe), wird übernommen statt neu gerechnet.
 */
async function buildMesh(houses, origin, opts, cache = new Map(), pace = NO_PACE) {
  const unit = origin.meterInMercatorCoordinateUnits();
  const next = new Map();
  const parts = [];
  let total = 0;
  for (const hs of houses) {
    if (pace.due()) await pace.rest();
    const key = `${hs.key}|${hs.ground.toFixed(2)}|${hs.rank}|${hs.tint}`;
    const part = cache.get(key) ?? next.get(key) ?? houseMesh(hs, origin, unit, opts);
    next.set(key, part);
    parts.push(part);
    total += part.length;
  }
  const data = new Float32Array(total);
  let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  return { data, next };
}

/* ── Die Ebene ──────────────────────────────────────────────────────────── */

/**
 * Häuser selbst zeichnen und MapLibres 3D-Häuser („building-3d“, „building-roof“) ausblenden.
 * `darkMode()`: dunkles Design? → { setSat(an, Quellen der Satellitenkarte), rebuild }
 */
export function mountBuildings(map, { darkMode = () => false } = {}) {
  let gl = null, prog = null, buf = null, texture = null;
  let count = 0, origin = null, hasTex = false;
  let loc = {};
  let ctl = null, timer = null;
  let tex = null;                         // Mercator-Bereich der Textur
  let sat = false, sources = [];

  const layer = {
    id: ID, type: 'custom', renderingMode: '3d',
    onAdd(m, context) {
      gl = context;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      loc = {
        pos: gl.getAttribLocation(prog, 'a_pos'), uv: gl.getAttribLocation(prog, 'a_uv'), color: gl.getAttribLocation(prog, 'a_color'),
        matrix: gl.getUniformLocation(prog, 'u_matrix'), tex: gl.getUniformLocation(prog, 'u_tex'), hasTex: gl.getUniformLocation(prog, 'u_hasTex'),
      };
      buf = gl.createBuffer();
      texture = gl.createTexture();
      schedule();
    },
    render(context, args) {
      if (!count || !origin || map.getZoom() < MIN_ZOOM) return;
      // Matrix · Verschiebung zum Ursprung – so bleiben die Ecken genau (Float32)
      const M = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
      const m = Array.from(M);
      const [ox, oy] = [origin.x, origin.y];
      for (let r = 0; r < 4; r += 1) m[12 + r] += m[r] * ox + m[4 + r] * oy;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.matrix, false, new Float32Array(m));
      gl.uniform1f(loc.hasTex, sat && hasTex ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(loc.tex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const stride = 9 * 4;
      gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 4, gl.FLOAT, false, stride, 20);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.disableVertexAttribArray(loc.pos); gl.disableVertexAttribArray(loc.uv); gl.disableVertexAttribArray(loc.color);
    },
    onRemove() {
      gl?.deleteBuffer(buf);
      gl?.deleteTexture(texture);
      gl?.deleteProgram(prog);
      gl = null; count = 0;
    },
  };

  function upload(data, at) {
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    count = data.length / 9;
    origin = at;
    map.triggerRepaint();
  }

  /*
   * Häuser bauen – in Häppchen, die Karte läuft dabei weiter; bis sie fertig sind, bleiben die alten stehen.
   * Ein neuer Bau löst einen laufenden ab. Der Ursprung ist die Ecke eines festen Felds (etwa 40 km), so passen
   * die schon gerechneten Häuser beim nächsten Bau wieder – neu gerechnet wird nur, was neu ist.
   */
  let gen = 0;
  let cache = new Map(), cacheFor = '';
  async function make(o) {
    const mine = ++gen;
    const pace = pacer(() => mine === gen && !!gl);
    const opts = { sat, darkMode: darkMode(), tex: sat && hasTex ? tex : null };
    const zone = new maplibregl.MercatorCoordinate(Math.floor(o.x * 1024) / 1024, Math.floor(o.y * 1024) / 1024, 0);
    const look = `${zone.x}|${zone.y}|${opts.sat}|${opts.darkMode}|${opts.tex ? `${tex.z}|${tex.x0}|${tex.y0}` : ''}`;
    if (look !== cacheFor) { cache = new Map(); cacheFor = look; }
    try {
      const houses = await collectBuildings(map, pace);
      const { data, next } = await buildMesh(houses, zone, opts, cache, pace);
      if (mine !== gen || look !== cacheFor) return;
      cache = next;
      upload(data, zone);
    } catch (e) {
      if (e !== STALE) throw e;
    }
  }

  let built = null;                       // wo und bei welchem Zoom zuletzt gebaut

  /**
   * Häuser neu bauen – nur, wenn sich Ort oder Zoom wirklich geändert haben (oder Kacheln nachkamen, das
   * Gelände wechselte: force). Drehen und Neigen ändern nichts.
   */
  async function rebuild({ force = false } = {}) {
    if (!gl || map.getZoom() < MIN_ZOOM) { gen += 1; count = 0; built = null; map.triggerRepaint(); return; }
    const c = map.getCenter();
    const o = merc(c.lng, c.lat);
    const zoom = map.getZoom();
    const px = built ? Math.hypot(o.x - built.x, o.y - built.y) * 512 * 2 ** zoom : Infinity;
    if (!force && built && Math.abs(zoom - built.zoom) < 0.5 && px < 200) return;
    built = { x: o.x, y: o.y, zoom };
    await make(o);
    if (!sat) return;
    // Luftbild: fester Block aus 8×8 Kacheln um die Mitte
    const z = Math.min(18, Math.max(15, Math.round(zoom) + 1));
    const n = 2 ** z;
    const cx = Math.floor(o.x * n), cy = Math.floor(o.y * n);
    const half = MAX_TEX / TILE / 2;
    const x0 = cx - half + 1, x1 = cx + half, y0 = cy - half + 1, y1 = cy + half;
    const area = { x0: x0 / n, x1: (x1 + 1) / n, y0: y0 / n, y1: (y1 + 1) / n };
    // Die Mitte liegt noch gut im alten Block? Dann bleibt er
    const inner = (v, a, b) => v > a + (b - a) * 0.2 && v < b - (b - a) * 0.2;
    if (tex && hasTex && tex.z === z && inner(o.x, tex.x0, tex.x1) && inner(o.y, tex.y0, tex.y1)) return;
    ctl?.abort();
    ctl = new AbortController();
    const canvas = await paintTexture(sources, z, x0, x1, y0, y1, ctl.signal);
    if (!canvas || !gl || !sat) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    canvas.width = 0;                      // Leinwand freigeben – das Bild liegt jetzt auf der Grafikkarte
    tex = { ...area, z };
    hasTex = true;
    await make(o);
  }
  const schedule = (force = false) => { clearTimeout(timer); timer = setTimeout(() => rebuild({ force }), 250); };
  map.on('moveend', () => schedule());
  // Kommen Gebäude- oder Geländekacheln nach (genauere Zoomstufe), sobald die Karte fertig geladen hat neu
  // bauen – ohne dass man sie bewegen muss. Gelände an/aus: Die Häuser stehen dann anders hoch
  let dirty = false;
  map.on('sourcedata', (e) => { if (e.tile && (e.sourceId === 'openmaptiles' || e.sourceId?.startsWith('terrain'))) dirty = true; });
  map.on('idle', () => { if (dirty) { dirty = false; schedule(true); } });
  map.on('terrain', () => schedule(true));

  // MapLibres eigene 3D-Häuser aus – an ihrer Stelle diese Ebene (Routen bleiben darunter)
  const extrusions = () => map.getStyle().layers.filter((l) => l.type === 'fill-extrusion').map((l) => l.id);
  const first = extrusions()[0];
  for (const id of extrusions()) map.setLayoutProperty(id, 'visibility', 'none');
  map.addLayer(layer, first);

  return {
    /** Luftbild auf den Dächern an/aus */
    setSat(value, satSources = sources) {
      sources = satSources;
      if (value === sat) return;
      sat = value;
      if (!sat) { ctl?.abort(); tex = null; hasTex = false; }
      built = null;
      schedule(true);
    },
    /** Design gewechselt: neu einfärben */
    rebuild: () => { built = null; schedule(true); },
  };
}
