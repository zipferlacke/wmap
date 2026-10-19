"""Meine Touren → Aufgezeichnet: Namen, Kopfzeile, Tags, Abweichung beim Vergleich (data/auto-name.js, pages/wege.js).
1. Nichtssagende Namen erkannt (Zepp…, Activity_….fit, Morning Run, Datum, „Lauf 1“) – „Morgenrunde“, „Hermannslauf 2024“ nicht.
2. Fremde Wege mit solchen Namen heißen nach dem Öffnen „<Art> in <Ort> am <Tag><Zeit>“ (Photon); „Morgenrunde“ bleibt.
3. Kopfzeile: nach Länge sortiert die längste zuerst, der Pfeil dreht um; Tag „Rennen“ filtert auf einen Weg.
4. „Vergleichen“ → „Alle auswählen“ kreuzt alle sichtbaren an.
5. Im Weg: Gleiche Strecke mit Genau / Ähnlich / Grob – Grob findet mehr; Tag hinzufügen speichert ihn."""
import sys
import time
from common import Browser

MAKE = """
localStorage.setItem('wmap.test.autoName', '1');
const { buildTrack, tracks } = await import('./js/data/tracks.js');
const loop = (id, name, t0, v, extra = {}, r = 0.012, dx = 0) => {
  const pts = []; let ms = t0;
  for (let a = 0; a < Math.PI * 2; a += v / 1300) { pts.push([10.02 + dx + Math.cos(a) * r * 1.6, 51.50 + Math.sin(a) * r, ms, 150, 170, 0]); ms += 10000; }
  return tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name }), id, sport: 'running', ...extra });
};
await loop('n1', 'Zepp20240503181502', Date.UTC(2026, 4, 3, 6), 3.0, { tags: ['Rennen'] });
await loop('n2', 'Activity_1234.fit', Date.UTC(2026, 6, 10, 16), 3.2, {}, 0.0125);
await loop('n3', 'Morgenrunde', Date.UTC(2026, 8, 1, 7), 2.9, {}, 0.013, 0.003);
await loop('n4', 'Lauf 1', Date.UTC(2025, 8, 1, 18), 2.5, {}, 0.02);
const { isPlainName } = await import('./js/data/auto-name.js');
return ['Zepp20240503181502', 'Activity_1234.fit', 'Morning Run', '2024-05-03 18:15', 'Lauf 1', 'Morgenrunde', 'Hermannslauf 2024'].map(isPlainName);
"""
NAMES = "return [...document.querySelectorAll('tr[data-id]')].map((x) => [x.dataset.id, x.querySelector('.w-name strong').innerText])"

with Browser(width=420, height=900) as b:
    checks = {}
    b.open('wege.html', wait=3)
    plain = b.d.execute_async_script('const done = arguments[0]; (async () => {' + MAKE + '})().then(done, (e) => done(String(e)))')
    print('nichtssagend:', plain)
    checks['1. nichtssagend erkannt, eigene Namen nicht'] = plain == [True, True, True, True, True, False, False]
    b.open('wege.html', wait=4)
    for _ in range(20):
        names = dict(b.js(NAMES))
        if all(' am ' in names.get(k, '') for k in ['n1', 'n2', 'n4']): break
        time.sleep(1.5)
    print('Namen:', names)
    checks['2. Namen aus Art, Ort und Tageszeit; „Morgenrunde“ bleibt'] = (names.get('n3') == 'Morgenrunde'
        and all(names.get(k, '').startswith('Lauf ') and ' am ' in names[k] for k in ['n1', 'n2', 'n4']))
    b.js("const s = document.querySelector('[data-view=sort]'); s.value = 'length'; s.dispatchEvent(new Event('change', { bubbles: true }))")
    time.sleep(.4)
    first = b.js(NAMES)[0][0]
    b.js("document.querySelector('[data-view-dir]').click()")
    time.sleep(.3)
    flipped = b.js(NAMES)[0][0]
    b.js("const s = document.querySelector('[data-view=tag]'); s.value = 'Rennen'; s.dispatchEvent(new Event('change', { bubbles: true }))")
    time.sleep(.4)
    tagged = [x[0] for x in b.js(NAMES)]
    print('längste:', first, 'umgedreht:', flipped, 'Tag Rennen:', tagged)
    checks['3. nach Länge (n4 zuerst), Pfeil dreht um, Tag filtert'] = first == 'n4' and flipped != 'n4' and tagged == ['n1']
    b.js("document.querySelector('[data-view-reset]').click()")
    time.sleep(.3)
    b.js("const s = document.querySelector('[data-view=sort]'); s.value = 'date'; s.dispatchEvent(new Event('change', { bubbles: true }))")
    b.js("document.querySelector('[data-list=compare]').click()")
    time.sleep(.4)
    b.js("document.querySelector('[data-list=pick-all]').click()")
    time.sleep(.3)
    count = b.js("return document.querySelector('.compare-count')?.innerText")
    print('Alle auswählen:', count)
    checks['4. „Alle auswählen“: 4 gewählt'] = count == '4 gewählt'
    b.js("document.querySelector('[data-list=compare-cancel]').click()")
    b.js("localStorage.removeItem('wmap.sameLevel')")
    b.open('wege.html?id=n3', wait=4)
    levels = b.js("return [...document.querySelectorAll('[data-same-level]')].map((x) => [x.dataset.sameLevel, Number(x.querySelector('small').innerText)])")
    print('Stufen:', levels)
    lv = dict(levels)
    checks['5. Genau / Ähnlich / Grob, Grob findet mehr'] = list(lv) == ['exact', 'close', 'rough'] and lv['rough'] > lv['exact']
    b.js("document.querySelector('.weg-look').open = true; document.querySelector('[data-tag-add]').click()")
    time.sleep(.6)
    b.js("const i = document.querySelector('dialog[open] input[name=tag]'); i.value = 'Vorbereitung'; [...document.querySelectorAll('dialog[open] button')].find((x) => /Hinzufügen/.test(x.innerText)).click()")
    time.sleep(1.5)
    tags = b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(({ tracks }) => tracks.get('n3')).then((t) => done(t.tags ?? []))")
    print('Tags von n3:', tags)
    checks['5. Tag hinzugefügt und gespeichert'] = tags == ['Vorbereitung']
    b.shot('track_names')
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(b.report() or not all(checks.values()))
