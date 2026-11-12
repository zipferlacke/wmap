/**
 * Zuhause und Arbeit auf der Karte: rundes Abzeichen mit Haus bzw. Koffer, der Name darunter – aus den
 * Lesezeichen (data/saved.js). Ändern sie sich, zieht die Ebene sofort nach. Antippen öffnet den Ort
 * (app/map-clicks.js, Ebene „my-places“).
 *
 *   mountMyPlaces(map)
 */
import { places, PLACE_KINDS } from '../data/saved.js';
import { theme } from '../core/theme.js';

export const MY_PLACES_LAYER = 'my-places';
const KINDS = ['home', 'work'];
const COLOR = { home: '#1a73e8', work: '#a0522d' };
const TEXT = { light: ['#1f1f1f', '#ffffff'], dark: ['#e8eaed', '#202124'] };

function data() {
  return {
    type: 'FeatureCollection',
    features: places.all().filter((p) => KINDS.includes(p.kind) && p.point).map((p) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: p.point },
      properties: { kind: p.kind, name: p.name || PLACE_KINDS[p.kind].label, poi: !!p.poi },
    })),
  };
}

/** Abzeichen: Kreis in der Farbe mit weißem Rand und weißem Symbol aus der Icon-Schrift */
function badge(map, kind) {
  const id = `my-${kind}`;
  if (map.hasImage(id)) return;
  const r = 2, S = 30 * r;
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 3 * r;
  ctx.shadowOffsetY = r;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 3 * r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 5 * r, 0, Math.PI * 2);
  ctx.fillStyle = COLOR[kind];
  ctx.fill();
  ctx.font = `${15 * r}px "Material Symbols Rounded"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(PLACE_KINDS[kind].icon, S / 2, S / 2 + r / 2);
  map.addImage(id, ctx.getImageData(0, 0, S, S), { pixelRatio: r });
}

function paint(map) {
  if (!map.getLayer(MY_PLACES_LAYER)) return;
  const [text, halo] = TEXT[theme.dark ? 'dark' : 'light'];
  map.setPaintProperty(MY_PLACES_LAYER, 'text-color', text);
  map.setPaintProperty(MY_PLACES_LAYER, 'text-halo-color', halo);
}

export function mountMyPlaces(map) {
  const add = () => {
    if (map.getSource(MY_PLACES_LAYER)) return;
    // Die Icon-Schrift muss geladen sein, sonst stünde im Kreis das Wort „home“
    document.fonts.load('15px "Material Symbols Rounded"', 'home').catch(() => {}).finally(() => {
      if (map.getSource(MY_PLACES_LAYER)) return;
      KINDS.forEach((k) => badge(map, k));
      map.addSource(MY_PLACES_LAYER, { type: 'geojson', data: data() });
      map.addLayer({
        id: MY_PLACES_LAYER, type: 'symbol', source: MY_PLACES_LAYER,
        layout: {
          'icon-image': ['concat', 'my-', ['get', 'kind']],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
          'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-optional': true,
        },
        paint: { 'text-halo-width': 1.5 },
      });
      paint(map);
    });
  };
  const refresh = () => map.getSource(MY_PLACES_LAYER)?.setData(data());
  // Schon geladen? map.loaded() ist auch danach falsch, solange Kacheln nachkommen – und „load“ kommt nur einmal.
  // Die eigenen Quellen aus map.js zeigen „geladen“
  if (map.getSource('routes')) add(); else map.once('load', add);
  addEventListener('wmap:saved', refresh);
  addEventListener('wmap:theme', () => paint(map));
  map.on('mouseenter', MY_PLACES_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', MY_PLACES_LAYER, () => { map.getCanvas().style.cursor = ''; });
}
