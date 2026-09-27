/**
 * Overpass: Kategorien im Kartenausschnitt, POIs entlang der Route und die
 * echte Geometrie eines gefundenen Objekts (Fluss, Platz, Wald …), damit sie
 * auf der Karte hervorgehoben werden kann.
 */
import { API } from './config.js';
import { searchFilters } from './categories.js';

// Abfragen dürfen serverseitig 25 s laufen, dazu kommt die Warteschlange
const SERVER_TIMEOUT_MS = 45000;

/** Zeitlimit je Server, mit eigenem Abbrechen verknüpft (ältere Browser: nur eigenes). */
function withTimeout(signal) {
  if (!AbortSignal.any || !AbortSignal.timeout) return signal;
  const timeout = AbortSignal.timeout(SERVER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Antwortet ein Server so lange nicht, wird zusätzlich der nächste gefragt
const HEDGE_MS = 4000;
const CACHE_MS = 10 * 60 * 1000;
const answers = new Map();          // Abfrage → { at, elements }

/**
 * Overpass fragen. Die öffentlichen Server sind oft ausgelastet: einer lehnt
 * ab (406/429), einer hängt in der Warteschlange. Statt der Reihe nach bis
 * zum Zeitlimit zu warten, kommt nach 4 s (oder sofort nach einer Absage) der
 * nächste dazu – die erste Antwort gewinnt, die anderen werden abgebrochen.
 * Gleiche Abfragen innerhalb von 10 Minuten kommen aus dem Gedächtnis.
 */
export async function run(query, signal) {
  const hit = answers.get(query);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.elements;
  const elements = await hedged(query, signal);
  answers.set(query, { at: Date.now(), elements });
  if (answers.size > 40) answers.delete(answers.keys().next().value);
  return elements;
}

function hedged(query, signal) {
  return new Promise((resolve, reject) => {
    const servers = API.overpass;
    const ctrls = [];
    let next = 0, pending = 0, done = false, timer = null;
    let lastError = null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctrls.forEach((c) => c.abort());
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const onAbort = () => finish(reject, new DOMException('Abgebrochen', 'AbortError'));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort);

    const start = () => {
      if (done) return;
      if (next >= servers.length) {
        if (!pending) finish(reject, lastError ?? new Error('Overpass nicht erreichbar'));
        return;
      }
      const url = servers[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      pending += 1;
      clearTimeout(timer);
      timer = setTimeout(start, HEDGE_MS);
      fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: withTimeout(ctrl.signal) })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(res.status === 429 ? 'Overpass ist gerade ausgelastet' : `Overpass antwortet nicht (${res.status})`);
          }
          finish(resolve, (await res.json()).elements ?? []);
        })
        .catch((err) => {
          if (done) return;
          pending -= 1;
          lastError = err.name === 'TimeoutError' || err.name === 'AbortError' ? new Error('Overpass antwortet gerade nicht') : err;
          start();                     // Absage oder Zeitlimit: gleich den nächsten
        });
    };
    start();
  });
}

const box = ([w, s, e, n]) => [s, w, n, e].map((v) => v.toFixed(5)).join(',');

/** Alles einer Kategorie in einem Rechteck, mit auf das Rechteck gekappter Geometrie. */
export async function inBbox(category, bounds, { limit = 400, signal } = {}) {
  const b = box(bounds);
  // Punkte (Tankstelle, Café …) brauchen keine Umrisse – nur Mittelpunkt und
  // Tags; das ist viel weniger Arbeit für den Server
  const out = category.kind === 'point' ? 'center tags' : `geom(${b})`;
  const q = `[out:json][timeout:25];(${searchFilters(category).map((f) => `nwr${f}(${b});`).join('')});`
    + `out ${out} ${limit};`;
  return toGeoJSON(await run(q, signal), category);
}

/**
 * POIs im Korridor um die Route. `line` ist bereits vereinfacht – Overpass
 * nimmt die Punkte als Linie für `around`.
 */
export async function alongLine(category, line, radius, { limit = 300, signal } = {}) {
  const pts = line.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',');
  const q = `[out:json][timeout:30];(${searchFilters(category).map((f) => `nwr${f}(around:${radius},${pts});`).join('')});`
    + `out center tags ${limit};`;
  return toGeoJSON(await run(q, signal), category);
}

/** Alles einer Kategorie innerhalb einer Fläche (Ring aus [lon, lat], vereinfacht). */
export async function inPolygon(category, ring, { limit = 300, signal } = {}) {
  const poly = ring.map(([lon, lat]) => `${lat.toFixed(5)} ${lon.toFixed(5)}`).join(' ');
  const q = `[out:json][timeout:30];(${searchFilters(category).map((f) => `nwr${f}(poly:"${poly}");`).join('')});`
    + `out center tags ${limit};`;
  return toGeoJSON(await run(q, signal), category);
}

/** Geometrie eines einzelnen OSM-Objekts, z. B. aus einem Photon-Treffer. */
export async function byId(osmType, osmId, { signal } = {}) {
  const t = { N: 'node', W: 'way', R: 'relation' }[osmType] ?? osmType;
  return toGeoJSON(await run(`[out:json][timeout:25];${t}(${osmId});out geom;`, signal));
}

/* ── OSM → GeoJSON ────────────────────────────────────────────────────────── */

const LINE_KEYS = ['waterway', 'highway', 'railway', 'barrier', 'power', 'route'];

function isArea(tags, closed, category) {
  if (!closed) return false;
  if (category?.kind === 'line') return false;
  if (tags.area === 'yes') return true;
  if (tags.area === 'no') return false;
  return !LINE_KEYS.some((k) => k in tags) || tags.waterway === 'riverbank';
}

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** Einzelne Wege zu möglichst langen Linien bzw. Ringen zusammensetzen. */
function stitch(parts) {
  const pool = parts.filter((p) => p.length > 1).map((p) => p.slice());
  const out = [];
  while (pool.length) {
    let line = pool.shift();
    let grown = true;
    while (grown && !same(line[0], line[line.length - 1])) {
      grown = false;
      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i];
        const end = line[line.length - 1];
        if (same(end, p[0])) line = line.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) line = line.concat(p.slice(0, -1).reverse());
        else if (same(line[0], p[p.length - 1])) line = p.concat(line.slice(1));
        else if (same(line[0], p[0])) line = p.slice().reverse().concat(line.slice(1));
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Punktliste → Teilstücke. Bei `out geom(bbox)` stehen für Knoten außerhalb
 * des Ausschnitts Lücken (null) in der Liste; dort wird die Linie geteilt.
 */
function geomParts(g) {
  const parts = [[]];
  for (const pt of g ?? []) {
    if (pt) parts[parts.length - 1].push([pt.lon, pt.lat]);
    else if (parts[parts.length - 1].length) parts.push([]);
  }
  return parts.filter((p) => p.length > 1);
}

function elementGeometry(el, category) {
  const tags = el.tags ?? {};
  if (el.type === 'node') return { type: 'Point', coordinates: [el.lon, el.lat] };
  if (el.type === 'way') {
    const parts = geomParts(el.geometry);
    if (!parts.length) return el.center ? { type: 'Point', coordinates: [el.center.lon, el.center.lat] } : null;
    if (parts.length > 1) return { type: 'MultiLineString', coordinates: parts };
    const c = parts[0];
    return isArea(tags, same(c[0], c[c.length - 1]) && c.length > 3, category)
      ? { type: 'Polygon', coordinates: [c] } : { type: 'LineString', coordinates: c };
  }
  if (el.type === 'relation') {
    const members = (el.members ?? []).filter((m) => m.type === 'way' && m.geometry);
    if (!members.length) return el.center ? { type: 'Point', coordinates: [el.center.lon, el.center.lat] } : null;
    const areaRel = tags.type === 'multipolygon' || tags.type === 'boundary';
    if (areaRel && category?.kind !== 'line') {
      const outer = stitch(members.filter((m) => m.role !== 'inner').flatMap((m) => geomParts(m.geometry)));
      const rings = outer.filter((r) => r.length > 3 && same(r[0], r[r.length - 1]));
      // Auf den Ausschnitt gekappte Ringe sind nicht mehr geschlossen – dann als Linie zeigen
      if (rings.length === outer.length) return { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) };
      return { type: 'MultiLineString', coordinates: outer };
    }
    return { type: 'MultiLineString', coordinates: stitch(members.flatMap((m) => geomParts(m.geometry))) };
  }
  return null;
}

/** Punkt für Beschriftung und Liste: Knoten selbst, sonst Mitte bzw. Stützpunkt. */
function anchorOf(el, geom) {
  if (el.center) return [el.center.lon, el.center.lat];
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates;
  const flat = geom.type === 'LineString' ? geom.coordinates
    : geom.type === 'Polygon' || geom.type === 'MultiLineString' ? geom.coordinates.flat()
      : geom.coordinates.flat(2);
  if (!flat.length) return null;
  if (geom.type === 'LineString' || geom.type === 'MultiLineString') return flat[Math.floor(flat.length / 2)];
  let x = 0, y = 0;
  for (const [a, b] of flat) { x += a; y += b; }
  return [x / flat.length, y / flat.length];
}

/**
 * → { shapes, points }
 *   shapes: Flächen und Linien zum Hervorheben
 *   points: je Objekt ein Punkt mit Name – für Liste, Kreis und Beschriftung
 */
export function toGeoJSON(elements, category = null) {
  const shapes = [], points = [];
  for (const el of elements) {
    const geom = elementGeometry(el, category);
    const anchor = anchorOf(el, geom);
    if (!anchor) continue;
    const tags = el.tags ?? {};
    const props = {
      id: `${el.type}/${el.id}`,
      name: tags.name ?? tags.brand ?? tags.operator ?? '',
      category: category?.id ?? '',
      color: category?.color ?? '#e8590c',
      tags: JSON.stringify(tags),
      // Hat das Objekt eine Fläche oder Linie, reicht die farbige Hervorhebung
      hasShape: !!(geom && geom.type !== 'Point'),
    };
    if (geom && geom.type !== 'Point') shapes.push({ type: 'Feature', geometry: geom, properties: props });
    points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: anchor }, properties: props });
  }
  return { shapes, points };
}
