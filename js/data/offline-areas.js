/**
 * Offline-Gebiete: ein Stück Karte – Rechteck oder freie Form – ganz auf dem
 * Gerät, bis man es löscht. Anders als die Karten für die Navigation (nach
 * 10 Tagen weg) bleiben sie und lassen sich neu laden.
 *
 *   Liste         localStorage „wmap.areas“: Name, Form, Detail, Größe, Stand
 *   Kacheln       Cache „wmap-area-<id>-<Zeit>“ – sw.js liefert daraus, auch
 *                 wenn OpenFreeMap inzwischen eine neue Kartenversion hat
 *   Laden         in Stapeln über den Service Worker; bricht es ab (Seite zu,
 *                 Netz weg), geht es mit „Weiter laden“ dort weiter
 *
 * Vektorkacheln bis Zoom 14 (darüber vergrößert MapLibre selbst), dazu Stil,
 * Schriften und Symbole. Auf Wunsch das Gelände (Schummerung, 3D) bis Zoom 13
 * – das reicht auch für die Navigation (terrain-lo).
 */
import { local } from './store.js';
import { tileXY, styleAssets } from './offline.js';
import { STYLE_URL, TERRAIN_TILES } from '../core/config.js';

const KEY = 'wmap.areas';
const PREFIX = 'wmap-area-';
const BATCH = 120;
export const DETAIL = {
  full: { label: 'Alles – Straßen, Wege, Häuser', maxZoom: 14 },
  overview: { label: 'Übersicht – Orte und große Straßen', maxZoom: 11 },
};
const TERRAIN_MAX = 13;
/** Mehr Kacheln lädt ein Gebiet nicht – etwa 1–2 GB */
export const MAX_TILES = 60000;
/** Stil, Schriften, Symbole – einmal je Gebiet, grob */
const ASSET_BYTES = 8e5;

/* ── Liste ────────────────────────────────────────────────────────────────── */

export const areas = {
  all: () => local.get(KEY, []),
  get: (id) => areas.all().find((a) => a.id === id) ?? null,
  put(a) {
    const list = areas.all();
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) list[i] = a; else list.unshift(a);
    local.set(KEY, list);
    return a;
  },
  async remove(id) {
    const a = areas.get(id);
    for (const c of [a?.cache, a?.oldCache]) if (c) await caches.delete(c).catch(() => {});
    local.set(KEY, areas.all().filter((x) => x.id !== id));
  },
  /** Zusammen belegt (gemessen beim Laden) */
  bytes: () => areas.all().reduce((s, a) => s + (a.bytes || 0), 0),
};

export function newArea({ name, ring, detail = 'full', terrain = false }) {
  return { id: Math.random().toString(36).slice(2, 10), name, ring, detail, terrain, status: 'new', bytes: 0, tiles: 0, at: 0 };
}

/* ── Welche Kacheln liegen in der Form? ───────────────────────────────────── */

/** Punkt in Polygon (Ring in Kachelkoordinaten) */
function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Schneidet die Strecke a–b das Quadrat [x, x+1] × [y, y+1]? (Liang–Barsky) */
function crosses([ax, ay], [bx, by], x, y) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x], [dx, x + 1 - ax], [-dy, ay - y], [dy, y + 1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/**
 * Kacheln [z, x, y] einer Zoomstufe, die die Form berühren.
 * `limit`: vorher abbrechen, wenn es mehr werden (→ null)
 */
function tilesAt(ring, z, limit = Infinity) {
  const n = 2 ** z;
  const r = ring.map((p) => tileXY(p, z));
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(n - 1, Math.floor(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(n - 1, Math.floor(Math.max(...ys)));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > limit * 4) return null;
  const out = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const hit = inside([x + 0.5, y + 0.5], r)
        || r.some(([px, py]) => px >= x && px <= x + 1 && py >= y && py <= y + 1)
        || r.some((p, i) => crosses(p, r[(i + 1) % r.length], x, y));
      if (hit) { out.push([z, x, y]); if (out.length > limit) return null; }
    }
  }
  return out;
}

/** Alle Kacheln des Gebiets → { vector: [[z,x,y]], terrain: [[z,x,y]] } oder null, wenn zu groß */
export function tilesOf({ ring, detail, terrain }) {
  const vector = [];
  for (let z = 0; z <= DETAIL[detail].maxZoom; z += 1) {
    const t = tilesAt(ring, z, MAX_TILES - vector.length);
    if (!t) return null;
    vector.push(...t);
  }
  const dem = [];
  // Gelände: 512er-Kacheln, eine Stufe gröber als Vektorkacheln gleicher Fläche
  if (terrain) for (let z = 0; z <= TERRAIN_MAX; z += 1) dem.push(...(tilesAt(ring, z) ?? []));
  if (vector.length + dem.length > MAX_TILES) return null;
  return { vector, terrain: dem };
}

/* ── Größe schätzen: ein paar Kacheln wirklich laden ──────────────────────── */

const fill = (template, [z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** Stichprobe: Gleichmäßig verteilte Kacheln einer Liste */
function sample(list, count) {
  if (list.length <= count) return list;
  return Array.from({ length: count }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / count)]);
}

async function avgBytes(urls, signal) {
  const sizes = await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u, { signal });
      return res.ok ? (await res.arrayBuffer()).byteLength : 0;
    } catch (err) { if (err.name === 'AbortError') throw err; return null; }
  }));
  const ok = sizes.filter((s) => s !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

/**
 * Wie groß wird das Gebiet? Lädt eine Stichprobe (landet ohnehin im Cache)
 * und rechnet hoch – in der Stadt sind Kacheln viel größer als auf dem Land.
 * → { tiles, bytes } oder null (zu groß)
 */
export async function estimate(map, area, { signal } = {}) {
  const t = tilesOf(area);
  if (!t) return null;
  const { template } = styleAssets(map);
  let bytes = ASSET_BYTES;
  // Je Zoomstufe den Schnitt der nächsten gemessenen Stufe
  const maxZ = DETAIL[area.detail].maxZoom;
  const probes = [maxZ, maxZ - 2, maxZ - 4].filter((z) => z >= 0);
  const avg = {};
  for (const z of probes) {
    const at = t.vector.filter((k) => k[0] === z);
    avg[z] = await avgBytes(sample(at, 6).map((k) => fill(template, k)), signal) ?? 25000;
  }
  for (const [z] of t.vector) bytes += avg[probes.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a))];
  if (t.terrain.length) {
    const top = t.terrain.filter((k) => k[0] === TERRAIN_MAX);
    const dem = await avgBytes(sample(top, 4).map((k) => fill(TERRAIN_TILES, k)), signal) ?? 150000;
    bytes += t.terrain.length * dem;
  }
  return { tiles: t.vector.length + t.terrain.length, bytes };
}

/* ── Laden ────────────────────────────────────────────────────────────────── */

function send(reg, cache, urls) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = ({ data }) => resolve(data);
    reg.active.postMessage({ type: 'area', cache, urls }, [ch.port2]);
  });
}

/**
 * Gebiet laden. `fresh`: in einen neuen Cache, der alte weicht erst am Ende
 * (so bleibt das Gebiet offline nutzbar, während es neu lädt).
 * onProgress({ done, total, bytes }); Abbruch über `signal`.
 */
export async function download(map, area, { fresh = false, onProgress, signal } = {}) {
  if (!('serviceWorker' in navigator)) throw new Error('Offline-Karten gehen in diesem Browser nicht');
  const reg = await navigator.serviceWorker.ready;
  const t = tilesOf(area);
  if (!t) throw new Error('Das Gebiet ist zu groß');
  const { template, urls: assets } = styleAssets(map);
  if (!template) throw new Error('Karte noch nicht geladen');
  const tilejson = map.getStyle().sources?.openmaptiles?.url;
  const urls = [STYLE_URL, ...(tilejson ? [tilejson] : []), ...assets,
    ...t.vector.map((k) => fill(template, k)), ...t.terrain.map((k) => fill(TERRAIN_TILES, k))];

  // Der Browser soll die Karten nicht bei Platzmangel still wegräumen
  navigator.storage?.persist?.().catch(() => {});
  // Beim Neuladen bleibt der alte Cache, bis der neue fertig ist
  const cache = fresh || !area.cache ? `${PREFIX}${area.id}-${Date.now()}` : area.cache;
  const oldCache = area.cache && area.cache !== cache ? area.cache : area.oldCache ?? null;
  areas.put({ ...area, cache, oldCache, status: 'loading' });

  let bytes = 0, failed = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    if (signal?.aborted) break;
    const r = await send(reg, cache, urls.slice(i, i + BATCH));
    bytes += r.bytes;
    failed += r.failed;
    onProgress?.({ done: Math.min(urls.length, i + BATCH), total: urls.length, bytes });
    if (r.full) {
      areas.put({ ...areas.get(area.id), status: 'partial', bytes });
      throw new Error('Der Speicher ist voll – kleineres Gebiet oder nur Übersicht wählen');
    }
  }
  const done = !signal?.aborted && failed === 0;
  if (done && oldCache) await caches.delete(oldCache).catch(() => {});
  return areas.put({
    ...areas.get(area.id), cache, oldCache: done ? null : oldCache, bytes, tiles: t.vector.length + t.terrain.length,
    status: done ? 'ok' : 'partial', at: done ? Date.now() : areas.get(area.id)?.at ?? 0, failed,
  });
}
