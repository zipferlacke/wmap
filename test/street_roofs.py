"""Street View: Dachformen und Gleise (map/buildings.js, map/street-look.js), Luftbild Kachel für Kachel.
1. Rechteckhaus 20 × 10 m, 12 m hoch: Satteldach mit First längs in der Mitte (Traufe 8,5 m), quer gedreht der
   First quer, Walmdach mit kürzerem First, Pultdach 2 m hoch zur Südseite, Flachdach oben flach.
2. Street View am Göttinger Bahnhof: Ebenen für Schwellen und Schienen da.
3. Luftbild: Häuser stehen, bevor das Bild da ist; die Kacheln kommen einzeln (64 bei Zoom 17)."""
import sys
import time
from common import Browser

JS = """
const { roofTest } = await import('./js/map/buildings.js');
const lon0 = 8.65, lat0 = 49.87, mx = 1 / (111320 * Math.cos(lat0 * Math.PI / 180)), my = 1 / 111320;
const ring = [[0,0],[20,0],[20,10],[0,10],[0,0]].map(([x, y]) => [lon0 + x * mx, lat0 + y * my]);
const origin = new maplibregl.MercatorCoordinate(0.5, 0.5, 0), m0 = maplibregl.MercatorCoordinate.fromLngLat([lon0, lat0]), unit = m0.meterInMercatorCoordinateUnits();
const out = {};
for (const [k, shape, orientation, height] of [['flat', 'flat'], ['gabled', 'gabled'], ['across', 'gabled', 'across'], ['hipped', 'hipped'], ['skillion', 'skillion', null, 2]]) {
  const m = roofTest({ rings: [ring], height: 12, min: 0, ground: 0, ref: 0, tint: 0, rank: 0, shape: { id: 1, shape, height: height ?? null, orientation } }, origin, unit);
  const zs = []; for (let i = 0; i < m.length; i += 9) zs.push(m[i + 2] / unit);
  const zmax = Math.max(...zs), top = new Set();
  for (let i = 0; i < m.length; i += 9) if (Math.abs(m[i + 2] / unit - zmax) < 0.01) top.add(`${Math.round(((m[i] + origin.x) - m0.x) / unit)},${Math.round((m0.y - (m[i + 1] + origin.y)) / unit)}`);
  out[k] = { top: [...top].sort(), eave: Math.round(Math.min(...zs.filter((z) => z > 1)) * 10) / 10 };
}
return out;
"""

with Browser(500, 800) as b:
    checks = {}
    b.open('index.html?view=8.65,49.87,15', 3)
    r = b.d.execute_async_script('const done = arguments[0]; (async () => {' + JS + '})().then(done, (e) => done(String(e)))')
    print('Dächer:', r)
    checks['1. Satteldach: First längs bei 5 m, Traufe 8,5 m'] = r['gabled'] == {'top': ['0,5', '20,5'], 'eave': 8.5}
    checks['1. Satteldach quer: First bei x = 10 m'] = r['across']['top'] == ['10,0', '10,10']
    checks['1. Walmdach: First von 5 bis 15 m'] = r['hipped']['top'] == ['15,5', '5,5']
    checks['1. Pultdach: hoch an der Südseite, 2 m'] = r['skillion'] == {'top': ['0,0', '20,0'], 'eave': 10.0}
    checks['1. Flachdach: oben die Ecken'] = len(r['flat']['top']) == 4
    b.open('index.html?street=9.92560,51.53560,0,80', 6)
    rails = b.js("const m = window.__wmap.map; return ['sv-sleepers', 'sv-rail-l', 'sv-rail-r'].map((id) => !!m.getLayer(id))")
    print('Gleise:', rails)
    checks['2. Schwellen und Schienen in Street View'] = rails == [True, True, True]
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.layers', JSON.stringify({ base: 'sat' }))")
    b.open('index.html?view=8.6560,49.8720,17.2,55', 1)
    log = []
    t0 = time.time()
    while time.time() - t0 < 15:
        st = b.js("return window.__wmap?.map?.wmapBuildings?.satState?.() ?? null")
        if st: log.append((round(time.time() - t0, 1), st['houses'], st['tiles']))
        if st and st['tiles'] >= 64: break
        time.sleep(.2)
    houses_at = next((t for t, h, k in log if h), None)
    first_tile = next((t for t, h, k in log if k), None)
    steps = sorted({k for _, _, k in log})
    print('Luftbild: Häuser ab', houses_at, 's, erste Kachel', first_tile, 's, Kacheln', steps[:6], '…', steps[-1:])
    checks['3. Häuser stehen, die Kacheln kommen einzeln bis 64'] = houses_at is not None and steps[-1] == 64 and len(steps) > 3
    b.js("localStorage.removeItem('wmap.layers')")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(b.report() or not all(checks.values()))
