"""Doppelte Touren (data/duplicates.js) auf „Sicherung & Synchronisation“: ohne Doppelte kein Abschnitt; mit doppeltem
Weg (einmal aus Health Connect mit Puls, einmal aus dem Ordner) und doppelter geplanter Tour erscheint
„Duplikate entfernen“ – danach bleibt je einer, der Weg mit Kennung und Puls, und der Abschnitt verschwindet."""
import json
import sys
import time
from common import Browser

SETUP = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks, buildTrack } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const pts = []; for (let i = 0; i < 80; i += 1) pts.push([9.9 + i * 0.0005, 51.53 + Math.sin(i / 5) * 0.0005, Date.UTC(2026, 8, 20, 7, 0, i * 10)]);
  const a = buildTrack(pts, { kind: 'rec', profile: 'foot', name: 'Lauf (alte App)' });
  await tracks.put({ ...a, id: 'old1' });
  await tracks.put({ ...a, id: 'hc1', name: 'Lauf am Sonntagmorgen', source: { health: 'S1', app: 'com.fitbit' }, hr: a.times.map(() => 120) });
  // Ein anderer Weg (einen Tag später) – kein Duplikat
  await tracks.put({ ...buildTrack(pts.map(([x, y, ms]) => [x, y, ms + 864e5]), { kind: 'rec', profile: 'foot', name: 'Anderer Tag' }), id: 'other' });
  const tour = { name: 'Harzrunde', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, stats: {} };
  tours.save({ ...tour, id: 'tA' });
  tours.save({ ...tour, id: 'tB' });
  tours.save({ ...tour, id: 'tC', name: 'Harzrunde (Variante)' });
  dispatchEvent(new CustomEvent('wmap:folder', { detail: {} }));
  return 'ok';
})().then(done, (e) => done('FEHLER ' + e));
"""

STATE = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const t = await tracks.all();
  return { tracks: t.map((x) => [x.id, x.source?.health ?? null, (x.hr ?? []).some((v) => v > 0)]).sort(), tours: tours.all().map((x) => x.id).sort() };
})().then(done, (e) => done('FEHLER ' + e));
"""

with Browser() as b:
    b.open('sync.html', wait=3)
    before = b.js("return !!document.querySelector('.sync-dups')")
    print('ohne Doppelte Abschnitt da:', before)
    print(b.d.execute_async_script(SETUP))
    shown = b.wait("return document.querySelector('.sync-dups')?.textContent.replace(/\\s+/g, ' ').trim()", 10)
    print('Abschnitt:', shown)
    b.js("document.querySelector('[data-act=dedupe]').click()")
    b.wait("return document.querySelector('dialog[open] button[value=yes]')", 5)
    b.js("document.querySelector('dialog[open] button[value=yes]').click()")
    time.sleep(2)
    after = b.js("return !!document.querySelector('.sync-dups')")
    state = b.d.execute_async_script(STATE)
    print('danach:', json.dumps(state), '· Abschnitt noch da:', after)
    ok = (not before and shown and '1 aufgezeichnete und 1 geplante' in shown and not after
          and isinstance(state, dict) and state['tracks'] == [['hc1', 'S1', True], ['other', None, False]]
          and state['tours'] in (['tA', 'tC'], ['tB', 'tC']))
    print('stimmt' if ok else 'STIMMT NICHT')
    if not ok:
        sys.exit(1)
    sys.exit(b.report())
