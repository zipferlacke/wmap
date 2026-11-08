"""Bedienung der geneigten Karte (map/tilt-gestures.js), Darmstadt:

Neigen als Geste (Strg + Ziehen, 30° → 80°) zoomt mit: steiler → näher; zurück → wieder wie vorher.
Schieben mit einem Finger bei 75°: der Weg des Fingers im Maßstab vorn mal 0,63 (0,5 + 0,5 · cos(Neigung)) – mit
Gelände unten im Bild und ohne Gelände nahe am Horizont gleich weit; Nachrollen kürzer als der Wisch. Am Woog bei größter Neigung (85°) schieben und loslassen: die Karte bleibt, wo sie ist
(MapLibre 5 rückt die Mitte darüber sonst nach jeder Geste 10 km weg).
Beim Neigen kommt „Bewegung zu Ende“ (moveend, zoomend) höchstens einmal – nicht je Bild (sonst baut die Karte mitten in
der Geste Häuser und Namen neu).
"""
import math
import sys
import time
from common import Browser
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

READY = "const m = window.__wmap.map; return m.loaded() && m.areTilesLoaded()"


with Browser(412, 900) as b:
    b.open('index.html', 5)
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    checks = {}

    def settle(s=20):
        t = time.time()
        while time.time() - t < s and not b.js(READY):
            time.sleep(.3)
        time.sleep(.5)

    def drag(x0, y0, x1, y1, ctrl=False, steps=12):
        canvas = b.d.find_element('css selector', '.maplibregl-canvas')
        r = b.js("const r = arguments[0].getBoundingClientRect(); return [r.width, r.height]", canvas)
        a = ActionChains(b.d)
        if ctrl:
            a.key_down(Keys.CONTROL)
        a.move_to_element_with_offset(canvas, int(x0 - r[0] / 2), int(y0 - r[1] / 2)).click_and_hold()
        for _ in range(steps):
            a.move_by_offset(int((x1 - x0) / steps), int((y1 - y0) / steps)).pause(.03)
        a.release()
        if ctrl:
            a.key_up(Keys.CONTROL)
        a.perform()
        time.sleep(1.2)

    # 2. Neigen zoomt mit
    b.js("window.__wmap.map.jumpTo({ center: [8.6547, 49.8722], zoom: 16, pitch: 30, bearing: 0 })")
    settle()
    z0, p0 = b.js("const m = window.__wmap.map; return [m.getZoom(), m.getPitch()]")
    # Als echte Geste: Strg + Ziehen nach oben neigt (MapLibre: 0,5° je Bildpunkt)
    count = """const m = window.__wmap.map; window.__ends = { moveend: 0, zoomend: 0 };
      for (const k of ['moveend', 'zoomend']) m.on(k, () => window.__ends[k]++)"""
    b.js(count)
    drag(206, 600, 206, 500, ctrl=True, steps=20)
    settle()
    z1, p1 = b.js("const m = window.__wmap.map; return [m.getZoom(), m.getPitch()]")
    ends_tilt = b.js("return window.__ends")
    drag(206, 500, 206, 600, ctrl=True, steps=20)
    settle()
    z2, p2 = b.js("const m = window.__wmap.map; return [m.getZoom(), m.getPitch()]")
    print(f'Neigen: {p0:.0f}° Zoom {z0:.2f} → {p1:.0f}° Zoom {z1:.2f} → zurück {p2:.0f}° Zoom {z2:.2f}')
    checks['2. Steiler neigen zoomt näher'] = p1 > p0 + 20 and z1 > z0 + 0.3
    checks['2. Zurückkippen zoomt wieder heraus'] = abs(p2 - p0) < 1 and abs(z2 - z0) < 0.02
    print('Ende-Meldungen beim Neigen:', ends_tilt)
    checks['2. Neigen: einmal „Bewegung zu Ende“, nicht je Bild'] = ends_tilt['moveend'] <= 1 and ends_tilt['zoomend'] <= 1

    canvas = b.d.find_element('css selector', '.maplibregl-canvas')

    # 3./4. Schieben bei 75°: der Weg des Fingers im Maßstab vorn mal 0,63 – mit Gelände unten im Bild und ohne Gelände
    #       nahe am Horizont gleich; Nachrollen kürzer
    def wipe(pitch, y0, terrain=True):
        b.js(f"const m = window.__wmap.map; m.jumpTo({{ center: [8.6547, 49.8722], zoom: 17, pitch: {pitch}, bearing: 0 }});"
             + ("" if terrain else "window.__ter = m.getTerrain(); m.setTerrain(null);"))
        settle()
        front = b.js("""const m = window.__wmap.map, r = m.getCanvas().getBoundingClientRect(), t = m._camera?.transform ?? m.transform;
          const P = (y) => t.screenPointToLocation(new maplibregl.Point(r.width / 2, y));
          const a = P(r.height * 0.78), c = P(r.height * 0.78 - 10);
          return Math.hypot((c.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180), (c.lat - a.lat) * 111320) / 10""")
        b.js("const m = window.__wmap.map; m.once('dragstart', () => { window.__c0 = m.getCenter().toArray(); });"
             "m.once('dragend', () => { window.__c1 = m.getCenter().toArray(); })")
        ActionChains(b.d).move_to_element_with_offset(canvas, 0, int(y0 - 450)).click_and_hold() \
            .move_by_offset(0, 20).move_by_offset(0, 50).pause(.05).move_by_offset(0, 50).release().perform()
        time.sleep(1.5)
        c0, c1, c2 = b.js("return [window.__c0, window.__c1, window.__wmap.map.getCenter().toArray()]")
        if not terrain:
            b.js("window.__wmap.map.setTerrain(window.__ter)")
        m = lambda a, c: math.hypot((c[0] - a[0]) * 111320 * math.cos(math.radians(a[1])), (c[1] - a[1]) * 111320)
        return m(c0, c1), m(c1, c2), (0.5 + 0.5 * math.cos(math.radians(75))) * 100 * front
    d1, r1, want = wipe(75, 600)
    print(f'75° mit Gelände, unten gewischt: {d1:.0f} m (erwartet etwa {want:.0f} m), Nachrollen {r1:.1f} m')
    checks['3. Schieben bei 75° im Maßstab vorn mal 0,63'] = 0.5 * want < d1 < 1.6 * want
    checks['3. Nachrollen kürzer als der Wisch'] = r1 < d1
    d2, r2, want2 = wipe(75, 320, terrain=False)
    print(f'75° ohne Gelände, nahe am Horizont gewischt: {d2:.0f} m (erwartet etwa {want2:.0f} m)')
    checks['4. Ohne Gelände nahe am Horizont genauso weit (nicht Kilometer)'] = 0.5 * want2 < d2 < 1.6 * want2

    # 5. Woog, größte Neigung: Schieben und loslassen – kein Hinausfliegen (die Mitte rückt nicht 10 km weg)
    maxp = b.js("return window.__wmap.map.getMaxPitch()")
    b.js("window.__wmap.map.jumpTo({ center: [8.66845, 49.87190], zoom: 19.6, pitch: 90, bearing: -85 })")
    settle()
    z0, c0 = b.js("const m = window.__wmap.map; return [m.getZoom(), m.getCenter().toArray()]")
    for _ in range(2):
        ActionChains(b.d).move_to_element_with_offset(canvas, 0, 250).click_and_hold() \
            .move_by_offset(0, -40).pause(.02).move_by_offset(0, -40).release().perform()
        time.sleep(1.5)
    z1, c1, p1 = b.js("const m = window.__wmap.map; return [m.getZoom(), m.getCenter().toArray(), m.getPitch()]")
    away = abs(c1[0] - c0[0]) * 71700 + abs(c1[1] - c0[1]) * 111320
    print(f'Woog bei {p1:.0f}° (höchstens {maxp}°): Zoom {z0:.2f} → {z1:.2f}, {away:.0f} m weiter')
    checks['5. Woog, größte Neigung: nach dem Loslassen nicht hinausgeflogen'] = maxp == 85 and abs(z1 - z0) < 0.5 and away < 300
    b.shot('tilt_gestures')

    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(b.report() or not all(checks.values()))
