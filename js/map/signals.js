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
 * Symbol: eine kleine Ampel (Gehäuse, drei Lichter), immer sichtbar – außer geneigt hinter einem Haus. MapLibre
 * zeichnet Symbole immer über die 3D-Häuser. Darum ein Sichtstrahl von der Kamera zur Ampel (2 m über dem Boden):
 * Steht auf dem Weg dorthin ein Haus der Kacheln, das höher ist als der Strahl an dieser Stelle, ist sie verdeckt.
 * (MapLibres queryRenderedFeatures trifft geneigt die nahen Häuser nicht – darum selbst gerechnet.) Die Grundrisse
 * werden nach jeder Bewegung einmal in ein Raster gelegt; der Strahl selbst ist billig und wird während einer
 * Bewegung höchstens alle 250 ms neu geprüft. Flach ist nichts verdeckt – dann wird gar nicht gerechnet.
 */
import { run } from '../services/overpass.js';

const MIN_ZOOM = 15;
const SRC = 'signals';
const ICON = 'wmap-ampel';
const CELL = 0.01;                  // Grad je Feld (≈ 1,1 km × 0,7 km)
const MAX_CELLS = 800;
const HOUSES = 'building-3d';      // Ebene der 3D-Häuser (map.js) – Quelle und Filter wie dort
const HIDE_FROM = 25;               // ab dieser Neigung können Häuser Ampeln verdecken
const HIDE_EVERY = 250;             // ms – während einer Bewegung nicht öfter prüfen
const EYE = 2;                      // m – diese Höhe der Ampel muss frei zu sehen sein
const GRID = 25;                    // m – Raster der Grundrisse
const M_LAT = 111320;

/** Grundrisse der 3D-Häuser im Blick: [{ ring: [[x, y] …] in m um o, h }] und ein Raster darüber */
export function houseIndex(map, o) {
  const layer = map.getLayer(HOUSES);
  if (!layer || map.getLayoutProperty(HOUSES, 'visibility') === 'none') return null;
  const kx = M_LAT * Math.cos((o[1] * Math.PI) / 180);
  const xy = ([lon, lat]) => [(lon - o[0]) * kx, (lat - o[1]) * M_LAT];
  const houses = [], grid = new Map();
  for (const f of map.querySourceFeatures(layer.source, { sourceLayer: layer.sourceLayer })) {
    const p = f.properties;
    const h = p.render_height ?? 0;
    if (p.hide_3d || h <= EYE || (p.render_min_height ?? 0) > EYE) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0].map(xy);
      const i = houses.push({ ring, h }) - 1;
      const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
      for (let gx = Math.floor(Math.min(...xs) / GRID); gx <= Math.floor(Math.max(...xs) / GRID); gx += 1) {
        for (let gy = Math.floor(Math.min(...ys) / GRID); gy <= Math.floor(Math.max(...ys) / GRID); gy += 1) {
          const k = `${gx},${gy}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
      }
    }
  }
  return { o, kx, xy, houses, grid };
}

/** Kleinster Anteil t (0 … 1) der Strecke a→b, an dem sie im Ring liegt; null, wenn nie */
function enter(ring, a, b) {
  let inside = false, best = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [px, py] = ring[i], [qx, qy] = ring[j];
    if ((py > a[1]) !== (qy > a[1]) && a[0] < ((qx - px) * (a[1] - py)) / (qy - py) + px) inside = !inside;
    const dx = b[0] - a[0], dy = b[1] - a[1], ex = qx - px, ey = qy - py;
    const den = dx * ey - dy * ex;
    if (!den) continue;
    const t = ((px - a[0]) * ey - (py - a[1]) * ex) / den, u = ((px - a[0]) * dy - (py - a[1]) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return inside ? 0 : best;
}

/**
 * Verdeckt ein Haus den Blick von der Kamera (cam: [x, y] in m, alt über dem Boden) auf den Punkt s?
 * `own`: Steht s selbst in einem Haus (ein Laden), verdeckt das nur, wenn s mehr als so viele Meter von der Wand zur
 * Kamera entfernt liegt. Ohne (Ampel) verdeckt auch das Haus, in dem der Punkt liegt.
 */
export function hiddenBy(idx, s, cam, alt, own = 0) {
  const dx = cam[0] - s[0], dy = cam[1] - s[1], d = Math.hypot(dx, dy);
  if (alt <= EYE || d < 1) return false;
  // Weiter weg ist der Strahl über jedem Haus (höchstens 150 m hoch)
  const reach = Math.min(d, ((150 - EYE) * d) / (alt - EYE));
  const end = [s[0] + (dx / d) * reach, s[1] + (dy / d) * reach];
  const seen = new Set();
  for (let w = 0; w <= reach + GRID; w += GRID / 2) {
    const r = Math.min(w, reach);
    const k = `${Math.floor((s[0] + (dx / d) * r) / GRID)},${Math.floor((s[1] + (dy / d) * r) / GRID)}`;
    for (const i of idx.grid.get(k) ?? []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const t = enter(idx.houses[i].ring, s, end);
      if (t === 0 && own) {
        const back = enter(idx.houses[i].ring, end, s);
        const out = back === null ? 0 : reach * (1 - back);
        if (out > own && EYE + ((alt - EYE) * out) / d < idx.houses[i].h) return true;
        continue;
      }
      if (t !== null && EYE + ((alt - EYE) * t * reach) / d < idx.houses[i].h) return true;
    }
  }
  return false;
}

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
      paint: { 'icon-opacity': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 1] },
    }, before());
  }

  function paint() {
    ensure();
    const features = [];
    for (const pts of cells.values()) for (const c of pts) features.push({ type: 'Feature', id: features.length, properties: {}, geometry: { type: 'Point', coordinates: c } });
    shown = features;
    hidden = new Set();
    map.getSource(SRC).setData({ type: 'FeatureCollection', features });
    occlude({ fresh: true });
  }

  // Hinter einem Haus? Sichtstrahl Kamera → Ampel gegen die Grundrisse (houseIndex, neu nach jeder Bewegung)
  let shown = [], hidden = new Set(), lastCheck = 0, idx = null;
  function occlude({ fresh = false } = {}) {
    lastCheck = performance.now();
    if (!map.getLayer(SRC)) return;
    const now = new Set();
    if (map.getPitch() >= HIDE_FROM && map.getZoom() >= MIN_ZOOM) {
      const c = map.getCenter().toArray();
      if (fresh || !idx || Math.abs(idx.o[0] - c[0]) * idx.kx > 2000 || Math.abs(idx.o[1] - c[1]) * M_LAT > 2000) idx = houseIndex(map, c);
      // Kamera: MapLibre 6 hat keine öffentliche Abfrage mehr (getFreeCameraOptions fehlt) – Interna wie tilt-gestures.js
      const tr = map._camera?.transform ?? map.transform;
      const ll = tr?.getCameraLngLat?.();
      if (idx && ll) {
        const cam = idx.xy([ll.lng, ll.lat]);
        const alt = tr.getCameraAltitude() - (map.queryTerrainElevation?.(ll) ?? 0);
        const { clientWidth: w, clientHeight: h } = map.getCanvas();
        for (const f of shown) {
          const p = map.project(f.geometry.coordinates);
          if (p.x < -20 || p.y < -40 || p.x > w + 20 || p.y > h + 40) continue;
          if (hiddenBy(idx, idx.xy(f.geometry.coordinates), cam, alt)) now.add(f.id);
        }
      }
    }
    for (const id of hidden) if (!now.has(id)) map.setFeatureState({ source: SRC, id }, { hidden: false });
    for (const id of now) if (!hidden.has(id)) map.setFeatureState({ source: SRC, id }, { hidden: true });
    hidden = now;
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
  map.on('move', () => { if (shown.length && performance.now() - lastCheck > HIDE_EVERY) occlude(); });
  // Nach dem Laden neuer Häuser-Kacheln (und am Ende jeder Bewegung) das endgültige Bild prüfen
  map.on('idle', () => { if (shown.length) occlude({ fresh: true }); });
  // Neuer Kartenstil (z. B. Satellit): Gemerktes gleich wieder zeigen
  map.on('style.load', () => { if (cells.size) paint(); });
  if (map.loaded()) schedule(); else map.once('load', () => schedule());
}
