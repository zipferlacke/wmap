/**
 * ÖPNV aus OpenStreetMap – ohne eigenes Liniennetz auf der Karte:
 *
 *   Haltestelle     die Haltestellen stehen schon in der Grundkarte; antippen
 *                   öffnet sie wie jeden Ort, darunter „Linien hier“ (linesAt)
 *   Linie antippen  genau diese Linie komplett in ihrer Farbe mit allen
 *                   Halten auf der Karte (mountTransitLine), bis der Ort
 *                   geschlossen oder eine andere Linie gewählt wird
 *
 * Farbe aus dem Tag „colour“, sonst rot (Bus) bzw. nach Verkehrsart.
 */
import { run } from './overpass.js';
import { esc } from './geo.js';
import { theme } from './theme.js';

const KINDS = 'bus|trolleybus|tram|light_rail|subway|train|monorail|share_taxi|ferry';
/* Ohne eigene Farbe: Bus rot wie auf der ÖPNV-Karte, Schiene blau/violett */
const COLOR = { bus: '#e03131', trolleybus: '#e03131', share_taxi: '#e8590c', tram: '#9c36b5', light_rail: '#1971c2', subway: '#1864ab', train: '#343a40', monorail: '#1971c2', ferry: '#0c8599' };
const LABEL = { bus: 'Bus', trolleybus: 'O-Bus', share_taxi: 'Anrufbus', tram: 'Tram', light_rail: 'Stadtbahn', subway: 'U-Bahn', train: 'Zug', monorail: 'Bahn', ferry: 'Fähre' };
const ICON = { bus: 'directions_bus', trolleybus: 'directions_bus', share_taxi: 'airport_shuttle', tram: 'tram', light_rail: 'train', subway: 'subway', train: 'train', monorail: 'train', ferry: 'directions_boat' };
// Reihenfolge in der Liste: Schiene vor Bus
const RANK = ['train', 'subway', 'light_rail', 'monorail', 'tram', 'trolleybus', 'bus', 'share_taxi', 'ferry'];

/** Gültige Farbe aus OSM („red“, „#C00“, „#c00000“) – sonst die der Verkehrsart */
function colorOf(tags) {
  const c = (tags.colour ?? '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) || /^[a-z]+$/i.test(c)) return c;
  return COLOR[tags.route] ?? '#e03131';
}

/** Ist das OSM-Objekt eine Haltestelle oder ein Bahnhof? */
export function isStop(tags = {}) {
  return tags.highway === 'bus_stop'
    || ['platform', 'stop_position', 'station', 'stop_area'].includes(tags.public_transport)
    || ['station', 'halt', 'tram_stop', 'stop'].includes(tags.railway)
    || ['bus_station', 'ferry_terminal'].includes(tags.amenity);
}

const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Linien, die an der Haltestelle halten: alle Steige gleichen Namens in der
 * Nähe (die Gegenrichtung steht oft gegenüber), dazu alles direkt daneben.
 * → [{ id, route, ref, name, from, to, colour, operator, network }]
 */
export async function linesAt([lon, lat], name, { signal } = {}) {
  const at = (r) => `around:${r},${lat.toFixed(6)},${lon.toFixed(6)}`;
  const stop = '[~"^(public_transport|highway|railway|amenity)$"~"^(platform|stop_position|station|bus_stop|tram_stop|halt|stop|bus_station|ferry_terminal)$"]';
  const q = `[out:json][timeout:25];
    (${name ? `nwr(${at(150)})[name="${quote(name)}"]${stop};` : ''}nwr(${at(30)})${stop};)->.s;
    (rel(bn.s)[type=route][route~"^(${KINDS})$"];rel(bw.s)[type=route][route~"^(${KINDS})$"];);
    out tags;`;
  const els = await run(q, signal);
  return els.filter((e) => e.type === 'relation').map((e) => ({ id: e.id, ...e.tags }));
}

/* ── Liste im Ort-Sheet ───────────────────────────────────────────────────── */

const SHOW = 12;

/**
 * Je Linie eine Zeile, darunter die Richtungen (Hin und Rück sind in OSM
 * zwei Relationen) – jede ein Knopf, der die Linie auf der Karte zeigt.
 */
export function transitHtml(list, { active = null, all = false } = {}) {
  const byLine = new Map();
  for (const r of list) {
    const key = `${r.route}|${r.ref ?? r.name}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(r);
  }
  const groups = [...byLine.values()].sort((a, b) => (RANK.indexOf(a[0].route) - RANK.indexOf(b[0].route))
    || String(a[0].ref ?? a[0].name ?? '').localeCompare(String(b[0].ref ?? b[0].name ?? ''), 'de', { numeric: true }));
  const shown = all ? groups : groups.slice(0, SHOW);
  return `<h3 class="section-title">Linien hier</h3>
    <ul class="transit-list">${shown.map((rs) => {
      const r = rs[0];
      return `<li>
        <span class="transit-badge" style="--c:${esc(colorOf(r))}"><span class="msr">${ICON[r.route] ?? 'directions_bus'}</span>${esc(r.ref ?? '')}</span>
        <div><strong>${esc(r.ref ? `${LABEL[r.route] ?? 'Linie'} ${r.ref}` : r.name ?? 'Linie')}</strong>
          ${rs.map((x) => `<button type="button" class="transit-dir" data-line="${x.id}" aria-pressed="${x.id === active}" style="--c:${esc(colorOf(x))}">
            <span class="msr">${x.id === active ? 'visibility' : 'arrow_forward'}</span>
            <span>${esc(x.from || x.to ? `${x.from ?? '…'} → ${x.to ?? '…'}` : x.name ?? 'Verlauf zeigen')}</span></button>`).join('')}
          ${r.operator || r.network ? `<small class="muted">${esc([r.operator, r.network].filter(Boolean).join(' · '))}</small>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>
    ${groups.length > shown.length ? `<button type="button" class="button transit-more" data-transit="all"><span class="msr">expand_more</span> Alle ${groups.length} Linien</button>` : ''}`;
}

/* ── Eine Linie auf der Karte ─────────────────────────────────────────────── */

const SRC = 'transit-line';
const EMPTY = { type: 'FeatureCollection', features: [] };

export function mountTransitLine(map) {
  let shown = null;                  // Relation, die gerade zu sehen ist
  let ctl = null;
  const halo = () => (theme.dark ? '#111418' : '#ffffff');

  function ensure() {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'transit-casing', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': halo(), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9, 18, 14] } });
    map.addLayer({ id: 'transit-route', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 5.5, 18, 9] } });
    map.addLayer({ id: 'transit-stop', type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 5.5], 'circle-color': halo(),
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3] } });
    map.addLayer({ id: 'transit-stop-label', type: 'symbol', source: SRC, minzoom: 12.5, filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-optional': true },
      paint: { 'text-color': theme.dark ? '#e9ecef' : '#212529', 'text-halo-color': halo(), 'text-halo-width': 1.8 } });
  }

  addEventListener('wmap:theme', () => {
    if (!map.getLayer('transit-casing')) return;
    map.setPaintProperty('transit-casing', 'line-color', halo());
    map.setPaintProperty('transit-stop', 'circle-color', halo());
    map.setPaintProperty('transit-stop-label', 'text-halo-color', halo());
    map.setPaintProperty('transit-stop-label', 'text-color', theme.dark ? '#e9ecef' : '#212529');
  });

  /** Linie holen und zeigen → { tags, stops: [Name], bounds } */
  async function show(id) {
    ctl?.abort();
    ctl = new AbortController();
    const els = await run(`[out:json][timeout:25];rel(${id})->.r;.r out geom;node(r.r);out qt;way(r.r:"platform");out tags center qt;`, ctl.signal);
    const rel = els.find((e) => e.type === 'relation' && e.id === id);
    if (!rel) throw new Error('Linie nicht gefunden');
    const tags = rel.tags ?? {};
    const color = colorOf(tags);
    const named = new Map(els.filter((e) => e.type !== 'relation' && e.tags?.name).map((e) => [`${e.type[0]}${e.id}`, e]));
    const features = [];
    for (const m of rel.members ?? []) {
      if (m.type === 'way' && !/platform/.test(m.role) && m.geometry?.length > 1) {
        features.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]) } });
      }
    }
    // Halte der Reihe nach; Haltepunkt und Steig gleichen Namens nur einmal
    const stops = [];
    for (const m of rel.members ?? []) {
      if (!/^(stop|platform)/.test(m.role)) continue;
      const el = named.get(`${m.type[0]}${m.ref}`);
      const name = el?.tags.name;
      const point = m.type === 'node' ? [m.lon, m.lat] : el?.center ? [el.center.lon, el.center.lat] : null;
      if (!name || !point || stops.at(-1)?.name === name) continue;
      stops.push({ name, point });
    }
    for (const s of stops) features.push({ type: 'Feature', properties: { color, name: s.name }, geometry: { type: 'Point', coordinates: s.point } });
    ensure();
    map.getSource(SRC).setData({ type: 'FeatureCollection', features });
    shown = id;
    const b = rel.bounds;
    return { tags: { id, ...tags }, stops: stops.map((s) => s.name), bounds: b ? [[b.minlon, b.minlat], [b.maxlon, b.maxlat]] : null };
  }

  return {
    show,
    get shown() { return shown; },
    clear() {
      ctl?.abort();
      shown = null;
      map.getSource(SRC)?.setData(EMPTY);
    },
  };
}

/** Kurzinfo unter der gewählten Richtung: Halte zum Aufklappen */
export function lineStopsHtml({ stops }) {
  if (!stops.length) return '';
  return `<details class="transit-stops"><summary>${stops.length} Halte</summary>
    <ol>${stops.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`;
}
