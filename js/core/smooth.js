/**
 * Ruhiger Standortpunkt: das GPS wandert auch im Stand um einige Meter und
 * springt ab und zu. Wie bei Google Maps wird geglättet, bevor der Punkt auf
 * die Karte kommt (Punkt auf der Karte, map/map.js; die Navigation hat ihre
 * eigene Führung auf der Route):
 *
 *   Nah am Punkt, ohne Fahrt   Punkt bleibt stehen; die Meldungen werden im
 *                              Hintergrund gemittelt (genaue zählen mehr),
 *                              nur ab und zu rückt er auf das Mittel
 *   Weiter weg bzw. in Fahrt   ¾ zur neuen Meldung (ungenauere zählen weniger),
 *                              mit Richtung und Tempo des GPS vorausgerechnet –
 *                              sonst hinkt der Punkt in Fahrt hinterher
 *   Ausreißer                  Sprung, der nicht zum Tempo passt, oder viel
 *                              ungenauer als bisher: verworfen – drei
 *                              hintereinander gelten aber
 *
 * Im Stand kommt nichts Neues heraus – das spart auch das Nachführen der Karte.
 */
import { distance, destination, bearing } from './geo.js';

const HOLD_MIN_M = 8;          // so nah (mindestens) gilt als „noch dieselbe Stelle“
const HOLD_MAX_M = 30;
const MOVE_SPEED = 1;          // m/s – darüber zählt das GPS-Tempo als Fahrt
const HOLD_UPDATE_MS = 10000;  // im Stand höchstens so oft auf das Mittel rücken …
const HOLD_SHIFT_M = 3;        // … und nur, wenn es sich so weit verschoben hat
const RESET_MS = 30000;        // so lange nichts: neu anfangen

const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/**
 * Tempo, dem man trauen kann: Bei schwachem Signal meldet das GPS auch im
 * Stand 1–2 m/s (gemessen am Handy: 3–7 km/h, der Punkt rührte sich dabei
 * kaum). Gezählt wird das Tempo nur, wenn man in den letzten 8 s auch
 * wirklich so weit gekommen ist – mindestens 6 m bzw. die halbe
 * Ungenauigkeit (höchstens 8 m) und gut ein Drittel dessen, was das Tempo
 * verspricht, dazu in den letzten 5 s mindestens 3–5 m. Sonst 0. Mit gutem
 * Signal meldet das GPS im Stand ohnehin 0 – dann hält man sofort; mit
 * Rauschen nach gut 5 s.
 * → (point, speed, accuracy, ms) => Tempo (m/s) oder null
 */
export function trustedSpeed() {
  const win = [];
  return (p, speed, acc, t) => {
    const v = Number.isFinite(speed) && speed >= 0 ? speed : null;
    win.push({ p, t, v: v ?? 0 });
    while (win.length > 1 && t - win[0].t > 8000) win.shift();
    if (win.length < 3) return v;                  // noch zu wenig gesehen
    const dt = (t - win[0].t) / 1000;
    const moved = distance(win[0].p, p);
    const promised = (win.reduce((sum, w) => sum + w.v, 0) / win.length) * dt;
    // Die Schwelle wächst mit der Ungenauigkeit, aber höchstens auf 8 m – sonst
    // gälte langsames Gehen bei schwachem Signal als Stehen
    const real = moved >= Math.max(6, Math.min((acc ?? 0) * 0.5, 8)) && moved >= promised * 0.35;
    // … und auch in den letzten 5 s vorangekommen (3–5 m je nach Ungenauigkeit) –
    // so zählt ein Halt schon nach gut 5 s, auch wenn davor noch Fahrt im Fenster liegt
    const recent = win.filter((w) => t - w.t <= 5000);
    const r0 = recent[0];
    const lately = !r0 || r0 === win.at(-1) || distance(r0.p, p) >= Math.max(3, Math.min((acc ?? 0) * 0.25, 5),
      (recent.reduce((sum, w) => sum + w.v, 0) / recent.length) * ((t - r0.t) / 1000) * 0.35);
    return real && lately ? v ?? moved / dt : 0;
  };
}

/** → (position) => geglättete position oder null (nichts Neues) */
export function smoother() {
  let est = null;              // { p, acc, t, speed, heading }
  let hold = null;             // { w, x, y, t } gewichtetes Mittel im Stand
  let rejected = 0;
  const trust = trustedSpeed();

  const out = (pos, p, acc, speed, heading) => ({
    timestamp: pos.timestamp,
    coords: {
      latitude: p[1], longitude: p[0], accuracy: acc, speed, heading,
      altitude: pos.coords.altitude, altitudeAccuracy: pos.coords.altitudeAccuracy,
    },
  });

  return (pos) => {
    const c = pos.coords;
    const p = [c.longitude, c.latitude];
    const acc = c.accuracy ?? 30;
    const t = pos.timestamp ?? Date.now();
    const speed = trust(p, c.speed, acc, t);
    const heading = Number.isFinite(c.heading) ? c.heading : null;

    if (!est || t - est.t > RESET_MS) {
      est = { p, acc, t, speed: speed ?? 0, heading };
      hold = null;
      rejected = 0;
      return out(pos, p, acc, speed, heading);
    }

    const dt = Math.max(0.3, (t - est.t) / 1000);
    const jump = distance(est.p, p);

    // Ausreißer
    const plausible = (Math.max(speed ?? 0, est.speed, 2) + 10) * dt * 1.5 + Math.min(acc, 50) + Math.min(est.acc, 50);
    const worse = acc > Math.max(60, est.acc * 3);
    if ((jump > plausible || worse) && ++rejected < 3) return null;
    rejected = 0;

    // Stehen: nah dran und keine Fahrt gemessen
    const radius = Math.min(HOLD_MAX_M, Math.max(HOLD_MIN_M, acc));
    if (jump < radius && (speed ?? 0) < MOVE_SPEED) {
      const w = 1 / Math.max(3, acc) ** 2;
      hold = hold ?? { w: 0, x: 0, y: 0, t };
      hold.w += w;
      hold.x += p[0] * w;
      hold.y += p[1] * w;
      const mean = [hold.x / hold.w, hold.y / hold.w];
      est.t = t;
      est.speed = 0;
      // Genauer als bisher geworden? Dann darf der Punkt kleiner werden
      est.acc = Math.min(est.acc, acc);
      if (t - hold.t < HOLD_UPDATE_MS || distance(est.p, mean) < HOLD_SHIFT_M) return null;
      hold.t = t;
      est.p = mean;
      return out(pos, mean, est.acc, 0, est.heading);
    }
    hold = null;

    // Fahrt: vorausrechnen, dann ¾ zur Meldung (ungenauere zählen weniger)
    const moving = speed !== null && speed >= MOVE_SPEED && heading !== null;
    const guess = moving ? destination(est.p, heading, speed * dt) : est.p;
    const k = acc <= est.acc * 1.5 ? 0.75 : 0.5;
    const next = lerp(guess, p, k);
    const dir = moving ? heading : distance(est.p, next) > 3 ? bearing(est.p, next) : est.heading;
    est = { p: next, acc: est.acc + (acc - est.acc) * k, t, speed: speed ?? jump / dt, heading: dir };
    return out(pos, next, est.acc, est.speed, dir);
  };
}

/**
 * Wie navigator.geolocation, aber geglättet – für MapLibres GeolocateControl.
 * wmapShim: core/native.js greift für eigene Abfragen am Ersatz vorbei.
 */
export function smoothGeolocation(base) {
  const ids = new Map();
  let next = 1;
  return {
    wmapShim: true,
    watchPosition(ok, fail, options) {
      const n = next++;
      const smooth = smoother();
      ids.set(n, base.watchPosition((pos) => { const s = smooth(pos); if (s) ok(s); }, fail, options));
      return n;
    },
    clearWatch(n) { base.clearWatch(ids.get(n)); ids.delete(n); },
    getCurrentPosition: (ok, fail, options) => base.getCurrentPosition(ok, fail, options),
  };
}

/**
 * Punkt gleitet zur neuen Stelle, statt zu springen – nur der Marker (DOM),
 * die Karte selbst wird dafür nicht neu gezeichnet.
 */
export function glideMarker(marker, ms = 800) {
  const set = marker.setLngLat.bind(marker);
  let raf = 0;
  marker.setLngLat = (ll) => {
    const to = Array.isArray(ll) ? ll : [ll.lng ?? ll.lon, ll.lat];
    const cur = marker.getLngLat();
    cancelAnimationFrame(raf);
    // Erster Punkt oder großer Sprung (neu gestartet): gleich hin
    if (!cur || distance([cur.lng, cur.lat], to) > 300) return set(to);
    const from = [cur.lng, cur.lat];
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      set(lerp(from, to, 1 - (1 - k) ** 2));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return marker;
  };
}
