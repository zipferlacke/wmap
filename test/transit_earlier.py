"""Bus & Bahn: früher fahren (echter Fahrplan der EFA).
1. Haltestelle Göttingen Bahnhof: „Frühere Abfahrten“ setzt ältere vor die Liste, die späteren bleiben sichtbar.
2. Verbindung Göttingen → Kassel: „Frühere Verbindungen“ setzt frühere davor, die gewählte bleibt gewählt, keine doppelt;
   nochmal geht weiter zurück."""
import sys
import time
from common import Browser

with Browser(412, 915) as b:
    b.open('index.html', 4)
    bad = []
    def ok(name, c, more=''):
        print('ok    ' if c else 'FALSCH', name, more)
        if not c: bad.append(name)
    # Als <script>: Objekte aus der Sandbox von Selenium kann MapLibre nicht an seinen Worker schicken
    b.js("""const t = document.createElement('script'); t.type = 'module';
      t.textContent = `const [s, v] = await Promise.all([import('./js/app/stops.js'), import('./js/app/views.js')]);
        v.openSheet('place');
        s.showStop({ type: 'Feature', geometry: { type: 'Point', coordinates: [9.9267, 51.5367] }, properties: { name: 'Göttingen Bahnhof' } },
          { name: 'Göttingen Bahnhof', public_transport: 'station', railway: 'station' }, 'Göttingen Bahnhof', new AbortController().signal);`;
      document.head.append(t);""")
    for _ in range(40):
        if b.js("return document.querySelectorAll('.dep-row').length"): break
        time.sleep(.5)
    times = lambda: b.js("return [...document.querySelectorAll('.dep-row time')].map((t) => t.firstChild.textContent)")
    before = times()
    ok('Abfahrten da und Knopf', before and b.js("return !!document.querySelector('[data-transit=earlier]')"), len(before))
    b.js("document.querySelector('[data-transit=earlier]').click()")
    for _ in range(40):
        time.sleep(.5)
        if b.js("return !document.querySelector('[data-transit=earlier]').disabled"): break
    after = times()
    ok('frühere stehen davor', len(after) > len(before) and after[-len(before):] == before, f'{len(before)} → {len(after)}, erste {after[0]}')
    ok('abgefahrene blass', b.js("return !!document.querySelector('.dep-row.dep-past')"))

    b.js("""const t = document.createElement('script'); t.type = 'module';
      t.textContent = `const [p, r, c] = await Promise.all([import('./js/app/route-plan.js'), import('./js/app/route-results.js'), import('./js/app/core.js')]);
        p.enterRoute({});
        p.setProfile('transit');
        c.state.waypoints = [{ label: 'Göttingen', point: [9.9267, 51.5367], me: false }, { label: 'Kassel', point: [9.4476, 51.3135], me: false }];
        window._st = c.state;
        r.computeRoutes();`;
      document.head.append(t);""")
    time.sleep(1)
    for _ in range(40):
        if b.js("return _st.routes.length"): break
        time.sleep(.5)
    n0 = b.js("return _st.routes.length")
    sel = b.js("return _st.selected")
    dep0 = b.js("return _st.routes[0].transit.dep")
    ok('Verbindungen und Knopf', n0 and b.js("return !!document.querySelector('[data-earlier]')"), n0)
    for step in (1, 2):
        n1 = b.js("return _st.routes.length")
        b.js("document.querySelector('[data-earlier]').click()")
        for _ in range(60):
            time.sleep(.5)
            if b.js("return !document.querySelector('[data-earlier]').disabled"): break
        r = b.js("return _st.routes.map((x) => [x.id, x.transit.dep, x.transit.key])")
        deps = [x[1] for x in r]
        ok(f'früher {step}: mehr, davor, sortiert', len(r) > n1 and deps == sorted(deps) and deps[0] < dep0, f'{n1} → {len(r)}')
        ok(f'früher {step}: keine doppelt', len({x[2] for x in r}) == len(r) and len({x[0] for x in r}) == len(r))
        ok(f'früher {step}: gewählte bleibt', b.js("return _st.selected") == sel and b.js("return document.querySelector('.route-opt[aria-selected=true]')?.dataset.id") == str(sel))
    ok('Zeilen = Verbindungen', b.js("return document.querySelectorAll('.transit-opt').length == _st.routes.length"))
    b.shot('transit_earlier')
    sys.exit(b.report() or bool(bad))
