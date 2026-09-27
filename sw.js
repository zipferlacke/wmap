/**
 * Service Worker: WMap läuft auch ohne Netz weiter.
 *
 *   App (eigene Dateien, MapLibre)   erst Netz, sonst Cache – neue Versionen
 *                                    kommen sofort an, offline geht es trotzdem
 *   Kacheln, Schriften, Symbole      erst Cache, sonst Netz – die Adressen
 *                                    enthalten die Version, ändern sich also nie
 *   Suche, Routing, Overpass …       nur Netz
 *
 * Vor einer Navigation lädt die Seite die Kacheln entlang der Route vor
 * (Nachricht „prefetch“), damit Funklöcher unterwegs nicht auffallen.
 */
const APP = 'wmap-app-v3';
const TILES = 'wmap-tiles-v1';
const MAX_TILES = 8000;

const TILE_HOSTS = ['tiles.openfreemap.org', 'tiles.mapterhorn.com'];
const APP_HOSTS = ['unpkg.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![APP, TILES].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

/** Kacheln, Schriften, Symbole: die Adresse trägt die Version – ändert sich nie. */
function immutable(url) {
  if (url.hostname === 'tiles.mapterhorn.com') return /\/\d+\/\d+\/\d+\.webp$/.test(url.pathname);
  return /^\/(planet\/\d|fonts\/|sprites\/|natural_earth\/)/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(immutable(url) ? cacheFirst(req) : networkFirst(req, TILES));
  } else if (url.origin === self.location.origin || APP_HOSTS.includes(url.hostname)) {
    e.respondWith(networkFirst(req, APP));
  }
});

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    // Eigene Dateien immer beim Server nachprüfen: Sonst liefert der HTTP-Cache
    // des Browsers eine alte app.js zur neuen index.html – und nichts passt
    const own = new URL(req.url).origin === self.location.origin;
    const res = await fetch(req, own ? { cache: 'no-cache' } : undefined);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    // Aufruf mit Parametern (?sim, ?q=…) findet die gespeicherte Seite trotzdem
    const hit = await cache.match(req, { ignoreVary: true })
      ?? (req.mode === 'navigate' ? await cache.match(req, { ignoreSearch: true, ignoreVary: true }) : null);
    if (hit) return hit;
    throw err;
  }
}

let puts = 0;

async function cacheFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  let res;
  try {
    res = await fetch(req);
  } catch {
    // Netz weg oder Aussetzer: sauber als fehlende Kachel melden
    return new Response(null, { status: 504, statusText: 'Offline' });
  }
  if (res.ok) {
    await cache.put(req, res.clone()).catch(() => {});
    if (++puts % 250 === 0) trim(cache);
  }
  return res;
}

/** Älteste Kacheln zuerst verwerfen – der Cache wächst sonst unbegrenzt. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

/* ── Nachrichten der Seite ────────────────────────────────────────────────── */

self.addEventListener('message', (e) => {
  const { type, urls = [] } = e.data ?? {};
  const port = e.ports[0];
  if (type === 'app-files') e.waitUntil(storeApp(urls));
  if (type === 'prefetch') e.waitUntil(prefetch(urls, port));
});

/** Was die Seite vor dem ersten Start des Service Workers geladen hat. */
async function storeApp(urls) {
  const app = await caches.open(APP);
  const tiles = await caches.open(TILES);
  await Promise.all(urls.map(async (u) => {
    const url = new URL(u);
    const cache = TILE_HOSTS.includes(url.hostname) ? tiles : app;
    if (await cache.match(u, { ignoreVary: true })) return;
    // Skripte ohne crossorigin kommen „opaque“ – so bleibt es gleich
    const opts = url.origin === self.location.origin || TILE_HOSTS.includes(url.hostname) ? {} : { mode: 'no-cors' };
    try {
      const res = await fetch(u, opts);
      if (res.ok || res.type === 'opaque') await cache.put(u, res);
    } catch { /* nächstes Mal */ }
  }));
}

/** Kacheln vorladen, 6 gleichzeitig; meldet den Fortschritt über den Port. */
async function prefetch(urls, port) {
  const cache = await caches.open(TILES);
  let done = 0, loaded = 0, failed = 0;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        if (!await cache.match(u, { ignoreVary: true })) {
          const res = await fetch(u);
          if (res.ok) { await cache.put(u, res); loaded += 1; } else if (res.status !== 404) failed += 1;
        }
      } catch { failed += 1; }
      done += 1;
      if (done % 20 === 0) port?.postMessage({ done, total: urls.length });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await trim(cache);
  port?.postMessage({ done, total: urls.length, loaded, failed, finished: true });
}
