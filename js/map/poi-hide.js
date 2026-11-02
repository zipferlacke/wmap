/**
 * Geneigte Karte: Geschäfte und andere Orte der Grundkarte hinter einem Haus ausblenden. MapLibre zeichnet Symbole
 * immer über die 3D-Häuser – man sah sie durch die Wände. Gerechnet wird wie bei den Ampeln (map/signals.js): ein
 * Sichtstrahl von der Kamera gegen die Grundrisse. Ein Ort steht meist im eigenen Haus: Das verdeckt ihn nur, wenn er
 * tief drinliegt (OWN_M bis zur Wand zur Kamera) – die Läden an der Straße bleiben sichtbar.
 *
 * Geprüft wird nur, was gerade gezeichnet ist, geneigt und nah heran; flach wird gar nicht gerechnet. Während einer
 * Bewegung höchstens alle 250 ms.
 */
import { BASE_POI_LAYERS } from './map.js';
import { hiddenBy, houseIndex } from './signals.js';

const MIN_ZOOM = 15;
const HIDE_FROM = 25;               // ab dieser Neigung können Häuser Orte verdecken
const HIDE_EVERY = 250;             // ms – während einer Bewegung nicht öfter prüfen
const OWN_M = 12;                   // m – so tief im eigenen Haus bleibt ein Ort noch sichtbar
const SOURCE_LAYER = 'poi';
const PROPS = ['icon-opacity', 'text-opacity'];
const BEHIND = ['boolean', ['feature-state', 'behind'], false];

export function mountPoiHide(map) {
  let hidden = new Map();           // id → Quelle
  let idx = null, last = 0, painted = null;

  /* Die Ebenen kommen mit jedem Kartenstil neu: Deckkraft um „verdeckt“ ergänzen, gemerkte Zustände sind dann weg */
  function ensure() {
    const style = map.style;
    if (painted === style) return;
    const layers = BASE_POI_LAYERS.filter((id) => map.getLayer(id));
    if (!layers.length) return;
    painted = style;
    hidden = new Map();
    for (const id of layers) {
      // Private Parkplätze u. Ä. sind schon blasser (map.js ACCESS_OPACITY) – das bleibt
      for (const k of PROPS) map.setPaintProperty(id, k, ['case', BEHIND, 0, map.getPaintProperty(id, k) ?? 1]);
    }
  }

  function setBehind(id, source, on) {
    map.setFeatureState({ source, sourceLayer: SOURCE_LAYER, id }, { behind: on });
  }

  function check({ fresh = false } = {}) {
    last = performance.now();
    ensure();
    const now = new Map();
    const street = document.body.classList.contains('street-view');
    if (!street && map.getPitch() >= HIDE_FROM && map.getZoom() >= MIN_ZOOM) {
      const c = map.getCenter().toArray();
      if (fresh || !idx || Math.abs(idx.o[0] - c[0]) * idx.kx > 2000 || Math.abs(idx.o[1] - c[1]) * 111320 > 2000) idx = houseIndex(map, c);
      // Kamera: MapLibre 6 hat keine öffentliche Abfrage mehr – wie map/signals.js
      const tr = map._camera?.transform ?? map.transform;
      const ll = tr?.getCameraLngLat?.();
      if (idx && ll) {
        const cam = idx.xy([ll.lng, ll.lat]);
        const alt = tr.getCameraAltitude() - (map.queryTerrainElevation?.(ll) ?? 0);
        const layers = BASE_POI_LAYERS.filter((id) => map.getLayer(id));
        for (const f of map.queryRenderedFeatures({ layers })) {
          if (f.id === undefined || now.has(f.id) || f.geometry.type !== 'Point') continue;
          if (hiddenBy(idx, idx.xy(f.geometry.coordinates), cam, alt, OWN_M)) now.set(f.id, f.source);
        }
      }
    }
    for (const [id, source] of hidden) if (!now.has(id)) setBehind(id, source, false);
    for (const [id, source] of now) if (!hidden.has(id)) setBehind(id, source, true);
    hidden = now;
  }

  map.on('move', () => { if (performance.now() - last > HIDE_EVERY) check(); });
  map.on('idle', () => check({ fresh: true }));
}
