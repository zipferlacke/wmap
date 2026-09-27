/**
 * Was die Navigation über die Route hinaus wissen will – einmal beim Start
 * geholt, exakt für die gewählte Linie (Valhalla, shape_match „edge_walk“):
 *
 *   limits   Tempolimits      [[von m, bis m, km/h], …]
 *   signals  Ampeln           [m, …]
 *   lanes    Fahrspuren       [{ at: m, lanes: [{ dirs: ['left'], use: bool, act: 'left' }] }]
 *            (act = die Richtung, in die es von dieser Spur aus weitergeht)
 *   dests    Wegweiser        [{ at: m, text: 'Kassel, Hann. Münden' }]
 *   twoWay   Gegenverkehr     [[von m, bis m], …] – dort liegen unsere Spuren
 *            rechts der Mittellinie, sonst (Einbahn) mittig
 *   roads    Fahrbahn         [[von m, bis m, Spuren, Gegenspuren], …] – Spuren
 *            in unserer Richtung (OSM lanes:forward), Gegenspuren 0 = Einbahn
 *
 * Alles in Metern entlang der Route. Die Daten reisen mit der Route (auch
 * offline gespeichert); fehlen sie, läuft die Navigation ohne.
 */
import { PROFILES } from './config.js';
import { encodePolyline, nearestOnLine, pointAt, bearing, destination } from './geo.js';
import { request, costingOptions } from './routing.js';

// Valhalla nimmt nicht beliebig lange Linien – in Stücken abfragen
const CHUNK = 3000;

export async function routeExtras(route, profile, { signal } = {}) {
  const out = { limits: [], signals: [], lanes: [], dests: [], twoWay: [], roads: [] };
  const costing = PROFILES[profile]?.costing ?? 'auto';
  for (let i = 0; i < route.coords.length - 1; i += CHUNK) {
    const part = route.coords.slice(i, i + CHUNK + 1);
    const offset = route.cum[i];
    const base = { encoded_polyline: encodePolyline(part), costing, costing_options: costingOptions(profile), shape_match: 'edge_walk' };
    const [attrs, match] = await Promise.all([
      request({
        ...base,
        filters: { attributes: ['edge.speed_limit', 'edge.traffic_signal', 'edge.length', 'edge.traversability', 'edge.lane_count', 'edge.road_class'], action: 'include' },
      }, signal, 'trace_attributes').catch(() => null),
      costing === 'auto' ? request({ ...base, format: 'osrm', language: 'de-DE' }, signal, 'trace_route').catch(() => null) : null,
    ]);

    if (attrs?.edges?.length) {
      // Kantenlängen aufsummieren; kleine Abweichungen zur eigenen Messung ausgleichen
      const sum = attrs.edges.reduce((s, e) => s + (e.length ?? 0) * 1000, 0) || 1;
      const scale = (route.cum[Math.min(i + CHUNK, route.coords.length - 1)] - offset) / sum;
      let m = offset;
      for (const e of attrs.edges) {
        const len = (e.length ?? 0) * 1000 * scale;
        const kmh = e.speed_limit > 0 && e.speed_limit < 200 ? e.speed_limit : null;
        const last = out.limits.at(-1);
        if (kmh && last && last[2] === kmh && Math.abs(last[1] - m) < 1) last[1] = m + len;
        else if (kmh) out.limits.push([m, m + len, kmh]);
        if (e.traversability === 'both') {
          const tw = out.twoWay.at(-1);
          if (tw && Math.abs(tw[1] - m) < 1) tw[1] = m + len; else out.twoWay.push([m, m + len]);
        }
        // Gegenspuren kennt Valhalla nur für die eigene Kante: große Straßen
        // haben meist so viele wie wir (höchstens zwei), kleine eine
        const n = clampLanes(e.lane_count);
        const opp = e.traversability !== 'both' ? 0 : BIG_CLASS.has(e.road_class) ? Math.min(n, 2) : 1;
        const rd = out.roads.at(-1);
        if (rd && rd[2] === n && rd[3] === opp && Math.abs(rd[1] - m) < 1) rd[1] = m + len;
        else out.roads.push([m, m + len, n, opp]);
        m += len;
        if (e.traffic_signal) out.signals.push(Math.round(m));
      }
    }

    const cumPart = route.cum.slice(i, i + CHUNK + 1);
    let from = 0;
    for (const leg of match?.matchings?.[0]?.legs ?? []) {
      for (const step of leg.steps ?? []) {
        for (const x of step.intersections ?? []) {
          if (!x.lanes?.length || !x.location) continue;
          const s = nearestOnLine(part, cumPart, x.location, from, from + 400);
          from = s.index;
          if (s.offset > 30) continue;
          out.lanes.push({
            at: Math.round(s.along),       // cum-Werte sind schon Meter ab Routenstart
            lanes: x.lanes.map((l) => ({ dirs: l.indications ?? [], use: !!l.valid, act: l.valid_indication ?? null })),
          });
        }
        if (step.destinations && step.maneuver?.location) {
          const s = nearestOnLine(part, cumPart, step.maneuver.location, Math.max(0, from - 50), from + 400);
          if (s.offset < 30) out.dests.push({ at: Math.round(s.along), text: step.destinations });
        }
      }
    }
  }
  return out;
}

const BIG_CLASS = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const clampLanes = (n) => Math.min(8, Math.max(1, Math.round(n) || 1));

/** Tempolimit an der Stelle – oder null, wenn unbekannt. */
export function limitAt(extras, along) {
  for (const [a, b, kmh] of extras?.limits ?? []) if (along >= a && along < b) return kmh;
  return null;
}

/** Spuren an der Kreuzung am nächsten zu `at` (± 40 m). */
export function lanesAt(extras, at) {
  let best = null;
  for (const l of extras?.lanes ?? []) {
    const d = Math.abs(l.at - at);
    if (d <= 40 && (!best || d < Math.abs(best.at - at))) best = l;
  }
  return best?.lanes ?? null;
}

/** Wegweiser-Text am Manöver (± 40 m). */
export function destAt(extras, at) {
  return (extras?.dests ?? []).find((d) => Math.abs(d.at - at) <= 40)?.text ?? null;
}

/** Ampel kurz vor der Stelle? */
export function signalBefore(extras, at, within = 30) {
  return (extras?.signals ?? []).some((s) => s <= at + 5 && s >= at - within);
}

/** Gegenverkehr an der Stelle? */
export function twoWayAt(extras, at) {
  return (extras?.twoWay ?? []).some(([a, b]) => at >= a && at <= b);
}

/* ── Fahrspuren zum Einzeichnen ───────────────────────────────────────────── */

export const LANE_WIDTH = 3.2;       // Meter – typische Spurbreite innerorts

/** Symbol je Spurpfeil (OSRM-Angabe → Name der Icon-Schrift) */
export const LANE_GLYPH = {
  left: 'turn_left', 'slight left': 'turn_slight_left', 'sharp left': 'turn_sharp_left',
  right: 'turn_right', 'slight right': 'turn_slight_right', 'sharp right': 'turn_sharp_right',
  straight: 'straight', uturn: 'u_turn_left', 'merge to left': 'merge', 'merge to right': 'merge', none: 'straight',
};

/**
 * Die Fahrbahn entlang der Route mit allen Spuren – Asphalt in echter
 * Breite, Rand, Mittellinie, gestrichelte Spurtrennung, die Spur(en), in
 * denen wir fahren sollen, und vor Kreuzungen die Pfeile auf dem Asphalt.
 * Die Karte selbst kennt nur eine Linie je Straße.
 *
 * Alles kommt aus einem Modell (sectionsFor): Abschnitte mit Spurzahl,
 * Gegenspuren und den markierten Spuren. Vor einer Kreuzung mit
 * Spurangaben gilt deren Zahl – so passt die Fahrbahn zu den Pfeilen.
 * Ändert sich etwas, gleitet es über 50 m: Die Linien stehen quer versetzt
 * in der Geometrie, der Asphalt ist eine Fläche aus kleinen Vierecken.
 *
 * @param from, to  Meter entlang der Route
 * @param left      [[von, bis], …] – dort links fahren (vor dem Linksabbiegen),
 *                  sonst rechts (Rechtsfahrgebot)
 */
export function roadFeatures(route, extras, from, to, { left = [] } = {}) {
  const sections = sectionsFor(extras, left);
  const end = route.cum[route.cum.length - 1];
  from = Math.max(0, from);
  to = Math.min(to, end);
  if (!sections.length || to - from < 5) return [];
  const w = LANE_WIDTH;
  const at = (d) => pointAt(route.coords, route.cum, Math.min(end, Math.max(0, d)));
  const k = 512 / (40075016.686 * Math.cos((at(from)[1] * Math.PI) / 180));
  const whole = (v) => Math.abs(v - Math.round(v)) < 0.02;
  const dirAt = (d) => bearing(at(d - 8), at(d + 8));

  const feats = [];
  const runs = new Map();                        // Schlüssel → { kind, m, coords }
  const quads = [];                              // Asphalt: je Schritt ein Viereck
  let prev = null;
  const closeLine = (key) => {
    const r = runs.get(key);
    runs.delete(key);
    if (r.coords.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: { kind: r.kind, off: 0, m: r.m, k } });
  };

  for (let d = from; d <= to + 0.01; d += STEP) {
    const L = layoutAt(sections, d);
    if (!L) { [...runs.keys()].forEach(closeLine); prev = null; continue; }
    const p = at(d);
    // Richtung über ±8 m gemittelt – sonst zittern die Ränder in Kurven
    const dir = dirAt(d) + 90;
    const shift = (off) => (Math.abs(off) < 0.01 ? p : destination(p, dir, off));
    const { n, opp, l0, r0, first, track, trackW } = L;
    const want = [['edge:l', 'edge', l0, 0.18], ['edge:r', 'edge', r0, 0.18], ['track', 'track', track, trackW]];
    if (opp > 0.05) want.push(['mid', 'mid', 0, 0.14]);
    // Trennlinien nur, wo die Spurzahl feststeht – im Übergang wanderten sie
    if (whole(n) && whole(opp)) {
      for (let i = 1; i < Math.round(opp); i += 1) want.push([`sep:o${i}`, 'sep', -i * w, 0.13]);
      for (let i = 1; i < Math.round(n); i += 1) want.push([`sep:${i}`, 'sep', first + i * w, 0.13]);
    }
    const keys = new Set(want.map(([key]) => key));
    for (const key of [...runs.keys()]) if (!keys.has(key)) closeLine(key);
    for (const [key, kind, off, m] of want) {
      // Breite der Spurmarkierung wechselt? Neue Linie (Breite ist je Linie fest)
      const r = runs.get(key);
      if (r && Math.abs(r.m - m) > 0.05) {
        const last = r.coords.at(-1);
        closeLine(key);
        runs.set(key, { kind, m: +m.toFixed(2), coords: [last] });
      }
      if (!runs.has(key)) runs.set(key, { kind, m: +m.toFixed(2), coords: [] });
      runs.get(key).coords.push(shift(off));
    }
    // Kleine Vierecke statt einer langen Fläche: In engen Kurven schneidet
    // sich deren Innenrand, und die Karte ließe Teile der Fläche weg
    const cur = [shift(l0 - 0.3), shift(r0 + 0.3)];
    if (prev) quads.push([[prev[0], cur[0], cur[1], prev[1], prev[0]]]);
    prev = cur;
  }
  [...runs.keys()].forEach(closeLine);
  if (quads.length) feats.unshift({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: quads }, properties: { kind: 'asphalt' } });

  // Pfeile auf dem Asphalt: je Spur zwei Stück vor jeder Kreuzung mit Spurangaben
  for (const x of extras?.lanes ?? []) {
    for (const back of [14, 50]) {
      const d = x.at - back;
      if (d < from || d > to) continue;
      const L = layoutAt(sections, d);
      if (!L || Math.abs(L.n - x.lanes.length) > 0.02) continue;
      const p = at(d);
      const dir = dirAt(d);
      x.lanes.forEach((l, i) => {
        const turn = l.use && l.act ? l.act : l.dirs.find((t) => LANE_GLYPH[t]);
        const glyph = LANE_GLYPH[turn ?? 'straight'] ?? 'straight';
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: destination(p, dir + 90, L.first + (i + 0.5) * w) },
          properties: { kind: 'arrow', icon: `lane-${l.use ? 'on' : 'off'}-${glyph}`, rot: dir, k },
        });
      });
    }
  }
  return feats;
}

const STEP = 2.5;
const EASE = 50;                              // Meter für einen Übergang
const LANE_ZONE = 150;                        // so weit vor der Kreuzung gelten ihre Spuren

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerpNum = (x, y, t) => x + (y - x) * t;

/**
 * Abschnitte [von, bis, Spuren, Gegenspuren, erste markierte, letzte markierte]
 * aus Straßendaten, Kreuzungsspuren und „links fahren“. Einmal je Route
 * berechnet und gemerkt.
 */
const cache = new WeakMap();
function sectionsFor(extras, left) {
  const roads = extras?.roads ?? [];
  if (!roads.length) return [];
  const hit = cache.get(extras);
  if (hit && hit.left === left) return hit.out;
  const zones = (extras.lanes ?? []).filter((x) => x.lanes.length >= 1).map((x) => [x.at - LANE_ZONE, x.at, x.lanes]);
  const cuts = new Set();
  for (const [a, b] of [...roads, ...zones, ...left]) { cuts.add(a); cuts.add(b); }
  const xs = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 0.5) continue;
    const mid = (a + b) / 2;
    const r = roads.find(([x0, x1]) => mid >= x0 && mid < x1);
    if (!r) continue;
    let n = r[2], u0, u1;
    // Die nächste Kreuzung voraus bestimmt die Spuren
    const z = zones.find(([x0, x1]) => mid >= x0 && mid < x1);
    if (z) {
      n = z[2].length;
      const use = z[2].map((l, j) => (l.use ? j : -1)).filter((j) => j >= 0);
      [u0, u1] = use.length ? [use[0], use.at(-1)] : [n - 1, n - 1];
    } else {
      const keepLeft = left.some(([x0, x1]) => mid >= x0 && mid <= x1);
      u0 = u1 = keepLeft ? 0 : n - 1;
    }
    const last = out.at(-1);
    const row = [a, b, n, r[3], u0, u1];
    if (last && Math.abs(last[1] - a) < 0.5 && last.slice(2).every((v, j) => v === row[2 + j])) last[1] = b;
    else out.push(row);
  }
  cache.set(extras, { left, out });
  return out;
}

/** Wert an der Stelle d, weich zwischen den Abschnitten übergeblendet. */
function eased(sections, d, value) {
  let i = sections.findIndex(([a, b]) => d >= a && d < b);
  if (i < 0) i = d < sections[0][0] ? 0 : sections.length - 1;
  let v = value(sections[i]);
  const [a, b] = sections[i];
  // Übergang je zur Hälfte vor und nach der Grenze – nur zu direkt anschließenden
  if (i > 0 && d - a < EASE / 2 && sections[i - 1][1] >= a - 1) v = lerpNum(value(sections[i - 1]), v, smooth(0.5 + (d - a) / EASE));
  if (i + 1 < sections.length && b - d < EASE / 2 && sections[i + 1][0] <= b + 1) v = lerpNum(v, value(sections[i + 1]), smooth(0.5 - (b - d) / EASE));
  return v;
}

/** Form der Fahrbahn an der Stelle d – oder null ohne Daten. */
function layoutAt(sections, d) {
  if (!sections.length || d < sections[0][0] - 1 || d > sections[sections.length - 1][1] + 1) return null;
  const w = LANE_WIDTH;
  const n = eased(sections, d, (r) => r[2]);
  const opp = eased(sections, d, (r) => r[3]);
  // Einbahn: mittig; mit Gegenverkehr: Linie in der Mitte, wir rechts davon.
  // Weich zwischen beidem: der Anteil „Gegenverkehr“ verschiebt die Mitte.
  const two = Math.min(1, opp);
  const l0 = lerpNum(-n * w / 2, -opp * w, two);
  const r0 = lerpNum(n * w / 2, n * w, two);
  const first = lerpNum(-n * w / 2, 0, two);          // linker Rand unserer Spuren
  // Markierte Spuren: von der Mitte der ersten bis zur Mitte der letzten
  const u0 = eased(sections, d, (r) => r[4]);
  const u1 = eased(sections, d, (r) => r[5]);
  const track = first + ((u0 + u1) / 2 + 0.5) * w;
  const trackW = (u1 - u0) * w + w * 0.6;
  return { n, opp, l0, r0, first, track, trackW };
}

/** Wie weit rechts der Linie fahren wir? (Meter, negativ = links) */
export function laneShiftAt(extras, at, left = []) {
  return layoutAt(sectionsFor(extras, left), at)?.track ?? 0;
}
