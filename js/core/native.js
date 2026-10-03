/**
 * Geräte-Funktionen – Web zuerst. Im Browser (und in der Desktop-App) die
 * normalen Web-Schnittstellen; in der Android-/iOS-App über Tauri, sobald
 * das jeweilige Plugin da ist. Die Webversion verliert dadurch nichts.
 *
 * Bisher: Standort. Das Tauri-Plugin „geolocation“ liefert auf dem Handy
 * dieselben Daten wie der Browser. Wie dort ruht es, solange die App im
 * Hintergrund bzw. der Bildschirm aus ist (das Plugin beendet die Abfrage
 * in onPause, onResume startet sie neu). Fehlt die Freigabe, kommt vorher der Dialog
 * zu den Berechtigungen (ui/permissions.js); mit `ask: false` in den
 * Optionen (Start der Karte) wird still abgelehnt.
 *
 * Darf die Seite das Plugin nicht aufrufen („… not allowed“ – Capability
 * fehlt, z. B. in einer älteren App, die diese Oberfläche aus dem Netz lädt),
 * geht es über den Standort des WebViews weiter.
 */
import { trustedSpeed } from './smooth.js';

const core = window.__TAURI__?.core;
// Das Plugin gibt es nur in den Handy-Apps (siehe src-tauri/Cargo.toml)
let nativeGeo = !!core && /Android|iPhone|iPad/i.test(navigator.userAgent);
const notAllowed = (err) => /not allowed/i.test(String(err));
// Der Standort des Browsers bzw. WebViews – nie der eigene Ersatz für die Karte (geolocationApi)
const realGeo = navigator.geolocation;
const webGeo = () => (navigator.geolocation?.wmapShim ? realGeo : navigator.geolocation);

const DENIED = { code: 1, message: 'Standortfreigabe verweigert' };
/** Freigabe da? Sonst erst der Dialog (nicht beim still gemeinten Abfragen) */
const allowed = async (options) => {
  const { locationAccess } = await import('../ui/permissions.js');
  return locationAccess({ ask: options.ask !== false });
};

/*
 * Das Plugin hat nur einen Empfänger: Jede neue Abfrage ersetzt die vorige
 * (Navigation und Aufzeichnung zugleich ginge nicht). Und es nimmt `timeout`
 * als Abstand zwischen zwei Meldungen – 10 s wären für die Navigation viel zu
 * selten. Darum hier eine gemeinsame Abfrage für alle, so oft, wie der
 * Eifrigste es braucht: Navigation und Aufzeichnung jede Sekunde, der Punkt
 * auf der Karte je nach Bewegung jede Sekunde bis alle 30 s (`interval` in
 * den Optionen, `geo.retime`).
 */
const INTERVAL_MS = 1000;
const listeners = new Set();
let shared = null;        // { channel, interval } der laufenden Abfrage
let stopTimer = null;
/*
 * Beantwortet die App „watch_position“? Bis App 2.1.0 tat das Plugin das nie –
 * und jeder offene Aufruf hielt einen Arbeits-Thread der App fest; nach acht
 * antwortete sie auf nichts mehr („Webseite nicht verfügbar“). Die App bringt
 * das Plugin jetzt korrigiert mit (src-tauri/plugins/geolocation/WMAP.md).
 * Solange keine Antwort kam, wird nur neu gestartet, wenn es öfter sein muss.
 */
let answers = false;
const wanted = () => Math.min(...[...listeners].map((l) => l.interval));

function startShared(options) {
  clearTimeout(stopTimer);
  const interval = wanted();
  if (shared?.interval === interval) return;
  if (shared && !answers && interval > shared.interval) return;
  // Anderer Abstand gebraucht: die alte Abfrage beenden, eine neue starten
  if (shared) core.invoke('plugin:geolocation|clear_watch', { channelId: shared.channel.id }).catch(() => {});
  const channel = new core.Channel();
  shared = { channel, interval, options };
  channel.onmessage = (p) => {
    for (const l of listeners) (p?.coords ? l.ok(p) : l.fail?.({ code: 2, message: String(p) }));
  };
  core.invoke('plugin:geolocation|watch_position', { options: { ...toNative(options), timeout: interval }, channel })
    .then(() => { answers = true; })
    .catch((err) => {
      if (shared?.channel === channel) shared = null;
      if (notAllowed(err)) {
        // Ohne Recht aufs Plugin: alle Wartenden über den WebView-Standort
        nativeGeo = false;
        for (const l of listeners) l.web = webGeo().watchPosition(l.ok, l.fail, options);
        listeners.clear();
        return;
      }
      const e = { code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) };
      for (const l of listeners) l.fail?.(e);
    });
}

/**
 * Erst kurz warten: Wer neu startet (Navigation nach Stille), bekommt dieselbe
 * Abfrage. Bleibt nur der Punkt auf der Karte, wird sie wieder seltener.
 */
function stopShared() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (!shared) return;
    if (listeners.size) { if (wanted() !== shared.interval) startShared(shared.options); return; }
    core.invoke('plugin:geolocation|clear_watch', { channelId: shared.channel.id }).catch(() => {});
    shared = null;
  }, 500);
}

/** Positionsmeldung wie bei navigator.geolocation: { coords, timestamp } */
export const geo = {
  get native() { return nativeGeo; },

  /** → Kennung zum Beenden */
  watch(ok, fail, options = {}) {
    if (!nativeGeo) return webGeo().watchPosition(ok, fail, options);
    const id = { ok, fail, native: true, cleared: false, web: null, interval: options.interval ?? INTERVAL_MS };
    allowed(options).then((yes) => {
      if (id.cleared) return;
      if (!yes) { fail?.(DENIED); return; }
      if (!nativeGeo) { id.web = webGeo().watchPosition(ok, fail, options); return; }
      listeners.add(id);
      startShared(options);
    });
    return id;
  },

  /** Anderer Abstand für eine laufende Abfrage (nur App; im Browser bestimmt ihn der Browser) */
  retime(id, interval) {
    if (!id?.native || id.cleared || id.interval === interval) return;
    id.interval = interval;
    if (shared && listeners.has(id) && wanted() !== shared.interval) startShared(shared.options);
  },

  clear(id) {
    if (id === null || id === undefined) return;
    if (!id?.native) { webGeo().clearWatch(id); return; }
    id.cleared = true;
    if (id.web !== null) webGeo().clearWatch(id.web);
    listeners.delete(id);
    stopShared();
  },

  once(ok, fail, options = {}) {
    if (!nativeGeo) { webGeo().getCurrentPosition(ok, fail, options); return; }
    allowed(options).then((yes) => {
      if (!yes) { fail?.(DENIED); return; }
      if (!nativeGeo) { webGeo().getCurrentPosition(ok, fail, options); return; }
      core.invoke('plugin:geolocation|get_current_position', { options: toNative(options) })
        .then(ok, (err) => {
          if (!notAllowed(err)) { fail?.({ code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) }); return; }
          nativeGeo = false;
          webGeo().getCurrentPosition(ok, fail, options);
        });
    });
  },

  available: () => nativeGeo || 'geolocation' in navigator,

  /**
   * Aufzeichnen bei ausgeschaltetem Bildschirm – nur die Android-App (ab 2.2.0): Ein Dienst mit Benachrichtigung
   * sammelt den Standort, solange die App nicht zu sehen ist; zurück im Bild holt `take` das Gesammelte ab.
   * Ältere Apps, iOS und Browser kennen das nicht – `start` meldet dann false, und der Bildschirm bleibt an.
   */
  background: {
    /** → läuft der Dienst? `state`: Stand der Aufzeichnung für die Benachrichtigung (siehe `sync`) */
    async start(state = {}) {
      if (!nativeGeo || !/Android/i.test(navigator.userAgent)) return false;
      if (!(await allowed({}))) return false;
      try { await core.invoke('plugin:geolocation|start_recording', { state }); return true; } catch { return false; }
    },
    stop() {
      if (core) core.invoke('plugin:geolocation|stop_recording').catch(() => {});
    },
    /**
     * Stand abgleichen und abholen, was gesammelt wurde.
     * `state`: { started, distance, lon, lat } für Zeit und Strecke in der Benachrichtigung; mit `push` gilt
     * der Pause-Stand der Seite ({ paused, pausedAt, pausedMs }), sonst der des Dienstes („Pause“ in der
     * Benachrichtigung); `clearStop`: „Beenden“ ist angekommen.
     * → { points: [{ point, accuracy, time }], paused, pausedAt, pausedMs, stop } oder null
     */
    async sync(state = {}) {
      try {
        const r = await core.invoke('plugin:geolocation|take_recorded', { state });
        return { ...r, points: (r?.points ?? []).map(([x, y, accuracy, time]) => ({ point: [x, y], accuracy, time })) };
      } catch { return null; }
    },
  },
};

/**
 * Wie navigator.geolocation, aber über geo – für MapLibres GeolocateControl
 * (der Punkt auf der Karte): so nutzt er in der App dieselbe Abfrage wie die
 * Navigation. Der Abstand richtet sich nach der Bewegung (paced).
 */
export function geolocationApi() {
  const ids = new Map();
  let next = 1;
  return {
    wmapShim: true,
    watchPosition(ok, fail, options = {}) {
      const n = next++;
      const pace = paced();
      const id = geo.watch((pos) => { pace.fix(pos); ok(pos); }, fail, { ...options, interval: PACE[0] });
      pace.start(id);
      ids.set(n, { id, pace });
      return n;
    },
    clearWatch(n) { const w = ids.get(n); w?.pace.stop(); geo.clear(w?.id); ids.delete(n); },
    getCurrentPosition(ok, fail, options = {}) { geo.once(ok, fail, options); },
  };
}

/*
 * Wie oft der Punkt auf der Karte fragt: in Bewegung jede Sekunde, wer steht,
 * nach 15 s alle 5 s, nach einer Minute alle 30 s – das GPS ruht dazwischen.
 * Bewegung: das GPS misst Tempo (dem man trauen kann, core/smooth.js) oder man ist weiter weg als die Ungenauigkeit
 * (mindestens 10 m). Damit man beim Losgehen nicht bis zu 30 s wartet, meldet
 * der Beschleunigungssensor Schritte oder Fahrt gleich (devicemotion) – dann
 * sofort wieder jede Sekunde. Navigation und Aufzeichnen fragen ohnehin jede
 * Sekunde (gemeinsame Abfrage: der Eifrigste zählt).
 */
const PACE = [1000, 5000, 30000];
const PACE_AFTER = [0, 15000, 60000];

function paced() {
  let id = null, anchor = null, stillSince = Date.now(), level = 0, shakes = [];
  const trust = trustedSpeed();
  const set = (l) => {
    if (l === level) return;
    level = l;
    geo.retime(id, PACE[l]);
    if (l > 0) addEventListener('devicemotion', motion);
    else removeEventListener('devicemotion', motion);
  };
  const moved = () => { stillSince = Date.now(); set(0); };
  // Einige kräftige Rucke innerhalb von 2 s (Schritte, Anfahren) – ein einzelnes Antippen reicht nicht
  const motion = (e) => {
    const a = e.acceleration;
    if (!a || Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) < 1.5) return;
    const now = Date.now();
    shakes = shakes.filter((t) => now - t < 2000);
    shakes.push(now);
    if (shakes.length >= 6) { shakes = []; moved(); }
  };
  return {
    start(watchId) { id = watchId; },
    stop() { removeEventListener('devicemotion', motion); },
    fix(pos) {
      const c = pos.coords;
      const p = [c.longitude, c.latitude];
      const far = anchor && Math.hypot((p[0] - anchor[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (p[1] - anchor[1]) * 110540) > Math.max(10, c.accuracy ?? 0);
      if (!anchor || far || (trust(p, c.speed, c.accuracy, pos.timestamp ?? Date.now()) ?? 0) >= 1) { anchor = p; moved(); return; }
      const still = Date.now() - stillSince;
      set(still >= PACE_AFTER[2] ? 2 : still >= PACE_AFTER[1] ? 1 : 0);
    },
  };
}

const toNative = ({ enableHighAccuracy = true, timeout = 10000, maximumAge = 0 } = {}) => ({ enableHighAccuracy, timeout, maximumAge });

/**
 * Version der App selbst („2.1.0“) – steht in der Programmdatei, nicht in der
 * Oberfläche von app.wuefl.de (config.js APP_VERSION), und ändert sich nur mit
 * einem neuen Build. Im Browser null.
 */
export const appVersion = () => Promise.resolve(window.__TAURI__?.app?.getVersion?.() ?? null).catch(() => null);
