/**
 * Kern der Texte: t(), locale, Texte setzen – ohne top-level await, ohne document und localStorage, darum auch im
 * Service Worker nutzbar. Die Seiten laden core/i18n.js: Es liest die Sprachdatei und setzt sie hier, bevor die Module
 * laufen, die davon abhängen. Im Service Worker setzt sie js/sw/sync.js, jede Aufgabe wartet dort darauf.
 *
 * Module, die der Service Worker lädt, rufen t() nie beim Laden auf, nur wenn etwas passiert.
 */
export const FALLBACK = 'de_DE';
/** Gewählte Sprache im localStorage */
export const CHOICE = 'wmap.lang';

let own = null;
let base = null;
let generation = 0;
let plurals = new Intl.PluralRules('de-DE');

export let lang = FALLBACK;
/** Für Datum und Zahlen (Intl, toLocale…) */
export let locale = 'de-DE';

/** `ownData`: gewählte Sprache (fehlt sie: null), `baseData`: Deutsch für alles, was ihr fehlt */
export function setTexts(code, ownData, baseData) {
  own = ownData ?? null;
  base = baseData ?? null;
  lang = own ? code : FALLBACK;
  locale = (own ?? base)?._meta?.locale ?? 'de-DE';
  plurals = new Intl.PluralRules(locale);
  generation += 1;
}

export const textsLoaded = () => !!(own ?? base);

const find = (data, key) => key.split('.').reduce((o, k) => o?.[k], data);

export function textOf(data, key, vars) {
  let v = find(data, key) ?? find(base, key);
  if (v && typeof v === 'object') v = v[plurals.select(vars?.n ?? 0)] ?? v.other;
  if (typeof v !== 'string') return key;
  return vars ? v.replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all) : v;
}

export const t = (key, vars) => textOf(own, key, vars);

/** Immer Deutsch, unabhängig von der Sprache: was an andere geht (Hinweise und Kommentare für OpenStreetMap) */
export const tBase = (key, vars) => textOf(base, key, vars);

/** Wörter, die Eingaben auswerten (Listen): die der Sprache und die deutschen – beide werden verstanden */
export const words = (key) => [...new Set([...(find(own, key) ?? []), ...(find(base, key) ?? [])])];

/** Roher Eintrag nur aus der gewählten Sprache (fehlt er: undefined) bzw. aus dem Deutschen */
export const ownValue = (key) => find(own, key);
export const baseValue = (key) => find(base, key);

/** Für oft Gebrauchtes (Einheiten): `fn` einmal je Sprache auswerten, danach nur noch nachsehen */
export function perLanguage(fn) {
  let at = -1;
  let value;
  return () => {
    if (at !== generation) { value = fn(); at = generation; }
    return value;
  };
}
