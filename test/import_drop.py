"""Dateien auf „Meine Touren“ wählen oder hineinziehen (js/pages/wege.js importFiles, ui/import-ask.js) – dieselbe
Rückfrage wie auf „GPX/FIT öffnen“ und im Ordner:
1. Drei Dateien hineingezogen (eine zu einer Tour, die es schon gibt, eine neue, eine ohne Zeiten): Die Frage für
   alle kommt; „Ja, überall die genaueren Daten“ → Frequenz und genauere Strecke kommen in die vorhandene Tour (Name
   bleibt), die neue ist gespeichert, die ohne Zeiten ist eine geplante Tour.
2. Eine Datei über „GPX/FIT importieren“ gewählt, die es schon gibt: gleich die Haken; Strecke abgewählt.
3. Zwei Dateien hineingezogen, „Selbst einstellen“ → „Später weitermachen“: nichts passiert.
4. FIT-Datei hineingezogen: als Rudern gespeichert, ohne Frage."""
import json
import sys
from common import Browser

STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const out = {}; window.__o = out;
  try {
    const { tracks, buildTrack, trackGpx } = await import('./js/data/tracks.js');
    const { tours, toGpx } = await import('./js/data/store.js');
    const N = 401, DAY0 = Date.now() - 20 * 864e5;
    const mk = (day, step, vals) => { const p = []; for (let i = 0; i < N; i += step) p.push([9.91 + i * 0.0003, 51.52 + Math.sin(i / 40) * 0.003, DAY0 + day * 864e5 + i * 5000, ...vals]); return p; };
    const asFile = (pts, name) => trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name, keepAll: true }), id: 'x' + name }).replace(/<keywords>[^<]*<\/keywords>/, '').replace(/<wmap:track[^>]*\/>/, '');
    const mean = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : 0; };
    const info = async (id) => { const t = await tracks.get(id); return t && { name: t.name, pts: t.times.length, hr: mean(t.hr), cad: mean(t.cad) }; };
    for (const [id, day] of [['dA', 0], ['dB', 1], ['dC', 2], ['dD', 3]]) await tracks.putQuiet({ ...buildTrack(mk(day, 10, [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Tour ' + id, keepAll: true }), id });
    const dlg = () => document.querySelector('dialog.confirm[open]');
    const title = () => dlg()?.querySelector('.uD-title')?.innerText.replace(/^\S+\s+/, '').trim() ?? null;
    const labels = () => [...dlg().querySelectorAll('.confirm-actions button')].map((x) => x.innerText.replace(/^\S+\s+/, '').trim());
    const press = async (re, ms = 2000) => { [...dlg().querySelectorAll('.confirm-actions button')].find((x) => re.test(x.innerText)).click(); await wait(ms); };
    const dt = (list) => { const d = new DataTransfer(); for (const [name, data] of list) d.items.add(new File([data], name)); return d; };
    const drop = async (list) => {
      const d = dt(list);
      dispatchEvent(new DragEvent('dragenter', { dataTransfer: d, bubbles: true }));
      out.hint ??= document.querySelector('.wege-drop').innerText.replace(/\s+/g, ' ').trim();
      dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true }));
      await wait(1200);
    };
    const rows = () => [...document.querySelectorAll('.wege-table tr[data-id] strong')].map((x) => x.textContent);
    const n0 = (await tracks.all()).length, plan0 = tours.all().length;

    // 1. drei Dateien hineinziehen
    await drop([
      ['a.gpx', asFile(mk(0, 1, [120, 24, 0]), 'Zepp A')],
      ['neu.gpx', asFile(mk(5, 1, [100, 0, 0]), 'Ganz neu gezogen')],
      ['plan.gpx', toGpx({ name: 'Rundweg gezogen', profile: 'hike', points: [] }, mk(6, 4, []).map(([x, y]) => [x, y]))],
    ]);
    out.ask = [title(), labels(), dlg()?.innerText.includes('1 neue Tour, 1 zu einer Tour, die es schon gibt')];
    await press(/Ja, überall/, 2500);
    out.A = await info('dA');
    out.count = [(await tracks.all()).length - n0, tours.all().length - plan0, tours.all().some((t) => t.name === 'Rundweg gezogen')];
    out.listed = rows().includes('Ganz neu gezogen');

    // 2. eine Datei wählen, die es schon gibt: gleich die Haken
    const inp = document.querySelector('input[data-file="gpx"]');
    out.accept = inp.accept;
    inp.files = dt([['b.gpx', asFile(mk(1, 1, [120, 26, 0]), 'Zepp B')]]).files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(1200);
    out.one = [title(), [...dlg().querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]), labels()];
    dlg().querySelector('[data-pick=shape]').checked = false;
    await press(/Zusammenführen/, 2500);
    out.B = await info('dB');

    // 3. zwei hineinziehen, selbst einstellen, abbrechen
    await drop([['c.gpx', asFile(mk(2, 1, [120, 27, 0]), 'Zepp C')], ['d.gpx', asFile(mk(3, 1, [120, 27, 0]), 'Zepp D')]]);
    out.ask2 = title();
    await press(/Selbst einstellen/, 900);
    out.first = [title(), labels()];
    await press(/Später weitermachen/, 1500);
    out.CD = [await info('dC'), await info('dD')];

    // 4. FIT hineinziehen
    const fit = (pts, sport) => {
      const bytes = [];
      const u8 = (x) => bytes.push(x & 255), u16 = (x) => { u8(x); u8(x >> 8); }, u32 = (x) => { u16(x); u16(x >>> 16); };
      u8(0x40); u8(0); u8(0); u16(20); u8(5); [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [3, 1, 2], [4, 1, 2]].forEach((f) => f.forEach(u8));
      for (const [lon, lat, ms, hr, cad] of pts) { u8(0); u32(Math.round(ms / 1000) - 631065600); u32(Math.round(lat * 2 ** 31 / 180)); u32(Math.round(lon * 2 ** 31 / 180)); u8(hr); u8(cad || 255); }
      u8(0x41); u8(0); u8(0); u16(18); u8(1); [5, 1, 0].forEach(u8); u8(1); u8(sport);
      const head = [14, 0x20, 0, 0, bytes.length & 255, (bytes.length >> 8) & 255, (bytes.length >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
      return new Uint8Array([...head, ...bytes, 0, 0]).buffer;
    };
    await drop([['Rudern gezogen.fit', fit(mk(8, 1, [130, 30, 0]), 23)]]);
    await wait(1500);
    out.fitOpen = !!dlg();
    const f = (await tracks.all()).find((t) => t.name === 'Rudern gezogen');
    out.fit = f ? { sport: f.sport, cad: mean(f.cad), hr: mean(f.hr) } : null;

    for (const t of await tracks.all()) if (/^d[ABCD]$/.test(t.id) || /gezogen/.test(t.name)) await tracks.removeQuiet(t.id);
    for (const t of tours.all()) if (t.name === 'Rundweg gezogen') tours.remove(t.id);
    done(out);
  } catch (e) { done('FEHLER ' + e + ' ' + e.stack + ' bis dahin: ' + JSON.stringify(window.__o)); }
})();
"""

with Browser() as b:
    b.open('wege.html', wait=4)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 90))
    if not isinstance(r, dict):
        print(r); sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.shot('import-drop')
    BUTTONS = ['Ja, überall die genaueren Daten', 'Selbst einstellen', 'Abbrechen']
    checks = {
        '1. Hinweis beim Ziehen nennt GPX und FIT': 'GPX oder FIT hier ablegen' in r['hint'],
        '1. drei Dateien gezogen: Frage für alle (zwei Aufzeichnungen: 1 neu, 1 gibt es schon)': r['ask'] == ['2 Dateien', BUTTONS, True],
        '1. ja: Frequenz und genauere Strecke in der vorhandenen Tour, Name bleibt': r['A'] == {'name': 'Tour dA', 'pts': 88, 'hr': 120, 'cad': 24},
        '1. die neue ist gespeichert und steht in der Liste, die ohne Zeiten ist eine geplante Tour': r['count'] == [1, 1, True] and r['listed'],
        '2. „GPX/FIT importieren“ nimmt auch FIT; eine Datei, die es schon gibt: gleich die Haken': '.fit' in r['accept'] and r['one'][0] == 'Zusammenführen' and ['shape', True] in r['one'][1] and ['cad', True] in r['one'][1] and r['one'][2] == ['Zusammenführen', 'Später weitermachen'],
        '2. Strecke abgewählt: nur die Frequenz kommt dazu': r['B'] == {'name': 'Tour dB', 'pts': 41, 'hr': 120, 'cad': 26},
        '3. zwei gezogen, selbst einstellen: Schalter 1 von 2 mit Weiter / für alle Dateien so / für alle die genaueren / später weitermachen': r['ask2'] == '2 Dateien' and r['first'] == ['Zusammenführen (1 von 2)', ['Weiter', 'Für alle Dateien so übernehmen', 'Für alle die genaueren Daten', 'Später weitermachen']],
        '3. später weitermachen: nichts passiert': [(x['pts'], x['cad']) for x in r['CD']] == [(41, 0), (41, 0)],
        '4. FIT gezogen: ohne Frage als Rudern mit Puls und Frequenz gespeichert': not r['fitOpen'] and r['fit'] == {'sport': 'rowing', 'cad': 30, 'hr': 130},
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
