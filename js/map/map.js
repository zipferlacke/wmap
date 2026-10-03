/**
 * Karte und eigene Ebenen.
 *
 * Reihenfolge von unten nach oben:
 *   Hervorhebung (Fläche, Linie) → Routen → Straßennamen der Karte →
 *   POIs und Hervorhebungs-Punkte → Hover-Punkt
 * So bleiben Straßennamen über der Route lesbar, Treffer aber obenauf.
 */
import { STYLE_URL, TERRAIN_TILES } from '../core/config.js';
import { local } from '../data/store.js';
import { ask } from '../ui/dialogs.js';
import { byId } from '../core/categories.js';
import { theme } from '../core/theme.js';
import { geo, geolocationApi } from '../core/native.js';
import { smoothGeolocation } from '../core/smooth.js';
import { enhanceDot } from './location-dot.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const fc = (features) => ({ type: 'FeatureCollection', features });

export const ROUTE_COLOR = '#1a73e8';
/**
 * Ab hier zeigt die Navigation die Fahrbahn mit Spuren statt der Routenlinie.
 * Davor wird übergeblendet: Die Spurlinie ist dort genauso breit wie die
 * Routenlinie und löst sie ab; Asphalt und Markierungen kommen danach dazu.
 */
export const ROAD_ZOOM = 16.2;

/** Symbol-Ebenen des Kartenstils mit Geschäften, Parkplätzen, Haltestellen … */
export const BASE_POI_LAYERS = ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'];

/**
 * OSM-Objekt hinter einem POI der Karte. OpenMapTiles kodiert es in der
 * Feature-ID: osm_id · 10 + Typ (1 Knoten, 2 Weg, 3 Relation).
 */
export function osmRef(feature) {
  const id = Number(feature?.id);
  if (!Number.isFinite(id) || id < 10) return null;
  const type = { 1: 'N', 2: 'W', 3: 'R' }[id % 10];
  return type ? { type, id: Math.floor(id / 10) } : null;
}

/**
 * @param opts.snapshot  Bild der Karte auslesbar halten (Vorschaubilder von Touren)
 */
/** Grundkarten: bunt für unterwegs, hell und ruhig für eigene Daten */
export const BASE_STYLES = {
  standard: STYLE_URL,
  hell: 'https://tiles.openfreemap.org/styles/positron',
};

/**
 * Zugangsdaten für private Quellen (Ebenen-Menü → Eigene Quelle): Adress-
 * Anfang → Wert für „Authorization“. Nur im Speicher; die Ebene selbst
 * liegt im Browser (IndexedDB) und trägt sie mit (map/layers.js).
 */
export const AUTH = new Map();

export function createMap(container, {
  center = [9.93, 51.53], zoom = 1.5, pitch = 0, bearing = 0, auto3d = true, snapshot = false, style = STYLE_URL,
} = {}) {
  const map = new maplibregl.Map({
    container,
    transformRequest: (url) => {
      for (const [prefix, auth] of AUTH) if (url.startsWith(prefix)) return { url, headers: { Authorization: auth } };
      return undefined;
    },
    center,
    zoom,
    pitch,
    bearing,
    // Standard sind 60° – für Gelände und Gebäude darf es steiler sein
    maxPitch: 85,
    // Weniger Kacheln im Speicher halten: Standard sind 5 Zoomstufen je Quelle
    // (Vektor, Gelände, Relief, Luftbilder …) – das wächst mit jedem
    // Ortswechsel um Hunderte MB. Zurück ins Bekannte lädt der Service Worker
    // ohnehin aus seinem Cache
    maxTileCacheZoomLevels: 2,
    attributionControl: false,
    // Handys mit 3-facher Pixeldichte zeichnen sonst 2,25-mal so viele Pixel wie
    // bei 2 – kaum schärfer, aber spürbar langsamer und stromhungriger. Aus
    // demselben Grund Kantenglättung nur auf Bildschirmen mit niedriger Dichte.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    canvasContextAttributes: { antialias: (window.devicePixelRatio || 1) < 2, preserveDrawingBuffer: snapshot },
  });
  // Stil erst hier: so lässt er sich vor dem ersten Kachel-Zeichnen anpassen
  map.setStyle(style, { transformStyle: (prev, next) => fixStyle(next) });
  // Fehlende Symbole gleich von Anfang an nachliefern (Kategorien, Spurpfeile,
  // Lücken im Grundstil) – sonst warnt MapLibre für die ersten Kacheln
  map.on('styleimagemissing', (e) => addCategoryIcon(map, e.id));

  /*
   * Kommen Höhendaten später als die Gebäude (langsames Netz), standen Häuser
   * mitunter in der Luft, bis man die Karte bewegte. Nach neuen Höhenkacheln
   * darum einmal neu zeichnen.
   */
  let demRepaint = null;
  map.on('sourcedata', (e) => {
    if (!e.sourceId?.startsWith('terrain') || !e.tile) return;
    clearTimeout(demRepaint);
    demRepaint = setTimeout(() => map.triggerRepaint(), 150);
  });

  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    germanLabels(map);
    calmLabels(map);
    colorBuildings(map);
    rememberColors(map);
    paintTheme(map);
  });
  addEventListener('wmap:theme', () => paintTheme(map));

  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: [
      'Suche: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>',
      'Routing: <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener">Valhalla</a> (FOSSGIS)',
      'Höhen: <a href="https://mapterhorn.com" target="_blank" rel="noopener">Mapterhorn</a>',
      '© 2026 wuefl · <a href="https://wuefl.de/impressum.html">Impressum</a>',
    ],
  }), 'bottom-left');
  collapseAttribution(map.getContainer());
  keepSized(map);
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  // App: Der Punkt auf der Karte nutzt dieselbe Standortabfrage wie die
  // Navigation (Plugin, core/native.js) – in Bewegung jede Sekunde, im Stand
  // seltener bis alle 30 s. Überall geglättet (core/smooth.js): im Stand ruhig, Ausreißer weg
  const base = geo.native ? geolocationApi() : navigator.geolocation;
  if (base) Object.defineProperty(navigator, 'geolocation', { configurable: true, value: smoothGeolocation(base) });
  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    // Kreis ruhig (geglättete Ungenauigkeit), bei genauem Standort weg – map/location-dot.js
    showAccuracyCircle: true,
  });
  map.addControl(geolocate, 'top-right');
  guardGeolocate(map, geolocate);
  // Punkt gleitet, ruhiger Kreis, Blickrichtung (map/location-dot.js)
  enhanceDot(map, geolocate);

  map.on('load', () => {
    // Mapterhorn liefert in Deutschland bis Zoom 16, darüber gibt es nur 404 –
    // ohne Obergrenze fragt MapLibre bis Zoom 18 nach (Fehler, Daten, Strom).
    // Die Kacheladresse direkt statt TileJSON spart außerdem eine Anfrage beim Start.
    // Gelände höchstens so fein wie die Kacheln mit den Häusern (OpenMapTiles:
    // Zoom 14) – feiner rechnet MapLibre die Höhe der 3D-Häuser falsch, sie
    // schweben dann neben ihrem Grundriss („elevation maxzoom > source.maxzoom“).
    // Die Schummerung darunter bleibt bei Zoom 16.
    map.addSource('terrain', { ...DEM_SOURCE, maxzoom: 14 });
    // In der Navigation reicht gröberes Gelände (Zoom 13, ≈ 6 m): weniger Daten,
    // und die Straße liegt ruhiger – feine Höhenfehler lassen sie sonst wellen
    map.addSource('terrain-lo', { ...DEM_SOURCE, maxzoom: 13 });
    // Eigene Quelle für die Schummerung – MapLibre rät davon ab, Gelände und
    // Schummerung aus derselben Quelle zu speisen
    map.addSource('hillshade', { ...DEM_SOURCE });
    map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'hillshade',
      paint: {
        // Nah heran schwächer: Mapterhorn nutzt in Städten teils Oberflächen-
        // modelle, dort erscheinen Häuser als Hügel – „Berge“ um die Gebäude
        // Kräftig genug, dass man Berge und Täler auch flach von oben sieht
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 0.55, 14.5, 0.4, 16, 0.25, 17.5, 0.1],
        ...HILLSHADE.light,
      },
    }, firstRoadLayer(map));
    map.setSky(SKY.light);
    // Weiches Licht von schräg oben – Wände heben sich ab, ohne hart zu wirken
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.32, position: [1.4, 200, 35] });
    map.addControl(new maplibregl.TerrainControl({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION }), 'top-right');
    addLayers(map);
    // Eigene Beschriftungen (Treffer, Punkte) haben weiße Ränder – im Dunkeln mit
    rememberColors(map, (l) => l.type === 'symbol');
    paintTheme(map);
    if (auto3d) autoThreeD(map);

    for (const id of BASE_POI_LAYERS) {
      if (!map.getLayer(id)) continue;
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
  });

  return { map, geolocate };
}

const TERRAIN_EXAGGERATION = 1.5;
/*
 * Höhen: Mapterhorn liefert in Deutschland bis Zoom 16 – bei 512er Kacheln
 * ≈ 0,75 m je Pixel, aus den amtlichen 1-m-Geländemodellen der Länder. Die
 * Schummerung nutzt das volle Maß, das Gelände Zoom 14 (wegen der 3D-Häuser),
 * die Navigation 'terrain-lo'.
 */
const DEM_SOURCE = {
  type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 512, maxzoom: 16, encoding: 'terrarium',
};

/* ── 3D und Datenverbrauch ─────────────────────────────────────────────────
 *
 * Gelände und Schummerung laden eigene Höhenkacheln – das kostet Daten.
 * Im Datensparmodus (Schalter im Menü oder Datensparen des Browsers) bleibt
 * 3D daher aus. Im Mobilfunknetz wird einmal je Sitzung gefragt.
 *
 * Ob Mobilfunk oder WLAN, verraten nur Chromium-Browser (navigator.connection,
 * vor allem Android). Andere Browser gelten als WLAN – dafür ist der Schalter da.
 */

const conn = () => navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;

export function dataSaver() {
  const c = conn();
  return local.get('wmap.datasaver', false) === true || !!c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '');
}

const isCellular = () => conn()?.type === 'cellular';

let asking = null;

/** Einmal je Sitzung im Mobilfunknetz fragen. → Promise<boolean> */
function allow3d() {
  // Ohne Netz keine Höhendaten – sie werden nicht offline gespeichert
  if (dataSaver() || !navigator.onLine) return Promise.resolve(false);
  if (!isCellular()) return Promise.resolve(true);
  let answer = null;
  try { answer = sessionStorage.getItem('wmap.3d.cellular'); } catch { /* egal */ }
  if (answer) return Promise.resolve(answer === 'yes');
  asking ??= askCellular().then((ok) => {
    try { sessionStorage.setItem('wmap.3d.cellular', ok ? 'yes' : 'no'); } catch { /* egal */ }
    asking = null;
    return ok;
  });
  return asking;
}

/** Rückfrage – nicht mitten in das Willkommen oder einen anderen Dialog hinein (`auto`) */
async function askCellular() {
  return await ask({
    auto: true, icon: 'signal_cellular_alt', title: 'Mobilfunk erkannt',
    text: 'Die 3D-Ansicht lädt Gelände- und Höhendaten nach. Im Mobilfunknetz kann das spürbar Datenvolumen kosten. Jetzt aktivieren?',
    buttons: [{ value: 'no', label: 'Bei 2D bleiben' }, { value: 'yes', label: '3D aktivieren', icon: 'view_in_ar', primary: true }],
  }) === 'yes';
}

function applyDataSaver(map) {
  if (map.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', dataSaver() ? 'none' : 'visible');
}

/**
 * 3D von selbst: nah herangezoomt neigt sich die Karte und das Gelände kommt
 * dazu, weit draußen wird sie wieder flach und das Gelände geht aus. Wer
 * selbst neigt oder das Gelände per Knopf schaltet, behält seine Wahl.
 */
function autoThreeD(map) {
  let manualPitch = false;
  let autoPitched = false;
  let terrainOff = false;       // Nutzer hat das Gelände selbst ausgeschaltet
  let autoTerrain = false;      // Gelände haben wir eingeschaltet
  let ours = false;             // das nächste 'terrain'-Ereignis kommt von uns

  applyDataSaver(map);

  /*
   * Überhöhung nach Zoom: weit draußen darf das Relief betont sein, nah dran
   * nicht – sonst stehen Gebäude schief in den Hang gebaut und Straßen wellen
   * sich über Höhenfehler des Modells.
   */
  const exaggeration = () => (map.getZoom() >= 14 ? 1 : map.getZoom() >= 12 ? 1.25 : TERRAIN_EXAGGERATION);
  const source = () => (document.body.classList.contains('navigating') ? 'terrain-lo' : 'terrain');
  const terrain = (on) => {
    // Autobildschirm (car/car.js): ohne Gelände – darübergelegt werden Route
    // und Fahrspuren mit gröberem Zoom gezeichnet und wirken dann blass
    if (document.documentElement.classList.contains('car-mode')) on = false;
    if (!!map.getTerrain() === on) return;
    ours = true;
    map.setTerrain(on ? { source: source(), exaggeration: exaggeration() } : null);
    autoTerrain = on;
  };
  // Navigation an/aus: Gelände in der passenden Auflösung
  new MutationObserver(() => {
    const t = map.getTerrain();
    if (!t || t.source === source()) return;
    ours = true;
    map.setTerrain({ ...t, source: source() });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  map.on('zoomend', () => {
    const t = map.getTerrain();
    if (!t || Math.abs((t.exaggeration ?? 1) - exaggeration()) < 0.01) return;
    ours = true;
    map.setTerrain({ ...t, exaggeration: exaggeration() });
  });

  // Schon geneigt gestartet (wiederhergestellte Ansicht): Gelände gleich dazu
  if (map.getPitch() >= 15) allow3d().then((ok) => { if (ok && !terrainOff) terrain(true); });

  // Funkloch: Gelände aus, sonst fehlen Kacheln und die Karte bekommt Löcher.
  // Oft meldet der Browser trotzdem „online“ – dann verraten es die Fehler.
  window.addEventListener('offline', () => { if (autoTerrain) terrain(false); });
  let demErrors = 0;
  map.on('error', (e) => {
    // 404 ist kein Funkloch; 504 schickt der Service Worker, wenn das Netz fehlt
    if (!['terrain', 'terrain-lo', 'hillshade'].includes(e.sourceId) || (e.error?.status && e.error.status !== 504)) return;
    if (++demErrors < 3 || !map.getTerrain()) return;
    demErrors = 0;
    terrain(false);
    terrainOff = true;
    setTimeout(() => { terrainOff = false; }, 60000);           // später noch mal versuchen
  });
  window.addEventListener('online', async () => {
    if (map.getPitch() >= 15 && !terrainOff && await allow3d()) terrain(true);
  });

  map.on('pitchstart', (e) => { if (e.originalEvent) manualPitch = true; });
  map.on('terrain', () => {
    if (ours) { ours = false; return; }
    terrainOff = !map.getTerrain();
    autoTerrain = false;
  });
  map.on('pitchend', async () => {
    if (map.getPitch() < 15 || map.getTerrain() || terrainOff) return;
    if (await allow3d()) terrain(true);
  });
  map.on('zoomend', async () => {
    // Bewusst eingepasste Übersichten (Route) nicht gleich wieder kippen
    if (map.quietFit) { map.quietFit = false; return; }
    if (document.body.classList.contains('navigating')) return;
    const z = map.getZoom();
    const p = map.getPitch();
    if (z >= 15.5 && p < 5 && !manualPitch) {
      if (!(await allow3d())) return;
      // Inzwischen losgeflogen (neuer Ort)? Dann nicht dazwischenfunken –
      // ein easeTo würde den Flug abbrechen
      if (map.isMoving()) return;
      autoPitched = true;
      map.easeTo({ pitch: 50, duration: 900 });
    } else if (z < 12.5) {
      if (autoPitched && p > 0) map.easeTo({ pitch: 0, duration: 900 });
      if (autoTerrain) terrain(false);
      autoPitched = false;
      manualPitch = false;
    }
  });
}

/**
 * Beschriftung auf Deutsch. Der Stil nimmt `name_en` – daraus wird
 * name:de → name_de → name; bei nicht-lateinischen Namen steht der deutsche
 * vorn und der Originalname darunter.
 */
function germanLabels(map) {
  for (const layer of map.getStyle().layers) {
    const tf = layer.layout?.['text-field'];
    if (!tf || typeof tf !== 'object') continue;
    const before = JSON.stringify(tf);
    if (!before.includes('name')) continue;
    const after = before
      .replaceAll('["get","name_en"]', '["get","name:de"],["get","name_de"]')
      .replaceAll('["concat",["get","name:latin"]', '["concat",["coalesce",["get","name:de"],["get","name:latin"]]');
    if (after !== before) map.setLayoutProperty(layer.id, 'text-field', JSON.parse(after));
  }
}

/**
 * Gebäude einfärben: Farbe aus OSM (building:colour/material → `colour`),
 * sonst warme Töne, die mit der Höhe dunkler werden. So heben sich Hochhäuser
 * ab, ohne dass die Karte bunt wird.
 */
/**
 * Grundstil vor dem ersten Zeichnen richten: Er rechnet mit Werten, die nicht
 * jedes Objekt hat (Gebäudehöhe, Rang eines Ortes, Verwaltungsebene). Fehlt
 * einer, warnt MapLibre je Kachel „Expected value to be of type number, but
 * found null“. Höhen bekommen 0, Vergleiche in Filtern vorher ein „has“ –
 * Objekte ohne Wert fallen dann wie bisher heraus, nur ohne Warnung.
 */
const COMPARE = new Set(['<', '<=', '>', '>=']);
function guardCompare(e) {
  if (!Array.isArray(e)) return e;
  const out = e.map(guardCompare);
  const get = out.find((a, i) => i > 0 && Array.isArray(a) && a[0] === 'get' && typeof a[1] === 'string' && a.length === 2);
  return COMPARE.has(out[0]) && get ? ['all', ['has', get[1]], out] : out;
}
function fixStyle(style) {
  for (const l of style.layers ?? []) {
    if (Array.isArray(l.filter)) l.filter = guardCompare(l.filter);
  }
  const b = style.layers?.find((l) => l.id === 'building-3d');
  if (b?.paint) {
    b.paint['fill-extrusion-height'] = ['coalesce', ['get', 'render_height'], 0];
    b.paint['fill-extrusion-base'] = ['coalesce', ['get', 'render_min_height'], 0];
  }
  return style;
}

function colorBuildings(map) {
  // Wände: helle, warme Töne mit leichter Streuung je Gebäude, hohe Häuser
  // etwas kühler – eine Stadt, kein Einheitsgrau. Das OSM-Tag „colour“ bleibt
  // außen vor: dort steht oft „red“ oder „magenta“, das leuchtet dann grell.
  // Die Wände deutlich dunkler als der Boden – sonst verschwimmen Hauskante
  // und Straße, und man sieht nicht, wie hoch ein Haus ist.
  const wall = ['case',
    ['>=', ['coalesce', ['get', 'render_height'], 0], 40],
    ['match', ['%', ['to-number', ['id'], 0], 3], 0, '#aab1bd', 1, '#9ea7b5', '#b3b6be'],
    ['match', ['%', ['to-number', ['id'], 0], 4], 0, '#d6c7b1', 1, '#cbbba5', 2, '#dbd0c0', '#c7b8a4']];
  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-color', wall);
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.96);
    map.setPaintProperty('building-3d', 'fill-extrusion-vertical-gradient', true);
    addShadows(map);
    addRoofs(map);
  }
  // Licht fest aus Südwest statt vom Bildschirm aus: Jede Hausseite bekommt
  // ihre eigene Helligkeit, Ecken und Höhen werden sichtbar
  map.setLight({ anchor: 'map', position: [1.3, 225, 50], color: '#ffffff', intensity: 0.55 });
  if (map.getLayer('building')) map.setPaintProperty('building', 'fill-color', wall);
}

/**
 * Schatten am Boden: der Grundriss dunkel und leicht nach Nordost versetzt.
 * Zeigt, wo ein Haus auf dem Boden steht – das Auge liest daraus die Höhe.
 */
function addShadows(map) {
  const base = map.getStyle().layers.find((l) => l.id === 'building-3d');
  if (!base || map.getLayer('building-shadow')) return;
  map.addLayer({
    id: 'building-shadow',
    type: 'fill',
    source: base.source,
    'source-layer': base['source-layer'],
    minzoom: 15,
    ...(base.filter ? { filter: base.filter } : {}),
    paint: {
      'fill-color': '#5b5046',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.22],
      'fill-translate': ['interpolate', ['exponential', 2], ['zoom'], 15, ['literal', [1, -1]], 19, ['literal', [14, -14]]],
      'fill-translate-anchor': 'map',
      'fill-antialias': false,
    },
  }, 'building-3d');
}

/**
 * Dächer als flache Scheibe oben auf jedem Gebäude – so wie bei Streets GL,
 * nur ohne Dachformen. Niedrige Häuser bekommen Ziegeltöne, hohe Grau.
 */
function addRoofs(map) {
  const base = map.getStyle().layers.find((l) => l.id === 'building-3d');
  if (!base || map.getLayer('building-roof')) return;
  const h = ['coalesce', ['get', 'render_height'], 0];
  const low = ['match', ['%', ['to-number', ['id'], 0], 4],
    0, '#a8624d', 1, '#8e5a4a', 2, '#7d7f86', '#b07a5c'];
  map.addLayer({
    id: 'building-roof',
    type: 'fill-extrusion',
    source: base.source,
    'source-layer': base['source-layer'],
    minzoom: Math.max(base.minzoom ?? 14, 15),
    ...(base.filter ? { filter: base.filter } : {}),
    paint: {
      'fill-extrusion-base': h,
      'fill-extrusion-height': ['+', h, 0.8],
      'fill-extrusion-color': ['case', ['>=', h, 25], '#8d939c', low],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.95],
    },
  }, map.getStyle().layers[map.getStyle().layers.findIndex((l) => l.id === 'building-3d') + 1]?.id);
}

/**
 * Straßennamen und Nummernschilder seltener wiederholen. Geneigt stehen sonst
 * alle paar Meter „B 446“ auf derselben Straße.
 */
let shieldPitch = null;

function calmLabels(map) {
  // Geneigt stehen am Horizont viele kleine Schilder übereinander – dann nur
  // Autobahnen und Bundesstraßen (A, B, E) beschildern
  const shields = map.getStyle().layers.filter((l) => l.type === 'symbol' && /shield/.test(l.id));
  const plain = new Map(shields.map((l) => [l.id, l.filter ?? true]));
  const big = ['match', ['slice', ['to-string', ['get', 'ref']], 0, 1], ['A', 'B', 'E'], true, false];
  let pitched = null;
  const onPitch = () => {
    const now = map.getPitch() >= 50;
    if (now === pitched) return;
    pitched = now;
    for (const [id, f] of plain) if (map.getLayer(id)) map.setFilter(id, now ? ['all', f, big] : f);
  };
  if (shieldPitch) map.off('pitchend', shieldPitch);
  shieldPitch = onPitch;
  map.on('pitchend', onPitch);
  onPitch();
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    // Geneigt setzt jede Kachel ihr eigenes Schild – mit Abstand drumherum
    // verdrängen sich die dicht aufeinanderfolgenden gegenseitig
    if (/shield/.test(layer.id)) {
      map.setLayoutProperty(layer.id, 'symbol-spacing', 1200);
      map.setLayoutProperty(layer.id, 'icon-padding', 60);
      map.setLayoutProperty(layer.id, 'text-padding', 60);
    } else if (/^highway-name/.test(layer.id)) {
      map.setLayoutProperty(layer.id, 'symbol-spacing', 700);
      map.setLayoutProperty(layer.id, 'text-padding', 40);
    }
  }
}

/* ── Hell und dunkel ───────────────────────────────────────────────────────
 *
 * Im dunklen Modus (core/theme.js) wird der helle Kartenstil umgefärbt, statt einen
 * dunklen zu laden: So bleiben 3D-Gebäude, POIs und alle eigenen Ebenen, und
 * der Wechsel geht ohne Neuladen. Hell wird dunkel und umgekehrt, der Farbton
 * bleibt – Wasser bleibt blau, Wald grün, Autobahnen orange.
 */
const HILLSHADE = {
  light: {
    'hillshade-shadow-color': 'rgba(60, 45, 20, 0.55)',
    'hillshade-highlight-color': 'rgba(255, 255, 255, 0.35)',
    'hillshade-accent-color': 'rgba(60, 45, 20, 0.25)',
  },
  dark: {
    'hillshade-shadow-color': 'rgba(0, 0, 0, 0.6)',
    'hillshade-highlight-color': 'rgba(255, 255, 255, 0.07)',
    'hillshade-accent-color': 'rgba(0, 0, 0, 0.3)',
  },
};
const SKY_BLEND = {
  'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 1, 12, 0],
};
const SKY = {
  light: { 'sky-color': '#8fb8e8', 'horizon-color': '#dce9f7', 'fog-color': '#eef2f6', ...SKY_BLEND },
  dark: { 'sky-color': '#0c1522', 'horizon-color': '#243346', 'fog-color': '#161b22', ...SKY_BLEND },
};

/** Helle Farben je Karte: Ebene → { Eigenschaft: Wert } */
const lightColors = new WeakMap();

/** Die hellen Farben merken – einmal nach dem Laden des Stils, dann für eigene Ebenen */
function rememberColors(map, pick = () => true) {
  const known = lightColors.get(map) ?? new Map();
  for (const l of map.getStyle().layers) {
    if (known.has(l.id) || l.id === 'building-shadow' || !pick(l)) continue;
    const props = {};
    for (const [k, v] of Object.entries(l.paint ?? {})) if (k.endsWith('-color')) props[k] = v;
    if (l.type === 'raster') props['raster-brightness-max'] = l.paint?.['raster-brightness-max'] ?? 1;
    if (Object.keys(props).length) known.set(l.id, { role: colorRole(l), props });
  }
  lightColors.set(map, known);
}

function colorRole(l) {
  if (l.type === 'line') return 'line';
  if (l.type === 'fill-extrusion') return 'building';
  if (l.type === 'symbol') return 'text';
  return 'area';
}

/** Welche Karten gerade dunkel gezeichnet sind – hell ab Start braucht nichts */
const painted = new WeakMap();

function paintTheme(map) {
  const dark = theme.dark;
  if (!dark && !painted.get(map)) return;
  painted.set(map, dark);
  for (const [id, { role, props }] of lightColors.get(map) ?? []) {
    if (!map.getLayer(id)) continue;
    for (const [k, v] of Object.entries(props)) {
      let value = v;
      if (dark) {
        if (k === 'raster-brightness-max') value = 0.5;
        else value = darkColors(v, /halo/.test(k) ? 'halo' : role === 'text' ? 'text' : role);
      }
      map.setPaintProperty(id, k, value);
    }
  }
  if (map.getLayer('hillshade')) {
    for (const [k, v] of Object.entries(HILLSHADE[dark ? 'dark' : 'light'])) map.setPaintProperty('hillshade', k, v);
  }
  if (map.getSource('terrain')) map.setSky(SKY[dark ? 'dark' : 'light']);
}

/** Alle Farben in einem Wert (auch in Ausdrücken) umfärben */
function darkColors(value, role) {
  if (typeof value === 'string') {
    const c = parseColor(value);
    return c ? darken(c, role) : value;
  }
  if (Array.isArray(value)) return value.map((x) => darkColors(x, role));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, darkColors(v, role)]));
  }
  return value;
}

/**
 * Helligkeit umkehren, Farbton behalten:
 *   Flächen  hell → sehr dunkel (Boden ≈ 9 %, Wasser, Wald, Häuser etwas heller;
 *            Häuser fast ohne Farbe)
 *   Linien   bleiben in ihrer Reihenfolge, nur dunkler – Straßen heller als der Boden
 *   Schrift  dunkel → hell, der Rand darum dunkel
 */
function darken({ h, s, l, a }, role) {
  let nl;
  if (role === 'text') nl = 1 - l * 0.85;
  else if (role === 'halo') nl = 0.08 + (1 - l) * 0.15;
  else if (role === 'line') nl = 0.16 + l * 0.3;
  else nl = 0.08 + (1 - l) * 0.45;
  // Häuser fast grau – rote Dächer und warme Wände wirkten nachts braun
  const ns = role === 'text' ? s : role === 'building' ? s * 0.3 : s * 0.75;
  return `hsla(${Math.round(h)}, ${Math.round(ns * 100)}%, ${Math.round(nl * 100)}%, ${+a.toFixed(3)})`;
}

/** '#rgb', '#rrggbb(aa)', 'rgb(a)(…)', 'hsl(a)(…)' → { h, s, l, a } (0–360, 0–1) */
function parseColor(str) {
  const t = str.trim().toLowerCase();
  let r, g, b, a = 1;
  if (t.startsWith('#')) {
    const hex = t.slice(1);
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    if (full.length === 8) a = parseInt(full.slice(6, 8), 16) / 255;
  } else {
    const m = t.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
    if (!m) return null;
    // Prozente als Anteil; rgb ohne % in 0–255
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    const n = parts.map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    if (n.length < 3 || n.some(Number.isNaN)) return null;
    if (n.length > 3) a = n[3];
    if (m[1].startsWith('hsl')) return { h: n[0], s: n[1], l: n[2], a };
    [r, g, b] = n.slice(0, 3).map((x, i) => (parts[i].endsWith('%') ? x : x / 255));
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l, a };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l, a };
}

export function firstRoadLayer(map) {
  return map.getStyle().layers.find((l) => /^(tunnel|road|highway|bridge)/.test(l.id))?.id;
}

/**
 * Attribution nur als (i) – aufgeklappt wird sie erst, wenn man draufdrückt.
 * Die Quellen stehen ausführlich in den Einstellungen („Über WMap“); in der
 * Navigation ist das (i) ganz ausgeblendet (CSS).
 *
 * MapLibre klappt sie beim Start und bei jeder neuen Quelle von selbst auf –
 * das wird sofort wieder zurückgenommen, außer man hat selbst getippt.
 */
function collapseAttribution(container) {
  const el = container.querySelector('.maplibregl-ctrl-attrib');
  if (!el) return;
  let byUser = false;
  const collapse = () => {
    if (el.classList.contains('maplibregl-compact-show')) el.classList.remove('maplibregl-compact-show');
  };
  el.addEventListener('click', () => { byUser = true; }, true);
  new MutationObserver(() => {
    if (!byUser) collapse();
    byUser = false;
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
  collapse();
}

function firstLabelLayer(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol' && /label|name/.test(l.id))?.id;
}

function addLayers(map) {
  for (const id of ['reach', 'highlight-shapes', 'highlight-points', 'routes', 'traffic', 'pois', 'hover', 'nav-arrows', 'nav-signals', 'nav-road']) {
    map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  const labels = firstLabelLayer(map);
  // Route unter die 3D-Häuser: Gebäude verdecken sie, wie in echt
  const under = map.getLayer('building-3d') ? 'building-3d' : labels;

  /* Erreichbarkeit: Flächen je Zeit/Strecke, kleinere obenauf */
  map.addLayer({
    id: 'reach-fill', type: 'fill', source: 'reach',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 },
  }, labels);
  map.addLayer({
    id: 'reach-line', type: 'line', source: 'reach',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.85 },
  }, labels);

  /* Hervorhebung: Flächen, Umrisse, Linien */
  map.addLayer({
    id: 'hl-fill', type: 'fill', source: 'highlight-shapes',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
  }, labels);
  map.addLayer({
    id: 'hl-glow', type: 'line', source: 'highlight-shapes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'], 'line-opacity': 0.35, 'line-blur': 3,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 14],
    },
  }, labels);
  map.addLayer({
    id: 'hl-line', type: 'line', source: 'highlight-shapes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 4] },
  }, labels);

  /* Routen: Alternativen durchscheinend, gewählte Route kräftig mit Rand.
     Wo die Navigation die Fahrbahn mit Spuren zeichnet (covered), tritt
     die Linie nah dran zurück. */
  // Bus & Bahn: nicht gewählte Abschnitte treten zurück
  const legOp = ['case', ['boolean', ['get', 'dim'], false], 0.3, 1];
  const hideCovered = ['interpolate', ['linear'], ['zoom'], ROAD_ZOOM - 0.3, legOp, ROAD_ZOOM, ['case', ['boolean', ['get', 'covered'], false], 0, legOp]];
  // Einblenden über eine Zoomspanne – nicht über minzoom: Geneigt kommen die
  // Kacheln weiter hinten aus kleineren Zoomstufen, dort fehlte die Ebene sonst
  const fade = (z0, z1, o = 1) => ['interpolate', ['linear'], ['zoom'], z0, 0, z1, o];
  map.addLayer({
    id: 'route-alt', type: 'line', source: 'routes',
    filter: ['!', ['get', 'selected']],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      // Alternativen deutlich sichtbar – blass und schmal waren sie auf dem Autobildschirm kaum zu treffen
      'line-color': ROUTE_COLOR, 'line-opacity': 0.62,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5.5, 14, 10],
    },
  }, under);
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'routes',
    filter: ['get', 'selected'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 9.5, 14, 15],
      'line-opacity': hideCovered,
    },
  }, under);
  map.addLayer({
    id: 'route-main', type: 'line', source: 'routes',
    filter: ['all', ['get', 'selected'], ['!', ['boolean', ['get', 'walk'], false]]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      // Bus & Bahn: jede Fahrt in der Farbe ihrer Linie
      'line-color': ['coalesce', ['get', 'color'], ROUTE_COLOR], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 6.5, 14, 11],
      'line-opacity': hideCovered,
    },
  }, under);
  // Fußwege zwischen den Fahrten: gestrichelt
  map.addLayer({
    id: 'route-walk', type: 'line', source: 'routes',
    filter: ['all', ['get', 'selected'], ['boolean', ['get', 'walk'], false]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#495057', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 5],
      'line-dasharray': [0.1, 1.8], 'line-opacity': legOp,
    },
  }, under);
  // Bus & Bahn: Punkte an Ein- und Ausstieg (Umstiege)
  map.addLayer({
    id: 'route-dots', type: 'circle', source: 'routes',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['boolean', ['get', 'stopDot'], false]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 14, 6.5],
      'circle-color': '#ffffff', 'circle-stroke-color': ['coalesce', ['get', 'color'], ROUTE_COLOR],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 3.5],
      'circle-opacity': legOp, 'circle-stroke-opacity': legOp,
    },
  }, under);

  /*
   * Fahrbahn entlang der Route (nav-extras roadFeatures): Asphalt in echter
   * Breite, Ränder, Mittellinie, Spurtrennung, die richtige(n) Spur(en) in
   * Routenfarbe und Pfeile auf dem Asphalt. Breite und Versatz stehen in
   * Metern (m, off) und k = Pixel je Meter bei Zoom 0 – exponentiell zur
   * Basis 2 bleibt das auf jeder Zoomstufe maßstabsgetreu.
   */
  const meters = (prop, min = 0, add = 0) => ['interpolate', ['exponential', 2], ['zoom'],
    10, ['+', add, ['max', min, ['*', ['get', prop], ['*', ['get', 'k'], 1024]]]],
    24, ['+', add, ['max', min, ['*', ['get', prop], ['*', ['get', 'k'], 16777216]]]]];
  const offset = ['interpolate', ['exponential', 2], ['zoom'],
    10, ['*', ['get', 'off'], ['*', ['get', 'k'], 1024]],
    24, ['*', ['get', 'off'], ['*', ['get', 'k'], 16777216]]];
  const roadLine = (id, kind, paint) => map.addLayer({
    id, type: 'line', source: 'nav-road',
    filter: ['==', ['get', 'kind'], kind],
    layout: { 'line-join': 'round', 'line-cap': 'butt' },
    paint: { 'line-offset': offset, ...paint },
  }, under);
  const Z = ROAD_ZOOM;
  // Weißer Rand um die Spurlinie, solange noch kein Asphalt darunter liegt
  roadLine('nav-road-track-casing', 'track', {
    'line-color': '#ffffff', 'line-width': meters('m', 8, 4),
    'line-opacity': ['interpolate', ['linear'], ['zoom'], Z - 0.3, 0, Z, 1, Z + 0.1, 1, Z + 0.4, 0],
  });
  map.addLayer({
    id: 'nav-road-asphalt', type: 'fill', source: 'nav-road',
    filter: ['==', ['get', 'kind'], 'asphalt'],
    paint: { 'fill-color': '#7b8089', 'fill-opacity': fade(Z - 0.1, Z + 0.4) },
  }, under);
  // So breit wie die Routenlinie (8 px), nah dran so breit wie die Spur
  roadLine('nav-road-track', 'track', { 'line-color': ROUTE_COLOR, 'line-width': meters('m', 8), 'line-opacity': fade(Z - 0.3, Z) });
  roadLine('nav-road-edge', 'edge', { 'line-color': '#ffffff', 'line-width': meters('m', 0.6), 'line-opacity': fade(Z + 0.2, Z + 0.6, 0.9) });
  roadLine('nav-road-mid', 'mid', { 'line-color': '#ffffff', 'line-width': meters('m', 0.6), 'line-opacity': fade(Z + 0.2, Z + 0.6) });
  roadLine('nav-road-sep', 'sep', { 'line-color': '#ffffff', 'line-width': meters('m', 0.6), 'line-opacity': fade(Z + 0.2, Z + 0.6, 0.9), 'line-dasharray': [4, 5] });
  map.addLayer({
    id: 'nav-road-arrow', type: 'symbol', source: 'nav-road',
    filter: ['==', ['get', 'kind'], 'arrow'],
    paint: { 'icon-opacity': fade(Z + 0.2, Z + 0.6) },
    layout: {
      'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      // Pfeil so breit wie 80 % der Spur (Bild 32 px)
      'icon-size': ['interpolate', ['exponential', 2], ['zoom'],
        10, ['*', ['get', 'k'], 1024 * 3.2 * 0.8 / 32], 24, ['*', ['get', 'k'], 16777216 * 3.2 * 0.8 / 32]],
    },
  });

  /* Navigation: Pfeile an den nächsten Abbiegungen, Ampeln an der Route */
  map.addImage('nav-arrowhead', arrowHead(), { pixelRatio: 2 });
  map.addLayer({
    id: 'nav-arrow-casing', type: 'line', source: 'nav-arrows', minzoom: 14,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#0b3d91', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 15] },
  }, under);
  map.addLayer({
    id: 'nav-arrow', type: 'line', source: 'nav-arrows', minzoom: 14,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'butt' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 9] },
  }, under);
  map.addLayer({
    id: 'nav-arrow-head', type: 'symbol', source: 'nav-arrows', minzoom: 14,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'icon-image': 'nav-arrowhead', 'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 18, 1.1],
    },
  });
  map.addLayer({
    id: 'nav-signal', type: 'symbol', source: 'nav-signals', minzoom: 15,
    layout: {
      'icon-image': 'cat-signal', 'icon-anchor': 'bottom', 'icon-allow-overlap': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 0.75],
    },
  });

  /* Verkehrslage: Baustellen-/Sperrstrecken gestrichelt, Symbole obenauf */
  map.addLayer({
    id: 'traffic-line', type: 'line', source: 'traffic',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 7],
      'line-dasharray': [1.2, 1],
    },
  });
  map.addLayer({
    id: 'traffic-icon', type: 'symbol', source: 'traffic',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'icon-image': ['concat', 'cat-traffic-', ['get', 'kind']],
      'icon-allow-overlap': true, 'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.65, 12, 0.9],
    },
  });

  /*
   * Treffer obenauf. Punkte werden zu farbigen Symbolen ihrer Kategorie –
   * ein runder Punkt sah zu sehr nach dem eigenen Standort aus. Flächen und
   * Linien (Parkplatzfläche, Fluss) sind schon farbig hervorgehoben; dort
   * steht nur der Name, kein zusätzliches Symbol.
   */
  for (const [src, prefix] of [['highlight-points', 'hl'], ['pois', 'poi']]) {
    map.addLayer({
      id: `${prefix}-dot`, type: 'symbol', source: src,
      filter: ['all', ['!', ['to-boolean', ['get', 'hasShape']]], ['!', ['has', 'nr']]],
      layout: {
        'icon-image': ['concat', 'cat-', ['coalesce', ['get', 'category'], '']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 15, 1],
        'icon-allow-overlap': true,
        'icon-anchor': 'bottom',
      },
    });
    map.addLayer({
      id: `${prefix}-label`, type: 'symbol', source: src, minzoom: 12,
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
        'text-anchor': 'top', 'text-max-width': 10, 'text-optional': true,
        'text-offset': ['case', ['all', ['to-boolean', ['get', 'hasShape']], ['!', ['has', 'nr']]], ['literal', [0, -0.5]], ['literal', [0, 0.25]]],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
    // Treffer mit Nummer (die der Liste zeigt, „Parkplatz, (3)“): Symbol der Kategorie und Nummer in einer
    // farbigen Pille – auch an Flächen, damit man den Eintrag der Liste auf der Karte wiederfindet.
    // Kleinere Nummern liegen obenauf.
    map.addLayer({
      id: `${prefix}-nr`, type: 'symbol', source: src,
      filter: ['has', 'nr'],
      layout: {
        'icon-image': ['concat', 'hit-', ['coalesce', ['get', 'category'], ''], '-', ['to-string', ['get', 'nr']]],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.75, 15, 1],
        'icon-allow-overlap': true,
        'icon-anchor': 'bottom',
        'symbol-sort-key': ['-', ['get', 'nr']],
      },
    });
  }

  map.addLayer({
    id: 'hover', type: 'circle', source: 'hover',
    paint: {
      'circle-color': '#ffffff', 'circle-radius': 7,
      'circle-stroke-color': '#2f9e44', 'circle-stroke-width': 4,
    },
  });

  // Klickbares signalisieren
  for (const id of ['route-alt', 'route-main', 'route-walk', 'hl-dot', 'poi-dot', 'hl-nr', 'poi-nr', 'hl-fill', 'traffic-icon']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

/* ── Kategorie-Symbole ──────────────────────────────────────────────────────
 * Tropfenform in der Farbe der Kategorie mit dem Symbol aus der Icon-Schrift.
 * Erst bei Bedarf gezeichnet (styleimagemissing) – die Schrift ist dann längst
 * geladen, weil die Oberfläche sie überall benutzt.
 */
const EXTRA_ICONS = {
  'traffic-closure': ['block', '#e03131'],
  'traffic-roadworks': ['construction', '#f08c00'],
  'traffic-warning': ['warning', '#e8590c'],
  // Meldungen anderer (Stau, Unfall, Gefahr)
  'traffic-jam': ['traffic', '#e8590c'],
  'traffic-accident': ['car_crash', '#e03131'],
  'traffic-hazard': ['warning', '#e8590c'],
  // Mitmachen: offene Fragen
  survey: ['question_mark', '#7b1fa2'],
  // Ampeln an der Route
  signal: ['traffic', '#37474f'],
};

/** Spurpfeil wie auf dem Asphalt: weiß (zu nutzen) oder blass (andere Spuren). */
function addLaneIcon(map, id) {
  const [, state, glyph] = id.match(/^lane-(on|off)-(.+)$/) ?? [];
  if (!glyph || map.hasImage(id)) return;
  const S = 64;
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = c.getContext('2d');
  ctx.font = `${S}px "Material Symbols Rounded"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = state === 'on' ? '#ffffff' : 'rgba(255,255,255,0.4)';
  ctx.fillText(glyph, S / 2, S / 2);
  map.addImage(id, ctx.getImageData(0, 0, S, S), { pixelRatio: 2 });
}

/** Treffer mit Nummer: Pille in der Farbe der Kategorie mit ihrem Symbol und der Nummer, Spitze nach unten */
function addHitIcon(map, id) {
  const [, catId, nr] = id.match(/^hit-(.*)-(\d+)$/) ?? [];
  if (!nr) return false;
  const extra = EXTRA_ICONS[catId];
  const cat = byId(catId);
  const color = extra?.[1] ?? cat?.color ?? '#e8590c';
  const glyph = extra?.[0] ?? cat?.icon ?? 'location_on';
  const r = 2;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `700 ${12 * r}px system-ui, sans-serif`;
  const numW = Math.ceil(probe.measureText(nr).width / r);
  const bodyW = 6 + 15 + 3 + numW + 8;            // Rand, Symbol, Abstand, Nummer, Rand
  const bodyH = 23, tip = 6, pad = 3;             // pad: Platz für den Schatten
  const W = (bodyW + 2 * pad) * r, H = (bodyH + tip + 2 * pad) * r;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  ctx.scale(r, r);
  const shape = (inset) => {
    const x = pad + inset, y = pad + inset, w = bodyW - 2 * inset, h = bodyH - 2 * inset, rad = h / 2;
    const cx = pad + bodyW / 2;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.lineTo(cx + 5 - inset, y + h);
    ctx.lineTo(cx, pad + bodyH + tip - inset * 1.6);
    ctx.lineTo(cx - 5 + inset, y + h);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  shape(0);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  shape(1.6);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '15px "Material Symbols Rounded"';
  ctx.fillText(glyph, pad + 6 + 7.5, pad + bodyH / 2 + 0.5);
  ctx.textAlign = 'left';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(nr, pad + 6 + 15 + 3, pad + bodyH / 2 + 0.5);
  map.addImage(id, ctx.getImageData(0, 0, W, H), { pixelRatio: r });
  return true;
}

function addCategoryIcon(map, id) {
  if (id.startsWith('lane-')) { addLaneIcon(map, id); return; }
  if (map.hasImage(id)) return;
  if (id.startsWith('hit-') && addHitIcon(map, id)) return;
  // Symbole, die dem Grundstil fehlen (swimming_pool, atm, gate …): leer
  // eintragen – gezeichnet wurde dort ohnehin nichts, nur jedes Mal gewarnt
  if (!id.startsWith('cat-')) { map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) }); return; }
  const traffic = EXTRA_ICONS[id.slice(4)];
  const cat = byId(id.slice(4));
  const color = traffic?.[1] ?? cat?.color ?? '#e8590c';
  const glyph = traffic?.[0] ?? cat?.icon ?? 'location_on';
  const r = 2;                                    // für scharfe Darstellung
  const W = 30 * r, H = 38 * r;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  const cx = W / 2, cy = 15 * r, rad = 13 * r;
  // Tropfen: Kreis mit Spitze nach unten, weißer Rand, leichter Schatten
  ctx.shadowColor = 'rgba(0,0,0,.3)';
  ctx.shadowBlur = 3 * r;
  ctx.shadowOffsetY = 1 * r;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, Math.PI * 0.8, Math.PI * 0.2);
  ctx.lineTo(cx, H - 2 * r);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(cx, cy, rad - 2 * r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${16 * r}px "Material Symbols Rounded"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cx, cy + r);
  map.addImage(id, ctx.getImageData(0, 0, W, H), { pixelRatio: r });
}

/* ── Daten setzen ─────────────────────────────────────────────────────────── */

const src = (map, id) => map.getSource(id);

/** Erst setzen, wenn die Ebenen stehen – vorher gibt es die Quellen nicht. */
function whenReady(map, fn) {
  if (src(map, 'routes')) fn();
  else map.once('load', () => requestAnimationFrame(fn));
}

/**
 * Routen zeigen; die gewählte zuletzt (obenauf).
 * @param focusLeg  Bus & Bahn: Nummer des hervorgehobenen Abschnitts, sonst null
 */
export function showRoutes(map, routes, selected, focusLeg = null) {
  whenReady(map, () => {
    // Gewählte Route zuletzt, damit sie über den Alternativen liegt
    const order = routes.filter((r) => r.id !== selected).concat(routes.filter((r) => r.id === selected))
      // Bus & Bahn: nur die gewählte Verbindung – die anderen fahren oft dieselben
      // Straßen, und wo der Fahrplan keinen Verlauf kennt, wären es Luftlinien
      .filter((r) => !r.transit || r.id === selected);
    src(map, 'routes').setData(fc(order.flatMap((r) => {
      // Bus & Bahn gewählt: je Abschnitt ein Stück, Fahrten in Linienfarbe
      if (r.transit && r.id === selected) {
        const legs = r.transit.legs.filter((l) => l.coords.length > 1).map((l) => ({
          type: 'Feature',
          properties: { id: r.id, selected: true, leg: r.transit.legs.indexOf(l), walk: l.walk, color: l.walk ? null : l.color, dim: focusLeg !== null && r.transit.legs.indexOf(l) !== focusLeg },
          geometry: { type: 'LineString', coordinates: l.coords },
        }));
        // Ein- und Ausstieg jeder Fahrt als Punkt – dort wird umgestiegen
        const dots = r.transit.legs.filter((l) => !l.walk && l.coords.length > 1).flatMap((l) => [l.coords[0], l.coords.at(-1)].map((c) => ({
          type: 'Feature', properties: { id: r.id, selected: true, stopDot: true, color: l.color, dim: focusLeg !== null && r.transit.legs.indexOf(l) !== focusLeg },
          geometry: { type: 'Point', coordinates: c },
        })));
        return [...legs, ...dots];
      }
      return [{
        type: 'Feature',
        properties: { id: r.id, selected: r.id === selected, covered: !!r.covered },
        geometry: { type: 'LineString', coordinates: r.coords },
      }];
    })));
  });
}

export function showHighlight(map, { shapes = [], points = [] } = {}) {
  whenReady(map, () => {
    src(map, 'highlight-shapes').setData(fc(shapes));
    src(map, 'highlight-points').setData(fc(points));
  });
}

export function showReach(map, features = []) {
  whenReady(map, () => src(map, 'reach').setData(fc(features)));
}

/** Verkehrsmeldungen: Punkt je Meldung, dazu ihre Strecke, falls bekannt. */
export function showTraffic(map, items = []) {
  const color = { closure: '#e03131', roadworks: '#f08c00', warning: '#e8590c', jam: '#e8590c', accident: '#e03131', hazard: '#e8590c' };
  const features = items.flatMap((t) => [
    ...(t.line ? [{ type: 'Feature', properties: { color: color[t.kind] }, geometry: { type: 'LineString', coordinates: t.line } }] : []),
    { type: 'Feature', properties: { kind: t.kind, color: color[t.kind], i: t.i }, geometry: { type: 'Point', coordinates: t.point } },
  ]);
  whenReady(map, () => src(map, 'traffic').setData(fc(features)));
}

export function showPois(map, points = []) {
  whenReady(map, () => src(map, 'pois').setData(fc(points)));
}

/**
 * Navigation: Pfeile (je eine Linie über die Abbiegung, Spitze am Ende) und
 * Ampeln. Leer aufgerufen räumt es auf.
 */
export function showNavExtras(map, { arrows = [], signals = [] } = {}) {
  whenReady(map, () => {
    const feats = [];
    for (const line of arrows) {
      if (line.length < 2) continue;
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} });
      const [a, b] = [line[line.length - 2], line[line.length - 1]];
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: b }, properties: { bearing: bearingOf(a, b) } });
    }
    src(map, 'nav-arrows').setData(fc(feats));
    src(map, 'nav-signals').setData(fc(signals.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))));
  });
}

const bearingOf = (a, b) => {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

/** Pfeilspitze: weißes Dreieck mit dunklem Rand, zeigt nach oben (Norden). */
function arrowHead() {
  const S = 64;
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(S / 2, 6);
  ctx.lineTo(S - 8, S - 14);
  ctx.lineTo(8, S - 14);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#0b3d91';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return ctx.getImageData(0, 0, S, S);
}

/** Fahrbahn mit Spuren vor dem Fahrzeug (Features aus nav-extras roadFeatures). */
export function showNavRoad(map, features = []) {
  whenReady(map, () => src(map, 'nav-road').setData(fc(features)));
}

export function showHover(map, lngLat) {
  whenReady(map, () => {
    // Obenauf – Seiten legen ihre Linien (Meine Touren, Planer) erst später an
    if (lngLat && map.getLayer('hover')) map.moveLayer('hover');
    src(map, 'hover').setData(lngLat
      ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } }]) : EMPTY);
  });
}

/**
 * Android-App: Der Standort-Knopf fragt erst über den Dialog zu den
 * Berechtigungen (ui/permissions.js) – ohne Freigabe täte er sonst nichts.
 */
/**
 * Karte so groß wie ihr Platz: Hat der Platz beim Start noch keine Größe (App
 * startet, Seite noch nicht gelayoutet), nimmt MapLibre 400 × 300 und
 * übersieht die erste Änderung danach (sein ResizeObserver verwirft den
 * ersten Aufruf) – die Karte blieb dann klein in der Ecke, bis man neu lud.
 * Darum selbst nachsehen und bei Abweichung anpassen.
 */
function keepSized(map) {
  const fit = () => {
    const box = map.getContainer();
    const c = map.getCanvas();
    if (!box.clientWidth || !box.clientHeight) return;
    if (Math.abs(c.clientWidth - box.clientWidth) > 1 || Math.abs(c.clientHeight - box.clientHeight) > 1) map.resize();
  };
  new ResizeObserver(fit).observe(map.getContainer());
  map.once('load', fit);
  addEventListener('pageshow', fit);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fit(); });
}

function guardGeolocate(map, geolocate) {
  if (!window.__TAURI__ || !/Android/i.test(navigator.userAgent)) return;
  let ok = false;
  map.getContainer().addEventListener('click', (e) => {
    if (ok || !e.target.closest('.maplibregl-ctrl-geolocate')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    import('../ui/permissions.js')
      .then(({ locationAccess }) => locationAccess())
      .then((yes) => { if (yes) { ok = true; geolocate.trigger(); } });
  }, true);
}
