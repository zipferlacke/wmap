/**
 * Was die Navigation über die Route hinaus wissen will – einmal beim Start
 * geholt, exakt für die gewählte Linie (Valhalla, shape_match „edge_walk“):
 *
 *   limits   Tempolimits      [[von m, bis m, km/h], …]
 *   signals  Ampeln           [m, …]
 *   lanes    Fahrspuren       [{ at: m, lanes: [{ dirs: ['left'], use: bool }] }]
 *   dests    Wegweiser        [{ at: m, text: 'Kassel, Hann. Münden' }]
 *   twoWay   Gegenverkehr     [[von m, bis m], …] – dort liegen unsere Spuren
 *            rechts der Mittellinie, sonst (Einbahn) mittig
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
  const out = { limits: [], signals: [], lanes: [], dests: [], twoWay: [] };
  const costing = PROFILES[profile]?.costing ?? 'auto';
  for (let i = 0; i < route.coords.length - 1; i += CHUNK) {
    const part = route.coords.slice(i, i + CHUNK + 1);
    const offset = route.cum[i];
    const base = { encoded_polyline: encodePolyline(part), costing, costing_options: costingOptions(profile), shape_match: 'edge_walk' };
    const [attrs, match] = await Promise.all([
      request({
        ...base,
        filters: { attributes: ['edge.speed_limit', 'edge.traffic_signal', 'edge.length', 'edge.traversability'], action: 'include' },
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
            lanes: x.lanes.map((l) => ({ dirs: l.indications ?? [], use: !!l.valid })),
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
 * Die Spuren vor einer Kreuzung als Kartenobjekte: Fahrbahn, Trennlinien,
 * die zu nutzende(n) Spur(en) und je Spur ein Pfeil kurz vor der Haltelinie.
 * Die Breiten und Versätze stehen in Metern (m, off) – die Karte rechnet sie
 * je Zoom in Pixel um.
 *
 * @param at     Meter entlang der Route, an denen die Kreuzung liegt
 * @param lanes  [{ dirs, use }] von links nach rechts
 */
export function laneFeatures(route, at, lanes, { twoWay = false, length = 140 } = {}) {
  const n = lanes.length;
  const w = LANE_WIDTH;
  const from = Math.max(0, at - length);
  const to = Math.max(from + 5, at - 3);
  // Stück der Route vor der Kreuzung
  const line = [];
  for (let d = from; d <= to; d += 5) line.push(pointAt(route.coords, route.cum, d));
  line.push(pointAt(route.coords, route.cum, to));
  // Mitte von Spur i (0 = ganz links), positiv = rechts der Linie
  const center = (i) => (twoWay ? (i + 0.5) * w : (i - (n - 1) / 2) * w);
  const left = center(0) - w / 2;
  const right = center(n - 1) + w / 2;
  const lat = line[0][1];
  // Pixel je Meter bei Zoom 0 (512er-Kacheln)
  const k = 512 / (40075016.686 * Math.cos((lat * Math.PI) / 180));
  const f = (kind, off, m, extra = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { kind, off, m, k, ...extra } });

  const feats = [f('road', (left + right) / 2, right - left + 0.8)];
  feats.push(f('edge', left, 0.2), f('edge', right, 0.2));
  for (let i = 1; i < n; i += 1) feats.push(f('sep', center(i) - w / 2, 0.16));
  lanes.forEach((l, i) => { if (l.use) feats.push(f('use', center(i), w * 0.62)); });

  // Pfeile 12 m vor der Haltelinie, quer zur Fahrtrichtung versetzt
  const a = pointAt(route.coords, route.cum, Math.max(from, to - 14));
  const b = pointAt(route.coords, route.cum, Math.max(from, to - 8));
  const dir = bearing(a, b);
  lanes.forEach((l, i) => {
    const glyph = LANE_GLYPH[l.dirs.find((d) => LANE_GLYPH[d]) ?? 'straight'] ?? 'straight';
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: destination(b, dir + 90, center(i)) },
      properties: { kind: 'arrow', icon: `lane-${l.use ? 'on' : 'off'}-${glyph}`, rot: dir, k },
    });
  });
  return feats;
}
