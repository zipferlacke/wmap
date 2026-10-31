"""Meine Touren → Aufgezeichnet: Wege vergleichen (pages/wege-compare.js), Kopf eines Wegs, Antippen mit Spielraum.
1. Lange auf eine Zeile gedrückt: Kästchen statt Auge, Leiste – vergleichen geht erst ab zwei angekreuzten.
2. Zwei Läufe (der neuere schneller, mit weniger Puls): Spalten nach Datum (1.9., 15.9.), „zum vorigen Mal“ – Tempo und Herzschläge je km
   grün, Puls −5 grün; Verlauf über die Strecke: alle Größen in einem Diagramm, Tempo abwählbar; auf der Karte der aktuelle
   (ohne Wahl der neueste) in seiner Farbe, der andere grau – keine Farbe je Tour.
3. ?compare= mit drei: drei Spalten und das Diagramm „Entwicklung“; oben „3 Touren“ und der neueste als aktueller.
4. Im Weg „Vergleichen“: zurück in die Liste, der Weg ist schon angekreuzt.
5. Kopf eines Wegs: Symbol der Art und der Name als Feld zwischen ← und ✕ (kein zweites Feld darunter) – ändern speichert.
6. Auf der Karte 6 px neben der Linie getippt: der Weg geht trotzdem auf.
7. Gleiche Strecke: im dritten Lauf eine Zeile „Mit 2 Touren vergleichen“; im Vergleich oben die Stufen (Genau, Ähnlich,
   Grob mit Anzahl); Vergleichen geht vom aktuellen aus (kräftig, Veränderung „zum vorigen Mal“); in der Auswahl
   „Aktuell“ einen anderen gewählt: der ist der aktuelle; Zurück (Browser) führt zum vorigen aktuellen. In der
   Mehrfachauswahl findet die Suche den Spaziergang über seinen Tag, angehakt ist er im Vergleich (die gleiche Strecke
   bleibt), abgehakt wieder weg; ← zurück in den Weg.
8. Zurück-Taste bei offenem Dialog (Löschen?): der Dialog geht zu, die Seite bleibt; per Knopf geschlossen bleibt
   kein Eintrag im Verlauf übrig (core/back.js).
9. Sechs Läufe im Vergleich: oben nur „6 Touren“, aktuell der neueste; am Handy über dem
   Diagramm mit dem Tooltip lässt sich nichts seitlich schieben; der Tooltip zeigt je Größe eine Zeile, vorn das
   aktuelle, dahinter nur die letzten vier und das schnellste/langsamste."""
import json
import sys
import time
from common import Browser

# Drei Läufe auf derselben Strecke (5 km nach Osten), je zwei Wochen auseinander, schneller und mit weniger Puls
MAKE = """
const { buildTrack, tracks } = await import('./js/data/tracks.js');
const runs = [['cmp1', 'Lauf 1', Date.UTC(2026, 8, 1, 8), 2.8, 160], ['cmp2', 'Lauf 2', Date.UTC(2026, 8, 15, 8), 3.0, 155], ['cmp3', 'Lauf 3', Date.UTC(2026, 8, 29, 8), 3.3, 150]];
for (const [id, name, t0, v, hr] of runs) {
  const pts = []; let lon = 9.90, ms = t0;
  while ((lon - 9.90) * 69500 < 5000) { pts.push([lon, 51.53, ms, hr, 170, 250]); lon += v * 10 / 69500; ms += 10000; }
  await tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name }), id, sport: 'running' });
}
return (await tracks.all()).length;
"""
TABLE = """document.querySelectorAll('.cmp-all').forEach((d) => { d.open = true; }); return [[...document.querySelectorAll('.cmp-table thead th')].map((x) => x.innerText.trim()),
  Object.fromEntries([...document.querySelectorAll('.cmp-table tbody tr')].map((r) => [r.querySelector('th').innerText.trim(),
    [...r.querySelectorAll('td')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim() + (c.classList.contains('good') ? ' [gut]' : c.classList.contains('bad') ? ' [schlecht]' : ''))]))]"""

with Browser(width=420, height=900) as b:
    checks = {}
    b.open('wege.html', wait=3)
    made = b.d.execute_async_script('const done = arguments[0]; (async () => {' + MAKE + '})().then(done, (e) => done(String(e)))')
    print('Wege angelegt:', made)

    # 1. Liste im Modus „Vergleichen“
    b.open('wege.html', wait=4)
    b.long_press('tr[data-id=cmp1] .w-name')
    bar = b.js("return [document.querySelector('.compare-count')?.innerText, document.querySelector('[data-list=compare-go]')?.disabled, document.querySelectorAll('.row-pick').length, document.querySelectorAll('.row-eye').length]")
    print('Leiste:', bar)
    checks['1. Lang gedrückt: Leiste, drei Kästchen statt Augen, Vergleichen noch aus'] = bar == ['1 gewählt', True, 3, 0]
    b.js("document.querySelector('tr[data-id=cmp2] .row-pick').click()")
    time.sleep(.3)
    bar = b.js("return [document.querySelector('.compare-count')?.innerText, document.querySelector('[data-list=compare-go]')?.disabled, location.search]")
    print('Zwei angekreuzt:', bar)
    checks['1. Zwei angekreuzt (Zeile und Kästchen): Knopf an, nichts geöffnet'] = bar == ['2 gewählt', False, '']

    # 2. Vergleich zweier Läufe
    b.js("document.querySelector('[data-list=compare-go]').click()")
    b.wait("return document.querySelector('.cmp-table')", 20)
    time.sleep(1.5)
    head, rows = b.js(TABLE)
    print('Kopf:', head)
    print('Zeilen:', json.dumps(rows, ensure_ascii=False))
    title = b.js("return [location.search, document.querySelector('.wege-bar .uD-title').innerText.trim()]")
    checks['2. Adresse ?compare=cmp1,cmp2, Kopf „Vergleich“'] = title == ['?compare=cmp1,cmp2', 'Vergleich']
    checks['2. Spalten nach Datum 1.9., 15.9., „zum vorigen Mal“'] = head == ['', '1.9.', '15.9.', 'zum vorigen Mal']
    tempo, puls, beats = rows.get('Ø Tempo', []), rows.get('Ø Puls', []), rows.get('Herzschläge je km', [])
    checks['2. Tempo schneller: −0:… /km, grün'] = len(tempo) == 3 and tempo[2].startswith('−0:') and tempo[2].endswith('[gut]')
    checks['2. Puls −5, grün (weniger)'] = len(puls) == 3 and puls[2].startswith('−5 ') and puls[2].endswith('[gut]')
    checks['2. Herzschläge je km weniger, grün'] = len(beats) == 3 and beats[2].startswith('−') and beats[2].endswith('[gut]')
    TITLES = "return [...document.querySelectorAll('.cmp-along .elev-mountain')].map((x) => x.title)"
    chart = [b.js(TITLES), b.js("return document.querySelectorAll('.cmp-kinds .chip').length"), b.js("return !!document.querySelector('.cmp-trend')")]
    b.js("document.querySelector('[data-cmp=speed]').click()")
    time.sleep(.5)
    chart.append(b.js(TITLES))
    lines = b.d.execute_async_script("const done = arguments[0]; window.__wmap.map.getSource('weg-sel').getData().then((d) => done(d.features.map((f) => f.properties.color)))")
    print('Diagramm:', chart, 'Karte:', lines)
    checks['2. Verlauf: alle Größen in einem Diagramm, Tempo weg; ohne „Entwicklung“ bei zwei'] = chart == [['Tempo + Puls + Schrittfrequenz + Leistung'], 4, False, ['Puls + Schrittfrequenz + Leistung']]
    checks['2. Karte: der neueste in seiner Farbe, der andere grau'] = len(lines) == 2 and lines[0] == '#868e96' and lines[1] != '#868e96'
    b.shot('vergleich')

    # 3. Drei über die Adresse
    b.open('wege.html?compare=cmp3,cmp1,cmp2', wait=5)
    head, rows = b.js(TABLE)
    trend = b.js("return [!!document.querySelector('.cmp-trend:not([hidden])'), document.querySelector('.cmp-set')?.closest('sp-picker')?.querySelector('.sp_trigger').innerText.trim(), document.querySelector('.cmp-focus')?.value]")
    print('Drei:', head, trend)
    checks['3. Drei: das älteste zuerst, „Entwicklung“ da, oben „3 Touren“, aktuell der neueste'] = head == ['', '1.9.', '15.9.', '29.9.', 'zum vorigen Mal'] and trend == [True, '3 Touren', 'cmp3']
    b.js("document.querySelector('.cmp-trend').scrollIntoView()")
    time.sleep(.5)
    b.shot('vergleich_drei')

    # 4. Aus dem Weg heraus
    b.open('wege.html?id=cmp2', wait=4)
    b.js("document.querySelector('[data-do=compare]').click()")
    time.sleep(.8)
    pick = b.js("return [location.search, document.querySelector('.compare-count')?.innerText, [...document.querySelectorAll('.row-pick:checked')].map((x) => x.dataset.pick)]")
    print('Aus dem Weg:', pick)
    checks['4. „Vergleichen“ im Weg: Liste, der Weg angekreuzt'] = pick == ['', '1 gewählt', ['cmp2']]

    # 5. Kopf eines Wegs
    b.open('wege.html?id=cmp1', wait=4)
    head = b.js("const t = document.querySelector('.wege-bar .uD-title'); return [t.querySelector('.panel-title-icon')?.textContent, t.querySelector('.panel-title-input')?.value, !!document.querySelector('.weg-name'), [...document.querySelectorAll('.weg-stats small')].slice(0, 2).map((x) => x.innerText)]")
    b.js("const i = document.querySelector('.panel-title-input'); i.value = 'Morgenlauf'; i.dispatchEvent(new Event('change'))")
    time.sleep(1)
    saved = b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then((m) => m.tracks.get('cmp1')).then((t) => done(t.name))")
    print('Kopf:', head, 'gespeichert:', saved)
    checks['5. Kopf: Symbol Laufen, Name als Feld, kein Feld darunter; Zeit vor Strecke'] = head == ['directions_run', 'Lauf 1', False, ['in Bewegung', 'Strecke']]
    checks['5. Name im Kopf geändert und gespeichert'] = saved == 'Morgenlauf'

    # 6. Neben die Linie getippt
    b.open('wege.html', wait=5)
    hit = b.js("""const m = window.__wmap.map; m.jumpTo({ center: [9.93, 51.53], zoom: 13 });
      return new Promise((r) => m.once('idle', () => { const p = m.project([9.93, 51.53]); p.y += 6;
        m.fire('click', { point: p, lngLat: m.unproject(p), originalEvent: new MouseEvent('click') });
        setTimeout(() => r(new URLSearchParams(location.search).get('id')), 800); }));""")
    print('6 px daneben getippt:', hit)
    checks['6. 6 px neben der Linie: der Weg geht auf'] = hit in ('cmp1', 'cmp2', 'cmp3')

    # 7. Gleiche Strecke – ein Spaziergang auf derselben Strecke zählt bei einem Lauf nicht mit
    b.d.execute_async_script("""const done = arguments[0]; import('./js/data/tracks.js').then(async ({ buildTrack, tracks }) => {
      const pts = []; let lon = 9.90, ms = Date.UTC(2026, 8, 20, 8);
      while ((lon - 9.90) * 69500 < 5000) { pts.push([lon, 51.53, ms]); lon += 1.3 * 10 / 69500; ms += 10000; }
      await tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Spaziergang' }), id: 'cmpw', sport: 'walking', tags: ['Erholung'] }); done(1); })""")
    b.open('wege.html?id=cmp3', wait=4)
    same = b.js("const x = document.querySelector('.weg-same'); return [x && !x.hidden, x?.innerText.replace(/\\s+/g, ' ').trim()]")
    print('Vorschlag:', same)
    checks['7. Im Weg eine Zeile: Mit 2 Touren vergleichen (nur Läufe, der Spaziergang zählt nicht)'] = same[0] and same[1] == 'compare_arrows Mit 2 Touren vergleichen chevron_right'
    b.js("document.querySelector('[data-do=same]').click()")
    b.wait("return document.querySelector('.cmp-table')", 20)
    time.sleep(1)
    focus = b.js("return [location.search, document.querySelector('.cmp-focus')?.value, [...document.querySelectorAll('.cmp-table thead th')].at(-1).textContent.trim(), document.querySelector('.wege-bar .panel-title-icon')?.textContent]")
    print('Vom aktuellen aus:', focus)
    lv = b.js("return [...document.querySelectorAll('.same-level [data-same-level]')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? ' *' : ''))")
    print('Stufen:', lv)
    checks['7. Im Vergleich oben die Stufen mit Anzahl, eine gewählt'] = len(lv) == 3 and all(x.split(' ')[1] == '2' for x in lv) and sum(x.endswith('*') for x in lv) == 1
    checks['7. Vergleich vom aktuellen: ?focus=cmp3&same=cmp3, „zum vorigen Mal“'] = focus[0].endswith('&focus=cmp3&same=cmp3') and focus[1] == 'cmp3' and focus[2] == 'zum vorigen Mal'
    tiles = b.js("""const t = (k) => { document.querySelector(`[data-ref=${k}]`)?.click(); return Object.fromEntries([...document.querySelectorAll('.cmp-tile')].map((x) => [x.querySelector('small').innerText, x.querySelector(':scope > span').innerText.replace(/\\s+/g, ' ') + (x.classList.contains('good') ? ' [gut]' : x.classList.contains('bad') ? ' [schlecht]' : '')])); };
      return { refs: [...document.querySelectorAll('[data-ref]')].map((x) => x.innerText.trim()), prev: t('prev'), best: t('best'), worst: t('worst'),
        trend: [[...document.querySelectorAll('[data-trend]')].map((x) => x.innerText.trim()), document.querySelector('.cmp-trend .elev-mountain')?.title] }""")
    print('Kacheln:', json.dumps(tiles, ensure_ascii=False))
    checks['7. Kacheln: vorheriges, letzte 5, Durchschnitt, bestes, schlechtestes'] = tiles['refs'] == ['Vorheriges Mal', 'Letzte 5', 'Durchschnitt', 'Bestes', 'Schlechtestes']
    checks['7. Zum vorigen Mal: Zeit −2:…, Tempo grün; zum schlechtesten ebenso'] = tiles['prev'].get('Zeit in Bewegung', '').startswith('−') and tiles['prev'].get('Ø Tempo', '').endswith('[gut]') and tiles['worst'].get('Ø Tempo', '').endswith('[gut]')
    checks['7. Entwicklung: Gesamtzeit zuerst'] = tiles['trend'][0][0] == 'Gesamtzeit' and tiles['trend'][1] == 'Gesamtzeit'
    lines = b.d.execute_async_script("const done = arguments[0]; window.__wmap.map.getSource('weg-sel').getData().then((d) => done(Object.fromEntries(d.features.map((f) => [f.properties.id, f.properties.color]))))")
    print('Karte:', lines)
    checks['7. Karte: der aktuelle in seiner Farbe, die anderen grau'] = lines.get('cmp1') == lines.get('cmp2') == '#868e96' and lines.get('cmp3') not in (None, '#868e96')
    b.shot('gleiche_strecke')
    # Aktuell: über die Auswahl einen anderen wählen
    PICK = "const s = document.querySelector(arguments[0]); s.closest('sp-picker').querySelector('.sp_trigger').click(); return !!document.querySelector('.sp_popover.sp_open')"
    print('Auswahl offen:', b.js(PICK, '.cmp-focus'))
    time.sleep(.3)
    b.js("document.querySelector('.sp_popover.sp_open li[data-value=cmp1]').click()")
    b.wait("return location.search.includes('focus=cmp1') && document.querySelector('.cmp-focus')?.value === 'cmp1'", 20)
    time.sleep(.5)
    first = b.js("return [...document.querySelectorAll('.cmp-table thead th')].at(-1).textContent.trim()")
    b.js("history.back()")
    b.wait("return location.search.includes('focus=cmp3') && document.querySelector('.cmp-focus')?.value === 'cmp3'", 20)
    time.sleep(.5)
    checks['7. „Aktuell“ gewählt: Lauf 1 ist der aktuelle („zum nächsten Mal“), Zurück wieder Lauf 3'] = first == 'zum nächsten Mal'
    # Mehrfachauswahl: Spaziergang über seinen Tag finden und dazunehmen, dann wieder weg
    b.js(PICK, '.cmp-set')
    time.sleep(.3)
    b.js("const i = document.querySelector('.sp_popover.sp_open .sp_search'); i.value = 'erholung'; i.dispatchEvent(new Event('input'))")
    found = b.js("return [...document.querySelectorAll('.sp_popover.sp_open li[data-value]:not(.sp_option_hidden)')].map((li) => li.dataset.value)")
    b.js("document.querySelector('.sp_popover.sp_open li[data-value=cmpw]').click()")
    still = b.js("return [...document.querySelectorAll('.sp_popover.sp_open li[data-value]:not(.sp_option_hidden)')].map((li) => li.dataset.value + (li.classList.contains('sp_selected') ? '*' : ''))")
    b.js("document.querySelector('.sp_popover.sp_open .sp_btn_save').click()")
    b.wait("return location.search.includes('cmpw') && document.querySelectorAll('.cmp-table thead th').length === 6", 20)
    time.sleep(.5)
    added = b.js("return [location.search, document.querySelector('.cmp-set').closest('sp-picker').querySelector('.sp_trigger').innerText.trim(), !!document.querySelector('.same-level'), document.querySelector('.cmp-focus').value]")
    print('Suche:', found, still, '→', added)
    checks['7. Mehrfachauswahl: Suche über den Tag findet den Spaziergang, angehakt bleibt die Suche'] = found == ['cmpw'] and still == ['cmpw*']
    checks['7. Dazugenommen: 4 Touren, gleiche Strecke und aktueller bleiben'] = added[1] == '4 Touren' and added[2] and added[3] == 'cmp3' and 'same=cmp3' in added[0]
    b.js(PICK, '.cmp-set')
    time.sleep(.3)
    b.js("document.querySelector('.sp_popover.sp_open li[data-value=cmpw]').click(); document.querySelector('.sp_popover.sp_open .sp_btn_save').click()")
    b.wait("return !location.search.includes('cmpw') && document.querySelectorAll('.cmp-table thead th').length === 5", 20)
    gone = b.js("return document.querySelector('.cmp-set').closest('sp-picker').querySelector('.sp_trigger').innerText.trim()")
    checks['7. Abgehakt: wieder 3 Touren'] = gone == '3 Touren'
    b.js("document.querySelector('.wege-bar .uD-bar-btn, .wege-bar button').click()")
    time.sleep(1.5)
    back = b.js("return [location.search, !!document.querySelector('.weg-same')]")
    print('Aktuell → Lauf 1:', first, '· Zurück → Lauf 3 · ← →', back)
    checks['7. ← führt zurück in den Weg'] = back == ['?id=cmp3', True]

    b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => { await tracks.remove('cmpw'); done(1); })")
    # 8. Zurück-Taste mit offenem Dialog
    depth = b.js("return history.length")
    b.js("document.querySelector('[data-do=delete]').click()")
    time.sleep(.6)
    opened = b.js("return [!!document.querySelector('dialog:modal'), history.length]")
    b.js("history.back()")
    time.sleep(.8)
    after = b.js("return [!!document.querySelector('dialog:modal'), location.search, !!document.querySelector('.weg-same')]")
    b.js("document.querySelector('[data-do=delete]').click()")
    time.sleep(.6)
    b.js("[...document.querySelectorAll('dialog:modal button')].find((x) => x.innerText.trim() === 'Abbrechen')?.click()")
    time.sleep(.8)
    clean = b.js("return [!!document.querySelector('dialog:modal'), !!history.state?.wmapModal, location.search]")
    print('Dialog:', depth, opened, after, clean)
    checks['8. Zurück-Taste schließt den Dialog, der Weg bleibt'] = opened[0] and after == [False, '?id=cmp3', True]
    checks['8. Per Knopf geschlossen: kein Eintrag bleibt'] = clean == [False, False, '?id=cmp3']

    # 9. Sechs Läufe: oben Farbpunkte, Liste klappt auf; Tooltip am Handy schiebt nichts seitlich
    more = b.d.execute_async_script("""const done = arguments[0]; (async () => {
      const { buildTrack, tracks } = await import('./js/data/tracks.js');
      for (let k = 4; k <= 6; k++) { const pts = []; let lon = 9.90, ms = Date.UTC(2026, 9, k * 3, 8);
        while ((lon - 9.90) * 69500 < 5000) { pts.push([lon, 51.53, ms, 150 + k, 170, 250]); lon += 3.1 * 10 / 69500; ms += 10000; }
        await tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Lauf ' + k }), id: 'cmp' + k, sport: 'running' }); }
      return 1; })().then(done, (e) => done(String(e)))""")
    b.open('wege.html?compare=cmp1,cmp2,cmp3,cmp4,cmp5,cmp6', wait=6)
    who = b.js("return [document.querySelector('.cmp-set').closest('sp-picker').querySelector('.sp_trigger').innerText.trim(), document.querySelector('.cmp-focus').value, document.querySelectorAll('.cmp-set option').length]")
    print('Sechs:', who)
    checks['9. Sechs Läufe: oben nur „6 Touren“, aktuell der neueste, alle Läufe zur Wahl'] = who[0] == '6 Touren' and who[1] == 'cmp6' and who[2] >= 6
    from selenium.webdriver.common.action_chains import ActionChains
    el = b.css('.cmp-along .dg_canvas')
    b.d.execute_script('arguments[0].scrollIntoView({block: "center"})', el)
    time.sleep(.5)
    for fx in (-0.4, 0.4, 0):
        ActionChains(b.d).move_to_element_with_offset(el, int(el.size['width'] * fx), 0).perform()
        time.sleep(.2)
        ActionChains(b.d).move_by_offset(3, 0).perform()
        time.sleep(.6)
    wide = b.js("""const tip = [...document.querySelectorAll('div')].find((d) => /z-index: 9999999/.test(d.style.cssText) && d.style.display !== 'none' && d.innerText.trim());
      const r = tip?.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      const panel = document.querySelector('.wege-content');
      return [!!tip, r && Math.round(r.left), r && Math.round(r.right), vw, document.documentElement.scrollWidth, panel.scrollWidth, panel.clientWidth]""")
    print('Tooltip am Handy:', wide)
    checks['9. Tooltip im Bild, nichts lässt sich seitlich schieben'] = wide[0] and wide[1] >= 0 and wide[2] <= wide[3] and wide[4] <= wide[3] and wide[5] <= wide[6] + 1
    tipc = b.js("""const tip = [...document.querySelectorAll('div')].find((d) => /z-index: 9999999/.test(d.style.cssText) && d.style.display !== 'none' && d.innerText.trim());
      return [...(tip?.querySelectorAll('.cmp-tip-row') ?? [])].map((r) => [r.querySelector('.cmp-tip-kind')?.textContent, r.querySelector('b i')?.textContent, [...r.querySelectorAll('.cmp-tip-others i')].map((i) => i.textContent).join(',')])""")
    print('Tooltip-Zeilen:', tipc)
    checks['9. Tooltip je Größe eine Zeile: vorn das aktuelle (18.10.), dahinter nur die letzten vier und bestes/schlechtestes'] = bool(tipc) and all(r[1] == '18.10.' and r[2] and len(r[2].split(',')) <= 6 for r in tipc)
    b.shot('vergleich_sechs')
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => { for (const id of ['cmp4', 'cmp5', 'cmp6']) await tracks.remove(id).catch(() => {}); done(1); })")

    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
