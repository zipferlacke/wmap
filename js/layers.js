/**
 * Eigene Ebenen: GeoJSON aus einer Datei, von einem Link oder aus einem
 * Plugin – z. B. geologische Messpunkte, eigene Messwerte, Wanderkarten.
 * Privat auf diesem Gerät (IndexedDB), nichts geht an einen Server.
 *
 * Ebene: { id, name, color, data (FeatureCollection), colorBy (Eigenschaft
 *          mit Zahlen → Farbverlauf), onMain (auch auf der Hauptkarte),
 *          source: { kind: 'file'|'url'|'plugin'|'preset', url, operator, updated, pluginId, presetId },
 *          count, bbox, created }
 *
 * Rasterkacheln (Plugins wie geologische Karten): statt data ein
 *          raster: { tiles: 'https://…/{z}/{x}/{y}.png' oder WMS mit {bbox-epsg-3857},
 *                    attribution, auth: 'Basic …' (private Quelle, nur auf diesem Gerät),
 *                    minzoom, maxzoom: wo der Anbieter Bilder liefert – darüber
 *                    wird die letzte Stufe vergrößert, darunter nichts geladen }
 */
import { store } from './db.js';
import { AUTH } from './map.js';
import { esc } from './geo.js';

const db = store('layers');

export const layers = {
  async all() { return (await db.all()).sort((a, b) => b.created - a.created); },
  get: (id) => db.get(id),
  put: (l) => db.put(l),
  remove: (id) => db.remove(id),
};

const PALETTE = ['#e8590c', '#1a73e8', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e64980', '#5c940d'];
/* Farbverlauf für Messwerte: niedrig blau → hoch rot (gut lesbar, auch farbschwach) */
export const RAMP = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027'];

/* ── GeoJSON lesen ────────────────────────────────────────────────────────── */

/** Text → FeatureCollection (auch einzelnes Feature oder Geometrie). */
function readGeoJson(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('Das ist kein gültiges GeoJSON (JSON-Fehler)'); }
  if (o?.type === 'FeatureCollection') o = { type: 'FeatureCollection', features: o.features ?? [] };
  else if (o?.type === 'Feature') o = { type: 'FeatureCollection', features: [o] };
  else if (o?.type && o.coordinates) o = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: o }] };
  else throw new Error('Das ist kein GeoJSON – erwartet wird eine FeatureCollection');
  o.features = o.features.filter((f) => f?.geometry?.coordinates);
  if (!o.features.length) throw new Error('Die Datei enthält keine Objekte mit Koordinaten');
  // Lage prüfen: GeoJSON ist lon, lat in Grad (WGS84)
  const [w, s, e, n] = bboxOf(o);
  if (w < -180 || e > 180 || s < -90 || n > 90) throw new Error('Die Koordinaten sind nicht in Grad (WGS84) – bitte vorher umrechnen, z. B. mit QGIS');
  return o;
}

export function bboxOf(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  };
  for (const f of fc.features) walk(f.geometry.coordinates);
  return [w, s, e, n];
}

/** Eigenschaften mit Zahlen – die kann man als Farbverlauf zeigen. → [{ key, min, max }] */
export function numericProps(fc) {
  const seen = new Map();
  for (const f of fc.features.slice(0, 5000)) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      const x = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.replace(',', '.')) : NaN;
      const r = seen.get(k) ?? { key: k, min: Infinity, max: -Infinity, n: 0, bad: 0 };
      if (Number.isFinite(x)) { r.min = Math.min(r.min, x); r.max = Math.max(r.max, x); r.n += 1; } else if (v !== null && v !== '') r.bad += 1;
      seen.set(k, r);
    }
  }
  return [...seen.values()].filter((r) => r.n > 0 && r.bad <= r.n * 0.1 && r.max > r.min);
}

/** Neue Ebene aus GeoJSON-Text. */
export function newLayer(text, { name, source, index = 0 }) {
  const data = readGeoJson(text);
  // Zahlen als Text („12,5“) für die Karte in echte Zahlen wandeln
  const nums = numericProps(data);
  for (const f of data.features) {
    for (const { key } of nums) {
      const v = f.properties?.[key];
      if (typeof v === 'string') f.properties[key] = Number(v.replace(',', '.'));
    }
  }
  return {
    id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name, source, data, created: Date.now(),
    color: PALETTE[index % PALETTE.length],
    colorBy: null, onMain: false, visible: true,
    count: data.features.length, bbox: bboxOf(data).map((v) => +v.toFixed(6)),
  };
}

/* ── Auf die Karte ────────────────────────────────────────────────────────── */

const ids = (id) => ({ src: `own-${id}`, fill: `own-${id}-fill`, line: `own-${id}-line`, point: `own-${id}-point`, raster: `own-${id}-raster` });

/** Rasterkacheln als Ebene (z. B. geologische Karte eines Anbieters) */
export function rasterLayer({ name, tiles, attribution = '', source, auth = null, minzoom = null, maxzoom = null }) {
  return {
    id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name, source, created: Date.now(),
    raster: { tiles, attribution, ...(auth ? { auth } : {}), ...(minzoom != null ? { minzoom } : {}), ...(maxzoom != null ? { maxzoom } : {}) },
    color: '#495057', colorBy: null, onMain: false, visible: true, count: 0, bbox: null, opacity: 0.7,
  };
}

/** Farbe der Objekte: fest oder nach Messwert. → [Ausdruck, Legende] */
export function colorExpr(layer) {
  if (layer.raster) return [layer.color, null];
  const prop = layer.colorBy && numericProps(layer.data).find((p) => p.key === layer.colorBy);
  if (!prop) return [layer.color, null];
  const stops = RAMP.flatMap((c, i) => [prop.min + ((prop.max - prop.min) * i) / (RAMP.length - 1), c]);
  return [['case', ['has', prop.key], ['interpolate', ['linear'], ['to-number', ['get', prop.key]], ...stops], '#9aa0a6'], prop];
}

export function showLayer(map, layer, { before } = {}) {
  const { src, fill, line, point, raster } = ids(layer.id);
  hideLayer(map, layer.id);
  if (!layer.visible) return;
  if (layer.raster) {
    if (layer.raster.auth) AUTH.set(prefixOf(layer.raster.tiles), layer.raster.auth);
    // WMS: größere Bilder, weniger Anfragen
    const wms = layer.raster.tiles.includes('{bbox-epsg-3857}');
    const { minzoom, maxzoom } = layer.raster;
    map.addSource(src, {
      type: 'raster', tiles: [layer.raster.tiles], tileSize: wms ? 512 : 256, attribution: layer.raster.attribution || undefined,
      ...(maxzoom != null ? { maxzoom } : {}),
    });
    map.addLayer({
      id: raster, type: 'raster', source: src, paint: { 'raster-opacity': layer.opacity ?? 0.7 },
      ...(minzoom != null ? { minzoom } : {}),
    }, before);
    return;
  }
  const [color] = colorExpr(layer);
  const o = layer.opacity ?? 1;
  map.addSource(src, { type: 'geojson', data: layer.data, promoteId: undefined });
  const geom = (types) => ['in', ['geometry-type'], ['literal', types]];
  map.addLayer({ id: fill, type: 'fill', source: src, filter: geom(['Polygon', 'MultiPolygon']),
    paint: { 'fill-color': color, 'fill-opacity': 0.35 * o } }, before);
  map.addLayer({ id: line, type: 'line', source: src, filter: geom(['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': color, 'line-opacity': o, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 16, 4] } }, before);
  map.addLayer({ id: point, type: 'circle', source: src, filter: geom(['Point', 'MultiPoint']),
    paint: {
      'circle-color': color,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 14, 7, 18, 10],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      'circle-opacity': o, 'circle-stroke-opacity': o,
    } }, before);
}

/** Adress-Anfang einer Kachel-Vorlage – bis zum ersten Platzhalter oder Parameter */
const prefixOf = (tiles) => tiles.split(/[{?]/)[0];

/** Benutzer + Passwort → Wert für „Authorization“ */
export const basicAuth = (user, pass) => `Basic ${btoa(unescape(encodeURIComponent(`${user}:${pass}`)))}`;

export function hideLayer(map, id) {
  const { src, fill, line, point, raster } = ids(id);
  for (const l of [fill, line, point, raster]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(src)) map.removeSource(src);
}

/** Alle Kartenebenen einer eigenen Ebene – für Klicks. */
export const mapLayerIds = (id) => { const x = ids(id); return [x.point, x.line, x.fill]; };

/** Eigenschaften eines Objekts als Tabelle. */
export function propertyTable(props = {}) {
  const rows = Object.entries(props).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');
  if (!rows.length) return '<p class="muted">Keine Eigenschaften</p>';
  return `<table class="prop-table">${rows.map(([k, v]) => {
    const val = typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : String(v);
    const link = /^https?:\/\//.test(val) ? `<a href="${esc(val)}" target="_blank" rel="noopener">${esc(val)}</a>` : esc(val);
    return `<tr><th>${esc(k)}</th><td>${link}</td></tr>`;
  }).join('')}</table>`;
}
