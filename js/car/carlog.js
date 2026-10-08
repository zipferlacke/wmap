/**
 * Fahrt-Protokoll für Android Auto – misst auf der Seite mit, wo es hängt, und meldet je Sekunde eine Zeile an
 * die App (WMapCar.log → tools/android/car/CarLog.kt, Datei unter Download/WMap/). Nur wenn das Protokoll in den
 * Einstellungen der App eingeschaltet ist (WMapCar.logging()); sonst tut das Modul nichts.
 *
 * Die Zeile „js“ (alles je Sekunde, Zeiten in ms):
 *   b       gezeichnete Kartenbilder (Soll: bis 20, core/fps.js)
 *   pause   längste Zeit zwischen zwei Bildern – groß heißt: Die Karte stand so lange
 *   lang    lange Aufgaben der Seite: Anzahl/Summe/längste (über 50 ms; sie halten alles andere auf)
 *   takt    größter Verzug eines 100-ms-Takts – so lange kam die Seite zu nichts
 *   fix     Standortmeldungen; weg: größte Zeit von der App bis in die Seite; alter: Alter der Messung, als sie
 *           hier ankam (GPS-Zeit → Seite)
 *   …=n/s/m eigene Messstellen (mark): Anzahl/Summe/längste – „fahrt“ (js/car/drive.js je Standort), „strasse“
 *           (Suche der Straße in den Kacheln), „hinweis“ (Abbiegehinweis ans Auto)
 *   nav, z (Zoom), n (Neigung), kacheln (alle geladen?), sichtbar, heap (MB)
 * Einmal am Anfang: Grafik (wer zeichnet – „SwiftShader“ hieße: ohne Grafikchip), Größe, Bildpunkte.
 */
import { map } from '../app/core.js';
import { nav } from '../app/nav.js';
import { fpsCap } from '../core/fps.js';

const bridge = window.WMapCar ?? null;
let on = false;
try { on = !!bridge?.logging?.(); } catch { on = false; }

const marks = new Map();   // Name → { n, sum, max }
/** Dauer einer Messstelle merken – steht in der nächsten Zeile */
export function mark(name, ms) {
  if (!on) return;
  const m = marks.get(name) ?? { n: 0, sum: 0, max: 0 };
  m.n += 1; m.sum += ms; m.max = Math.max(m.max, ms);
  marks.set(name, m);
}
export const carLogging = () => on;
/** Zeit messen: const done = timed('name'); …; done() */
export const timed = (name) => { if (!on) return () => {}; const t = performance.now(); return () => mark(name, performance.now() - t); };

if (on) {
  const say = (text) => { try { bridge.log(text); } catch { /* App weg */ } };
  const r = (x) => Math.round(x);

  // Wer zeichnet? (nach dem Start von car.js – erst dann steht die Bildrate fest)
  setTimeout(() => {
    try {
      const c = map.getCanvas();
      const gl = map.painter?.context?.gl ?? c.getContext('webgl2') ?? c.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      say(`anfang grafik="${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?'}" flaeche=${c.clientWidth}x${c.clientHeight} punkte=${c.width}x${c.height} dpr=${devicePixelRatio} bilder<=${fpsCap() ?? 'frei'} kerne=${navigator.hardwareConcurrency} seite=${location.origin}`);
    } catch (err) { say(`anfang grafik=? (${err.message})`); }
  });

  let frames = 0, gap = 0, lastFrame = 0;
  map.on('render', () => {
    const t = performance.now();
    frames += 1;
    if (lastFrame) gap = Math.max(gap, t - lastFrame);
    lastFrame = t;
  });

  const long = { n: 0, sum: 0, max: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { long.n += 1; long.sum += e.duration; long.max = Math.max(long.max, e.duration); }
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* kennt das WebView nicht */ }

  let beat = performance.now(), late = 0;
  setInterval(() => {
    const t = performance.now();
    late = Math.max(late, t - beat - 100);
    beat = t;
  }, 100);

  const fix = { n: 0, way: 0, age: 0 };
  navigator.geolocation?.watchPosition?.((pos) => {
    const now = Date.now();
    fix.n += 1;
    if (pos.timestamp) fix.age = Math.max(fix.age, now - pos.timestamp);
  }, () => {});

  setInterval(() => {
    const own = [...marks].map(([k, m]) => `${k}=${m.n}/${r(m.sum)}/${r(m.max)}`).join(' ');
    marks.clear();
    let tiles = '?';
    try { tiles = map.areTilesLoaded() ? 1 : 0; } catch { /* Karte noch nicht so weit */ }
    // Weg von der App bis in die Seite: misst index.html (__carFix), andere Schichten reichen `sent` nicht weiter
    fix.way = window.__carLag || 0;
    window.__carLag = 0;
    say(`b=${frames} pause=${r(gap)} lang=${long.n}/${r(long.sum)}/${r(long.max)} takt=${r(late)} fix=${fix.n} weg=${fix.way} alter=${fix.age} ${own}`
      + ` nav=${nav.active ? 1 : 0} z=${map.getZoom().toFixed(1)} n=${r(map.getPitch())} kacheln=${tiles}`
      + ` sichtbar=${document.visibilityState === 'visible' ? 1 : 0} heap=${performance.memory ? r(performance.memory.usedJSHeapSize / 1048576) : '?'}`);
    frames = 0; gap = 0; late = 0;
    long.n = 0; long.sum = 0; long.max = 0;
    fix.n = 0; fix.way = 0; fix.age = 0;
  }, 1000);

  addEventListener('error', (e) => say(`FEHLER ${e.message} ${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => say(`FEHLER (Promise) ${String(e.reason?.message ?? e.reason).slice(0, 200)}`));
  map.on('webglcontextlost', () => say('Grafik verloren (webglcontextlost)'));
  map.on('webglcontextrestored', () => say('Grafik wieder da'));
}
