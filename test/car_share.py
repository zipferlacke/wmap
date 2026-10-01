"""App und Android Auto teilen ihre Daten (js/data/car-share.js). Läuft die Karte im Auto unter einer anderen
Adresse als die App (Debug-Fassung), hat sie einen anderen Browser-Speicher – beide gleichen dann über einen
gemeinsamen Speicher von Android ab (window.WMapAndroid.shareGet/shareSet), hier nachgestellt: die App unter
localhost, das Auto unter 127.0.0.1.
1. App: geplante Touren (ohne Vorschaubild), Lesezeichen, zuletzt Gefahrenes und Einstellungen liegen im gemeinsamen Speicher.
2. Auto (eigener, leerer Speicher): „Meine Touren“ listet die fürs Auto geplanten Touren der App (keine Wander- oder
   Radtouren), „Ziel wählen“ Zuhause und Lesezeichen.
3. Im Auto gemerkter Ort kommt in der App an; ein dort gelöschter verschwindet im Auto.
4. Gleiche Adresse (fertige App): gemeinsamer Browser-Speicher – das Auto fasst die Touren nicht an.
5. Die eingepackte Kopie, die gleich zur Webversion wechselt, legt nichts ab."""
import json
import sys
import time
import common
from common import Browser

CALL = r"""
const [method, args] = arguments;
const id = (window.__carId = (window.__carId ?? 0) + 1);
window.wmapCar.call(id, method, args);
return id;
"""
REPLY = "return JSON.stringify((window.__carOut ?? []).find((e) => e.type === 'reply' && e.data.id === arguments[0])?.data ?? null)"


def call(b, method, *args, seconds=60):
    """Anfrage der Auto-Vorlagen an die Seite (wie in car.py)"""
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


BRIDGE = """window.__shared = arguments[0] ?? {};
window.WMapAndroid = { ...(window.WMapAndroid ?? {}), shareGet: (k) => window.__shared[k] ?? '', shareSet: (k, v) => { window.__shared[k] = v; } };"""
SYNC = "const done = arguments[arguments.length - 1]; import('./js/data/car-share.js').then((m) => done(m.shareSync()), (e) => done('FEHLER ' + e))"
PLACES = "const done = arguments[arguments.length - 1]; import('./js/data/saved.js').then((m) => done(m.places.all().map((p) => p.name)))"
CAR = common.BASE.replace('//localhost', '//127.0.0.1') + 'index.html?car&view=10.03,51.47,13'
KEYS = "for (const k of ['wmap.tours', 'wmap.saved', 'wmap.recent', 'wmap.voice']) localStorage.removeItem(k)"


def open_car(b, url=CAR):
    b.d.get(url)
    time.sleep(6)
    b.wait("return (window.__carOut ?? []).some((e) => e.type === 'ready')", 30)


with Browser(width=900, height=600) as b:
    # ── 1. App ──
    b.open('wege.html', wait=3)
    b.js("""localStorage.setItem('wmap.tours', JSON.stringify([
      { id: 'tA', name: 'Harzrunde', profile: 'drive', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', stats: { length: 7000 }, updated: 5, preview: 'data:image/png;base64,AAAA' },
      { id: 'tB', name: 'Leinerunde', profile: 'drive', points: [[9.9, 51.5], [9.95, 51.52]], shape: 'abc', stats: { length: 21000 }, updated: 9 },
      { id: 'tW', name: 'Wanderung', profile: 'hike', points: [[9.9, 51.5], [9.95, 51.52]], shape: 'abc', stats: { length: 9000 }, updated: 2 }]));
      localStorage.setItem('wmap.saved', JSON.stringify({ connections: [], deleted: {}, places: [
        { id: 'p1', kind: 'home', name: 'Zuhause', label: 'Rittmarshausen', point: [10.03, 51.47], updated: 10 },
        { id: 'p2', kind: 'fav', name: 'Kulturscheune', label: '', point: [10.031, 51.471], list: 'Allgemein', updated: 11 }] }));
      localStorage.setItem('wmap.recent', JSON.stringify([{ kind: 'route', from: { label: 'Mein Standort' }, to: { label: 'Göttingen Bahnhof', point: [9.926, 51.536] }, profile: 'car', at: 100 }]));
      localStorage.setItem('wmap.voice', '"Anna"');""")
    # 5. Die eingepackte Kopie vor dem Wechsel zur Webversion: nichts ablegen
    b.js(BRIDGE, None)
    b.js("window.__wmapStarting = true")
    b.d.execute_async_script(SYNC)
    starting = b.js("return Object.keys(window.__shared)")
    b.js("window.__wmapStarting = false")
    b.d.execute_async_script(SYNC)
    shared = b.js("return window.__shared")
    app = json.loads(shared['app'])
    print('gemeinsamer Speicher:', {k: len(v) for k, v in shared.items()}, app['origin'])
    checks = {
        '1. App legt Touren ohne Vorschaubild ab, mit ihrer Adresse': [t['id'] for t in app['tours']] == ['tB', 'tA', 'tW'] and all('preview' not in t for t in app['tours']) and 'localhost' in app['origin'],
        '1. … Lesezeichen, Ziele und Einstellungen': len(json.loads(shared['places'])['places']) == 2 and json.loads(shared['recent'])[0]['to']['label'] == 'Göttingen Bahnhof' and app['settings'].get('wmap.voice') == '"Anna"',
        '5. eingepackte Kopie vor dem Wechsel legt nichts ab': starting == [],
    }

    # ── 2. Auto unter anderer Adresse: eigener, leerer Speicher ──
    open_car(b)
    empty = call(b, 'tours', '')
    b.js(BRIDGE, shared)
    items = call(b, 'tours', '')['items']
    targets = call(b, 'targets')['items']
    print('Auto vorher:', [t['title'] for t in empty['items']], '– danach:', [(t['title'], t['sub']) for t in items], [t['title'] for t in targets])
    checks['2. Auto ohne gemeinsamen Speicher: keine Touren (so war es in der Debug-Fassung)'] = empty['items'] == []
    checks['2. Auto: „Meine Touren“ zeigt die fürs Auto geplanten Touren der App, die Wanderung nicht'] = [t['title'] for t in items] == ['Leinerunde', 'Harzrunde']
    checks['2. Auto: Zuhause, Lesezeichen und letztes Ziel'] = [t['title'] for t in targets][:3] == ['Zuhause', 'Kulturscheune', 'Göttingen Bahnhof']
    checks['2. Auto: Stimme wie in der App'] = b.js("return localStorage.getItem('wmap.voice')") == '"Anna"'

    # ── 3. Im Auto gemerkt → in der App; in der App gelöscht → im Auto weg ──
    b.d.execute_async_script("const done = arguments[arguments.length - 1]; import('./js/data/saved.js').then((m) => { m.places.save({ kind: 'fav', name: 'Im Auto gemerkt', point: [10.1, 51.5] }); done(1); })")
    b.d.execute_async_script(SYNC)
    shared = b.js("return window.__shared")
    b.open('wege.html?tab=orte', wait=3)
    b.js(BRIDGE, shared)
    b.d.execute_async_script(SYNC)
    names = b.d.execute_async_script(PLACES)
    print('App nach dem Auto:', names)
    checks['3. im Auto gemerkter Ort kommt in der App an'] = names == ['Zuhause', 'Kulturscheune', 'Im Auto gemerkt']
    b.d.execute_async_script("const done = arguments[arguments.length - 1]; import('./js/data/saved.js').then((m) => { m.places.remove(m.places.all().find((p) => p.name === 'Kulturscheune').id); done(1); })")
    b.d.execute_async_script(SYNC)
    b.d.execute_async_script(SYNC)          # ein zweiter Abgleich darf die Löschung nicht vergessen
    shared = b.js("return window.__shared")
    open_car(b)
    b.js(BRIDGE, shared)
    after = [t['title'] for t in call(b, 'targets')['items']]
    print('Auto nach dem Löschen in der App:', after)
    checks['3. in der App gelöscht → im Auto weg'] = 'Kulturscheune' not in after and 'Im Auto gemerkt' in after
    b.js(KEYS)

    # ── 4. Gleiche Adresse: gemeinsamer Browser-Speicher, das Auto fasst nichts an ──
    stale = dict(shared, app=json.dumps({'origin': app['origin'], 'tours': [], 'settings': {}}))   # veraltete Kopie: keine Touren
    open_car(b, common.BASE + 'index.html?car&view=10.03,51.47,13')
    b.js(BRIDGE, stale)
    same = [t['title'] for t in call(b, 'tours', '')['items']]
    preview = b.js("return JSON.parse(localStorage.getItem('wmap.tours')).some((t) => t.preview)")
    print('gleiche Adresse:', same, preview)
    checks['4. gleiche Adresse: Touren bleiben, wie sie sind (mit Vorschaubild)'] = same == ['Leinerunde', 'Harzrunde'] and preview
    b.js(KEYS)
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
