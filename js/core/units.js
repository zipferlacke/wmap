/**
 * Maße und Uhrzeit: Kilometer oder Meilen, 24 oder 12 Stunden (Einstellungen → Darstellung). Ohne eigene Wahl gilt,
 * was im Land des Geräts üblich ist: Meilen in den USA, Großbritannien, Liberia und Myanmar, die 12-Stunden-Uhr
 * nach der Sprache des Geräts.
 *
 * Liest den localStorage direkt (Werte wie data/store.js sie schreibt) und hängt von keinem anderen Modul ab;
 * im Service Worker gibt es ihn nicht, dort gilt metrisch und 24 Stunden.
 */
export const UNITS_KEY = 'wmap.units';   // 'metric' | 'imperial'
export const CLOCK_KEY = 'wmap.clock';   // '24' | '12'
const MILES = ['US', 'GB', 'LR', 'MM'];
export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;

function stored(key, allowed) {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
    return allowed.includes(v) ? v : null;
  } catch { return null; }
}
const device = () => globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? 'de-DE';

/** Was im Land des Geräts üblich ist → 'metric' | 'imperial' */
export function deviceUnits() {
  try { return MILES.includes(new Intl.Locale(device()).maximize().region) ? 'imperial' : 'metric'; } catch { return 'metric'; }
}
/** → '24' | '12' */
export function deviceClock() {
  try {
    return /^h1[12]$/.test(new Intl.DateTimeFormat(device(), { hour: 'numeric' }).resolvedOptions().hourCycle) ? '12' : '24';
  } catch { return '24'; }
}

let units = null;
let clock = null;
export const unitSystem = () => (units ??= stored(UNITS_KEY, ['metric', 'imperial']) ?? deviceUnits());
export const clockSystem = () => (clock ??= stored(CLOCK_KEY, ['24', '12']) ?? deviceClock());
export const imperial = () => unitSystem() === 'imperial';
export const clock12 = () => clockSystem() === '12';
/** Nach einer Änderung der Einstellung: neu lesen */
export function refreshUnits() { units = null; clock = null; }

/** m/s → km/h bzw. mph */
export const speedOf = (mps) => mps * (imperial() ? 3600 / M_PER_MILE : 3.6);
/** Tempolimit in km/h → Zahl für die Anzeige; in Meilen auf 5 mph gerundet, wie es auf den Schildern steht */
export const limitOf = (kmh) => (!kmh ? kmh : imperial() ? Math.round(kmh * 1000 / M_PER_MILE / 5) * 5 : kmh);
