"""Navigation (nav/navigation.js): Im Stand hält der Pfeil trotz GPS-Rauschen still, das Tempo zeigt 0; geht man los,
läuft er wieder mit. Im Bild in Bild der Android-App (html.pip-mode, kleines Fenster) bleibt der Pfeil sichtbar.
Das GPS wird in der Seite nachgestellt (navigator.geolocation)."""
import json
import sys
import time
from common import Browser

# Läuft als Modul in der Seite selbst (Skripte aus WebDriver haben in Firefox eigene Module)
STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { nav } = await import('./js/app/nav.js');
  let send = null;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => ({
    watchPosition: (ok) => { send = ok; return 1; },
    clearWatch: () => {},
    getCurrentPosition: () => {},
  }) });
  document.querySelector('.start-nav').click();
  for (let i = 0; i < 100 && !nav.active; i++) await wait(100);
  const r = nav.route;
  // Ein Stück auf der Route, dort stehen und rauschen (±6 m, kleines Tempo)
  const [lon, lat] = r.coords[Math.min(3, r.coords.length - 1)];
  const fix = (x, y, speed) => send({ coords: { longitude: x, latitude: y, accuracy: 8, speed, heading: null }, timestamp: Date.now() });
  const m = 1 / 111000;
  const kmh = () => document.querySelector('.nav-kmh strong').textContent;
  const standing = [];
  for (let i = 0; i < 8; i++) {
    fix(lon + (Math.random() - 0.5) * 12 * m * 1.6, lat + (Math.random() - 0.5) * 12 * m, 0.1 + Math.random() * 0.4);
    await wait(700);
    standing.push([Math.round(nav.along * 10) / 10, kmh()]);
  }
  // Losgehen: entlang der Route, 1,4 m/s
  const walking = [];
  for (let i = 4; i < 12 && i < r.coords.length; i++) {
    const [x, y] = r.coords[i];
    fix(x, y, 1.4);
    await wait(700);
    walking.push([Math.round(nav.along), kmh()]);
  }
  return { standing, walking };
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=860) as b:
    b.open('index.html?from=9.9368,51.5413&to=9.9468,51.5343&profile=foot', wait=6)
    b.wait("return !!document.querySelector('.start-nav') && document.querySelector('.start-nav').checkVisibility()", 40)
    # Die Frage nach dem Mitmachen kommt vor der ersten Navigation – hier schon gesehen
    b.js("localStorage.setItem('wmap.contribute.seen', 'true')")
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 60))
    print(json.dumps(r, ensure_ascii=False))
    # Die ersten Meldungen: der Pfeil gleitet vom Start der Route zum Standpunkt – danach hält er
    held = [a for a, _ in r['standing'][4:]]
    still = isinstance(r, dict) and max(held) - min(held) < 0.5 and all(k == '0' for _, k in r['standing'][4:])
    moving = r['walking'][-1][0] > r['standing'][-1][0] + 10 and r['walking'][-1][1] != '0'
    print('Im Stand ruhig:', still, '· läuft wieder mit:', moving)
    if not (still and moving):
        b.errors.append(('stand', 'Pfeil rauscht im Stand bzw. läuft nicht wieder mit'))

    # Bild in Bild (Android-App): kleines Fenster, nur Karte und Anweisung – der Pfeil bleibt drin
    b.js("document.documentElement.classList.add('pip-mode')")
    b.d.set_window_size(300, 420)
    time.sleep(3)
    box = b.js("""const a = document.querySelector('.nav-me').getBoundingClientRect();
      const top = document.querySelector('.nav-banner').getBoundingClientRect().bottom;
      return { x: a.left + a.width / 2, y: a.top + a.height / 2, w: innerWidth, h: innerHeight, banner: top };""")
    print('Bild in Bild:', box)
    b.shot('nav-pip')
    inside = box['banner'] < box['y'] < box['h'] - 10 and 0 < box['x'] < box['w']
    print('Pfeil im Bild in Bild sichtbar:', inside)
    if not inside:
        b.errors.append(('pip', 'Pfeil außerhalb des Mini-Fensters'))
    sys.exit(b.report())
