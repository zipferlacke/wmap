/**
 * Gebäude im Satellitenmodus: graue, deckende Wände – und auf dem Dach das
 * Luftbild, so wie es von oben aussieht. MapLibre kann einer 3D-Fläche nur
 * eine Farbe geben; darum zeichnet diese eigene WebGL-Ebene die Häuser
 * selbst und blendet die normalen 3D-Gebäude so lange aus.
 *
 *   Häuser   Umriss und Höhe aus den Vektorkacheln (OpenMapTiles „building“,
 *            render_height/render_min_height), auf dem Gelände stehend
 *   Wände    grau, je nach Himmelsrichtung heller oder dunkler
 *   Dächer   auf Dachhöhe, belegt mit den Luftbild-Kacheln des Ausschnitts
 *            (dieselben Quellen wie die Satellitenkarte: amtliche Luftbilder
 *            der Länder, sonst Sentinel-2)
 *
 * Pro Bild wird nichts gerechnet: Häuser und Luftbild liegen fertig auf der
 * Grafikkarte, jedes Bild ist ein Zeichenaufruf. Neu gebaut wird nur, wenn
 * sich Ort oder Zoom merklich ändern oder Kacheln nachkommen – Drehen und
 * Neigen nicht. Das Luftbild ist ein fester Block aus 8×8 Kacheln um die
 * Mitte; es wird erst ersetzt, wenn die Mitte ihn verlässt, und bis das
 * neue da ist, bleibt das alte. Ebenen-Menü → Satellit schaltet sie an.
 */
import earcut from '../libs/earcut/earcut.js';

const ID = 'sat-buildings';
const MIN_ZOOM = 14.5;
const TILE = 256;
const MAX_TEX = 2048;                     // höchstens 8×8 Kacheln – Speicher und Abrufe klein
const WALL = [0.66, 0.67, 0.69];         // Grau der Wände

const VERT = `
attribute vec3 a_pos; attribute vec2 a_uv; attribute float a_shade;
uniform mat4 u_matrix;
varying vec2 v_uv; varying float v_shade;
void main() { v_uv = a_uv; v_shade = a_shade; gl_Position = u_matrix * vec4(a_pos, 1.0); }`;
const FRAG = `
precision mediump float;
uniform sampler2D u_tex; uniform float u_hasTex; uniform vec3 u_wall;
varying vec2 v_uv; varying float v_shade;
void main() {
  if (v_shade < 0.0) {
    // Dach: Luftbild, außerhalb der Textur ein helles Grau
    bool inside = u_hasTex > 0.5 && v_uv.x >= 0.0 && v_uv.x <= 1.0 && v_uv.y >= 0.0 && v_uv.y <= 1.0;
    gl_FragColor = inside ? vec4(texture2D(u_tex, v_uv).rgb, 1.0) : vec4(u_wall * 1.08, 1.0);
  } else {
    gl_FragColor = vec4(u_wall * v_shade, 1.0);
  }
}`;

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

/* ── Häuser als Dreiecke ────────────────────────────────────────────────── */

/**
 * → Float32Array: je Ecke x, y, z (relativ zum Ursprung), u, v, shade
 *   shade < 0: Dach (Textur), sonst Helligkeit der Wand
 */
function buildMesh(map, origin, tex) {
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
  const seen = new Set();
  const out = [];
  const unit = origin.meterInMercatorCoordinateUnits();
  const uv = (m) => (tex ? [(m.x - tex.x0) / (tex.x1 - tex.x0), (m.y - tex.y0) / (tex.y1 - tex.y0)] : [-1, -1]);
  const push = (m, zm, u, v, shade) => out.push(m.x - origin.x, m.y - origin.y, zm, u, v, shade);
  for (const f of feats) {
    if (f.properties.hide_3d) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    const height = Math.max(3, Number(f.properties.render_height) || 6);
    const min = Number(f.properties.render_min_height) || 0;
    for (const rings of polys) {
      const key = `${rings[0][0]}|${rings[0].length}|${height}`;
      if (seen.has(key)) continue;           // gleiche Fläche aus der Nachbarkachel
      seen.add(key);
      const outer = rings[0];
      const c = outer[Math.floor(outer.length / 2)];
      // Auf dem Gelände: wie die normalen 3D-Gebäude den Sockel etwas versenken
      const ground = map.queryTerrainElevation?.(c) ?? 0;
      const zTop = (ground + height) * unit;
      const zBase = (ground + (min > 0 ? min : -10)) * unit;
      const flat = [];
      const holes = [];
      const ms = [];
      for (const ring of rings) {
        if (flat.length) holes.push(flat.length / 2);
        for (const p of ring.slice(0, -1)) {
          const m = merc(p[0], p[1]);
          ms.push(m);
          flat.push(m.x, m.y);
        }
        // Wände: je Kante ein Rechteck aus zwei Dreiecken
        for (let i = 0; i < ring.length - 1; i += 1) {
          const a = merc(ring[i][0], ring[i][1]), b = merc(ring[i + 1][0], ring[i + 1][1]);
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          // Licht von Nordwesten: Wände dorthin hell, nach Südosten dunkel
          const shade = 0.78 + 0.2 * ((dy / len) * -0.7 + (dx / len) * -0.7);
          push(a, zBase, 0, 0, shade); push(b, zBase, 0, 0, shade); push(b, zTop, 0, 0, shade);
          push(a, zBase, 0, 0, shade); push(b, zTop, 0, 0, shade); push(a, zTop, 0, 0, shade);
        }
      }
      // Dach: Fläche auf Dachhöhe mit dem Luftbild
      const tris = earcut(flat, holes);
      for (const i of tris) {
        const m = ms[i];
        const [u, v] = uv(m);
        push(m, zTop, u, v, -1);
      }
    }
  }
  return new Float32Array(out);
}

/* ── Die Ebene ──────────────────────────────────────────────────────────── */

export function mountSatBuildings(map, { sources }) {
  let on = false;
  let gl = null, prog = null, buf = null, texture = null;
  let count = 0, origin = null, hasTex = false;
  let loc = {};
  let ctl = null, timer = null;
  let tex = null;                         // Mercator-Bereich der Textur

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
        pos: gl.getAttribLocation(prog, 'a_pos'), uv: gl.getAttribLocation(prog, 'a_uv'), shade: gl.getAttribLocation(prog, 'a_shade'),
        matrix: gl.getUniformLocation(prog, 'u_matrix'), tex: gl.getUniformLocation(prog, 'u_tex'),
        hasTex: gl.getUniformLocation(prog, 'u_hasTex'), wall: gl.getUniformLocation(prog, 'u_wall'),
      };
      buf = gl.createBuffer();
      texture = gl.createTexture();
    },
    render(context, args) {
      if (!count || !origin || map.getZoom() < MIN_ZOOM - 0.5) return;
      // Matrix · Verschiebung zum Ursprung – so bleiben die Ecken genau (Float32)
      const M = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix;
      const m = Array.from(M);
      const [ox, oy] = [origin.x, origin.y];
      for (let r = 0; r < 4; r += 1) m[12 + r] += m[r] * ox + m[4 + r] * oy;
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.matrix, false, new Float32Array(m));
      gl.uniform3fv(loc.wall, WALL);
      gl.uniform1f(loc.hasTex, hasTex ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(loc.tex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const stride = 6 * 4;
      gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(loc.shade); gl.vertexAttribPointer(loc.shade, 1, gl.FLOAT, false, stride, 20);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.disableVertexAttribArray(loc.pos); gl.disableVertexAttribArray(loc.uv); gl.disableVertexAttribArray(loc.shade);
    },
    onRemove() {
      gl?.deleteBuffer(buf);
      gl?.deleteTexture(texture);
      gl?.deleteProgram(prog);
      gl = null; count = 0;
    },
  };

  function upload(data) {
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    count = data.length / 6;
    map.triggerRepaint();
  }

  let built = null;                       // wo und bei welchem Zoom zuletzt gebaut

  /**
   * Häuser neu bauen – nur, wenn sich Ort oder Zoom wirklich geändert haben
   * (oder Kacheln nachkamen: force). Drehen und Neigen ändern nichts: Die
   * Häuser liegen fertig auf der Grafikkarte, das Luftbild hängt an festen
   * Kacheln, nicht am Bildschirm.
   */
  async function rebuild({ force = false } = {}) {
    if (!on || !gl || map.getZoom() < MIN_ZOOM) { count = 0; built = null; map.triggerRepaint(); return; }
    const c = map.getCenter();
    const o = merc(c.lng, c.lat);
    const zoom = map.getZoom();
    const px = built ? Math.hypot(o.x - built.x, o.y - built.y) * 512 * 2 ** zoom : Infinity;
    if (!force && built && Math.abs(zoom - built.zoom) < 0.5 && px < 200) return;
    built = { x: o.x, y: o.y, zoom };
    origin = o;
    // Luftbild: fester Block aus 8×8 Kacheln um die Mitte
    const z = Math.min(18, Math.max(15, Math.round(zoom) + 1));
    const n = 2 ** z;
    const cx = Math.floor(o.x * n), cy = Math.floor(o.y * n);
    const half = MAX_TEX / TILE / 2;
    const x0 = cx - half + 1, x1 = cx + half, y0 = cy - half + 1, y1 = cy + half;
    const area = { x0: x0 / n, x1: (x1 + 1) / n, y0: y0 / n, y1: (y1 + 1) / n };
    // Die Mitte liegt noch gut im alten Block? Dann bleibt er
    const inner = (v, a, b) => v > a + (b - a) * 0.2 && v < b - (b - a) * 0.2;
    const covered = tex && hasTex && tex.z === z && inner(o.x, tex.x0, tex.x1) && inner(o.y, tex.y0, tex.y1);
    // Sofort mit dem Luftbild, das schon da ist – kein graues Zwischenbild
    upload(buildMesh(map, origin, hasTex ? tex : null));
    if (covered) return;
    ctl?.abort();
    ctl = new AbortController();
    const canvas = await paintTexture(sources, z, x0, x1, y0, y1, ctl.signal);
    if (!canvas || !gl || !on) return;
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
    upload(buildMesh(map, origin, tex));
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 250); };
  map.on('moveend', () => { if (on) schedule(); });
  // Kommen Gebäude- oder Geländekacheln nach (genauere Zoomstufe), sobald die
  // Karte fertig geladen hat neu bauen – ohne dass man sie bewegen muss
  let dirty = false;
  map.on('sourcedata', (e) => { if (on && e.tile && /^(openmaptiles|terrain)$/.test(e.sourceId)) dirty = true; });
  map.on('idle', () => { if (on && dirty) { dirty = false; clearTimeout(timer); timer = setTimeout(() => rebuild({ force: true }), 250); } });

  const extrusions = () => map.getStyle().layers.filter((l) => l.type === 'fill-extrusion').map((l) => l.id);

  return {
    set(value) {
      if (value === on) return;
      on = value;
      if (on) {
        const first = extrusions()[0];
        if (!map.getLayer(ID)) map.addLayer(layer, first);
        for (const id of extrusions()) map.setLayoutProperty(id, 'visibility', 'none');
        schedule();
      } else {
        ctl?.abort();
        if (map.getLayer(ID)) map.removeLayer(ID);
        for (const id of extrusions()) map.setLayoutProperty(id, 'visibility', 'visible');
        tex = null; hasTex = false; built = null;
      }
    },
  };
}
