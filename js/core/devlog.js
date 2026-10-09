/**
 * Mitschreiben für die Fehlersuche – nur in der Debug-Fassung der App (sie lädt die Seite von localhost und
 * hat das Log-Plugin, src-tauri/capabilities/debug-log.json). Die Zeilen landen in der Ausgabe von
 * `cargo tauri dev` und in ~/.local/share/de.wuefl.wmap/logs/WMap.log. Überall sonst: nur die Konsole.
 */
const core = window.__TAURI__?.core;
const dev = !!core && ['localhost', '127.0.0.1'].includes(location.hostname);
const t0 = performance.now();

export function devLog(...parts) {
  const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.info('[WMap]', text);
  if (!dev) return;
  const line = `[${((performance.now() - t0) / 1000).toFixed(1)} s ${location.pathname.split('/').pop() || 'index.html'}] ${text}`;
  // level 3 = Info (tauri-plugin-log)
  core.invoke('plugin:log|log', { level: 3, message: line }).catch((err) => {
    if (!failed) { failed = true; beacon(`Log-Plugin geht nicht: ${err}`); }
  });
  beacon(line);
}

// Zweiter Weg, falls das Log-Plugin nicht darf: eine Abfrage an den lokalen Entwicklungsserver – die Zeile steht
// dann in dessen Zugriffsprotokoll (docker logs php). „/bEnd/“ fasst der Service Worker nicht an.
let failed = false;
function beacon(line) {
  fetch(`./bEnd/devlog?m=${encodeURIComponent(line.slice(0, 1500))}`, { cache: 'no-store' }).catch(() => {});
}

if (dev) {
  addEventListener('error', (e) => devLog('FEHLER', e.message, `${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => devLog('FEHLER (Promise)', String(e.reason?.message ?? e.reason)));
}
