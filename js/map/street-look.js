/**
 * Street View als Modell (in der Art von Streets GL): Boden aus den Kartendaten statt Luftbild – Straßen und Wege in
 * echter Breite (Meter statt Bildpunkte, sonst wird eine Straße aus der Nähe riesig), Gehwege als heller Rand neben
 * der Fahrbahn, Asphalt grau, Radwege rötlich, Rasen, Parks und Wald grün, Plätze gepflastert, Wasser blau.
 * Ändert nur Eigenschaften der vorhandenen Ebenen und merkt sich jeden alten Wert: `modelLook(map)` → `undo()`.
 */

const RAD = Math.PI / 180;

// Breite der Fahrbahn bzw. des Wegs (m) nach Art
const WIDTH = ['match', ['get', 'class'],
  'motorway', 22, 'trunk', 16, 'primary', 13, 'secondary', 11, 'tertiary', 9, 'minor', 6.5, 'busway', 6,
  'service', 4, 'track', 3, 'raceway', 10, ['rail', 'transit'], ['match', ['get', 'subclass'], 'tram', 2.6, 3.2],
  'path', ['match', ['get', 'subclass'], 'pedestrian', 6, 'cycleway', 2.2, 'steps', 2, 1.8],
  4];
// Gehwege beidseits (m) – an Straßen im Ort; Wege und Feldwege nur ein schmaler Rand
const SIDEWALK = ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'minor', 'busway'], 4.4, ['service'], 1, 0.4];
// Einbahn (`oneway`, nur Fahrstraßen – Fußgängerzonen tragen es auch): meist eine Fahrbahn einer zweibahnigen Straße – nur gut die halbe Breite, der Gehweg schmaler.
// Mit voller Breite deckten die beiden Fahrbahnen den Grünstreifen dazwischen zu
const ONEWAY = ['all', ['!=', ['coalesce', ['get', 'oneway'], 0], 0],
  ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'busway'], true, false]];
const ROAD_W = ['case', ONEWAY, ['*', WIDTH, 0.55], WIDTH];
const SIDE_W = ['case', ONEWAY, ['*', SIDEWALK, 0.5], SIDEWALK];
const SURFACE = ['match', ['get', 'class'],
  'path', ['match', ['get', 'subclass'], 'cycleway', '#b07468', ['pedestrian', 'footway', 'steps'], '#cfc6b6', '#c4b28c'],
  // Gleise: Schotter (Straßenbahn: im Pflaster bzw. Asphalt der Straße)
  'track', '#a89878', ['rail', 'transit'], ['match', ['get', 'subclass'], 'tram', '#7a7c80', '#8f877c'],
  '#6b6e72'];
const EDGE = ['match', ['get', 'class'], ['path', 'track'], '#9f957f', ['rail', 'transit'], '#7d766c', '#c4beb3'];
// Gleise obenauf: Schwellen (nur im Schotter) und zwei Schienen, Spur 1,435 m
const RAILS = ['all', ['match', ['get', 'class'], ['rail', 'transit'], true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
const GAUGE = 1.435;

// Flächen: Ebene → Farbe
const FILLS = {
  background: '#93a66f', park: '#7aa553', landuse_residential: '#a3ad86', landcover_wood: '#5d8a43',
  landcover_grass: '#7fae55', landuse_pitch: '#6fa04a', landuse_track: '#b5715c', landuse_cemetery: '#86a568',
  landuse_hospital: '#b8b2a3', landuse_school: '#b8b2a3', landcover_sand: '#d9cba0', landcover_ice: '#e8eef2',
  water: '#5c8fb5', aeroway_fill: '#bdb8ad', road_area_pattern: '#cfc6b6',
};

/** Breite in Metern als line-width bzw. line-offset: Bildpunkte je Meter verdoppeln sich mit jeder Zoomstufe */
function meters(lat, w) {
  const k = 512 / (40075016.686 * Math.cos(lat * RAD));
  return ['interpolate', ['exponential', 2], ['zoom'], 12, ['*', w, k * 2 ** 12], 24, ['*', w, k * 2 ** 24]];
}

export function modelLook(map) {
  const undo = [];
  const paint = (id, prop, value) => {
    if (!map.getLayer(id)) return;
    const was = map.getPaintProperty(id, prop);
    undo.push(() => { if (map.getLayer(id)) map.setPaintProperty(id, prop, was); });
    map.setPaintProperty(id, prop, value);
  };
  const show = (id, on) => {
    if (!map.getLayer(id)) return;
    const was = map.getLayoutProperty(id, 'visibility') ?? 'visible';
    undo.push(() => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', was); });
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  const lat = map.getCenter().lat;

  for (const l of map.getStyle().layers) {
    if (l.source !== 'openmaptiles') continue;
    if (l.type === 'line' && l['source-layer'] === 'transportation') {
      // Schwellen der Bahn (Schraffur) und Tunnel aus – von nah nur Striche bzw. Linien unter der Erde
      if (/hatching|^tunnel_/.test(l.id)) { show(l.id, false); continue; }
      const casing = /casing/.test(l.id);
      paint(l.id, 'line-width', meters(lat, casing ? ['+', ROAD_W, SIDE_W] : ROAD_W));
      paint(l.id, 'line-color', casing ? EDGE : SURFACE);
      paint(l.id, 'line-opacity', 1);
      paint(l.id, 'line-blur', 0);
      if (l.paint?.['line-dasharray']) paint(l.id, 'line-dasharray', undefined);
    } else if (l.type === 'line' && l['source-layer'] === 'waterway') {
      paint(l.id, 'line-width', meters(lat, ['match', ['get', 'class'], 'river', 14, 'canal', 10, 'stream', 2.5, 1.5]));
      paint(l.id, 'line-color', FILLS.water);
    }
  }
  for (const [id, color] of Object.entries(FILLS)) {
    if (!map.getLayer(id)) continue;
    if (id === 'background') { paint(id, 'background-color', color); continue; }
    paint(id, 'fill-color', color);
    paint(id, 'fill-opacity', 1);
    if (map.getPaintProperty(id, 'fill-pattern')) paint(id, 'fill-pattern', undefined);
    show(id, true);
  }
  // Gleise: Schwellen und Schienen als eigene Ebenen über den Straßen
  const before = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  const add = (layer) => {
    if (map.getLayer(layer.id)) return;
    map.addLayer({ source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 15, ...layer }, before);
    undo.push(() => { if (map.getLayer(layer.id)) map.removeLayer(layer.id); });
  };
  // Schwellen: kurze Striche quer – Strichlänge in Breiten der Linie (2,6 m): 0,24 m Holz, 0,4 m Lücke
  add({ id: 'sv-sleepers', type: 'line', filter: ['all', RAILS, ['!=', ['get', 'subclass'], 'tram']],
    paint: { 'line-color': '#6e5c4b', 'line-width': meters(lat, 2.6), 'line-dasharray': [0.09, 0.15] } });
  for (const [id, side] of [['sv-rail-l', -1], ['sv-rail-r', 1]]) {
    add({ id, type: 'line', filter: RAILS, layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#9aa0a8', 'line-width': meters(lat, 0.12), 'line-offset': meters(lat, (side * GAUGE) / 2) } });
  }
  // Schummerung aus – auf Augenhöhe nur dunkle Flecken
  show('hillshade', false);
  // Grün nur echte Parks – die Ebene führt auch Schutzgebiete und Naturparks (der Geopark liegt über ganz Darmstadt)
  if (map.getLayer('park')) {
    const was = map.getFilter('park');
    undo.push(() => { if (map.getLayer('park')) map.setFilter('park', was); });
    map.setFilter('park', ['all', ...(was ? [was] : []), ['==', ['get', 'class'], 'park']]);
  }

  return () => { for (const f of undo.reverse()) f(); };
}
