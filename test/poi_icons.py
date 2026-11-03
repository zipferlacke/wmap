"""Symbole der Orte in der Grundkarte (js/map/poi-icons.js), Göttingen Innenstadt:

1. Die Ebenen der Grundkarte (poi_r1, poi_r7, poi_r20, poi_transit) holen ihre Symbole als poi:<Klasse>:<Unterklasse>.
2. Nach dem Laden sind solche Bilder gezeichnet (runder Knopf mit Symbol aus der Icon-Schrift).
3. Jedes Symbol der Zuordnung gibt es in der Schrift (sonst stünde der Name als Text da).
4. Der Dialog zeigt dasselbe Symbol wie die Karte – auch ohne WMap-Kategorie (Mülleimer, Bank, Friseur).
5. Schranken, Poller und Tore bekommen kein Symbol (leeres Bild).
"""
import re
import sys
import time
from common import Browser

SRC = open('../js/map/poi-icons.js', encoding='utf-8').read()
GLYPHS = sorted({g for n in re.findall(r"\[\[([^\]]+)\]", SRC) for g in re.findall(r"'([a-z0-9_]+)'", n)})

with Browser(500, 800) as b:
    checks = {}
    b.open('index.html?view=9.9353,51.5340,17.3', 5)
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    layers = b.js("""const m = window.__wmap.map; return ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'].filter((id) => m.getLayer(id))
      .map((id) => JSON.stringify(m.getLayoutProperty(id, 'icon-image')))""")
    print('icon-image:', layers[:1])
    checks['1. Ebenen der Grundkarte holen poi:<Klasse>:<Unterklasse>'] = len(layers) >= 3 and all('"poi:"' in x for x in layers)
    time.sleep(8)
    made = b.js("return window.__wmap.map.listImages().filter((i) => i.startsWith('poi:'))")
    print('gezeichnet:', len(made), made[:6])
    checks['2. Symbole gezeichnet'] = len(made) > 20
    missing = b.js("""const c = document.createElement('canvas').getContext('2d'); c.font = '40px "Material Symbols Rounded"';
      return arguments[0].filter((g) => c.measureText(g).width >= 60)""", GLYPHS)
    print(f'{len(GLYPHS)} Symbole, fehlen in der Schrift:', missing)
    checks['3. alle Symbole in der Schrift'] = not missing
    look = b.d.execute_async_script("""const done = arguments[arguments.length - 1];
      Promise.all([import('./js/map/poi-icons.js'), import('./js/ui/poi-info.js')]).then(([p, i]) => done({
        bin: i.describePoi({ amenity: 'waste_basket' }).look, bank: i.describePoi({ amenity: 'bank', name: 'X' }).look,
        hair: i.describePoi({ shop: 'hairdresser' }).look, park: i.describePoi({ amenity: 'parking' }).look,
        mapBin: p.poiStyle('poi:waste_basket:waste_basket'), gate: p.poiStyle('poi:gate:gate') }))""")
    print('Dialog:', look)
    checks['4. Dialog wie die Karte: Mülleimer, Bank, Friseur, Parkplatz'] = (look['bin']['icon'] == 'delete' and look['mapBin'][0][0] == 'delete'
        and look['bank']['icon'] == 'account_balance' and look['hair']['icon'] == 'content_cut' and look['park']['icon'] == 'local_parking')
    checks['5. Schranken ohne Symbol'] = look['gate'] is None
    b.shot('poi_icons')
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(b.report() or not all(checks.values()))
