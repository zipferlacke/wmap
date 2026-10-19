/**
 * Abgleich im Service Worker: Ordner (data/folder.js) und Health Connect (services/health.js) laufen hier – ein
 * Seitenwechsel bricht sie nicht mehr ab. Die Seiten geben nur Aufträge und zeigen den Stand (core/sw-link.js):
 *
 *   sync:caps            { folder, health } – was er hier kann
 *   sync:state           { busy, progress, health } – läuft gerade etwas?
 *   sync:alive           wach halten, solange etwas läuft (sonst legt der Browser ihn nach kurzer Ruhe schlafen)
 *   sync:folder { opts } folder.sync(opts) – auch mit Entscheidung über neue Dateien (`decide`)
 *   sync:auto { periodic }  beim Öffnen einer Seite bzw. alle 30 Minuten: erst Health Connect, dann der Ordner
 *   sync:soon            nach einer Änderung (kurz gewartet, dann abgleichen)
 *   sync:health { quiet }   Health Connect von Hand (Fortschritt als „wmap:health-progress“)
 *   sync:disconnect, sync:fill, sync:import { files }, sync:import-slot, sync:restore-zip { file }
 *
 * Antwort über den mitgegebenen Port: { ok: true, r } | { ok: false, err }. Was die Module als Ereignis melden
 * (wmap:folder …), geht an alle offenen Seiten, ebenso Änderungen an den gemeinsamen Einstellungen (store.js).
 * Ordner und Health Connect der App erreicht er über eine offene Seite als Boten (core/tauri.js); im Browser öffnet
 * er den gewählten Ordner selbst.
 */
import { localReady, takeShared, tellPages } from '../data/store.js';
import { tauri } from '../core/tauri.js';
import { folder, autoFolderSync, syncSoon, importFiles, importSlot, restoreZip } from '../data/folder.js';
import { syncHealth, autoHealthSync, healthSyncing } from '../services/health.js';

const FORWARD = ['wmap:folder', 'wmap:folder-progress', 'wmap:folder-inbox', 'wmap:folder-others', 'wmap:health',
  'wmap:health-progress', 'wmap:saved', 'wmap:storage-full', 'wmap:data'];
const plain = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return null; } };
for (const name of FORWARD) self.addEventListener(name, (e) => tellPages({ type: 'event', name, detail: plain(e.detail) }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ein Ereignis darf den Service Worker nur begrenzt wach halten – länger halten ihn die Seiten mit „sync:alive“
const EVENT_MAX_MS = 4 * 60000;
const ALIVE_MS = 25000;

const jobs = new Set();
function track(p) {
  jobs.add(p);
  if (jobs.size === 1) tellPages({ type: 'busy', on: true });
  p.catch(() => {}).finally(() => {
    jobs.delete(p);
    if (!jobs.size) tellPages({ type: 'busy', on: false });
  });
  return p;
}
const anyJob = () => Promise.allSettled([...jobs]);

/** Vor jedem Auftrag: Einstellungen und Touren aus der Kopie, nachsehen, ob es die App ist */
const prepare = () => Promise.all([localReady(), tauri.ready()]);
const healthHere = () => tauri.here && /Android/i.test(navigator.userAgent);

async function auto(periodic) {
  await autoHealthSync({ periodic }).catch(() => null);
  return autoFolderSync({ periodic }).catch(() => null);
}

/** File aus der Seite → wie <input type=file> (webkitRelativePath geht beim Übergeben verloren) */
const fileLike = ({ file, path }) => ({ name: file.name, webkitRelativePath: path ?? '', lastModified: file.lastModified, text: () => file.text() });

const HANDLERS = {
  'sync:caps': async () => ({ folder: folder.supported, health: healthHere() }),
  'sync:state': () => ({ busy: folder.busy, progress: folder.progress, health: healthSyncing() }),
  'sync:alive': () => true,
  'sync:folder': ({ opts }) => track(folder.sync(opts ?? {})),
  'sync:auto': ({ periodic }) => track(auto(!!periodic)),
  'sync:soon': () => track(syncSoon()),
  'sync:health': ({ quiet }) => track(syncHealth({ quiet, onProgress: (i, n) => dispatchEvent(new CustomEvent('wmap:health-progress', { detail: { i, n } })) })),
  'sync:disconnect': ({ opts }) => track(folder.disconnect(opts ?? {})),
  'sync:fill': () => track(folder.fillAll()),
  'sync:import': ({ files }) => track(importFiles(files.map(fileLike))),
  'sync:import-slot': ({ name }) => track(importSlot(name)),
  'sync:restore-zip': ({ file }) => track(restoreZip(file)),
};

self.addEventListener('message', (e) => {
  const d = e.data ?? {};
  if (d.type === 'local') { takeShared(d.row); return; }
  const fn = HANDLERS[d.type];
  if (!fn) return;
  const port = e.ports?.[0];
  if (d.type === 'sync:alive') { e.waitUntil(Promise.race([anyJob(), sleep(ALIVE_MS)])); port?.postMessage({ ok: true, r: true }); return; }
  const job = prepare().then(() => fn(d)).then(
    (r) => port?.postMessage({ ok: true, r: plain(r) }),
    (err) => port?.postMessage({ ok: false, err: String(err?.message ?? err) }));
  e.waitUntil(Promise.race([job, sleep(EVENT_MAX_MS)]));
});
