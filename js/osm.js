/**
 * Einzelne OSM-Objekte direkt von der OSM-API – für Details und Umriss nach
 * einem Klick. Das ist viel schneller als Overpass (keine Warteschlange,
 * eine Anfrage nach ID dauert gut 0,1 s).
 *
 * Große Relationen (Flüsse, Grenzen) holt weiterhin Overpass: Die OSM-API
 * liefert dort jeden einzelnen Knoten aus, das wären Megabytes.
 */
import { API } from './config.js';
import * as overpass from './overpass.js';

const TYPES = { N: 'node', W: 'way', R: 'relation' };
const cache = new Map();

async function get(path, signal) {
  const res = await fetch(`${API.osm}/${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OSM antwortet nicht (${res.status})`);
  return res.json();
}

/** Nur die Tags – für das Popup und das Sheet. */
export function tags(type, id, { signal } = {}) {
  const key = `t${type}${id}`;
  if (!cache.has(key)) {
    const job = get(`${TYPES[type]}/${id}.json`, signal).then((d) => d.elements?.[0]?.tags ?? {});
    cache.set(key, job);
    job.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

/**
 * Umriss zum Hervorheben. → { shapes } wie bei overpass.toGeoJSON
 * Knoten haben keinen, Wege kommen von der OSM-API, Relationen von Overpass.
 */
export function shape(type, id, { signal } = {}) {
  const key = `s${type}${id}`;
  if (!cache.has(key)) {
    let job;
    if (type === 'N') job = Promise.resolve({ shapes: [] });
    else if (type === 'W') {
      job = get(`way/${id}/full.json`, signal).then((d) => {
        const nodes = new Map(d.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
        const way = d.elements.find((e) => e.type === 'way' && e.id === Number(id));
        // In die Form bringen, die Overpass mit „out geom“ liefert
        const el = { type: 'way', id: way.id, tags: way.tags ?? {}, geometry: way.nodes.map((n) => nodes.get(n)).filter(Boolean) };
        return overpass.toGeoJSON([el]);
      });
    } else job = overpass.byId(type, id, { signal });
    cache.set(key, job);
    job.catch(() => cache.delete(key));
  }
  return cache.get(key);
}
