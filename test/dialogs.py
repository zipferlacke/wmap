"""Dialoge über den userDialog aus wuefl-libs: Rückfragen (js/ui/dialogs.js – Fußzeile der Bibliothek oder eigene
Knopfzeile, ✕, Esc, Feld mit Enter, Knopf der offen lässt, nicht schließbar) und die Seitenleisten von „Meine
Touren“, „Entdecken“ und „Tour planen“ (js/ui/side-panel.js – Starthöhe am Handy, größer ziehen, einklappen,
Größe merken, die Leiste bleibt bei Enter und Esc stehen)."""
import sys
import time
from common import Browser

SETUP = """
const { ask } = await import('./js/ui/dialogs.js');
window.out = {};
window.run = (name, o) => { window.out[name] = 'offen'; ask(o).then((v) => { window.out[name] = v === null ? 'null' : v; }); };
return 1;"""
D = "document.querySelector('dialog.userDialog.confirm[open]')"
INFO = f"const d = {D}; if (!d) return null; return {{ modal: d.matches(':modal'), pos: [d.dataset.posWide, d.dataset.posSmall], title: d.querySelector('.uD-title').innerText.replace(/\\s+/g, ' ').trim(), footer: !!d.querySelector('.uD-footer'), buttons: [...d.querySelectorAll('.confirm-actions button')].map((b) => b.value + (b.classList.contains('primary') ? '*' : '')), x: !!d.querySelector('.uD-bar-right') }}"
PANEL = """const d = document.querySelector('dialog.userDialog.wege-panel'); if (!d) return null; const r = d.getBoundingClientRect();
return { id: d.id, open: d.open, modal: d.matches(':modal'), pos: [d.dataset.posWide, d.dataset.posSmall], bg: d.hasAttribute('data-background-usage'),
  w: Math.round(r.width), h: Math.round(r.height), share: Math.round(100 * r.height / innerHeight), collapsed: d.hasAttribute('data-collapsed'),
  title: (d.querySelector('.uD-title input')?.placeholder ?? d.querySelector('.uD-title').textContent).trim(), kids: [...d.children].map((c) => c.classList[0]),
  inForm: !!d.querySelector('.uD-form .wege-content'), src: !!document.querySelector('.wege-src, #sheet-src'), forms: d.querySelectorAll('form form').length }"""
DRAG = """const d = document.querySelector('dialog.userDialog.wege-panel'); const g = d.querySelector('.uD-grip'); const now = d.offsetHeight; const to = Math.round(innerHeight * arguments[0]);
for (const [t, s] of [['pointerdown', now], ['pointermove', to], ['pointerup', to]]) g.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerId: 1, clientX: innerWidth / 2, clientY: innerHeight - s }));"""

ok = True
def check(name, value, good):
    global ok
    ok = ok and bool(good)
    print(f"{name}: {value}{'' if good else '  ← FALSCH'}")

with Browser(width=1100, height=800) as b:
    b.open('settings.html', wait=3)
    r = b.d.execute_async_script('const done = arguments[0]; (async () => {' + SETUP + '})().then(done, (e) => done(String(e)))')
    check('Rückfragen geladen', r, r == 1)
    two = "buttons: [{ value: 'no', label: 'Nein' }, { value: 'yes', label: 'Ja', primary: true }]"
    b.js("run('ja', { icon: 'delete', title: 'Löschen?', text: 'Wirklich?', %s })" % two); time.sleep(.4)
    i = b.js(INFO)
    check('Zwei Knöpfe: Fußzeile der Bibliothek, mittig bzw. von unten, ✕ oben', i, i and i['modal'] and i['footer'] and i['buttons'] == ['no', 'yes*'] and i['x'] and i['pos'] == ['center', 'bottom'])
    b.js(f"{D}.querySelector('.confirm-actions button[value=yes]').click()"); time.sleep(.2)
    b.js("run('nein', { title: 'Noch einmal?', %s })" % two); time.sleep(.3)
    b.js(f"{D}.querySelector('.confirm-actions button[value=no]').click()"); time.sleep(.2)
    b.js("run('x', { title: 'Mit ✕', %s })" % two); time.sleep(.3)
    b.js(f"{D}.querySelector('.uD-bar-right').click()"); time.sleep(.2)
    b.js("run('esc', { title: 'Mit Esc', %s })" % two); time.sleep(.3)
    b.js(f"{D}.dispatchEvent(new Event('cancel', {{ cancelable: true }}))"); time.sleep(.2)
    b.js("run('feld', { title: 'Name', html: '<input type=\"text\" value=\"Alt\">', buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Speichern', primary: true }], read: (d) => d.querySelector('input').value })"); time.sleep(.3)
    b.js(f"const i = {D}.querySelector('input'); i.value = 'Neu'; i.dispatchEvent(new KeyboardEvent('keypress', {{ key: 'Enter', bubbles: true, cancelable: true }}))"); time.sleep(.2)
    b.js("run('vier', { title: 'Teilen', className: 'stacked', buttons: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }, { value: 'd', label: 'D', primary: true }] })"); time.sleep(.3)
    i = b.js(INFO)
    check('Vier Knöpfe untereinander: eigene Zeile im Inhalt', i, i and not i['footer'] and i['buttons'] == ['a', 'b', 'c', 'd*'])
    b.js(f"{D}.querySelector('.confirm-actions button[value=c]').click()"); time.sleep(.2)
    b.js("window.n = 0; run('run', { title: 'Probe', closable: false, buttons: [{ value: 't', label: 'Probe', run: () => { window.n += 1; } }, { value: 'ok', label: 'Fertig', primary: true }] })"); time.sleep(.3)
    b.js(f"{D}.querySelector('.confirm-actions button[value=t]').click(); {D}.dispatchEvent(new Event('cancel', {{ cancelable: true }}))"); time.sleep(.2)
    still = b.js(f"const d = {D}; return d ? [window.n, !!d.querySelector('.uD-bar-right')] : null")
    check('Knopf mit run lässt offen, nicht schließbar: Esc wirkt nicht, kein ✕', still, still == [1, False])
    b.js(f"{D}.querySelector('.confirm-actions button[value=ok]').click()"); time.sleep(.2)
    b.js("run('eins', { title: 'Hinweis', buttons: [{ value: 'ok', label: 'Verstanden', primary: true }] })"); time.sleep(.3)
    i = b.js(INFO)
    check('Ein Knopf: nur der Hauptknopf', i, i and i['buttons'] == ['ok*'])
    b.js(f"{D}.querySelector('.confirm-actions button[value=ok]').click()"); time.sleep(.2)
    out = b.js('return window.out')
    check('Ergebnisse', out, out == {'ja': 'yes', 'nein': 'no', 'x': 'null', 'esc': 'null', 'feld': 'Neu', 'vier': 'c', 'run': 'ok', 'eins': 'ok'})
    check('kein Dialog bleibt im Dokument', b.js("return document.querySelectorAll('dialog.userDialog').length"), b.js("return document.querySelectorAll('dialog.userDialog').length") == 0)
    errors = list(b.errors)

with Browser(width=412, height=915) as b:
    for page, pid, title, kids in [('wege.html', 'panel', 'Meine Touren', ['uD-grip', 'uD-form', 'wege-content']),
                                   ('entdecken.html', 'panel', 'Entdecken', ['uD-grip', 'uD-form', 'tours-tabs', 'wege-content']),
                                   ('tour.html', 'sheet', 'Name der Tour', ['uD-grip', 'uD-form', 'view'])]:
        b.open(page, wait=5)
        b.js("localStorage.removeItem('uD-sheet:wmap.panel'); localStorage.removeItem('uD-sheet:wmap.tourPanel')")
        b.open(page, wait=5)
        p = b.js(PANEL)
        check(f'{page} am Handy: Leiste von unten, Karte bedienbar, 58 % hoch', p, p and p['id'] == pid and p['open'] and not p['modal'] and p['bg'] and p['pos'] == ['left', 'bottom']
              and p['title'] == title and p['kids'] == kids and not p['inForm'] and not p['src'] and p['forms'] == 0 and 56 <= p['share'] <= 60)
    # Meine Touren ist jetzt nicht mehr offen – weiter mit dem Planer
    b.js(DRAG, 0.8); time.sleep(.4)
    p = b.js(PANEL)
    check('größer ziehen geht (80 %)', p['share'], 78 <= p['share'] <= 82)
    b.js("const d = document.querySelector('dialog.wege-panel'); d.querySelector('#tour-name').dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true })); d.querySelector('.uD-form').requestSubmit(); d.dispatchEvent(new Event('cancel', { cancelable: true }))")
    time.sleep(.3)
    p = b.js(PANEL)
    check('Enter im Namen und Esc lassen die Leiste stehen', p and p['open'], p and p['open'])
    b.js("document.querySelector('dialog.wege-panel .uD-grip').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))"); time.sleep(.5)
    check('eingeklappt über den Griff', b.js(PANEL)['collapsed'], b.js(PANEL)['collapsed'])
    b.open('tour.html', wait=5)
    p = b.js(PANEL)
    check('Größe und „eingeklappt“ bleiben gemerkt', [p['collapsed'], p['share']], p['collapsed'] and 78 <= p['share'] <= 82)
    b.js("localStorage.removeItem('uD-sheet:wmap.tourPanel')")
    errors += b.errors

with Browser(width=1366, height=900) as b:
    b.open('wege.html', wait=5)
    b.js("localStorage.removeItem('uD-sheet:wmap.panel')")
    b.open('wege.html', wait=5)
    p = b.js(PANEL)
    check('wege.html am Rechner: links, volle Höhe, 512 px breit', p, p and p['pos'][0] == 'left' and p['share'] == 100 and p['w'] == 512)
    b.js("document.querySelector('dialog.wege-panel').dispatchEvent(new Event('cancel', { cancelable: true }))"); time.sleep(.5)
    check('Esc in der Liste klappt die Leiste ein', b.js(PANEL)['collapsed'], b.js(PANEL)['collapsed'])
    b.js("localStorage.removeItem('uD-sheet:wmap.panel')")
    errors += b.errors

print('keine JS-Fehler' if not errors else errors)
sys.exit(0 if ok and not errors else 1)
