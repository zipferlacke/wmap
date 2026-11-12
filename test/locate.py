"""Standort in der App (js/app/core.js showDot/locateNow, js/core/native.js geo.wake) – mit nachgebildetem Plugin:
1. Start der Karte ohne Freigabe: Android fragt gleich (request_permissions), danach läuft die Abfrage für den Punkt.
2. Die Abfrage meldet nichts mehr (Zug, Tunnel): Ein Tipp auf den Standort-Knopf startet sie neu und holt den
   Standort selbst (get_current_position) – der Punkt steht da, die Karte springt hin.
3. Nochmal getippt: Standort aus – dann wird nichts geholt.
4. Standort am Handy aus: Meldung „Der Standort ist am Handy ausgeschaltet“.
5. Es kommt nichts: nach 12 s „Noch kein Standort – WMap sucht weiter“.
6. Zweiter Start in derselben Sitzung ohne Freigabe: nicht noch einmal gefragt."""
import sys
import time
from common import Browser

PRELOAD = """() => {
  const G = window.__geo = { perm: 'prompt', requests: 0, watches: [], cleared: 0, once: 0, fail: null, hang: false };
  const pos = (lon, lat) => ({ coords: { longitude: lon, latitude: lat, accuracy: 8, speed: null, heading: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() });
  window.__TAURI__ = { core: {
    Channel: class { constructor() { this.id = Math.round(Math.random() * 1e9); this.onmessage = null; } },
    invoke: async (cmd, args) => {
      if (cmd === 'plugin:geolocation|check_permissions') return { location: G.perm, coarseLocation: G.perm };
      if (cmd === 'plugin:geolocation|request_permissions') { G.requests += 1; if (G.allow !== false) G.perm = 'granted'; return {}; }
      if (cmd === 'plugin:geolocation|watch_position') { G.watches.push(args.options.timeout); return null; }
      if (cmd === 'plugin:geolocation|clear_watch') { G.cleared += 1; return null; }
      if (cmd === 'plugin:geolocation|get_current_position') {
        G.once += 1;
        if (G.hang) return new Promise(() => {});
        if (G.fail) throw G.fail;
        return pos(9.935, 51.533);
      }
      if (cmd.startsWith('plugin:geolocation|')) return null;
      // Overpass (Orte in der Nähe): leer – nicht an die echten Server
      if (cmd === 'overpass') return [200, '{"elements":[]}'];
      // Andere Befehle (Overpass, Ordner …) kennt die nachgebildete App nicht – wie eine ältere App
      throw new Error(`command ${cmd} not found`);
    },
  } };
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile' });
}"""

STATE = """const g = window.__geo; const btn = window.__gl?._geolocateButton;
return { st: window.__gl?._watchState ?? null, requests: g.requests, watches: g.watches.length, once: g.once, btn: btn ? [...btn.classList].filter((c) => c.startsWith('maplibregl-ctrl-geolocate-')).join(' ') : null,
  toast: document.getElementById('toast')?.classList.contains('show') ? document.getElementById('toast').textContent : (document.getElementById('toast')?.textContent ?? ''),
  center: (() => { const c = window.__map?.getCenter?.(); return c ? [Math.round(c.lng * 1000) / 1000, Math.round(c.lat * 1000) / 1000] : null; })() }"""

with Browser(width=420, height=860) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.open('index.html', wait=1)
    b.js("sessionStorage.removeItem('wmap.location.asked')")
    b.open('index.html', wait=1)
    # Erst wenn die Karte geladen ist, startet der Punkt (im Hintergrund) – vorher getippt liefe es durcheinander
    b.wait("return document.querySelector('.maplibregl-ctrl-geolocate-background')", 40)
    # Die Karte der Seite (ein eigener import() legt eine zweite an)
    b.js("window.__map = window.__wmap.map; window.__gl = window.__map._controls.find((c) => c._geolocateButton)")
    start = b.js(STATE)
    print('Start:', start)
    # 2. Abfrage meldet nichts – Tipp auf den Knopf
    b.js("window.__gl._geolocateButton.click()")
    time.sleep(4)
    tap = b.js(STATE)
    print('Tipp:', tap)
    # 3. nochmal: aus
    b.js("window.__gl._geolocateButton.click()")
    time.sleep(1)
    off = b.js(STATE)
    print('aus:', off)
    # 4. Standort am Handy aus
    b.js("window.__geo.fail = 'Location disabled.'")
    b.js("window.__gl._geolocateButton.click()")
    time.sleep(1.5)
    disabled = b.js(STATE)
    print('am Handy aus:', disabled)
    # 5. es kommt nichts
    b.js("window.__geo.fail = null; window.__geo.hang = true")
    b.js("window.__gl._geolocateButton.click()")
    time.sleep(1)
    b.js("window.__gl._geolocateButton.click()")
    time.sleep(13.5)
    hang = b.js(STATE)
    print('nichts:', hang)
    # 6. zweiter Start ohne Freigabe in derselben Sitzung (abgelehnt)
    b.js("window.__geo.perm = 'prompt'; window.__geo.allow = false; window.__geo.requests = 0")
    b.open('index.html', wait=4)
    again = b.js(STATE)
    print('zweiter Start:', again)
    b.js("sessionStorage.removeItem('wmap.location.asked')")
    checks = {
        '1. Start ohne Freigabe: Android fragt gleich, danach läuft die Abfrage, Knopf „im Hintergrund“': start['requests'] == 1 and start['watches'] >= 1 and 'background' in (start['btn'] or ''),
        '2. Tipp bei stummer Abfrage: neu gestartet und selbst geholt, die Karte steht am Standort': tap['watches'] > start['watches'] and tap['once'] >= 1 and tap['center'] == [9.935, 51.533] and 'active' in (tap['btn'] or ''),
        '3. nochmal getippt (aus): nichts geholt': off['once'] == tap['once'],
        '4. Standort am Handy aus: Meldung': disabled['toast'] == 'Der Standort ist am Handy ausgeschaltet',
        '5. es kommt nichts: nach 12 s „Noch kein Standort“': hang['toast'].startswith('Noch kein Standort'),
        '6. zweiter Start in derselben Sitzung: nicht noch einmal gefragt': again['requests'] == 0,
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
