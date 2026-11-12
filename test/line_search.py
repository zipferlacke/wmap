"""Linie suchen: „Bus 11“, „Göttingen Linie 9“, „Darmstadt Bus L“, „S3“ (services/transit.js, app/lines.js).
1. Der Text wird richtig gelesen – auch Ort davor oder dahinter; „Busstation“, „Linienstraße“, „Bus nach“ meinen keine Linie.
2. In der Suche steht die Linie als erster Vorschlag.
3. Antippen (Overpass und Photon nachgestellt): beim Ort gesucht, nur der Verbund der nächsten Linie, erste Richtung auf der Karte,
   die andere Richtung wählbar; Zurück und Schließen räumen die Linie weg.
4. Nichts gefunden: eine klare Meldung."""
import sys
import time
from common import Browser

FAKE = """
const real = window.fetch;
const rel = (id, ref, net, lon, lat, from, to) => ({ type: 'relation', id, center: { lon, lat }, tags: { type: 'route', route: 'bus', ref, network: net, from, to, name: 'Bus ' + ref } });
window._asked = [];
window.fetch = async (u, o) => {
  const url = String(u);
  if (url.includes('photon')) return new Response(JSON.stringify({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [8.65, 49.87] }, properties: { name: 'Darmstadt', type: 'city', osm_value: 'city', osm_type: 'R', osm_id: 1 } }] }));
  if (o?.body instanceof URLSearchParams) {
    const q = o.body.get('data');
    window._asked.push(q);
    if (q.includes('rel(')) {
      const id = Number(q.match(/rel\\((\\d+)\\)/)[1]);
      return new Response(JSON.stringify({ elements: [{ type: 'relation', id, tags: { route: 'bus', ref: '11' }, members: [
        { type: 'way', role: '', ref: 1, geometry: [{ lon: 9.9, lat: 51.5 }, { lon: 9.95, lat: 51.55 }] }] }] }));
    }
    if (q.includes('"^L$"')) return new Response(JSON.stringify({ elements: [rel(3, 'L', 'RMV', 8.66, 49.88, 'Arheilgen', 'Eberstadt')] }));
    if (q.includes('"^99$"')) return new Response(JSON.stringify({ elements: [] }));
    return new Response(JSON.stringify({ elements: [
      rel(1, '11', 'VSN', 9.93, 51.53, 'Nikolausberg', 'Bahnhof'), rel(2, '11', 'VSN', 9.931, 51.531, 'Bahnhof', 'Nikolausberg'),
      rel(9, '11', 'NVV', 9.8, 51.7, 'Northeim', 'Einbeck')] }));
  }
  return real(u, o);
};
"""

with Browser(412, 915) as b:
    b.open('index.html', 4)
    bad = []
    def ok(name, c, more=''):
        print('ok    ' if c else 'FALSCH', name, more)
        if not c: bad.append(name)
    cases = {
        'Bus 11': ['11', 'Bus 11', ''], 'Linie9': ['9', 'Linie 9', ''], 'Göttingen Linie 11': ['11', 'Linie 11', 'Göttingen'],
        'Bus 11 in Göttingen': ['11', 'Bus 11', 'Göttingen'], 'Darmstadt Bus L': ['L', 'Bus L', 'Darmstadt'], 'Bus 154': ['154', 'Bus 154', ''],
        'S3': ['S3', 'S-Bahn S3', ''], 'Tram 3': ['3', 'Tram 3', ''], 'Busstation': None, 'Linienstraße': None, 'Bus nach': None, 'Linien': None,
        'Bahnhof': None, 'Hauptstraße 11': None,
    }
    got = b.js("""return import('./js/services/transit.js').then((t) => Object.fromEntries(arguments[0].map((x) => { const r = t.parseLineQuery(x); return [x, r && [r.ref, r.label, r.place]]; })))""", list(cases))
    for k, v in cases.items():
        ok(f'lesen: {k}', got[k] == v, got[k])
    b.js("const t = document.createElement('script'); t.textContent = arguments[0]; document.head.append(t);", FAKE)
    # Module nur aus der Seite holen – import() aus der Sandbox von Selenium startet die App ein zweites Mal
    b.js("""const t = document.createElement('script'); t.type = 'module';
      t.textContent = `window._stops = await import('./js/app/stops.js'); window._search = await import('./js/app/search.js');`;
      document.head.append(t);""")
    time.sleep(1)
    first = lambda s: b.js("return _search.placeSuggestions(arguments[0], () => {}).then((l) => l[0]?.title + ' / ' + l[0]?.type)", s)
    shown = lambda: b.js("return _stops.transitLine.shown")
    b.js("document.querySelector('.user-dialog .close, dialog[open] [data-close]')?.click()")
    type_ = lambda s: b.js("const q = document.querySelector('#q'); q.focus(); q.value = arguments[0]; q.dispatchEvent(new Event('input', { bubbles: true }));", s)
    f = first('Bus 11')
    ok('Vorschlag oben', f == 'Bus 11 / Linie', f)
    f = first('Hauptstraße 11')
    ok('sonst kein Linien-Vorschlag', 'Linie' not in f, f)
    type_('Bus 11')
    pick = lambda: (time.sleep(.5), b.js("document.querySelector('#search-form').requestSubmit();"))
    pick()
    for _ in range(30):
        time.sleep(.3)
        if b.js("return !!document.querySelector('[data-view=lines] [data-line]') && document.querySelector('[data-view=lines] [aria-pressed=true]')"): break
    ok('Ansicht offen', b.js("return document.querySelector('#sheet, dialog')?.dataset.current ?? document.querySelector('[data-view=lines]').hidden === false") in ('lines', True))
    ids = b.js("return [...document.querySelectorAll('[data-view=lines] [data-line]')].map((x) => x.dataset.line)")
    ok('nur der nächste Verbund', sorted(ids) == ['1', '2'], ids)
    ok('erste Richtung gewählt', b.js("return document.querySelector('[data-view=lines] [aria-pressed=true]')?.dataset.line") == '1')
    b.js("document.querySelector('[data-view=lines] [data-line=\"2\"]').click()")
    time.sleep(1.5)
    ok('andere Richtung', b.js("return document.querySelector('[data-view=lines] [aria-pressed=true]')?.dataset.line") == '2')
    ok('auf der Karte', shown() == 2)
    b.js("document.querySelector('[data-view=lines] .close-sheet').click()")
    time.sleep(.5)
    ok('Schließen räumt weg', shown() is None)
    type_('Darmstadt Bus L')
    pick()
    for _ in range(30):
        time.sleep(.3)
        if b.js("return document.querySelector('[data-view=lines] [aria-pressed=true]')"): break
    q = b.js("return _asked.find((x) => x.includes('\"^L$\"')) ?? ''")
    ok('beim Ort gesucht', '49.' in q and '8.' in q, q[60:150])
    b.js("document.querySelector('[data-view=lines] .close-sheet').click()")
    type_('Bus 99')
    pick()
    for _ in range(20):
        time.sleep(.3)
        t = b.js("return document.querySelector('[data-view=lines] .lines-list').textContent")
        if 'Keine Linie' in t: break
    ok('nichts gefunden', 'Keine Linie 99' in t, t[:50])
    b.shot('line_search')
    sys.exit(b.report() or bool(bad))
