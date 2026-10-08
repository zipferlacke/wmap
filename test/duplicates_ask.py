"""Doppelte Touren: Sobald es welche gibt, kommt am Anfang die Frage (js/ui/duplicates-ask.js, data/auto-sync.js) –
mit denselben Dialogen wie beim Import (ui/import-ask.js):
1. Ohne Doppelte: keine Frage.
2. Zwei doppelte Aufzeichnungen (Uhr mit Puls und wenigen Punkten, Handy mit vielen) und eine doppelte geplante
   Tour: Frage „3 Touren gibt es doppelt“. „Später“: nichts geändert, in dieser Sitzung keine Frage mehr.
3. „Selbst einstellen“: Haken je doppelter Aufzeichnung. Erste: Strecke abgewählt → die der Uhr bleibt, wie sie ist.
   Zweite: Vorschlag → die genauere Strecke des Handys gilt, Puls und Kennung der Uhr bleiben. Die doppelten sind weg.
4. „Ja, überall die genaueren Daten“: ohne weitere Frage zusammengeführt."""
import json
import sys
from common import Browser

SETUP = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks, buildTrack } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const pair = async (k, day) => {
    const pts = []; for (let i = 0; i < 81; i += 1) pts.push([9.9 + i * 0.0005, 51.53 + Math.sin(i / 5) * 0.0005, Date.now() - day * 864e5 + i * 10000]);
    const phone = buildTrack(pts, { kind: 'rec', profile: 'foot', name: 'Handy ' + k, keepAll: true });
    const watch = buildTrack(pts.filter((_, i) => i % 2 === 0), { kind: 'health', profile: 'foot', name: 'Uhr ' + k, keepAll: true });
    await tracks.putQuiet({ ...phone, id: 'phone' + k });
    await tracks.putQuiet({ ...watch, id: 'watch' + k, source: { health: 'S' + k }, hr: watch.times.map(() => 120) });
  };
  for (const [k, day] of arguments[0]) await pair(k, day);
  if (arguments[1]) {
    const tour = { name: 'Harzrunde doppelt', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, stats: {} };
    tours.save({ ...tour, id: 'dt1' }); tours.save({ ...tour, id: 'dt2' });
  }
  return 1;
})().then(done, (e) => done('FEHLER ' + e));
"""
STATE = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const mean = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((p, c) => p + c, 0) / v.length) : 0; };
  const t = (await tracks.all()).filter((x) => /^(phone|watch)/.test(x.id));
  return { tracks: t.map((x) => [x.id, x.times.length, mean(x.hr), x.source?.health ?? null, x.name]).sort(), tours: tours.all().filter((x) => x.name === 'Harzrunde doppelt').length };
})().then(done, (e) => done('FEHLER ' + e));
"""
DLG = "const d = document.querySelector('dialog.confirm[open]'); return d ? [d.querySelector('.uD-title').innerText.replace(/^\\S+\\s+/, '').trim(), [...d.querySelectorAll('.confirm-actions button')].map((x) => x.innerText.replace(/^\\S+\\s+/, '').trim()), [...d.querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]), d.innerText.replace(/\\s+/g, ' ')] : null"
PRESS = "[...document.querySelector('dialog.confirm[open]').querySelectorAll('.confirm-actions button')].find((x) => new RegExp(arguments[0]).test(x.innerText)).click()"
BUTTONS = ['Ja, überall die genaueren Daten', 'Selbst einstellen', 'Später']

with Browser() as b:
    checks = {}
    b.open('wege.html', wait=5)
    checks['1. ohne Doppelte keine Frage'] = b.js(DLG) is None
    b.d.execute_async_script(SETUP, [['1', 3], ['2', 4]], True)
    before = b.d.execute_async_script(STATE)
    b.open('wege.html', wait=2)
    d = b.wait(DLG, 15)
    print('Frage:', d and d[:2], d and d[3][:200])
    checks['2. Frage kommt von selbst: 3 Touren doppelt – ja / selbst einstellen / später'] = bool(d) and d[0] == '3 Touren gibt es doppelt' and d[1] == BUTTONS
    b.js(PRESS, 'Später')
    b.open('wege.html', wait=5)
    checks['2. „Später“: nichts geändert, in dieser Sitzung keine Frage mehr'] = b.js(DLG) is None and b.d.execute_async_script(STATE) == before
    # 3. selbst einstellen
    b.js("sessionStorage.removeItem('wmap.duplicates.later')")
    b.open('wege.html', wait=2)
    b.wait(DLG, 15)
    b.js(PRESS, 'Selbst einstellen')
    import time
    time.sleep(1.2)
    one = b.js(DLG)
    print('erste:', one and one[:3], one and one[3][:160])
    checks['3. Haken je doppelter Aufzeichnung: 1 von 2, Strecke vorgeschlagen (mehr Punkte), Text nennt die doppelte'] = bool(one) and one[0] == 'Zusammenführen (1 von 2)' and one[2] == [['shape', True]] and 'Von der doppelten Aufzeichnung „Handy' in one[3] and 'in der doppelten' in one[3] and one[1][0] == 'Weiter'
    b.js("document.querySelector('dialog.confirm[open] [data-pick=shape]').checked = false")
    b.js(PRESS, 'Weiter')
    time.sleep(1.2)
    two = b.js(DLG)
    checks['3. zweite: 2 von 2 mit „Zusammenführen“'] = bool(two) and two[0] == 'Zusammenführen (2 von 2)' and two[1] == ['Zusammenführen', 'Später', 'Abbrechen']
    b.js(PRESS, 'Zusammenführen')
    time.sleep(2.5)
    after = b.d.execute_async_script(STATE)
    print('danach:', json.dumps(after, ensure_ascii=False))
    rows = {r[0]: r for r in after['tracks']}
    # Die ältere Gruppe (Tag 4) kommt zuerst: Paar 2 ohne Strecke, Paar 1 mit
    checks['3. Strecke abgewählt: Uhr bleibt mit ihren 41 Punkten; Vorschlag: 81 Punkte des Handys, Puls und Kennung der Uhr'] = sorted(rows) == ['watch1', 'watch2'] and rows['watch2'][1:4] == [41, 120, 'S2'] and rows['watch1'][1:5] == [81, 120, 'S1', 'Uhr 1']
    checks['3. doppelte geplante Tour ist weg, die Liste zeigt jede Tour einmal'] = after['tours'] == 1 and b.js("return [...document.querySelectorAll('.wege-table tr[data-id] strong')].map((x) => x.textContent).filter((n) => /^(Uhr|Handy) /.test(n)).sort()") == ['Uhr 1', 'Uhr 2']
    # 4. ja, überall die genaueren
    b.d.execute_async_script(SETUP, [['3', 6]], False)
    b.open('wege.html', wait=2)
    d = b.wait(DLG, 15)
    checks['4. neue Doppelte: Frage kommt wieder („Eine Tour gibt es doppelt“)'] = bool(d) and d[0] == 'Eine Tour gibt es doppelt'
    b.js(PRESS, 'Ja, überall')
    time.sleep(2.5)
    after = b.d.execute_async_script(STATE)
    rows = {r[0]: r for r in after['tracks']}
    checks['4. ja: ohne weitere Frage zusammengeführt – genauere Strecke, Puls der Uhr'] = b.js(DLG) is None and 'phone3' not in rows and rows.get('watch3', [])[1:4] == [81, 120, 'S3']
    b.shot('duplicates-ask')
    b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => { const { tracks } = await import('./js/data/tracks.js'); const { tours } = await import('./js/data/store.js'); for (const t of await tracks.all()) if (/^(phone|watch)/.test(t.id)) await tracks.removeQuiet(t.id); for (const t of tours.all()) if (t.name === 'Harzrunde doppelt') tours.remove(t.id); })().then(done, done);")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
