/**
 * Ebenen-Menü der Karte – Knopf mit dem Ebenen-Symbol oben rechts.
 *
 *   Grundkarte   Karte · Satellit (Sentinel-2 weltweit, in Niedersachsen, NRW
 *                und Bayern amtliche Luftbilder bis 20 cm – Straßen und
 *                Namen bleiben obenauf)
 *   Schwerpunkt  Wandern & Rad: große Straßen treten zurück, Wanderwege und
 *                Relief treten hervor
 *   Ebenen       Relief, Wander-, Rad- und MTB-Wege (Waymarked Trails)
 *   Eigene       eigene Ebenen und Plugins (IndexedDB, layers.js) an/aus –
 *                „Plugins holen“ führt in den Katalog, „Eigene Quelle“ nimmt
 *                eine private Adresse, auf Wunsch mit Benutzer und Passwort
 *
 * Die Wahl bleibt gespeichert (localStorage „wmap.layers“).
 */
import { local } from './store.js';
import { firstRoadLayer } from './map.js';
import { layers as ownLayers, showLayer, hideLayer } from './layers.js';
import { addOwnSource, wms } from './own-source.js';
import { esc } from './geo.js';

const KEY = 'wmap.layers';
const DEFAULT = { base: 'map', focus: false, relief: true, hiking: false, cycling: false, mtb: false };

const EOX = 'Satellit: <a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless von EOX</a> (Copernicus-Daten 2020)';

/* Luftbilder: weltweit Sentinel-2 (10 m), darüber amtliche Luftbilder der Länder */
const SAT = [
  { id: 'sat-s2', tiles: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', tileSize: 256, maxzoom: 14, attribution: EOX },
  { id: 'sat-ni', tiles: wms('https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms', 'ni_dop20'), tileSize: 512, minzoom: 11, bounds: [6.6, 51.29, 11.6, 53.9],
    attribution: 'Luftbild Niedersachsen: © LGLN (CC BY 4.0)' },
  { id: 'sat-nw', tiles: wms('https://www.wms.nrw.de/geobasis/wms_nw_dop', 'nw_dop_rgb'), tileSize: 512, minzoom: 11, bounds: [5.86, 50.32, 9.47, 52.53],
    attribution: 'Luftbild NRW: © Geobasis NRW (dl-de/zero-2-0)' },
  { id: 'sat-by', tiles: wms('https://geoservices.bayern.de/od/wms/dop/v1/dop40', 'by_dop40c'), tileSize: 512, minzoom: 11, bounds: [8.97, 47.27, 13.84, 50.56],
    attribution: 'Luftbild Bayern: © Bayerische Vermessungsverwaltung (CC BY 4.0)' },
];

const TRAILS = {
  hiking: { label: 'Wanderwege', icon: 'hiking', url: 'hiking' },
  cycling: { label: 'Radwege', icon: 'directions_bike', url: 'cycling' },
  mtb: { label: 'Mountainbike', icon: 'landscape', url: 'mtb' },
};
const WMT_ATTR = 'Wege: <a href="https://waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> (CC BY-SA)';

/* Große Straßen im Schwerpunkt „Wandern & Rad“ – Ebenen-IDs von OpenMapTiles/Liberty */
const BIG_ROADS = /(motorway|trunk|primary|secondary)/;

export function mountLayerMenu(map, { toast = () => {} } = {}) {
  let state = { ...DEFAULT, ...local.get(KEY, {}) };
  let shown = [];                       // eigene Ebenen auf der Karte
  let own = [];
  const save = () => local.set(KEY, state);

  /* ── Auf die Karte ────────────────────────────────────────────────────── */

  // Unter den Routen und Treffern der App, über der Grundkarte
  const appLayer = () => map.getStyle().layers.find((l) => /^(route|hl-|highlight|reach|traffic|poi-dot)/.test(l.id))?.id;

  function applyBase() {
    const sat = state.base === 'sat';
    for (const s of SAT) {
      if (sat && !map.getSource(s.id)) {
        map.addSource(s.id, { type: 'raster', tiles: [s.tiles], tileSize: s.tileSize, minzoom: s.minzoom ?? 0, maxzoom: s.maxzoom ?? 20, attribution: s.attribution, ...(s.bounds ? { bounds: s.bounds } : {}) });
        map.addLayer({ id: s.id, type: 'raster', source: s.id, ...(s.minzoom ? { minzoom: s.minzoom } : {}), paint: { 'raster-fade-duration': 200 } }, firstRoadLayer(map));
      }
      if (map.getLayer(s.id)) map.setLayoutProperty(s.id, 'visibility', sat ? 'visible' : 'none');
    }
    // Häuser halb durchsichtig – sonst verdecken sie das Luftbild
    for (const l of map.getStyle().layers) {
      if (l.type === 'fill-extrusion') map.setPaintProperty(l.id, 'fill-extrusion-opacity', sat ? 0.55 : (l.paint?.['fill-extrusion-opacity'] ?? 1));
    }
    document.body.classList.toggle('base-sat', sat);
  }

  function applyTrails() {
    for (const [k, t] of Object.entries(TRAILS)) {
      const on = state[k] || (state.focus && k === 'hiking');
      const id = `wmt-${k}`;
      if (on && !map.getSource(id)) {
        map.addSource(id, { type: 'raster', tileSize: 256, maxzoom: 17, tiles: [`https://tile.waymarkedtrails.org/${t.url}/{z}/{x}/{y}.png`], attribution: WMT_ATTR });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.85 } }, appLayer());
      }
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  function applyFocus() {
    if (map.getLayer('hillshade')) {
      map.setLayoutProperty('hillshade', 'visibility', state.relief || state.focus ? 'visible' : 'none');
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', state.focus
        ? ['interpolate', ['linear'], ['zoom'], 5, 0.8, 14, 0.7, 16, 0.45, 17.5, 0.25]
        : ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 0.55, 14.5, 0.4, 16, 0.25, 17.5, 0.1]);
    }
    for (const l of map.getStyle().layers) {
      if (l.type !== 'line' || l['source-layer'] !== 'transportation' || !BIG_ROADS.test(l.id)) continue;
      map.setPaintProperty(l.id, 'line-opacity', state.focus ? 0.4 : 1);
    }
    document.body.classList.toggle('focus-outdoor', state.focus);
  }

  async function applyOwn() {
    try { own = await ownLayers.all(); } catch { own = []; }
    for (const l of shown) hideLayer(map, l.id);
    shown = own.filter((l) => l.onMain && l.visible);
    for (const l of shown) showLayer(map, l, { before: appLayer() });
  }

  function applyAll() { applyBase(); applyTrails(); applyFocus(); }

  /* ── Knopf und Menü ───────────────────────────────────────────────────── */

  const ctrl = {
    onAdd() {
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl maplibregl-ctrl-group layer-ctrl';
      el.innerHTML = '<button type="button" title="Ebenen: Satellit, Wanderwege, Plugins" aria-haspopup="dialog"><span class="msr">layers</span></button>';
      el.querySelector('button').addEventListener('click', () => toggle());
      return el;
    },
    onRemove() {},
  };
  map.addControl(ctrl, 'top-right');

  const box = document.createElement('div');
  box.className = 'layer-menu';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Ebenen');
  document.body.append(box);

  function toggle(open = box.hidden) {
    box.hidden = !open;
    if (open) paint();
  }
  document.addEventListener('click', (e) => {
    if (!box.hidden && !box.contains(e.target) && !e.target.closest('.layer-ctrl') && !e.target.closest('dialog')) toggle(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) toggle(false); });

  const check = (name, on, icon, label, hint = '') => `
    <label class="layer-row"><span class="msr">${icon}</span><span><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ''}</span>
      <input type="checkbox" data-shape="toggle" name="${name}" ${on ? 'checked' : ''}></label>`;

  async function paint() {
    try { own = await ownLayers.all(); } catch { own = []; }
    box.innerHTML = `
      <header><strong>Ebenen</strong><button type="button" class="button" data-shape="round no-background" data-l="close" title="Schließen"><span class="msr">close</span></button></header>
      <div class="layer-bases">
        <button type="button" data-base="map" aria-pressed="${state.base === 'map'}"><span class="layer-thumb thumb-map"></span>Karte</button>
        <button type="button" data-base="sat" aria-pressed="${state.base === 'sat'}"><span class="layer-thumb thumb-sat"></span>Satellit</button>
      </div>
      ${check('focus', state.focus, 'hiking', 'Wandern & Rad', 'Große Straßen treten zurück, Wanderwege und Relief hervor')}
      <h4>Ebenen</h4>
      ${check('relief', state.relief || state.focus, 'terrain', 'Relief', 'Schatten an Hängen – auch flach von oben')}
      ${Object.entries(TRAILS).map(([k, t]) => check(k, state[k] || (state.focus && k === 'hiking'), t.icon, t.label, 'markierte Routen, Waymarked Trails')).join('')}
      <h4>Eigene Ebenen & Plugins</h4>
      ${own.length ? own.map((l) => check(`own:${l.id}`, l.onMain && l.visible, l.raster ? 'grid_on' : 'scatter_plot', esc(l.name),
        esc(l.source?.kind === 'plugin' ? `Plugin von ${l.source.operator ?? '?'}` : l.raster?.auth ? 'private Quelle' : l.raster ? 'Kartenkacheln' : `${l.count ?? ''} Objekte`))).join('')
        : '<p class="muted">Noch keine – hol dir welche aus dem Katalog oder trag eine eigene Quelle ein.</p>'}
      <div class="layer-actions">
        <a class="button" href="./plugins.html"><span class="msr">extension</span> Plugins holen</a>
        <button type="button" class="button" data-l="own-source"><span class="msr">add_link</span> Eigene Quelle</button>
        <a class="button" href="./plugins.html?f=own"><span class="msr">tune</span> Verwalten</a>
      </div>`;
  }

  box.addEventListener('click', async (e) => {
    const base = e.target.closest('[data-base]')?.dataset.base;
    if (base) { state.base = base; save(); applyBase(); paint(); return; }
    const act = e.target.closest('[data-l]')?.dataset.l;
    if (act === 'close') toggle(false);
    if (act === 'own-source') addSource();
  });
  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.name) return;
    if (t.name.startsWith('own:')) {
      const l = own.find((x) => x.id === t.name.slice(4));
      if (!l) return;
      l.onMain = t.checked;
      if (t.checked) l.visible = true;
      await ownLayers.put(l);
      await applyOwn();
      return;
    }
    state[t.name] = t.checked;
    save();
    applyAll();
    paint();
  });

  async function addSource() {
    const l = await addOwnSource({ toast, index: own.length });
    if (!l) return;
    await applyOwn();
    paint();
  }

  const start = () => { applyAll(); applyOwn(); };
  if (map.loaded()) start(); else map.once('load', start);

  return {
    /** Eigene Ebenen, die gerade auf der Karte liegen (für Klicks) */
    shown: () => shown,
    open: () => toggle(true),
  };
}
