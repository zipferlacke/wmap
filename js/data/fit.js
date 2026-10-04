/**
 * FIT-Dateien lesen (Garmin, Zepp/Amazfit, Wahoo …) – das Format, in dem Uhren ihre Trainings ablegen. Anders
 * als GPX trägt es zuverlässig die Frequenz: Zepp schreibt z. B. die Schlagfrequenz beim Rudern nur hier hinein.
 *
 * Gelesen wird nur, was ein Weg braucht: aus den „record“-Meldungen Ort, Zeit, Puls, Frequenz, Leistung, aus
 * „session“ die Sportart. Aufbau der Datei: Kopf, dann Meldungen – eine Definition sagt je Meldungsart, welche
 * Felder in welcher Größe folgen, danach kommen die Daten in genau dieser Form.
 *
 *   parseFit(buffer, name)  → [Weg] wie parseGpx (leer, wenn die Datei keine Strecke hat)
 */
import { buildTrack } from './tracks.js';

const FIT_EPOCH = 631065600;            // Sekunden zwischen 1970 und dem 31.12.1989
const DEG = 180 / 2 ** 31;              // „Semicircles“ → Grad
// Basistyp (untere 5 Bit) → [Größe, Leser, „kein Wert“]
const TYPES = {
  0: [1, 'getUint8', 0xff], 1: [1, 'getInt8', 0x7f], 2: [1, 'getUint8', 0xff], 3: [2, 'getInt16', 0x7fff], 4: [2, 'getUint16', 0xffff],
  5: [4, 'getInt32', 0x7fffffff], 6: [4, 'getUint32', 0xffffffff], 10: [1, 'getUint8', 0], 11: [2, 'getUint16', 0], 12: [4, 'getUint32', 0], 13: [1, 'getUint8', 0xff],
};
const RECORD = 20, SESSION = 18;
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
  const m = messages(buffer, [RECORD, SESSION]);
  // Feld 253 Zeit, 0 Breite, 1 Länge, 3 Puls, 4 Frequenz, 7 Leistung
  const points = m[RECORD].filter((r) => r[0] !== undefined && r[1] !== undefined && r[253] !== undefined)
    .map((r) => [r[1] * DEG, r[0] * DEG, (r[253] + FIT_EPOCH) * 1000, r[3] ?? 0, r[4] ?? 0, r[7] ?? 0]);
  const [sport, profile] = SPORTS[m[SESSION][0]?.[5]] ?? [null, null];
  const name = fileName.replace(/\.fit$/i, '') || 'Importierter Weg';
  let t = buildTrack(points, { kind: 'gpx', profile: profile ?? 'foot', name });
  if (!t) return [];
  if (sport) t = { ...t, sport };
  return [t];
}
