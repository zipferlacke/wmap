/**
 * Service Worker: WMap läuft auch ohne Netz weiter – und genau eine Version.
 *
 *   App (eigene Dateien, libs/)      erst Cache, sonst Netz – je Fassung ein
 *                                    Cache „wmap-app-<VERSION>-<BUILD>“, beim
 *                                    Installieren ganz geladen (sw-files.json)
 *   appdata/messages.json            erst Netz (sagt, ob es Neues gibt), ohne
 *                                    Netz der Cache mit „X-WMap-Offline: 1“
 *   Kacheln, Schriften, Symbole      erst Cache, sonst Netz – die Adressen
 *                                    enthalten die Version, ändern sich also nie
 *   Suche, Routing, Overpass, bEnd/  nur Netz
 *
 * Update: Eine neue VERSION oder geänderte Dateien (BUILD, beides von
 * appdata/version.py) machen eine neue sw.js – der Browser installiert sie im
 * Hintergrund in einen eigenen Speicher, sie wartet; die laufende Seite
 * bleibt ganz bei ihrer Fassung. Neue Nummer: Die Seite fragt
 * (js/ui/news.js) „Neue Version verfügbar“ bzw. zwingend bei minVersion;
 * „Aktualisieren“ schickt „skip-waiting“, dann lädt die Seite neu. Nur
 * geänderte Dateien bei gleicher Nummer: gilt still ab dem nächsten Start.
 *
 * Teilen-Menü am Handy (manifest share_target): die GPX-Dateien kommen per
 * POST an import.html – hier in den Cache „wmap-share“, dann weiter zu
 * import.html?shared (js/pages/import.js holt sie dort ab).
 *
 * Auf localhost (Entwicklung) erst Netz, sonst Cache – Änderungen sind sofort
 * zu sehen. Cache first testen: über 127.0.0.1 statt localhost öffnen.
 *
 * Offline-Gebiete (offline.html) liegen je in einem Cache „wmap-area-…“ und
 * bleiben, bis man sie löscht. Die Kacheln von OpenFreeMap stehen dort ohne
 * die Version im Pfad (planet/<Version>/ → planet/offline/) – OpenFreeMap
 * baut die Karte wöchentlich neu, das Gebiet passt so trotzdem weiter.
 *
 * Vor einer Navigation lädt die Seite die Kacheln entlang der Route vor
 * (Nachricht „prefetch“), damit Funklöcher unterwegs nicht auffallen. Jede
 * Navigation bekommt einen eigenen Cache „wmap-nav-<Zeit>“:
 *   - nach 10 Tagen wird er gelöscht
 *   - reicht der Platz nicht, weicht zuerst die älteste Navigation
 */
const VERSION = '2.1.0';            // von appdata/version.py – neue Nummer = Update
// Stand der Dateien (Prüfsumme über alles in sw-files.json, von version.py):
// dieselbe Nummer noch einmal hochgeladen ist trotzdem ein neuer Service Worker
// mit eigenem Speicher – Alt und Neu mischen sich nie
const BUILD = '1046e913da';
const APP = `wmap-app-${VERSION}-${BUILD}`;
const APP_PREFIX = 'wmap-app-';
const SHARE = 'wmap-share';
const DEV = self.location.hostname === 'localhost';
const TILES = 'wmap-tiles-v1';
const MAX_TILES = 8000;
const NAV = 'wmap-nav-';
const NAV_MAX_AGE = 10 * 24 * 3600 * 1000;
const AREA = 'wmap-area-';
// Grob je Kachel samt Cache-Verwaltung – nur um vorher Platz zu schaffen
const TILE_BYTES = 60 * 1024;

const TILE_HOSTS = ['tiles.openfreemap.org', 'tiles.mapterhorn.com'];

// Neue Version: alle Dateien vorab laden, dann warten, bis die Seite „Aktualisieren“ sagt
// (die allererste Version wird sofort aktiv – es gibt ja keine alte)
self.addEventListener('install', (e) => e.waitUntil(precache()));

/*
 * Alles in den Speicher dieser Fassung – im Hintergrund, die laufende Seite
 * bleibt bei ihrer. Jede Datei wird beim Server nur nachgefragt („no-cache“):
 * Was der Browser gerade erst geladen hat oder was sich nicht geändert hat,
 * kommt mit 304 aus seinem Cache und wird nicht noch einmal übertragen. Sechs
 * zugleich, damit das Vorladen der Seite nicht die Leitung nimmt.
 */
async function precache() {
  const cache = await caches.open(APP);
  let files = [];
  try { files = await (await fetch('appdata/sw-files.json', { cache: 'no-store' })).json(); } catch { /* dann nach und nach */ }
  const queue = files.slice();
  // Einzeln: Fehlt eine Datei auf dem Server, scheitert nicht gleich die ganze Version
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      for (let tries = 0; tries < 2; tries += 1) {
        try {
          const res = await fetch(new Request(f, { cache: 'no-cache' }));
          if (res.ok) await cache.put(f, res);
          if (res.ok || res.status === 404) break;
        } catch { /* Aussetzer: noch einmal, sonst kommt sie beim ersten Aufruf */ }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![APP, TILES, SHARE].includes(k) && !k.startsWith(NAV) && !k.startsWith(AREA)) await caches.delete(k);
  await dropOldNavs();
  await self.clients.claim();
})()));

/** Kacheln, Schriften, Symbole: die Adresse trägt die Version – ändert sich nie. */
function immutable(url) {
  if (url.hostname === 'tiles.mapterhorn.com') return /\/\d+\/\d+\/\d+\.webp$/.test(url.pathname);
  return /^\/(planet\/\d|fonts\/|sprites\/|natural_earth\/)/.test(url.pathname);
}

/** Schlüssel der Offline-Gebiete: Kacheln von OpenFreeMap ohne Version */
function areaKey(u) {
  return String(u).replace(/^(https:\/\/tiles\.openfreemap\.org\/planet\/)[^/]+\/(?=\d+\/)/, '$1offline/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/import.html')) { e.respondWith(sharedIn(req)); return; }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(immutable(url) ? cacheFirst(req) : networkFirst(req, TILES));
  } else if (url.origin === self.location.origin) {
    if (url.pathname.includes('/bEnd/')) return;                     // Server-API: nur Netz
    if (url.pathname.endsWith('/appdata/messages.json')) e.respondWith(versionFile(req));
    else e.respondWith(DEV ? networkFirst(req, APP) : appFirst(req));
  }
});

/** Geteilte Dateien ablegen, dann zur Seite, die sie öffnet */
async function sharedIn(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE);
    let i = 0;
    for (const f of form.getAll('files')) {
      if (typeof f === 'string') continue;
      await cache.put(`shared/${i += 1}`, new Response(f, { headers: { 'X-Name': encodeURIComponent(f.name || 'Datei.gpx') } }));
    }
  } catch { /* dann eben über die Auswahl */ }
  return Response.redirect('./import.html?shared', 303);
}

/** Eigene Dateien: aus dem Cache dieser Version, nur Fehlendes aus dem Netz */
async function appFirst(req) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req, { ignoreVary: true })
    ?? (req.mode === 'navigate' ? await cache.match(req, { ignoreSearch: true, ignoreVary: true }) : null);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

/** messages.json: immer frisch vom Server; ohne Netz die gespeicherte – markiert */
async function versionFile(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (!hit) throw err;
    const headers = new Headers(hit.headers);
    headers.set('X-WMap-Offline', '1');
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

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
    // Stil und TileJSON der Karte liegen auch in den Offline-Gebieten
    const hit = await cache.match(req, { ignoreVary: true })
      ?? (req.mode === 'navigate' ? await cache.match(req, { ignoreSearch: true, ignoreVary: true }) : null)
      ?? (name === TILES ? await caches.match(req, { ignoreVary: true }) : null);
    if (hit) return hit;
    throw err;
  }
}

let puts = 0;

async function cacheFirst(req) {
  const cache = await caches.open(TILES);
  // Auch in den Caches der vorgeladenen Navigationen und der Offline-Gebiete suchen
  const hit = await caches.match(req, { ignoreVary: true })
    ?? (areaKey(req.url) !== req.url ? await caches.match(areaKey(req.url), { ignoreVary: true }) : undefined);
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
  if (type === 'skip-waiting') self.skipWaiting();
  if (type === 'app-files') e.waitUntil(storeApp(urls));
  if (type === 'prefetch') e.waitUntil(prefetch(urls, port));
  if (type === 'area') e.waitUntil(areaBatch(e.data.cache, urls, port));
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

/* ── Vorgeladene Navigationen ──────────────────────────────────────────────── */

/** Caches der Navigationen, älteste zuerst → [{ name, at }] */
async function navCaches() {
  return (await caches.keys()).filter((k) => k.startsWith(NAV))
    .map((name) => ({ name, at: +name.slice(NAV.length) || 0 })).sort((a, b) => a.at - b.at);
}

/** Älter als 10 Tage: weg */
async function dropOldNavs() {
  for (const n of await navCaches()) if (Date.now() - n.at > NAV_MAX_AGE) await caches.delete(n.name);
}

/** Älteste Navigation löschen (nie die gerade laufende) → ob etwas gelöscht wurde */
async function dropOldestNav(keep) {
  const oldest = (await navCaches()).find((n) => n.name !== keep);
  if (!oldest) return false;
  await caches.delete(oldest.name);
  return true;
}

/** Vorher Platz schaffen: so lange die ältesten Navigationen löschen, bis es reicht */
async function makeRoom(bytes, keep) {
  const est = await self.navigator.storage?.estimate?.().catch(() => null);
  if (!est?.quota) return;
  let free = est.quota - est.usage;
  while (free < bytes) {
    const before = (await self.navigator.storage.estimate()).usage;
    if (!await dropOldestNav(keep)) return;
    free += Math.max(0, before - (await self.navigator.storage.estimate()).usage);
  }
}

/** Speichern; ist der Platz voll, weicht die älteste Navigation und es geht noch einmal */
async function putRoom(cache, u, res, keep) {
  try {
    await cache.put(u, res.clone());
  } catch (err) {
    if (err?.name !== 'QuotaExceededError' || !await dropOldestNav(keep)) throw err;
    await cache.put(u, res);
  }
}

/** Kacheln vorladen, 6 gleichzeitig; meldet den Fortschritt über den Port. */
async function prefetch(urls, port) {
  await dropOldNavs();
  const name = `${NAV}${Date.now()}`;
  await makeRoom(urls.length * TILE_BYTES, name);
  const cache = await caches.open(name);
  let done = 0, loaded = 0, failed = 0;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        // Schon anderswo gespeichert (Karte angesehen, frühere Fahrt): nur übernehmen –
        // so bleibt diese Navigation vollständig, auch wenn die frühere gelöscht wird
        const known = await caches.match(u, { ignoreVary: true });
        if (known) await putRoom(cache, u, known, name);
        else {
          const res = await fetch(u);
          if (res.ok) { await putRoom(cache, u, res, name); loaded += 1; } else if (res.status !== 404) failed += 1;
        }
      } catch { failed += 1; }
      done += 1;
      if (done % 20 === 0) port?.postMessage({ done, total: urls.length });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  port?.postMessage({ done, total: urls.length, loaded, failed, finished: true });
}

/* ── Offline-Gebiete ──────────────────────────────────────────────────────── */

/**
 * Ein Stapel Adressen in den Cache eines Gebiets (die Seite schickt sie in
 * Stapeln, damit kein einzelnes Ereignis zu lange läuft). Schon Gespeichertes
 * bleibt – so lässt sich ein abgebrochenes Gebiet fortsetzen. Was anderswo
 * schon liegt (angesehen, Navigation), wird nur übernommen.
 * → { bytes, failed, full } über den Port
 */
async function areaBatch(name, urls, port) {
  const cache = await caches.open(name);
  let bytes = 0, failed = 0, full = false;
  const queue = urls.slice();
  const size = async (res) => (await res.clone().blob()).size;
  const worker = async () => {
    while (queue.length && !full) {
      const u = queue.shift();
      const key = areaKey(u);
      try {
        const own = await cache.match(key, { ignoreVary: true });
        if (own) { bytes += await size(own); continue; }
        let res = await caches.match(u, { ignoreVary: true });
        if (!res) {
          res = await fetch(u);
          // Leere Kacheln (Meer, 204) und fehlende (404) gibt es – kein Fehler
          if (res.status === 204 || res.status === 404) continue;
          if (!res.ok) { failed += 1; continue; }
        }
        bytes += await size(res);
        await cache.put(key, res);
      } catch (err) {
        if (err?.name === 'QuotaExceededError') full = true; else failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  port?.postMessage({ bytes, failed, full });
}
