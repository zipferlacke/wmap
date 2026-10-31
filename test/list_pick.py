"""Meine Touren → Aufgezeichnet: auswählen per langem Tippen, Tag für mehrere (pages/wege.js):

1. Lange auf eine Zeile tippen (Maus 0,7 s halten): kein Weg geht auf, die Liste ist im Auswahlmodus, die Zeile
   angekreuzt, die Leiste sagt „1 gewählt“; „Tag“ geht, „Vergleichen“ noch nicht.
2. Kurz auf eine zweite: auch angekreuzt, „2 gewählt“, Vergleichen geht.
3. Wer beim Halten scrollt (Finger bewegt sich), wählt nichts aus.
4. „Tag“ → Dialog → „Wettkampf“: beide Wege haben den Tag (gespeichert), die Zeilen zeigen ihn.
5. Suche nach „wettkampf“ findet genau die beiden.
6. Tag-Dialog abbrechen: kein Tag (vorher kam „null“ dazu).
7. Langes Tippen weiter unten in einer langen Liste: die Zeile bleibt, wo der Finger ist (kein Sprung nach oben).
8. Oben nur „Aufzeichnen“ und „GPX/FIT importieren“; ein WMap-Link in der Suche zeigt „Link öffnen“.
9. Einzelansicht: Tags und „+ Tag“ direkt unter dem Datum, nicht im zugeklappten Block.
"""
import sys
import time
from common import Browser
from selenium.webdriver.common.action_chains import ActionChains

ok = True


def check(name, cond, info=''):
    global ok
    ok &= bool(cond)
    print('OK  ' if cond else 'FEHLER', name, info)


MAKE = """const done = arguments[arguments.length - 1]; (async () => {
  const { buildTrack, tracks } = await import('./js/data/tracks.js');
  for (const [id, name, day] of [['pick1', 'Auswahl eins', 3], ['pick2', 'Auswahl zwei', 4], ['pick3', 'Auswahl drei', 5]]) {
    const pts = []; for (let i = 0; i < 40; i++) pts.push([9.9 + i * 0.0004, 51.53 + day * 0.001, Date.UTC(2026, 9, day, 8, 0, i * 10)]);
    await tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name }), id });
  }
  return true; })().then(done, (e) => done(String(e)))"""
BAR = "const b = document.querySelector('.compare-bar'); return b && [b.querySelector('.compare-count').textContent, b.querySelector('[data-list=pick-tag]').disabled, b.querySelector('[data-list=compare-go]').disabled, [...document.querySelectorAll('.row-pick:checked')].map((x) => x.dataset.pick).sort()]"

with Browser(420, 900) as b:
    b.open('wege.html', 3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.removeItem('wmap.wegeView')")
    print('Anlegen:', b.d.execute_async_script(MAKE))
    b.open('wege.html', 4)
    row = lambda i: b.css(f'tr[data-id="{i}"] .w-name')
    # 1. lange halten
    b.d.execute_script('arguments[0].scrollIntoView({block: "center"})', row('pick1'))
    ActionChains(b.d).click_and_hold(row('pick1')).pause(0.8).release().perform()
    time.sleep(.6)
    bar = b.js(BAR)
    print('Nach langem Tippen:', bar, b.js('return location.search'))
    check('1. langes Tippen: Auswahlmodus, Zeile angekreuzt, kein Weg offen', bar and bar[3] == ['pick1'] and 'id=' not in b.js('return location.search'), bar)
    check('1. Leiste: „1 gewählt“, Tag geht, Vergleichen noch nicht', bar and bar[0] == '1 gewählt' and bar[1] is False and bar[2] is True)
    # 2. kurz auf die zweite
    row('pick2').click()
    time.sleep(.4)
    bar = b.js(BAR)
    check('2. kurzer Tipp kreuzt die zweite an, Vergleichen geht', bar and bar[3] == ['pick1', 'pick2'] and bar[0] == '2 gewählt' and bar[2] is False, bar)
    # 3. Halten mit Bewegung (Scrollen): nichts
    b.js("document.querySelector('[data-list=compare-cancel]').click()")
    time.sleep(.4)
    ActionChains(b.d).click_and_hold(row('pick3')).move_by_offset(0, 40).pause(0.8).release().perform()
    time.sleep(.6)
    check('3. beim Halten bewegt (scrollen): keine Auswahl', not b.js(BAR), b.js(BAR))
    if 'id=' in b.js('return location.search'):
        b.js('history.back()')
        time.sleep(1)
    # 4. Tag für zwei
    ActionChains(b.d).click_and_hold(row('pick1')).pause(0.8).release().perform()
    time.sleep(.5)
    row('pick2').click()
    time.sleep(.3)
    b.js("document.querySelector('[data-list=pick-tag]').click()")
    time.sleep(.6)
    b.js("const i = document.querySelector('dialog[open] input[name=tag]'); i.value = 'Wettkampf'; [...document.querySelectorAll('dialog[open] button')].find((x) => /Hinzufügen/.test(x.innerText)).click()")
    time.sleep(2)
    saved = b.d.execute_async_script("""const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) =>
      done(await Promise.all(['pick1', 'pick2', 'pick3'].map(async (id) => (await tracks.get(id)).tags ?? []))))""")
    shown = b.js("return ['pick1', 'pick2'].map((id) => document.querySelector(`tr[data-id=\"${id}\"] .w-tags`)?.textContent)")
    print('Tags:', saved, shown)
    check('4. Tag an beiden gespeichert, der dritte ohne', saved == [['Wettkampf'], ['Wettkampf'], []])
    check('4. Zeilen zeigen den Tag', shown == ['Wettkampf', 'Wettkampf'])
    # 5. Suche nach dem Tag
    b.js("document.querySelector('[data-list=compare-cancel]')?.click()")
    time.sleep(.3)
    b.js("const i = document.querySelector('.wege-search input'); i.value = 'wettkampf'; i.dispatchEvent(new Event('input', { bubbles: true }))")
    time.sleep(.8)
    found = b.js("return [...document.querySelectorAll('.wege-table tr[data-id]')].map((r) => r.dataset.id).sort()")
    check('5. Suche nach dem Tag findet genau die beiden', found == ['pick1', 'pick2'], found)
    # 6. Abbrechen im Tag-Dialog
    b.js("document.querySelector('.wege-search input').value = ''; document.querySelector('.wege-search input').dispatchEvent(new Event('input', { bubbles: true }))")
    time.sleep(.4)
    b.long_press('tr[data-id="pick3"] .w-name')
    b.js("document.querySelector('[data-list=pick-tag]').click()")
    time.sleep(.6)
    b.js("const i = document.querySelector('dialog[open] input[name=tag]'); i.value = 'Egal'; [...document.querySelectorAll('dialog.confirm[open] button')].find((x) => /Abbrechen/.test(x.innerText)).click()")
    time.sleep(1.2)
    t3 = b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => done((await tracks.get('pick3')).tags ?? []))")
    dl = b.js("return [...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className + ' ' + d.innerText.slice(0, 40))")
    check('6. Abbrechen im Tag-Dialog setzt keinen Tag, der Dialog ist zu', t3 == [] and not [x for x in dl if 'confirm' in x], [t3, dl])
    b.js("document.querySelector('[data-list=compare-cancel]')?.click()")
    time.sleep(.3)
    # 7. Lange Liste, weiter unten lange tippen: kein Sprung
    b.d.execute_async_script("""const done = arguments[0]; import('./js/data/tracks.js').then(async ({ buildTrack, tracks }) => {
      for (let k = 0; k < 18; k++) { const pts = []; for (let i = 0; i < 30; i++) pts.push([9.9 + i * 0.0004, 51.6 + k * 0.002, Date.UTC(2026, 6, 1 + k, 8, 0, i * 10)]);
        await tracks.put({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Viele ' + k }), id: 'many' + k }); } done(1); })""")
    time.sleep(2)
    b.js("const c = document.querySelector('.wege-content'); c.scrollTop = c.scrollHeight / 2")
    time.sleep(.3)
    rid = b.js("const c = document.querySelector('.wege-content').getBoundingClientRect(); return [...document.querySelectorAll('.wege-table tr[data-id]')].find((r) => r.getBoundingClientRect().top > c.top + 200)?.dataset.id")
    before = b.js("return document.querySelector(`tr[data-id='${arguments[0]}']`).getBoundingClientRect().top", rid)
    print('Treffer:', b.js("const r = document.querySelector(`tr[data-id='${arguments[0]}'] .w-name`).getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [Math.round(r.top), Math.round(r.height), e?.outerHTML.slice(0, 160), e?.parentElement?.outerHTML.slice(0, 120), innerHeight]", rid))
    from selenium.webdriver.common.action_chains import ActionChains
    ActionChains(b.d).click_and_hold(b.css(f'tr[data-id="{rid}"] .w-name')).pause(0.8).release().perform()
    time.sleep(.6)
    after = b.js("return document.querySelector(`tr[data-id='${arguments[0]}']`).getBoundingClientRect().top", rid)
    bar7 = b.js(BAR)
    check('7. langes Tippen weiter unten: die Zeile bleibt stehen', abs(after - before) < 6 and bar7 and bar7[3] == [rid], [rid, before, after, bar7, b.js('return location.search')])
    b.js("document.querySelector('[data-list=compare-cancel]')?.click()")
    time.sleep(.3)
    # 8. Oben nur zwei Knöpfe; Link in der Suche
    tools = b.js("return [...document.querySelectorAll('.wege-tools > *')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim())")
    check('8. oben nur Aufzeichnen und GPX/FIT importieren', tools == ['radio_button_checked Aufzeichnen', 'upload_file GPX/FIT importieren'], tools)
    hidden0 = b.js("return document.querySelector('.wege-open-link').hidden")
    b.js("const i = document.querySelector('.wege-search input'); i.value = 'Schau: ' + location.origin + location.pathname.replace(/wege\\.html$/, '') + 'tour.html#k=abc.def.ghi'; i.dispatchEvent(new Event('input', { bubbles: true }))")
    time.sleep(.4)
    hidden1 = b.js("return document.querySelector('.wege-open-link').hidden")
    check('8. WMap-Link in der Suche: „Link öffnen“ erscheint', hidden0 and not hidden1, [hidden0, hidden1])
    b.js("const i = document.querySelector('.wege-search input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }))")
    # 9. Einzelansicht: Tags sichtbar
    b.open('wege.html?id=pick1', 4)
    tg = b.js("const x = document.querySelector('.weg-tags'); return x && [!x.closest('details'), x.innerText.replace(/\\s+/g, ' ').trim(), !!x.querySelector('[data-tag-add]')]")
    check('9. Einzelansicht: Tags und „+ Tag“ sichtbar, nicht im Block', tg and tg[0] and 'Wettkampf' in tg[1] and tg[2], tg)
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => { for (let k = 0; k < 18; k++) await tracks.remove('many' + k); done(1); })")
    b.shot('auswahl_tag')
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => { for (const id of ['pick1', 'pick2', 'pick3']) await tracks.remove(id); done(1); })")
    b.report()

print('ALLES OK' if ok else 'FEHLER')
sys.exit(0 if ok else 1)
