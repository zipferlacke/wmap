/**
 * Karte: Klicks, langes Drücken, Ebenen-Menü und Tastatur.
 */
import { showHover, BASE_POI_LAYERS, osmRef } from '../map.js';
import { keyboardControl } from '../keys.js';
import { mountSignals } from '../signals.js';
import { mapLayerIds, propertyTable } from '../layers.js';
import { mountLayerMenu } from '../layer-menu.js';
import { presetOf, layerInfoAt, layerInfoHtml } from '../presets.js';
import { ask, toast } from '../ui.js';
import { nearestOnLine, esc } from '../geo.js';
import { current, map, sheet, state } from './core.js';
import { nav } from './nav.js';
import { featureFromPoint, overContext, showPlace, showPoint, showTrafficItem } from './place.js';
import { reach } from './reach.js';
import { isSet, setWaypoint } from './route-plan.js';
import { elevation, focusTransitLeg, selectRoute } from './route-results.js';
import { trafficItems } from './traffic-along.js';

/* ══════════════════════════════════════════════════════════════════════════
   Karte: Klicks und langes Drücken – alles erscheint unten im Sheet,
   auf der Karte bleibt nur die Markierung
   ══════════════════════════════════════════════════════════════════════════ */

/** Klick auf ein Symbol der Karte selbst (Parkplatz, Laden, Haltestelle …). */
function openBasePoi(feat) {
  const ref = osmRef(feat);
  const pr = feat.properties;
  const point = feat.geometry.coordinates;
  const name = pr['name:de'] ?? pr.name_de ?? pr.name;
  const f = {
    type: 'Feature', geometry: { type: 'Point', coordinates: point },
    properties: {
      name, osm_type: ref?.type, osm_id: ref?.id,
      osm_key: pr.class === 'shop' ? 'shop' : 'amenity', osm_value: pr.subclass,
    },
  };
  showPlace(f, { over: overContext(), fly: false });
}

map.on('contextmenu', (e) => showPoint(e.lngLat.toArray()));

/* Langes Drücken auf dem Handy entspricht dem Rechtsklick */
{
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  map.on('touchstart', (e) => {
    cancel();
    if (e.points.length !== 1) return;
    timer = setTimeout(() => showPoint(e.lngLat.toArray()), 550);
  });
  map.on('touchend', cancel);
  map.on('touchmove', cancel);
  map.on('movestart', cancel);
}

const CLICKABLE = ['traffic-icon', 'poi-dot', 'hl-dot', 'route-alt', 'hl-fill', ...BASE_POI_LAYERS];

/* Ebenen-Menü: Satellit, Wandern & Rad, Wanderwege, eigene Ebenen und Plugins */
const layerMenu = mountLayerMenu(map, { toast });
// Ampeln ab Zoom 15 – nur wo eine steht (signals.js)
mountSignals(map);

map.on('click', (e) => {
  // Beim Fliegen sperrt ein Klick nur die Maus (keys.js) – nichts öffnen
  if (fly.active) return;
  // Bus & Bahn: Abschnitt der Verbindung angetippt → hervorheben, Beschreibung zeigen
  if (current()?.transit && !nav.active && sheet.dataset.current === 'route') {
    const legs = ['route-main', 'route-walk'].filter((id) => map.getLayer(id));
    const leg = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: legs })
      .find((f) => f.properties.leg !== undefined);
    if (leg) { focusTransitLeg(Number(leg.properties.leg)); return; }
  }
  // Eigene Ebene getroffen? Dann ihre Werte zeigen
  const mainLayers = layerMenu.shown();
  const own = mainLayers.flatMap((l) => mapLayerIds(l.id)).filter((id) => map.getLayer(id));
  const ownHit = own.length && !nav.active ? map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: own })[0] : null;
  if (ownHit) {
    const l = mainLayers.find((x) => ownHit.layer.id.startsWith(`own-${x.id}-`));
    const p = ownHit.properties;
    ask({ icon: 'layers', title: String(p.name ?? p.Name ?? p.title ?? l?.name ?? 'Objekt'), html: `<p class="muted">Ebene „${esc(l?.name ?? '')}“</p>${propertyTable(p)}`,
      buttons: [{ value: 'ok', label: 'Schließen', primary: true }] });
    return;
  }
  // In der Navigation: Orte antippen ja, Routen wechseln nein
  const layers = CLICKABLE.filter((id) => map.getLayer(id) && !(nav.active && id === 'route-alt'));
  const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
  const id = hit?.layer.id;
  if (id === 'traffic-icon') { const t = trafficItems[hit.properties.i]; if (t) showTrafficItem(t); return; }
  if (id === 'poi-dot' || (id === 'hl-dot' && (state.category || reach.cat))) {
    showPlace(featureFromPoint(hit), { over: true, fly: false });
    return;
  }
  if (id === 'route-alt') { selectRoute(Number(hit.properties.id)); return; }
  if (id === 'hl-fill' && state.category) {
    // Fläche angeklickt: den zugehörigen Punkt nehmen (gleiche OSM-ID)
    const pt = map.querySourceFeatures('highlight-points').find((x) => x.properties.id === hit.properties.id);
    if (pt) showPlace(featureFromPoint(pt), { over: true, fly: false });
    return;
  }
  if (BASE_POI_LAYERS.includes(id)) { openBasePoi(hit); return; }
  // Planung: ein Klick in die Karte füllt das erste leere Feld
  if (state.mode === 'route' && !nav.active) {
    const i = state.waypoints.findIndex((w) => !isSet(w));
    if (i >= 0) setWaypoint(i, { label: 'Punkt auf der Karte', point: e.lngLat.toArray(), me: false }, { reverse: true });
  }
});

/**
 * Ebenen mit Auskunft (Gestein, Erdzeitalter …): bei langem Drücken stehen
 * sie in „Punkt auf der Karte“ – ein einfacher Klick bleibt frei für Orte.
 */
let infoCtl = null;
export function showLayerInfo(point, box) {
  const zoom = map.getZoom();
  const withInfo = layerMenu.shown().filter((l) => presetOf(l)?.info && zoom >= (l.raster?.minzoom ?? 0));
  infoCtl?.abort();
  if (!withInfo.length) return;
  infoCtl = new AbortController();
  box.innerHTML = '<p class="muted"><span class="msr spin">progress_activity</span> Was die Ebenen hier wissen …</p>';
  layerInfoAt(withInfo, point, zoom, { signal: infoCtl.signal }).then((res) => {
    box.innerHTML = res.length ? layerInfoHtml(res) : '';
  }).catch((err) => { if (err.name !== 'AbortError') box.innerHTML = `<p class="muted">Ebenen gerade nicht abrufbar (${esc(err.message)})</p>`; });
}

/* Maus über der Route → Stelle im Höhenprofil */
map.on('mousemove', 'route-main', (e) => {
  const r = current();
  if (!r || nav.active) return;
  const s = nearestOnLine(r.coords, r.cum, e.lngLat.toArray());
  showHover(map, s.point);
  elevation.showAt((s.along / 1000) * ((r.length || 1) / r.cum[r.cum.length - 1]));
});
map.on('mouseleave', 'route-main', () => {
  showHover(map, null);
  elevation.showAt(null);
});

export const { fly } = keyboardControl(map, {
  onManual: () => nav.pauseFollow(),
  onEscape: () => { if (!nav.active) return false; nav.resumeFollow(); return true; },
});
