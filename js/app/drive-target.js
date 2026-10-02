/**
 * Fahrziel fürs Auto: In ein Geschäft, ein Lokal oder eine Praxis fährt man nicht hinein. Die Route endete
 * bisher an der Straße, die dem Punkt des Orts am nächsten liegt – oft die Rückseite mit der Anlieferung –,
 * und „Ziel erreicht“ kam dort. Darum endet die Fahrt am nächsten Parkplatz davor; die Nadel bleibt am Ort.
 *
 * Gilt nur für Ziele, die als Ort gewählt wurden (Wegpunkt mit `poi`) – nicht für Adressen, Punkte auf der
 * Karte oder Orte, in die man hineinfährt (Parkplatz, Tankstelle, Ladesäule, Waschanlage).
 */
import * as overpass from '../services/overpass.js';
import { poisInBounds } from '../map/tile-pois.js';
import { bboxAround, distance } from '../core/geo.js';
import { map } from './core.js';

/*
 * „Davor“ heißt: Der Rand des Parkplatzes liegt höchstens so weit vom Punkt des Orts (Meter) – bei einem großen
 * Markt ist das schon die halbe Halle. Ein Parkplatz weiter weg gehört meist zu etwas anderem; dann bleibt es
 * beim Ort selbst (die Route endet wie bisher an der nächsten Straße). Die Kartenkacheln kennen nur die Mitte
 * des Parkplatzes, darum dort etwas mehr.
 */
const EDGE_M = 75;
const CENTER_M = 90;
/** Länger wartet die Route nicht auf Overpass – dann zählen die Parkplätze aus den Kartenkacheln */
const WAIT_MS = 2500;

const POI_KEYS = ['shop', 'amenity', 'tourism', 'leisure', 'office', 'craft', 'healthcare'];
const DRIVE_IN = new Set(['parking', 'parking_entrance', 'parking_space', 'motorcycle_parking', 'fuel',
  'charging_station', 'car_wash', 'vehicle_inspection', 'camp_site', 'caravan_site']);
/** Dort parkt man als Besucher nicht („customers“ dagegen ist genau richtig) */
const NO_ACCESS = /^(private|no|permit|residents|employees|delivery|agricultural|forestry|military)$/;

/** Ein Ort, vor dem man parkt – Photon-Feature, Treffer einer Kategorie oder gemerkter Ort (`_poi`) */
export function isPoi(f) {
  const p = f?.properties ?? {};
  if (p._poi) return true;
  const tags = p._tags ?? (p.osm_key ? { [p.osm_key]: p.osm_value } : {});
  const key = POI_KEYS.find((k) => tags[k]);
  return !!key && !DRIVE_IN.has(tags[key]);
}

const memo = new Map();             // "lon,lat" → Parkplatz | null

/**
 * Der nächste Parkplatz am Ort: erst mit Overpass (kennt „privat“), sonst aus den Kartenkacheln.
 * → { point, dist, name } oder null (keiner direkt am Ort – die Route endet wie bisher an der nächsten Straße)
 */
export async function parkingNear(point, { signal } = {}) {
  const key = point.map((v) => v.toFixed(5)).join();
  if (memo.has(key)) return memo.get(key);
  let found = await fromOverpass(point, signal);
  if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  found ??= await fromTiles(point, signal);
  const near = found.map((p) => ({ ...p, dist: Math.round(distance(point, p.point)) })).sort((a, b) => a.dist - b.dist)[0] ?? null;
  memo.set(key, near);
  if (memo.size > 50) memo.delete(memo.keys().next().value);
  return near;
}

/** → Liste oder null, wenn Overpass nicht (rechtzeitig) antwortet */
async function fromOverpass([lon, lat], signal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, WAIT_MS);
  try {
    const q = `[out:json][timeout:5];nwr["amenity"="parking"](around:${EDGE_M},${lat.toFixed(6)},${lon.toFixed(6)});out center tags 40;`;
    return (await overpass.run(q, ctl.signal))
      .map((e) => ({ point: e.center ? [e.center.lon, e.center.lat] : [e.lon, e.lat], tags: e.tags ?? {} }))
      .filter((p) => Number.isFinite(p.point[0]) && !NO_ACCESS.test(p.tags.access ?? ''))
      .map((p) => ({ point: p.point, name: p.tags.name ?? '' }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

async function fromTiles(point, signal) {
  try {
    return (await poisInBounds(map, bboxAround(point, CENTER_M), { signal }))
      .filter((p) => p.props.subclass === 'parking' && distance(point, p.point) <= CENTER_M)
      .map((p) => ({ point: p.point, name: p.props.name ?? '' }));
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}
