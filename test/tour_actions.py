"""Aufgezeichnete Tour: Knöpfe und Navigation (pages/wege.js, data/track-share.js, app/nav.js).
1. Knöpfe: Navigieren, Als Planung öffnen, Teilen, GPX, Löschen.
2. Teilen: Dialog mit Auswahl (Puls); „Als Link teilen“ gibt wege.html#weg=… – geöffnet zeigt der Link die
   Aufzeichnung mit Tempo und Puls, noch nicht gespeichert; ohne Haken bei Puls fehlt er.
3. „Bei mir speichern“: landet unter Aufgezeichnete Touren (einmal – beim zweiten Mal „gibt es schon“).
4. Als Planung öffnen: der Planer zeigt den Verlauf als neue, ungespeicherte Tour.
5. Navigieren: vor dem Start die Frage „Tour aufzeichnen?“; der Aufnahme-Knopf zeigt an, pausiert, beendet –
   und startet später, wenn man ohne Aufzeichnung losgefahren ist."""
import json
import sys
import time
from common import Browser

MAKE = r"""
const { buildTrack, tracks } = await import('./js/data/tracks.js');
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
localStorage.removeItem('wmap.tours');
const t0 = Date.now() - 12 * 864e5; const pts = [];
for (let i = 0; i < 140; i += 1) pts.push([9.93 + i * 0.0004, 51.53 + Math.sin(i / 9) * 0.002, t0 + i * 15000, 110 + (i % 25)]);
await tracks.putQuiet({ ...buildTrack(pts, { kind: 'rec', profile: 'bike', name: 'Feierabendrunde' }), id: 'act1' });
return 1;"""
call = lambda b, code: b.d.execute_async_script('const done = arguments[arguments.length - 1]; (async () => {' + code + '})().then(done, (e) => done("FEHLER " + e))')
DLG = "return [...document.querySelectorAll('dialog[open].confirm')].map((d) => ({ title: d.querySelector('.uD-title').innerText.trim(), buttons: [...d.querySelectorAll('.confirm-actions button')].map((x) => x.innerText.trim()), boxes: [...d.querySelectorAll('.share-opts label')].map((x) => x.innerText.trim()), url: d.querySelector('.share-url')?.textContent ?? null }))"
press = lambda b, value: b.js("document.querySelector('dialog[open].confirm .confirm-actions button[value=\"%s\"]').click()" % value)


def link(b, uncheck=None):
    """Teilen → (ohne Haken bei `uncheck`) → Als Link teilen → Adresse aus dem Teilen-Dialog"""
    b.js("document.querySelector('[data-do=\"share\"]').click()")
    time.sleep(.6)
    first = b.js(DLG)
    if uncheck:
        b.js("document.querySelector('dialog[open] .share-opts input[name=\"%s\"]').click()" % uncheck)
    press(b, 'link')
    time.sleep(1.2)
    second = b.js(DLG)
    press(b, 'no')
    return first, second


with Browser(width=1300, height=900) as b:
    b.open('wege.html', wait=3)
    call(b, MAKE)
    b.open('wege.html?id=act1', wait=5)
    actions = b.js("return [...document.querySelectorAll('.weg-actions .button')].map((x) => x.innerText.trim().replace(/^\\S+\\s+/, ''))")
    print('Knöpfe:', actions)
    checks = {'1. Knöpfe: Navigieren, Als Planung öffnen, Teilen, GPX, Löschen': actions == ['Navigieren', 'Als Planung öffnen', 'Teilen', 'GPX', 'Löschen']}

    # ── 2. Teilen ──
    first, second = link(b)
    b.shot('tour-teilen')
    print('Teilen:', first, '→', second[0]['title'], (second[0]['url'] or '')[:70], len(second[0]['url'] or ''))
    url = second[0]['url']
    checks['2. Teilen fragt, was mit soll (Puls), und bietet Link, GPX- oder FIT-Datei (am Rechner: herunterladen)'] = first[0]['boxes'] == ['Puls'] and [x.split('\n')[-1] for x in first[0]['buttons']][:3] == ['Als Link teilen', 'Als GPX-Datei herunterladen', 'Als FIT-Datei herunterladen']
    checks['2. der Link trägt die Aufzeichnung (wege.html#weg=…), kurz genug zum Verschicken'] = '/wege.html#weg=' in url and len(url) < 4000
    _, bare = link(b, uncheck='hr')
    call(b, "const { tracks } = await import('./js/data/tracks.js'); await tracks.removeQuiet('act1'); return 1;")     # beim Empfänger gibt es sie nicht
    b.d.get(url); time.sleep(5)
    got = b.js("return { note: document.querySelector('.weg-note')?.innerText.trim(), charts: [...document.querySelectorAll('.weg-chart-tabs .chip')].map((c) => c.innerText.trim().replace(/^\\S+\\s+/, '')), stats: [...document.querySelectorAll('.weg-stats div')].map((d) => d.innerText.replace(/\\s+/g, ' ')), buttons: [...document.querySelectorAll('.weg-actions .button')].map((x) => x.innerText.trim().replace(/^\\S+\\s+/, '')), look: document.querySelector('.weg-look').hidden, line: window.__wmap.map.getSource('weg-sel').serialize().data.geometry?.coordinates.length }")
    print('geöffnet:', json.dumps(got, ensure_ascii=False))
    b.shot('tour-geteilt')
    checks['2. geöffnet: Aufzeichnung mit Tempo und Puls, noch nicht gespeichert'] = 'noch nicht gespeichert' in got['note'] and 'Tempo' in got['charts'] and 'Puls' in got['charts'] and any('Ø Puls' in s for s in got['stats']) and got['buttons'] == ['Bei mir speichern', 'GPX'] and got['look'] and got['line'] > 50
    # ── 3. Speichern ──
    b.js("document.querySelector('[data-do=\"keep\"]').click()"); time.sleep(2)
    kept = call(b, "const { tracks } = await import('./js/data/tracks.js'); return (await tracks.all()).map((t) => [t.name, t.kind, !!t.hr, t.length, /[?]id=/.test(location.search)]);")
    b.d.get(url); time.sleep(4)
    b.js("document.querySelector('[data-do=\"keep\"]').click()"); time.sleep(2)
    again = call(b, "const { tracks } = await import('./js/data/tracks.js'); return (await tracks.all()).length;")
    print('gespeichert:', kept, 'noch einmal:', again)
    checks['3. „Bei mir speichern“: einmal unter Aufgezeichnete Touren, mit Puls'] = len(kept) == 1 and kept[0][0] == 'Feierabendrunde' and kept[0][2] and kept[0][4] and again == 1
    b.d.get(bare[0]['url']); time.sleep(5)
    nohr = b.js("return [...document.querySelectorAll('.weg-chart-tabs .chip')].map((c) => c.innerText.trim().replace(/^\\S+\\s+/, ''))")
    print('ohne Puls geteilt:', nohr)
    checks['2. ohne Haken bei Puls: der Link enthält ihn nicht'] = 'Puls' not in nohr and 'Tempo' in nohr

    # ── 4. Als Planung öffnen ──
    tid = call(b, "const { tracks } = await import('./js/data/tracks.js'); return (await tracks.all())[0].id;")
    b.open(f'wege.html?id={tid}', wait=5)
    b.js("document.querySelector('[data-do=\"plan\"]').click()")
    time.sleep(6)
    plan = b.js("return { page: location.pathname.split('/').pop(), hash: location.hash.slice(0, 3), saved: JSON.parse(localStorage.getItem('wmap.tours') || '[]').length, name: document.querySelector('input[name=\"name\"], .tour-name input, header input')?.value ?? document.title }")
    print('Als Planung öffnen:', plan)
    b.shot('tour-planung')
    checks['4. Als Planung öffnen: Planer mit dem Verlauf, nichts gespeichert'] = plan['page'] == 'tour.html' and plan['hash'] == '#t=' and plan['saved'] == 0 and 'Feierabendrunde' in plan['name']

    # ── 5. Navigieren: fragen, Aufnahme-Knopf ──
    b.js("localStorage.setItem('wmap.contribute.seen', 'true')")     # die einmalige Frage zum Mitmachen ist hier nicht Thema
    b.open(f'index.html?track={tid}&start', wait=3)
    b.wait("return !!document.querySelector('dialog[open].confirm')", 60)
    q = b.js(DLG)
    print('vor dem Start:', q)
    press(b, 'no')
    time.sleep(2)
    state = "return [window.__wmap.nav.active, document.querySelector('.nav-rec').className.replace(/button|nav-rec/g, '').trim(), JSON.parse(localStorage.getItem('wmap.rec') || 'null')?.kind ?? null, JSON.parse(localStorage.getItem('wmap.rec') || 'null')?.paused ?? null]"
    s0 = b.js(state)
    b.js("document.querySelector('.nav-rec').click()"); time.sleep(.8)
    s1 = b.js(state)
    b.js("document.querySelector('.nav-rec').click()"); time.sleep(.8)
    menu = b.js(DLG)
    press(b, 'pause'); time.sleep(.6)
    s2 = b.js(state)
    b.shot('navi-aufzeichnung')
    b.js("document.querySelector('.nav-rec').click()"); time.sleep(.8)
    menu2 = b.js(DLG)
    press(b, 'discard'); time.sleep(.6)
    s3 = b.js(state)
    print('Knopf:', s0, s1, menu[0]['buttons'], s2, menu2[0]['buttons'][0], s3)
    checks['5. vor dem Start: „Tour aufzeichnen?“'] = q and q[0]['title'].endswith('Tour aufzeichnen?') and len(q[0]['buttons']) == 2
    checks['5. ohne Aufzeichnung gestartet: Navigation läuft, Knopf grau, nichts wird aufgezeichnet'] = s0 == [True, '', None, None]
    checks['5. Knopf startet die Aufzeichnung später'] = s1 == [True, 'on', 'nav', False]
    checks['5. Knopf bei laufender Aufzeichnung: Pause, Beenden, Verwerfen'] = [x.split('\n')[-1] for x in menu[0]['buttons']][:3] == ['Pause', 'Beenden und speichern', 'Verwerfen'] and s2 == [True, 'paused', 'nav', True] and 'Weiter aufzeichnen' in menu2[0]['buttons'][0] and s3 == [True, '', None, None]
    b.js("window.__wmap.nav.stop()")
    # Mit Aufzeichnung starten
    b.open(f'index.html?track={tid}&start', wait=3)
    b.wait("return !!document.querySelector('dialog[open].confirm')", 60)
    press(b, 'yes'); time.sleep(2)
    s4 = b.js(state)
    print('mit Aufzeichnung:', s4)
    checks['5. „Aufzeichnen“ gewählt: Navigation läuft, Knopf rot'] = s4 == [True, 'on', 'nav', False]
    b.js("window.__wmap.nav.stop()")
    call(b, "const { tracks } = await import('./js/data/tracks.js'); for (const t of await tracks.all()) await tracks.removeQuiet(t.id); localStorage.removeItem('wmap.rec'); localStorage.removeItem('wmap.nav'); localStorage.removeItem('wmap.contribute.seen'); return 1;")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
