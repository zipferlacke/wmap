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
 */
const core = window.__TAURI__?.core;
// Das Plugin gibt es nur in den Handy-Apps (siehe src-tauri/Cargo.toml)
const nativeGeo = !!core && /Android|iPhone|iPad/i.test(navigator.userAgent);

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
 * selten. Darum hier eine gemeinsame Abfrage, jede Sekunde, für alle.
 */
const INTERVAL_MS = 1000;
const listeners = new Set();
let shared = null;        // { channel } der laufenden Abfrage
let stopTimer = null;

function startShared(options) {
  clearTimeout(stopTimer);
  if (shared) return;
  const channel = new core.Channel();
  shared = { channel };
  channel.onmessage = (p) => {
    for (const l of listeners) (p?.coords ? l.ok(p) : l.fail?.({ code: 2, message: String(p) }));
  };
  core.invoke('plugin:geolocation|watch_position', { options: { ...toNative(options), timeout: INTERVAL_MS }, channel })
    .catch((err) => {
      if (shared?.channel === channel) shared = null;
      const e = { code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) };
      for (const l of listeners) l.fail?.(e);
    });
}

/** Erst kurz warten: Wer neu startet (Navigation nach Stille), bekommt dieselbe Abfrage */
function stopShared() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (listeners.size || !shared) return;
    core.invoke('plugin:geolocation|clear_watch', { channelId: shared.channel.id }).catch(() => {});
    shared = null;
  }, 500);
}

/** Positionsmeldung wie bei navigator.geolocation: { coords, timestamp } */
export const geo = {
  native: nativeGeo,

  /** → Kennung zum Beenden */
  watch(ok, fail, options = {}) {
    if (!nativeGeo) return navigator.geolocation.watchPosition(ok, fail, options);
    const id = { ok, fail, native: true, cleared: false };
    allowed(options).then((yes) => {
      if (id.cleared) return;
      if (!yes) { fail?.(DENIED); return; }
      listeners.add(id);
      startShared(options);
    });
    return id;
  },

  clear(id) {
    if (id === null || id === undefined) return;
    if (!id?.native) { navigator.geolocation.clearWatch(id); return; }
    id.cleared = true;
    listeners.delete(id);
    stopShared();
  },

  once(ok, fail, options = {}) {
    if (!nativeGeo) { navigator.geolocation.getCurrentPosition(ok, fail, options); return; }
    allowed(options).then((yes) => {
      if (!yes) { fail?.(DENIED); return; }
      core.invoke('plugin:geolocation|get_current_position', { options: toNative(options) })
        .then(ok, (err) => fail?.({ code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) }));
    });
  },

  available: () => nativeGeo || 'geolocation' in navigator,
};

const toNative = ({ enableHighAccuracy = true, timeout = 10000, maximumAge = 0 } = {}) => ({ enableHighAccuracy, timeout, maximumAge });

/**
 * Version der App selbst („2.1.0“) – steht in der Programmdatei, nicht in der
 * Oberfläche von app.wuefl.de (config.js APP_VERSION), und ändert sich nur mit
 * einem neuen Build. Im Browser null.
 */
export const appVersion = () => Promise.resolve(window.__TAURI__?.app?.getVersion?.() ?? null).catch(() => null);
