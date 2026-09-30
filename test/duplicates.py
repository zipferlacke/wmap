"""Doppelte Touren (data/duplicates.js) auf „Sicherung & Synchronisation“: ohne Doppelte kein Abschnitt; mit doppeltem
Weg (aus Health Connect mit Puls, dieselbe Aufzeichnung aus dem Ordner und dieselbe Aktivität als GPX aus einer
anderen Quelle – anderer Start, weniger Punkte, kürzer) und doppelter geplanter Tour erscheint „Zusammenführen“ mit
der Wahl, wessen Strecke (GPS) bleibt und – weil zwei Aufzeichnungen Puls haben – von welcher die Gesundheitsdaten
kommen. Gewählt wird die Strecke der GPX mit dem Puls aus Health Connect: sie bleibt, bekommt dessen Kennung und Puls
(120 statt ihrer eigenen 150).
Dazu: eine von WMap geschriebene GPX-Datei kommt mit derselben Strecke, Zeit und Herkunft zurück (nicht kürzer),
und eine alte Datei ohne diese Angaben gilt trotzdem als derselbe Weg."""
import json
import sys
import time
from common import Browser

SETUP = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks, buildTrack, trackGpx, parseGpx, sameTrack } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const pts = []; for (let i = 0; i < 80; i += 1) pts.push([9.9 + i * 0.0005, 51.53 + Math.sin(i / 5) * 0.0005, Date.UTC(2026, 8, 20, 7, 0, i * 10)]);
  const a = buildTrack(pts, { kind: 'rec', profile: 'foot', name: 'Lauf (alte App)' });
  await tracks.put({ ...a, id: 'old1' });
  await tracks.put({ ...a, id: 'hc1', kind: 'health', name: 'Lauf am Sonntagmorgen', source: { health: 'S1', app: 'com.fitbit' }, hr: a.times.map(() => 120) });
  // Dieselbe Aktivität als GPX aus der Uhr-App: 40 s später begonnen, weniger Punkte, etwas kürzer
  const g = buildTrack(pts.slice(4).filter((_, i) => i % 3 === 0), { kind: 'gpx', profile: 'foot', name: 'Lauf (GPX)' });
  await tracks.put({ ...g, id: 'gpx1', hr: g.times.map(() => 150) });
  // Zur selben Zeit, aber woanders (GPX eines anderen): kein Duplikat
  await tracks.put({ ...buildTrack(pts.map(([x, y, ms]) => [x + 1, y, ms + 30000]), { kind: 'gpx', profile: 'foot', name: 'Woanders' }), id: 'far' });
  // Ein anderer Weg (einen Tag später) – kein Duplikat
  await tracks.put({ ...buildTrack(pts.map(([x, y, ms]) => [x, y, ms + 864e5]), { kind: 'rec', profile: 'foot', name: 'Anderer Tag' }), id: 'other' });
  const tour = { name: 'Harzrunde', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, stats: {} };
  tours.save({ ...tour, id: 'tA' });
  tours.save({ ...tour, id: 'tB' });
  tours.save({ ...tour, id: 'tC', name: 'Harzrunde (Variante)' });
  dispatchEvent(new CustomEvent('wmap:folder', { detail: {} }));
  // GPX hin und zurück: ein Weg mit vielen Zacken (vereinfacht deutlich kürzer)
  const zz = []; for (let i = 0; i < 600; i += 1) zz.push([9.8 + i * 0.00008, 51.4 + (i % 2) * 0.00003, Date.UTC(2026, 8, 21, 7, 0, i * 3)]);
  const full = { ...buildTrack(zz, { kind: 'health', profile: 'foot', name: 'Zackenlauf' }), source: { health: 'S9', app: 'com.huami.watch.hmwatchmanager', type: 'running' } };
  const gpx = trackGpx(full);
  const [back] = parseGpx(gpx);
  // Datei einer älteren WMap: ohne die Angaben – kürzer, aber derselbe Weg
  const [old] = parseGpx(gpx.replace(/<extensions><wmap:track[^>]*\/><\/extensions>/, ''));
  return { roundtrip: [full.length, back.length, full.moving, back.moving, back.kind, back.source], old: [old.length, old.kind, sameTrack(full, old)] };
})().then(done, (e) => done('FEHLER ' + e));
"""

STATE = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const t = await tracks.all();
  const mean = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((p, c) => p + c, 0) / v.length) : 0; };
  return { tracks: t.map((x) => [x.id, x.source?.health ?? null, mean(x.hr)]).sort(), tours: tours.all().map((x) => x.id).sort() };
})().then(done, (e) => done('FEHLER ' + e));
"""

with Browser() as b:
    b.open('sync.html', wait=3)
    before = b.js("return !!document.querySelector('.sync-dups')")
    print('ohne Doppelte Abschnitt da:', before)
    setup = b.d.execute_async_script(SETUP)
    print('GPX hin und zurück:', setup)
    # „Meine Touren“ sagt Bescheid
    b.open('wege.html', wait=3)
    hint = b.wait("const h = document.querySelector('.wege-dup-hint'); return h && !h.hidden ? h.innerText.replace(/\\s+/g, ' ').trim() : null", 10)
    print('Hinweis auf Meine Touren:', hint)
    b.open('sync.html', wait=3)
    shown = b.wait("return document.querySelector('.sync-dups')?.textContent.replace(/\\s+/g, ' ').trim()", 10)
    print('Abschnitt:', shown)
    OPTS = "return [...document.querySelectorAll(arguments[0])].map((o) => [o.querySelector('input').value, o.querySelector('input').checked, o.innerText.replace(/\\s+/g, ' ').trim()])"
    options = b.js(OPTS, '.dup-option:not(.dup-values)')
    values = b.js(OPTS, '.dup-values')
    print('Strecke von:', options)
    print('Gesundheitsdaten von:', values)
    b.js("document.querySelector('.sync-dups').scrollIntoView()")
    b.shot('doppelt')
    # Nicht die vorgeschlagene Strecke (Health Connect), sondern die der GPX soll bleiben – der Puls aber aus Health Connect
    b.js("const r = document.querySelector('.dup-option input[value=gpx1]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }))")
    b.js("document.querySelector('[data-act=dedupe]').click()")
    b.wait("return document.querySelector('dialog[open] button[value=yes]')", 5)
    b.js("document.querySelector('dialog[open] button[value=yes]').click()")
    time.sleep(2)
    after = b.js("return !!document.querySelector('.sync-dups')")
    state = b.d.execute_async_script(STATE)
    print('danach:', json.dumps(state), '· Abschnitt noch da:', after)
    ok = (not before and hint and '2 Touren gibt es doppelt' in hint and shown and '2 aufgezeichnete und 1 geplante' in shown and not after
          and isinstance(state, dict) and state['tracks'] == [['far', None, 0], ['gpx1', 'S1', 120], ['other', None, 0]]
          and [(v[0], v[1]) for v in values] == [('hc1', True), ('gpx1', False)] and 'Puls (Ø 120)' in values[0][2] and 'Gesundheitsdaten von' in shown and 'Strecke (GPS) von' in shown
          and [o[0] for o in options] == ['hc1', 'gpx1', 'old1'] and options[0][1] and 'Health Connect' in options[0][2] and 'Punkte' in options[0][2]
          and isinstance(setup, dict) and setup['roundtrip'][0] == setup['roundtrip'][1] and setup['roundtrip'][2] == setup['roundtrip'][3]
          and setup['roundtrip'][4] == 'health' and setup['roundtrip'][5] == {'app': 'com.huami.watch.hmwatchmanager', 'type': 'running', 'health': 'S9'}
          and setup['old'][0] < setup['roundtrip'][0] and setup['old'][1] == 'gpx' and setup['old'][2] is True
          and state['tours'] in (['tA', 'tC'], ['tB', 'tC']))
    print('stimmt' if ok else 'STIMMT NICHT')
    if not ok:
        sys.exit(1)
    sys.exit(b.report())
