/**
 * Geometrie ohne Bibliothek: Polyline dekodieren, Abstände, Punkt auf Linie.
 * Koordinaten immer als [lon, lat] wie in GeoJSON und MapLibre.
 */
import { locale, perLanguage, t } from './i18n-text.js';
import { M_PER_FOOT, M_PER_MILE, clock12, imperial, speedOf } from './units.js';

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Valhalla liefert Polyline6 (sechs Nachkommastellen). */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let lat = 0, lon = 0, i = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = str.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lon += delta;
    }
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

/** Gegenstück zu decodePolyline – für kompakte Speicherung und Valhalla. */
export function encodePolyline(coords, precision = 6) {
  const factor = 10 ** precision;
  let out = '', pLat = 0, pLon = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * factor), lo = Math.round(lon * factor);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

/** Abstand zweier Punkte in Metern. */
export function distance(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Aufsummierte Strecke je Stützpunkt in Metern. */
export function cumulative(coords) {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i += 1) cum[i] = cum[i - 1] + distance(coords[i - 1], coords[i]);
  return cum;
}

/** Richtung von a nach b in Grad (0 = Norden). */
export function bearing(a, b) {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD)
    - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Punkt `m` Meter von p in Richtung `deg` (für kurze Strecken genau genug). */
export function destination([lon, lat], deg, m) {
  const dLat = (m * Math.cos(deg * RAD)) / 111320;
  const dLon = (m * Math.sin(deg * RAD)) / (111320 * Math.cos(lat * RAD));
  return [lon + dLon, lat + dLat];
}

/** Punkt bei `m` Metern entlang der Linie. */
export function pointAt(coords, cum, m) {
  if (m <= 0) return coords[0];
  const last = coords.length - 1;
  if (m >= cum[last]) return coords[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= m) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (m - cum[lo]) / seg;
  const a = coords[lo], b = coords[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Nächster Punkt auf der Linie.
 *
 * Gerechnet wird je Abschnitt in einer lokalen ebenen Projektion – auf
 * wenigen hundert Metern ist das genauer als nötig und viel schneller als
 * sphärische Formeln. `from`/`to` begrenzen die Suche (Navigation).
 * → { along: Meter ab Start, offset: Abstand zur Linie, index, point }
 */
export function nearestOnLine(coords, cum, p, from = 0, to = coords.length - 1) {
  const kx = Math.cos(p[1] * RAD) * R * RAD;
  const ky = R * RAD;
  let best = { offset: Infinity, along: 0, index: from, point: coords[from] };
  const lo = Math.max(0, from), hi = Math.min(coords.length - 1, to);
  for (let i = lo; i < hi; i += 1) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + dx * t, y = ay + dy * t;
    const d = Math.hypot(x, y);
    if (d < best.offset) {
      best = {
        offset: d,
        along: cum[i] + (cum[i + 1] - cum[i]) * t,
        index: i,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      };
    }
  }
  return best;
}

/** Douglas-Peucker in Metern – für Overpass-Korridore mit wenigen Stützpunkten. */
export function simplify(coords, tolerance) {
  if (coords.length < 3) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  const kx = Math.cos(coords[0][1] * RAD) * R * RAD, ky = R * RAD;
  while (stack.length) {
    const [s, e] = stack.pop();
    const a = coords[s], b = coords[e];
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = Math.hypot(dx, dy);
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const px = (coords[i][0] - a[0]) * kx, py = (coords[i][1] - a[1]) * ky;
      // Rundweg: Anfang = Ende – dann zählt der Abstand zum Punkt selbst
      const d = len < 1 ? Math.hypot(px, py) : Math.abs(dx * py - dy * px) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Linie so weit vereinfachen, bis sie höchstens `max` Punkte hat. */
export function simplifyTo(coords, max) {
  let tol = 10;
  let out = simplify(coords, tol);
  while (out.length > max) { tol *= 1.6; out = simplify(coords, tol); }
  return out;
}

/** [west, süd, ost, nord] einer Punktliste. */
export function bbox(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Quadrat mit Kantenlänge 2·r Metern um einen Punkt. */
export function bboxAround([lon, lat], r) {
  const dLat = r / (R * RAD);
  const dLon = r / (R * RAD * Math.cos(lat * RAD));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/* ── Anzeige ──────────────────────────────────────────────────────────────── */

const nf = (v, d = 0) => v.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: d });
// Einheiten einmal je Sprache holen: Die Anzeige läuft auch in der Navigation dauernd
const units = perLanguage(() => ({
  m: t('common.units.m'), km: t('common.units.km'), h: t('common.units.h'), min: t('common.units.min'), s: t('common.units.s'),
  mi: t('common.units.mi'), ft: t('common.units.ft'), kmh: t('common.units.kmh'), mph: t('common.units.mph'),
}));

/** Strecke: metrisch „850 m“, „3,4 km“ – in Meilen (core/units.js) „400 ft“, „2.1 mi“ */
export function fmtDistance(m) {
  if (imperial()) {
    const ft = m / M_PER_FOOT;
    if (ft < 500) return `${nf(Math.max(0, Math.round(ft / 10) * 10))} ${units().ft}`;
    const mi = m / M_PER_MILE;
    return `${nf(mi, mi < 9.95 ? 1 : 0)} ${units().mi}`;
  }
  if (m < 950) return `${nf(Math.max(0, Math.round(m / 10) * 10))} ${units().m}`;
  return `${nf(m / 1000, m < 9950 ? 1 : 0)} ${units().km}`;
}

/** „km/h“ bzw. „mph“ */
export const speedUnit = () => (imperial() ? units().mph : units().kmh);
/** Tempo aus m/s mit Einheit: „23,4 km/h“ bzw. „14.5 mph“ */
export const fmtSpeed = (mps, decimals = 1) => `${nf(speedOf(mps), decimals)} ${speedUnit()}`;

export function fmtDuration(s) {
  const u = units();
  const min = Math.round(s / 60);
  if (min < 60) return `${Math.max(1, min)} ${u.min}`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} ${u.h} ${rest} ${u.min}` : `${h} ${u.h}`;
}

/**
 * Gemessene Dauer (aufgezeichnete Touren): unter einer Stunde auf die Sekunde („35 min 12 s“), ab einer Stunde auf
 * die Minute („1 h 23 min“). Geschätzte Zeiten (Route, Planung) bleiben bei fmtDuration.
 */
export function fmtTime(s) {
  const sec = Math.round(s);
  if (sec >= 3600) return fmtDuration(sec);
  const u = units();
  const m = Math.floor(sec / 60), r = sec % 60;
  return m ? (r ? `${m} ${u.min} ${r} ${u.s}` : `${m} ${u.min}`) : `${r} ${u.s}`;
}

/** Entfernung für die Ansage: „In 300 Metern“, „In 1,5 Kilometern“. */
/** `form`: '_plain' für die Grundform („300 Meter“ statt „in 300 Metern“) */
export function speakDistance(m, form = '') {
  if (imperial()) {
    if (m >= 300) {
      const mi = Math.round(m / M_PER_MILE * 10) / 10;
      const shown = mi < 9.95 ? mi : Math.round(mi);
      return t(`common.speech.miles${form}`, { x: nf(shown, Number.isInteger(shown) ? 0 : 1), n: shown });
    }
    const ft = m / M_PER_FOOT;
    const step = ft > 300 ? 100 : 50;
    return t(`common.speech.feet${form}`, { x: Math.max(step, Math.round(ft / step) * step) });
  }
  if (m >= 950) return t(`common.speech.kilometers${form}`, { x: nf(Math.round(m / 100) / 10, m < 9950 ? 1 : 0) });
  const step = m > 300 ? 100 : m > 100 ? 50 : 10;
  return t(`common.speech.meters${form}`, { x: Math.max(step, Math.round(m / step) * step) });
}

/** Angaben für Intl/toLocale…: Uhrzeit „14:05“ bzw. „2:05 PM“ (core/units.js) */
export const clockFormat = () => ({ hour: clock12() ? 'numeric' : '2-digit', minute: '2-digit', hour12: clock12() });
export function fmtClock(date) {
  return date.toLocaleTimeString(locale, clockFormat());
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
