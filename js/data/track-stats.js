/**
 * Auswertung eines Wegs für Diagramme und Runden (pages/wege.js).
 *
 *   metrics(t)            Messreihen über die Strecke: Tempo (aus GPS), Puls,
 *                         Frequenz, Leistung – je [[km, wert], …], nur was es gibt
 *   laps(t, size, ele?)   Runden zu je `size` Metern: Zeit, Tempo, Ø Puls,
 *                         Anstieg (mit Höhenprofil) – dazu die schnellste und
 *                         die langsamste volle Runde
 *   lapLine(t, lap)       Verlauf einer Runde für die Karte
 */
import { cumulative, pointAt } from '../core/geo.js';
import { trackCoords } from './tracks.js';

/** Tempo glätten: über ±15 s – einzelne GPS-Sprünge sind kein Tempo */
const WINDOW = 15;

/** Strecke (m) und Zeit (s) je Punkt – null ohne Zeiten */
function base(t) {
  const coords = trackCoords(t);
  const times = t.times;
  if (!times || times.length !== coords.length || coords.length < 2) return null;
  return { coords, cum: cumulative(coords), times };
}

/** Tempo in km/h je Punkt, geglättet */
function speeds({ cum, times }) {
  const n = times.length;
  return Array.from(times, (ts, i) => {
    let j = i, k = i;
    while (j > 0 && ts - times[j - 1] <= WINDOW) j -= 1;
    while (k < n - 1 && times[k + 1] - ts <= WINDOW) k += 1;
    if (k === j) { j = Math.max(0, i - 1); k = Math.min(n - 1, i + 1); }
    const dt = times[k] - times[j];
    return dt > 0 ? ((cum[k] - cum[j]) / dt) * 3.6 : null;
  });
}

const series = (cum, values) => (values?.some((v) => v > 0)
  // cum ist ein Float64Array – dessen map kann keine Paare aufnehmen
  ? Array.from(cum, (m, i) => [m / 1000, values[i] > 0 ? values[i] : null]).filter(([, v]) => v !== null) : null);

/** { speed, hr, cad, pow } – je [[km, wert], …] oder null */
export function metrics(t) {
  const b = base(t);
  if (!b) return {};
  const v = speeds(b);
  return {
    speed: series(b.cum, v.map((x) => (x !== null && x < 250 ? Math.round(x * 10) / 10 : null))),
    hr: series(b.cum, t.hr),
    cad: series(b.cum, t.cad),
    pow: series(b.cum, t.pow),
  };
}

/** Zeit (s ab Start) an der Stelle `m` – linear zwischen den Punkten */
function timeAt({ cum, times }, m) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < m) i += 1;
  const a = cum[i - 1], b = cum[i];
  const f = b > a ? Math.min(1, Math.max(0, (m - a) / (b - a))) : 0;
  return times[i - 1] + f * (times[i] - times[i - 1]);
}

/** Anstieg zwischen zwei Stellen aus dem Höhenprofil [[km, m], …] (Streckenlänge darin: `eleLen` m) */
function ascentBetween(ele, from, to, scale) {
  let up = 0, last = null;
  for (const [km, h] of ele) {
    const m = km * 1000 / scale;
    if (m < from || m > to) continue;
    if (last !== null && h > last) up += h - last;
    last = h;
  }
  return Math.round(up);
}

/**
 * Runden zu je `size` Metern. Die letzte ist meist kürzer – sie zählt für
 * schnellste/langsamste nur, wenn sie mindestens halb so lang ist.
 * @param ele  Höhenprofil { elevation: [[km, m]], length (m) } oder null
 * → { list: [{ n, from, to, dist, time, speed (m/s), hr, up }], fastest, slowest }
 */
export function laps(t, size, ele = null) {
  const b = base(t);
  if (!b) return null;
  const total = b.cum.at(-1);
  if (total < size * 0.5) return null;
  const scale = ele?.length ? ele.length / total : 1;
  const list = [];
  for (let from = 0, n = 1; from < total - 1; from += size, n += 1) {
    const to = Math.min(total, from + size);
    const time = timeAt(b, to) - timeAt(b, from);
    const hrs = t.hr ? t.hr.filter((v, i) => v > 0 && b.cum[i] >= from && b.cum[i] <= to) : [];
    list.push({
      n, from, to, dist: to - from, time,
      speed: time > 0 ? (to - from) / time : null,
      hr: hrs.length ? Math.round(hrs.reduce((x, y) => x + y) / hrs.length) : null,
      up: ele?.elevation?.length ? ascentBetween(ele.elevation, from, to, scale) : null,
    });
  }
  const full = list.filter((l) => l.dist >= size * 0.5 && l.speed);
  const by = (cmp) => (full.length > 1 ? full.reduce((a, x) => (cmp(x.speed, a.speed) ? x : a)).n : null);
  return { list, fastest: by((x, a) => x > a), slowest: by((x, a) => x < a) };
}

/** Koordinaten einer Runde – für die Hervorhebung auf der Karte */
export function lapLine(t, lap) {
  const b = base(t);
  if (!b) return [];
  const inner = b.coords.filter((_, i) => b.cum[i] > lap.from && b.cum[i] < lap.to);
  return [pointAt(b.coords, b.cum, lap.from), ...inner, pointAt(b.coords, b.cum, lap.to)];
}
