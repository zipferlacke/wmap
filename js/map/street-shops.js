/**
 * Street View: Geschäfte und Haltestellen in der Nähe (map/street.js).
 *
 *   Geschäfte   ihr Haus bekommt ein Erdgeschoss in der Farbe ihrer Art (map/buildings.js setStreetThings), der Name
 *               steht darüber an der Fassade – nur, was man sieht (kein Haus dazwischen), bis 200 m (fern kleiner)
 *   Bauwerke    Schloss, Kirche, Museum, Denkmal …: der Name höher an der Fassade, ohne Farbe; Hinschauen bis 80 m
 *   Hinschauen  liegt ein Geschäft bis 35 m nah in der Bildmitte (±7°), geht nach 0,8 s unten sein Dialog auf
 *               (`onOpen`); schaut man weg, geht er wieder zu (`onClose`). Selbst geschlossen: kommt erst wieder, wenn
 *               man einmal woanders hingeschaut hat. Antippen des Namens öffnet ihn auch – der bleibt dann offen
 *   Haltestellen  Bus und Straßenbahn aus den Kacheln: Mast mit Schild, ein Wartehäuschen, wo ein Unterstand
 *               (amenity=shelter) danebensteht; Straßenbahn-Halte am Bahnsteig statt auf dem Gleis; jede nur einmal
 *   Bilder      hat ein Geschäft oder Bauwerk in OSM ein Bild (image, wikimedia_commons), steht es klein im Schild
 *   Details     Was die Kacheln nicht kennen – Mauern, Dächer auf Pfosten, Bäume – aus Overpass, je Feld des
 *               Rasters (Kachel z16, rund 400 m) einmal gefragt und 30 Tage behalten (Cache „wmap-street“)
 *
 * Die Namen setzt die Seite selbst (HTML über der Karte) – mit derselben Kamera wie street.js: Ort, Augenhöhe,
 * Blickrichtung und -winkel. Beschriftungen der Karte zeichnet MapLibre durch Hauswände, darum sind die aus.
 */
import { categoryFor } from '../ui/poi-info.js';
import { run as overpass } from '../services/overpass.js';
import { thumbOf } from '../services/media.js';
import { meters, closest, isStopPoi, isShelterPoi, stopOf, placeStops } from './tile-stops.js';

const RAD = Math.PI / 180;
const NEAR = 250;              // so weit werden Geschäfte gesammelt (m) – so weit stehen auch Häuser (street.js)
const SHOW = 200;              // so weit stehen Namen (m)
const LOOK_AT = { dist: 35, landmark: 80, off: 7, dwell: 800, leave: 700 };
const LABEL_UP = 3.9;          // schwebender Name über dem Boden (m) – über dem farbigen Erdgeschoss
const LANDMARK_UP = 9;         // Bauwerke: höher an der Fassade
const STOP_UP = 3.2;           // Haltestelle: Knopf über dem Schild (Mast 2,6 m)
// An der Wand: Schild auf dem farbigen Erdgeschoss (bis 3,6 m), Bauwerke höher; Höhe des Schilds (m)
const SIGN = { bottom: 2.55, landmark: 6, height: 0.8, minPx: 10 };
const SIGN_PX = 32;            // Schriftgröße, in der das Schild gesetzt und dann verzerrt wird
const DETAIL_R = 200;          // Felder mit Details aus Overpass, die näher als das liegen (m)
const CELL_Z = 16;             // Raster der Overpass-Abfragen: eine Kachel dieser Stufe (Darmstadt: 400 × 400 m)
const KEEP_MS = 30 * 24 * 3600 * 1000;
const STORE = 'wmap-street';   // Cache Storage – sw.js räumt ihn nicht weg
const SKIP = new Set(['bus', 'railway', 'aerialway', 'ferry_terminal', 'harbor', 'park', 'playground', 'campsite',
  'information', 'toilets', 'drinking_water', 'parking', 'bicycle_parking', 'motorcycle_parking', 'bench']);
// Bauwerke: Name ohne farbiges Erdgeschoss, mit eigenem Symbol
const LANDMARK = { castle: 'castle', place_of_worship: 'church', museum: 'museum', monument: 'account_balance', memorial: 'account_balance',
  attraction: 'attractions', theatre: 'theater_comedy', townhall: 'account_balance', library: 'local_library', cinema: 'movie', art_gallery: 'palette' };
const OTHER = '#7048e8';

const nameOf = (p) => p['name:de'] ?? p.name_de ?? p.name ?? '';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Punkt `[dx, dy]` Meter (Ost, Nord) von `a` → [lon, lat] */
function offset(a, [dx, dy]) {
  const k = 111320;
  return [a[0] + dx / (k * Math.cos(a[1] * RAD)), a[1] + dy / k];
}

/** Liegt [x, y] im Ring (gleiche Einheit)? */
function inRing([x, y], r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

/**
 * CSS-Transform, das ein Rechteck w × h (Ursprung oben links) auf vier Bildpunkte legt – oben links, oben rechts,
 * unten rechts, unten links (perspektivisch, wie die Wand im Bild).
 */
function quadMatrix(q, w, h) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det, k = (dx1 * sy - sx * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(6)).join(',')})`;
}

/** Art aus den Kacheln (class/subclass) → Kategorie von WMap (Farbe, Symbol) */
function categoryOf(p) {
  const v = p.subclass ?? p.class;
  return categoryFor(p.class === 'shop' ? { shop: v } : { amenity: v, shop: v, tourism: v, leisure: v, craft: v, office: v });
}

/**
 * @param map
 * @param opts.inside   (Punkt) → steht er in einem Haus? (map/buildings.js)
 * @param opts.onOpen   (Kachel-Objekt) Dialog des Orts öffnen
 * @param opts.onClose  () Dialog wieder schließen
 * @param opts.isOpen   () → ist der Dialog gerade offen?
 */
export function streetShops(map, { inside = () => false, onOpen = () => {}, onClose = () => {}, isOpen = () => false } = {}) {
  let shops = [];                 // { key, name, point, z, color, feat, el }
  let at = null, at0 = 0;         // wo und wann zuletzt gesammelt
  let box = null;
  let seen = new Set();           // sichtbar beim letzten Prüfen (Häuser dazwischen?)
  let checked = 0;
  // Hinschauen: { key, since } – Kandidat; open: { key, auto } – offen; dismissed: selbst geschlossen
  let gaze = null, open = null, dismissed = null, away = 0;
  // Aus Overpass je Feld „x/y“: { walls, roofs, trees } (map/buildings.js streetMesh); `cellBusy`: eins zur Zeit
  const cells = new Map();
  let cellBusy = false, cellFail = 0;

  function mount() {
    box = Object.assign(document.createElement('div'), { className: 'street-labels' });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
      const key = e.target.closest('[data-shop]')?.dataset.shop;
      const s = shops.find((x) => x.key === key);
      if (!s) return;
      open = { key, auto: false };
      onOpen(s.feat);
    });
    document.body.append(box);
  }

  /** Geschäfte und Haltestellen im Umkreis sammeln (aus den Kacheln) */
  function collect(pos) {
    const found = new Map(), tileStops = [], shelters = [];
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })) {
      if (f.geometry.type !== 'Point') continue;
      const p = f.properties, point = f.geometry.coordinates;
      const [dx, dy] = meters(pos, point);
      if (Math.hypot(dx, dy) > NEAR) continue;
      if (isStopPoi(p)) { tileStops.push(stopOf(f)); continue; }
      if (isShelterPoi(p)) { shelters.push(point); continue; }
      const name = nameOf(p);
      if (!name || SKIP.has(p.class) || SKIP.has(p.subclass)) continue;
      const key = `${name}|${point[0].toFixed(5)}|${point[1].toFixed(5)}`;
      if (found.has(key)) continue;
      const mark = LANDMARK[p.subclass] ?? LANDMARK[p.class];
      const cat = mark ? null : categoryOf(p);
      found.set(key, mark ? { key, name, point, color: null, icon: mark, landmark: true, feat: f }
        : { key, name, point, color: cat?.color ?? OTHER, icon: cat?.icon ?? 'storefront', feat: f });
    }
    // Haltestellen: auch als Knopf über dem Schild (antippen öffnet die Abfahrten)
    const list = placeStops(map, tileStops, shelters, pos, NEAR);
    for (const x of list) {
      if (!x.name || !x.feat) continue;
      const key = `H|${x.name}|${x.point[0].toFixed(5)}|${x.point[1].toFixed(5)}`;
      found.set(key, { key, name: x.name, point: x.point, color: null, icon: x.rail ? 'tram' : 'directions_bus', stop: true, feat: x.feat });
    }
    // Namen behalten, die schon da sind (sonst flackern sie beim Neu-Sammeln)
    const old = new Map(shops.map((s) => [s.key, s]));
    for (const s of old.values()) if (!found.has(s.key)) s.el?.remove();
    shops = [...found.values()].map((s) => {
      // Geländehöhe misst frame() – nur für Namen im Bild (queryTerrainElevation ist teuer)
      const o = old.get(s.key);
      if (o) return o;
      s.z = null; s.zAt = 0;
      s.wall = s.stop ? null : undefined;   // Wand zur Straße: wird gleich gesucht (Haltestellen schweben)
      s.el = Object.assign(document.createElement('button'), { type: 'button', className: 'street-label' });
      s.el.dataset.shop = s.key;
      if (s.color) s.el.style.setProperty('--c', s.color);
      s.el.classList.toggle('landmark', !!s.landmark);
      s.el.classList.toggle('stop', !!s.stop);
      s.el.innerHTML = s.stop ? `<b class="h">H</b>${esc(s.name)}<span class="msr more">chevron_right</span>`
        : `<span class="msr">${esc(s.icon)}</span>${esc(s.name)}`;
      s.el.hidden = true;
      box.append(s.el);
      return s;
    });
    // Bild aus OSM (gleicher Name, höchstens 60 m weg): klein vorn im Schild – das Schild wird neu vermessen
    const pics = detailsNear(pos).pics;
    for (const s of shops) {
      if (s.stop || s.pic || !pics.length) continue;
      const want = s.name.toLowerCase();
      const hit = pics.find((x) => x.name.toLowerCase() === want && Math.hypot(...meters(s.point, x.point)) < 60);
      if (!hit) continue;
      s.pic = hit.image;
      s.el.querySelector('.msr')?.remove();
      s.el.insertAdjacentHTML('afterbegin', `<img class="pic" src="${esc(hit.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`);
      s.wall = undefined;
    }
    findWalls(shops.filter((s) => s.wall === undefined));
    loadDetails(pos);
    const details = detailsNear(pos);
    // Steht dort schon ein Dach auf Pfosten aus OSM, kein zweites Häuschen
    for (const x of list) if (x.shelter && details.roofs.some((r) => closest(x.point, r.ring).d < 6)) x.shelter = false;
    const placed = list.filter((x) => x.dir != null);
    nearStops = list;
    map.wmapBuildings?.setStreetThings({ shops: shops.filter((s) => s.color).map((s) => ({ point: s.point, color: s.color })), stops: placed, details });
  }

  /**
   * Wand, an die der Name kommt: im Haus, in dem das Geschäft liegt, die Seite, die ihm am nächsten ist und vor der
   * kein Haus steht (die zur Straße). → s.wall = { a, b, n (nach außen, Meter Ost/Nord) } oder null (schwebt).
   * Dazu einmal die Größe des Schilds messen (in SIGN_PX gesetzt).
   */
  function findWalls(list) {
    if (!list.length) return;
    const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
    for (const s of list) {
      s.wall = null;
      let best = Infinity;
      for (const f of feats) {
        const g = f.geometry;
        for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) {
          const ring = poly[0];
          if (!ring?.length || Math.abs(ring[0][0] - s.point[0]) > 0.003 || Math.abs(ring[0][1] - s.point[1]) > 0.002) continue;
          const r = ring.map((q) => meters(s.point, q));
          if (!inRing([0, 0], r)) continue;
          for (let i = 1; i < r.length; i += 1) {
            const [ax, ay] = r[i - 1], [bx, by] = r[i];
            const len = Math.hypot(bx - ax, by - ay);
            if (len < 2.5) continue;
            const t = Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / (len * len)));
            const d = Math.hypot(ax + t * (bx - ax), ay + t * (by - ay));
            if (d >= best) continue;
            // Normale nach außen: die Seite, auf der die Mitte nicht im eigenen Grundriss liegt
            let n = [(by - ay) / len, -(bx - ax) / len];
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            if (inRing([mx + n[0] * 0.5, my + n[1] * 0.5], r)) n = [-n[0], -n[1]];
            const out = offset(s.point, [mx + n[0] * 2, my + n[1] * 2]);
            if (inside(out)) continue;                    // Nachbarhaus davor – keine Straßenseite
            best = d;
            s.wall = { a: ring[i - 1], b: ring[i], n, len };
          }
        }
      }
    }
    // Größe des Schilds: alle setzen, dann alle lesen (ein Layout statt vieler)
    for (const s of list) { s.el.style.fontSize = `${SIGN_PX}px`; s.el.style.transform = 'none'; s.el.style.visibility = 'hidden'; s.el.hidden = false; }
    for (const s of list) { s.signW = s.el.offsetWidth; s.signH = s.el.offsetHeight; }
    for (const s of list) { s.el.style.visibility = ''; s.el.hidden = true; }
  }

  /** Details der Felder im Umkreis zusammen */
  function detailsNear(pos) {
    const out = { id: '', walls: [], roofs: [], trees: [], shapes: [], pics: [] };
    for (const key of cellsNear(pos)) {
      const c = cells.get(key);
      if (!c?.data) continue;
      out.id += `${key};`;
      out.walls.push(...c.data.walls);
      out.roofs.push(...c.data.roofs);
      out.trees.push(...c.data.trees);
      out.shapes.push(...(c.data.shapes ?? []));
      out.pics.push(...(c.data.pics ?? []));
    }
    out.trees = out.trees.slice(0, 2500);
    return out;
  }
  let nearStops = [];

  /** Felder des Rasters, die näher als DETAIL_R liegen – das eigene zuerst */
  function cellsNear([lon, lat]) {
    const n = 2 ** CELL_Z;
    const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const size = (40075016 * Math.cos(lat * RAD)) / n;          // Breite eines Felds (m)
    const out = [`${x}/${y}`];
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (!dx && !dy) continue;
        // Abstand bis zum Rand des Nachbarfelds
        const ex = dx < 0 ? (fx - x) * size : dx > 0 ? (x + 1 - fx) * size : 0;
        const ey = dy < 0 ? (fy - y) * size : dy > 0 ? (y + 1 - fy) * size : 0;
        if (Math.hypot(ex, ey) < DETAIL_R) out.push(`${x + dx}/${y + dy}`);
      }
    }
    return out;
  }

  /*
   * Was die Kacheln nicht kennen, aus Overpass – je Feld einmal (gemerkt in Cache Storage, 30 Tage):
   *   Mauern   barrier=wall/city_wall/retaining_wall, historic=citywalls – Höhe und Breite aus OSM, sonst üblich
   *   Dächer   building=roof/shelter/carport, Unterstände als Fläche (amenity=shelter): Dach auf Pfosten statt Klotz
   *   Bäume    natural=tree, Baumreihen (alle 8 m ein Baum)
   *   Formen   Häuser und Hausteile mit roof:shape oder roof:colour – Satteldach, Walmdach …, Dach- und Hausfarbe
   * Ein Feld nach dem anderen, im Hintergrund; nach einem Fehler erst 60 s später wieder.
   */
  async function loadDetails(pos) {
    if (cellBusy || Date.now() - cellFail < 60000) return;
    const key = cellsNear(pos).find((k) => !cells.has(k));
    if (!key) return;
    cellBusy = true;
    try {
      const data = (await fromStore(key)) ?? await fromOverpass(key);
      cells.set(key, { data });
      at0 = 0;                       // gleich neu sammeln
    } catch { cellFail = Date.now(); }
    finally { cellBusy = false; }
  }

  async function fromStore(key) {
    try {
      const res = await (await caches.open(STORE)).match(storeUrl(key));
      const v = res && await res.json();
      return v && Date.now() - v.at < KEEP_MS ? v.data : null;
    } catch { return null; }
  }
  // v3: mit Dachformen und Bildern
  const storeUrl = (key) => new URL(`__street/v3/${CELL_Z}/${key}.json`, location.href).href;

  async function fromOverpass(key) {
    const [x, y] = key.split('/').map(Number), n = 2 ** CELL_Z;
    const lon = (i) => (i / n) * 360 - 180, lat = (j) => Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) / RAD;
    const B = `(${lat(y + 1).toFixed(6)},${lon(x).toFixed(6)},${lat(y).toFixed(6)},${lon(x + 1).toFixed(6)})`;
    const els = await overpass(`[out:json][timeout:20];(way[barrier~"^(wall|city_wall|retaining_wall)$"]${B};way[historic=citywalls]${B};`
      + `way[building~"^(roof|shelter|carport)$"]${B};way[amenity=shelter]${B};node[natural=tree]${B};way[natural=tree_row]${B};`
      + `way[building]["roof:shape"]${B};way["building:part"]["roof:shape"]${B};way[building]["roof:colour"]${B};`
      + `nwr[name][image]${B};nwr[name][wikimedia_commons]${B};);out geom tags 8000;`,
    null, { background: true });
    const num = (v, d) => { const k = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(k) && k > 0 ? k : d; };
    const line = (e) => (e.geometry ?? []).filter(Boolean).map((g) => [+g.lon.toFixed(7), +g.lat.toFixed(7)]);
    const walls = [], roofs = [], trees = [], shapes = [], pics = [];
    for (const e of els) {
      const tags = e.tags ?? {};
      // Bild eines Orts (Mitte: Punkt bzw. Mittel der Ecken) – das Haus selbst kann zudem eine Dachform haben
      const pic = tags.name && thumbOf(tags);
      if (pic) {
        const g = e.type === 'node' ? [[e.lon, e.lat]] : line(e);
        if (g.length) pics.push({ name: tags.name, image: pic, point: [g.reduce((a, q) => a + q[0], 0) / g.length, g.reduce((a, q) => a + q[1], 0) / g.length] });
      }
      // Dachform bzw. -farbe eines Hauses (Dächer auf Pfosten zählen unten als Dach)
      if (e.type === 'way' && (tags['roof:shape'] || tags['roof:colour']) && !['roof', 'shelter', 'carport'].includes(tags.building)) {
        const ring = line(e);
        if (ring.length >= 4) {
          shapes.push({ id: e.id, ring, shape: tags['roof:shape'] ?? 'flat', height: tags['roof:height'] ? num(tags['roof:height'], null) : null,
            orientation: tags['roof:orientation'] ?? null, colour: tags['building:colour'] ?? null, roofColour: tags['roof:colour'] ?? null });
        }
        continue;
      }
      const kind = tags.historic === 'citywalls' ? 'city_wall' : tags.barrier;
      if (e.type === 'way' && ['wall', 'city_wall', 'retaining_wall'].includes(kind)) {
        walls.push({ line: line(e), height: num(tags.height, kind === 'city_wall' ? 6 : kind === 'retaining_wall' ? 1.2 : 2), width: num(tags.width, kind === 'city_wall' ? 1.5 : 0.4) });
      } else if (e.type === 'way' && (['roof', 'shelter', 'carport'].includes(tags.building) || tags.amenity === 'shelter')) {
        const ring = line(e);
        if (ring.length >= 4 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) roofs.push({ ring, height: num(tags.height, 3.2) });
      } else if (tags.natural === 'tree' && e.type === 'node') {
        trees.push({ point: [e.lon, e.lat], height: num(tags.height, 9), crown: num(tags.diameter_crown, 0) });
      } else if (tags.natural === 'tree_row' && e.type === 'way') {
        const l = line(e);
        for (let i = 1; i < l.length; i += 1) {
          const d = Math.hypot(...meters(l[i - 1], l[i]));
          for (let m = 0; m < d; m += 8) trees.push({ point: [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * (m / d), l[i - 1][1] + (l[i][1] - l[i - 1][1]) * (m / d)], height: num(tags.height, 10) });
        }
      }
    }
    const data = { walls, roofs, trees, shapes, pics };
    // Leer kann auch heißen: Server überlastet (Overpass antwortet dann mit leerer Liste) – nur für diese Sitzung
    if (!walls.length && !roofs.length && !trees.length && !shapes.length && !pics.length) return data;
    try {
      await (await caches.open(STORE)).put(storeUrl(key), new Response(JSON.stringify({ at: Date.now(), data }), { headers: { 'Content-Type': 'application/json' } }));
    } catch { /* ohne Cache Storage: nur für diese Sitzung */ }
    return data;
  }

  /** Haus zwischen Auge und Geschäft? Vom Geschäft aus: erst aus dem eigenen Haus heraus, dann darf keins mehr kommen */
  function visible(pos, s, d) {
    let out = false;
    for (let m = 0; m < d - 1; m += d > 60 ? 3 : 1.5) {
      const k = 1 - m / d;
      const p = [pos[0] + (s.point[0] - pos[0]) * k, pos[1] + (s.point[1] - pos[1]) * k];
      const hit = inside(p);
      if (!hit) out = true; else if (out) return false;
      if (!out && m > 25) return false;     // tief in einem großen Haus
    }
    return true;
  }

  /**
   * Je Bild: Namen an ihre Stelle, Hinschauen auswerten.
   * `cam`: { pos, bearing, look, eye (m über NN), ground (Boden am Standpunkt), fov (Grad senkrecht) }
   */
  function frame(cam, now) {
    if (!box) mount();
    if (!at || now - at0 > 1500 || Math.hypot(...meters(at, cam.pos)) > 15) { collect(cam.pos); at = cam.pos; at0 = now; }
    const check = now - checked > 250;
    if (check) { checked = now; seen = new Set(); }
    const W = innerWidth, H = innerHeight;
    const f = (H / 2) / Math.tan((cam.fov / 2) * RAD);
    const p = cam.look * RAD, b = cam.bearing * RAD;
    // Blickrichtung, rechts, oben (Ost, Nord, Höhe)
    const fw = [Math.sin(p) * Math.sin(b), Math.sin(p) * Math.cos(b), -Math.cos(p)];
    const rt = [Math.cos(b), -Math.sin(b), 0];
    const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    let target = null, targetOff = Infinity;
    const placed = [];            // Rechtecke der schon gesetzten Namen – nähere zuerst, verdeckte fallen weg
    shops.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    const project = ([x, y, h]) => {
      const z = x * fw[0] + y * fw[1] + h * fw[2];
      return [W / 2 + ((x * rt[0] + y * rt[1]) / z) * f, H / 2 - ((x * up[0] + y * up[1] + h * up[2]) / z) * f, z];
    };
    let measure = 4;              // Geländehöhen je Bild höchstens
    for (const s of shops) {
      const [dx, dy] = meters(cam.pos, s.point);
      const d = Math.hypot(dx, dy);
      s.d = d;
      if (d > SHOW || dx * fw[0] + dy * fw[1] < -15) { s.el.hidden = true; continue; }     // zu weit, hinter einem
      // Geländehöhe: erst hier und je Name höchstens alle 5 s – kommt feineres Gelände nach (oder war beim ersten
      // Mal keins da), stünde der Name sonst Dutzende Meter zu tief
      if (measure > 0 && (s.z == null || now - s.zAt > 5000)) { measure -= 1; s.zAt = now; s.z = map.queryTerrainElevation(s.point) ?? s.z; }
      const sign = s.wall && s.signW && d <= SHOW && wallSign(s, cam, project);
      if (sign) {
        if (check && sign.facing && visible(cam.pos, { point: sign.front }, sign.dist)) seen.add(s.key);
        if (!seen.has(s.key) || !sign.facing) { s.el.hidden = true; continue; }
        const xs = sign.quad.map((q) => q[0]), ys = sign.quad.map((q) => q[1]);
        const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        if (r[2] < 0 || r[0] > W || r[3] < 0 || r[1] > H) { s.el.hidden = true; continue; }
        if (r[3] - r[1] >= SIGN.minPx) {
          if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) { s.el.hidden = true; continue; }
          placed.push(r);
          s.el.hidden = false;
          s.el.classList.add('on-wall');
          s.el.style.fontSize = `${SIGN_PX}px`;
          s.el.style.transform = quadMatrix(sign.quad, s.signW, s.signH);
          s.el.style.zIndex = String(1000 - Math.round(d));
          const off = Math.abs((((Math.atan2(dx, dy) / RAD - cam.bearing) % 360) + 540) % 360 - 180);
          if (d <= (s.landmark ? LOOK_AT.landmark : LOOK_AT.dist) && off <= LOOK_AT.off && off < targetOff) { target = s; targetOff = off; }
          continue;
        }
        // Zu klein zum Lesen: schwebt klein vor der Wand
      }
      s.el.classList.remove('on-wall');
      const v = [dx, dy, (s.z ?? cam.ground) + (s.stop ? STOP_UP : s.landmark ? LANDMARK_UP : LABEL_UP) - cam.eye];
      const z = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2];
      if (check && !sign && d <= SHOW && z > 1 && visible(cam.pos, s, d)) seen.add(s.key);
      if (!seen.has(s.key) || z <= 1) { s.el.hidden = true; continue; }
      if (sign && !sign.facing) { s.el.hidden = true; continue; }
      const x = W / 2 + ((v[0] * rt[0] + v[1] * rt[1]) / z) * f;
      const y = H / 2 - ((v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / z) * f;
      if (x < -200 || x > W + 200 || y < -50 || y > H + 50) { s.el.hidden = true; continue; }
      const size = Math.max(9, Math.min(18, 260 / Math.max(d, 1)));
      // Grob geschätzte Größe (ohne das Bild zu vermessen): Breite aus der Zahl der Zeichen
      const w = Math.min(16, s.name.length * 0.58 + 1.6) * size, h = size * 1.6;
      const r = [x - w / 2, y - h, x + w / 2, y];
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) { s.el.hidden = true; continue; }
      placed.push(r);
      s.el.hidden = false;
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      s.el.style.fontSize = `${size.toFixed(1)}px`;
      s.el.style.zIndex = String(1000 - Math.round(d));
      const off = Math.abs((((Math.atan2(dx, dy) / RAD - cam.bearing) % 360) + 540) % 360 - 180);
      if (!s.stop && d <= (s.landmark ? LOOK_AT.landmark : LOOK_AT.dist) && off <= LOOK_AT.off && off < targetOff) { target = s; targetOff = off; }
    }
    lookAt(target, now);
  }

  /**
   * Schild an der Wand: Rechteck auf der Wand (Mitte am Geschäft, so breit wie der Name, höchstens die Wand), 5 cm
   * davor → { quad: vier Bildpunkte (oben links, oben rechts, unten rechts, unten links), facing, front, dist } oder null
   */
  function wallSign(s, cam, project) {
    const { a, b, n, len } = s.wall;
    const pa = meters(cam.pos, a), pb = meters(cam.pos, b), ps = meters(cam.pos, s.point);
    const ex = (pb[0] - pa[0]) / len, ey = (pb[1] - pa[1]) / len;
    // Von außen gesehen läuft die Schrift nach rechts: rechts = Normale um 90° gedreht
    const rx = -n[1], ry = n[0];
    const sx = rx * ex + ry * ey >= 0 ? 1 : -1;
    const hm = Math.min(SIGN.height, (len * 0.92) * (s.signH / s.signW));
    const wm = hm * (s.signW / s.signH);
    let t = (ps[0] - pa[0]) * ex + (ps[1] - pa[1]) * ey;
    t = Math.max(wm / 2 + 0.1, Math.min(len - wm / 2 - 0.1, t));
    const c = [pa[0] + ex * t + n[0] * 0.05, pa[1] + ey * t + n[1] * 0.05];
    // Kamera vor der Wand? (sonst sieht man die Rückseite)
    const facing = -(c[0] * n[0] + c[1] * n[1]) > 0.3;
    const base = (s.z ?? cam.ground) + (s.landmark ? SIGN.landmark : SIGN.bottom) - cam.eye;
    const hx = (ex * sx * wm) / 2, hy = (ey * sx * wm) / 2;
    const corners = [[c[0] - hx, c[1] - hy, base + hm], [c[0] + hx, c[1] + hy, base + hm], [c[0] + hx, c[1] + hy, base], [c[0] - hx, c[1] - hy, base]];
    const quad = corners.map(project);
    if (quad.some((q) => q[2] < 0.5)) return { quad, facing: false };
    const front = offset(cam.pos, [c[0] + n[0] * 0.6, c[1] + n[1] * 0.6]);
    return { quad, facing, front, dist: Math.hypot(c[0], c[1]) };
  }

  function lookAt(target, now) {
    // Selbst geschlossen (Kreuz, Zurück)? Dann gilt es als abgelehnt, bis man woanders hinschaut
    if (open && !isOpen()) { if (open.auto) dismissed = open.key; open = null; }
    if (dismissed && target?.key !== dismissed) dismissed = null;
    for (const s of shops) s.el.classList.toggle('looked', s === target);
    if (!target) {
      gaze = null;
      if (open?.auto && !away) away = now;
      if (open?.auto && now - away > LOOK_AT.leave) { open = null; away = 0; onClose(); }
      return;
    }
    away = 0;
    if (open?.key === target.key || target.key === dismissed) return;
    if (gaze?.key !== target.key) { gaze = { key: target.key, since: now }; return; }
    if (now - gaze.since < LOOK_AT.dwell || (open && !open.auto)) return;
    open = { key: target.key, auto: true };
    onOpen(target.feat);
  }

  return {
    frame,
    /** Haltestelle, an der man steht (bis 15 m) → Name oder null */
    stopAt(pos) {
      let best = 15, name = null;
      for (const x of nearStops) { const d = Math.hypot(...meters(pos, x.point)); if (x.name && d < best) { best = d; name = x.name; } }
      return name;
    },
    stop() {
      if (open?.auto) onClose();
      box?.remove(); box = null;
      shops = []; at = null; open = null; gaze = null; dismissed = null;
      map.wmapBuildings?.setStreetThings({});
    },
  };
}
