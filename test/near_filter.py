"""In der Nähe: was man nicht nutzen kann, erst auf Wunsch (app/category.js filterHits). Overpass ist ersetzt durch
feste Antworten (vier Parkplätze, drei Bäckereien in Göttingen) – die Kacheln tragen keine Zugänge und Zeiten.
1. Parkplätze: der private fehlt, der Kundenparkplatz steht mit „Nur für Kunden“ da; Chip „Auch private 1“ (aus).
2. „Auch private“ an: der private kommt dazu – grau, in der Liste und auf der Karte.
3. Der Kundenparkplatz geöffnet: im Dialog deutlich „Nur für Kunden“.
4. Bäckereien: die geschlossene fehlt, Chip „Nur offene“ (an, „1 zu“); aus: sie steht grau da.
5. Suche „Rewe“: oben „„Rewe“ in der Nähe“, darunter die einzelnen Treffer; gewählt: alle Rewe der Gegend als Liste
   (Symbol der Art, nicht das der Suche). „Parkplatz“: oben die Kategorie. Mit Hausnummer: die Adressen zuerst.
6. Adresse tippen und sofort Enter (vor den Vorschlägen): der Ort geht auf – nicht „Nichts gefunden“."""
import sys
import time
from common import Browser

# Overpass: je nach Abfrage Parkplätze oder Bäckereien um die Weender Straße
PRELOAD = """() => {
  const own = window.fetch;
  const at = (i) => [9.9353 + i * 0.0004, 51.5340 + (i % 2) * 0.0003];
  const node = (id, i, tags) => ({ type: 'node', id, lat: at(i)[1], lon: at(i)[0], tags });
  const PARK = [node(901, 0, { amenity: 'parking', name: 'Öffentlich' }), node(902, 1, { amenity: 'parking', name: 'Kunden', access: 'customers' }),
    node(903, 2, { amenity: 'parking', name: 'Privat', access: 'private' }), node(904, 3, { amenity: 'parking', name: 'Erlaubt', access: 'yes' })];
  const BAKE = [node(911, 0, { shop: 'bakery', name: 'Immer offen', opening_hours: '24/7' }),
    node(912, 1, { shop: 'bakery', name: 'Nie offen', opening_hours: 'Mo-Su 00:00-00:01' }), node(913, 2, { shop: 'bakery', name: 'Ohne Zeiten' })];
  window.fetch = (url, opts) => {
    if (!String(url).includes('/interpreter')) return own(url, opts);
    const q = String(opts?.body ?? '');
    const REWE = [node(921, 0, { shop: 'supermarket', name: 'REWE City', brand: 'REWE' }), node(922, 3, { shop: 'supermarket', name: 'Rewe Markt' })];
    const elements = q.includes('parking') ? PARK : q.includes('bakery') ? BAKE : /name.*Rewe/.test(decodeURIComponent(q.replace(/\+/g, ' '))) ? REWE : [];
    return Promise.resolve(new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
}"""
LIST = """return { sub: document.querySelector('.cat-sub')?.innerText, chips: [...document.querySelectorAll('.cat-list .hit-filters .chip')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? ' *' : '')),
  rows: [...document.querySelectorAll('.cat-list button[data-i] .sg-text')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim() + (x.closest('li').classList.contains('hit-muted') ? ' [grau]' : '')) }"""
# Auf der Karte grau: die Punkte der Hervorhebung
GREY = "const done = arguments[0]; window.__wmap.map.getSource('highlight-points').getData().then((d) => done(d.features.filter((f) => f.properties.color === '#9aa0a6').map((f) => f.properties.name)))"
RUN = """const [id] = arguments; import('./js/core/categories.js').then(async (c) => { const m = await import('./js/app/category.js'); m.runCategory(c.byId(id)); });"""

def grey_on_map(b, want):
    """Grau auf der Karte – MapLibre übernimmt neue Daten im Worker, getData() hinkt kurz hinterher"""
    got = None
    for _ in range(20):
        got = b.d.execute_async_script(GREY)
        if got == want:
            break
        time.sleep(.3)
    return got


with Browser(width=420, height=900) as b:
    checks = {}
    b.d.script.add_preload_script(PRELOAD)
    b.open('index.html?view=9.9360,51.5341,17,0,0', wait=5)

    # 1. Parkplätze
    b.js(RUN, 'parking')
    b.wait("return /gefunden/.test(document.querySelector('.cat-sub')?.innerText) && !/…/.test(document.querySelector('.cat-sub').innerText)", 30)
    time.sleep(.5)
    park = b.js(LIST)
    print('Parkplätze:', park)
    names = ' | '.join(park['rows'])
    checks['1. Privater fehlt, Kundenparkplatz mit „Nur für Kunden“'] = 'Privat' not in names and 'Kunden' in names and 'Nur für Kunden' in names and 'Öffentlich' in names
    checks['1. Chip „Auch private 1“, aus'] = any(c.endswith('Auch private 1') for c in park['chips'])

    # 2. Auch private
    b.js("document.querySelector('.cat-list [data-hf=priv]').click()")
    time.sleep(1.5)
    park2 = b.js(LIST)
    grey = grey_on_map(b, ['Privat'])
    print('Mit privaten:', park2, 'grau:', grey)
    checks['2. „Auch private“ an: privater da, grau (Liste und Karte)'] = any(c.endswith('Auch private 1 *') for c in park2['chips']) and any(r.startswith('Privat') and r.endswith('[grau]') for r in park2['rows']) and grey == ['Privat']
    b.shot('parkplaetze')
    b.js("document.querySelector('.cat-list [data-hf=priv]').click()")
    time.sleep(.4)

    # 3. Kundenparkplatz im Dialog
    b.js("[...document.querySelectorAll('.cat-list button[data-i]')].find((x) => x.innerText.includes('Kunden')).click()")
    time.sleep(1.5)
    note = b.js("return document.querySelector('.poi-access')?.innerText.replace(/\\s+/g, ' ').trim()")
    print('Dialog:', note)
    checks['3. Dialog: „Nur für Kunden“ deutlich'] = bool(note) and 'Nur für Kunden' in note
    b.shot('kundenparkplatz')

    # 4. Bäckereien
    b.js(RUN, 'bakery')
    b.wait("return /Bäckereien|gefunden/.test(document.querySelector('.cat-sub')?.innerText) && !/…/.test(document.querySelector('.cat-sub').innerText)", 30)
    time.sleep(.5)
    bake = b.js(LIST)
    print('Bäckereien:', bake)
    names = ' | '.join(bake['rows'])
    checks['4. Geschlossene fehlt, Chip „Nur offene 1 zu“ an'] = 'Nie offen' not in names and 'Immer offen' in names and 'Ohne Zeiten' in names and any('Nur offene 1 zu' in c and c.endswith('*') for c in bake['chips'])
    b.js("document.querySelector('.cat-list [data-hf=open]').click()")
    time.sleep(1.5)
    bake2 = b.js(LIST)
    grey = grey_on_map(b, ['Nie offen'])
    print('Auch geschlossene:', bake2, 'grau:', grey)
    checks['4. „Nur offene“ aus: die geschlossene grau dabei'] = any(r.startswith('Nie offen') and r.endswith('[grau]') for r in bake2['rows']) and grey == ['Nie offen']
    b.js("document.querySelector('.cat-list [data-hf=open]').click()")

    # 5. Suche nach Namen
    SUGGEST = "return [...document.querySelectorAll('#suggest li[data-i] .sg-text strong')].map((x) => x.innerText.trim())"
    def typed(text):
        b.js("document.querySelector('#suggest').replaceChildren(); const q = document.querySelector('#q'); q.focus(); q.value = arguments[0]; q.dispatchEvent(new Event('input', { bubbles: true }))", text)
        return b.wait(f"const s = [...document.querySelectorAll('#suggest li[data-i] .sg-text strong')].map((x) => x.innerText.trim()); return s.length > 1 && s", 30)
    rewe = typed('Rewe')
    park = typed('Parkplatz')
    addr = typed('Weender Straße 12')
    print('Vorschläge:', rewe[:3], park[:2], addr[:3])
    checks['5. „Rewe“: oben „Rewe“ in der Nähe, darunter Treffer'] = rewe[0] == '„Rewe“ in der Nähe' and len(rewe) > 1
    checks['5. „Parkplatz“: oben die Kategorie'] = park[0] == 'Parkplätze'
    checks['5. Mit Hausnummer: die Adresse zuerst'] = '„Weender Straße 12“ in der Nähe' not in addr and 'Weender' in addr[0]
    typed('Rewe')
    b.js("document.querySelector('#suggest li[data-i] button').click()")
    b.wait("return /gefunden/.test(document.querySelector('.cat-sub')?.innerText) && !/…/.test(document.querySelector('.cat-sub').innerText)", 30)
    found = b.js("return [document.querySelector('.cat-title')?.innerText.trim(), [...document.querySelectorAll('.cat-list button[data-i]')].map((x) => [x.querySelector('.dot').innerText, x.querySelector('strong').innerText])]")
    print('Rewe in der Nähe:', found)
    checks['5. Gewählt: alle Rewe in der Gegend, Symbol Supermarkt'] = len(found[1]) >= 2 and all('rewe' in n.lower() for _, n in found[1]) and found[1][0][0] != 'storefront'
    b.shot('rewe')

    # 6. Sofort Enter
    b.js("""document.querySelector('[data-view=category] .sheet-back, #q-clear')?.click(); const q = document.querySelector('#q'); q.focus(); q.value = 'Weender Straße 12';
      q.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#search-form').requestSubmit();""")
    opened = b.wait("const t = document.querySelector('[data-view=place]:not([hidden]) .place-title')?.innerText; const toast = document.querySelector('#toast')?.innerText ?? ''; return (t || /Nichts gefunden/.test(toast)) && [t ?? '', toast]", 30)
    time.sleep(1)
    print('Sofort Enter:', opened, b.js("return document.querySelector('#suggest').hidden"))
    checks['6. Sofort Enter: Ort offen, keine Vorschläge darüber'] = bool(opened) and 'Weender' in opened[0] and b.js("return document.querySelector('#suggest').hidden")

    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
