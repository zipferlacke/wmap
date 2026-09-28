/**
 * Mit Tastatur und Maus durch die Karte – vor allem, um sich in 3D umzusehen.
 *
 * Immer (Karte hat den Fokus, kein Eingabefeld):
 *   W / S         vor / zurück (in Blickrichtung)
 *   A / D         nach links / rechts
 *   Q / E         nach links / rechts drehen
 *   R / F         nach oben / unten schauen (Neigung)
 *   Leertaste     höher (herauszoomen)
 *   Shift         tiefer (hineinzoomen)
 *   Esc           zurück zur normalen Ansicht: flach, Norden oben
 *                 (in der Navigation: zurück zum eigenen Standort)
 *
 * Fliegen (Menü → Fliegen, ?action=fly): die Maus schaut – gleichzeitig mit
 * den Tasten. Mit gesperrtem Zeiger (Klick in die Karte) dreht Maus nach
 * links/rechts die Blickrichtung und neigt nach oben/unten; ohne Sperre
 * dreht sich die Bildmitte langsam zum Zeiger hin (in der Mitte ruht sie).
 * Wohin die Bildmitte zeigt, ist vorn: W fliegt genau dorthin – schaut man
 * steil nach unten, geht es abwärts, schaut man zum Horizont, geradeaus.
 * Maus und Tasten laufen in einer Schleife und ergeben zusammen ein Bild.
 * Esc beendet das Fliegen.
 *
 * Tempo: langsam los, wer die Taste hält, wird schneller (bis zum Sechsfachen
 * nach 2,5 s).
 */
import { destination } from '../core/geo.js';

const MOVE_KEYS = new Set(['w', 's', 'a', 'd', 'q', 'e', 'r', 'f', ' ', 'shift']);

/** Tippt man gerade irgendwo, gehört die Taste dem Feld. */
function typing(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Offene Liste, Menü oder Dialog: Esc schließt erst das. */
const somethingOpen = () => !!document.querySelector(
  'dialog[open]:modal, #suggest:not([hidden]), .appnav-menu:not([hidden]), .maplibregl-popup');

const BASE_PX = 3.2;                  // Schritt je Bild am Anfang
const MAX_BOOST = 6;
const RAMP_MS = 2500;
const LOOK = 0.12;                    // Grad je Pixel Mausbewegung
const STEER = { bearing: 70, pitch: 40, dead: 0.12 };   // ohne Zeigersperre: Grad/s am Rand, Ruhezone in der Mitte
const RAD = Math.PI / 180;

/**
 * @param map
 * @param opts.onManual   die Karte wurde von Hand bewegt (Navigation hört dann auf zu folgen)
 * @param opts.onEscape   Esc ohne offene Liste – liefert true, wenn schon erledigt
 * → { fly: { start(), stop(), active } }
 */
export function keyboardControl(map, { onManual, onEscape } = {}) {
  const down = new Set();
  let raf = null;
  let since = 0;
  let flying = false;
  let hud = null;

  const frame = (t) => {
    if (!down.size || flying) { raf = null; return; }
    since ||= t;
    // Langsam los, dann schneller – sanft ansteigend
    const k = Math.min(1, (t - since) / RAMP_MS);
    const boost = 1 + (MAX_BOOST - 1) * k * k;
    const v = BASE_PX * boost;
    const pitch = map.getPitch() * Math.PI / 180;
    let dx = 0, dy = 0, dz = 0;
    const fwd = (down.has('w') ? 1 : 0) - (down.has('s') ? 1 : 0);
    if (fwd) {
      if (flying) {
        // In Richtung Bildmitte: waagerecht der Anteil zum Horizont, senkrecht der nach unten
        dy -= fwd * v * Math.max(0.15, Math.sin(pitch));
        dz += fwd * 0.012 * boost * Math.cos(pitch);
      } else dy -= fwd * v * 2;
    }
    if (down.has('a')) dx -= v * (flying ? 1 : 2);
    if (down.has('d')) dx += v * (flying ? 1 : 2);
    if (dx || dy) map.panBy([dx, dy], { duration: 0 });

    const cam = {};
    if (down.has('q')) cam.bearing = map.getBearing() - 0.5 * Math.min(boost, 3);
    if (down.has('e')) cam.bearing = map.getBearing() + 0.5 * Math.min(boost, 3);
    if (down.has('r')) cam.pitch = Math.min(map.getMaxPitch(), map.getPitch() + 0.5);
    if (down.has('f')) cam.pitch = Math.max(0, map.getPitch() - 0.5);
    if (down.has(' ')) dz -= 0.012 * boost;
    if (down.has('shift')) dz += 0.012 * boost;
    if (dz) cam.zoom = Math.min(19.5, Math.max(2, map.getZoom() + dz));
    if (Object.keys(cam).length) map.jumpTo(cam);

    raf = requestAnimationFrame(frame);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
    if (k === 'escape') {
      if (flying) { fly.stop(); return; }
      if (somethingOpen()) return;
      if (onEscape?.()) return;
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }
    if (!MOVE_KEYS.has(k)) return;
    // Auf einem Knopf löst die Leertaste weiterhin den Knopf aus
    if (k === ' ' && !flying && e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return;
    // Leertaste würde sonst scrollen oder den fokussierten Knopf auslösen
    e.preventDefault();
    if (!down.size) { since = 0; onManual?.(); }
    down.add(k);
    if (!flying) raf ??= requestAnimationFrame(frame);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.key === ' ' ? ' ' : e.key.toLowerCase());
  });
  // Fenster verliert den Fokus: nichts soll weiterlaufen
  window.addEventListener('blur', () => down.clear());

  /* ── Fliegen: die Maus schaut ───────────────────────────────────────────── */

  const canvas = map.getCanvas();
  const locked = () => document.pointerLockElement === canvas;
  let look = { dx: 0, dy: 0 };          // gesammelte Mausbewegung (Zeiger gesperrt)
  let pointer = null;                   // Zeiger über der Karte (ohne Sperre): [x, y]
  let flyRaf = null;
  let last = 0;

  document.addEventListener('mousemove', (e) => {
    if (!flying) return;
    if (locked()) { look.dx += e.movementX; look.dy += e.movementY; return; }
    const r = canvas.getBoundingClientRect();
    pointer = e.target === canvas ? [(e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1] : null;
  });
  canvas.addEventListener('mouseleave', () => { pointer = null; });

  /** Ruhezone in der Mitte, dann gleichmäßig bis zum Rand */
  const steer = (x) => (Math.abs(x) < STEER.dead ? 0 : Math.sign(x) * (Math.abs(x) - STEER.dead) / (1 - STEER.dead));

  /** Ein Bild im Flug: Blick (Maus) und Bewegung (Tasten) zusammen, ein einziges jumpTo */
  const flyFrame = (t) => {
    if (!flying) { flyRaf = null; return; }
    flyRaf = requestAnimationFrame(flyFrame);
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    let bearing = map.getBearing();
    let pitch = map.getPitch();
    // Blick
    if (locked()) {
      bearing += look.dx * LOOK;
      pitch -= look.dy * LOOK;
    } else if (pointer) {
      bearing += steer(pointer[0]) * STEER.bearing * dt;
      pitch -= steer(pointer[1]) * STEER.pitch * dt;
    }
    look = { dx: 0, dy: 0 };
    if (down.has('q')) bearing -= 45 * dt;
    if (down.has('e')) bearing += 45 * dt;
    if (down.has('r')) pitch += 30 * dt;
    if (down.has('f')) pitch -= 30 * dt;
    pitch = Math.max(0, Math.min(map.getMaxPitch(), pitch));

    // Bewegung: Tempo in Pixeln je Sekunde, umgerechnet in Meter auf dieser Höhe
    const moving = ['w', 's', 'a', 'd', ' ', 'shift'].some((k) => down.has(k));
    if (!moving) since = 0;
    since ||= t;
    const k = Math.min(1, (t - since) / RAMP_MS);
    const boost = 1 + (MAX_BOOST - 1) * k * k;
    let center = map.getCenter().toArray();
    let zoom = map.getZoom();
    const mpp = (40075016 * Math.cos(center[1] * RAD)) / (512 * 2 ** zoom);
    const v = BASE_PX * 60 * boost * mpp * dt;           // Meter in diesem Bild
    const fwd = (down.has('w') ? 1 : 0) - (down.has('s') ? 1 : 0);
    const side = (down.has('d') ? 1 : 0) - (down.has('a') ? 1 : 0);
    // Zur Bildmitte: waagerecht der Anteil zum Horizont, senkrecht der nach unten
    if (fwd) center = destination(center, bearing, fwd * v * Math.max(0.15, Math.sin(pitch * RAD)));
    if (side) center = destination(center, bearing + 90, side * v);
    let dz = fwd * 0.72 * boost * Math.cos(pitch * RAD);
    if (down.has(' ')) dz -= 0.72 * boost;
    if (down.has('shift')) dz += 0.72 * boost;
    zoom = Math.min(19.5, Math.max(2, zoom + dz * dt));

    if (bearing !== map.getBearing() || pitch !== map.getPitch() || fwd || side || dz) {
      map.jumpTo({ center, bearing, pitch, zoom });
    }
  };

  function lock() {
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ohne Sperre: Zeiger lenkt */ }
  }
  function paintHud() {
    if (!hud) return;
    hud.innerHTML = locked()
      ? '<span class="msr">flight</span> <b>Maus</b> umsehen · <b>W/S</b> vor/zurück · <b>A/D</b> seitlich · <b>Leertaste/Shift</b> hoch/runter · <b>Esc</b> beenden'
      : '<span class="msr">mouse</span> Zeiger zum Rand lenkt den Blick · <b>Klick</b> in die Karte: Maus schaut frei · <b>W/S/A/D</b> fliegen · <b>Esc</b> beenden';
  }
  document.addEventListener('pointerlockchange', () => {
    // Esc gibt die Maus frei – dann ist das Fliegen zu Ende
    if (flying && !locked() && hud?.dataset.wasLocked) fly.stop();
    if (locked() && hud) hud.dataset.wasLocked = '1';
    paintHud();
  });
  canvas.addEventListener('click', () => { if (flying && !locked()) lock(); });

  const fly = {
    get active() { return flying; },
    start() {
      if (flying) return;
      flying = true;
      onManual?.();
      document.body.classList.add('flying');
      hud = Object.assign(document.createElement('div'), { className: 'fly-hud', role: 'status' });
      document.body.append(hud);
      paintHud();
      // Aus der Übersicht in Augenhöhe: geneigt, nah genug für Gelände und Häuser
      if (map.getPitch() < 45 || map.getZoom() < 13) {
        map.easeTo({ pitch: Math.max(map.getPitch(), 65), zoom: Math.max(map.getZoom(), 14.5), duration: 900 });
      }
      lock();
      document.activeElement?.blur?.();       // Tasten gehören jetzt dem Flug, nicht einem Feld
      last = 0;
      flyRaf ??= requestAnimationFrame(flyFrame);
    },
    stop() {
      if (!flying) return;
      flying = false;
      down.clear();
      pointer = null;
      document.body.classList.remove('flying');
      if (locked()) document.exitPointerLock?.();
      hud?.remove();
      hud = null;
    },
  };
  return { fly };
}
