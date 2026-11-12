"""Suche ohne Suchdienst (app/search-direct.js): Koordinaten in jedem Format und Karten-Links.

1. Lesen (core/coords.js, core/map-links.js): Dezimalgrad mit Punkt und Komma, N/E, Grad-Minuten-Sekunden,
   Grad mit Dezimalminuten, MGRS (mit und ohne Leerzeichen, kürzer), UTM, Plus Code (lang, kurz beim Ort);
   Adressen und Hausnummern bleiben Suche. MGRS gegen bekannte Werte (0/0, Washington Monument), hin und
   zurück über die ganze Welt höchstens 1 m daneben.
2. Links: WMap (app.wuefl.de, dev.wuefl.de, mit Text drum), OSM (#map, mlat, node), Google (Stecknadel, @, q),
   Apple, Bing, geo:, Google-Kurzlink; fremde Seiten ohne /wmap/ sind kein WMap-Link.
3. Oben in der Suche: Koordinate → ein Vorschlag mit MGRS darunter, Enter zeigt den Punkt (Titel, Zeile mit
   Breite/Länge und MGRS); MGRS ebenso; Google-Link mit Namen; WMap-Link → „WMap-Link öffnen“.
4. Im Routenfeld: Koordinate wird Wegpunkt.
5. Jeder Ort zeigt die Koordinatenzeile (Suchtreffer „Göttingen“).
6. Koordinatenzeile: unter dem Namen, vor den Knöpfen, Breite/Länge und MGRS immer; aufklappen zeigt UTM,
   Plus Code, Grad/Min/Sek –
   bleibt beim nächsten Ort aufgeklappt.
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


def typed(b, text, sel='#q'):
    b.js("""document.querySelector('#suggest').replaceChildren(); const q = document.querySelector(arguments[1]);
      q.focus(); q.value = arguments[0]; q.dispatchEvent(new Event('input', { bubbles: true }))""", text, sel)
    return b.wait("""const li = [...document.querySelectorAll('#suggest li[data-i]')];
      return li.length && li.map((l) => [l.querySelector('strong')?.textContent, l.querySelector('small')?.textContent ?? '',
        l.querySelector('.sg-type span')?.textContent ?? ''])""", 15)


with Browser(1200, 850) as b:
    # Ohne Willkommen – das nähme dem Suchfeld den Fokus
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1')")
    b.open('index.html', 5)

    # 1. und 2. Lesen
    r = b.d.execute_async_script("""
      const done = arguments[0];
      Promise.all([import('./js/core/coords.js'), import('./js/core/map-links.js')]).then(([c, l]) => {
        const goe = [9.9355, 51.5319];
        const P = (t, ref) => c.parseCoords(t, ref);
        const near = (p, q = goe, m = 3) => !!p && Math.hypot((p[0] - q[0]) * Math.cos(q[1] * Math.PI / 180), p[1] - q[1]) * 111320 <= m;
        const mg = c.fmtMgrs(goe);
        const cases = {
          dez: P('51.5319, 9.9355'), komma: P('51,5319 9,9355'), komma2: P('51,5319, 9,9355'), ne: P('N 51.5319 E 9.9355'),
          ne2: P('51.5319N 9.9355E'), dms: P(`51°31'54.84"N 9°56'07.8"E`), ddm: P('N 51° 31.914 E 009° 56.130'),
          dmsOhne: P(`51° 31' 54.84" 9° 56' 07.8"`), mgrs: P(mg), mgrsZus: P(mg.replace(/ /g, '')),
          utm: P(`32U ${Math.round(c.toUtm(goe).easting)} ${Math.round(c.toUtm(goe).northing)}`),
        };
        const out = { mg, near: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, near(v?.point)])) };
        out.kurz = near(P('32U NC 648 093')?.point, goe, 120);
        out.zero = c.fmtMgrs([1e-7, 1e-7]);
        out.wash = c.fmtMgrs([-77.0352, 38.8895]);
        out.plus = near(P('8FVC9G8F+6X').point, [8.5249375, 47.3655625], 1);
        out.plusKurz = near(P('9G8F+6X', [8.5, 47.4]).point, [8.5249375, 47.3655625], 1);
        out.plusRest = P('9G8F+6X Zürich');
        out.keine = ['Hauptstraße 5', '12 5', '37073', 'Weg 1, 2', 'A7', 'Rewe'].map((t) => [t, P(t)]).filter(([, v]) => v);
        let worst = 0;
        for (let lat = -79.5; lat < 84; lat += 3.7) for (let lon = -179.5; lon < 180; lon += 4.3) {
          const p = P(c.fmtMgrs([lon, lat])).point;
          worst = Math.max(worst, Math.hypot((p[0] - lon) * Math.cos(lat * Math.PI / 180), p[1] - lat) * 111320);
        }
        out.worst = worst;
        const L = (t) => l.parseMapLink(t);
        out.links = {
          wmap: L('https://app.wuefl.de/wmap/tour.html#k=abc'), dev: L('https://dev.wuefl.de/wmap/?ort=9.9,51.5&name=X'),
          satz: l.linkTarget('Schau mal: https://dev.wuefl.de/wmap/wege.html#weg=xyz.'),
          fremd: L('https://example.com/?ort=9.9,51.5'),
          osmMap: L('https://www.openstreetmap.org/#map=17/51.53190/9.93550'), osmMarker: L('https://www.openstreetmap.org/?mlat=51.5319&mlon=9.9355#map=18/51.5319/9.9355'),
          osmNode: L('https://www.openstreetmap.org/node/240109189'),
          gPin: L('https://www.google.com/maps/place/G%C3%A4nseliesel/@51.5330,9.9340,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5319!4d9.9355'),
          gAt: L('https://www.google.de/maps/@51.5319,9.9355,15z'), gQ: L('https://maps.google.com/?q=51.5319,9.9355'),
          gSuche: L('https://www.google.com/maps/search/?api=1&query=Gänseliesel+Göttingen'),
          apple: L('https://maps.apple.com/?ll=51.5319,9.9355&q=G%C3%A4nseliesel'), bing: L('https://www.bing.com/maps?cp=51.5319~9.9355&lvl=16'),
          geo: L('geo:51.5319,9.9355?z=15'), kurz: L('https://maps.app.goo.gl/AbCdEf'), keinLink: L('Göttingen'),
        };
        done(out);
      }).catch((e) => done(String(e)));""")
    if isinstance(r, str):
        check('Module laden', False, r)
        sys.exit(1)
    check('Lesen: alle Formate bei Göttingen', all(r['near'].values()), json.dumps(r['near']))
    check('Lesen: MGRS mit 3 Stellen (100 m)', r['kurz'])
    check('MGRS 0/0 = 31N AA 66021 00000', r['zero'] == '31N AA 66021 00000', r['zero'])
    check('MGRS Washington Monument ≈ 18S UJ 23487 06483', r['wash'] in ('18S UJ 23487 06483', '18S UJ 23486 06483'), r['wash'])
    check('MGRS hin und zurück ≤ 1 m', r['worst'] <= 1, f"{r['worst']:.2f} m")
    check('Plus Code lang und kurz', r['plus'] and r['plusKurz'])
    check('Plus Code kurz mit Ort → Ort suchen', r['plusRest'] and r['plusRest'].get('short') == '9G8F+6X' and r['plusRest'].get('rest') == 'Zürich')
    check('Adressen bleiben Suche', not r['keine'], r['keine'])
    k = r['links']
    near_goe = lambda v: bool(v) and abs(v['point'][0] - 9.9355) < 1e-4 and abs(v['point'][1] - 51.5319) < 1e-4
    check('Link WMap app.wuefl.de', k['wmap'] == {'wmap': './tour.html#k=abc'}, k['wmap'])
    check('Link WMap dev.wuefl.de', k['dev'] == {'wmap': './index.html?ort=9.9,51.5&name=X'}, k['dev'])
    check('Link WMap im Satz', k['satz'] == './wege.html#weg=xyz', k['satz'])
    check('Fremde Seite ist kein WMap-Link', not (k['fremd'] or {}).get('wmap'), k['fremd'])
    check('Link OSM #map (Ansicht)', near_goe(k['osmMap']) and k['osmMap']['zoom'] == 17 and k['osmMap'].get('view'))
    check('Link OSM Marker', near_goe(k['osmMarker']) and not k['osmMarker'].get('view'))
    check('Link OSM Knoten', k['osmNode'] == {'osm': {'type': 'N', 'id': 240109189}}, k['osmNode'])
    check('Link Google Stecknadel mit Namen', near_goe(k['gPin']) and k['gPin']['name'] == 'Gänseliesel', k['gPin'])
    check('Link Google @ (Ansicht)', near_goe(k['gAt']) and k['gAt']['zoom'] == 15 and k['gAt']['view'])
    check('Link Google ?q=', near_goe(k['gQ']) and not k['gQ']['view'])
    check('Link Google Suche', k['gSuche'] == {'query': 'Gänseliesel Göttingen'}, k['gSuche'])
    check('Link Apple', near_goe(k['apple']) and k['apple']['name'] == 'Gänseliesel')
    check('Link Bing', near_goe(k['bing']) and k['bing']['zoom'] == 16)
    check('Link geo:', near_goe(k['geo']) and k['geo']['zoom'] == 15)
    check('Google-Kurzlink erkannt', k['kurz'] == {'short': True})
    check('Ortsname ist kein Link', k['keinLink'] is None)

    # 3. Oben in der Suche
    items = typed(b, '51.5319, 9.9355')
    check('Suche: Koordinate → ein Vorschlag mit MGRS', items and len(items) == 1 and items[0][0] == '51.53190, 9.93550' and r['mg'] in items[0][1], items)
    b.js("document.querySelector('#search-form').requestSubmit()")
    shown = b.wait("""const v = document.querySelector('[data-view=place]'); return !v.hidden && v.querySelectorAll('.place-coords .coord').length >= 5
      && [v.querySelector('.place-title').textContent, [...v.querySelectorAll('.place-coords .coord')].map((c) => c.lastChild.textContent.trim())]""", 15)
    check('Enter zeigt den Punkt mit Koordinatenzeile', shown and shown[0] == '51.53190, 9.93550' and r['mg'] in shown[1][1], shown)
    sub = b.wait("const s = document.querySelector('[data-view=place] .place-sub').textContent; return s.startsWith('bei ') && s", 15)
    check('… und Adresse darunter', sub, sub)
    b.shot('search_direct_punkt')

    items = typed(b, r['mg'])
    check('Suche: MGRS', items and items[0][0] == r['mg'] and items[0][2] == 'MGRS', items)
    items = typed(b, 'https://www.google.com/maps/place/G%C3%A4nseliesel/@51.5330,9.9340,17z/data=!3d51.5319!4d9.9355')
    check('Suche: Google-Link mit Namen', items and items[0][0] == 'Gänseliesel', items)
    items = typed(b, 'https://dev.wuefl.de/wmap/tour.html#k=abc')
    check('Suche: WMap-Link öffnen', items and items[0][0] == 'WMap-Link öffnen' and items[0][1] == 'Tour', items)
    items = typed(b, '9G8F+6X Zürich')
    check('Suche: kurzer Plus Code mit Ort', items and items[0][2] == 'Plus Code' and '47.3655' in items[0][1] + items[0][0], items)

    # 4. Routenfeld
    b.js("document.querySelector('#q-clear').click()")
    time.sleep(.5)
    b.js("document.querySelector('#to-route').click()")
    b.wait("return document.querySelectorAll('#waypoints input').length >= 2", 10)
    items = typed(b, '51.5319 9.9355', '#waypoints input')
    check('Routenfeld: Koordinate als Vorschlag', items and any(i[0] == '51.53190, 9.93550' for i in items), items)
    b.js("[...document.querySelectorAll('#suggest li[data-i] strong')].find((s) => s.textContent === '51.53190, 9.93550')?.closest('button').click()")
    wp = b.wait("const i = [...document.querySelectorAll('#waypoints input')]; return i.some((x) => x.value === '51.53190, 9.93550') && i.map((x) => x.value)", 10)
    check('… wird Wegpunkt', wp, wp)

    # 5. Jeder Ort zeigt Koordinaten
    b.open('index.html?q=Weender%20Stra%C3%9Fe%2012%20G%C3%B6ttingen', 6)
    row = b.wait("const c = [...document.querySelectorAll('[data-view=place] .place-coords .coord')]; return c.length >= 5 && c.map((x) => x.lastChild.textContent.trim())", 20)
    check('Suchtreffer zeigt Koordinatenzeile', row and row[1][:3] == '32U', row)
    b.shot('search_direct_ort')

    # 6. Aufklappen – mit einem Punkt aus der Koordinatensuche (braucht keinen Suchdienst)
    typed(b, '51.5330 9.9340')
    b.js("document.querySelector('#search-form').requestSubmit()")
    b.wait("const v = document.querySelector('[data-view=place]'); return !v.hidden && v.querySelector('.place-title').textContent === '51.53300, 9.93400'", 15)
    order = b.js("return [...document.querySelector('[data-view=place]').children].map((c) => c.className).filter(Boolean)")
    check('6. Koordinaten unter dem Namen, vor den Knöpfen', order.index('place-coords') == order.index('sheet-head') + 1 and order.index('actions') == order.index('place-coords') + 1, order)
    closed = b.js("return document.querySelector('.place-coords .coord-list').hidden")
    b.js("document.querySelector('.place-coords .coord-more').click()")
    rows = b.js("const l = document.querySelector('.place-coords .coord-list'); return !l.hidden && [...l.querySelectorAll('dt')].map((d) => d.textContent + ': ' + d.nextElementSibling.querySelector('.coord').lastChild.textContent.trim())")
    main = b.js("return [...document.querySelectorAll('.place-coords .coord-main .coord')].map((c) => c.lastChild.textContent.trim())")
    check('6. immer sichtbar: Breite/Länge und MGRS', main and len(main) == 2 and main[1].startswith('32U NC'), main)
    check('6. zu → aufklappen zeigt UTM, Plus Code, Grad/Min/Sek', closed and rows and len(rows) == 3 and rows[0].startswith('UTM: 32U ') and '+' in rows[1] and '°' in rows[2], rows)
    # Der angezeigte Plus Code führt zurück an denselben Punkt
    plus = rows[1].split(': ', 1)[1] if rows else ''
    items = typed(b, plus)
    check('6. Plus Code hin und zurück', items and items[0][2] == 'Plus Code' and abs(float(items[0][1].split(',')[0]) - 51.533) < 2e-4 and abs(float(items[0][1].split(',')[1].split(' ')[1]) - 9.934) < 3e-4, items)
    items = typed(b, '51.5319, 9.9355')
    b.js("document.querySelector('#search-form').requestSubmit()")
    still = b.wait("const v = document.querySelector('[data-view=place]'); return !v.hidden && v.querySelector('.place-title').textContent === '51.53190, 9.93550' && !v.querySelector('.coord-list').hidden", 15)
    check('6. beim nächsten Ort noch aufgeklappt', still)
    b.shot('search_direct_formate')

    rc = b.report()
    sys.exit(0 if ok and rc == 0 else 1)
