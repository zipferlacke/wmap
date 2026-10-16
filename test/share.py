"""Teilen-Dialog (Text mit Link / nur Link) und Toast – hell und dunkel.
Ein Ort geht als geo:-Link, darunter in Klammern der Link zu WMap; der geo:-Link lässt sich wieder lesen
(core/geo-uri.js), auch mit Leerzeichen und Klammern im Namen."""
import sys
import time
from common import Browser

ROUNDTRIP = """const done = arguments[arguments.length - 1];
Promise.all([import('./js/ui/share.js'), import('./js/core/geo-uri.js')]).then(([s, g]) => {
  const uri = s.geoUri([9.93554, 51.53194], 'Gänseliesel (Markt) & Co');
  done([uri, g.parseGeoUri(uri)]);
}, (e) => done('FEHLER ' + e));"""

with Browser(420, 860) as b:
    checks = {}
    for mode in ['light', 'dark']:
        b.open('settings.html', 1)
        b.theme(mode)
        b.open('index.html?ort=9.9338,51.5374&name=Test', 5)
        b.js("window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; };")
        b.js("[...document.querySelectorAll('[data-view=place] .actions button')].find(x => x.textContent.includes('Teilen')).click()")
        time.sleep(1)
        b.shot(f'share-{mode}')
        buttons = [x.text.split('\n')[-1] for x in b.d.find_elements('css selector', 'dialog[open] .confirm-actions button')]
        preview = b.js("return [...document.querySelectorAll('dialog[open] .share-url')].map((x) => x.textContent)")
        print(mode, buttons, preview)
        b.css('dialog[open] button[value=text]').click()
        time.sleep(.5)
        b.shot(f'toast-{mode}')
        copied = b.js('return window.__copied')
        print('  kopiert:', repr(copied))
        print('  Toast:', b.js("const t = document.getElementById('toast'); return t && [t.textContent, getComputedStyle(t).backgroundColor]"))
        if mode == 'light':
            lines = (copied or '').split('\n')
            checks['Vorschau: geo:-Link mit dem Namen des geteilten Orts, darunter (WMap: …)'] = len(preview) == 2 and preview[0] == 'geo:51.5374,9.9338?q=51.5374,9.9338(Test)' and preview[1].startswith('(WMap: http') and 'ort=9.9338,51.5374&name=Test' in preview[1]
            checks['kopiert: Text, geo:-Link, (WMap: …) in drei Zeilen'] = len(lines) == 3 and lines[0] == 'Test' and lines[1].startswith('geo:51.5374,9.9338') and lines[2].startswith('(WMap: http') and lines[2].endswith(')')
    uri, parsed = b.d.execute_async_script(ROUNDTRIP)
    print('geo:-Link:', uri, parsed)
    checks['geo:-Link mit Leerzeichen, Klammern, & wieder gelesen: Punkt und Name'] = parsed['point'] == [9.93554, 51.53194] and parsed['label'] == 'Gänseliesel (Markt) & Co'
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
