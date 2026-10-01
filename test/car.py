"""Autobildschirm (js/car/car.js) im Browser: index.html?car zeigt nur die Karte; die Schnittstelle für Kotlin
(wmapCar.call → window.__carOut) liefert Kategorien, Parkplätze in der Nähe (erst aus den Kacheln, dann mit
Overpass), freie Fahrt (Pfeil auf der Straße, Tempo, Straßenname), Suche mit Kategorie, Ort mit Details, Route mit Auswahl, geplante Tour (nur
die fürs Auto geplanten, gerechnet immer mit dem Auto) und Navigation mit Anweisungen
als Daten; kurze Fragen kommen als Hinweis mit Ja/Nein und die Antwort zurück."""
import json
import sys
import time
from common import Browser

CALL = r"""
const [method, args] = arguments;
const id = (window.__carId = (window.__carId ?? 0) + 1);
window.wmapCar.call(id, method, args);
return id;
"""
REPLY = "return JSON.stringify((window.__carOut ?? []).find((e) => e.type === 'reply' && e.data.id === arguments[0])?.data ?? null)"
EVENTS = "return JSON.stringify((window.__carOut ?? []).filter((e) => e.type === arguments[0]).map((e) => e.data))"


def call(b, method, *args, seconds=60):
    i = b.js(CALL, method, list(args))
    for _ in range(seconds * 4):
        r = json.loads(b.js(REPLY, i))
        if r:
            if not r['ok']:
                print(f'  {method}: FEHLER {r["error"]}')
            return r.get('value')
        time.sleep(.25)
    print(f'  {method}: keine Antwort')
    return None


def events(b, kind):
    return json.loads(b.js(EVENTS, kind))


with Browser(width=800, height=480) as b:
    b.open('index.html?car&view=9.9355,51.5335,15.5', wait=6)
    b.wait("return (window.__carOut ?? []).some((e) => e.type === 'ready')", 30)
    b.js("window.__wmap.state.position = [9.9355, 51.5335]")
    # GPS nachstellen, bevor init die freie Fahrt startet
    b.js("""window.__fix = null; Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => ({
      watchPosition: (ok) => { window.__fix = ok; return 1; }, clearWatch: () => {}, getCurrentPosition: () => {} }) });""")
    hidden = b.js("return ['#search', '#sheet', '.appbar', '#nav'].every((s) => !document.querySelector(s) || !document.querySelector(s).checkVisibility())")
    full = b.js("const r = document.querySelector('#map').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight")
    print('nur Karte:', hidden, full)
    call(b, 'init', {'dark': False, 'insets': {'top': 60, 'left': 320, 'right': 70, 'bottom': 10}})

    # Freie Fahrt: 8 m neben einer Straße, 36 km/h → Pfeil auf der Straße, Tempo, Straßenname
    drive = b.d.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        const map = window.__wmap.map;
        for (let i = 0; i < 40 && !window.__fix; i++) await new Promise((r) => setTimeout(r, 100));
        const roads = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name', filter: ['match', ['get', 'class'], ['secondary', 'tertiary', 'minor'], true, false] })
          .filter((f) => f.geometry.type === 'LineString' && f.properties.name && f.geometry.coordinates.length >= 2)
          // lang genug, dass 5 × 10 m/s zur Bewegung passen (sonst glaubt trustedSpeed dem Tempo nicht)
          .filter((f) => { const [a, c] = f.geometry.coordinates; return Math.hypot((c[0] - a[0]) * 69000, (c[1] - a[1]) * 111320) >= 50; });
        const f = roads[0];
        if (!f) return 'keine Straße';
        const [a, c] = f.geometry.coordinates;
        const off = 8 / 111320;
        const t0 = Date.now();
        for (let i = 0; i <= 5; i++) {
          const k = i / 5;
          const p = [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k + off];
          window.__fix({ coords: { longitude: p[0], latitude: p[1], accuracy: 10, speed: 10, heading: null }, timestamp: t0 + i * 1000 });
          await new Promise((r) => setTimeout(r, 300));
        }
        const m = document.querySelector('.car-me');
        return { road: f.properties.name, arrow: !!m, kmh: document.querySelector('.car-kmh strong')?.textContent,
          street: document.querySelector('.car-street')?.textContent, streetShown: !document.querySelector('.car-street')?.hidden,
          pitch: Math.round(map.getPitch()) };
      })().then(done, (e) => done('FEHLER ' + e));""")
    print('Freie Fahrt:', drive)

    cats = call(b, 'categories')
    print('Kategorien:', [c['id'] for c in cats or []])
    park = call(b, 'category', 'parking')
    print('Parkplätze sofort:', len(park['items']) if park else None, (park or {}).get('items', [{}])[:1])
    time.sleep(8)
    later = [e for e in events(b, 'list') if park and e['token'] == park['token']]
    print('Parkplätze mit Overpass:', [len(e['items']) for e in later])
    time.sleep(1.5)
    fit = b.js("const m = window.__wmap.map; return [+m.getZoom().toFixed(1), arguments[0].every((p) => m.getBounds().contains(p))]", [x['point'] for x in park['items'][:5]])
    print('Karte auf die Treffer (Zoom, die nächsten fünf im Bild):', fit)
    # Nummer am Namen und derselbe Punkt auf der Karte
    last_list = (later[-1] if later else park)['items']
    dots = b.js("return [...document.querySelectorAll('.car-hit')].map((e) => e.textContent)")
    numbers = [x['title'].rsplit(' ', 1)[-1] for x in last_list]  # „(3)“ – in Klammern, gehört nicht zum Namen
    print('Nummern in der Liste:', numbers[:5], '· Punkte auf der Karte:', dots[:5], len(dots))

    found = call(b, 'search', 'Bäckerei')
    print('Suche „Bäckerei“:', [(x.get('kind', 'ort'), x['title']) for x in (found or {}).get('items', [])[:4]])
    found = call(b, 'search', 'Göttingen Bahnhof')
    first = next((x for x in (found or {}).get('items', []) if x.get('key')), None)
    print('Suche „Göttingen Bahnhof“:', first and (first['title'], first['sub']))
    place = call(b, 'place', first['key']) if first else None
    print('Ort:', place and {k: place[k] for k in ('title', 'type', 'address', 'distText', 'status')})
    marker = b.js("return !!document.querySelector('.wp-marker.place')")

    route = call(b, 'routeTo', first['key']) if first else None
    print('Route:', route and (route['title'], [r['title'] for r in route['routes']]))
    # Die Routen füllen die freie Fläche neben der Liste (der Rand der freien Fahrt darf nicht mitzählen)
    time.sleep(1.5)
    fill = b.js("""const { map, state } = window.__wmap; const c = map.getContainer(); const i = map.carInsets;
      const all = state.routes.map((r) => r.bounds);
      const a = map.project([Math.min(...all.map((x) => x[0])), Math.max(...all.map((x) => x[3]))]);
      const z = map.project([Math.max(...all.map((x) => x[2])), Math.min(...all.map((x) => x[1]))]);
      const fw = c.clientWidth - i.left - i.right, fh = c.clientHeight - i.top - i.bottom;
      return { w: +((z.x - a.x) / fw).toFixed(2), h: +((z.y - a.y) / fh).toFixed(2),
        inside: a.x >= i.left && z.x <= c.clientWidth - i.right && a.y >= i.top && z.y <= c.clientHeight - i.bottom }""")
    print('Routenvorschau füllt die freie Fläche (Anteil Breite/Höhe):', fill)
    # Lesezeichen als Kacheln
    b.js("""localStorage.setItem('wmap.saved', JSON.stringify({ connections: [], deleted: {}, places: [
      { id: 'p1', kind: 'fav', name: 'Kiessee', label: 'Göttingen', point: [9.923, 51.517], list: 'Allgemein', updated: 1 },
      { id: 'p2', kind: 'home', name: 'Zuhause', label: 'Rittmarshausen', point: [10.1036, 51.4814], updated: 1 }] }))""")
    marks = call(b, 'bookmarks')
    empty = call(b, 'search', '')
    b.js("localStorage.removeItem('wmap.saved')")
    print('Lesezeichen:', [(x['title'], x['place'], x['kind'], len(x['png']) > 100) for x in (marks or {}).get('items', [])], '· leere Suche:', [x['title'] for x in (empty or {}).get('items', [])])
    # Filter wie in der App: Autobahnen vermeiden → gespeichert, die Strecke wird neu gerechnet
    before = call(b, 'routePrefs')
    call(b, 'setRoutePref', 'highways', True)
    stored = b.js("return JSON.parse(localStorage.getItem('wmap.routePrefs'))")
    again = call(b, 'routesAgain')
    call(b, 'setRoutePref', 'highways', False)
    # In der App geändert (derselbe Speicher): das Auto liest neu
    b.js("localStorage.setItem('wmap.routePrefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('wmap.routePrefs')), tolls: false }))")
    from_app = call(b, 'routePrefs')
    b.js("localStorage.removeItem('wmap.routePrefs')")
    call(b, 'routePrefs')
    print('Filter:', before, stored and stored.get('highways'), again and len(again['routes']), from_app)
    ok_start = call(b, 'start')
    time.sleep(3)
    call(b, 'overview')
    time.sleep(1.5)
    guide = events(b, 'guidance')
    print('Navigation:', ok_start, 'Anweisungen:', len(guide), guide[-1] if guide else None, 'Start gemeldet:', bool(events(b, 'navStart')))
    # Am Ziel endet die Navigation im Auto von selbst (30 s – hier verkürzt)
    b.js("window.__carArrivedMs = 800; dispatchEvent(new CustomEvent('wmap:guidance', { detail: { arrived: true, street: 'Am Ziel' } }))")
    time.sleep(2.5)
    arrived_end = bool(events(b, 'navEnd')) and (events(b, 'guidance') or [{}])[-1].get('arrived') is True
    print('Ziel erreicht → endet von selbst:', arrived_end)
    call(b, 'stop')
    time.sleep(1)
    ended = bool(events(b, 'navEnd'))
    # Bildrate im Auto begrenzt (core/fps.js)
    fps = b.d.execute_async_script("const done = arguments[arguments.length - 1]; let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(n / 2); }; requestAnimationFrame(f);")
    print('Bilder je Sekunde im Auto:', fps)

    # Kurze Frage → Hinweis im Auto, Antwort zurück
    b.js("import('./js/osm/quick-ask.js').then(({ quickAsk }) => quickAsk({ pill: true, icon: 'store', title: 'Gibt es die Bäckerei noch?' }).then((v) => { window.__asked = v; }))")
    ask = None
    for _ in range(20):
        asks = events(b, 'ask')
        if asks:
            ask = asks[-1]
            break
        time.sleep(.25)
    print('Frage:', ask and (ask['title'], [o['label'] for o in ask['options']], len(ask['icon']) > 100))
    if ask:
        call(b, 'answer', ask['id'], 'yes')
    time.sleep(.5)
    answered = b.js("return window.__asked")

    # Fürs Auto geplant (drive) steht in „Meine Touren“, die Wanderung nicht; gerechnet wird immer mit dem Auto –
    # auch wenn am Handy zuletzt das Rad gewählt war (dessen Wahl bleibt, wie sie ist)
    b.js("""localStorage.setItem('wmap.profile', '"bike"');
      localStorage.setItem('wmap.tours', JSON.stringify([
      { id: 'tcar', name: 'Zum Kiessee', profile: 'drive', points: [[9.9355, 51.5335], [9.9265, 51.5185]], stats: { length: 2100 } },
      { id: 'tfoot', name: 'Wallrunde', profile: 'hike', points: [[9.9355, 51.5335], [9.9265, 51.5185]], stats: { length: 3000 } }]))""")
    ts = call(b, 'tours')
    print('Touren:', ts and [(t['id'], t['sub']) for t in ts['items']])
    tr = call(b, 'tour', 'tcar')
    print('Tour als Route:', tr and tr['title'], tr and len(tr['routes']))
    profile = b.js("return [window.__wmap.state.profile, localStorage.getItem('wmap.profile')]")
    print('Wanderung im Auto:', end=' ')
    foot = call(b, 'tour', 'tfoot')
    print('Profil im Auto / am Handy gemerkt:', profile)
    call(b, 'clear')
    b.shot('car')

    # Start am Standort statt beim Globus: Android gibt ihn mit (?at=), sonst gilt der zuletzt im Auto gemerkte
    start = "const m = window.__wmap.map, c = m.getCenter(); return [+c.lng.toFixed(3), +c.lat.toFixed(3), +m.getZoom().toFixed(1), Math.round(m.getPitch())]"
    b.js("localStorage.removeItem('wmap.view'); localStorage.removeItem('wmap.carPos')")
    b.open('index.html?car&at=10.1036,51.4814', wait=2)
    at_url = b.js(start)
    b.js("localStorage.setItem('wmap.carPos', '[9.936,51.534,90]')")
    b.open('index.html?car', wait=2)
    at_saved = b.js(start) + [round(b.js("return window.__wmap.map.getBearing()"))]
    b.js("localStorage.removeItem('wmap.carPos')")
    print('Start mit ?at:', at_url, '· mit gemerktem Standort:', at_saved)

    checks = {
        'nur die Karte, ganze Fläche': hidden and full,
        'Kategorien fürs Auto': bool(cats) and cats[0]['id'] == 'parking',
        'Freie Fahrt: Pfeil, Tempo, Straße, geneigt': isinstance(drive, dict) and drive['arrow'] and drive['kmh'] != '0' and drive['streetShown'] and drive['pitch'] > 30,
        'Parkplätze in der Nähe': bool(park) and (len(park['items']) > 0 or any(e['items'] for e in later)),
        'Karte zoomt auf die Treffer heraus': fit[0] <= 16 and fit[1] is True,
        'Treffer mit Nummer in Klammern am Namen und nummeriertem Punkt auf der Karte': numbers[:3] == ['(1)', '(2)', '(3)'] and dots[:3] == ['1', '2', '3'] and len(dots) == len(last_list),
        'Filter: Autobahnen vermeiden gespeichert, neu gerechnet; Änderung der App kommt an': before == {'highways': False, 'tolls': False, 'ferries': False}
            and stored and stored.get('highways') is False and bool(again) and len(again['routes']) >= 1 and from_app == {'highways': False, 'tolls': True, 'ferries': False},
        'Suche findet Kategorie': found is not None,
        'Ort mit Details und Marker': bool(place) and bool(place['title']) and marker,
        'Route berechnet': bool(route) and len(route['routes']) >= 1,
        'Routenvorschau füllt die freie Fläche neben der Liste': bool(fill) and fill['inside'] and max(fill['w'], fill['h']) >= 0.6,
        'Lesezeichen als Kacheln: Zuhause zuerst, Tipp führt zur Route; nicht doppelt in der leeren Suche':
            [(x['title'], x['place'], x['kind']) for x in (marks or {}).get('items', [])] == [('Zuhause', 'home', 'target'), ('Kiessee', 'fav', 'target')]
            and all(len(x['png']) > 100 and x.get('key') for x in marks['items']) and 'Zuhause' not in [x['title'] for x in (empty or {}).get('items', [])],
        'Navigation mit Anweisungen als Daten': ok_start and bool(guide) and 'dist' in guide[-1] and ended,
        'Frage als Hinweis mit ✕ und „Bestätigen“, Antwort kommt an': bool(ask) and answered == 'yes'
            and [(o['label'], o.get('close', False)) for o in ask['options']] == [('Schließen', True), ('Bestätigen', False)],
        'Ziel erreicht: Navigation endet von selbst': arrived_end,
        'höchstens gut 20 Bilder je Sekunde': 8 <= fps <= 24,
        'Start gleich am Standort (mitgegeben bzw. gemerkt), geneigt': at_url == [10.104, 51.481, 16.5, 50] and at_saved == [9.936, 51.534, 16.5, 50, 90],
        'Tour als Route': bool(ts) and ts['items'][0]['id'] == 'tcar' and bool(tr),
        'nur fürs Auto geplante Touren, gerechnet mit dem Auto': bool(ts) and [t['id'] for t in ts['items']] == ['tcar'] and foot is None and profile == ['car', '"bike"'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    if not all(checks.values()):
        sys.exit(1)
    sys.exit(b.report())
