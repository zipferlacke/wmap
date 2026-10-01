"""Aufgezeichnete Touren: Art, Farbe, Alter, Ein- und Ausblenden (pages/wege.js, data/track-look.js).
1. Liste: Symbol und Farbe nach Art, ohne Art neutral und „GPX“; keine Uhrzeit, Symbol für Gesundheitsdaten bei Messwerten.
2. Karte: Farbe der Art, ältere blasser (1 … 0,4 ab zwei Jahren).
3. Einstellung „Letzte 365 Tage“: Älteres ist ausgeblendet, das Jahr zugeklappt mit durchgestrichenem Auge;
   das Auge blendet das Jahr wieder ein.
4. Tour: Art wählen (Rudern → Tempo je 500 m), eigene Farbe, einzeln ausblenden – gespeichert und in der GPX-Datei.
   Das Auge an der Zeile blendet einen einzelnen Weg aus und wieder ein, ohne ihn zu öffnen.
5. GPX auf die Seite ziehen: wird importiert.
6. „Erneut navigieren“: die Karte plant die Route entlang der Tour."""
import json
import sys
import time
from common import Browser

MAKE = r"""
const { buildTrack, tracks } = await import('./js/data/tracks.js');
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
localStorage.removeItem('wmap.tracks.show'); localStorage.removeItem('wmap.tracks.years');
const DAY = 864e5;
const mk = (id, name, daysAgo, kind, profile, extra = {}, hr = 0, dx = 0) => {
  const t0 = Date.now() - daysAgo * DAY;
  const pts = []; for (let i = 0; i < 120; i += 1) pts.push([9.90 + dx + i * 0.0006, 51.53 + dx / 2 + Math.sin(i / 9) * 0.003, t0 + i * 15000, hr ? hr + (i % 20) : 0]);
  return { ...buildTrack(pts, { kind, profile, name }), id, ...extra };
};
await tracks.putQuiet(mk('look1', 'Rudern am Abend', 10, 'health', 'foot', { source: { health: 'H1', app: 'com.huami.watch.hmwatchmanager', type: 'rowing' } }, 110));
await tracks.putQuiet(mk('look2', 'Radrunde', 400, 'rec', 'bike', {}, 0, 0.02));
await tracks.putQuiet(mk('look3', 'Fremde Datei', 800, 'gpx', 'foot', {}, 0, 0.04));
await tracks.putQuiet(mk('look4', 'Spaziergang', 200, 'health', 'walk', { source: { health: 'H2', app: 'com.fitbit.FitbitMobile', type: 'walking' } }, 0, 0.06));
return (await tracks.all()).length;
"""
ROWS = """return [...document.querySelectorAll('.wege-table tr[data-id]')].map((r) => ({ id: r.dataset.id, icon: r.querySelector('.w-icon .msr').textContent,
  color: r.querySelector('.w-icon .msr').style.color, sub: r.querySelector('.w-name small').innerText.replace(/\\s+/g, ' ').trim(),
  marks: [...r.querySelectorAll('.w-mark')].map((m) => m.textContent), off: r.classList.contains('off-map'), eye: r.querySelector('.row-eye .msr').textContent }))"""
MAPF = "return window.__wmap.map.getSource('wege').serialize().data.features.map((f) => [f.properties.id, f.properties.color, f.properties.opacity])"
YEARS = "return [...document.querySelectorAll('.wege-year')].map((d) => [d.querySelector('strong').textContent, d.open, d.querySelector('.year-eye .msr').textContent])"
call = lambda b, code: b.d.execute_async_script('const done = arguments[arguments.length - 1]; (async () => {' + code + '})().then(done, (e) => done("FEHLER " + e))')

with Browser(width=1300, height=900) as b:
    b.open('wege.html', wait=3)
    print('Wege angelegt:', call(b, MAKE))
    b.open('wege.html', wait=4)
    rows = {r['id']: r for r in b.js(ROWS)}
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    feats = {f[0]: f for f in b.js(MAPF)}
    print('Karte:', feats)
    b.shot('touren-liste')
    checks = {
        '1. Rudern: Symbol und Farbe der Art, Gesundheitsdaten-Symbol, keine Uhrzeit': rows['look1']['icon'] == 'rowing' and rows['look1']['color'] == 'rgb(12, 133, 153)' and 'monitor_heart' in rows['look1']['marks'] and ':' not in rows['look1']['sub'] and 'Rudern · Zepp' in rows['look1']['sub'],
        '1. Rad aus eigener Aufzeichnung: Rad-Symbol, grün, ohne Gesundheitsdaten-Symbol': rows['look2']['icon'] == 'directions_bike' and rows['look2']['color'] == 'rgb(47, 158, 68)' and 'monitor_heart' not in rows['look2']['marks'],
        '1. fremde Datei ohne Art: neutral, grau, „GPX“': rows['look3']['icon'] == 'timeline' and rows['look3']['color'] == 'rgb(134, 142, 150)' and rows['look3']['sub'].endswith('GPX'),
        '2. Karte: Farbe der Art, ältere blasser, ab zwei Jahren 0,4': feats['look1'][1:] == ['#0c8599', 1] and feats['look3'][2] == 0.4 and 0.4 < feats['look2'][2] < feats['look4'][2] < 1,
    }
    # 3. Zeitraum
    b.js("localStorage.setItem('wmap.tracks.show', '\"365\"')")
    b.open('wege.html', wait=4)
    years = b.js(YEARS)
    ids = sorted(f[0] for f in b.js(MAPF))
    print('365 Tage:', years, ids, b.js("return document.querySelector('.wege-period')?.innerText.replace(/\\s+/g, ' ')"))
    old_year = [y for y in years if not y[1]]
    checks['3. letzte 365 Tage: nur die auf der Karte, ältere Jahre zugeklappt mit durchgestrichenem Auge'] = ids == ['look1', 'look4'] and len(old_year) >= 1 and all(y[2] == 'visibility_off' for y in old_year)
    b.js("document.querySelector('.wege-year:not([open]) .year-eye').click()")
    time.sleep(.5)
    ids2 = sorted(f[0] for f in b.js(MAPF))
    print('Auge am Jahr:', b.js(YEARS), ids2)
    checks['3. Auge am Jahr blendet es wieder ein'] = len(ids2) == 3
    b.shot('touren-zeitraum')
    # 4. Tour: Art, Farbe, ausblenden
    b.js("localStorage.setItem('wmap.tracks.show', '\"all\"'); localStorage.removeItem('wmap.tracks.years')")
    b.open('wege.html?id=look3', wait=5)
    before = b.js("return [...document.querySelectorAll('.weg-stats small')].map((x) => x.textContent)")
    b.js("const s = document.querySelector('.weg-sport select'); s.value = 'rowing'; s.dispatchEvent(new Event('change', { bubbles: true }))")
    time.sleep(1.5)
    after = b.js("return [...document.querySelectorAll('.weg-stats small')].map((x) => x.textContent)")
    b.js("document.querySelector('.swatch[data-color=\"#ae3ec9\"]').click()")
    time.sleep(1.5)
    b.js("document.querySelector('[data-flag=\"map\"]').click()")
    time.sleep(1.5)
    b.shot('tour-aussehen')
    saved = call(b, "const { tracks, trackGpx, parseGpx } = await import('./js/data/tracks.js'); const t = await tracks.get('look3'); const back = parseGpx(trackGpx(t))[0]; return { sport: t.sport, color: t.color, hidden: t.hidden, updated: !!t.updated, back: [back.sport, back.color, back.hidden, back.times.length === t.times.length] };")
    print('gespeichert:', saved, before, after)
    icon = b.js("return document.querySelector('.weg-when .msr').textContent + ' ' + document.querySelector('.weg-when .msr').style.color")
    checks['4. Art gewählt: Rudern-Symbol, Tempo je 500 m'] = saved['sport'] == 'rowing' and 'Ø /500 m' in after and 'Ø /500 m' not in before and icon.startswith('rowing')
    checks['4. eigene Farbe und ausgeblendet gespeichert – auch in der GPX-Datei'] = saved['color'] == '#ae3ec9' and saved['hidden'] is True and saved['back'] == ['rowing', '#ae3ec9', True, True] and 'rgb(174, 62, 201)' in icon
    b.open('wege.html', wait=4)
    rows = {r['id']: r for r in b.js(ROWS)}
    checks['4. in der Liste: ausgeblendet markiert, nicht auf der Karte'] = rows['look3']['off'] and rows['look3']['eye'] == 'visibility_off' and 'look3' not in [f[0] for f in b.js(MAPF)]
    # Auge an der Zeile: einzeln aus und wieder ein, die Tour öffnet sich dabei nicht
    b.js("document.querySelector('.row-eye[data-eye=\"look1\"]').click()")
    time.sleep(1.5)
    off = ({r['id']: r for r in b.js(ROWS)}['look1'], [f[0] for f in b.js(MAPF)], b.js("return location.search"))
    b.js("document.querySelector('.row-eye[data-eye=\"look1\"]').click()")
    time.sleep(1.5)
    on = ({r['id']: r for r in b.js(ROWS)}['look1'], [f[0] for f in b.js(MAPF)])
    print('Auge an der Zeile:', off[0]['eye'], off[1], off[2], '→', on[0]['eye'], on[1])
    checks['4. Auge an der Zeile: einzelner Weg aus und wieder ein, Liste bleibt'] = off[0]['eye'] == 'visibility_off' and off[0]['off'] and 'look1' not in off[1] and off[2] == '' and on[0]['eye'] == 'visibility' and 'look1' in on[1]
    # 5. Drag & Drop
    gpx = call(b, "const { buildTrack, trackGpx } = await import('./js/data/tracks.js'); const pts = []; for (let i = 0; i < 80; i += 1) pts.push([10.2 + i * 0.0006, 51.4, Date.now() - 3 * 864e5 + i * 15000]); return trackGpx({ ...buildTrack(pts, { kind: 'rec', profile: 'bike', name: 'Hineingezogen' }), id: 'drop1' });")
    b.js("""const dt = new DataTransfer(); dt.items.add(new File([arguments[0]], 'Hineingezogen.gpx', { type: 'application/gpx+xml' }));
      dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); window.__hint = !document.querySelector('.wege-drop').hidden;
      dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));""", gpx)
    time.sleep(2)
    dropped = b.js("return [window.__hint, [...document.querySelectorAll('.wege-table tr[data-id] strong')].map((x) => x.textContent).includes('Hineingezogen'), document.querySelector('.wege-drop').hidden]")
    print('Drag & Drop:', dropped)
    checks['5. GPX auf die Seite gezogen: Hinweis, importiert'] = dropped == [True, True, True]
    # 6. Erneut navigieren
    href = (b.open('wege.html?id=look2', wait=4), b.js("return document.querySelector('.weg-actions a.primary')?.getAttribute('href')"))[1]
    b.open('index.html?track=look2', wait=3)
    ok = b.wait("return window.__wmap.state.routes.length > 0 && window.__wmap.state.waypoints.length", 40)
    print('Erneut navigieren:', href, ok, b.js("return [window.__wmap.state.profile, window.__wmap.state.waypoints[0].label]"))
    b.shot('tour-erneut')
    checks['6. „Erneut navigieren“ → Route entlang der Tour, Profil Rad'] = href == './index.html?track=look2&start' and bool(ok) and ok >= 6 and b.js("return window.__wmap.state.profile") == 'bike'
    call(b, "const { tracks } = await import('./js/data/tracks.js'); for (const t of await tracks.all()) await tracks.removeQuiet(t.id); localStorage.removeItem('wmap.health.gone'); return 1;")
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
