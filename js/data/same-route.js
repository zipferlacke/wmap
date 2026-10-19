/**
 * Gleiche Strecke: Welche anderen Aufzeichnungen liefen (fast) denselben Weg? – für den Vorschlag „gleiche
 * Strecke vergleichen“ im Weg (pages/wege.js).
 *
 *   sameRoutes(t, all)  → die anderen Wege derselben Strecke, das neueste zuerst
 *
 * Gleich heißt: dieselbe Fortbewegung (zu Fuß, Rad … – PROFILE_GROUP), Länge höchstens 15 % (mind. 300 m)
 * anders, Start bei Start und Ziel bei Ziel (je höchstens 200 m – dieselbe Richtung, sonst passen die Kilometer
 * im Diagramm nicht zueinander), und der Verlauf deckt sich: 40 Stellen auf dem einen liegen zu 90 % höchstens
 * 60 m neben dem anderen – in beide Richtungen geprüft, ein Umweg auf nur einem der beiden zählt also.
 * Karteikarten (Weg nur im Ordner) reichen: ihr grober Verlauf genügt dafür.
 */
import { trackCoords, PROFILE_GROUP } from './tracks.js';
import { cumulative, distance, nearestOnLine, pointAt } from '../core/geo.js';

const ENDS = 200;
const NEAR = 60;
const SAMPLES = 40;

const group = (t) => PROFILE_GROUP[t.profile] ?? 'foot';
const lines = new Map();               // id|updated → { coords, cum }
function line(t) {
  const key = `${t.id}|${t.updated ?? ''}|${t.shape?.length ?? 0}`;
  if (!lines.has(key)) { const coords = trackCoords(t); lines.set(key, { coords, cum: cumulative(coords) }); }
  return lines.get(key);
}

/** Liegen die Stellen von `a` zu 90 % höchstens 60 m neben `b`? */
function covers(a, b) {
  const total = a.cum.at(-1);
  let near = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const p = pointAt(a.coords, a.cum, (total * (i + 0.5)) / SAMPLES);
    if (nearestOnLine(b.coords, b.cum, p).offset <= NEAR) near += 1;
  }
  return near >= SAMPLES * 0.9;
}

function overlaps(A, B) {
  return !A || !B || (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]);
}

export function sameRoutes(t, all) {
  const a = line(t);
  if (a.coords.length < 2 || !(t.length > 300)) return [];
  const start = a.coords[0], end = a.coords.at(-1);
  return all.filter((o) => {
    if (o.id === t.id || group(o) !== group(t) || !(o.length > 0)) return false;
    if (Math.abs(o.length - t.length) > Math.max(300, Math.max(o.length, t.length) * 0.15)) return false;
    if (!overlaps(t.bbox, o.bbox)) return false;
    const b = line(o);
    if (b.coords.length < 2) return false;
    if (distance(start, b.coords[0]) > ENDS || distance(end, b.coords.at(-1)) > ENDS) return false;
    return covers(a, b) && covers(b, a);
  }).sort((x, y) => y.start - x.start);
}
