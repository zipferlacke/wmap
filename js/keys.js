/**
 * Mit der Tastatur durch die Karte – vor allem, um sich in 3D umzusehen.
 *
 *   W / S         vor / zurück (in Blickrichtung)
 *   A / D         nach links / rechts
 *   Q / E         nach links / rechts drehen
 *   R / F         nach oben / unten schauen (Neigung)
 *   Leertaste     höher (herauszoomen)
 *   Shift         tiefer (hineinzoomen)
 *   Esc           zurück zur normalen Ansicht: flach, Norden oben
 *                 (in der Navigation: zurück zum eigenen Standort)
 *
 * Gedacht zum Ausbauen: später schaut die Maus, wohin man läuft.
 */
const MOVE_KEYS = new Set(['w', 's', 'a', 'd', 'q', 'e', 'r', 'f', ' ', 'shift']);

/** Tippt man gerade irgendwo, gehört die Taste dem Feld. */
function typing(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Offene Liste, Menü oder Dialog: Esc schließt erst das. */
const somethingOpen = () => !!document.querySelector(
  'dialog[open]:modal, #suggest:not([hidden]), .appnav-menu:not([hidden]), .maplibregl-popup');

/**
 * @param map
 * @param opts.onManual   die Karte wurde von Hand bewegt (Navigation hört dann auf zu folgen)
 * @param opts.onEscape   Esc ohne offene Liste – liefert true, wenn schon erledigt
 */
export function keyboardControl(map, { onManual, onEscape } = {}) {
  const down = new Set();
  let raf = null;
  let since = 0;

  const frame = (t) => {
    if (!down.size) { raf = null; return; }
    since ||= t;
    // Wer die Taste hält, wird schneller – bis zum Dreifachen nach 1,5 s
    const boost = 1 + Math.min(2, (t - since) / 750);
    const v = 7 * boost;
    let dx = 0, dy = 0;
    if (down.has('w')) dy -= v;
    if (down.has('s')) dy += v;
    if (down.has('a')) dx -= v;
    if (down.has('d')) dx += v;
    if (dx || dy) map.panBy([dx, dy], { duration: 0 });

    const cam = {};
    if (down.has('q')) cam.bearing = map.getBearing() - 1.1;
    if (down.has('e')) cam.bearing = map.getBearing() + 1.1;
    if (down.has('r')) cam.pitch = Math.min(map.getMaxPitch(), map.getPitch() + 0.7);
    if (down.has('f')) cam.pitch = Math.max(0, map.getPitch() - 0.7);
    if (down.has(' ')) cam.zoom = map.getZoom() - 0.025 * boost;
    if (down.has('shift')) cam.zoom = map.getZoom() + 0.025 * boost;
    if (Object.keys(cam).length) map.jumpTo(cam);

    raf = requestAnimationFrame(frame);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
    if (k === 'escape') {
      if (somethingOpen()) return;
      if (onEscape?.()) return;
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }
    if (!MOVE_KEYS.has(k)) return;
    // Auf einem Knopf löst die Leertaste weiterhin den Knopf aus
    if (k === ' ' && e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return;
    // Leertaste würde sonst scrollen oder den fokussierten Knopf auslösen
    e.preventDefault();
    if (!down.size) { since = 0; onManual?.(); }
    down.add(k);
    raf ??= requestAnimationFrame(frame);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.key === ' ' ? ' ' : e.key.toLowerCase());
  });
  // Fenster verliert den Fokus: nichts soll weiterlaufen
  window.addEventListener('blur', () => down.clear());
}
