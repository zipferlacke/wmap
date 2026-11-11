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
 *   Linie suchen    „Bus 11“, „Göttingen Linie 9“, „Darmstadt Bus L“, „S3“ – die
 *                   Linie dieses Namens am nächsten (parseLineQuery, findLines)
 *
 * Farbe aus dem Tag „colour“, sonst rot (Bus) bzw. nach Verkehrsart.
 */
import { run } from './overpass.js';
import { esc, cumulative, nearestOnLine, clockFormat } from '../core/geo.js';
import { theme } from '../core/theme.js';
import { locale, t, words } from '../core/i18n.js';

const KINDS = 'bus|trolleybus|tram|light_rail|subway|train|monorail|share_taxi|ferry';
/* Ohne eigene Farbe: Bus rot wie auf der ÖPNV-Karte, Schiene blau/violett */
const COLOR = { bus: '#e03131', trolleybus: '#e03131', share_taxi: '#e8590c', tram: '#9c36b5', light_rail: '#1971c2', subway: '#1864ab', train: '#343a40', monorail: '#1971c2', ferry: '#0c8599' };
const LABEL = { bus: t('services.transit.kinds.bus'), trolleybus: t('services.transit.kinds.trolleybus'), share_taxi: t('services.transit.kinds.share_taxi'), tram: t('services.transit.kinds.tram'), light_rail: t('services.transit.kinds.light_rail'), subway: t('services.transit.kinds.subway'), train: t('services.transit.kinds.train'), monorail: t('services.transit.kinds.monorail'), ferry: t('services.transit.kinds.ferry') };
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
export async function linesAt([lon, lat], name, { ref = null, background = false, signal, feature = null } = {}) {
  const at = (r) => `around:${r},${lat.toFixed(6)},${lon.toFixed(6)}`;
  const stop = '[~"^(public_transport|highway|railway|amenity)$"~"^(platform|stop_position|station|bus_stop|tram_stop|halt|stop|bus_station|ferry_terminal)$"]';
  const rel = `[type=route][route~"^(${KINDS})$"]`;
  const type = { N: 'node', W: 'way', node: 'node', way: 'way' }[ref?.type];
  const mine = type ? `${type}(${ref.id})->.p;(rel(b${type[0]}.p)${rel};)->.a;.a out tags;` : '()->.a;';
  const q = `[out:json][timeout:25];${mine}make grenze;out;
    (${name ? `nwr(${at(150)})[name="${quote(name)}"]${stop};` : ''}nwr(${at(30)})${stop};)->.s;
    (rel(bn.s)${rel};rel(bw.s)${rel};)->.b;(.b; - .a;)->.c;.c out tags;`;
  const els = await run(q, signal, { background, feature });
  const cut = els.findIndex((e) => e.type === 'grenze');
  const pick = (list) => list.filter((e) => e.type === 'relation').map((e) => ({ id: e.id, ...e.tags }));
  const here = pick(els.slice(0, cut));
  return { here, all: [...here, ...pick(els.slice(cut + 1))] };
}

/* ── Linie suchen ─────────────────────────────────────────────────────────── */

/* Wörter für eine Linie → Verkehrsarten (null: alle) und wie die Linie dann heißt */
const LINE_KINDS = {
  line: null, bus: ['bus', 'trolleybus', 'share_taxi'], tram: ['tram', 'light_rail'], light_rail: ['light_rail', 'tram'],
  subway: ['subway', 'light_rail'], suburban: ['light_rail', 'train', 'subway'], train: ['train', 'light_rail'],
};
const lineKind = (k) => [LINE_KINDS[k], t(`lines.labels.${k}`)];
const LINE_WORDS = Object.fromEntries(['line', 'bus', 'tram', 'light_rail', 'subway', 'suburban']
  .flatMap((k) => words(`lines.words.${k}`).map((w) => [w.toLowerCase(), lineKind(k)])));
/* Nummer („11“, „N7“, „154a“) oder ein, zwei Buchstaben („L“) – „Bus nach“ ist keine Linie */
const LINE_REF = /^([a-z]{0,3}\d{1,4}[a-z]?|[a-z]{1,2})$/i;
const LINE_GLUED = new RegExp(`^(${Object.keys(LINE_WORDS).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(\\d{1,4}[a-z]?)$`, 'i');
const LINE_BARE = /^(s|u|re|rb)-?(\d{1,3})$/i;
const BARE_KINDS = { s: lineKind('suburban'), u: lineKind('subway'), re: lineKind('train'), rb: lineKind('train') };
const PLACE_WORDS = new Set(words('lines.place_words'));

/**
 * Meint der Text eine Linie? → { ref, kinds, label, place } oder null
 * Die übrigen Wörter sind der Ort („Göttingen Bus 11“, „Bus 11 in Göttingen“).
 */
export function parseLineQuery(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const low = words[i].toLowerCase();
    let ref = null, kind = null, used = 1;
    if (LINE_WORDS[low] && LINE_REF.test(words[i + 1] ?? '')) { kind = LINE_WORDS[low]; ref = words[i + 1]; used = 2; }
    else if (LINE_GLUED.test(low)) { const m = low.match(LINE_GLUED); kind = LINE_WORDS[m[1]]; ref = m[2]; }
    else if (LINE_BARE.test(low)) { const m = low.match(LINE_BARE); kind = BARE_KINDS[m[1]]; ref = `${m[1]}${m[2]}`; }
    if (!ref) continue;
    const place = [...words.slice(0, i), ...words.slice(i + used)].filter((w) => !PLACE_WORDS.has(w.toLowerCase())).join(' ');
    return { ref: ref.toUpperCase(), kinds: kind[0], label: `${kind[1]} ${ref.toUpperCase()}`, place };
  }
  return null;
}

const LINE_KM = 30;
const kmTo = (center, e) => (e.center
  ? Math.hypot((e.center.lon - center[0]) * Math.cos(center[1] * Math.PI / 180), e.center.lat - center[1]) * 111.32 : Infinity);

/**
 * Linien dieses Namens um den Punkt → Relationen wie bei linesAt, je mit `stop` { name, point }: ihr erster Halt (nur
 * die Mitglieder und Halte, ohne Wege). Dieselbe Nummer gibt es überall: es bleibt der Verkehrsverbund der nächsten
 * (und was ohnehin ganz nah fährt).
 */
export async function findLines({ ref, kinds }, center, { signal, feature = null } = {}) {
  const dy = LINE_KM / 111.32, dx = dy / Math.cos(center[1] * Math.PI / 180);
  const bbox = [center[1] - dy, center[0] - dx, center[1] + dy, center[0] + dx].map((v) => v.toFixed(4)).join(',');
  // „S3“ steht in OSM auch als „S 3“
  const name = ref.replace(/^([A-Z]+)(\d)/, '$1 ?$2');
  const els = await run(`[out:json][timeout:25];rel[type=route][route~"^(${kinds?.join('|') ?? KINDS})$"]["ref"~"^${name}$",i](${bbox})->.r;.r out body center;node(r.r)->.n;.n out body qt;`, signal, { feature });
  const nodes = new Map(els.filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const list = els.filter((e) => e.type === 'relation').sort((a, b) => kmTo(center, a) - kmTo(center, b));
  if (!list.length) return [];
  const net = (e) => e.tags?.network ?? e.tags?.operator ?? '';
  const near = net(list[0]);
  return list.filter((e) => net(e) === near || kmTo(center, e) <= 5).map((e) => ({ id: e.id, ...e.tags, stop: firstOf(e, nodes) }));
}

/** Erster Halt einer Relation (Mitglied stop…/platform… als Punkt) → { name, point } oder null */
function firstOf(rel, nodes) {
  for (const m of rel.members ?? []) {
    const n = m.type === 'node' && /^(stop|platform)/.test(m.role) ? nodes.get(m.ref) : null;
    if (n) return { name: n.tags?.name ?? rel.tags?.from ?? '', point: [n.lon, n.lat] };
  }
  return null;
}

/* ── Liste im Ort-Sheet ───────────────────────────────────────────────────── */

const SHOW = 12;

/**
 * Je Linie eine Zeile, darunter die Richtungen (Hin und Rück sind in OSM
 * zwei Relationen) – jede ein Knopf, der die Linie auf der Karte zeigt.
 */
export function transitHtml(list, { active = null, all = false, title = t('services.transit.lines_here'), extra = '' } = {}) {
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
        <div><strong>${esc(r.ref ? `${LABEL[r.route] ?? t('services.transit.line')} ${r.ref}` : r.name ?? t('services.transit.line'))}</strong>
          ${rs.map((x) => `<button type="button" class="transit-dir" data-line="${x.id}" aria-pressed="${x.id === active}" style="--c:${esc(colorOf(x))}">
            <span class="msr">${x.id === active ? 'visibility' : 'arrow_forward'}</span>
            <span>${esc(x.from || x.to ? `${x.from ?? '…'} → ${x.to ?? '…'}` : x.name ?? t('services.transit.show_course'))}</span></button>`).join('')}
          ${r.operator || r.network ? `<small class="muted">${esc([r.operator, r.network].filter(Boolean).join(' · '))}</small>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>
    ${groups.length > shown.length ? `<button type="button" class="button transit-more" data-transit="all"><span class="msr">expand_more</span> ${t('services.transit.all_lines', { n: groups.length })}</button>` : ''}`;
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
  async function show(id, { from = null, feature = null } = {}) {
    ctl?.abort();
    ctl = new AbortController();
    const els = await run(`[out:json][timeout:25];rel(${id})->.r;.r out geom;node(r.r);out qt;way(r.r:"platform");out tags center qt;`, ctl.signal, { feature });
    const rel = els.find((e) => e.type === 'relation' && e.id === id);
    if (!rel) throw new Error(t('services.transit.not_found'));
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
   * Verlauf einer Fahrt aus dem Fahrplan zeigen (services/timetable tripCourse) –
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
  const tm = (x) => (x?.time ? `<time>${x.time.toLocaleTimeString(locale, { ...clockFormat() })}</time>` : '');
  const list = next?.length > 1 ? next : stops;
  const summary = !next ? t('services.transit.stops', { n: stops.length })
    : next.length > 1 ? t('services.transit.stops_left', { n: next.length - 1, to: esc(nm(next.at(-1))), arrival: next.at(-1).time ? t('services.transit.arrival', { time: tm(next.at(-1)).replace(/<\/?time>/g, '') }) : '' })
      : t('services.transit.ends_here', { n: stops.length });
  return `<details class="transit-stops"><summary>${summary}</summary>
    <ol>${list.map((x) => `<li>${tm(x)}${esc(nm(x))}</li>`).join('')}</ol></details>`;
}
