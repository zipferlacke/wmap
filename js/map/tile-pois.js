/**
 * Orte direkt aus den Vektorkacheln der Karte – ohne Overpass, also in
 * Bruchteilen einer Sekunde (und dank Service Worker oft ganz ohne Netz).
 *
 * Die Kacheln (OpenMapTiles-Schema, Zoom 14) führen Parkplätze, Tankstellen,
 * Läden, Lokale usw. als Punkte in der Ebene „poi“ mit `class`/`subclass`
 * (= OSM-Wert) und der OSM-ID (osm_id·10 + Typ). Flächen, Flüsse und seltene
 * Kategorien kennen sie nicht – die ergänzt weiter Overpass.
 *
 * Kacheln sind Protocol Buffers; gelesen wird nur, was wir brauchen: die
 * Ebene „poi“ mit ihren Punkten. Dafür reicht ein kleiner eigener Leser.
 */
import { tilesAlong } from '../data/offline.js';

const Z = 14;
const MAX_TILES = 64;
const cache = new Map();           // "x/y" → [{ id, props, point }]

/* ── Protocol-Buffer-Leser (nur was Vektorkacheln brauchen) ───────────────── */

function varint(b, p) {
  let v = 0, shift = 0, byte;
  do {
    byte = b[p.i++];
    v += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte >= 0x80);
  return v;
}

/** Alle Felder einer Nachricht: [feld, typ, wert | [start, ende]] */
function* fields(b, start, end) {
  const p = { i: start };
  while (p.i < end) {
    const key = varint(b, p);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) yield [field, wire, varint(b, p)];
    else if (wire === 2) { const len = varint(b, p); yield [field, wire, [p.i, p.i + len]]; p.i += len; }
    else if (wire === 5) { yield [field, wire, p.i]; p.i += 4; }
    else if (wire === 1) { yield [field, wire, p.i]; p.i += 8; }
    else throw new Error('Kachel: unbekannter Feldtyp');
  }
}

const utf8 = new TextDecoder();
const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

function readValue(b, [s, e], view) {
  for (const [f, , v] of fields(b, s, e)) {
    if (f === 1) return utf8.decode(b.subarray(v[0], v[1]));
    if (f === 2) return view.getFloat32(v, true);
    if (f === 3) return view.getFloat64(v, true);
    if (f === 4 || f === 5) return v;
    if (f === 6) return zigzag(v);
    if (f === 7) return !!v;
  }
  return null;
}

function packed(b, [s, e]) {
  const out = [];
  const p = { i: s };
  while (p.i < e) out.push(varint(b, p));
  return out;
}

/** Punkte der Ebene „poi“ einer Kachel → [{ id, props, point: [lon, lat] }] */
function decodePois(buf, x, y) {
  const b = new Uint8Array(buf);
  const view = new DataView(buf);
  const out = [];
  for (const [f, , range] of fields(b, 0, b.length)) {
    if (f !== 3) continue;                          // Tile.layers
    let name = '', extent = 4096;
    const keys = [], values = [], feats = [];
    for (const [lf, , lv] of fields(b, range[0], range[1])) {
      if (lf === 1) name = utf8.decode(b.subarray(lv[0], lv[1]));
      else if (lf === 2) feats.push(lv);
      else if (lf === 3) keys.push(utf8.decode(b.subarray(lv[0], lv[1])));
      else if (lf === 4) values.push(lv);
      else if (lf === 5) extent = lv;
    }
    if (name !== 'poi') continue;
    const vals = values.map((r) => readValue(b, r, view));
    const n = 2 ** Z;
    for (const fr of feats) {
      let id = 0, tags = [], type = 0, geom = [];
      for (const [ff, , fv] of fields(b, fr[0], fr[1])) {
        if (ff === 1) id = fv;
        else if (ff === 2) tags = packed(b, fv);
        else if (ff === 3) type = fv;
        else if (ff === 4) geom = packed(b, fv);
      }
      if (type !== 1 || geom.length < 3) continue;  // nur Punkte
      const px = zigzag(geom[1]), py = zigzag(geom[2]);
      const lon = ((x + px / extent) / n) * 360 - 180;
      const m = Math.PI - (2 * Math.PI * (y + py / extent)) / n;
      const lat = (Math.atan(Math.sinh(m)) * 180) / Math.PI;
      const props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      out.push({ id, props, point: [lon, lat] });
    }
  }
  return out;
}

/* ── Kacheln holen ────────────────────────────────────────────────────────── */

function tileRange([w, s, e, n]) {
  const size = 2 ** Z;
  const tx = (lon) => Math.floor(((lon + 180) / 360) * size);
  const ty = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size);
  };
  const out = [];
  for (let x = tx(w); x <= tx(e); x += 1) for (let y = ty(n); y <= ty(s); y += 1) out.push([Z, x, y]);
  return out;
}

async function loadTiles(template, tiles, signal) {
  const all = [];
  let i = 0;
  const worker = async () => {
    while (i < tiles.length) {
      const [z, x, y] = tiles[i++];
      const key = `${x}/${y}`;
      if (!cache.has(key)) {
        const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        try {
          const res = await fetch(url, { signal });
          cache.set(key, res.ok ? decodePois(await res.arrayBuffer(), x, y) : []);
          if (cache.size > 400) cache.delete(cache.keys().next().value);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          continue;
        }
      }
      all.push(...cache.get(key));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return all;
}

/**
 * Alle Kachel-Punkte in einem Rechteck [w, s, e, n].
 * → [{ id, props, point }] – oder [], wenn der Bereich zu groß ist
 */
export async function poisInBounds(map, bounds, { signal } = {}) {
  const template = map.getSource('openmaptiles')?.tiles?.[0];
  if (!template) return [];
  const tiles = tileRange(bounds);
  // Ganz Deutschland aus Kacheln lesen wäre zu viel – dann bleibt es bei Overpass
  if (tiles.length > MAX_TILES) return [];
  const [w, s, e, n] = bounds;
  return (await loadTiles(template, tiles, signal))
    .filter(({ point: [x, y] }) => x >= w && x <= e && y >= s && y <= n);
}

/** Kachel-Punkte im Korridor um eine Linie (Route). */
export async function poisAlong(map, coords, radius, { signal, maxTiles = 600 } = {}) {
  const template = map.getSource('openmaptiles')?.tiles?.[0];
  if (!template) return [];
  const tiles = tilesAlong(coords, [Z], () => radius);
  if (tiles.length > maxTiles) return [];
  return loadTiles(template, tiles, signal);
}
