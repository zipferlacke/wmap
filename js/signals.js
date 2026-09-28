/**
 * Ampeln auf der Karte: nur wo eine steht, kein Rot/Grün. Die Grundkarte
 * (OpenMapTiles) kennt keine Ampeln – sie kommen ab Zoom 15 per Overpass für
 * den Ausschnitt samt Rand (OSM highway=traffic_signals). Bleibt die Karte im
 * geladenen Bereich, wird nichts neu geholt; Overpass merkt sich Antworten.
 *
 * Symbol: eine kleine Ampel (Gehäuse, drei Lichter), immer sichtbar.
 */
import { run } from './overpass.js';

const MIN_ZOOM = 15;
const SRC = 'signals';
const ICON = 'wmap-ampel';

/** Kleine Ampel: dunkles Gehäuse mit weißem Rand, Rot–Gelb–Grün, kurzer Mast */
function drawIcon() {
  const r = 2, W = 14 * r, H = 30 * r;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#495057';
  ctx.fillRect(W / 2 - 1 * r, 22 * r, 2 * r, 8 * r);
  ctx.beginPath();
  ctx.roundRect(1 * r, 1 * r, 12 * r, 22 * r, 3.5 * r);
  ctx.fillStyle = '#212529';
  ctx.fill();
  ctx.lineWidth = 1.5 * r;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ['#fa5252', '#fcc419', '#40c057'].forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(W / 2, (5.5 + i * 6.5) * r, 2.4 * r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
  return ctx.getImageData(0, 0, W, H);
}

export function mountSignals(map, { before = () => undefined } = {}) {
  let loaded = null;                 // [w, s, e, n]
  let ctl = null;
  let timer = null;

  function ensure() {
    if (!map.hasImage(ICON)) map.addImage(ICON, drawIcon(), { pixelRatio: 2 });
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: SRC, type: 'symbol', source: SRC, minzoom: MIN_ZOOM,
      layout: {
        'icon-image': ICON, 'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.75, 18, 1.1],
        // Immer zeigen – sonst verdrängen Namen und POIs die kleine Ampel
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    }, before());
  }

  const inside = (b, o) => o && b[0] >= o[0] && b[1] >= o[1] && b[2] <= o[2] && b[3] <= o[3];

  async function load() {
    if (map.getZoom() < MIN_ZOOM || document.body.classList.contains('navigating')) return;
    const v = map.getBounds();
    const view = [v.getWest(), v.getSouth(), v.getEast(), v.getNorth()];
    if (inside(view, loaded)) return;
    const dx = (view[2] - view[0]) * 0.5, dy = (view[3] - view[1]) * 0.5;
    // Auf ein Raster runden, damit Overpass gleiche Abfragen wiedererkennt
    const r = (x, up) => (up ? Math.ceil : Math.floor)(x * 200) / 200;
    const box = [r(view[0] - dx), r(view[1] - dy), r(view[2] + dx, true), r(view[3] + dy, true)];
    ctl?.abort();
    ctl = new AbortController();
    try {
      const els = await run(`[out:json][timeout:20];node[highway=traffic_signals](${[box[1], box[0], box[3], box[2]].join(',')});out skel qt;`, ctl.signal);
      ensure();
      map.getSource(SRC).setData({ type: 'FeatureCollection', features: els.map((e) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })) });
      loaded = box;
    } catch { /* Ampeln sind Zugabe */ }
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 600); };
  map.on('moveend', schedule);
  if (map.loaded()) schedule(); else map.once('load', schedule);
}
