/**
 * Texte der App: appdata/lang/<sprache>.json, z. B. de_DE.json, en_GB.json. Oben steht je Seite bzw. Bereich ein
 * Eintrag („settings“, „common“ …), darunter gruppierte Schlüssel. Fehlt in einer Sprache etwas, gilt Deutsch.
 *
 *   t('settings.look.title')            Text
 *   t('settings.stats.mine', { x })     mit Platzhalter {x}
 *   t('wege.count', { n })              Einzahl/Mehrzahl: { "one": "…", "other": "…" } nach n
 *   <h1 data-i18n="settings.title">     fest im HTML; auch data-i18n-placeholder, -title, -aria-label
 *
 * Neue Sprache: Datei dazulegen und appdata/version.py laufen lassen – das trägt sie in languages.json ein.
 * Gibt es die Sprache des Geräts, bietet die App sie einmal an (ui/news.js), wählen lässt sie sich in den Einstellungen.
 *
 * Wartet beim Laden auf die Datei (top-level await), damit alle Module beim Start schon Texte haben. Darum nie aus dem
 * Service Worker (js/sw/, sw.js) laden: Dort ist das nicht erlaubt. Was er lädt, nimmt core/i18n-text.js.
 */
import { CHOICE, FALLBACK, lang, locale, setTexts, t, tBase, textOf, words, ownValue, baseValue } from './i18n-text.js';

export { FALLBACK, lang, locale, t, tBase, textOf, words, ownValue, baseValue };

const ASKED = 'wmap.lang.asked';

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* gesperrt */ } },
};

async function read(file) {
  try {
    const res = await fetch(new URL(`../../appdata/lang/${file}.json`, import.meta.url));
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const wanted = storage.get(CHOICE) ?? FALLBACK;
const own = await read(wanted);
const base = wanted === FALLBACK && own ? own : await read(FALLBACK);
setTexts(wanted, own, base);

/** Texte fest im HTML (data-i18n) – beim Laden einmal, danach für später Eingefügtes */
export function translate(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  // Text mit <strong>, <a> … nur aus der eigenen Sprachdatei
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const a of ['placeholder', 'title', 'aria-label']) {
    for (const el of root.querySelectorAll(`[data-i18n-${a}]`)) el.setAttribute(a, t(el.getAttribute(`data-i18n-${a}`)));
  }
}

document.documentElement.lang = locale.split('-')[0];
translate();

/** Sprachen, für die es eine Datei gibt → [{ code, name }] */
export async function languages() {
  try {
    const res = await fetch(new URL('../../appdata/lang/languages.json', import.meta.url));
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

export function setLanguage(code) { storage.set(CHOICE, code); }

/** Passende Sprache zu denen des Geräts: erst genau (en_GB), dann dieselbe Sprache (en_US → en_GB) → Code oder null */
export function matchLanguage(codes, device) {
  for (const d of device) {
    const c = d.replace('-', '_');
    const hit = codes.find((x) => x === c) ?? codes.find((x) => x.split('_')[0] === c.split('_')[0]);
    if (hit) return hit;
  }
  return null;
}

/** Sprache des Geräts anbieten? Einmal, und nur solange keine gewählt ist → { code, name, texts } oder null */
export async function languageOffer() {
  if (storage.get(CHOICE) || storage.get(ASKED)) return null;
  const list = await languages();
  const code = matchLanguage(list.map((l) => l.code), navigator.languages ?? [navigator.language]);
  if (!code || code === lang) return null;
  const texts = await read(code);
  return texts && { code, name: list.find((l) => l.code === code).name, texts };
}

export const languageAsked = () => storage.set(ASKED, '1');
