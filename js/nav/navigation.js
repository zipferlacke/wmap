/**
 * Navigationsansicht: Standort verfolgen, nächste Anweisung zeigen und
 * vorlesen, bei Abweichung neu rechnen.
 *
 * Der Pfeil gleitet zwischen zwei GPS-Meldungen auf der Straße entlang, die
 * Karte dreht sich mit dem Straßenverlauf (vorausschauend statt nach der
 * sprunghaften GPS-Richtung). Kamera und Pfeil laufen mit 30 Bildern je
 * Sekunde; Ausreißer im GPS werden verworfen.
 *
 * Zum Testen am Schreibtisch: ?sim an die URL hängen – dann fährt ein
 * simulierter Standort die Route ab.
 */
import { PROFILES } from '../core/config.js';
import { geo } from '../core/native.js';
import { nearestOnLine, pointAt, bearing, destination, distance, fmtDistance, fmtDuration, fmtClock, speakDistance, esc } from '../core/geo.js';
import { reroute as fetchReroute, maneuverIcon } from '../services/routing.js';
import { showRoutes, showHover, showNavExtras, showNavRoad, ROAD_ZOOM } from '../map/map.js';
import { routeExtras, limitAt, lanesAt, roadFeatures, laneShiftAt } from './extras.js';
import { phrases, laneHint } from './voice.js';
import { reverse } from '../services/geocode.js';

const OFF_ROUTE_M = 40;
const OFF_ROUTE_FIXES = 3;
const REROUTE_PAUSE_MS = 10000;

/* ── Sprache ──────────────────────────────────────────────────────────────── */

const VOICE_KEY = 'wmap.voice';

/**
 * Welche Stimme klingt gut? Deutsch zuerst; die großen Anbieter (Google,
 * Microsoft, Apple) und „natürliche“ Stimmen vor den einfachen Systemstimmen –
 * eSpeak klingt blechern und wirkt schnell verzerrt.
 */
function voiceScore(v) {
  let s = v.lang === 'de-DE' ? 20 : 10;
  if (/google|microsoft|natural|neural|online|premium|enhanced|siri|anna|petra|katja|conrad|helena/i.test(v.name)) s += 8;
  if (/espeak|mbrola|pico/i.test(v.name)) s -= 12;
  if (v.default) s += 1;
  return s;
}

const speech = {
  muted: (() => { try { return localStorage.getItem('wmap.muted') === '1'; } catch { return false; } })(),
  voice: null,

  /** Deutsche Stimmen, die beste zuerst. */
  voices() {
    return (window.speechSynthesis?.getVoices() ?? [])
      .filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('de'))
      .sort((a, b) => voiceScore(b) - voiceScore(a));
  },
  pickVoice() {
    let saved = null;
    try { saved = localStorage.getItem(VOICE_KEY); } catch { /* egal */ }
    const list = this.voices();
    this.voice = list.find((v) => v.name === saved) ?? list[0] ?? null;
  },
  setVoice(name) {
    try { localStorage.setItem(VOICE_KEY, name); } catch { /* egal */ }
    this.pickVoice();
  },
  say(text, { force = false } = {}) {
    if ((this.muted && !force) || !text || !window.speechSynthesis) return;
    const go = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice?.lang ?? 'de-DE';
      if (this.voice) u.voice = this.voice;
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;
      speechSynthesis.speak(u);
    };
    // Abbrechen und im selben Augenblick neu sprechen verschluckt Silben und
    // klingt verzerrt – deshalb nur abbrechen, wenn gerade gesprochen wird,
    // und kurz Luft lassen
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      setTimeout(go, 150);
    } else {
      go();
    }
  },
  setMuted(m) {
    this.muted = m;
    if (m) window.speechSynthesis?.cancel();
    try { localStorage.setItem('wmap.muted', m ? '1' : '0'); } catch { /* egal */ }
  },
};
window.speechSynthesis?.addEventListener?.('voiceschanged', () => speech.pickVoice());
speech.pickVoice();

/** Auswahl der Stimme als Dialog aus wuefl-libs – mit Probe. */
export function openVoiceDialog() {
  speech.pickVoice();
  const list = speech.voices();
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog confirm';
  dlg.innerHTML = `
    <h2><span class="msr">record_voice_over</span> Stimme für Ansagen</h2>
    ${list.length ? `<select class="voice-select" aria-label="Stimme">${list.map((v) => `
      <option value="${esc(v.name)}" ${v === speech.voice ? 'selected' : ''}>${esc(v.name)}${v.localService ? '' : ' · online'}</option>`).join('')}
    </select>` : '<p>Dieser Browser bietet keine deutsche Stimme an.</p>'}
    <p>Klingt es blechern oder verzerrt, ist meist eine einfache Systemstimme (eSpeak) gewählt.
       „Google Deutsch“ in Chrome oder die Stimmen von Android, Windows und macOS klingen deutlich besser.</p>
    <div class="confirm-actions">
      <button type="button" class="button" value="test"><span class="msr">play_arrow</span> Probe</button>
      <button type="button" class="button primary" value="ok">Fertig</button>
    </div>`;
  document.body.append(dlg);
  dlg.querySelector('select')?.addEventListener('change', (e) => speech.setVoice(e.target.value));
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('button[value]');
    if (!b) return;
    if (b.value === 'test') speech.say('In 300 Metern rechts abbiegen, dann halten Sie sich links.', { force: true });
    else { dlg.close(); dlg.remove(); }
  });
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.showModal();
}

/* ── Einstellungen ────────────────────────────────────────────────────────── */

/**
 * zoom   'auto' | 'near' | 'far'  – wie nah die Kamera in der Navigation ist
 * threeD  geneigte Ansicht (sonst flach von oben)
 * north   Norden oben statt Fahrtrichtung oben
 */
export const navSettings = {
  get zoom() { return lsGet('wmap.nav.zoom', 'auto'); },
  set zoom(v) { lsSet('wmap.nav.zoom', v); },
  get threeD() { return lsGet('wmap.nav.3d', '1') === '1'; },
  set threeD(v) { lsSet('wmap.nav.3d', v ? '1' : '0'); },
  get north() { return lsGet('wmap.nav.north', '0') === '1'; },
  set north(v) { lsSet('wmap.nav.north', v ? '1' : '0'); },
};
function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }

/* ── Hilfen fürs flüssige Bewegen ─────────────────────────────────────────── */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
/** Winkel sanft nachführen: kürzester Weg, zeitkonstant, mit Höchstdrehrate. */
function approachAngle(cur, target, dt, tau, maxRate = 140) {
  const diff = ((target - cur + 540) % 360) - 180;
  const step = clamp(diff * (1 - Math.exp(-dt / tau)), -maxRate * dt, maxRate * dt);
  return (cur + step + 360) % 360;
}

/** Manöver, die ohne Richtung schwer zu verstehen sind (Abbiegen, Auffahrten, Kreisel). */
const NEEDS_DIRECTION = new Set([9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 37, 38]);

/** Stück der Route zwischen zwei Metermarken. */
function slice(r, a, b) {
  const out = [pointAt(r.coords, r.cum, a)];
  for (let i = 0; i < r.coords.length; i += 1) if (r.cum[i] > a && r.cum[i] < b) out.push(r.coords[i]);
  out.push(pointAt(r.coords, r.cum, b));
  return out;
}

const FRAME_MS = 1000 / 30;           // 30 Bilder je Sekunde reichen und sparen Strom

/** Spurpfeile: OSRM-Angaben → Symbol */
const LANE_ICON = {
  left: 'turn_left', 'slight left': 'turn_slight_left', 'sharp left': 'turn_sharp_left',
  right: 'turn_right', 'slight right': 'turn_slight_right', 'sharp right': 'turn_sharp_right',
  straight: 'straight', uturn: 'u_turn_left', 'merge to left': 'merge', 'merge to right': 'merge', none: 'straight',
};

/* ── Navigation ───────────────────────────────────────────────────────────── */

export class Navigation {
  #map; #el; #onExit; #onRoute; #onFix; #onReroute; #onSearch; #onArrive; #onReport; #onShare;
  #route = null; #profile = 'car'; #highways = true; #targets = []; #extras = null;
  #watch = null; #sim = null; #wakeLock = null; #marker = null; #targetMarkers = [];
  #roadFor = null; #cover = null; #shift = 0; #lefts = null; #towards = new Map();
  // Fortschritt auf der Route
  #index = 0; #current = -1; #said = new Map(); #off = 0; #lastReroute = 0; #rerouting = false;
  #arrived = false; #lastFix = null; #prev = null; #travel = null; #offlineSaid = 0; #rejected = 0;
  #rawAt = 0; #watchdog = null; #coarse = 0; #lastAlong = null;
  // Anzeige: Position zwischen zwei Meldungen, Kamera
  #raf = null; #lastFrame = 0; #anim = null; #pos = null; #heading = null; #speed = 0;
  #following = true; #cam = { center: null, bearing: 0, zoom: 17, pitch: 55, tau: 0.1 };
  #target = { zoom: 17, pitch: 55 }; #context = 'urban'; #dist = Infinity;
  #place = { t: 0, point: null };

  /**
   * @param opts.onExit     Navigation beendet ({ arrived })
   * @param opts.onRoute    neue Route – beim Start, nach Neuberechnung, mit Zusatzdaten (again)
   * @param opts.onFix      jede angenommene Standortmeldung { point, speed, accuracy, heading }
   * @param opts.onReroute  verfahren: Standort und das Stück der alten Route voraus
   * @param opts.onSearch   „Entlang der Route suchen“ gedrückt
   * @param opts.onArrive   am Ziel angekommen (Punkt des Ziels, Profil)
   * @param opts.onReport   „Melden“ gedrückt (eigener Standort)
   */
  constructor(map, el, { onExit, onRoute, onFix, onReroute, onSearch, onArrive, onReport, onShare } = {}) {
    this.#map = map;
    this.#el = el;
    this.#onExit = onExit;
    this.#onRoute = onRoute;
    this.#onFix = onFix;
    this.#onReroute = onReroute;
    this.#onSearch = onSearch;
    this.#onArrive = onArrive;
    this.#onReport = onReport;
    this.#onShare = onShare;
    const on = (sel, fn) => el.querySelector(sel)?.addEventListener('click', fn);
    on('.nav-stop', () => this.stop());
    on('.nav-mute', () => { speech.setMuted(!speech.muted); this.#paintButtons(); });
    // Ein Knopf für beides: folgt die Karte schon, wechselt er zwischen
    // geneigt und flach; sonst holt er die Karte zurück zu dir
    on('.nav-recenter', () => {
      if (this.#following) { navSettings.threeD = !navSettings.threeD; this.#plan(); }
      this.resumeFollow();
      this.#paintButtons();
    });
    on('.nav-overview', () => this.#overview());
    on('.nav-search', () => this.#onSearch?.());
    on('.nav-report', () => this.#onReport?.(this.#pos?.point ?? this.#lastFix?.point));
    on('.nav-share', () => {
      const r = this.#route;
      const along = this.#pos?.along ?? 0;
      const left = Math.max(0, r.cum[r.cum.length - 1] - along);
      const secs = r.time * (left / (r.cum[r.cum.length - 1] || 1));
      this.#onShare?.({ point: this.#pos?.point ?? this.#lastFix?.point, to: r.coords.at(-1), eta: Date.now() + secs * 1000, left, profile: this.#profile });
    });
    on('.nav-compass', () => { navSettings.north = !navSettings.north; this.#paintButtons(); this.resumeFollow(); });
    // Wer die Karte selbst verschiebt, will sich umsehen – nicht zurückgerissen werden
    for (const ev of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart']) {
      map.on(ev, (e) => { if (this.#route && e.originalEvent) this.#setFollowing(false); });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.#route || document.visibilityState !== 'visible') return;
      this.#lockScreen();
      // Nach dem Zurückkommen liefert die alte Abfrage oft nichts mehr
      if (this.#watchdog) this.#startGps();
    });
  }

  get active() { return !!this.#route; }
  get route() { return this.#route; }
  get profile() { return this.#profile; }
  /** Wie weit man auf der Route ist (m) – für „Entlang der Route“ ab hier. */
  get along() { return this.#pos?.along ?? 0; }

  /** Von außen: Kamera bleibt, wo der Nutzer sie hinbewegt (z. B. per Tastatur). */
  pauseFollow() { if (this.#route) this.#setFollowing(false); }

  /** Wieder dem eigenen Standort folgen – sanft von der aktuellen Ansicht aus. */
  resumeFollow() {
    if (!this.#route) return;
    const m = this.#map;
    Object.assign(this.#cam, { center: m.getCenter().toArray(), bearing: m.getBearing(), zoom: m.getZoom(), pitch: m.getPitch(), tau: 0.45 });
    this.#setFollowing(true);
  }

  /** Zwischenstopp einfügen (z. B. Tankstelle entlang der Route) und neu rechnen. */
  addStop(point) {
    if (!this.#route) return;
    this.#targets = [point, ...this.#targets];
    this.#lastReroute = 0;
    this.#reroute(this.#lastFix?.point ?? this.#pos?.point ?? this.#route.coords[0], this.#travel, { announce: 'Zwischenstopp wird eingeplant.' });
  }

  /**
   * @param route     die gewählte Route
   * @param targets   Zwischenziele und Ziel als [lon, lat] – für Neuberechnungen
   */
  start(route, { profile, highways, targets }) {
    this.#route = route;
    this.#profile = profile;
    this.#highways = highways;
    this.#targets = targets.slice();
    this.#extras = route.extras ?? null;
    this.#reset();
    this.#el.hidden = false;
    this.#el.dataset.profile = profile;
    document.body.classList.add('navigating');
    this.#paintButtons();
    this.#paintTargets();
    this.#onRoute?.(route, { profile, highways, targets: this.#targets });
    this.#loadExtras();

    const arrow = document.createElement('div');
    arrow.className = 'nav-me';
    arrow.innerHTML = '<span class="msr">navigation</span>';
    this.#marker = new maplibregl.Marker({ element: arrow, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(route.coords[0]).addTo(this.#map);

    // Eigener Punkt im unteren Drittel (~70 %) – man sieht mehr vom Weg voraus
    const h = this.#map.getContainer().clientHeight;
    this.#map.setPadding({ top: h * 0.52, bottom: 80, left: 0, right: 0 });
    Object.assign(this.#cam, { center: null, bearing: this.#map.getBearing(), zoom: this.#map.getZoom(), pitch: this.#map.getPitch(), tau: 0.5 });

    // Die erste Ansage kommt direkt aus dem Klick – iOS spricht sonst gar nicht
    speech.say(this.#startText());
    this.#said.set(0, { far: true, near: true });
    this.#update({ point: route.coords[0], heading: null, speed: 0, accuracy: 5 });
    this.#lockScreen();
    this.#raf = requestAnimationFrame(this.#frame);

    if (new URLSearchParams(location.search).has('sim')) this.#simulate();
    else if (geo.available()) {
      this.#startGps();
      // Wächter: Manche Browser liefern nach einer Weile einfach nichts mehr,
      // obwohl der Bildschirm an ist – dann die Standortabfrage neu starten
      this.#watchdog = setInterval(() => this.#checkGps(), 2000);
    } else {
      this.#status('Standort wird von diesem Gerät nicht unterstützt');
    }
  }

  /* ── GPS ─────────────────────────────────────────────────────────────────── */

  #startGps() {
    if (this.#watch !== null) geo.clear(this.#watch);
    this.#rawAt = Date.now();
    this.#watch = geo.watch(
      (pos) => {
        this.#rawAt = Date.now();
        const acc = pos.coords.accuracy;
        // Nur „ungefährer Standort“ freigegeben (Android/iOS): Genauigkeit in Kilometern
        this.#coarse = acc > 300 ? this.#coarse + 1 : 0;
        this.#gpsState(this.#coarse >= 3 ? 'coarse' : null);
        this.#update({
          point: [pos.coords.longitude, pos.coords.latitude],
          heading: pos.coords.heading, speed: pos.coords.speed, accuracy: acc,
        });
      },
      (err) => {
        if (err.code === 1) { this.#gpsState('denied'); return; }
        // Zeitüberschreitung oder kein Signal: gleich neu versuchen
        this.#gpsState('weak');
        setTimeout(() => { if (this.#route) this.#startGps(); }, 1500);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  #checkGps() {
    if (!this.#route || document.visibilityState !== 'visible') return;
    const silent = Date.now() - this.#rawAt;
    if (silent > 6000) {
      this.#gpsState('weak');
      this.#startGps();
    }
  }

  /** Hinweis oben unter der Anweisung: schwaches Signal, nur ungefährer Standort, keine Freigabe. */
  #gpsState(state) {
    const el = this.#el.querySelector('.nav-gps');
    if (!el) return;
    const text = {
      weak: 'GPS-Signal schwach – suche Standort …',
      coarse: 'Nur ungefährer Standort freigegeben. Bitte in den Handy-Einstellungen für den Browser „Genauer Standort“ erlauben.',
      denied: 'Standort nicht freigegeben – bitte in den Browser-Einstellungen erlauben.',
    }[state];
    el.hidden = !text;
    el.textContent = text ?? '';
    el.className = `nav-gps ${state ?? ''}`;
  }

  stop() {
    if (this.#watch !== null) geo.clear(this.#watch);
    clearInterval(this.#sim);
    clearInterval(this.#watchdog);
    this.#watchdog = null;
    this.#gpsState(null);
    cancelAnimationFrame(this.#raf);
    this.#watch = this.#sim = this.#raf = null;
    this.#wakeLock?.release?.().catch(() => {});
    this.#wakeLock = null;
    window.speechSynthesis?.cancel();
    this.#marker?.remove();
    this.#marker = null;
    this.#targetMarkers.forEach((m) => m.remove());
    this.#targetMarkers = [];
    this.#route = null;
    this.#el.hidden = true;
    document.body.classList.remove('navigating');
    showHover(this.#map, null);
    showNavExtras(this.#map, {});
    this.#clearRoad();
    this.#map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.#map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    this.#onExit?.({ arrived: this.#arrived });
  }

  #reset() {
    this.#index = 0;
    this.#clearRoad();
    this.#lastAlong = null;
    this.#current = -1;
    this.#said = new Map();
    this.#off = 0;
    this.#arrived = false;
    this.#anim = null;
    this.#pos = null;
    this.#setFollowing(true);
    this.#el.classList.remove('arrived');
    this.#paintExtras();
  }

  async #lockScreen() {
    try { this.#wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht schlimm */ }
  }

  /** Spuren, Tempolimits, Ampeln nachladen – die Navigation läuft schon. */
  async #loadExtras() {
    const route = this.#route;
    if (route.extras || !navigator.onLine) { this.#paintExtras(); return; }
    try {
      const x = await routeExtras(route, this.#profile);
      if (this.#route !== route) return;
      route.extras = this.#extras = x;
      this.#paintExtras();
      this.#onRoute?.(route, { profile: this.#profile, highways: this.#highways, targets: this.#targets, again: true });
    } catch { /* ohne Zusatzdaten geht es auch */ }
  }

  /* ── Standort verarbeiten ────────────────────────────────────────────────── */

  #update({ point, heading, speed, accuracy }) {
    const r = this.#route;
    if (!r) return;
    const now = performance.now();
    const prev = this.#lastFix;

    // Ausreißer verwerfen: sehr ungenau oder ein Sprung, der nicht zum Tempo
    // passt. Drei hintereinander gelten aber – dann stimmt eher die alte Stelle nicht.
    if (prev) {
      const dt = Math.max(0.3, (now - prev.t) / 1000);
      const jump = distance(prev.point, point);
      const plausible = (Math.max(speed ?? 0, prev.speed, 3) + 8) * dt * 2 + Math.min(accuracy ?? 0, 50);
      const bad = ((accuracy ?? 0) > 60 && prev.accuracy <= 60) || jump > plausible;
      if (bad && ++this.#rejected < 3) return;
    }
    this.#rejected = 0;

    // Erst in der Nähe der letzten Stelle suchen, nur bei großem Abstand überall
    let snap = nearestOnLine(r.coords, r.cum, point, Math.max(0, this.#index - 5), this.#index + 400);
    if (snap.offset > OFF_ROUTE_M) {
      const all = nearestOnLine(r.coords, r.cum, point);
      if (all.offset < snap.offset) snap = all;
    }
    const onRouteNow = snap.offset <= Math.max(OFF_ROUTE_M, (accuracy ?? 0) * 1.5);

    // Tempo: das GPS misst es genau (Doppler). Fehlt es, zählt der Fortschritt
    // entlang der Route – das rauscht viel weniger als die Luftlinie zwischen
    // zwei ungenauen Punkten.
    const dt = prev ? Math.max(0.3, (now - prev.t) / 1000) : 1;
    let v = Number.isFinite(speed) && speed >= 0 ? speed : null;
    if (v === null && prev && onRouteNow && this.#lastAlong !== null) v = Math.max(0, snap.along - this.#lastAlong) / dt;
    else if (v === null && prev) v = distance(prev.point, point) / dt;
    this.#speed = prev ? this.#speed * 0.7 + (v ?? 0) * 0.3 : v ?? 0;
    this.#lastAlong = onRouteNow ? snap.along : null;

    const fix = { point, heading, speed: this.#speed, accuracy: accuracy ?? 0, t: now };
    this.#lastFix = fix;
    this.#onFix?.(fix);
    if (this.#coarse < 3) this.#gpsState(null);
    // Wohin man wirklich fährt: GPS-Richtung, sonst aus den letzten Punkten
    const moved = this.#prev && distance(this.#prev, point) > 6;
    this.#travel = this.#speed > 1.5 && Number.isFinite(heading) ? heading
      : moved ? bearing(this.#prev, point) : this.#travel;
    if (moved || !this.#prev) this.#prev = point;

    const offRoute = snap.offset > Math.max(OFF_ROUTE_M, (accuracy ?? 0) * 1.5);
    this.#off = offRoute ? this.#off + 1 : 0;
    // Der Pfeil bleibt auf der Straße, bis mehrere Meldungen hintereinander
    // daneben liegen – ein einzelner GPS-Ausreißer lässt ihn nicht springen
    const left = this.#off >= OFF_ROUTE_FIXES;
    if (left) this.#reroute(point, this.#travel);
    if (!offRoute) this.#index = snap.index;

    // Nicht rückwärts zappeln: kleine Rücksprünge des GPS ignorieren
    const cur = this.#currentPos(now);
    let along = snap.along;
    if (!offRoute && cur?.onRoute && along < cur.along && along > cur.along - 40) along = cur.along;
    // Einzelner Ausreißer: auf der Route weiterrollen, wo wir waren
    if (offRoute && !left && cur?.onRoute) along = cur.along + (this.#speed || 0) * (prev ? (now - prev.t) / 1000 : 0);

    // Neues Ziel für die Bewegung: in der Zeit bis zur nächsten Meldung dorthin gleiten
    const dur = prev ? clamp(now - prev.t, 400, 2500) : 0;
    this.#anim = {
      from: cur ?? { along, point: left ? point : snap.point, onRoute: !left },
      to: { along, point: left ? point : pointAt(r.coords, r.cum, along), onRoute: !left },
      t0: now, dur, speed: this.#speed,
    };

    // Bereits gefahrenen Teil ausblenden (etwas hinter dem Pfeil, der gleitet ja noch)
    const cut = Math.max(0, along - 25);
    const start = nearestOnLine(r.coords, r.cum, pointAt(r.coords, r.cum, cut), Math.max(0, snap.index - 60), snap.index + 2);
    this.#paintRoad(along);
    const end = r.cum[r.cum.length - 1];
    const cover = this.#cover;
    if (cover && cover[1] > cut) {
      // Wo die Fahrbahn mit Spuren liegt, übernimmt sie die Route
      const parts = [{ id: r.id, coords: slice(r, cut, Math.min(cover[1], end)), covered: true }];
      if (cover[1] < end) parts.push({ id: r.id, coords: slice(r, cover[1], end) });
      showRoutes(this.#map, parts, r.id);
    } else {
      showRoutes(this.#map, [{ id: r.id, coords: [start.point, ...r.coords.slice(start.index + 1)] }], r.id);
    }

    this.#passVias(along);
    const arrived = along >= r.cum[r.cum.length - 1] - 20;
    this.#dist = arrived ? 0 : this.#instruct(along);
    this.#plan(along);
    this.#paintSpeed(along);
    this.#updatePlace(point);
    if (arrived) { this.#arrive(); return; }
    this.#remaining(along);
  }

  /** Wo der Pfeil gerade steht: zwischen letzter und neuer Meldung, danach kurz weiterrollend. */
  #currentPos(now) {
    const a = this.#anim;
    const r = this.#route;
    if (!a || !r) return null;
    const k = a.dur ? clamp((now - a.t0) / a.dur, 0, 1) : 1;
    if (a.to.onRoute && a.from.onRoute) {
      let along = a.from.along + (a.to.along - a.from.along) * k;
      // Die nächste Meldung kommt oft etwas spät (Tunnel, Häuserschlucht) –
      // bis zu 4 s mit dem letzten Tempo auf der Straße weiterrollen
      if (k >= 1 && a.speed > 1) along = a.to.along + a.speed * Math.min(4, (now - a.t0 - a.dur) / 1000);
      along = Math.min(along, r.cum[r.cum.length - 1]);
      return { along, point: pointAt(r.coords, r.cum, along), onRoute: true };
    }
    return { along: a.to.along, point: lerp(a.from.point, a.to.point, k), onRoute: a.to.onRoute };
  }

  /** Ein Bild: Pfeil setzen, Kamera nachführen. */
  #frame = (t) => {
    if (!this.#route) return;
    this.#raf = requestAnimationFrame(this.#frame);
    if (t - this.#lastFrame < FRAME_MS - 2) return;
    const dt = this.#lastFrame ? Math.min(0.25, (t - this.#lastFrame) / 1000) : FRAME_MS / 1000;
    this.#lastFrame = t;
    const pos = this.#currentPos(t);
    if (!pos) return;
    this.#pos = pos;
    const r = this.#route;

    // Richtung: auf der Route entlang der Straße voraus (folgt jeder Kurve),
    // daneben die echte Fahrtrichtung
    let dir;
    if (pos.onRoute) {
      const look = clamp(this.#speed * 2.2, 12, 55);
      const a = pointAt(r.coords, r.cum, Math.max(0, pos.along - 4));
      const b = pointAt(r.coords, r.cum, pos.along + look);
      dir = distance(a, b) > 3 ? bearing(a, b) : this.#heading ?? 0;
    } else {
      dir = this.#travel ?? this.#heading ?? 0;
    }
    this.#heading = this.#heading === null ? dir : approachAngle(this.#heading, dir, dt, 0.25, 180);
    // Mit Gegenverkehr fahren wir rechts der Straßenmitte – in unserer Spur
    // Nur so weit, wie die Fahrbahn schon zu sehen ist – beim Zoomen gleitend
    const seen = clamp((this.#map.getZoom() - (ROAD_ZOOM - 0.3)) / 0.6, 0, 1);
    const shift = pos.onRoute && this.#cover && seen > 0 ? laneShiftAt(this.#extras, pos.along, this.#leftStretches()) * seen : 0;
    this.#shift += (shift - this.#shift) * (1 - Math.exp(-dt / 0.8));
    const shown = Math.abs(this.#shift) > 0.05 ? destination(pos.point, this.#heading + 90, this.#shift) : pos.point;
    this.#marker?.setLngLat(shown).setRotation(this.#heading);

    if (!this.#following) { this.#paintCompass(this.#map.getBearing()); return; }
    const c = this.#cam;
    const k = 1 - Math.exp(-dt / c.tau);
    c.center = c.center ? lerp(c.center, pos.point, k) : pos.point;
    c.tau = Math.max(0.06, c.tau - dt * 0.4);       // nach dem Zentrieren erst weich, dann eng dran
    c.bearing = approachAngle(c.bearing, navSettings.north ? 0 : this.#heading, dt, 0.7, 90);
    c.zoom += (this.#target.zoom - c.zoom) * (1 - Math.exp(-dt / 1.6));
    c.pitch += (this.#target.pitch - c.pitch) * (1 - Math.exp(-dt / 1.2));
    // Steht alles (Ampel, Stau), nicht neu zeichnen – spart Strom
    const m = this.#map;
    const still = Math.abs(m.getZoom() - c.zoom) < 0.002 && Math.abs(m.getPitch() - c.pitch) < 0.05
      && Math.abs(((m.getBearing() - c.bearing + 540) % 360) - 180) < 0.05
      && distance(m.getCenter().toArray(), c.center) < 0.05;
    if (!still) m.jumpTo({ center: c.center, bearing: c.bearing, zoom: c.zoom, pitch: c.pitch });
    this.#paintCompass(c.bearing);
  };

  /**
   * Wie nah und wie steil? Feste Stufen je Umgebung statt ständigem
   * Nachregeln – das wirkte unruhig:
   *   Stadt 16,8 · Land 15,9 · Autobahn 15,0, stark geneigt (62°), damit man
   *   weit voraus sieht; 30 s vor dem Abbiegen näher; an verzwickten Stellen
   *   (viele Spuren, Kreisel, Manöver dicht hintereinander) noch näher.
   */
  #plan(along = this.#pos?.along ?? 0) {
    const foot = this.#profile === 'foot';
    const v = this.#speed;
    const limit = limitAt(this.#extras, along);
    // Umgebung mit Abstand zwischen Ein- und Ausschalten, damit nichts pendelt
    let ctx = this.#context;
    if (limit) ctx = limit >= 100 ? 'fast' : limit > 60 ? 'rural' : 'urban';
    else if (v > 26) ctx = 'fast';
    else if (v > 18 && ctx === 'urban') ctx = 'rural';
    else if (v < 22 && ctx === 'fast') ctx = 'rural';
    else if (v > 1 && v < 13 && ctx === 'rural') ctx = 'urban';
    this.#context = ctx;

    const m = this.#route?.maneuvers[this.#current];
    const dist = this.#dist;
    const tt = dist / Math.max(v, foot ? 1.2 : 5);
    const near = m && ![4, 5, 6].includes(m.type) && (tt < 30 || dist < (foot ? 40 : 150));
    let zoom, pitch;
    // Eher von schräg oben als aus Fahrersicht: flach geneigt verdecken Häuser
    // in der Stadt Straße und Abzweig. Dafür näher heran – man sieht die
    // nächste Kreuzung groß, nicht die halbe Stadt bis zum Horizont.
    if (foot) [zoom, pitch] = near ? [18.7, 45] : [18.1, 40];
    else if (ctx === 'fast') [zoom, pitch] = near ? [16.9, 52] : [15.6, 52];
    else if (ctx === 'rural') [zoom, pitch] = near ? [17.5, 50] : [16.6, 50];
    else [zoom, pitch] = near ? [18.1, 45] : [17.5, 45];
    if (near && !foot && this.#complex(m)) [zoom, pitch] = [18.4, 40];
    zoom += { near: 0.7, far: -0.9 }[navSettings.zoom] ?? 0;
    if (!navSettings.threeD) pitch = 0;
    this.#target = { zoom, pitch };
  }

  /** Unübersichtlich: Kreisel, viele Spuren oder gleich das nächste Manöver. */
  #complex(m) {
    if (!m) return false;
    if ([26, 20, 21, 23, 24].includes(m.type)) return true;
    if ((lanesAt(this.#extras, m.at)?.length ?? 0) >= 3) return true;
    const next = this.#route.maneuvers[this.#current + 1];
    return !!next && next.at - m.at < 150 && ![4, 5, 6].includes(next.type);
  }

  /** Durchfahrene Zwischenziele aus der Liste für Neuberechnungen streichen. */
  #passVias(along) {
    const vias = this.#route.maneuvers.filter((m) => m.via);
    const passed = vias.filter((m) => m.at <= along + 15).length;
    const keep = vias.length - passed + 1;
    if (this.#targets.length > keep) {
      this.#targets = this.#targets.slice(this.#targets.length - keep);
      this.#paintTargets();
    }
  }

  /** Ziel (Fahne) und offene Zwischenstopps immer auf der Karte – auch nach Neuberechnung. */
  #paintTargets() {
    this.#targetMarkers.forEach((m) => m.remove());
    this.#targetMarkers = this.#targets.map((p, i) => {
      const dest = i === this.#targets.length - 1;
      const el = document.createElement('div');
      el.className = `wp-marker nav-target ${dest ? 'dest' : 'via'}`;
      el.innerHTML = dest ? '<span class="msr">location_on</span>' : `<span class="wp-num">${i + 1}</span>`;
      return new maplibregl.Marker({ element: el, anchor: dest ? 'bottom' : 'center' }).setLngLat(p).addTo(this.#map);
    });
  }

  /** Erste Ansage; die darin genannte Anweisung gilt danach als „früh angesagt“. */
  #startText() {
    const ms = this.#route.maneuvers;
    const k = ms.findIndex((m, i) => i > 0 && ![7, 8, 22].includes(m.type));
    const first = ms[k];
    const p = first ? phrases(first, { extras: this.#extras }) : null;
    if (!p?.soon || first.at <= 200) return 'Die Route ist berechnet.';
    this.#said.set(k, { far: true, near: false });
    return `Die Route ist berechnet. ${p.soon(speakDistance(first.at)) ?? ''}`;
  }

  #instruct(along) {
    const ms = this.#route.maneuvers;
    let k = ms.findIndex((m, i) => i > 0 && m.at > along + 3);
    if (k < 0) k = ms.length - 1;
    const m = ms[k];
    const next = ms[k + 1];
    const dist = Math.max(0, m.at - along);
    const { far, near } = PROFILES[this.#profile].announce;
    // Schnell unterwegs: früher ansagen (20 s bzw. 6 s vorher)
    const farM = Math.max(far, this.#speed * 20);
    const nearM = Math.max(near, this.#speed * 6);
    const p = phrases(m, { extras: this.#extras, next, place: this.#towardPlace(k) });
    this.#towardPlace(k + 1);                     // schon mal nachschlagen

    // Gerade ein Manöver hinter uns gelassen und bis zum nächsten ist es weit
    if (k !== this.#current) {
      if (this.#current >= 0 && dist > 1500) speech.say(`${speakDistance(dist).replace(/n$/, '')} der Route folgen.`);
      this.#current = k;
      this.#paintArrows(k);
    }

    const said = this.#said.get(k) ?? { far: false, near: false };
    if (!said.near && dist <= nearM) {
      speech.say(p.now);
      said.near = said.far = true;
    } else if (!said.far && dist <= farM && dist > nearM * 1.8) {
      speech.say(p.soon(speakDistance(dist)));
      said.far = true;
    }
    this.#said.set(k, said);

    const $ = (s) => this.#el.querySelector(s);
    $('.nav-icon').textContent = maneuverIcon(m);
    const exit = $('.nav-exit');
    exit.hidden = m.type !== 26 || !m.roundabout_exit_count;
    exit.textContent = m.roundabout_exit_count ? `${m.roundabout_exit_count}.` : '';
    $('.nav-dist').textContent = fmtDistance(dist);
    // Oben lesen darf man Straßennamen – dazu Nummer und Richtung vom Schild
    const street = [4, 5, 6].includes(m.type) ? m.instruction
      : m.type === 26 ? `${m.roundabout_exit_count ?? ''}. Ausfahrt`
        : p.ref ?? m.street_names?.join(' / ') ?? m.instruction;
    $('.nav-instr').textContent = street;
    const toward = $('.nav-toward');
    toward.hidden = !p.toward?.length;
    toward.textContent = p.toward?.length ? `Richtung ${p.toward.join(', ')}` : '';

    // Fahrspuren bis 1,5 km vorher, dazu „links einordnen“
    // Spuren wie bei Google: die der nächsten Kreuzung voraus, auch wenn dort
    // nur geradeaus geht – mit allen Pfeilen, die richtigen hervorgehoben
    const ahead = (this.#extras?.lanes ?? []).find((x) => x.at > along + 5 && x.at < along + 700 && x.at <= m.at + 40 && x.lanes.length >= 2);
    const lanes = ahead?.lanes ?? (dist < 1500 ? lanesAt(this.#extras, m.at) : null);
    const lanesEl = $('.nav-lanes');
    lanesEl.hidden = !lanes;
    if (lanes) {
      // Alle Spuren mit ihren Pfeilen; die richtigen weiß hinterlegt, in
      // ihnen der Pfeil, der gilt, kräftig
      lanesEl.innerHTML = lanes.map((l) => {
        const dirs = l.dirs.length ? l.dirs : ['straight'];
        return `<span class="lane${l.use ? ' use' : ''}">${dirs.slice(0, 3).map((d) =>
          `<span class="msr${l.use && l.act && d !== l.act ? ' off' : ''}">${LANE_ICON[d] ?? 'straight'}</span>`).join('')}</span>`;
      }).join('') + (p.hint && dist < 1500 ? `<span class="lane-hint">${p.hint === 'links' ? 'Links' : 'Rechts'} einordnen</span>` : '');
    }

    // „Dann …“ nur, wenn das übernächste Manöver dicht folgt
    const then = $('.nav-then');
    then.hidden = !next || next.at - m.at > 250;
    if (!then.hidden) then.innerHTML = `Dann <span class="msr">${esc(maneuverIcon(next))}</span>`;
    return dist;
  }

  /**
   * Ohne Wegweiser und Nummer: Wohin führt die Route nach dem Manöver? Der
   * Ort 3 km weiter – im selben Ort der Stadtteil. Einmal je Manöver
   * nachgeschlagen; bis die Antwort da ist, geht es ohne.
   */
  #towardPlace(k) {
    const r = this.#route;
    const key = `${r.id}:${k}`;
    if (this.#towards.has(key)) return this.#towards.get(key);
    this.#towards.set(key, null);
    const m = r.maneuvers[k];
    if (!m || !navigator.onLine || !NEEDS_DIRECTION.has(m.type)) return null;
    const probe = phrases(m, { extras: this.#extras });
    if (probe.toward?.length || probe.ref) return null;
    const ahead = Math.min(m.at + 3000, r.cum[r.cum.length - 1]);
    if (ahead - m.at < 400) return null;          // Ziel gleich hinter der Kurve
    Promise.all([reverse(pointAt(r.coords, r.cum, m.at)), reverse(pointAt(r.coords, r.cum, ahead))])
      .then(([here, there]) => {
        const a = here?.properties ?? {}, b = there?.properties ?? {};
        const town = (p) => p.city ?? p.town ?? p.village ?? null;
        const name = town(b) && town(b) !== town(a) ? town(b)
          : b.district && b.district !== a.district ? b.district : null;
        this.#towards.set(key, name);
      })
      .catch(() => {});
    return null;
  }

  #remaining(along) {
    const r = this.#route;
    const left = Math.max(0, r.cum[r.cum.length - 1] - along);
    const secs = r.time * (left / (r.cum[r.cum.length - 1] || 1));
    const $ = (s) => this.#el.querySelector(s);
    $('.nav-eta').textContent = fmtClock(new Date(Date.now() + secs * 1000));
    $('.nav-remaining').textContent = `${fmtDuration(secs)} · ${fmtDistance(left)}`;
  }

  /** Aktuelles Tempo und – wenn bekannt – das erlaubte. */
  #paintSpeed(along) {
    const $ = (s) => this.#el.querySelector(s);
    const kmh = Math.round(this.#speed * 3.6);
    const limit = limitAt(this.#extras, along);
    $('.nav-kmh strong').textContent = kmh;
    const lim = $('.nav-limit');
    lim.hidden = !limit || this.#profile === 'foot';
    lim.textContent = limit ?? '';
    $('.nav-speed').classList.toggle('over', !!limit && kmh > limit + 3);
    $('.nav-speed').hidden = this.#profile === 'foot' && kmh < 1;
  }

  /** Ortsname unten – alle 45 s bzw. 400 m nachfragen, nur mit Netz. */
  async #updatePlace(point) {
    const now = Date.now();
    if (!navigator.onLine || now - this.#place.t < 45000 || (this.#place.point && distance(this.#place.point, point) < 400)) return;
    this.#place = { t: now, point };
    try {
      const f = await reverse(point);
      const p = f?.properties ?? {};
      const town = p.city ?? p.town ?? p.village ?? p.locality ?? p.county ?? '';
      const part = p.district && p.district !== town ? p.district : '';
      this.#el.querySelector('.nav-place').textContent = [town, part].filter(Boolean).join(' · ');
    } catch { /* nicht wichtig */ }
  }

  #arrive() {
    if (this.#arrived) return;
    this.#arrived = true;
    const last = this.#route.maneuvers.at(-1);
    const said = this.#said.get(this.#route.maneuvers.length - 1);
    if (!said?.near) speech.say(last ? phrases(last).now : 'Sie haben Ihr Ziel erreicht.');
    this.#el.classList.add('arrived');
    const $ = (s) => this.#el.querySelector(s);
    $('.nav-icon').textContent = 'sports_score';
    $('.nav-exit').hidden = true;
    $('.nav-dist').textContent = 'Ziel erreicht';
    $('.nav-instr').textContent = last?.instruction ?? '';
    $('.nav-toward').hidden = true;
    $('.nav-lanes').hidden = true;
    $('.nav-then').hidden = true;
    $('.nav-remaining').textContent = '0 min · 0 m';
    this.#onArrive?.(this.#route.coords.at(-1), this.#profile);
  }

  #status(text) {
    this.#el.querySelector('.nav-instr').textContent = text;
  }

  /* ── Karte: Pfeile an den Abbiegungen, Ampeln ────────────────────────────── */

  /** Pfeile für das nächste und übernächste Manöver auf die Route zeichnen. */
  #paintArrows(k) {
    const r = this.#route;
    const arrows = r.maneuvers.slice(k, k + 2)
      .filter((m) => ![0, 1, 2, 3, 4, 5, 6, 7, 8, 22, 27].includes(m.type))
      .map((m) => {
        const pts = [];
        for (let d = -28; d <= 22; d += 2) pts.push(pointAt(r.coords, r.cum, clamp(m.at + d, 0, r.cum[r.cum.length - 1])));
        return pts;
      });
    showNavExtras(this.#map, { arrows, signals: this.#signalPoints() });
  }

  #signalPoints() {
    const r = this.#route;
    return (this.#extras?.signals ?? []).map((m) => pointAt(r.coords, r.cum, m));
  }

  /**
   * Die Fahrbahn vor uns mit allen Spuren (nur Auto, braucht die Zusatzdaten).
   * Neu gezeichnet alle 150 m, nicht bei jeder Meldung.
   */
  #paintRoad(along) {
    const x = this.#extras;
    if (this.#profile !== 'car' || !x?.roads?.length) { this.#clearRoad(); return; }
    const step = Math.floor(along / 150);
    const key = `${this.#route.id}:${step}`;
    if (key === this.#roadFor) return;
    this.#roadFor = key;
    const from = Math.max(0, step * 150 - 100);
    const to = step * 150 + 1000;
    // Nur übernehmen, wo die Daten lückenlos sind – sonst fehlte die Route
    const known = x.roads.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
    const end = Math.min(to, this.#route.cum[this.#route.cum.length - 1]);
    if (known < (end - from) * 0.97) { this.#clearRoad(); return; }
    this.#cover = [from, to];
    showNavRoad(this.#map, roadFeatures(this.#route, x, from, to, { left: this.#leftStretches() }));
  }

  /** Wo links fahren: 500 m vor dem Linksabbiegen oder wenn die Spuren es sagen. */
  #leftStretches() {
    const r = this.#route;
    if (this.#lefts?.route === r && this.#lefts.extras === this.#extras) return this.#lefts.list;
    const list = [];
    for (const m of r.maneuvers ?? []) {
      const hint = laneHint(lanesAt(this.#extras, m.at));
      if (hint === 'links' || (!hint && [14, 15, 16, 19, 21, 24, 38].includes(m.type))) list.push([m.at - 500, m.at]);
    }
    this.#lefts = { route: r, extras: this.#extras, list };
    return list;
  }

  #clearRoad() {
    if (!this.#roadFor && !this.#cover) return;
    this.#roadFor = null;
    this.#cover = null;
    showNavRoad(this.#map, []);
  }

  #paintExtras() {
    if (this.#route) this.#paintArrows(Math.max(this.#current, 1));
  }

  /* ── Knöpfe ───────────────────────────────────────────────────────────────── */

  #setFollowing(on) {
    this.#following = on;
    const btn = this.#el.querySelector('.nav-recenter');
    btn.classList.toggle('following', on);
    btn.setAttribute('aria-pressed', String(on));
    this.#paintButtons();
  }

  #paintButtons() {
    const $ = (s) => this.#el.querySelector(s);
    const mute = $('.nav-mute');
    mute.querySelector('.msr').textContent = speech.muted ? 'volume_off' : 'volume_up';
    mute.title = speech.muted ? 'Ansagen einschalten' : 'Ansagen stummschalten';
    const follow = $('.nav-recenter');
    follow.querySelector('.msr').textContent = !this.#following ? 'my_location' : navSettings.threeD ? 'navigation' : 'explore';
    follow.title = !this.#following ? 'Zurück zu meinem Standort'
      : navSettings.threeD ? 'Folgt dir – antippen: flache Ansicht' : 'Folgt dir – antippen: geneigte Ansicht';
    $('.nav-compass').classList.toggle('north', navSettings.north);
    $('.nav-compass').title = navSettings.north ? 'In Fahrtrichtung drehen' : 'Norden oben';
  }

  #paintCompass(b) {
    const needle = this.#el.querySelector('.nav-compass svg');
    if (needle) needle.style.transform = `rotate(${-b}deg)`;
  }

  /** Den Rest der Strecke im Überblick zeigen – flach und nach Norden. */
  #overview() {
    const r = this.#route;
    if (!r) return;
    this.#setFollowing(false);
    const rest = r.coords.slice(this.#index);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of rest) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    const top = this.#el.querySelector('.nav-top').getBoundingClientRect().bottom + 24;
    const bottom = this.#el.querySelector('.nav-bar').getBoundingClientRect().height + 24;
    this.#map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.#map.fitBounds([[w, s], [e, n]], { padding: { top, bottom, left: 32, right: 80 }, pitch: 0, bearing: 0, duration: 900, maxZoom: 16 });
    // Nach dem Überblick wieder mit Rand oben folgen
    this.#map.once('moveend', () => {
      const h = this.#map.getContainer().clientHeight;
      if (this.#route) this.#map.setPadding({ top: h * 0.52, bottom: 80, left: 0, right: 0 });
    });
  }

  /**
   * Verfahren: ab dem eigenen Standort neu rechnen, in Fahrtrichtung – eine
   * einzige Anfrage ohne Alternativen, damit es schnell geht.
   */
  async #reroute(point, heading, { announce = 'Route wird neu berechnet.' } = {}) {
    if (this.#rerouting || Date.now() - this.#lastReroute < REROUTE_PAUSE_MS) return;
    this.#rerouting = true;
    this.#lastReroute = Date.now();
    const r = this.#route;
    const snap = nearestOnLine(r.coords, r.cum, point);
    this.#onReroute?.({ point, planned: r.coords.slice(snap.index, snap.index + 60) });
    // Ohne Netz geht es nicht – dann einmal sagen und zurück zur Route lotsen
    if (!navigator.onLine) {
      this.#offlineHint();
      this.#rerouting = false;
      return;
    }
    speech.say(announce);
    this.#status(announce.replace(/\.$/, ' …'));
    try {
      const route = await fetchReroute([point, ...this.#targets], this.#profile, { highways: this.#highways, heading });
      if (!this.#route) return;
      route.id = this.#route.id;
      this.#route = route;
      this.#extras = null;
      this.#reset();
      speech.say(this.#startText().replace('Die Route ist berechnet.', '').trim() || 'Neue Route berechnet.');
      this.#said.set(0, { far: true, near: true });
      this.#paintTargets();
      this.#onRoute?.(route, { profile: this.#profile, highways: this.#highways, targets: this.#targets });
      this.#loadExtras();
      const f = this.#lastFix;
      this.#lastFix = null;
      this.#update(f ? { ...f } : { point, heading, speed: 0, accuracy: 5 });
    } catch (err) {
      if (err instanceof TypeError || !navigator.onLine) this.#offlineHint();
      else this.#status(err.message);
    } finally {
      this.#rerouting = false;
    }
  }

  #offlineHint() {
    this.#status('Offline – zurück zur Route, neu berechnen geht erst wieder mit Netz');
    if (Date.now() - (this.#offlineSaid ?? 0) > 120000) {
      speech.say('Keine Verbindung. Bitte zur Route zurückkehren.');
      this.#offlineSaid = Date.now();
    }
  }

  /**
   * Zum Ausprobieren ohne GPS: `?sim` fährt die Route ab (im Auto so schnell
   * wie erlaubt). `?sim=verfahren` biegt an der ersten Abzweigung nicht ab,
   * sondern fährt 250 m geradeaus. `?sim=rauschen` streut die Punkte wie ein
   * echtes GPS (± 8 m, ab und zu ein Ausreißer).
   */
  #simulate() {
    const q = new URLSearchParams(location.search);
    const mode = q.get('sim');
    // ?tempo=4 – Zeitraffer zum Testen
    const tempo = Math.min(10, Math.max(1, Number(q.get('tempo')) || 1));
    const base = { foot: 1.5, bike: 5 }[this.#profile];
    let astray = mode === 'verfahren';
    let route = null, m = 0, straight = null, n = 0;
    const noise = (p) => {
      if (mode !== 'rauschen') return p;
      n += 1;
      const d = n % 17 === 0 ? 60 : Math.random() * 8;
      return destination(p, Math.random() * 360, d);
    };
    this.#sim = setInterval(() => {
      const r = this.#route;
      if (!r) return;
      if (r !== route) { route = r; m = 0; }
      const speed = base ?? Math.min(33, (limitAt(this.#extras, m) ?? 50) / 3.6);
      if (straight) {
        straight.left -= speed;
        straight.p = destination(straight.p, straight.dir, speed);
        this.#update({ point: straight.p, heading: straight.dir, speed, accuracy: 5 });
        if (straight.left <= 0) straight = null;
        return;
      }
      m += speed;
      const turn = astray && r.maneuvers.find((x, i) => i > 0 && x.at > 150 && x.at <= m);
      if (turn) {
        const p = pointAt(r.coords, r.cum, turn.at);
        straight = { p, dir: bearing(pointAt(r.coords, r.cum, turn.at - 20), p), left: 250 };
        astray = false;
        return;
      }
      const p = pointAt(r.coords, r.cum, m);
      const ahead = pointAt(r.coords, r.cum, m + 5);
      this.#update({ point: noise(p), heading: mode === 'rauschen' ? null : bearing(p, ahead), speed: mode === 'rauschen' ? null : speed, accuracy: mode === 'rauschen' ? 10 : 5 });
      if (m > r.cum[r.cum.length - 1]) clearInterval(this.#sim);
    }, 1000 / tempo);
  }
}
