"""Meine Touren zieht nach, wenn im Hintergrund Touren dazukommen (pages/wege.js listSoon):

1. Übersicht offen, ein Weg wird gespeichert (wmap:data, wie Aufzeichnung, Import, Abgleich im Service Worker) –
   nach spätestens 3 s steht er in der Liste, ohne Neuladen.
2. Health Connect meldet neue Wege (wmap:health mit added): die Liste zieht nach.
3. Ein Weg ist offen, währenddessen kommt einer dazu – die Ansicht bleibt; beim Zurück steht er in der Liste.
4. Gemessene Dauer: unter einer Stunde auf die Sekunde („35 min 12 s“), ab einer Stunde auf die Minute.
"""
import sys
import time
from common import Browser

ok = True


def check(name, cond, info=''):
    global ok
    ok &= bool(cond)
    print('OK  ' if cond else 'FEHLER', name, info)


def put(b, wid, name, quiet=False):
    """Weg anlegen – quiet: an der Meldung vorbei (wie ein Schreiben aus einem anderen Fenster)"""
    return b.d.execute_async_script("""const done = arguments[arguments.length - 1]; (async () => {
      const { buildTrack, tracks } = await import('./js/data/tracks.js');
      const pts = []; for (let i = 0; i < 40; i++) pts.push([9.9 + i * 0.0004, 51.53, Date.UTC(2026, 9, 1, 8, 0, i * 10)]);
      const t = { ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: arguments[1] }), id: arguments[0] };
      if (arguments[2]) { const { store } = await import('./js/data/db.js'); await store('tracks').put(t); } else await tracks.put(t);
      return true; })().then(done, (e) => done(String(e)))""", wid, name, quiet)


ROWS = "return [...document.querySelectorAll('.wege-table tr[data-id]')].map((r) => r.dataset.id)"

with Browser(1200, 850) as b:
    b.open('wege.html', 3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1')")
    b.open('wege.html', 4)
    before = b.js(ROWS)
    # 1. Speichern mit Meldung
    print('Anlegen:', put(b, 'fresh1', 'Frisch eins'))
    shown = b.wait(f"{ROWS}.includes('fresh1')", 5)
    check('1. neuer Weg erscheint ohne Neuladen', shown, b.js(ROWS)[:5])
    # 2. Health Connect: still geschrieben, dann die Meldung
    print('Still anlegen:', put(b, 'fresh2', 'Frisch zwei', quiet=True))
    time.sleep(1.5)
    quiet_shown = 'fresh2' in b.js(ROWS)
    b.js("dispatchEvent(new CustomEvent('wmap:health', { detail: { added: 1 } }))")
    shown2 = b.wait(f"{ROWS}.includes('fresh2')", 5)
    check('2. Meldung von Health Connect: Liste zieht nach', shown2, f'vorher schon da: {quiet_shown}')
    # 3. Weg offen – Ansicht bleibt, beim Zurück ist der neue da
    b.js("document.querySelector('.wege-table tr[data-id=\"fresh1\"]').click()")
    time.sleep(2)
    put(b, 'fresh3', 'Frisch drei')
    time.sleep(2.5)
    still = b.js("return !!document.querySelector('.wege-table') === false && document.title")
    check('3. offener Weg bleibt offen', still and 'Frisch eins' in still, still)
    b.js("history.back()")
    shown3 = b.wait(f"{ROWS}.includes('fresh3')", 6)
    check('3. beim Zurück steht der neue Weg in der Liste', shown3)
    # 4. Zeitformat gemessener Dauern (core/geo.js fmtTime): unter einer Stunde auf die Sekunde, darüber auf die Minute
    # In der Seite selbst: aus der Sandbox von Selenium wäre geo.js ein zweites Modul ohne geladene Texte
    b.js("window.__fmt = null; const s = document.createElement('script'); s.type = 'module'; s.textContent = \"import { fmtTime } from './js/core/geo.js'; window.__fmt = [42, 60, 335, 2112, 3599.4, 3600, 3725, 5400].map(fmtTime);\"; document.head.append(s);")
    fmt = b.wait('return window.__fmt', 20)
    print('Zeiten:', fmt)
    check('4. Dauer: unter 1 h mit Sekunden, ab 1 h auf die Minute', fmt == ['42 s', '1 min', '5 min 35 s', '35 min 12 s', '59 min 59 s', '1 h', '1 h 2 min', '1 h 30 min'], fmt)
    row = b.js("return document.querySelector('.wege-table tr[data-id] .w-num small')?.textContent")
    check('4. in der Liste mit Sekunden (Testweg 6:30 min)', row and ' s' in row, row)
    # aufräumen
    b.d.execute_async_script("""const done = arguments[0]; import('./js/data/tracks.js').then(async ({ tracks }) => {
      for (const id of ['fresh1', 'fresh2', 'fresh3']) await tracks.remove(id).catch(() => {}); done(1); })""")
    b.report()

print('ALLES OK' if ok else 'FEHLER')
sys.exit(0 if ok else 1)
