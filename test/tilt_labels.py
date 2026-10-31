"""Geneigte Karte: Ampeln hinter Häusern, Straßennamen, Größe der Namen (map/signals.js, map/map.js sortPois,
tools/maplibre-anpassen.py), Göttingen Innenstadt.

1. Ampel hinter einem hohen Haus ist geneigt unsichtbar (Feature-State hidden), eine ohne Haus auf dem Weg zur Kamera sichtbar;
   flach sind beide sichtbar. Overpass ist fest ersetzt: die Ampeln legt der Test fest.
2. Straßennamen stehen geneigt aufrecht (text-pitch-alignment viewport).
3. MapLibre ist angepasst (8 Stellen): Namen und Symbole vorn nie größer als eingestellt (Faktor 0,5 bis 1).
4. Speicher mit Gelände (map.js drapeTogether): alle Bodenebenen in einer Folge vor den übrigen – MapLibre legt je
   Folge und Geländekachel eine Textur von 16 MB an (vorher 6 Folgen); ohne Gelände wieder die alte Reihenfolge.
"""
import json
import sys
import time
from common import Browser, BASE

ok = True


def check(name, cond, info=''):
    global ok
    ok &= bool(cond)
    print('OK  ' if cond else 'FEHLER', name, info)


# Overpass: Ampeln aus sessionStorage 'sig', sonst nichts
PRELOAD = """() => {
  const own = window.fetch;
  window.fetch = (url, opts) => {
    if (!String(url).includes('/interpreter')) return own(url, opts);
    const q = decodeURIComponent(String(opts?.body ?? url));
    const elements = q.includes('traffic_signals') ? JSON.parse(sessionStorage.getItem('sig') ?? '[]') : [];
    return Promise.resolve(new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
}"""


def page(b, body, seconds=40):
    """Code in der Seite (Skript-Element): Objekte aus Seleniums Sandbox versteht die Karte nicht. `m` ist die Karte."""
    b.js("""window.__out = undefined; const s = document.createElement('script'); s.type = 'module';
      s.textContent = `const m = window.__wmap.map; try { window.__out = JSON.stringify(await (async () => { ${arguments[0]} })() ?? null); }
        catch (e) { window.__out = JSON.stringify('Fehler: ' + e); }`; document.head.append(s);""", body)
    v = b.wait("return window.__out !== undefined && window.__out", seconds)
    return json.loads(v) if v else None


VIEW = 'index.html?view=9.9285,51.5340,17.6,70,80'
IDLE = "await new Promise((ok) => { m.once('idle', ok); m.triggerRepaint(); });"

with Browser(500, 900) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.d.set_script_timeout(60)
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); sessionStorage.removeItem('sig')")
    b.open(VIEW, 4)
    b.wait("return window.__wmap?.map?.getLayer('building-3d') && window.__wmap.map.loaded()", 60)
    time.sleep(3)
    # Ein hohes Haus unten im Bild: eine Ampel 3 m dahinter (von der Kamera aus), eine 4 m davor
    pts = page(b, f"""{IDLE} const l = m.getLayer('building-3d'), cam = (m._camera?.transform ?? m.transform).getCameraLngLat();
      const h = m.getCanvas().clientHeight, w = m.getCanvas().clientWidth, kx = 111320 * Math.cos(cam.lat * Math.PI / 180);
      const cand = m.querySourceFeatures(l.source, {{ sourceLayer: l.sourceLayer }})
        .filter((f) => /Polygon/.test(f.geometry.type) && (f.properties.render_height ?? 0) >= 10 && !f.properties.hide_3d)
        .map((f) => {{ const r = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]; const c = [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length];
          const rad = Math.max(...r.map((q) => Math.hypot((q[0] - c[0]) * kx, (q[1] - c[1]) * 111320))); return {{ c, rad, p: m.project(c) }}; }})
        .filter((x) => x.rad < 60 && x.p.y > h * 0.3 && x.p.y < h * 0.7 && x.p.x > w * 0.2 && x.p.x < w * 0.8);
      if (!cand.length) return null;
      const {{ c, rad }} = cand[0]; const dx = (c[0] - cam.lng) * kx, dy = (c[1] - cam.lat) * 111320, d = Math.hypot(dx, dy);
      const at = (k) => [c[0] + dx / d * k / kx, c[1] + dy / d * k / 111320];
      // Frei: unten im Bild ein Punkt, über dessen Strecke zur Kamera kein einziger Grundriss liegt
      const xy = (q) => [(q[0] - cam.lng) * kx, (q[1] - cam.lat) * 111320];
      const rings = m.querySourceFeatures(l.source, {{ sourceLayer: l.sourceLayer }}).flatMap((f) =>
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p) => p[0]) : []).map((r) => r.map(xy));
      const cross = (a, b, c, d) => {{ const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
        return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }};
      const inside = (r, p) => {{ let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) k = !k; return k; }};
      let free = null;
      for (let y = h * 0.55; y < h * 0.9 && !free; y += 10) for (let x = w * 0.15; x < w * 0.85 && !free; x += 10) {{
        const g = m.unproject([x, y]), s = xy([g.lng, g.lat]);
        if (rings.some((r) => inside(r, s) || r.some((q, i) => i && cross(s, [0, 0], r[i - 1], q)))) continue;
        free = [g.lng, g.lat];
      }}
      return [at(rad + 3), free]""")
    print('Punkte:', pts)
    check('Vorbereitung: Punkt hinter einem Haus und freier Punkt gefunden', pts and pts[0] and pts[1], pts)
    if pts and pts[0] and pts[1]:
        sig = [{'type': 'node', 'id': i + 1, 'lon': p[0], 'lat': p[1]} for i, p in enumerate(pts)]
        b.js("sessionStorage.setItem('sig', arguments[0])", json.dumps(sig))
        b.open(VIEW, 4)
        b.wait("return window.__wmap?.map?.getSource('signals') && window.__wmap.map.loaded()", 60)
        time.sleep(3)
        STATE = f"""{IDLE} const src = m.getSource('signals'); const data = await src.getData();
          return data.features.map((f) => [f.geometry.coordinates, !!m.getFeatureState({{ source: 'signals', id: f.id }}).hidden])"""
        st = page(b, STATE)
        print('geneigt:', st)
        hid = {tuple(round(c, 6) for c in p): h for p, h in (st or [])}
        key = lambda p: tuple(round(c, 6) for c in p)
        check('1. geneigt: Ampel hinter dem Haus unsichtbar', hid.get(key(pts[0])) is True)
        check('1. geneigt: Ampel ohne Haus zwischen ihr und der Kamera sichtbar', hid.get(key(pts[1])) is False)
        b.d.save_screenshot(str(__import__('common').OUT / 'tilt_labels.png'))
        flat = page(b, f"m.jumpTo({{ pitch: 0 }}); {STATE[len(IDLE):]}".replace('const src', IDLE + ' const src', 1))
        print('flach:', flat)
        check('1. flach: beide sichtbar', flat and not any(h for _, h in flat))

    # 2. Straßennamen aufrecht
    al = b.js("const m = window.__wmap.map; return m.getStyle().layers.filter((l) => /^highway-name/.test(l.id)).map((l) => m.getLayoutProperty(l.id, 'text-pitch-alignment'))")
    check('2. Straßennamen geneigt aufrecht (viewport)', al and all(a == 'viewport' for a in al), al)

    # 4. Eine Bodenfolge mit Gelände, alte Reihenfolge ohne
    o = page(b, f"""m.setTerrain(null); {IDLE} const a = m.getLayersOrder();
      m.setTerrain({{ source: 'terrain', exaggeration: 1 }}); {IDLE} const b = m.getLayersOrder();
      const D = ['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief']; let runs = 0, prev = null;
      for (const id of b) {{ const d = D.includes(m.getLayer(id).type); if (d && prev !== true) runs++; prev = d; }}
      const stacks = m.painter.renderToTexture?._stacks?.length;
      m.setTerrain(null); {IDLE} const c = m.getLayersOrder();
      return {{ runs, stacks, back: JSON.stringify(a) === JSON.stringify(c), changed: JSON.stringify(a) !== JSON.stringify(b) }}""")
    print('Ebenenfolge:', o)
    check('4. mit Gelände eine Folge von Bodenebenen (eine Textur je Kachel)', o and o['runs'] == 1 and o['stacks'] == 1, o)
    check('4. ohne Gelände wieder die alte Reihenfolge', o and o['changed'] and o['back'])

    # 3. MapLibre angepasst
    n = b.js("return fetch('libs/maplibre-gl/maplibre-gl.js').then((r) => r.text()).then((t) => t.split('/*wmap:perspektive*/').length - 1)")
    check('3. MapLibre: Faktor höchstens 1 an 8 Stellen', n == 8, n)
    b.report()

print('ALLES OK' if ok else 'FEHLER')
sys.exit(0 if ok else 1)
