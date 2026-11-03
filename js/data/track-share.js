/**
 * Aufgezeichnete Tour teilen – die Aufzeichnung selbst, nicht nur ihr Verlauf:
 * Strecke, Zeiten (also Tempo) und, wenn gewählt, Puls, Frequenz und Leistung.
 * Ohne Server: alles steckt gepackt im Link (wege.html#weg=…), wer ihn öffnet,
 * sieht die Tour mit Diagrammen und kann sie bei sich speichern.
 *
 *   encodeTrack(t, keep)   Weg → Code für den Link; `keep`: welche Messwerte
 *                          mitgehen ({ hr, cad, pow }, ohne Angabe alle)
 *   decodeTrack(code)      Code → Weg (ohne ID – vergeben wird sie beim Speichern)
 *   without(t, keep)       Weg ohne die abgewählten Messwerte (für die GPX-Datei)
 *
 * Lange Wege gehen ausgedünnt in den Link (höchstens 500 Punkte) – Strecke,
 * Zeit in Bewegung und Spitze stehen daneben und bleiben genau.
 */
import { packJson, unpackJson } from './store.js';
import { trackCoords } from './tracks.js';
import { encodePolyline, decodePolyline, bbox } from '../core/geo.js';
import { sportOf } from './track-look.js';
import { t } from '../core/i18n.js';

const MAX_POINTS = 500;
const VALUES = ['hr', 'cad', 'pow'];
const has = (t, k) => Array.isArray(t[k]) && t[k].some((v) => v > 0);
/** Zahlenreihe als Unterschiede zum Vorgänger – packt sich viel kleiner */
const delta = (a) => a.map((v, i) => (v ?? 0) - (i ? a[i - 1] ?? 0 : 0));
const undelta = (a) => { let s = 0; return a.map((d) => (s += d)); };

export function without(t, keep = {}) {
  const out = { ...t };
  for (const k of VALUES) if (keep[k] === false) delete out[k];
  return out;
}

export function encodeTrack(track, keep = {}) {
  const coords = trackCoords(track);
  const step = Math.max(1, Math.ceil(coords.length / MAX_POINTS));
  const pick = (a) => a.filter((_, i) => i % step === 0 || i === a.length - 1);
  const o = {
    v: 1, n: track.name || t('tracks.names.tour'), p: track.profile, k: sportOf(track) ?? undefined, c: track.color || undefined,
    a: track.start, e: track.end, l: track.length, m: track.moving, x: track.top,
    s: encodePolyline(pick(coords), 5), t: delta(pick(track.times ?? [])),
    // Runden der Uhr (Sekunden ab Start)
    r: track.marks?.length ? track.marks : undefined,
  };
  for (const k of VALUES) if (keep[k] !== false && has(track, k)) o[k] = delta(pick(track[k]));
  return packJson(o);
}

export async function decodeTrack(code) {
  const o = await unpackJson(code);
  const coords = decodePolyline(String(o.s ?? ''), 5);
  if (o.v !== 1 || coords.length < 2 || !Number.isFinite(o.a)) throw new Error(t('share.tour.error.no_tour'));
  const times = undelta(o.t ?? []);
  const track = {
    kind: 'gpx', profile: String(o.p ?? 'foot'), name: String(o.n ?? t('share.tour.default_name')).slice(0, 80),
    start: o.a, end: Number.isFinite(o.e) ? o.e : o.a + (times.at(-1) ?? 0) * 1000,
    length: Math.round(o.l ?? 0), moving: Math.round(o.m ?? 0), top: Number(o.x) || 0,
    shape: encodePolyline(coords, 5), times: times.length === coords.length ? times : coords.map(() => 0),
    bbox: bbox(coords).map((v) => +v.toFixed(5)),
    ...(o.k ? { sport: String(o.k) } : {}), ...(/^#[0-9a-f]{6}$/i.test(o.c ?? '') ? { color: o.c } : {}),
    ...(Array.isArray(o.r) && o.r.every((x) => Number.isFinite(x) && x > 0) && o.r.length ? { marks: o.r.slice(0, 500) } : {}),
  };
  for (const k of VALUES) {
    if (!Array.isArray(o[k]) || o[k].length !== coords.length) continue;
    track[k] = undelta(o[k]).map((v) => (v > 0 ? v : null));
  }
  return track;
}
