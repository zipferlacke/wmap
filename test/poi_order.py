"""Orte der Grundkarte nach Wichtigkeit und Zugang (map/map.js sortPois, map/poi-access.js), Göttingen Innenstadt.

1. Eigene Ebenen: poi_early ab Zoom 14 (Supermarkt, Bäckerei, Arzt, Apotheke, Museum, Park …) über allen,
   poi_late ab 17,5 (Kleidung, Schuhe, Bücher, Kaufhaus, Büros …) unter allen; rank-Ebenen ohne diese beiden.
2. Zoom 14,5: frühe Orte zu sehen, keine späten. Zoom 16,5: noch keine späten. Zoom 18: Kleidung u. Ä. da.
3. Privat: Overpass (fest ersetzt) meldet einen Parkplatz der Kacheln als access=private und einen als
   customers → Feature-State 'private' bzw. 'limited', Deckkraft 0,4 bzw. 0,7; die übrigen 1.
4. Ortsdialog eines Parkplatzes ohne Namen: groß „Parkplatz“ (nicht „Ort“), darunter klein die Art; die
   Koordinatenzeile steht unter dem Namen vor den Knöpfen; nichts doppelt (Zugang nur als Badge oben, keine Art
   „Parkplatz“), Bekanntes als Badges, Unbekanntes in einer Zeile „Noch unbekannt: …“.
"""
import json
import sys
import time
from common import Browser

ok = True


def check(name, cond, info=''):
    global ok
    ok &= bool(cond)
    print('OK  ' if cond else 'FEHLER', name, info)


# Overpass: die Antwort legt der Test fest (window.__access); alles andere wie immer
PRELOAD = """() => {
  const own = window.fetch;
  window.fetch = (url, opts) => {
    if (!String(url).includes('/interpreter')) return own(url, opts);
    const q = decodeURIComponent(String(opts?.body ?? url));
    const elements = q.includes('[access]') ? (window.__access ?? []) : [];
    window.__asked = (window.__asked ?? 0) + (q.includes('[access]') ? 1 : 0);
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


def shown(b, zoom):
    return page(b, f"""m.jumpTo({{ center: [9.9353, 51.5335], zoom: {zoom} }}); await new Promise((ok) => m.once('idle', ok));
      return [...new Set(m.queryRenderedFeatures({{ layers: ['poi_early', 'poi_r1', 'poi_r7', 'poi_r20', 'poi_late'] }})
        .map((f) => f.layer.id + ':' + f.properties.subclass))].sort()""")
LATE = {'clothes', 'shoes', 'books', 'department_store', 'boutique', 'jewelry', 'gift', 'mobile_phone', 'perfumery'}
EARLY = {'supermarket', 'bakery', 'pharmacy', 'doctors', 'museum', 'park', 'hospital', 'theatre'}

with Browser(1200, 850) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.d.set_script_timeout(60)
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] }))")
    b.open('index.html', 4)
    b.wait("return window.__wmap?.map?.getLayer('poi_early') && window.__wmap.map.loaded()", 60)

    # 1. Ebenen
    info = b.js("""const m = window.__wmap.map; const ids = m.getStyle().layers.map((l) => l.id);
      return { order: ids.filter((i) => i.startsWith('poi_')), early: m.getLayer('poi_early')?.minzoom, late: m.getLayer('poi_late')?.minzoom,
        r1: JSON.stringify(m.getFilter('poi_r1')).includes('department_store') }""")
    check('1. poi_early ab 14, poi_late ab 17,5', info['early'] == 14 and info['late'] == 17.5, info)
    o = info['order']
    check('1. Reihenfolge: spät unten, früh oben', o.index('poi_late') < o.index('poi_r20') and o.index('poi_early') > o.index('poi_r1'), o)
    check('1. rank-Ebenen ohne frühe und späte', info['r1'])

    # 3. zuerst: Teil 2 fragte sonst dieselbe Gegend schon ohne festgelegte Antwort
    # 3. Privat: zwei Parkplätze aus den Kacheln nehmen und als privat bzw. Kunden melden
    # Unter Zoom 16 fragt WMap Overpass noch nicht – erst die Antwort festlegen, dann hinein
    park = page(b, """m.jumpTo({ center: [9.95, 51.545], zoom: 15.5 }); await new Promise((ok) => m.once('idle', ok));
      m.jumpTo({ center: [9.9353, 51.5335], zoom: 15.5 }); await new Promise((ok) => m.once('idle', ok)); const src = m.getLayer('poi_r1').source;
      const seen = new Map(), d = (c) => Math.hypot(c[0] - 9.9353, c[1] - 51.5335);
      const all = m.querySourceFeatures(src, { sourceLayer: 'poi' }).filter((f) => f.properties.subclass === 'parking' && f.id % 10 && f.geometry.type === 'Point');
      for (const f of all.sort((a, b) => d(a.geometry.coordinates) - d(b.geometry.coordinates))) if (!seen.has(f.id)) seen.set(f.id, [f.properties.name ?? '', f.geometry.coordinates]);
      return [...seen].slice(0, 300).map(([id, [name, at]]) => [id, name, at])""")
    check('3. Parkplätze in den Kacheln', len(park) >= 3, f'{len(park)}, davon ohne Namen {sum(1 for p in park if not p[1])}')
    T = {1: 'node', 2: 'way', 3: 'relation'}
    els = [{'type': T[park[0][0] % 10], 'id': park[0][0] // 10, 'center': {'lat': 51.5335, 'lon': 9.9353}, 'lat': 51.5335, 'lon': 9.9353, 'tags': {'amenity': 'parking', 'access': 'private'}},
           {'type': T[park[1][0] % 10], 'id': park[1][0] // 10, 'center': {'lat': 51.5336, 'lon': 9.9354}, 'lat': 51.5336, 'lon': 9.9354, 'tags': {'amenity': 'parking', 'access': 'customers'}}]
    # In die Seite schreiben (Skript-Element) – nicht aus Seleniums Sandbox
    b.js("const s = document.createElement('script'); s.textContent = 'window.__access = ' + arguments[0]; document.head.append(s)", json.dumps(els))
    # Ein anderer Ausschnitt, damit die Felder neu gefragt werden
    page(b, "m.jumpTo({ center: [9.9353, 51.5335], zoom: 17 }); await new Promise((ok) => setTimeout(ok, 3000)); return 1")
    ids = ','.join(str(p[0]) for p in park[:3])
    st = None
    for _ in range(20):
        st = page(b, f"""const src = m.getLayer('poi_r1').source;
          return [{ids}].map((id) => m.getFeatureState({{ source: src, sourceLayer: 'poi', id }}).access ?? 'public')""")
        if st and st[0] != 'public':
            break
        time.sleep(.5)
    check('3. Overpass gefragt', b.js("return window.__asked"), b.js("return window.__asked"))
    check('3. privat / Kunden / öffentlich', st == ['private', 'limited', 'public'], st)
    op = b.js("return JSON.stringify(window.__wmap.map.getPaintProperty('poi_r20', 'icon-opacity'))")
    check('3. Deckkraft 0,4 / 0,7 / 1', '0.4' in op and '0.7' in op, op)
    b.shot('poi_order_privat')

    # 2. Zoom
    z = {zoom: shown(b, zoom) for zoom in (14.5, 16.5, 18)}
    subs = {k: {s.split(':')[1] for s in v} for k, v in z.items()}
    print('Zoom 14,5:', sorted(subs[14.5]))
    check('2. Zoom 14,5: frühe Orte da', len(subs[14.5] & EARLY) >= 3, sorted(subs[14.5] & EARLY))
    check('2. Zoom 14,5: keine späten', not subs[14.5] & LATE, sorted(subs[14.5] & LATE))
    check('2. Zoom 16,5: keine späten', not subs[16.5] & LATE, sorted(subs[16.5] & LATE))
    check('2. Zoom 18: Kleidung u. Ä. da', len(subs[18] & LATE) >= 2, sorted(subs[18] & LATE))
    b.shot('poi_order_z18')

    # 4. Ortsdialog ohne Namen
    unnamed = next((p for p in park if not p[1]), None)
    if unnamed:
        hit = page(b, f"""m.jumpTo({{ center: {unnamed[2]}, zoom: 18 }}); await new Promise((ok) => m.once('idle', ok));
          const src = m.getLayer('poi_r1').source;
          const f = m.querySourceFeatures(src, {{ sourceLayer: 'poi' }}).find((x) => x.id === {unnamed[0]});
          const p = m.project(f.geometry.coordinates); const c = document.querySelector('#map canvas'); const r = c.getBoundingClientRect();
          const o = {{ bubbles: true, clientX: r.left + p.x, clientY: r.top + p.y, button: 0 }};
          const hit = m.queryRenderedFeatures([p.x, p.y]).map((x) => x.layer.id + ':' + (x.properties.subclass ?? ''));
          for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, o)); return hit""")
        d = b.wait("""const v = document.querySelector('[data-view=place]'); const t = v.querySelector('.place-title').textContent;
          return !v.hidden && t && t !== 'Ort' && [t, v.querySelector('.place-sub').textContent,
            [...v.children].map((c) => c.className).filter(Boolean), v.querySelectorAll('.place-coords .coord').length, v.querySelector('.poi-unknown')?.textContent.trim() ?? '',
            [...v.querySelectorAll('.poi-badges li')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()), v.querySelector('.poi-access')?.textContent.trim() ?? '']""", 20)
        check('4. Titel „Parkplatz“ statt „Ort“', d and d[0] == 'Parkplatz', [d, unnamed, hit])
        check('4. Art klein darunter', d and 'Parkplatz' in d[1], d and d[1])
        cls = d[2] if d else []
        check('4. Koordinaten unter dem Namen, vor den Knöpfen', d and d[3] >= 5 and cls.index('place-coords') == cls.index('sheet-head') + 1 and cls.index('actions') == cls.index('place-coords') + 1, cls)
        check('4. nichts doppelt: kein Badge „Zugang“, keine Art „Parkplatz“', d and not any(x.startswith(('lock_open Zugang', 'garage Art Parkplatz')) for x in d[5]), d and [d[5], d[6]])
        check('4. Unbekanntes in einer Zeile', d and d[4].startswith('help') and 'Noch unbekannt:' in d[4] and not any('unbekannt' in x for x in d[5]), d and d[4])
        b.shot('poi_order_dialog')
    else:
        check('4. Parkplatz ohne Namen gefunden', False, park)

    rc = b.report()
    sys.exit(0 if ok and rc == 0 else 1)
