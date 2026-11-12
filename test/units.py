"""Maßeinheiten und Uhrzeit (js/core/units.js, js/core/geo.js, Einstellungen → Darstellung), Maßstab (js/map/map.js):
1. Gerät auf Deutsch: metrisch und 24 Stunden – „420 m“, „3,4 km“, „36,0 km/h“, „14:05“, Ansage in Metern.
2. Einstellungen: Maßeinheiten und Uhrzeit stehen zur Wahl, die Wahl wird gespeichert.
3. Meilen und 12 Stunden: „330 ft“, „2,1 mi“, „22,4 mph“, „2:05 PM“, Ansage in Meilen (Einzahl „1 Meile“) und Fuß,
   Tempolimit auf 5 mph gerundet.
4. Maßstab unten rechts: beim Zoomen sichtbar, kurz danach weg; in Meilen mit ft bzw. mi.
5. Gerät auf en-US ohne eigene Wahl: Meilen und 12 Stunden."""
import sys
import time
from common import Browser

MODULE = """const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);"""
VALUES = """const g = await import('./js/core/geo.js'); const u = await import('./js/core/units.js');
  const at = new Date(2026, 0, 1, 14, 5);
  window.__units = { system: [u.unitSystem(), u.clockSystem()],
    text: [g.fmtDistance(100), g.fmtDistance(420), g.fmtDistance(3400), g.fmtSpeed(10), g.fmtClock(at)],
    speech: [g.speakDistance(100), g.speakDistance(800), g.speakDistance(1609.344), g.speakDistance(30000, '_plain')],
    limits: [u.limitOf(48), u.limitOf(113), u.limitOf(null)] };"""
SCALE = "const e = document.querySelector('.maplibregl-ctrl-scale'); return [e.textContent.replace(/\\u00a0/g, ' '), getComputedStyle(e).opacity]"
EN_US = "() => { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); Object.defineProperty(navigator, 'language', { get: () => 'en-US' }); }"


def values(b):
    b.js('delete window.__units')
    b.js(MODULE, VALUES)
    return b.wait('return window.__units', 10)


with Browser() as b:
    b.open('index.html', wait=1)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1'); localStorage.setItem('wmap.lang', 'de_DE')")
    b.open('index.html', wait=4)
    metric = values(b)
    print('metrisch:', metric)
    b.open('settings.html', wait=2)
    before = b.js("return ['units', 'clock'].map((n) => document.querySelector(`select[name=${n}]`)?.value)")
    b.js("""for (const [n, v] of [['units', 'imperial'], ['clock', '12']]) { const s = document.querySelector(`select[name=${n}]`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }""")
    saved = b.js("return [localStorage.getItem('wmap.units'), localStorage.getItem('wmap.clock')]")
    print('Einstellungen:', before, saved)
    b.open('index.html', wait=4)
    imp = values(b)
    print('Meilen:', imp)
    b.js("window.__wmap.map.jumpTo({ center: [9.935, 51.533], zoom: 13 })")
    time.sleep(1)
    b.js("window.__wmap.map.zoomTo(13.6, { duration: 300 })")
    time.sleep(1.2)
    on = b.js(SCALE)
    time.sleep(3.4)
    off = b.js(SCALE)
    b.js("window.__wmap.map.jumpTo({ zoom: 7 }); window.__wmap.map.zoomTo(7.2, { duration: 200 })")
    time.sleep(1)
    far = b.js(SCALE)
    print('Maßstab:', on, off, far)
    b.shot('units-scale')

with Browser() as b:
    b.d.script.add_preload_script(EN_US)
    b.open('index.html', wait=1)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1'); localStorage.setItem('wmap.lang', 'en_GB')")
    b.open('index.html', wait=4)
    us = values(b)
    print('en-US:', us)
    checks = {
        '1. Deutsch: metrisch, 24 Stunden, Ansage in Metern': metric['system'] == ['metric', '24'] and metric['text'] == ['100 m', '420 m', '3,4 km', '36,0 km/h', '14:05']
            and metric['speech'][:2] == ['100 Metern', '800 Metern'],
        '2. Einstellungen: beide zur Wahl, Wahl gespeichert': before == ['metric', '24'] and saved == ['"imperial"', '"12"'],
        '3. Meilen und 12 Stunden: Strecke, Tempo, Uhrzeit, Ansage, Tempolimit': imp['system'] == ['imperial', '12']
            and imp['text'][:4] == ['330 ft', '0,3 mi', '2,1 mi', '22,4 mph'] and imp['text'][4].replace(' ', ' ') == '2:05 PM'
            and imp['speech'] == ['300 Fuß', '0,5 Meilen', '1 Meile', '19 Meilen'] and imp['limits'] == [30, 70, None],
        '4. Maßstab: beim Zoomen sichtbar (ft), danach weg, weit draußen in mi': on[0].endswith(' ft') and on[1] == '1' and off[1] == '0' and far[0].endswith(' mi'),
        '5. en-US ohne eigene Wahl: Meilen und 12 Stunden': us['system'] == ['imperial', '12'] and us['text'][2] == '2.1 mi' and us['speech'][2] == '1 mile',
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
