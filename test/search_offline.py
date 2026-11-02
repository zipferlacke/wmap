"""Suchdienst nicht erreichbar (Photon nachgestellt): keine rohe Fehlermeldung, Treffer aus der Karte.
1. Fällt Photon aus, wird einmal wiederholt und nie „Failed to fetch“ gezeigt.
2. Vorschläge: Namen aus dem geladenen Kartenausschnitt, darunter der Hinweis.
3. Enter in Start oder Ziel nimmt den ersten Namen aus der Karte; ein Text ohne Treffer gibt eine verständliche Meldung.
4. Läuft Photon wieder: die normalen Treffer."""
import sys
import time
from common import Browser

with Browser(412, 915) as b:
    b.open('index.html?view=9.9365,51.5343,15', 12)
    bad = []
    def ok(name, c, more=''):
        print('ok    ' if c else 'FALSCH', name, more)
        if not c: bad.append(name)
    b.js("""const t = document.createElement('script'); t.type = 'module';
      t.textContent = `window._search = await import('./js/app/search.js'); window._core = await import('./js/app/core.js'); window._plan = await import('./js/app/route-plan.js');
        window._calls = 0; window._down = true; const real = window.fetch;
        window.fetch = (u, o) => {
          if (String(u).includes('photon')) { window._calls += 1; if (window._down) return Promise.reject(new TypeError('Failed to fetch')); }
          return real(u, o);
        };
        window._suggest = (s) => _search.placeSuggestions(s, () => {}).then((l) => l.map((x) => [x.title, x.subtitle ?? '', x.type ?? '']));`;
      document.head.append(t);""")
    time.sleep(1)
    names = b.js("return _core.map.querySourceFeatures(_core.map.getStyle().layers.find((l) => l['source-layer'] === 'transportation_name').source, { sourceLayer: 'transportation_name' }).map((f) => f.properties.name).filter(Boolean)")
    ok('Karte hat Namen geladen', len(names) > 3, len(names))
    word = next(n for n in names if len(n) > 6)
    items = b.js("return _suggest(arguments[0])", word)
    print('   Vorschläge:', items[:3])
    ok('Treffer aus der Karte', items[0][0] == word and items[0][1] == 'aus der Karte', word)
    ok('Hinweis darunter', items[-1][0] == 'Suche gerade nicht erreichbar')
    ok('wiederholt (je Anfrage höchstens zwei Versuche)', 2 <= b.js("return _calls") <= 4, b.js("return _calls"))
    ok('keine rohe Meldung', not any('fetch' in ' '.join(i).lower() for i in items))
    items = b.js("return _suggest('Xyzzyquatsch')")
    ok('ohne Treffer nur der Hinweis', len(items) == 1 and 'nicht erreichbar' in items[0][1], items)
    # Enter im Feld „Start“
    b.js("""_plan.enterRoute({}); const i = document.querySelectorAll('#waypoints input')[0]; i.focus(); i.value = arguments[0];
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));""", word)
    for _ in range(20):
        time.sleep(.3)
        wp = b.js("return _core.state.waypoints[0]?.label ?? ''")
        if wp == word: break
    ok('Enter nimmt den Namen aus der Karte', wp == word, wp)
    b.js("""const i = document.querySelectorAll('#waypoints input')[1]; i.focus(); i.value = 'Xyzzyquatsch';
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));""")
    for _ in range(20):
        time.sleep(.3)
        toast = b.js("return document.body.innerText")
        if 'nicht erreichbar' in toast: break
    ok('Enter ohne Treffer: verständliche Meldung', 'nicht erreichbar' in toast and 'failed to fetch' not in toast.lower())
    b.js("_plan.leaveRouteMode(); window._down = false;")
    items = b.js("return _suggest('Göttingen')")
    ok('Photon wieder da: normale Treffer', items and items[0][1] != 'aus der Karte' and not any('nicht erreichbar' in i[0] for i in items), items[:1])
    sys.exit(b.report() or bool(bad))
