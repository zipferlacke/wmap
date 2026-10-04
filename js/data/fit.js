/**
 * FIT-Dateien lesen (Garmin, Zepp/Amazfit, Wahoo …) – das Format, in dem Uhren ihre Trainings ablegen. Anders
 * als GPX trägt es zuverlässig die Frequenz: Zepp schreibt z. B. die Schlagfrequenz beim Rudern nur hier hinein.
 *
 * Gelesen wird nur, was ein Weg braucht: aus den „record“-Meldungen Ort, Zeit, Puls, Frequenz, Leistung, aus
 * „session“ die Sportart, aus „lap“ die Runden der Uhr. Aufbau der Datei: Kopf, dann Meldungen – eine Definition sagt je Meldungsart, welche
 * Felder in welcher Größe folgen, danach kommen die Daten in genau dieser Form.
 *
 *   parseFit(buffer, name)  → [Weg] wie parseGpx (leer, wenn die Datei keine Strecke hat)
 *   trackFit(weg)           → Uint8Array: der Weg als FIT-Datei (Punkte mit Puls, Frequenz, Leistung, Runden der
 *                             Uhr, Sportart, Zusammenfassung) – für Garmin Connect, Strava, Zepp & Co.
 */
import { buildTrack, trackCoords } from './tracks.js';
import { distance } from '../core/geo.js';

const FIT_EPOCH = 631065600;            // Sekunden zwischen 1970 und dem 31.12.1989
const DEG = 180 / 2 ** 31;              // „Semicircles“ → Grad
// Basistyp (untere 5 Bit) → [Größe, Leser, „kein Wert“]
const TYPES = {
  0: [1, 'getUint8', 0xff], 1: [1, 'getInt8', 0x7f], 2: [1, 'getUint8', 0xff], 3: [2, 'getInt16', 0x7fff], 4: [2, 'getUint16', 0xffff],
  5: [4, 'getInt32', 0x7fffffff], 6: [4, 'getUint32', 0xffffffff], 10: [1, 'getUint8', 0], 11: [2, 'getUint16', 0], 12: [4, 'getUint32', 0], 13: [1, 'getUint8', 0xff],
};
const RECORD = 20, SESSION = 18, LAP = 19;
// Sportart der FIT-Datei → Art in WMap (track-look.js) und Profil
const SPORTS = {
  1: ['running', 'foot'], 2: ['biking', 'bike'], 5: ['swimming_open_water', 'foot'], 11: ['walking', 'foot'], 12: ['skiing', 'foot'], 13: ['skiing', 'foot'],
  14: ['snowboarding', 'foot'], 15: ['rowing', 'foot'], 17: ['hiking', 'foot'], 19: ['paddling', 'foot'], 23: ['rowing', 'foot'], 32: ['sailing', 'foot'],
  37: ['paddling', 'foot'], 41: ['paddling', 'foot'],
};

/** Alle Meldungen der Arten in `want` → { Art: [{ Feldnummer: Wert }] } */
function messages(buffer, want) {
  const v = new DataView(buffer);
  if (v.byteLength < 14 || String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11)) !== '.FIT') throw new Error('Keine FIT-Datei');
  const head = v.getUint8(0), end = Math.min(v.byteLength, head + v.getUint32(4, true));
  const defs = {}, out = Object.fromEntries(want.map((g) => [g, []]));
  let i = head;
  while (i < end) {
    const h = v.getUint8(i); i += 1;
    let local;
    if (h & 0x80) local = (h >> 5) & 3;                    // Daten mit verkürzter Zeit
    else if (h & 0x40) {                                   // Definition
      local = h & 0x0f;
      const little = v.getUint8(i + 1) === 0, n = v.getUint8(i + 4);
      const fields = [];
      for (let k = 0; k < n; k += 1) fields.push([v.getUint8(i + 5 + 3 * k), v.getUint8(i + 6 + 3 * k), v.getUint8(i + 7 + 3 * k) & 0x1f]);
      const global = v.getUint16(i + 2, little);
      i += 5 + 3 * n;
      let dev = 0;
      if (h & 0x20) { const nd = v.getUint8(i); for (let k = 0; k < nd; k += 1) dev += v.getUint8(i + 2 + 3 * k); i += 1 + 3 * nd; }
      defs[local] = { global, little, fields, dev };
      continue;
    } else local = h & 0x0f;
    const d = defs[local];
    if (!d) throw new Error('FIT-Datei beschädigt');
    const rec = out[d.global] ? {} : null;
    for (const [num, size, type] of d.fields) {
      const t = TYPES[type];
      if (rec && t && t[0] === size) { const x = v[t[1]](i, d.little); if (x !== t[2]) rec[num] = x; }
      i += size;
    }
    i += d.dev;
    if (rec) out[d.global].push(rec);
  }
  return out;
}

export function parseFit(buffer, fileName = '') {
  const m = messages(buffer, [RECORD, SESSION, LAP]);
  // Feld 253 Zeit, 0 Breite, 1 Länge, 3 Puls, 4 Frequenz, 7 Leistung
  const points = m[RECORD].filter((r) => r[0] !== undefined && r[1] !== undefined && r[253] !== undefined)
    .map((r) => [r[1] * DEG, r[0] * DEG, (r[253] + FIT_EPOCH) * 1000, r[3] ?? 0, r[4] ?? 0, r[7] ?? 0]);
  const [sport, profile] = SPORTS[m[SESSION][0]?.[5]] ?? [null, null];
  const name = fileName.replace(/\.fit$/i, '') || 'Importierter Weg';
  let t = buildTrack(points, { kind: 'gpx', profile: profile ?? 'foot', name });
  if (!t) return [];
  if (sport) t = { ...t, sport };
  // Runden der Uhr (von Hand gedrückt oder von ihr selbst gesetzt): Feld 253 ist das Ende der Runde. Die letzte
  // endet mit dem Training – sie ist keine Marke
  const marks = m[LAP].map((l) => (l[253] === undefined ? null : Math.round(l[253] + FIT_EPOCH - t.start / 1000)))
    .filter((sec) => sec > 0 && sec < (t.end - t.start) / 1000 - 5).sort((a, b) => a - b);
  if (marks.length) t = { ...t, marks };
  return [t];
}

/* ── Schreiben ────────────────────────────────────────────────────────────── */

const SPORT_OUT = { running: 1, biking: 2, swimming_open_water: 5, swimming_pool: 5, walking: 11, skiing: 13, snowboarding: 14, rowing: 15, hiking: 17, paddling: 19, sailing: 32 };
const CRC = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
function crc16(bytes, from, to) {
  let crc = 0;
  for (let i = from; i < to; i += 1) {
    const b = bytes[i];
    let tmp = CRC[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC[b & 0xf];
    tmp = CRC[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC[(b >> 4) & 0xf];
  }
  return crc;
}
// Feld: [Nummer, Größe, Basistyp] – 0x00 enum, 0x02 uint8, 0x84 uint16, 0x85 sint32, 0x86 uint32
const U8 = 0x02, ENUM = 0x00, U16 = 0x84, S32 = 0x85, U32 = 0x86;
const SIZE = { [U8]: 1, [ENUM]: 1, [U16]: 2, [S32]: 4, [U32]: 4 };
const NONE = { [U8]: 0xff, [ENUM]: 0xff, [U16]: 0xffff, [S32]: 0x7fffffff, [U32]: 0xffffffff };

export function trackFit(t) {
  const out = [];
  const put = (v, type) => { for (let k = 0; k < SIZE[type]; k += 1) out.push((v >>> (8 * k)) & 0xff); };
  const defined = new Map();
  /** Eine Meldung schreiben; die Definition dazu beim ersten Mal. `fields`: [[Nummer, Typ, Wert | null]] */
  const message = (global, fields) => {
    if (!defined.has(global)) {
      defined.set(global, defined.size);
      out.push(0x40 | defined.get(global), 0, 0, global & 0xff, global >> 8, fields.length);
      for (const [num, type] of fields) out.push(num, SIZE[type], type);
    }
    out.push(defined.get(global));
    for (const [, type, v] of fields) put(v === null || v === undefined || Number.isNaN(v) ? NONE[type] : Math.round(v), type);
  };
  const coords = trackCoords(t), times = t.times ?? [];
  const fit = (ms) => ms / 1000 - FIT_EPOCH;
  const semi = (deg) => deg / DEG;
  const start = fit(t.start), end = fit(t.end ?? t.start + (times.at(-1) ?? 0) * 1000);
  const stat = (k) => { const v = (t[k] ?? []).filter((x) => x > 0); return v.length ? [v.reduce((a, b) => a + b, 0) / v.length, Math.max(...v)] : [null, null]; };
  const sport = SPORT_OUT[t.sport] ?? (t.profile === 'bike' || ['road', 'tour', 'gravel', 'mtb'].includes(t.profile) ? 2 : 0);

  message(0, [[0, ENUM, 4], [1, U16, 255], [2, U16, 0], [4, U32, start]]);             // file_id: Aktivität
  message(21, [[253, U32, start], [0, ENUM, 0], [1, ENUM, 0]]);                         // event: Start
  let dist = 0;
  const cum = coords.map((c, i) => (i ? (dist += distance(coords[i - 1], c)) : 0));
  // Die gemessene Länge gilt (aus allen Punkten der Aufzeichnung) – die Punkte hier sind ausgedünnt
  const scale = dist > 0 && t.length ? t.length / dist : 1;
  coords.forEach(([lon, lat], i) => message(20, [[253, U32, start + (times[i] ?? 0)], [0, S32, semi(lat)], [1, S32, semi(lon)], [5, U32, cum[i] * scale * 100],
    [3, U8, t.hr?.[i] > 0 ? t.hr[i] : null], [4, U8, t.cad?.[i] > 0 ? Math.min(254, t.cad[i]) : null], [7, U16, t.pow?.[i] > 0 ? t.pow[i] : null]]));
  message(21, [[253, U32, end], [0, ENUM, 0], [1, ENUM, 4]]);                           // event: Stopp
  // Runden: die der Uhr – sonst eine über alles
  const total = Math.max(1, Math.round(end - start));
  const edges = [0, ...(t.marks ?? []).filter((x) => x > 0 && x < total), total];
  const at = (sec) => { let i = 1; while (i < times.length - 1 && times[i] < sec) i += 1; const a = times[i - 1] ?? 0, b = times[i] ?? a; return (cum[i - 1] ?? 0) + (b > a ? Math.min(1, Math.max(0, (sec - a) / (b - a))) : 0) * ((cum[i] ?? 0) - (cum[i - 1] ?? 0)); };
  for (let n = 1; n < edges.length; n += 1) {
    const [a, b] = [edges[n - 1], edges[n]];
    message(19, [[254, U16, n - 1], [253, U32, start + b], [2, U32, start + a], [7, U32, (b - a) * 1000], [8, U32, (b - a) * 1000],
      [9, U32, (at(b) - at(a)) * scale * 100], [0, ENUM, 9], [1, ENUM, 1], [25, ENUM, sport]]);
  }
  const [hrAvg, hrMax] = stat('hr'), [cadAvg, cadMax] = stat('cad');
  message(18, [[254, U16, 0], [253, U32, end], [2, U32, start], [7, U32, total * 1000], [8, U32, (t.moving || total) * 1000], [9, U32, (t.length ?? dist) * 100],
    [5, ENUM, sport], [6, ENUM, 0], [16, U8, hrAvg], [17, U8, hrMax], [18, U8, cadAvg], [19, U8, cadMax], [25, U16, 0], [26, U16, edges.length - 1], [0, ENUM, 8], [1, ENUM, 1]]);
  message(34, [[253, U32, end], [0, U32, total * 1000], [1, U16, 1], [2, ENUM, 0], [3, ENUM, 26], [4, ENUM, 1]]);   // activity

  const head = [14, 0x20, 0x54, 0x08, out.length & 0xff, (out.length >> 8) & 0xff, (out.length >> 16) & 0xff, (out.length >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54];
  const hc = crc16(head, 0, 12);
  const bytes = new Uint8Array(14 + out.length + 2);
  bytes.set([...head, hc & 0xff, hc >> 8], 0);
  bytes.set(out, 14);
  const fc = crc16(bytes, 0, 14 + out.length);
  bytes[14 + out.length] = fc & 0xff; bytes[15 + out.length] = fc >> 8;
  return bytes;
}
