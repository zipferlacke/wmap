/**
 * Nicht öffentliche Orte in der Grundkarte blass: private Parkplätze, Toiletten nur für Gäste … – wie die grauen
 * Treffer in der Liste „in der Nähe“ (app/category.js filterHits, ui/poi-info.js accessOf).
 *
 * Die Kacheln (OpenMapTiles) kennen keinen Zugang. Darum ab Zoom 16 per Overpass die Orte mit `access` im
 * Ausschnitt samt Rand, in Feldern von etwa 1 km wie die Ampeln (map/signals.js): gefragt wird nur nach Feldern,
 * die noch fehlen, im Hintergrund-Modus, nach einer Absage Pause. Die Antwort kommt als Feature-State `access`
 * ('private' | 'limited') an die Orte der Kacheln – die Kachel-ID ist die OSM-ID mal 10 plus Typ (map.js osmRef);
 * die Deckkraft steht im Stil (map.js ACCESS_OPACITY).
 */
import { run } from '../services/overpass.js';
import { accessOf } from '../ui/poi-info.js';

const MIN_ZOOM = 16;
const CELL = 0.01;
const MAX_CELLS = 400;
const KINDS = 'parking|parking_space|parking_entrance|bicycle_parking|motorcycle_parking|toilets|charging_station|fuel|drinking_water|shelter|bench';
const TYPE = { node: 1, way: 2, relation: 3 };

export function mountPoiAccess(map, { source = () => map.getLayer('poi_r1')?.source } = {}) {
  const cells = new Map();                  // "ix,iy" → [[id, access], …]
  let busy = false, pauseUntil = 0, timer = null;

  function apply(list) {
    const src = source();
    if (!src) return;
    for (const [id, access] of list) map.setFeatureState({ source: src, sourceLayer: 'poi', id }, { access });
  }

  async function load() {
    if (busy || map.getZoom() < MIN_ZOOM || Date.now() < pauseUntil || document.body.classList.contains('navigating')) return;
    const v = map.getBounds();
    const dx = (v.getEast() - v.getWest()) * 0.25, dy = (v.getNorth() - v.getSouth()) * 0.25;
    const [x0, y0] = [Math.floor((v.getWest() - dx) / CELL), Math.floor((v.getSouth() - dy) / CELL)];
    const [x1, y1] = [Math.floor((v.getEast() + dx) / CELL), Math.floor((v.getNorth() + dy) / CELL)];
    const missing = [];
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) if (!cells.has(`${x},${y}`)) missing.push([x, y]);
    if (!missing.length) return;
    const mx = missing.map((m) => m[0]), my = missing.map((m) => m[1]);
    const [ax, ay, bx, by] = [Math.min(...mx), Math.min(...my), Math.max(...mx) + 1, Math.max(...my) + 1];
    const f = (n) => (n * CELL).toFixed(2);
    busy = true;
    try {
      // Nur der Zugang und die Lage (center) – keine Formen
      const els = await run(`[out:json][timeout:20];nwr[amenity~"^(${KINDS})$"][access](${f(ay)},${f(ax)},${f(by)},${f(bx)});out tags center qt;`, null, { background: true });
      for (let x = ax; x < bx; x += 1) for (let y = ay; y < by; y += 1) { cells.delete(`${x},${y}`); cells.set(`${x},${y}`, []); }
      const fresh = [];
      for (const e of els) {
        const { kind } = accessOf(e.tags);
        if (kind === 'public') continue;
        const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
        const item = [e.id * 10 + TYPE[e.type], kind];
        cells.get(`${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`)?.push(item);
        fresh.push(item);
      }
      while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value);
      apply(fresh);
      busy = false;
      schedule();
    } catch {
      busy = false;
      pauseUntil = Date.now() + 30000;      // Zugabe – nach der Pause beim nächsten Verschieben
    }
  }

  const schedule = (ms = 900) => { clearTimeout(timer); timer = setTimeout(load, ms); };
  map.on('moveend', () => schedule());
  // Neuer Stil (Satellit …): Feature-States sind weg – Gemerktes wieder anlegen
  map.on('style.load', () => { for (const list of cells.values()) apply(list); });
  // Schon geladen (eigene Quellen aus map.js da)? Sonst beim „load“ – map.loaded() ist falsch, solange Kacheln kommen
  if (map.getSource('routes')) schedule(); else map.once('load', () => schedule());
}
