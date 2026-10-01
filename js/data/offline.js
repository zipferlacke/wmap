/**
 * Offline: Service Worker anmelden und vor einer Navigation die Karte entlang
 * der Route vorladen. Funklöcher unterwegs fallen dann nicht auf – nur neu
 * berechnen geht ohne Netz nicht.
 *
 * Vorgeladen werden die Vektorkacheln (bis Zoom 14, darüber vergrößert
 * MapLibre selbst), die Schriften für die Beschriftung und die Symbole.
 * Höhendaten nicht: Die liegen bis Zoom 16 und wären zehnmal so viele Daten –
 * ohne Netz bleibt die Karte darum flach.
 */
import { local } from './store.js';
import { simplify } from '../core/geo.js';

const SETTING = 'wmap.offline';

/** Karten für die Navigation vorladen? Standard: ja, außer im Datensparmodus. */
export const offlineSetting = {
  get: () => local.get(SETTING, true) !== false,
  set: (on) => local.set(SETTING, !!on),
};

export async function registerOffline() {
  if (!('serviceWorker' in navigator)) return;
  // Erst die Seite: Beim allerersten Besuch lädt der Service Worker alle
  // Dateien in seinen Speicher – das soll nicht mit dem Aufbau der Seite um
  // die Leitung streiten. Ist er schon da, kostet das Anmelden nichts
  if (!navigator.serviceWorker.controller) {
    if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
    await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    const reg = await navigator.serviceWorker.ready;
    // Was schon geladen ist, bevor der Service Worker mitlesen konnte
    const urls = performance.getEntriesByType('resource').map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) || /^https:\/\/tiles\.openfreemap\.org\//.test(u));
    urls.push(location.href.split(/[?#]/)[0]);
    reg.active?.postMessage({ type: 'app-files', urls: [...new Set(urls)] });
  } catch { /* ohne Service Worker geht es nur online */ }
}

/* ── Kacheln entlang der Route ────────────────────────────────────────────── */

const EARTH = 40075016.686;

/** Kachelnummern bei Zoom z, gebrochen – [x, y] */
export function tileXY([lon, lat], z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/**
 * Alle Kacheln, die die Linie samt Rand berühren.
 * @param buffer  Rand je Zoomstufe in Metern
 */
export function tilesAlong(coords, zooms, buffer = () => 0) {
  const out = [];
  const line = simplify(coords, 20);
  for (const z of zooms) {
    const seen = new Set();
    const lat = line[0]?.[1] ?? 0;
    const tileM = (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const b = buffer(z) / tileM;           // Rand in Kachelbreiten
    const add = (fx, fy) => {
      for (let x = Math.floor(fx - b); x <= Math.floor(fx + b); x += 1) {
        for (let y = Math.floor(fy - b); y <= Math.floor(fy + b); y += 1) {
          const k = `${x}/${y}`;
          if (!seen.has(k)) { seen.add(k); out.push([z, x, y]); }
        }
      }
    };
    for (let i = 0; i < line.length; i += 1) {
      const [x1, y1] = tileXY(line[i], z);
      add(x1, y1);
      if (i === 0) continue;
      // Zwischenpunkte alle Viertelkachel, damit keine Lücke bleibt
      const [x0, y0] = tileXY(line[i - 1], z);
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4);
      for (let s = 1; s < steps; s += 1) add(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
  }
  return out;
}

/** Rand um die Route: nah dran schmal, weiter draußen breiter. */
const BUFFER = (z) => (z >= 14 ? 350 : z >= 12 ? 1500 : 4000);
const ZOOMS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const MAX_TILES = 2500;

export function styleAssets(map) {
  const style = map.getStyle();
  const urls = [];
  const src = map.getSource('openmaptiles');
  const template = src?.tiles?.[0];
  const glyphs = style.glyphs;
  if (glyphs) {
    const fonts = new Set();
    for (const l of style.layers) {
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && f.every((x) => typeof x === 'string')) fonts.add(f.join(','));
    }
    // Lateinisch, Umlaute, ß, Satzzeichen
    for (const f of fonts) for (const r of ['0-255', '256-511', '8192-8447', '8448-8703']) {
      urls.push(glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r));
    }
  }
  const sprite = typeof style.sprite === 'string' ? style.sprite : style.sprite?.[0]?.url;
  if (sprite) for (const s of ['', '@2x']) urls.push(`${sprite}${s}.json`, `${sprite}${s}.png`);
  return { template, urls };
}

/**
 * Karte entlang der Route in den Cache.
 * → Promise<{ tiles, loaded, failed }>; onProgress(done, total)
 */
export async function saveRouteOffline(map, route, { onProgress } = {}) {
  // Ohne Service Worker (App mit eingepackter Oberfläche: http://tauri.localhost
  // darf keinen anmelden) käme `ready` nie – dann lädt die Seite selbst vor
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  const { template, urls } = styleAssets(map);
  if (!template) throw new Error('Kartenquelle noch nicht geladen');

  let tiles = tilesAlong(route.coords, ZOOMS, BUFFER);
  // Sehr lange Strecken: den Rand ganz nah dran weglassen
  if (tiles.length > MAX_TILES) tiles = tilesAlong(route.coords, ZOOMS, (z) => (z >= 13 ? 0 : BUFFER(z)));
  tiles = tiles.slice(0, MAX_TILES);
  const all = [...urls, ...tiles.map(([z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y))];

  // Der Browser soll den Cache nicht bei Platzmangel still wegräumen
  navigator.storage?.persist?.().catch(() => {});

  if (!reg?.active) return prefetchHere(all, tiles.length, onProgress);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = ({ data }) => {
      onProgress?.(data.done, data.total);
      if (data.finished) resolve({ tiles: tiles.length, loaded: data.loaded, failed: data.failed });
    };
    reg.active.postMessage({ type: 'prefetch', urls: all }, [ch.port2]);
  });
}

/** Selbst laden – landet im HTTP-Cache des Browsers bzw. WebViews (6 zugleich) */
async function prefetchHere(urls, tiles, onProgress) {
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try { if (!(await fetch(u)).ok) failed += 1; } catch { failed += 1; }
      done += 1;
      onProgress?.(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { tiles, loaded: done - failed, failed };
}

/* ── Laufende Navigation merken ───────────────────────────────────────────── */

const NAV_KEY = 'wmap.nav';
const NAV_MAX_AGE = 12 * 3600 * 1000;

/** Route ohne die Teile, die sich neu berechnen lassen (cum). */
export function rememberNav({ route, profile, highways, targets, destination }) {
  const { cum, ...rest } = route;
  local.set(NAV_KEY, { route: rest, profile, highways, targets, destination, at: Date.now() });
}

export function forgetNav() { local.set(NAV_KEY, null); }

export function savedNav() {
  const n = local.get(NAV_KEY);
  if (!n?.route?.coords?.length || Date.now() - n.at > NAV_MAX_AGE) return null;
  return n;
}
