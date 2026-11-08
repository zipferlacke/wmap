/**
 * Verbindung der Seite zum Abgleich im Service Worker (js/sw/sync.js) – auf jeder Seite geladen:
 *
 *   swCall(type, data)    Auftrag an ihn („sync:folder“, „sync:auto“ …) → Ergebnis; null, wenn es ihn (noch) nicht
 *                         gibt – dann gleicht die Seite selbst ab
 *                         Jede Nachricht nennt die Sprache der Seite (`lang`): Seine Meldungen kommen in ihr
 *   Bote                  „tauri“ { cmd, args }: Befehle der App-Plugins für ihn ausführen (core/tauri.js)
 *   Meldungen             „event“ → dasselbe Ereignis hier (detail.remote = true), „local“ → in den localStorage
 *                         (data/store.js), „devlog“ → ins Protokoll
 *   Wach halten           solange er arbeitet, alle 20 s „sync:alive“ – sonst legt der Browser ihn nach kurzer Ruhe schlafen
 *
 * Beim Laden gleicht die Seite ihren localStorage mit der Kopie für den Service Worker ab (store.js localReady).
 */
import { localReady, takeShared } from '../data/store.js';
import { devLog } from './devlog.js';
import { CHOICE, t } from './i18n-text.js';

const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
const ALIVE_MS = 20000;
// Die Texte der Seite laden, ohne darauf zu warten; die Antwort an ihn (Bote) braucht sie
import('./i18n.js').catch(() => {});
const lang = () => { try { return localStorage.getItem(CHOICE) || undefined; } catch { return undefined; } };
let aliveTimer = null;

/** Auftrag an den Service Worker → Ergebnis; wirft mit seinem Fehler. `timeout`: nur für die Frage, ob er da ist */
function send(type, data = {}, timeout = 0) {
  return new Promise(async (resolve, reject) => {
    const reg = await sw?.getRegistration().catch(() => null);
    const worker = reg?.active;
    if (!worker) { resolve({ none: true }); return; }
    const ch = new MessageChannel();
    let timer = null;
    if (timeout) timer = setTimeout(() => resolve({ none: true }), timeout);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data?.ok) resolve({ r: e.data.r }); else reject(new Error(e.data?.err ?? t('sync.toast.failed')));
    };
    worker.postMessage({ type, lang: lang(), ...data }, [ch.port2]);
  });
}

let caps = null;
/** Gleicht der Service Worker ab? (Ein älterer ohne js/sw/sync.js antwortet nicht) → { folder, health } | null */
export function swSync() {
  caps ??= sw ? send('sync:caps', {}, 3000).then((x) => (x.none ? null : x.r)).catch(() => null) : Promise.resolve(null);
  return caps;
}

/** Auftrag an den Service Worker → Ergebnis; ohne ihn `undefined` */
export async function swCall(type, data = {}) {
  if (!await swSync()) return undefined;
  // Erst die Kopie der Einstellungen auf den Stand von hier (auch was an `local` vorbei geschrieben wurde)
  if (type !== 'sync:state') await localReady().catch(() => []);
  const x = await send(type, data);
  return x.none ? undefined : x.r;
}

function alive(on) {
  clearInterval(aliveTimer);
  aliveTimer = on ? setInterval(() => send('sync:alive').catch(() => {}), ALIVE_MS) : null;
}

// Nur einmal je Fenster: Wird die Datei ein zweites Mal ausgewertet (Testtreiber), bliebe es bei einer Ausführung je Auftrag
const first = !window.__wmapSwLink;
window.__wmapSwLink = true;
if (sw && first) {
  sw.addEventListener('message', (e) => {
    const d = e.data ?? {};
    const port = e.ports?.[0];
    if (d.type === 'tauri-here') port?.postMessage(!!window.__TAURI__?.core);
    else if (d.type === 'tauri') {
      Promise.resolve().then(() => window.__TAURI__.core.invoke(d.cmd, d.args))
        .then((data) => port?.postMessage({ ok: true, data }), (err) => port?.postMessage({ ok: false, err: String(err?.message ?? err) }));
    } else if (d.type === 'local') {
      if (takeShared(d.row)) dispatchEvent(new CustomEvent('wmap:local', { detail: { keys: [d.row.id] } }));
    } else if (d.type === 'event' && d.name) {
      const detail = d.detail && typeof d.detail === 'object' ? { ...d.detail, remote: true } : { remote: true };
      dispatchEvent(new CustomEvent(d.name, { detail }));
    } else if (d.type === 'busy') alive(!!d.on);
    else if (d.type === 'devlog') devLog('[Service Worker]', d.text);
  });
  // Nachrichten, die schon warten (Abgleich lief beim Seitenwechsel weiter), jetzt abholen
  sw.startMessages?.();
  // Arbeitet er gerade? Dann wach halten und den Stand zeigen
  swCall('sync:state').then((s) => {
    if (!s) return;
    if (s.busy || s.health) alive(true);
    if (s.busy) dispatchEvent(new CustomEvent('wmap:folder-progress', { detail: { busy: true, ...(s.progress ?? {}), remote: true } }));
  }).catch(() => {});
}

if (first) localReady().then((keys) => {
  if (keys.length) dispatchEvent(new CustomEvent('wmap:local', { detail: { keys } }));
}).catch(() => {});
