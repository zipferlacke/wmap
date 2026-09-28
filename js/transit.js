/**
 * ÖPNV aus OpenStreetMap – ohne eigenes Liniennetz auf der Karte:
 *
 *   Haltestelle     die Haltestellen stehen schon in der Grundkarte; antippen
 *                   öffnet sie wie jeden Ort, darunter die Linien, die an
 *                   genau diesem Steig halten – also in diese Richtung –,
 *                   auf Wunsch alle der Haltestelle (linesAt)
 *   Linie antippen  genau diese Linie komplett in ihrer Farbe mit allen
 *                   Halten auf der Karte (mountTransitLine); was von hier aus
 *                   noch kommt, kräftig, der Weg bis hierher blass
 *
 * Farbe aus dem Tag „colour“, sonst rot (Bus) bzw. nach Verkehrsart.
 */
import { run } from './overpass.js';
import { esc, cumulative, nearestOnLine } from './geo.js';
import { theme } from './theme.js';

const KINDS = 'bus|trolleybus|tram|light_rail|subway|train|monorail|share_taxi|ferry';
/* Ohne eigene Farbe: Bus rot wie auf der ÖPNV-Karte, Schiene blau/violett */
const COLOR = { bus: '#e03131', trolleybus: '#e03131', share_taxi: '#e8590c', tram: '#9c36b5', light_rail: '#1971c2', subway: '#1864ab', train: '#343a40', monorail: '#1971c2', ferry: '#0c8599' };
const LABEL = { bus: 'Bus', trolleybus: 'O-Bus', share_taxi: 'Anrufbus', tram: 'Tram', light_rail: 'Stadtbahn', subway: 'U-Bahn', train: 'Zug', monorail: 'Bahn', ferry: 'Fähre' };
const ICON = { bus: 'directions_bus', trolleybus: 'directions_bus', share_taxi: 'airport_shuttle', tram: 'tram', light_rail: 'train', subway: 'subway', train: 'train', monorail: 'train', ferry: 'directions_boat' };
// Reihenfolge in der Liste: Schiene vor Bus
const RANK = ['train', 'subway', 'light_rail', 'monorail', 'tram', 'trolleybus', 'bus', 'share_taxi', 'ferry'];

/** Gültige Farbe aus OSM („red“, „#C00“, „#c00000“) – sonst die der Verkehrsart */
export function colorOf(tags) {
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
 * Linien an der Haltestelle. Mit ref (der angetippte Steig aus OSM) getrennt:
 *   here  Linien, die genau an diesem Steig halten – die Richtung dieser Seite
 *   all   alle der Haltestelle: Steige gleichen Namens im Umkreis (die
 *         Gegenrichtung steht oft gegenüber) und alles direkt daneben
 * `background`: nur Zugabe (Farben) – Overpass ohne parallele Nachfragen
 * → { here: [{ id, route, ref, name, from, to, colour, … }], all: […] }
 */
export async function linesAt([lon, lat], name, { ref = null, background = false, signal } = {}) {
  const at = (r) => `around:${r},${lat.toFixed(6)},${lon.toFixed(6)}`;
  const stop = '[~"^(public_transport|highway|railway|amenity)$"~"^(platform|stop_position|station|bus_stop|tram_stop|halt|stop|bus_station|ferry_terminal)$"]';
  const rel = `[type=route][route~"^(${KINDS})$"]`;
  const type = { N: 'node', W: 'way', node: 'node', way: 'way' }[ref?.type];
  const mine = type ? `${type}(${ref.id})->.p;(rel(b${type[0]}.p)${rel};)->.a;.a out tags;` : '()->.a;';
  const q = `[out:json][timeout:25];${mine}make grenze;out;
    (${name ? `nwr(${at(150)})[name="${quote(name)}"]${stop};` : ''}nwr(${at(30)})${stop};)->.s;
    (rel(bn.s)${rel};rel(bw.s)${rel};)->.b;(.b; - .a;)->.c;.c out tags;`;
  const els = await run(q, signal, { background });
  const cut = els.findIndex((e) => e.type === 'grenze');
  const pick = (list) => list.filter((e) => e.type === 'relation').map((e) => ({ id: e.id, ...e.tags }));
  const here = pick(els.slice(0, cut));
  return { here, all: [...here, ...pick(els.slice(cut + 1))] };
}

/* ── Liste im Ort-Sheet ───────────────────────────────────────────────────── */

const SHOW = 12;

/**
 * Je Linie eine Zeile, darunter die Richtungen (Hin und Rück sind in OSM
 * zwei Relationen) – jede ein Knopf, der die Linie auf der Karte zeigt.
 */
export function transitHtml(list, { active = null, all = false, title = 'Linien hier', extra = '' } = {}) {
  const byLine = new Map();
  for (const r of list) {
    const key = `${r.route}|${r.ref ?? r.name}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(r);
  }
  const groups = [...byLine.values()].sort((a, b) => (RANK.indexOf(a[0].route) - RANK.indexOf(b[0].route))
    || String(a[0].ref ?? a[0].name ?? '').localeCompare(String(b[0].ref ?? b[0].name ?? ''), 'de', { numeric: true }));
  const shown = all ? groups : groups.slice(0, SHOW);
  return `<h3 class="section-title">${esc(title)}</h3>${extra}
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
      paint: { 'line-color': halo(), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9, 18, 14],
        'line-opacity': ['case', ['get', 'past'], 0.35, 1] } });
    map.addLayer({ id: 'transit-route', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 5.5, 18, 9],
        'line-opacity': ['case', ['get', 'past'], 0.35, 1] } });
    map.addLayer({ id: 'transit-stop', type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 5.5], 'circle-color': halo(), 'circle-opacity': ['case', ['get', 'past'], 0.4, 1],
        'circle-stroke-opacity': ['case', ['get', 'past'], 0.4, 1],
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

  /**
   * Linie holen und zeigen → { tags, stops: [Name], bounds, next }
   * @param from  Haltestelle: der Weg bis hierher blass, was kommt kräftig
   */
  async function show(id, { from = null } = {}) {
    ctl?.abort();
    ctl = new AbortController();
    const els = await run(`[out:json][timeout:25];rel(${id})->.r;.r out geom;node(r.r);out qt;way(r.r:"platform");out tags center qt;`, ctl.signal);
    const rel = els.find((e) => e.type === 'relation' && e.id === id);
    if (!rel) throw new Error('Linie nicht gefunden');
    const tags = rel.tags ?? {};
    const color = colorOf(tags);
    const named = new Map(els.filter((e) => e.type !== 'relation' && e.tags?.name).map((e) => [`${e.type[0]}${e.id}`, e]));
    const ways = (rel.members ?? []).filter((m) => m.type === 'way' && !/platform/.test(m.role) && m.geometry?.length > 1)
      .map((m) => m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]));
    // Der Reihe nach zu einer Linie, damit „vor“ und „nach“ der Haltestelle klar ist
    const line = chain(ways);
    const cum = cumulative(line);
    const here = from && line.length > 1 ? nearestOnLine(line, cum, from).along : null;
    const features = here === null
      ? ways.map((c) => ({ type: 'Feature', properties: { color, past: false }, geometry: { type: 'LineString', coordinates: c } }))
      : [[0, here, true], [here, cum.at(-1), false]].filter(([a, b]) => b - a > 1).map(([a, b, past]) => ({
        type: 'Feature', properties: { color, past }, geometry: { type: 'LineString', coordinates: sliceLine(line, cum, a, b) },
      }));
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
    for (const s of stops) {
      s.past = here !== null && nearestOnLine(line, cum, s.point).along < here - 30;
      features.push({ type: 'Feature', properties: { color, name: s.name, past: s.past }, geometry: { type: 'Point', coordinates: s.point } });
    }
    ensure();
    map.getSource(SRC).setData({ type: 'FeatureCollection', features });
    shown = id;
    const b = rel.bounds;
    const next = stops.filter((s) => !s.past);
    // Ausschnitt: ab hier bis zum Ziel, sonst die ganze Linie
    const pts = here !== null && next.length > 1 ? [from, ...next.map((s) => s.point)] : null;
    const bounds = pts ? [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]]
      : b ? [[b.minlon, b.minlat], [b.maxlon, b.maxlat]] : null;
    return { tags: { id, ...tags }, stops: stops.map((s) => s.name), next: here === null ? null : next.map((s) => s.name), bounds };
  }

  /**
   * Verlauf einer Fahrt aus dem Fahrplan zeigen (departures.js tripCourse) –
   * ohne OSM. Ab dem Halt `index` kräftig, davor blass.
   * @param key  Kennung für `shown` (Linie und Fahrt)
   * → { stops, next, bounds } wie show(); Halte mit Zeit
   */
  function showCourse(key, { coords, stops, index, color }) {
    ctl?.abort();
    const line = coords.length > 1 ? coords : stops.map((x) => x.point).filter(Boolean);
    const cum = cumulative(line);
    const at = index >= 0 && stops[index].point && line.length > 1 ? nearestOnLine(line, cum, stops[index].point).along : null;
    const features = at === null
      ? [{ type: 'Feature', properties: { color, past: false }, geometry: { type: 'LineString', coordinates: line } }]
      : [[0, at, true], [at, cum.at(-1), false]].filter(([a, b]) => b - a > 1).map(([a, b, past]) => ({
        type: 'Feature', properties: { color, past }, geometry: { type: 'LineString', coordinates: sliceLine(line, cum, a, b) },
      }));
    stops.forEach((x, i) => {
      if (x.point) features.push({ type: 'Feature', properties: { color, name: x.name, past: index >= 0 && i < index }, geometry: { type: 'Point', coordinates: x.point } });
    });
    ensure();
    map.getSource(SRC).setData({ type: 'FeatureCollection', features });
    shown = key;
    const next = index >= 0 ? stops.slice(index) : null;
    const pts = (next && next.length > 1 ? next : stops).map((x) => x.point).filter(Boolean);
    const bounds = pts.length ? [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]] : null;
    return { stops, next, bounds };
  }

  return {
    show,
    showCourse,
    get shown() { return shown; },
    clear() {
      ctl?.abort();
      shown = null;
      map.getSource(SRC)?.setData(EMPTY);
    },
  };
}

/** Wege einer Relation der Reihe nach zu einer Linie – jedes Stück passend gedreht */
function chain(ways) {
  const out = [];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  ways.forEach((w, i) => {
    let c = w;
    if (!out.length) {
      // Erstes Stück so drehen, dass sein Ende am nächsten liegt
      const n = ways[i + 1];
      if (n && Math.min(d2(c[0], n[0]), d2(c[0], n.at(-1))) < Math.min(d2(c.at(-1), n[0]), d2(c.at(-1), n.at(-1)))) c = [...c].reverse();
      out.push(...c);
      return;
    }
    if (d2(out.at(-1), c.at(-1)) < d2(out.at(-1), c[0])) c = [...c].reverse();
    out.push(...(d2(out.at(-1), c[0]) < 1e-12 ? c.slice(1) : c));
  });
  return out;
}

function sliceLine(line, cum, a, b) {
  const at = (m) => {
    const i = Math.max(1, cum.findIndex((x) => x >= m));
    const t = (m - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
  };
  return [at(a), ...line.filter((_, i) => cum[i] > a && cum[i] < b), at(b)];
}

/**
 * Kurzinfo unter der gewählten Richtung: die nächsten Halte, alle zum
 * Aufklappen. Halte sind Namen (OSM) oder { name, time } (Fahrplan).
 */
export function lineStopsHtml({ stops, next }) {
  if (!stops.length) return '';
  const nm = (x) => (typeof x === 'string' ? x : x.name);
  const tm = (x) => (x?.time ? `<time>${x.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time>` : '');
  const list = next?.length > 1 ? next : stops;
  const summary = !next ? `${stops.length} Halte`
    : next.length > 1 ? `Noch ${next.length - 1} ${next.length === 2 ? 'Halt' : 'Halte'} bis ${esc(nm(next.at(-1)))}${next.at(-1).time ? ` (an ${tm(next.at(-1)).replace(/<\/?time>/g, '')})` : ''}`
      : `Endet hier – ${stops.length} Halte bis hierher`;
  return `<details class="transit-stops"><summary>${summary}</summary>
    <ol>${list.map((x) => `<li>${tm(x)}${esc(nm(x))}</li>`).join('')}</ol></details>`;
}
