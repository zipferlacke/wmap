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
 * Das Haus steht auf der tiefsten Stelle seines Grundrisses (gemessen an der Mitte und an den vier Ecken seines
 * Rechtecks, etwas nach innen gerückt) – so schwebt am Hang nichts. Die Wände reichen nur 0,5 m in den Boden:
 * MapLibre verdeckt eigene Ebenen nicht mit dem Gelände, jeder Meter darunter wäre zu sehen und läge je nach
 * Blickrichtung über der Straße davor (bis 2.3.2 waren es 10 m). Stecken Körper ineinander, liegen ihre Wände oft
 * in derselben Ebene – dann kämpfen sie ums Pixel (Streifen). Darum rückt in einer Gruppe jeder niedrigere Körper
 * 10 cm je Rang nach innen, die Wand des höheren liegt vorn. Teile, die erst in der Höhe beginnen
 * (render_min_height), schweben wie gewollt darüber.
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
import { scanStops, placeStops } from './tile-stops.js';

const ID = 'wmap-buildings';
const MIN_ZOOM = 14;
const STOP_ZOOM = 17;                      // 3D-Karte: ab hier Haltestellen mit Schild und Häuschen wie in Street View
const STOP_R = 600;                        // … im Umkreis der Bildmitte (m)
const TILE = 256;
const MAX_TEX = 2048;                     // höchstens 8×8 Kacheln – Speicher und Abrufe klein
const SAT_WALL = [0.66, 0.67, 0.69];     // Grau der Wände auf dem Luftbild
const SINK = 0.5;                         // so tief reichen die Wände in den Boden (m) – sichtbar, MapLibre verdeckt nicht
const EAVE = 0.8;                         // Dachkante: oberster Streifen der Wand in Dachfarbe (m)
const INSET = 0.1;                        // ineinander steckende Körper: so weit rückt der niedrigere je Rang ein (m)
const SHOP_FLOOR = 3.6;                   // Street View: Erdgeschoss eines Geschäfts in seiner Farbe (m)

// Licht aus Südwest (Azimut 225°, wie map.setLight in map/map.js) – Richtung zum Licht in Ost/Nord
const LIGHT = (() => { const a = (225 * Math.PI) / 180; return [Math.sin(a), Math.cos(a)]; })();

const VERT = `
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec4 a_color;
uniform mat4 u_matrix;
varying vec2 v_uv; varying vec4 v_color;
void main() { v_uv = a_uv; v_color = a_color; gl_Position = u_matrix * vec4(a_pos, 1.0); }`;
const FRAG = `
precision mediump float;
uniform sampler2D u_tex; uniform float u_hasTex; uniform float u_alpha;
varying vec2 v_uv; varying vec4 v_color;
void main() {
  // a < 0.5: Dach mit Luftbild (außerhalb der Textur die Farbe selbst)
  if (v_color.a < 0.5) {
    bool inside = u_hasTex > 0.5 && v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
    gl_FragColor = inside ? vec4(texture2D(u_tex, v_uv).rgb, 1.0) : vec4(v_color.rgb, 1.0);
  } else {
    gl_FragColor = vec4(v_color.rgb, u_alpha);
  }
}`;

/* ── Farben ─────────────────────────────────────────────────────────────── */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Farbnamen, wie sie in building:colour vorkommen (die Kacheln geben sie so weiter)
const NAMED = { white: '#f2f0ea', beige: '#e3d6b8', brown: '#8a5a3c', grey: '#9a9a9a', gray: '#9a9a9a', silver: '#c0c0c0',
  red: '#b5483a', yellow: '#e6cf6a', orange: '#d98a3e', pink: '#e3a5a0', green: '#7c9a63', blue: '#6f8fb3', black: '#3a3a3a',
  cream: '#f1e6c8', tan: '#d2b48c', maroon: '#7a3a32', darkgrey: '#6a6a6a', darkgray: '#6a6a6a', lightgrey: '#d3d3d3', lightgray: '#d3d3d3' };
/** Farbe aus OSM → [r, g, b] oder null */
function colourOf(v) {
  const c = String(v ?? '').trim().toLowerCase();
  const h = NAMED[c] ?? (/^#[0-9a-f]{6}$/.test(c) ? c : /^#[0-9a-f]{3}$/.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : null);
  return h ? hex(h) : null;
}
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
 * Objekten) einmal, mit der gemeinsamen Bodenhöhe seiner Gruppe. `near` ({ point, radius } in m): nur Häuser im
 * Umkreis (Street View – der Rest bis zum Horizont kostet nur)
 */
export async function collectBuildings(map, pace = NO_PACE, near = null, shops = [], roofs = [], shelters = []) {
  // Dächer auf Pfosten (Street View, aus OSM) zeichnet streetMesh – hier nicht als Klotz
  const roofBoxes = roofs.map((r) => [ringBox(r.ring), r.ring]);
  const isRoof = (c) => roofBoxes.some(([b, ring]) => inBox(c, b) && inRing(c, ring));
  const isShelter = (c) => shelters.some((p) => Math.abs(p[0] - c[0]) < 0.00012 && Math.abs(p[1] - c[1]) < 0.00008);   // ~8 m
  const kx = near ? 111320 * Math.cos((near.point[1] * Math.PI) / 180) : 0;
  const far = near ? (p) => Math.hypot((p[0] - near.point[0]) * kx, (p[1] - near.point[1]) * 111320) > near.radius : () => false;
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
      if (!outer || outer.length < 4 || far(outer[0])) continue;
      if (roofBoxes.length && height <= 10 && isRoof(ringCenter(outer))) continue;
      // Wartehäuschen aus den Kacheln (kleiner Klotz): das Häuschen mit Dach, Bank und Glas steht schon da
      if (shelters.length && height <= 6 && isShelter(ringCenter(outer))) continue;
      const key = `${outer[0]}|${outer.length}|${height}|${min}|${f.properties.hide_3d ? 1 : 0}`;
      if (seen.has(key)) continue;           // gleiche Fläche aus der Nachbarkachel
      seen.add(key);
      const item = { key, rings, height, min, center: ringCenter(outer), box: ringBox(outer), area: Math.abs(areaOf(outer)), n: outer.length,
        // Street View: Farbe aus OSM (building:colour bzw. Material, in den Kacheln „colour“)
        colour: near ? colourOf(f.properties.colour) : null };
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
  // Bodenhöhe je Gruppe: die tiefste Stelle unter dem Umriss, sonst unter allen Stücken zusammen
  const groups = new Map();
  all.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { outline: null, x: 0, y: 0, w: 0, color: null, box: [Infinity, Infinity, -Infinity, -Infinity] });
    const g = groups.get(r);
    if (i >= solids.length) { if (!g.outline || it.area > g.outline.area) g.outline = it; return; }
    g.x += it.center[0] * it.n; g.y += it.center[1] * it.n; g.w += it.n;
    g.box = [Math.min(g.box[0], it.box[0]), Math.min(g.box[1], it.box[1]), Math.max(g.box[2], it.box[2]), Math.max(g.box[3], it.box[3])];
    if (!g.color || it.area > g.colorArea) { g.color = it.center; g.colorArea = it.area; }
  });
  const ground = groundOf(map);
  for (const g of groups.values()) {
    if (pace.due()) await pace.rest();
    const at = g.outline ? g.outline.center : g.w ? [g.x / g.w, g.y / g.w] : null;
    const box = g.outline ? g.outline.box : g.box;
    if (at && Number.isFinite(box[0])) {
      // Mitte und die Ecken des Rechtecks, 15 % nach innen (die Ecken eines L-Hauses lägen sonst auf der Straße)
      const k = 0.15, [x0, y0, x1, y1] = box, dx = (x1 - x0) * k, dy = (y1 - y0) * k;
      g.ground = Math.min(ground(at), ground([x0 + dx, y0 + dy]), ground([x1 - dx, y0 + dy]), ground([x0 + dx, y1 - dy]), ground([x1 - dx, y1 - dy]));
    } else g.ground = at ? ground(at) : 0;
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
  // Street View: ein Geschäft im Haus färbt dessen Erdgeschoss – der niedrigste Körper am Boden, in dem es liegt
  const shopOf = new Map();
  for (const sh of shops) {
    let best = -1;
    for (const j of grid.get(cellOf(sh.point[0], sh.point[1])) ?? []) {
      if (j >= solids.length) continue;
      const o = solids[j];
      if (o.min > 0 || o.height < 2.5 || !inBox(sh.point, o.box) || !inRing(sh.point, o.rings[0])) continue;
      if (best < 0 || o.area < solids[best].area) best = j;
    }
    if (best >= 0 && !shopOf.has(best)) shopOf.set(best, sh.color);
  }
  return solids.map((s, i) => { const g = groups.get(find(i)); return { key: s.key, rings: s.rings, height: s.height, min: s.min, ground: g.ground, tint: g.tint, rank: rank[i], shop: shopOf.get(i) ?? null, colour: s.colour }; });
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
  // Farbe aus OSM (Street View) – leicht mit dem üblichen Ton gemischt, reines Weiß oder Rot wirkt sonst grell
  const own = !sat && hs.colour ? hs.colour.map((v, i) => v * 0.8 + WALLS[hs.tint % 4][i] * 0.2) : null;
  const wall = sat ? SAT_WALL : look(own ?? (high ? WALLS_HIGH[hs.tint % 3] : WALLS[hs.tint % 4]));
  const roof = sat ? SAT_WALL.map((v) => v * 1.08) : look(hs.height >= 25 ? ROOF_HIGH : ROOFS[hs.tint % 4]);
  const zTop = (hs.ground + hs.height) * unit;
  const zEave = (hs.ground + Math.max(hs.min, hs.height - EAVE)) * unit;
  const zBase = (hs.ground + (hs.min > 0 ? hs.min : -SINK)) * unit;
  // Geschäft im Haus (Street View): das Erdgeschoss in der Farbe seiner Art, bis 3,6 m
  // (zu einem Viertel mit der Wand gemischt – sonst leuchten ganze Häuserzeilen)
  const shop = hs.shop ? look(hex(hs.shop).map((v, i) => v * 0.75 + wall[i] * 0.25)) : null;
  const zShop = shop ? (hs.ground + Math.min(SHOP_FLOOR, hs.height - EAVE - 0.3)) * unit : null;
  const band = shop && zShop > zBase;
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
  for (const pts of rings) n += (pts.length / 2) * (band ? 18 : 12);
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
      if (band) {
        const s0 = shop.map((v) => v * shade * 0.9), s1 = shop.map((v) => v * shade);
        put(ax, ay, zBase, 0, 0, s0, 1); put(bx, by, zBase, 0, 0, s0, 1); put(bx, by, zShop, 0, 0, s1, 1);
        put(ax, ay, zBase, 0, 0, s0, 1); put(bx, by, zShop, 0, 0, s1, 1); put(ax, ay, zShop, 0, 0, s1, 1);
      }
      const z0 = band ? zShop : zBase;
      put(ax, ay, z0, 0, 0, lo, 1); put(bx, by, z0, 0, 0, lo, 1); put(bx, by, zEave, 0, 0, hi, 1);
      put(ax, ay, z0, 0, 0, lo, 1); put(bx, by, zEave, 0, 0, hi, 1); put(ax, ay, zEave, 0, 0, hi, 1);
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

/* ── Street View: Haltestellen, Mauern, Dächer auf Pfosten, Bäume ────────── */

/**
 * Sammelt Dreiecke wie houseMesh. `box`: Quader um einen Punkt (Mercator), ausgerichtet nach `dir` (Grad, die
 * Länge u läuft in diese Richtung, die Breite v quer dazu) – Maße in Metern, Höhen über NN. Glas extra (halb
 * durchsichtig gezeichnet). → { box, slab, pack }
 */
function pieces(origin, unit, darkMode) {
  const look = (c) => (darkMode ? dark(c) : c);
  const solid = [], glass = [];
  function box(at, dir, u0, u1, v0, v1, z0, z1, color, out = solid) {
    const a = (dir * Math.PI) / 180, ux = Math.sin(a), uy = Math.cos(a), vx = uy, vy = -ux;
    const cx = mercX(at[0]), cy = mercY(at[1]);
    const pt = (u, v) => [cx + (u * ux + v * vx) * unit, cy - (u * uy + v * vy) * unit];
    const c = [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)];
    const lo = z0 * unit, hi = z1 * unit;
    const col = look(Array.isArray(color) ? color : hex(color));
    const face = (p, q, k) => {
      const c2 = col.map((x) => x * k);
      out.push([p[0], p[1], lo, c2], [q[0], q[1], lo, c2], [q[0], q[1], hi, c2], [p[0], p[1], lo, c2], [q[0], q[1], hi, c2], [p[0], p[1], hi, c2]);
    };
    face(c[0], c[1], 0.8); face(c[1], c[2], 0.92); face(c[2], c[3], 1); face(c[3], c[0], 0.88);
    out.push([...c[0], hi, col], [...c[1], hi, col], [...c[2], hi, col], [...c[0], hi, col], [...c[2], hi, col], [...c[3], hi, col]);
  }
  /** Platte über einem Umriss (Ring [lon, lat]), von z0 bis z1 (m über NN) */
  function slab(ring, z0, z1, color) {
    const pts = ring.slice(0, -1).map(([x, y]) => [mercX(x), mercY(y)]);
    if (pts.length < 3) return;
    const col = look(hex(color));
    const lo = z0 * unit, hi = z1 * unit;
    for (const i of earcut(pts.flat())) solid.push([pts[i][0], pts[i][1], hi, col]);
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i], q = pts[(i + 1) % pts.length], c2 = col.map((x) => x * 0.8);
      solid.push([p[0], p[1], lo, c2], [q[0], q[1], lo, c2], [q[0], q[1], hi, c2], [p[0], p[1], lo, c2], [q[0], q[1], hi, c2], [p[0], p[1], hi, c2]);
    }
  }
  const pack = (list) => {
    const arr = new Float32Array(list.length * 9);
    let o = 0;
    for (const [x, y, z, c] of list) {
      arr[o++] = x - origin.x; arr[o++] = y - origin.y; arr[o++] = z; arr[o++] = 0; arr[o++] = 0;
      arr[o++] = c[0]; arr[o++] = c[1]; arr[o++] = c[2]; arr[o++] = 1;
    }
    return arr;
  };
  return { box, slab, done: () => ({ solid: pack(solid), glass: pack(glass) }), glass };
}

const bearingOf = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
const metersOf = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 111320);

/**
 * Street View: alles außer Häusern → { solid, glass }
 *   stops   { point, dir, away, shelter }  Mast mit gelbem Schild; mit Häuschen (Dach, Bank, Glas) nur bei shelter
 *   walls   { line, height, width }        Mauern und Stadtmauern, Stück für Stück entlang der Linie
 *   roofs   { ring, height }               Dach auf Pfosten (Haltestellen, Unterstände – building=roof)
 *   trees   { point, height, crown? }      Stamm und Krone (zwei gedrehte Quader wirken runder)
 */
function streetMesh({ stops = [], walls = [], roofs = [], trees = [] }, ground, origin, unit, darkMode) {
  const k = pieces(origin, unit, darkMode);
  for (const st of stops) {
    const g = ground(st.point), d = st.dir, s = st.away;
    const v = (a, b) => (s > 0 ? [a, b] : [-b, -a]);       // quer: weg von der Straße
    if (st.shelter) {
      k.box(st.point, d, -1.6, 1.6, ...v(0.5, 1.9), g + 2.4, g + 2.52, '#4a4f57');           // Dach
      for (const u of [-1.5, 1.44]) for (const w of [0.6, 1.76]) k.box(st.point, d, u, u + 0.06, ...v(w, w + 0.06), g, g + 2.4, '#5b616a');
      k.box(st.point, d, -1.0, 1.0, ...v(1.35, 1.7), g + 0.45, g + 0.5, '#6b5b4b');           // Bank
      k.box(st.point, d, -1.44, 1.44, ...v(1.77, 1.8), g + 0.1, g + 2.35, '#b9d7e6', k.glass);
      k.box(st.point, d, -1.5, -1.47, ...v(0.66, 1.76), g + 0.1, g + 2.35, '#b9d7e6', k.glass);
      k.box(st.point, d, 1.47, 1.5, ...v(0.66, 1.76), g + 0.1, g + 2.35, '#b9d7e6', k.glass);
    }
    const u = st.shelter ? 2.1 : 0;
    k.box(st.point, d, u, u + 0.08, ...v(0.3, 0.38), g - SINK, g + 2.9, '#7a7f87');          // Mast
    k.box(st.point, d, u - 0.25, u + 0.33, ...v(0.3, 0.36), g + 2.35, g + 2.9, '#f2c230');   // Schild
  }
  for (const w of walls) {
    const color = w.height >= 4 ? '#a8957a' : '#9c9488';
    for (let i = 1; i < w.line.length; i += 1) {
      const a = w.line[i - 1], b = w.line[i], len = metersOf(a, b);
      if (len < 0.05) continue;
      const g = Math.min(ground(a), ground(b));
      k.box(a, bearingOf(a, b), 0, len, -w.width / 2, w.width / 2, g - SINK, g + w.height, color);
    }
  }
  for (const r of roofs) {
    const g = Math.min(...r.ring.slice(0, 4).map((p) => ground(p)));
    k.slab(r.ring, g + r.height - 0.25, g + r.height, '#6f747c');
    // Pfosten an den Ecken (höchstens acht)
    const n = r.ring.length - 1, step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) k.box(r.ring[i], 0, -0.06, 0.06, -0.06, 0.06, g - SINK, g + r.height - 0.2, '#7a7f87');
  }
  for (const t of trees) {
    // Krone: Durchmesser aus OSM, sonst 0,4 × Höhe (höchstens 6 m) – ab halber Höhe
    const g = ground(t.point), h = t.height, c = Math.min(t.crown || h * 0.4, 6) / 2;
    const tone = TREE_GREEN[tint(t.point) % TREE_GREEN.length];
    k.box(t.point, 0, -0.12, 0.12, -0.12, 0.12, g - SINK, g + h * 0.6, '#6b5440');
    k.box(t.point, 0, -c, c, -c, c, g + h * 0.5, g + h, tone);
    k.box(t.point, 45, -c * 0.85, c * 0.85, -c * 0.85, c * 0.85, g + h * 0.55, g + h * 0.95, tone.map((x) => x * 0.9));
  }
  return k.done();
}
const TREE_GREEN = ['#4f7f3c', '#5c8a43', '#466f36', '#6a8f45'].map(hex);

/**
 * Alle Häuser → { data: Float32Array, next: Zwischenspeicher }. Ein Haus, das schon im Zwischenspeicher liegt
 * (gleiche Fläche, Bodenhöhe, Rang, Farbe), wird übernommen statt neu gerechnet.
 */
async function buildMesh(houses, origin, opts, cache = new Map(), pace = NO_PACE, street = null) {
  const unit = origin.meterInMercatorCoordinateUnits();
  const next = new Map();
  const parts = [];
  let total = 0;
  // Glas kommt ans Ende – es wird nach allem anderen halb durchsichtig gezeichnet
  const glass = [];
  let glassTotal = 0;
  if (street) {
    const m = streetMesh(street.things, street.ground, origin, unit, opts.darkMode);
    parts.push(m.solid); total += m.solid.length;
    glass.push(m.glass); glassTotal += m.glass.length;
  }
  for (const hs of houses) {
    if (pace.due()) await pace.rest();
    const key = `${hs.key}|${hs.ground.toFixed(2)}|${hs.rank}|${hs.tint}|${hs.shop ?? ''}|${hs.colour ?? ''}`;
    const part = cache.get(key) ?? next.get(key) ?? houseMesh(hs, origin, unit, opts);
    next.set(key, part);
    parts.push(part);
    total += part.length;
  }
  const data = new Float32Array(total + glassTotal);
  let o = 0;
  for (const p of [...parts, ...glass]) { data.set(p, o); o += p.length; }
  return { data, next, glass: glassTotal / 9 };
}

/* ── Steht ein Punkt in einem Haus? (Street View geht nicht hinein) ──────── */

/**
 * Grundrisse im Raster (Zellen von etwa 35 m) → (Punkt) → im Haus? Nur Häuser, die am Boden stehen und höher
 * als 2 m sind – Brückenteile, Dächer über Durchfahrten (render_min_height) und Mauern zählen nicht.
 */
function houseIndex(houses) {
  const CELL = 0.0005;
  const grid = new Map();
  for (const h of houses) {
    if (h.min > 0 || h.height < 2) continue;
    const b = ringBox(h.rings[0]);
    for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x += 1) {
      for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y += 1) {
        const c = x * 1e6 + y;
        const list = grid.get(c);
        if (list) list.push([b, h.rings]); else grid.set(c, [[b, h.rings]]);
      }
    }
  }
  return (p) => (grid.get(Math.floor(p[0] / CELL) * 1e6 + Math.floor(p[1] / CELL)) ?? [])
    .some(([b, rings]) => inBox(p, b) && inRing(p, rings[0]) && !rings.slice(1).some((hole) => inRing(p, hole)));
}

/* ── Die Ebene ──────────────────────────────────────────────────────────── */

/**
 * Häuser selbst zeichnen und MapLibres 3D-Häuser („building-3d“, „building-roof“) ausblenden.
 * `darkMode()`: dunkles Design? → { setSat(an, Quellen der Satellitenkarte), rebuild, inside(Punkt) }
 */
export function mountBuildings(map, { darkMode = () => false } = {}) {
  let gl = null, prog = null, buf = null, texture = null;
  let count = 0, glassCount = 0, origin = null, hasTex = false;
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
        matrix: gl.getUniformLocation(prog, 'u_matrix'), tex: gl.getUniformLocation(prog, 'u_tex'), hasTex: gl.getUniformLocation(prog, 'u_hasTex'), alpha: gl.getUniformLocation(prog, 'u_alpha'),
      };
      buf = gl.createBuffer();
      texture = gl.createTexture();
      // Bis das Luftbild da ist ein Pixel – eine leere Textur meldet WebGL bei jedem Bild als Fehler
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 170, 170, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
      gl.uniform1f(loc.alpha, 1);
      gl.drawArrays(gl.TRIANGLES, 0, count - glassCount);
      // Glas der Wartehäuschen zuletzt, halb durchsichtig – schreibt keine Tiefe, dahinter bleibt sichtbar
      if (glassCount) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(loc.alpha, 0.3);
        gl.drawArrays(gl.TRIANGLES, count - glassCount, glassCount);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      gl.disableVertexAttribArray(loc.pos); gl.disableVertexAttribArray(loc.uv); gl.disableVertexAttribArray(loc.color);
    },
    onRemove() {
      gl?.deleteBuffer(buf);
      gl?.deleteTexture(texture);
      gl?.deleteProgram(prog);
      gl = null; count = 0;
    },
  };

  function upload(data, at, glass = 0) {
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    count = data.length / 9;
    glassCount = glass;
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
  let inside = () => false;               // Grundrisse vom letzten Bau
  let focus = null;                       // Street View: { point, radius } – nur Häuser im Umkreis
  // Street View: Geschäfte (Erdgeschoss färben), Haltestellen, Mauern, Dächer auf Pfosten, Bäume
  const NONE = { shops: [], stops: [], walls: [], roofs: [], trees: [], key: '' };
  let things = NONE;
  let mapStops = 0;                       // 3D-Karte: so viele Haltestellen stehen (Tests)
  async function make(o) {
    const mine = ++gen;
    const pace = pacer(() => mine === gen && !!gl);
    const opts = { sat, darkMode: darkMode(), tex: sat && hasTex ? tex : null };
    const zone = new maplibregl.MercatorCoordinate(Math.floor(o.x * 1024) / 1024, Math.floor(o.y * 1024) / 1024, 0);
    const look = `${zone.x}|${zone.y}|${opts.sat}|${opts.darkMode}|${opts.tex ? `${tex.z}|${tex.x0}|${tex.y0}` : ''}`;
    if (look !== cacheFor) { cache = new Map(); cacheFor = look; }
    try {
      // 3D-Karte nah dran: Haltestellen aus den Kacheln wie in Street View (ohne Overpass)
      let stops = null;
      if (!focus && map.getZoom() >= STOP_ZOOM) {
        const c = map.getCenter().toArray();
        const { raw, shelters } = scanStops(map, c, STOP_R);
        stops = placeStops(map, raw, shelters, c, STOP_R).filter((x) => x.dir != null);
      }
      mapStops = stops?.length ?? 0;
      const shown = focus ? things.stops : stops ?? [];
      const houses = await collectBuildings(map, pace, focus, focus ? things.shops : [], focus ? things.roofs : [],
        shown.filter((x) => x.shelter).map((x) => x.point));
      inside = houseIndex(houses);
      const street = focus ? { things, ground: groundOf(map) }
        : stops?.length ? { things: { ...NONE, stops }, ground: groundOf(map) } : null;
      const { data, next, glass } = await buildMesh(houses, zone, opts, cache, pace, street);
      if (mine !== gen || look !== cacheFor) return;
      cache = next;
      upload(data, zone, glass);
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
    // Street View: Umkreis 250 m – neu erst nach 100 m Weg
    const walked = built?.fp && focus ? Math.hypot((focus.point[0] - built.fp[0]) * 71000, (focus.point[1] - built.fp[1]) * 111320) : Infinity;
    const stopsSwitch = built && (zoom >= STOP_ZOOM) !== (built.zoom >= STOP_ZOOM);
    if (!force && built && !stopsSwitch && (focus ? walked < 100 : Math.abs(zoom - built.zoom) < 0.5 && px < 200)) return;
    built = { x: o.x, y: o.y, zoom, fp: focus ? [...focus.point] : null };
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
    /** Steht der Punkt [lon, lat] in einem Haus? (aus dem letzten Bau) */
    inside: (p) => inside(p),
    /** Street View: nur Häuser im Umkreis ({ point: [lon, lat], radius: m }), null: alle. Gilt ab dem nächsten Bau;
     *  der Punkt darf sich danach ändern (wird gelesen, nicht kopiert) */
    setFocus(f) { const was = !!focus; focus = f; if (!f) things = NONE; if (was !== !!f) { built = null; schedule(true); } },
    /** Street View: Geschäfte ({ point, color } – ihr Haus bekommt ein farbiges Erdgeschoss) und Wartehäuschen
     *  ({ point, dir, away }) – neu gebaut nur, wenn sich etwas geändert hat */
    /** Was gerade steht: { stops, shelters, walls, roofs, trees } (Tests) */
    thingCount: () => ({ stops: things.stops.length, shelters: things.stops.filter((x) => x.shelter).length,
      walls: things.walls.length, roofs: things.roofs.length, trees: things.trees.length, mapStops }),
    /** Street View: Geschäfte ({ point, color }) und was aus Overpass kommt (`details`: { id, walls, roofs, trees })
     *  – neu gebaut nur, wenn sich etwas geändert hat */
    setStreetThings({ shops = [], stops = [], details = null } = {}) {
      const key = JSON.stringify([shops.map((x) => [x.point, x.color]), stops.map((x) => [x.point, Math.round(x.dir), x.away, !!x.shelter]), details?.id ?? '']);
      if (key === things.key) return;
      things = { shops, stops, walls: details?.walls ?? [], roofs: details?.roofs ?? [], trees: details?.trees ?? [], key };
      if (focus) schedule(true);
    },
  };
}
