"""Kartenausschnitt merken (js/app.js saveView, js/app/core.js Startansicht):
1. Erster Start ohne Bewegung: nichts gespeichert – die Startansicht bekommt keine Zeit.
2. Karte bewegt: Ausschnitt mit Zeit gespeichert.
3. Neu geladen: die Karte steht wieder dort, die Zeit des Ausschnitts bleibt.
4. Seite verlassen ohne Bewegung (pagehide): die Zeit bleibt.
5. Über Meine Touren zurück zur Karte: derselbe Ausschnitt."""
import sys
import time
from common import Browser

VIEW = """const m = window.__wmap.map; const s = JSON.parse(localStorage.getItem('wmap.view'));
return { center: m.getCenter().toArray().map((x) => Math.round(x * 1000) / 1000), zoom: Math.round(m.getZoom() * 10) / 10, at: s?.at ?? null }"""
THERE = {'center': [8.68, 50.11], 'zoom': 13}

with Browser() as b:
    b.open('index.html', wait=5)
    first = b.js(VIEW)
    print('Start:', first)
    b.js("window.__wmap.map.jumpTo({ center: [8.68, 50.11], zoom: 13 })")
    time.sleep(1.5)
    moved = b.js(VIEW)
    print('bewegt:', moved)
    b.open('index.html', wait=5)
    again = b.js(VIEW)
    print('neu geladen:', again)
    b.js("dispatchEvent(new Event('pagehide'))")
    time.sleep(.5)
    left = b.js(VIEW)
    print('verlassen:', left)
    b.open('wege.html', wait=2)
    b.open('index.html', wait=5)
    back = b.js(VIEW)
    print('zurück:', back)
    same = lambda v: v['center'] == THERE['center'] and v['zoom'] == THERE['zoom']
    checks = {
        '1. erster Start ohne Bewegung: nichts gespeichert': first['at'] is None,
        '2. bewegt: Ausschnitt mit Zeit gespeichert': same(moved) and moved['at'],
        '3. neu geladen: Karte steht dort, Zeit bleibt': same(again) and again['at'] == moved['at'],
        '4. verlassen ohne Bewegung: Zeit bleibt': left['at'] == moved['at'],
        '5. über Meine Touren zurück: derselbe Ausschnitt': same(back) and back['at'] == moved['at'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
