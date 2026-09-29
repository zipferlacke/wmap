/**
 * Geräte-Funktionen – Web zuerst. Im Browser (und in der Desktop-App) die
 * normalen Web-Schnittstellen; in der Android-/iOS-App über Tauri, sobald
 * das jeweilige Plugin da ist. Die Webversion verliert dadurch nichts.
 *
 * Bisher: Standort. Das Tauri-Plugin „geolocation“ liefert auf dem Handy
 * dieselben Daten wie der Browser, läuft aber als echte App weiter, wenn
 * der Bildschirm aus ist. Fehlt dort die Freigabe, kommt vorher der Dialog
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

/** Positionsmeldung wie bei navigator.geolocation: { coords, timestamp } */
export const geo = {
  native: nativeGeo,

  /** → Kennung zum Beenden */
  watch(ok, fail, options = {}) {
    if (!nativeGeo) return navigator.geolocation.watchPosition(ok, fail, options);
    const channel = new core.Channel();
    channel.onmessage = (p) => (p?.coords ? ok(p) : fail?.({ code: 2, message: String(p) }));
    const id = { channel, native: true, cleared: false };
    allowed(options).then((ok) => {
      if (id.cleared) return;
      if (!ok) { fail?.(DENIED); return; }
      core.invoke('plugin:geolocation|watch_position', { options: toNative(options), channel })
        .catch((err) => fail?.({ code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) }));
    });
    return id;
  },

  clear(id) {
    if (id === null || id === undefined) return;
    if (!id?.native) { navigator.geolocation.clearWatch(id); return; }
    id.cleared = true;
    core.invoke('plugin:geolocation|clear_watch', { channelId: id.channel.id }).catch(() => {});
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
