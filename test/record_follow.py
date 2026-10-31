"""Aufzeichnen auf der Karte (ui/record.js): Mitführen, frei herumschauen, Zurück zum Start.
1. Neue Punkte: die Karte zieht nach, der Standort steht im unteren Drittel (kein Zoom auf die ganze Strecke).
2. Selbst geschoben: die Karte bleibt, wo sie ist, nur der Punkt wandert; „Mitführen“ erscheint.
3. „Mitführen“: der Standort ist wieder im Bild, der Knopf verschwindet.
4. „Zum Start“: Route vom Standort zum Start der Aufzeichnung."""
import sys
import time
from common import Browser

# In der Seite selbst (Modul-Skript) – ein import() aus WebDriver bekäme eine eigene Kopie des Recorders
ADD = """const s = document.createElement('script'); s.type = 'module';
s.textContent = `import { recorder } from './js/data/tracks.js'; for (const k of ${JSON.stringify(arguments[0])}) recorder.add({ point: [9.930 + k * 0.0006, 51.530], accuracy: 5 });`;
document.head.append(s);"""
POS = """const m = window.__wmap.map, last = arguments[0]; const p = m.project(last), c = m.getCenter();
return { y: Math.round(p.y / m.getContainer().clientHeight * 100), inside: p.x > 0 && p.y > 0 && p.x < m.getContainer().clientWidth && p.y < m.getContainer().clientHeight,
  center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +m.getZoom().toFixed(1), follow: !document.querySelector('.rec-follow')?.hidden ? 'aus' : 'an' }"""

def add(b, ks):
    b.js(ADD, ks)

with Browser(420, 860) as b:
    checks = {}
    b.open('index.html?view=9.93,51.53,14&action=record', 4)
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.querySelector('.rec [data-kind=foot]').click()")
    time.sleep(1.5)
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    for i in range(6):
        add(b, [i]); time.sleep(1.2)
    p1 = b.js(POS, [9.930 + 5 * 0.0006, 51.530])
    print('mitgeführt:', p1)
    checks['1. Karte zieht nach, Standort im unteren Drittel, Zoom ≥ 15'] = p1['inside'] and 55 <= p1['y'] <= 80 and p1['zoom'] >= 15 and p1['follow'] == 'an'
    b.js("const m = window.__wmap.map; m.fire('dragstart', { originalEvent: new MouseEvent('mousedown') }); m.jumpTo({ center: [9.90, 51.55] }); m.fire('dragend', { originalEvent: new MouseEvent('mouseup') })")
    time.sleep(.5)
    for i in range(6, 9):
        add(b, [i]); time.sleep(1.2)
    p2 = b.js(POS, [9.930 + 8 * 0.0006, 51.530])
    print('frei:', p2)
    checks['2. frei herumschauen: Karte bleibt, „Mitführen“ da'] = p2['center'] == [9.9, 51.55] and p2['follow'] == 'aus'
    b.js("document.querySelector('.rec-follow').click()")
    time.sleep(1.5)
    p3 = b.js(POS, [9.930 + 8 * 0.0006, 51.530])
    print('Mitführen:', p3)
    checks['3. „Mitführen“: Standort wieder im Bild, Knopf weg'] = p3['inside'] and p3['follow'] == 'an'
    b.shot('record_follow')
    b.js("document.querySelector('.rec-home').click()")
    time.sleep(2)
    r = b.js("return [document.body.classList.contains('route-view'), [...document.querySelectorAll('#route-form input')].map((x) => x.value)]")
    print('Zum Start:', r)
    checks['4. „Zum Start“: Route zum Start der Aufzeichnung'] = r[0] and any('Start der Aufzeichnung' in v for v in r[1])
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = `import { recorder } from './js/data/tracks.js'; recorder.discard();`; document.head.append(s);")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(b.report() or not all(checks.values()))
