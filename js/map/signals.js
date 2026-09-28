/**
 * Ampeln auf der Karte: nur wo eine steht, kein Rot/Grün. Die Grundkarte
 * (OpenMapTiles) kennt keine Ampeln – sie kommen ab Zoom 15 per Overpass für
 * den Ausschnitt samt Rand (OSM highway=traffic_signals). Bleibt die Karte im
 * geladenen Bereich, wird nichts neu geholt; Overpass merkt sich Antworten.
 *
 * Die Welt ist dafür in Felder von etwa 1 km geteilt: Gefragt wird nur nach
 * Feldern im Blick (samt Rand), die noch fehlen – beim Verschieben also nur
 * der neue Streifen, beim Zurückschieben gar nichts. Die Abfrage läuft im
 * Hintergrund-Modus von Overpass: ein Server nach dem anderen, keine
 * parallelen Nachfragen, bei Überlastung Pause statt Wiederholung.
 *
 * Symbol: eine kleine Ampel (Gehäuse, drei Lichter), immer sichtbar.
 */
import { run } from '../services/overpass.js';

const MIN_ZOOM = 15;
const SRC = 'signals';
const ICON = 'wmap-ampel';
const CELL = 0.01;                  // Grad je Feld (≈ 1,1 km × 0,7 km)
const MAX_CELLS = 800;

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
  const cells = new Map();           // "ix,iy" → [[lon, lat], …]; Reihenfolge = Alter
  let busy = false;                  // höchstens eine Abfrage zugleich
  let pauseUntil = 0;                // nach einem Fehlschlag eine Weile Ruhe
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

  function paint() {
    ensure();
    const features = [];
    for (const pts of cells.values()) for (const c of pts) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
    map.getSource(SRC).setData({ type: 'FeatureCollection', features });
  }

  async function load() {
    if (busy || map.getZoom() < MIN_ZOOM || document.body.classList.contains('navigating')) return;
    if (Date.now() < pauseUntil) return;
    const v = map.getBounds();
    const dx = (v.getEast() - v.getWest()) * 0.25, dy = (v.getNorth() - v.getSouth()) * 0.25;
    const [x0, y0] = [Math.floor((v.getWest() - dx) / CELL), Math.floor((v.getSouth() - dy) / CELL)];
    const [x1, y1] = [Math.floor((v.getEast() + dx) / CELL), Math.floor((v.getNorth() + dy) / CELL)];
    const missing = [];
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) if (!cells.has(`${x},${y}`)) missing.push([x, y]);
    if (!missing.length) return;
    // Ein Rechteck um alle fehlenden Felder – eine Abfrage statt vieler
    const mx = missing.map((m) => m[0]), my = missing.map((m) => m[1]);
    const [ax, ay, bx, by] = [Math.min(...mx), Math.min(...my), Math.max(...mx) + 1, Math.max(...my) + 1];
    const f = (n) => (n * CELL).toFixed(2);
    // Nie abbrechen: Overpass zählt auch abgebrochene Abfragen gegen das
    // Kontingent – wer bei jedem Verschieben neu fragt, bekommt 429
    busy = true;
    try {
      const els = await run(`[out:json][timeout:20];node[highway=traffic_signals](${f(ay)},${f(ax)},${f(by)},${f(bx)});out skel qt;`, null, { background: true });
      for (let x = ax; x < bx; x += 1) for (let y = ay; y < by; y += 1) { cells.delete(`${x},${y}`); cells.set(`${x},${y}`, []); }
      for (const e of els) cells.get(`${Math.floor(e.lon / CELL)},${Math.floor(e.lat / CELL)}`)?.push([e.lon, e.lat]);
      while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value);
      paint();
      busy = false;
      schedule();                       // inzwischen weitergeschoben? Den Rest holen
    } catch {
      busy = false;
      pauseUntil = Date.now() + 30000;  // Ampeln sind Zugabe – nach der Pause beim nächsten Verschieben
    }
  }

  const schedule = (ms = 800) => { clearTimeout(timer); timer = setTimeout(load, ms); };
  map.on('moveend', () => schedule());
  // Neuer Kartenstil (z. B. Satellit): Gemerktes gleich wieder zeigen
  map.on('style.load', () => { if (cells.size) paint(); });
  if (map.loaded()) schedule(); else map.once('load', () => schedule());
}
