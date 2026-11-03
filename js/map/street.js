/**
 * Street View: als Mensch auf der Straße stehen und umhergehen – Kamera auf Augenhöhe (1,7 m über dem Gelände),
 * der Boden als Modell aus den Kartendaten (map/street-look.js: Straßen in echter Breite, Gehwege, Rasen), Häuser mit
 * Fenstern (map/buildings.js).
 *
 *   Rechner   Klick ins Bild fängt die Maus: sie dreht den Blick, gleichzeitig gehen
 *             W / S (↑ / ↓)   vor / zurück          A / D        seitwärts
 *             Q / E (← / →)   drehen                R / F        nach oben / unten schauen
 *             Shift           laufen                Mausrad      vor / zurück
 *             Esc gibt die Maus frei, ein zweites Esc beendet
 *   Handy     Ein Finger dreht den Blick (seitwärts doppelt so weit wie der Finger); Zoomgeste: vor / zurück
 *   Geschäfte farbiges Erdgeschoss, Name an der Fassade; hinschauen öffnet unten ihren Dialog (map/street-shops.js);
 *             Bushaltestellen als Wartehäuschen
 *   Oben      wo man ist: die Haltestelle (bis 15 m) oder die Straße bzw. der Platz – Beschriftungen der Karte sind aus (MapLibre
 *             zeichnet sie durch Hauswände); Häuser nur im Umkreis von 250 m (map/buildings.js setFocus)
 *   Beide     Nicht in Häuser: vor der Wand stehen bleiben oder an ihr entlang; doppelt tippen: dorthin gehen; „Teilen“: Link auf genau diese Ansicht; Esc oder „Karte“ beendet
 *
 * Die Kamera steht fest auf ihrem Punkt; MapLibre bekommt Mitte, Zoom und Neigung aus Kamera-Ort, Höhe und
 * Blickrichtung (`camera`, gerechnet wie `calculateCameraOptionsFromCameraLngLatAltRotation`, die Mitte aber auf dem
 * Boden unter einem). Dafür darf die Mitte nicht am Boden kleben
 * (`centerClampedToGround`), sonst hebt MapLibre die Kamera an. Ab 80° Blick (und nach oben, bis 150° = 60° in den
 * Himmel) liegt die Mitte 10 m vor einem in der Luft – auf dem Boden läge sie sonst immer weiter weg, und die Karte
 * nähme die Zoomstufe der Übersicht (breite Straßen, grobe Kacheln). Blickwinkel 60° statt 37°.
 */
import { destination } from '../core/geo.js';
import { modelLook } from './street-look.js';
import { streetShops } from './street-shops.js';
import { t } from '../core/i18n.js';

const EYE = 1.7;                        // Augenhöhe (m)
const FOV = 60;                         // Blickwinkel senkrecht (Grad)
const LOOK = { min: 55, max: 150, start: 82 };        // 90 = Horizont, 150 = 60° in den Himmel
const WALK = 1.6, RUN = 6;              // m/s
const TURN = 70;                        // Grad/s mit Q/E
const MOUSE = 0.15;                     // Grad je Pixel Mausbewegung (gefangene Maus)
const PINCH = 14;                       // m je Verdopplung des Fingerabstands
const SWIPE = 2;                        // Handy: so viel weiter dreht ein Wisch als die Welt am Finger
const RAD = Math.PI / 180;
const HANDLERS = ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'keyboard', 'boxZoom'];

/**
 * @param map
 * @param opts.base     () → Grundkarte jetzt ('map' | 'sat')
 * @param opts.setBase  (base, { save }) Grundkarte setzen
 * @param opts.onShare  ({ point, bearing, look }) Ansicht teilen – ohne: kein Knopf
 * @param opts.poi      { open(Kachel-Objekt), close(), isOpen() } – Dialog eines Geschäfts (map/street-shops.js)
 * → { start(point? | { point, bearing, look }), stop(), active, where }
 */
export function streetView(map, { base = () => 'map', setBase = () => {}, onShare = null, poi = null } = {}) {
  let on = false;
  let pos = null, bearing = 0, look = LOOK.start, ground = null;
  let before = null;                    // was beim Beenden wiederkommt
  let hud = null, raf = null, last = 0;
  const down = new Set();
  let glide = null;                     // Doppeltipp: { to, left } – geht von selbst dorthin
  let push = 0;                         // Mausrad / Finger: noch zu gehende Meter
  let shown = [];                       // zuletzt gezeigt: Ort, Richtung, Blick (die Maus dreht zwischen den Bildern)
  let shops = null;                     // Geschäfte und Haltestellen (map/street-shops.js)
  let hidAt = 0;                        // zuletzt nach neuen Symbol-Ebenen gesehen
  const focus = { point: null, radius: 250 };   // Häuser nur im Umkreis (map/buildings.js setFocus)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /*
   * Nicht in Häuser gehen: der Schritt (mit 40 cm Abstand zur Wand) endet in einem Haus → nur den Teil entlang
   * der Wand gehen (Nord/Süd oder Ost/West), sonst stehen bleiben. Wer schon drin steht (geteilter Punkt), kommt
   * heraus. → ob es weiterging
   */
  const BODY = 0.4;
  const inHouse = (p) => !!map.wmapBuildings?.inside?.(p);
  function step(dir, m) {
    if (!m) return false;
    const to = destination(pos, dir, m);
    const probe = destination(pos, dir, m + Math.sign(m) * BODY);
    if (!inHouse(probe) || inHouse(pos)) { pos = to; return true; }
    // An der Wand entlang: die beiden Anteile einzeln
    for (const part of [[to[0], pos[1]], [pos[0], to[1]]]) {
      const ahead = [pos[0] + (part[0] - pos[0]) * (1 + BODY / Math.abs(m)), pos[1] + (part[1] - pos[1]) * (1 + BODY / Math.abs(m))];
      if ((part[0] !== pos[0] || part[1] !== pos[1]) && !inHouse(ahead)) { pos = part; return true; }
    }
    return false;
  }

  /*
   * Mitte, Zoom und Höhe der Mitte aus Kamera-Ort, Augenhöhe und Blick – wie MapLibres
   * calculateCameraOptionsFromCameraLngLatAltRotation, aber die Mitte liegt auf dem Boden unter einem. MapLibre nimmt
   * die Höhe der bisherigen Mitte: war die einmal 0 (gleich nach dem Einschalten des Geländes), schaute die Kamera
   * auf Meereshöhe, die Mitte lag Kilometer weit weg (Zoom 14, Streifen am Boden) und blieb dort.
   */
  function camera(g) {
    // Genau 90°: Kamera und Mitte gleich hoch – MapLibre rechnet dann für die Kachel unter einem atan(0/0) (NaN)
    const tilt = Math.abs(look - 90) < 0.05 ? 90.05 : look;
    const pitch = tilt * RAD, dir = bearing * RAD;
    // Mitte am Boden in Blickrichtung – flacher als 80° (und nach oben) 10 m vor einem in der Luft
    const along = look < 80 ? EYE / Math.cos(pitch) : 10;
    const from = maplibregl.MercatorCoordinate.fromLngLat(pos, g + EYE);
    const dx = Math.sin(pitch) * Math.sin(dir), dy = -Math.sin(pitch) * Math.cos(dir);
    let k = along * from.meterInMercatorCoordinateUnits(), at = from;
    for (let i = 0; i < 5; i += 1) {
      at = new maplibregl.MercatorCoordinate(from.x + dx * k, from.y + dy * k);
      k = along * at.meterInMercatorCoordinateUnits();
    }
    const tr = map._camera?.transform ?? map.transform;
    const zoom = Math.log2(tr.height / 2 / Math.tan((FOV * RAD) / 2) / k / (tr.tileSize ?? 512));
    return { center: at.toLngLat(), zoom, elevation: g + EYE - along * Math.cos(pitch), bearing, pitch: tilt };
  }

  /*
   * MapLibre sucht die Kacheln vom Punkt unter der Kamera aus: getCameraPoint am Bildschirm, zurück auf den Boden.
   * Ab 90° Neigung liegt der unendlich weit oben – heraus kam immer der Ort beim Start, nach 100–200 m Weg dann
   * NaN: Es teilte Kacheln bis Zoom 26, warf und lud nichts mehr (leere Karte, keine Häuser). Hier ist der Ort
   * bekannt: unter pos. → zurücksetzen
   */
  function fixCameraPoint() {
    const tr = map._camera?.transform ?? map.transform, own = tr.screenPointToMercatorCoordinate;
    tr.screenPointToMercatorCoordinate = function (p, terrain) {
      const cp = this.getCameraPoint();
      if (pos && p.x === cp.x && p.y === cp.y) return maplibregl.MercatorCoordinate.fromLngLat(pos);
      return own.call(this, p, terrain);
    };
    return () => { tr.screenPointToMercatorCoordinate = own; };
  }

  /** Kamera auf den Punkt setzen – Höhe weich nachgeführt, damit Kanten im Gelände nicht ruckeln */
  function place(dt = 0) {
    const g = map.queryTerrainElevation(pos) ?? ground ?? 0;
    ground = ground == null || !dt ? g : ground + (g - ground) * Math.min(1, dt * 8);
    map.jumpTo(camera(ground));
    shown = [pos[0], pos[1], bearing, look];
  }

  const frame = (stamp) => {
    if (!on) { raf = null; return; }
    raf = requestAnimationFrame(frame);
    // Langsame Bilder (schwaches Handy): die Zeit trotzdem ganz nehmen, nur nach langer Pause nicht springen
    const dt = last ? Math.min(0.25, (stamp - last) / 1000) : 1 / 60;
    last = stamp;
    const speed = down.has('shift') ? RUN : WALK;
    const fwd = (down.has('w') || down.has('arrowup') ? 1 : 0) - (down.has('s') || down.has('arrowdown') ? 1 : 0);
    const side = (down.has('d') ? 1 : 0) - (down.has('a') ? 1 : 0);
    const turn = (down.has('e') || down.has('arrowright') ? 1 : 0) - (down.has('q') || down.has('arrowleft') ? 1 : 0);
    const tilt = (down.has('r') ? 1 : 0) - (down.has('f') ? 1 : 0);
    if (turn) bearing += turn * TURN * dt;
    if (tilt) look = clamp(look + tilt * 40 * dt, LOOK.min, LOOK.max);
    if (fwd || side) glide = null;
    if (fwd) step(bearing, fwd * speed * dt);
    if (side) step(bearing + 90, side * speed * dt);
    // Mausrad und Finger: die Meter gleiten aus statt zu springen
    if (Math.abs(push) > 0.01) {
      const m = push * Math.min(1, dt * 6);
      push = step(bearing, m) ? push - m : 0;           // an der Wand: Rest verfällt
      glide = null;
    }
    if (glide) {
      const m = Math.min(glide.left, RUN * dt);
      glide.left -= m;
      if (!step(glide.dir, m) || glide.left <= 0.05) glide = null;
    }
    const moved = shown[0] !== pos[0] || shown[1] !== pos[1] || shown[2] !== bearing || shown[3] !== look;
    // Auch im Stand: kommt feineres Gelände nach, rückt die Kamera auf die richtige Höhe
    // (im Stand nur alle 0,5 s – queryTerrainElevation ist teuer)
    if (moved || stamp - groundAt > 500) {
      groundAt = stamp;
      const g = map.queryTerrainElevation(pos) ?? ground;
      if (moved || Math.abs(g - ground) > 0.02) place(dt);
    }
    if (moved || !told) paintTop(stamp);
    // Später dazugekommene Symbole (Ampeln, Treffer …) auch aus – sie stünden quer durchs Bild; einmal je Sekunde
    if (stamp - hidAt > 1000) {
      hidAt = stamp;
      for (const l of map.getStyle().layers) {
        if (l.type !== 'symbol' || before.symbols.includes(l.id) || map.getLayoutProperty(l.id, 'visibility') === 'none') continue;
        before.symbols.push(l.id);
        map.setLayoutProperty(l.id, 'visibility', 'none');
      }
    }
    focus.point = pos;
    shops?.frame({ pos, bearing, look, eye: (ground ?? 0) + EYE, ground: ground ?? 0, fov: FOV }, stamp);
  };

  /* ── Tasten ─────────────────────────────────────────────────────────────── */

  const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  const typing = (e) => e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  function keydown(e) {
    if (!on || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (document.querySelector('dialog[open]:modal')) return;
      e.preventDefault(); e.stopImmediatePropagation(); api.stop(); return;
    }
    if (!KEYS.has(k)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    down.add(k);
  }
  const keyup = (e) => down.delete(e.key.toLowerCase());
  const blur = () => down.clear();

  /* ── Maus und Finger ────────────────────────────────────────────────────── */

  const canvas = map.getCanvasContainer();
  const pointers = new Map();           // id → [x, y]
  let pinch = null;                     // Abstand der zwei Finger beim letzten Schritt
  let lastTap = 0;
  let downAt = null;

  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };

  /* Maus: ein Klick fängt sie (Pointer Lock) – dann dreht jede Bewegung den Blick, ohne Ziehen, und die Tasten
     gehen gleichzeitig. Esc gibt sie frei (das macht der Browser selbst). */
  const locked = () => document.pointerLockElement === canvas;
  function lock() {
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ohne Fang: Ziehen dreht weiter */ }
  }
  function mousemove(e) {
    if (!on || !locked()) return;
    bearing += e.movementX * MOUSE;
    look = clamp(look - e.movementY * MOUSE, LOOK.min, LOOK.max);
  }
  function lockchange() {
    document.body.classList.toggle('street-locked', on && locked());
    if (hud) paintHint();
  }
  function dblclick(e) {
    // Gefangene Maus: hingehen, wohin die Bildmitte zeigt
    if (!on || !locked()) return;
    const r = map.getCanvas().getBoundingClientRect();
    walkTo({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 + 0.25 * r.height });
  }

  function pointerdown(e) {
    if (!on || e.button > 0) return;
    if (e.pointerType === 'mouse' && !locked()) lock();
    if (e.pointerType === 'mouse' && locked()) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* ohne Fang: Finger, die die Karte verlassen, enden dort */ }
    if (pointers.size === 2) pinch = spread();
    // Zeit des Tippens selbst (timeStamp), nicht der Bearbeitung – ein beschäftigtes Handy bearbeitet später
    if (pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }
  function pointermove(e) {
    if (!on || !pointers.has(e.pointerId)) return;
    const [px, py] = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      // Ziehen: ein Wisch über die ganze Breite dreht doppelt so weit, wie das Bild breit ist (SWIPE) – die Welt
      // genau am Finger war zu träge; auf und ab bleibt sie am Finger
      const r = map.getCanvas().getBoundingClientRect();
      const across = (2 * Math.atan(Math.tan((FOV / 2) * RAD) * (r.width / r.height))) / RAD;
      bearing -= (e.clientX - px) * (across / r.width) * SWIPE;
      look = clamp(look + (e.clientY - py) * (FOV / r.height), LOOK.min, LOOK.max);
      place();
    } else if (pointers.size === 2 && pinch) {
      // Auseinander: vor, zusammen: zurück
      const d = spread();
      if (d > 0 && pinch > 0) push += Math.log2(d / pinch) * PINCH;
      pinch = d;
    }
  }
  function pointerup(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    // Doppelt tippen (ohne Ziehen): dorthin gehen
    if (downAt && pointers.size === 0 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && e.timeStamp - downAt.t < 300) {
      const now = e.timeStamp;
      if (now - lastTap < 350) { walkTo(e); lastTap = 0; } else lastTap = now;
    }
    downAt = null;
  }
  function wheel(e) {
    if (!on) return;
    e.preventDefault();
    push += clamp(-e.deltaY / 100, -1, 1) * 3;
  }
  /*
   * Wohin der Tipp auf dem Boden zeigt – selbst gerechnet aus Blick, Blickwinkel und Augenhöhe (Boden eben
   * angenommen). `map.unproject` liefert so nah am Boden Punkte Hunderte Meter daneben.
   */
  function walkTo(e) {
    const r = map.getCanvas().getBoundingClientRect();
    const half = Math.tan((FOV / 2) * RAD) / (r.height / 2);
    const below = (90 - look) * RAD + Math.atan((e.clientY - r.top - r.height / 2) * half);
    if (below < 0.3 * RAD) return;                     // über dem Horizont
    const side = Math.atan((e.clientX - r.left - r.width / 2) * half * Math.cos(below));
    const dist = EYE / Math.tan(below);
    if (dist > 300) return;
    // Nicht bis an die Wand: 1,5 m davor stehen bleiben
    glide = { dir: bearing + side / RAD, left: Math.max(0, dist - 1.5) };
  }

  /* ── Oben: wo man steht und was vor einem liegt ─────────────────────────── */

  /*
   * Beschriftungen und Symbole der Karte sind in Street View aus – MapLibre zeichnet sie über alles, auch durch
   * Hauswände. Statt dessen oben halbdurchsichtig: die Straße, auf der man steht (nächste mit Namen, bis 30 m), und
   * die nächsten Geschäfte in Blickrichtung (bis 60 m, ±35°).
   */
  /**
   * Liegt der Punkt in einem Haus (ein Geschäft aus „Umsehen“), auf den nächsten Weg bzw. die nächste Straße davor
   * (bis 80 m, Stellen außerhalb von Häusern) – mit Blick auf den Punkt. → { point, bearing } oder null
   */
  function toStreet(p) {
    // Grundrisse bis 100 m aus den Kacheln – die 3D-Häuser sind beim Start evtl. noch nicht gebaut (2D-Karte)
    const rings = [];
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
      const g = f.geometry;
      for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) {
        const r = poly[0].map((q) => meters(p, q));
        if (r.some(([x, y]) => Math.abs(x) < 100 && Math.abs(y) < 100)) rings.push(r);
      }
    }
    const inRing = ([x, y], r) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    const housed = (q) => inHouse(q) || rings.some((r) => inRing(meters(p, q), r));
    if (!housed(p)) return null;
    let best = null;
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
      const c = f.properties.class;
      if (['rail', 'transit', 'ferry', 'aerialway'].includes(c) || f.properties.brunnel === 'tunnel') continue;
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) {
        for (let i = 1; i < l.length; i += 1) {
          const [ax, ay] = meters(p, l[i - 1]), [bx, by] = meters(p, l[i]);
          const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
          const u = len ? clamp(-(ax * dx + ay * dy) / len, 0, 1) : 0;
          const d = Math.hypot(ax + u * dx, ay + u * dy);
          if (d > 80 || (best && d >= best.d)) continue;
          const q = [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * u, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * u];
          if (!housed(q)) best = { d, point: q };
        }
      }
    }
    if (!best) return null;
    const [x, y] = meters(best.point, p);
    return { point: best.point, bearing: Math.atan2(x, y) / RAD };
  }

  let groundAt = 0;
  let top = null, told = 0;
  const nameOf = (p) => p['name:de'] ?? p.name_de ?? p.name ?? '';
  function meters(a, b) {
    const k = 111320, kx = k * Math.cos(a[1] * RAD);
    return [(b[0] - a[0]) * kx, (b[1] - a[1]) * k];
  }
  function toSegment(p, a, b) {
    const [ax, ay] = meters(p, a), [bx, by] = meters(p, b);
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const u = l ? clamp(-(ax * dx + ay * dy) / l, 0, 1) : 0;
    return Math.hypot(ax + u * dx, ay + u * dy);
  }
  function paintTop(now) {
    if (!top || now - told < 500) return;
    told = now;
    let road = '', best = 30;
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' })) {
      const name = nameOf(f.properties);
      if (!name) continue;
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      for (const line of lines) {
        for (let i = 1; i < line.length; i += 1) {
          const d = toSegment(pos, line[i - 1], line[i]);
          if (d < best) { best = d; road = name; }
        }
      }
    }
    // Nur, wo man ist: an einer Haltestelle (bis 15 m) ihr Name, sonst die Straße bzw. der Platz
    const stop = shops?.stopAt(pos);
    const html = stop ? `<b>${t('street.stop', { name: esc(stop) })}</b>` : road ? `<b>${esc(road)}</b>` : `<b>${t('street.off_road')}</b>`;
    if (top.innerHTML !== html) top.innerHTML = html;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ── Hinweis unten ──────────────────────────────────────────────────────── */

  function paintHint() {
    const touch = matchMedia('(pointer: coarse)').matches;
    hud.querySelector('.street-hint').innerHTML = touch
      ? t('street.hint.touch')
      : locked()
        ? t('street.hint.locked')
        : t('street.hint.free');
  }
  function paintHud() {
    hud = Object.assign(document.createElement('div'), { className: 'street-hud', role: 'status' });
    hud.innerHTML = `
      <span class="msr">streetview</span>
      <span class="street-hint"></span>
      ${onShare ? `<button type="button" class="button" data-s="share" title="${t('street.share')}"><span class="msr">share</span></button>` : ''}
      <button type="button" class="button" data-s="close"><span class="msr">close</span> ${t('street.close')}</button>`;
    hud.querySelector('[data-s=close]').addEventListener('click', () => api.stop());
    hud.querySelector('[data-s=share]')?.addEventListener('click', () => onShare(api.where));
    paintHint();
    document.body.append(hud);
  }

  const api = {
    get active() { return on; },
    /** Wo man steht und wohin man schaut: { point, bearing, look } */
    get where() { return on ? { point: [...pos], bearing, look } : null; },
    /** Auf dem Punkt (sonst der Bildmitte) auf die Straße stellen, Blick wie die Karte gerade – oder genau wie
     *  geteilt ({ point, bearing, look }) */
    start(at = null) {
      if (on) return;
      const shared = at && !Array.isArray(at) ? at : null;
      const point = shared ? shared.point : at;
      on = true;
      const c = map.getCenter();
      before = {
        view: { center: c.toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
        base: base(), maxPitch: map.getMaxPitch(), maxZoom: map.getMaxZoom(), fov: map.getVerticalFieldOfView?.(),
        clamped: map.getCenterClampedToGround?.(), terrain: map.getTerrain(),
        handlers: HANDLERS.filter((h) => map[h]?.isEnabled?.()),
        // Flächen mit Muster (Pflaster der Fußgängerzone): aus der Nähe flimmern sie in Wellen
        patterns: map.getStyle().layers.filter((l) => l.paint?.['fill-pattern'] && map.getLayoutProperty(l.id, 'visibility') !== 'none').map((l) => l.id),
      };
      for (const id of before.patterns) map.setLayoutProperty(id, 'visibility', 'none');
      before.symbols = map.getStyle().layers.filter((l) => l.type === 'symbol' && map.getLayoutProperty(l.id, 'visibility') !== 'none').map((l) => l.id);
      for (const id of before.symbols) map.setLayoutProperty(id, 'visibility', 'none');
      const street = shared ? null : toStreet(point ?? c.toArray());
      pos = street?.point ?? point ?? c.toArray();
      bearing = shared?.bearing ?? street?.bearing ?? map.getBearing();
      look = clamp(shared?.look ?? LOOK.start, LOOK.min, LOOK.max);
      ground = null;
      push = 0; glide = null;
      for (const h of before.handlers) map[h].disable();
      // Gelände muss an sein – die Kamera folgt ihm
      if (!before.terrain && map.getSource('terrain')) map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
      map.setMaxPitch(Math.max(LOOK.max, before.maxPitch));
      map.setMaxZoom(24);
      map.setCenterClampedToGround?.(false);
      map.setVerticalFieldOfView?.(FOV);
      // Modell statt Luftbild: Boden aus den Kartendaten (map/street-look.js)
      if (before.base === 'sat') setBase('map', { save: false });
      before.look = modelLook(map);
      before.cameraPoint = fixCameraPoint();
      document.body.classList.add('street-view');
      // Häuser nur im Umkreis – der Punkt wird mitgelesen, während man geht
      focus.point = pos;
      map.wmapBuildings?.setFocus(focus);
      shops = streetShops(map, {
        inside: (p) => !!map.wmapBuildings?.inside?.(p),
        onOpen: (f) => poi?.open(f), onClose: () => poi?.close(), isOpen: () => !!poi?.isOpen(),
      });
      top = Object.assign(document.createElement('div'), { className: 'street-top', role: 'status' });
      document.body.append(top);
      told = 0;
      document.activeElement?.blur?.();
      paintHud();
      window.addEventListener('keydown', keydown, true);
      window.addEventListener('keyup', keyup, true);
      window.addEventListener('blur', blur);
      canvas.addEventListener('pointerdown', pointerdown);
      canvas.addEventListener('dblclick', dblclick);
      document.addEventListener('mousemove', mousemove);
      document.addEventListener('pointerlockchange', lockchange);
      canvas.addEventListener('pointermove', pointermove);
      canvas.addEventListener('pointerup', pointerup);
      canvas.addEventListener('pointercancel', pointerup);
      canvas.addEventListener('wheel', wheel, { passive: false });
      place();
      last = 0;
      raf ??= requestAnimationFrame(frame);
    },
    /** Zurück zur Karte: über dem Punkt, an dem man stand, in der Ansicht von vorher */
    stop() {
      if (!on) return;
      on = false;
      down.clear(); pointers.clear(); pinch = null;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pointerdown);
      canvas.removeEventListener('dblclick', dblclick);
      document.removeEventListener('mousemove', mousemove);
      document.removeEventListener('pointerlockchange', lockchange);
      if (locked()) document.exitPointerLock?.();
      document.body.classList.remove('street-locked');
      canvas.removeEventListener('pointermove', pointermove);
      canvas.removeEventListener('pointerup', pointerup);
      canvas.removeEventListener('pointercancel', pointerup);
      canvas.removeEventListener('wheel', wheel);
      hud?.remove(); hud = null;
      top?.remove(); top = null;
      shops?.stop(); shops = null;
      map.wmapBuildings?.setFocus(null);
      for (const id of before.symbols) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      document.body.classList.remove('street-view');
      if (before.fov != null) map.setVerticalFieldOfView(before.fov);
      if (before.clamped != null) map.setCenterClampedToGround(before.clamped);
      if (!before.terrain) map.setTerrain(null);
      before.look();
      before.cameraPoint();
      if (before.base === 'sat') setBase('sat', { save: false });
      for (const id of before.patterns) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      map.jumpTo({ ...before.view, center: pos, bearing });
      map.setMaxZoom(before.maxZoom);
      map.setMaxPitch(before.maxPitch);
      for (const h of before.handlers) map[h].enable();
      before = null;
    },
  };
  return api;
}
