/**
 * Geräte-Funktionen – Web zuerst. Im Browser (und in der Desktop-App) die
 * normalen Web-Schnittstellen; in der Android-/iOS-App über Tauri, sobald
 * das jeweilige Plugin da ist. Die Webversion verliert dadurch nichts.
 *
 * Bisher: Standort. Das Tauri-Plugin „geolocation“ liefert auf dem Handy
 * dieselben Daten wie der Browser, läuft aber als echte App weiter, wenn
 * der Bildschirm aus ist.
 */
const core = window.__TAURI__?.core;
// Das Plugin gibt es nur in den Handy-Apps (siehe src-tauri/Cargo.toml)
const nativeGeo = !!core && /Android|iPhone|iPad/i.test(navigator.userAgent);

/** Positionsmeldung wie bei navigator.geolocation: { coords, timestamp } */
export const geo = {
  native: nativeGeo,

  /** → Kennung zum Beenden */
  watch(ok, fail, options = {}) {
    if (!nativeGeo) return navigator.geolocation.watchPosition(ok, fail, options);
    const channel = new core.Channel();
    channel.onmessage = (p) => (p?.coords ? ok(p) : fail?.({ code: 2, message: String(p) }));
    const id = { channel, native: true };
    core.invoke('plugin:geolocation|watch_position', { options: toNative(options), channel })
      .catch((err) => fail?.({ code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) }));
    return id;
  },

  clear(id) {
    if (id === null || id === undefined) return;
    if (!id?.native) { navigator.geolocation.clearWatch(id); return; }
    core.invoke('plugin:geolocation|clear_watch', { channelId: id.channel.id }).catch(() => {});
  },

  once(ok, fail, options = {}) {
    if (!nativeGeo) { navigator.geolocation.getCurrentPosition(ok, fail, options); return; }
    core.invoke('plugin:geolocation|get_current_position', { options: toNative(options) })
      .then(ok, (err) => fail?.({ code: /denied|permission/i.test(String(err)) ? 1 : 2, message: String(err) }));
  },

  available: () => nativeGeo || 'geolocation' in navigator,
};

const toNative = ({ enableHighAccuracy = true, timeout = 10000, maximumAge = 0 } = {}) => ({ enableHighAccuracy, timeout, maximumAge });
