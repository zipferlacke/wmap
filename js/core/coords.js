/**
 * Koordinaten lesen und schreiben – ohne Netz, alles WGS84, Punkte als [lon, lat].
 *
 *   fmtLatLon(p)   „51.53190, 9.93550“ (Breite zuerst, wie Google und OSM)
 *   fmtMgrs(p)     „32U NC 64398 10079“ – MGRS / UTMREF, das Gitter von NATO und Bundeswehr,
 *                  auch bei Feuerwehr, THW und Bergwacht (auf 1 m genau)
 *   parseCoords(t) → { point, kind, ref? } | null – nimmt
 *     51.5319, 9.9355 · 51,5319 9,9355 · N 51.5319 E 9.9355 · 51°31'55"N 9°56'08"E
 *     N 51° 31.914 E 009° 56.130 · 32U NC 64398 10079 · 32UNC6439810079 · 32U 564398 5710079
 *     9F4GGXJP+QH (Plus Code) · GXJP+QH (kurzer Plus Code: ref → in der Nähe von wo?)
 */

/* ── UTM (Snyder, „Map Projections – A Working Manual“, S. 61 ff.) ─────────── */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const RAD = Math.PI / 180;
const M1 = 1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256;
const M2 = 3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024;
const M3 = 15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024;
const M4 = 35 * E2 ** 3 / 3072;

const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

/** Zone mit den Ausnahmen um Norwegen und Spitzbergen */
function zoneOf(lon, lat) {
  let z = Math.floor((lon + 180) / 6) + 1;
  if (z > 60) z = 60;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) z = 31;
    else if (lon >= 9 && lon < 21) z = 33;
    else if (lon >= 21 && lon < 33) z = 35;
    else if (lon >= 33 && lon < 42) z = 37;
  }
  return z;
}

const meridian = (phi) => A * (M1 * phi - M2 * Math.sin(2 * phi) + M3 * Math.sin(4 * phi) - M4 * Math.sin(6 * phi));

/** [lon, lat] → { zone, band, easting, northing } (Nordwert im Süden mit 10 000 km Aufschlag) */
export function toUtm([lon, lat], zone = zoneOf(lon, lat)) {
  const phi = lat * RAD;
  const lam = (lon - (zone * 6 - 183)) * RAD;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan, C = EP2 * cos * cos, a = cos * lam;
  const easting = K0 * N * (a + (1 - T + C) * a ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5 / 120) + 500000;
  let northing = K0 * (meridian(phi) + N * tan * (a * a / 2 + (5 - T + 9 * C + 4 * C * C) * a ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return { zone, band: BANDS[Math.floor((lat + 80) / 8)], easting, northing };
}

/** UTM → [lon, lat]; `south`: Südhalbkugel (Nordwert mit Aufschlag) */
export function fromUtm(zone, easting, northing, south) {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = (south ? northing - 10000000 : northing) / K0 / (A * M1);
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sin = Math.sin(p1), cos = Math.cos(p1), tan = Math.tan(p1);
  const N1 = A / Math.sqrt(1 - E2 * sin * sin);
  const R1 = A * (1 - E2) / (1 - E2 * sin * sin) ** 1.5;
  const T1 = tan * tan, C1 = EP2 * cos * cos;
  const D = (easting - 500000) / (N1 * K0);
  const lat = p1 - (N1 * tan / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / cos;
  return [zone * 6 - 183 + lon / RAD, lat / RAD];
}

/* ── MGRS: Zone, Band, 100-km-Quadrat aus zwei Buchstaben, Ost- und Nordwert darin ── */

const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/** [lon, lat] → „32U NC 64398 10079“; außerhalb von 80° S … 84° N (Polargebiete, UPS) '' */
export function fmtMgrs(p, digits = 5) {
  if (!(p?.[1] >= -80 && p[1] < 84)) return '';
  const { zone, band, easting, northing } = toUtm(p);
  const col = COLS[(zone - 1) % 3][Math.floor(easting / 100000) - 1];
  const row = ROWS[(Math.floor(northing / 100000) + (zone % 2 ? 0 : 5)) % 20];
  if (!col) return '';
  const cut = (v) => String(Math.floor(v % 100000)).padStart(5, '0').slice(0, digits);
  return `${zone}${band} ${col}${row} ${cut(easting)} ${cut(northing)}`;
}

function fromMgrs(zone, band, col, row, e, n) {
  const ci = COLS[(zone - 1) % 3].indexOf(col);
  let ri = ROWS.indexOf(row);
  if (zone < 1 || zone > 60 || ci < 0 || ri < 0) return null;
  ri = (ri - (zone % 2 ? 0 : 5) + 20) % 20;
  // Halbe Gitterweite dazu: „NC 64 10“ meint das 1-km-Quadrat, also seine Mitte
  const cell = 10 ** (5 - e.length);
  const easting = (ci + 1) * 100000 + Number(e) * cell + cell / 2;
  let northing = ri * 100000 + Number(n) * cell + cell / 2;
  // Die Zeilenbuchstaben wiederholen sich alle 2000 km – das Band sagt, welche Runde gemeint ist
  const bi = BANDS.indexOf(band);
  const south = bi < 10;
  const bandSouth = -80 + bi * 8;
  const min = toUtm([zone * 6 - 183, bandSouth], zone).northing - 100000;
  while (northing < min) northing += 2000000;
  return fromUtm(zone, easting, northing, south);
}

/* ── Plus Codes (Open Location Code von Google, frei) ─────────────────────── */

const OLC = '23456789CFGHJMPQRVWX';
const PAIR = [20, 1, 0.05, 0.0025, 0.000125];

function olcDecode(code) {
  const c = code.replace('+', '').replace(/0+$/, '').toUpperCase();
  let lat = -90, lon = -180, rLat = 20, rLon = 20;
  for (let i = 0; i < Math.min(c.length, 10); i += 2) {
    rLat = rLon = PAIR[i / 2];
    lat += OLC.indexOf(c[i]) * rLat;
    lon += OLC.indexOf(c[i + 1] ?? '2') * rLon;
  }
  for (let i = 10; i < c.length; i++) {
    rLat /= 5; rLon /= 4;
    const d = OLC.indexOf(c[i]);
    lat += Math.floor(d / 4) * rLat;
    lon += (d % 4) * rLon;
  }
  return [lon + rLon / 2, lat + rLat / 2];
}

function olcPrefix([lon, lat], length) {
  let la = Math.min(Math.max(lat, -90), 89.9999999) + 90, lo = ((lon + 180) % 360 + 360) % 360;
  let s = '';
  for (let i = 0; i < length / 2; i++) {
    const r = PAIR[i];
    const a = Math.floor(la / r), b = Math.floor(lo / r);
    s += OLC[a] + OLC[b];
    la -= a * r; lo -= b * r;
  }
  return s;
}

/** Kurzen Code („GXJP+QH“) beim Bezugspunkt vervollständigen – der nächste passende */
function olcRecover(short, ref) {
  const pad = 8 - short.indexOf('+');
  const res = 20 ** (2 - pad / 2);
  const [lon, lat] = olcDecode(olcPrefix(ref, pad) + short);
  const fix = (v, r, lo, hi) => (r + res / 2 < v && v - res >= lo ? v - res : r - res / 2 > v && v + res <= hi ? v + res : v);
  return [fix(lon, ref[0], -Infinity, Infinity), fix(lat, ref[1], -90, 90)];
}

/* ── Lesen ────────────────────────────────────────────────────────────────── */

const ok = ([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const num = (s) => Number(String(s).replace(',', '.'));

/** Ein Teil („N 51° 31.914“, „9°56'08"E“, „-9.93“) → Grad, Achse ('lat' | 'lon' | '') */
function part(s) {
  const letter = s.match(/[NSEWO]/i)?.[0].toUpperCase() ?? '';
  const nums = s.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (!nums.length || nums.length > 3) return null;
  const [d, m = 0, sec = 0] = nums.map(num);
  if (m >= 60 || sec >= 60 || (nums.length > 1 && !Number.isInteger(d))) return null;
  let v = d + m / 60 + sec / 3600;
  if (/-/.test(s) || letter === 'S' || letter === 'W') v = -v;
  return { v, axis: 'NS'.includes(letter) && letter ? 'lat' : letter ? 'lon' : '' };
}

/** „51° 31' 55" 9° 56' 08"“ ohne Trenner: Jede Zahl mit ° fängt eine neue Angabe an */
function byDegree(t) {
  const groups = [];
  for (const k of t.match(/-?\d+(?:[.,]\d+)?\s*[°'"]?/g) ?? []) {
    if (/°/.test(k) || !groups.length) groups.push(k); else groups[groups.length - 1] += ` ${k}`;
  }
  return groups;
}

function latLon(t) {
  // Nur Zahlen, Trenner, Grad-Zeichen und Himmelsrichtungen – sonst ist es eine Adresse
  if (!/^[\d\s.,;:°'"+\-NSEWO]+$/i.test(t)) return null;
  const letters = (t.match(/[NSEWO]/gi) ?? []).length;
  const symbols = /[°'"]/.test(t);
  let halves;
  if (letters === 2) {
    // „N 51 … E 9 …“ (vorn) oder „51 … N 9 … E“ (hinten)
    halves = /^[\s]*[NSEWO]/i.test(t) ? t.split(/(?=[NSEWO])/i) : t.split(/(?<=[NSEWO])/i);
  } else if (letters) return null;
  else if (/^\s*-?\d+,\d+\s+-?\d+,\d+\s*$/.test(t)) halves = t.trim().split(/\s+/);  // 51,53 9,93
  else if (/[;]/.test(t)) halves = t.split(';');
  else if (/,/.test(t) && !/^\s*-?\d+,\d+\s*,/.test(t) && t.split(',').length === 2) halves = t.split(',');
  else if (/,/.test(t) && t.split(',').length === 4) {                                  // 51,53, 9,93
    const p = t.split(','); halves = [`${p[0]}.${p[1]}`, `${p[2]}.${p[3]}`];
  } else if (symbols) halves = byDegree(t);
  else halves = t.trim().split(/\s+/);
  halves = halves?.map((h) => h.trim()).filter(Boolean);
  if (halves?.length !== 2) return null;
  const [a, b] = halves.map(part);
  if (!a || !b) return null;
  // Ohne Buchstaben und Gradzeichen nur mit Nachkommastellen – „12 5“ ist eher eine Hausnummer
  if (!letters && !symbols && !halves.every((h) => /\d[.,]\d/.test(h))) return null;
  let lat = a.v, lon = b.v;
  if (a.axis === 'lon' || b.axis === 'lat') [lat, lon] = [b.v, a.v];
  else if (!a.axis && Math.abs(a.v) > 90 && Math.abs(b.v) <= 90) [lat, lon] = [b.v, a.v];
  return ok([lon, lat]) ? [lon, lat] : null;
}

/**
 * Text → { point: [lon, lat], kind: 'latlon' | 'mgrs' | 'utm' | 'plus' } | null.
 * Kurzer Plus Code ohne `ref`: { short: 'GXJP+QH', rest: 'Göttingen' } – wo, sagt der Aufrufer.
 */
export function parseCoords(text, ref = null) {
  const t = String(text ?? '').trim().replace(/[′’‘`´]/g, "'").replace(/[″“”]|''/g, '"').replace(/º/g, '°');
  if (!t) return null;
  let m = t.toUpperCase().replace(/\s+/g, ' ').match(/^(\d{1,2}) ?([C-HJ-NP-X]) ?([A-HJ-NP-Z])([A-HJ-NP-V]) ?(\d{2,10})(?: (\d{1,5}))?$/);
  if (m) {
    let [, z, band, col, row, e, n] = m;
    if (n === undefined) { if (e.length % 2) return null; n = e.slice(e.length / 2); e = e.slice(0, e.length / 2); }
    if (e.length !== n.length || e.length > 5) return null;
    const p = fromMgrs(Number(z), band, col, row, e, n);
    return p && ok(p) ? { point: p, kind: 'mgrs' } : null;
  }
  m = t.toUpperCase().match(/^(\d{1,2}) ?([C-HJ-NP-X])\s+(?:E\s*)?(\d{6}(?:[.,]\d+)?)\s*(?:M?\s*E)?\s+(?:N\s*)?(\d{7}(?:[.,]\d+)?)\s*(?:M?\s*N)?$/);
  if (m) {
    const p = fromUtm(Number(m[1]), num(m[3]), num(m[4]), BANDS.indexOf(m[2]) < 10);
    return ok(p) ? { point: p, kind: 'utm' } : null;
  }
  m = t.match(/^([23456789CFGHJMPQRVWX]{8})\+([23456789CFGHJMPQRVWX]{2,7})$/i);
  if (m) return { point: olcDecode(`${m[1]}+${m[2]}`), kind: 'plus' };
  m = t.match(/^([23456789CFGHJMPQRVWX]{4,6})\+([23456789CFGHJMPQRVWX]{2,7})(?:[\s,]+(.+))?$/i);
  if (m && m[1].length % 2 === 0) {
    const short = `${m[1]}+${m[2]}`.toUpperCase();
    if (ref) return { point: olcRecover(short, ref), kind: 'plus' };
    return { short, rest: (m[3] ?? '').trim(), kind: 'plus' };
  }
  const p = latLon(t);
  return p ? { point: p, kind: 'latlon' } : null;
}

/** Kurzen Plus Code beim Punkt `ref` auflösen (parseCoords → short) */
export const recoverPlus = (short, ref) => olcRecover(short, ref);

/* ── Schreiben ────────────────────────────────────────────────────────────── */

export const fmtLatLon = (p) => `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;

/** „32U 564889 5709391“ (Ost- und Nordwert in Metern) */
export function fmtUtm(p) {
  if (!(p?.[1] >= -80 && p[1] < 84)) return '';
  const { zone, band, easting, northing } = toUtm(p);
  return `${zone}${band} ${Math.floor(easting)} ${Math.floor(northing)}`;
}

/** „51°31'54.8"N 9°56'07.8"E“ */
export function fmtDms([lon, lat]) {
  const one = (v, pos, neg) => {
    const a = Math.abs(v);
    let d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    if (s >= 59.95) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v < 0 ? neg : pos}`;
  };
  return `${one(lat, 'N', 'S')} ${one(lon, 'E', 'W')}`;
}

/** Plus Code auf ≈ 14 m: „9F4GGXJP+QH“ */
export function fmtPlus(p) {
  const c = olcPrefix(p, 10);
  return `${c.slice(0, 8)}+${c.slice(8)}`;
}
