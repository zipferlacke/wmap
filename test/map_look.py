"""Darstellung der Karte (js/map/map.js, js/pages/settings.js, js/ui/layer-menu.js):
1. „Schärfe der Karte“ steht in den Einstellungen ganz unten; die Wahl gilt beim nächsten Öffnen der Karte –
   auf einem Bildschirm mit Dichte 3: Automatisch → 2, Sparsam → 1, Mittel → 1,5, Volle Auflösung → 3.
2. 3D-Häuser zeichnet WMap selbst (js/map/buildings.js), MapLibres „building-3d“ ist aus. Jedes Haus hat seine
   eigene Bodenhöhe, auch wenn die Kacheln viele zu einem Objekt zusammenfassen (Rittmarshausen, Birkenweg);
   was ineinander steckt (dasselbe Haus mit 12 m und als 5-m-Stück), steht auf derselben Höhe, der niedrigere
   rückt ein. Der Umriss von Häusern aus Teilen (`hide_3d`) wird nicht hochgezogen. Kein Schatten am Boden mehr.
3. Gelände in voller Auflösung (Zoom 16), die Navigation gröber (Zoom 13).
4. Relief nah heran noch deutlich (Zoom 16: mindestens 0,4); der Schalter „Relief“ blendet es aus und ein."""
import json
import sys
import time
from common import Browser

# Bildschirm mit dreifacher Pixeldichte (wie viele Handys)
PRELOAD = "() => { Object.defineProperty(window, 'devicePixelRatio', { get: () => 3, configurable: true }); }"

MAP = """const m = window.__wmap.map; const st = m.getStyle(); const lay = (id) => st.layers.find((l) => l.id === id);
const hasHide = (f) => JSON.stringify(f ?? null).includes('hide_3d');
const ex = m.getPaintProperty('hillshade', 'hillshade-exaggeration');
const at = (z) => { const a = ex.slice(3); let v = a[1]; for (let i = 0; i < a.length; i += 2) if (a[i] <= z) v = a[i + 1]; return v; };
return { ratio: m.getPixelRatio(), b3d: hasHide(lay('building-3d')?.filter), roof: hasHide(lay('building-roof')?.filter), shadow: !lay('building-shadow'),
  terrain: m.getSource('terrain')?.maxzoom, lo: m.getSource('terrain-lo')?.maxzoom, relief16: at(16), relief175: at(17.5), vis: m.getLayoutProperty('hillshade', 'visibility') }"""

with Browser(1000, 760) as b:
    b.d.script.add_preload_script(PRELOAD)
    checks = {}
    # 1. Einstellung ganz unten
    b.open('settings.html', 3)
    last = b.js("const s = [...document.querySelectorAll('#app section, main section, section')].filter((x) => x.offsetParent); const l = s.at(-1); return l ? [l.querySelector('h3')?.innerText, !!l.querySelector('select[name=sharpness]'), [...(l.querySelectorAll('select[name=sharpness] option'))].map((o) => o.value), l.innerText.includes('Dieser Bildschirm hat 3')] : null")
    print('Einstellungen unten:', last)
    checks['1. „Schärfe der Karte“ im letzten Abschnitt, fünf Stufen, Dichte des Bildschirms genannt'] = bool(last) and last[1] and last[2] == ['auto', '1', '1.5', '2', 'max'] and last[3]
    ratios = {}
    for v in ['auto', '1', '1.5', 'max']:
        b.open('settings.html', 2)
        b.js("const s = document.querySelector('select[name=sharpness]'); s.value = arguments[0]; s.dispatchEvent(new Event('change', { bubbles: true }));", v)
        time.sleep(.3)
        b.open('index.html?view=9.9365,51.5343,16', 5)
        ratios[v] = b.js('return window.__wmap.map.getPixelRatio()')
    print('Pixeldichte je Stufe:', ratios)
    checks['1. Dichte 3: Automatisch 2, Sparsam 1, Mittel 1,5, Volle Auflösung 3'] = ratios == {'auto': 2, '1': 1, '1.5': 1.5, 'max': 3}
    b.js("localStorage.removeItem('wmap.sharpness')")
    # 2.–4. Karte
    b.open('index.html?view=9.9365,51.5343,16.5,60', 9)
    r = b.js(MAP)
    print('Karte:', json.dumps(r, ensure_ascii=False))
    checks['2. Umriss von Häusern aus Teilen (hide_3d) nicht in 3D: Wände, Dach; kein Schatten am Boden'] = r['b3d'] and r['roof'] and r['shadow']
    own = b.js("const m = window.__wmap.map; return [!!m.getLayer('wmap-buildings'), m.getLayoutProperty('building-3d', 'visibility'), m.getLayoutProperty('building-roof', 'visibility')]")
    print('eigene Ebene:', own)
    checks['2. eigene Gebäude-Ebene da, MapLibres 3D-Häuser aus'] = own == [True, 'none', 'none']
    # Birkenweg in Rittmarshausen: viele Häuser in einem Objekt, ein Haus doppelt (12 m und 5-m-Stück)
    b.open('index.html?view=10.1025,51.4812,17.2,72,55', 3)
    b.js("window.__done = false; const m = window.__wmap.map; const f = () => { if (m.areTilesLoaded() && m.loaded()) window.__done = true; else setTimeout(f, 500); }; setTimeout(f, 3000);")
    b.wait('return window.__done', 40)
    time.sleep(2)
    birk = b.d.execute_async_script("""const done = arguments[arguments.length - 1];
      import('./js/map/buildings.js').then(async ({ collectBuildings }) => {
        const m = window.__wmap.map; const hs = await collectBuildings(m);
        const c = (h) => { const r = h.rings[0]; let x = 0, y = 0; for (const p of r.slice(0, -1)) { x += p[0]; y += p[1]; } return [x / (r.length - 1), y / (r.length - 1)]; };
        const near = hs.filter((h) => { const [x, y] = c(h); return Math.abs(x - 10.10100) < 0.00015 && Math.abs(y - 51.48133) < 0.0001; });
        const five = hs.filter((h) => h.height === 5);
        done({ n: hs.length, near: near.map((h) => [h.height, +h.ground.toFixed(2), h.rank]), grounds: new Set(five.map((h) => h.ground.toFixed(1))).size, five: five.length });
      }, (e) => done('FEHLER ' + e));""")
    print('Birkenweg:', birk)
    heights = sorted(x[0] for x in birk['near']) if isinstance(birk, dict) else []
    checks['2. Birkenweg: 12-m-Haus und 5-m-Stück auf derselben Bodenhöhe, das niedrigere rückt ein'] = isinstance(birk, dict) and 12 in heights and 5 in heights and any(x[2] > 0 for x in birk['near'] if x[0] == 5) and len({x[1] for x in birk['near'] if x[0] == 12 or x[2] > 0}) == 1
    checks['2. Birkenweg: zusammengefasste Häuser (5 m) mit eigener Bodenhöhe je Haus'] = isinstance(birk, dict) and birk['five'] > 20 and birk['grounds'] > 5
    checks['3. Gelände Zoom 16, Navigation Zoom 13'] = r['terrain'] == 16 and r['lo'] == 13
    checks['4. Relief nah heran deutlich (Zoom 16 ≥ 0,4, Zoom 17,5 ≥ 0,3)'] = r['relief16'] >= 0.4 and r['relief175'] >= 0.3 and r['vis'] == 'visible'
    # Schalter „Relief“ im Ebenen-Menü
    b.js("document.querySelector('.maplibregl-ctrl-layers, [data-act=layers], button[title*=Ebenen], button[aria-label*=Ebenen]')?.click()")
    time.sleep(.8)
    box = b.js("const i = document.querySelector('input[name=relief]'); if (!i) return null; i.click(); return i.checked")
    time.sleep(.5)
    off = b.js("return window.__wmap.map.getLayoutProperty('hillshade', 'visibility')")
    b.js("document.querySelector('input[name=relief]')?.click()")
    time.sleep(.5)
    on = b.js("return window.__wmap.map.getLayoutProperty('hillshade', 'visibility')")
    print('Schalter Relief:', box, off, on)
    checks['4. Schalter „Relief“: aus → ausgeblendet, an → sichtbar'] = box is False and off == 'none' and on == 'visible'
    b.js("localStorage.removeItem('wmap.layers')")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
