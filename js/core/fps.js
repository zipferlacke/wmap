/**
 * Bildrate der Seite begrenzen. MapLibre zeichnet bei jeder laufenden
 * Kamerafahrt mit jedem Bild des Bildschirms – auf dem Autobildschirm (Android
 * Auto) waren das bei freier Fahrt gut 40 Kartenbilder je Sekunde zu je
 * 15–19 ms: 64–80 % der Rechenzeit (am Pixel 9 gemessen). Die Seite im Auto
 * und die App teilen sich im WebView einen Rechen-Thread; navigierten beide,
 * blieb für jede kaum etwas, das Handy wurde heiß und drosselte – die Karte im
 * Auto hing dann weit hinter dem Standort her und reagierte verzögert.
 *
 *   capFps(20)    höchstens 20 Bilder je Sekunde
 *   capFps(null)  wieder so oft, wie der Bildschirm kann
 *
 * Alle requestAnimationFrame-Aufrufe eines Zeitfensters laufen gemeinsam im
 * nächsten erlaubten Bild – für die Karte, die Navigation und alles andere.
 */
const raf = window.requestAnimationFrame.bind(window);
const caf = window.cancelAnimationFrame.bind(window);

let slot = 0;             // ms je Bild; 0: unbegrenzt
let queue = new Map();
let nextId = 1e9;         // eigene Kennungen, weit weg von denen des Browsers
let timer = null;
let lastRun = 0;

function flush(t) {
  timer = null;
  lastRun = performance.now();
  const q = queue;
  queue = new Map();
  for (const cb of q.values()) {
    try { cb(t); } catch (err) { setTimeout(() => { throw err; }); }
  }
}

window.requestAnimationFrame = (cb) => {
  if (!slot) return raf(cb);
  nextId += 1;
  queue.set(nextId, cb);
  // 4 ms Luft: der Timer weckt, das nächste Bild des Bildschirms führt aus
  if (timer === null) timer = setTimeout(() => raf(flush), Math.max(0, lastRun + slot - performance.now() - 4));
  return nextId;
};
window.cancelAnimationFrame = (id) => { if (!queue.delete(id)) caf(id); };

export function capFps(fps) { slot = fps ? 1000 / fps : 0; }
export const fpsCap = () => (slot ? Math.round(1000 / slot) : null);
