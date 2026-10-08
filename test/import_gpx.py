"""GPX öffnen (import.html, js/pages/import.js): GPX mit Zeiten als aufgezeichnete Tour speichern, dieselbe Datei
noch einmal → „Gibt es schon“; GPX ohne Zeiten nur als geplante Tour – öffnet tour.html wie eine geteilte Tour
(Speichern mit Ausrufezeichen), gespeichert wird erst dort. „Ansehen“: die Datei als Vorschau in „Meine Touren“
(wege.html#datei) mit „Als aufgezeichnete Tour speichern“ und „Als geplante Tour öffnen“ – gespeichert erst dort."""
import json
import sys
import time
from common import Browser

# Läuft als Modul in der Seite selbst (Skripte aus WebDriver haben in Firefox eigene Module)
STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { addFiles } = await import('./js/pages/import.js');
  const { tracks, buildTrack, trackGpx } = await import('./js/data/tracks.js');
  const { toGpx } = await import('./js/data/store.js');
  const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.91 + i * 0.0006, 51.52 + Math.sin(i / 6) * 0.0006, Date.UTC(2026, 5, 3, 7, 0, i * 12)]);
  // Wie aus Garmin: mit Zeiten, ohne WMap-Stichwort
  const timed = trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Morgenlauf Import' }), id: 'imp-x' }).replace(/<keywords>[^<]*<\/keywords>/, '');
  const plain = toGpx({ name: 'Rundweg ohne Zeiten', profile: 'hike', points: [] }, pts.map(([x, y]) => [x + 0.02, y]));
  // ohne die Frage für alle (ui/import-ask.js) – hier geht es um die Karten
  await addFiles([{ name: 'lauf.gpx', text: timed }, { name: 'rundweg.gpx', text: plain }], false);
  await wait(200);
  const cards = () => [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3'))
    .map((s) => ({ title: s.querySelector('h3').innerText.replace(/\s+/g, ' ').trim(), buttons: [...s.querySelectorAll('.sync-actions > .button')].map((b) => [b.innerText.replace(/\s+/g, ' ').trim(), !!b.disabled]) }));
  const out = { first: cards() };
  const before = (await tracks.all()).length;
  document.querySelector('button[data-act=track][data-i="0"]').click();
  await wait(800);
  const all = await tracks.all();
  out.saved = all.length - before;
  out.savedName = all.find((t) => t.name === 'Morgenlauf Import')?.name ?? null;
  out.afterSave = cards()[0].buttons.map(([t]) => t);
  // Dieselbe Datei noch einmal: erkannt
  await addFiles([{ name: 'lauf-kopie.gpx', text: timed }]);
  await wait(200);
  out.again = cards()[2].buttons.map(([t]) => t);
  // aufräumen
  for (const t of all.filter((x) => x.name === 'Morgenlauf Import')) await tracks.remove(t.id);
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

VIEW = r"""
(async () => {
  const { addFiles } = await import('./js/pages/import.js');
  const { buildTrack, trackGpx } = await import('./js/data/tracks.js');
  const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.95 + i * 0.0006, 51.54 + Math.sin(i / 6) * 0.0006, Date.UTC(2026, 5, 9, 7, 0, i * 12)]);
  const timed = trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Morgenlauf Vorschau' }), id: 'imp-v' }).replace(/<keywords>[^<]*<\/keywords>/, '');
  await addFiles([{ name: 'vorschau.gpx', text: timed }]);
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('button[data-act=view]').click();
})();
"""

with Browser(width=420, height=900) as b:
    b.open('import.html', wait=3)
    print('Leer:', b.js("return document.querySelector('.import').innerText.replace(/\\s+/g, ' ').slice(0, 80)"))
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 60))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.shot('import-gpx')
    ok = isinstance(r, dict) \
        and r['first'][0]['buttons'][:2] == [['visibility Ansehen', False], ['directions_walk Als aufgezeichnete Tour speichern', False]] \
        and r['first'][1]['buttons'] == [['edit_road Als geplante Tour öffnen', False]] \
        and r['saved'] == 1 and r['savedName'] == 'Morgenlauf Import' \
        and r['afterSave'][0] == 'visibility Gespeichert – ansehen' \
        and r['again'][1] == 'content_copy Gibt es schon – ansehen'
    print('Aufgezeichnet stimmt:', ok)

    # Geplant: öffnet tour.html wie eine geteilte Tour – noch nicht gespeichert
    b.js("document.querySelector('button[data-act=tour][data-i=\"1\"]').click()")
    tour = b.wait("return location.pathname.endsWith('tour.html') && document.body.classList.contains('readonly') && [document.getElementById('tour-name').value, document.getElementById('save').classList.contains('unsaved')]", 20)
    print('Geplant geöffnet:', tour)
    ok_tour = tour == ['Rundweg ohne Zeiten', True]
    print('Geplant stimmt:', ok_tour)

    # Ansehen: die Datei als Vorschau in „Meine Touren“ – gespeichert wird erst dort
    b.open('import.html', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", VIEW)
    seen = b.wait("return location.hash === '#datei' && document.querySelector('.weg-note') && [document.querySelector('.weg-note').innerText.trim(), [...document.querySelectorAll('.weg-actions .button')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim())]", 30)
    print('Vorschau:', seen)
    ok_view = bool(seen) and 'Geöffnete Datei' in seen[0] and len(seen[1]) == 2 and 'Als aufgezeichnete Tour speichern' in seen[1][0] and 'Als geplante Tour öffnen' in seen[1][1]
    b.js("document.querySelector('.weg-actions [data-do=keep]').click()")
    kept = b.wait("return new URLSearchParams(location.search).get('id') && !document.querySelector('.weg-note') && document.querySelector('.weg-name input')?.value", 20)
    print('Aus der Vorschau gespeichert:', kept)
    b.d.execute_async_script("const done = arguments[arguments.length - 1]; import('./js/data/tracks.js').then(async ({ tracks }) => { for (const t of await tracks.all()) if (t.name === 'Morgenlauf Vorschau') await tracks.remove(t.id); done(1); });")
    ok_view = ok_view and kept == 'Morgenlauf Vorschau'
    print('Vorschau stimmt:', ok_view)
    if not (ok and ok_tour and ok_view):
        b.errors.append(('import', 'Ergebnis falsch'))
    sys.exit(b.report())
