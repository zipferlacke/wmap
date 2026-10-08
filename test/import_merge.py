"""GPX öffnen, Datei zu einer Tour, die es schon gibt (js/pages/import.js, data/import-files.js, ui/import-ask.js):
1. Übersicht bei mehreren Dateien: neu / zu einer Tour, die es schon gibt / gibt es schon.
2. „Alle übernehmen …“ → die Frage für alle (ja, überall die genaueren / selbst einstellen / abbrechen).
   Abbrechen: nichts passiert. Ja: fehlende Frequenz kommt dazu, die genauere Strecke der Datei gilt (88 statt
   41 Punkte – fremde Dateien werden beim Einlesen ausgedünnt); Name, Art, Farbe bleiben.
3. Abweichender Puls bei gleich vielen Punkten: bleibt der vorhandene.
4. Datei ohne Neues: nichts geändert. Neue Datei: gespeichert.
5. Eine Datei: gleich der Dialog mit Haken; Strecke abgewählt: nur die Frequenz kommt dazu.
6. FIT-Datei (js/data/fit.js): ergänzt eine vorhandene Tour um die Schlagfrequenz; eine neue wird mit Art gespeichert.
8. Mehrere Dateien gewählt: Die Frage kommt von selbst. „Selbst einstellen“: je Datei die Haken – „Weiter“,
   dann „Für alle so übernehmen“ (die Haken der zweiten gelten auch für die dritte).
9. „Später weitermachen“: nichts geändert, die Dateien stehen weiter da. „Abbrechen“ bei der zweiten: auch die
   erste bleibt, wie sie war."""
import json
import sys
from common import Browser

STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { addFiles } = await import('./js/pages/import.js');
  const { tracks, buildTrack, trackGpx } = await import('./js/data/tracks.js');
  const mk = (day, n, step, vals) => { const p = []; for (let i = 0; i < n; i += step) p.push([9.91 + i * 0.0003, 51.52 + Math.sin(i / 40) * 0.003, Date.UTC(2026, 5, day, 7, 0, i * 5), ...vals(i)]); return p; };
  const last = (n, step) => n - 1 - ((n - 1) % step);
  const asFile = (pts, name) => trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name, keepAll: true }), id: 'x' + name }).replace(/<keywords>[^<]*<\/keywords>/, '').replace(/<wmap:track[^>]*\/>/, '');
  const N = 401;
  const mean = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : 0; };
  const info = async (id) => { const t = await tracks.get(id); return t && { name: t.name, sport: t.sport ?? null, color: t.color ?? null, pts: t.times.length, hr: mean(t.hr), cad: mean(t.cad), km: Math.round(t.length), ...(t.marks ? { marks: t.marks } : {}) }; };
  // A: hier grob (jeder 10. Punkt), mit Puls, ohne Frequenz – Datei: alle Punkte, Puls gleich, Frequenz
  await tracks.putQuiet({ ...buildTrack(mk(3, N, 10, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Meine Ruderrunde', keepAll: true }), id: 'mA', sport: 'rowing', color: '#ae3ec9' });
  // B: gleiche Punkte, Puls hier 120 – Datei 140
  await tracks.putQuiet({ ...buildTrack(mk(4, N, 1, () => [120, 0, 0]), { kind: 'gpx', profile: 'foot', name: 'Puls anders', keepAll: true }), id: 'mB' });
  // D: dieselbe Datei gibt es schon ganz
  await tracks.putQuiet({ ...buildTrack(mk(6, N, 1, () => [110, 80, 0]), { kind: 'gpx', profile: 'foot', name: 'Schon ganz da', keepAll: true }), id: 'mD' });
  // E: wie A, für die Frage „genauere Strecke: nein“
  await tracks.putQuiet({ ...buildTrack(mk(7, N, 10, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Strecke bleibt', keepAll: true }), id: 'mE' });
  const before = { A: await info('mA'), B: await info('mB'), D: await info('mD'), E: await info('mE'), n: (await tracks.all()).length };
  await addFiles([
    { name: 'a.gpx', text: asFile(mk(3, N, 1, () => [120, 24, 0]), 'Zepp A') },
    { name: 'b.gpx', text: asFile(mk(4, N, 1, () => [140, 0, 0]), 'Zepp B') },
    { name: 'c.gpx', text: asFile(mk(5, N, 1, () => [100, 0, 0]), 'Ganz neu') },
    { name: 'd.gpx', text: asFile(mk(6, N, 1, () => [110, 80, 0]), 'Zepp D') },
  ], false);
  await wait(300);
  const text = (sel) => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
  const out = { before };
  out.summary = text('.import-all .settings-hint');
  out.cards = [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3')).map((s) => [...s.querySelectorAll('.settings-hint')].at(-1).innerText.replace(/\s+/g, ' ').trim() + ' | ' + s.querySelector('.sync-actions > .button:not([data-act=view])').innerText.replace(/\s+/g, ' ').trim());
  out.allButton = text('.import-all [data-act=all]');
  const ask = () => document.querySelector('dialog.confirm[open]');
  const labels = () => [...ask().querySelectorAll('.confirm-actions button')].map((x) => x.innerText.replace(/^\S+\s+/, '').trim());
  const press = async (re, ms = 900) => { [...ask().querySelectorAll('.confirm-actions button')].find((x) => re.test(x.innerText)).click(); await wait(ms); };
  const title = () => ask()?.querySelector('.uD-title')?.innerText.replace(/^\S+\s+/, '').trim() ?? null;
  // Die Frage für alle: erst abbrechen, dann ja
  document.querySelector('.import-all [data-act=all]').click();
  await wait(700);
  out.askAll = [title(), labels()];
  await press(/Abbrechen/);
  out.cancelled = { A: await info('mA'), n: (await tracks.all()).length };
  document.querySelector('.import-all [data-act=all]').click();
  await wait(700);
  await press(/Ja, überall/, 2500);
  out.after = { A: await info('mA'), B: await info('mB'), D: await info('mD'), n: (await tracks.all()).length, neu: (await tracks.all()).some((t) => t.name === 'Ganz neu') };
  out.summaryAfter = text('.import-all .settings-hint');
  out.cardsAfter = [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3')).map((s) => s.querySelector('.sync-actions > .button:not([data-act=view])').innerText.replace(/\s+/g, ' ').trim());
  // 5. Strecke: nein
  await addFiles([{ name: 'e.gpx', text: asFile(mk(7, N, 1, () => [120, 26, 0]), 'Zepp E') }]);
  await wait(300);
  // Einzeln: Dialog mit Haken – vorgeschlagen ist, was genauer ist; Strecke hier abwählen
  const dlg = () => document.querySelector('dialog.merge-ask[open]');
  const confirmMerge = async (untick = []) => {
    await wait(600);
    const picks = [...dlg().querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]);
    for (const k of untick) dlg().querySelector(`[data-pick=${k}]`).checked = false;
    [...dlg().querySelectorAll('.confirm-actions button')].find((x) => /Zusammenführen/.test(x.innerText)).click();
    await wait(1200);
    return picks;
  };
  document.querySelector('button[data-act=merge]').click();
  out.picksE = await confirmMerge(['shape']);
  out.E = await info('mE');
  // 6. FIT-Datei (wie aus Zepp: Schlagfrequenz steht nur dort) zu einer Tour ohne Frequenz
  const fit = (pts, sport) => {
    const bytes = [];
    const u8 = (x) => bytes.push(x & 255), u16 = (x) => { u8(x); u8(x >> 8); }, u32 = (x) => { u16(x); u16(x >>> 16); };
    // Definition lokal 0: record (20) – Zeit, Breite, Länge, Puls, Frequenz
    u8(0x40); u8(0); u8(0); u16(20); u8(5); [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [3, 1, 2], [4, 1, 2]].forEach((f) => f.forEach(u8));
    for (const [lon, lat, ms, hr, cad] of pts) { u8(0); u32(Math.round(ms / 1000) - 631065600); u32(Math.round(lat * 2 ** 31 / 180)); u32(Math.round(lon * 2 ** 31 / 180)); u8(hr); u8(cad || 255); }
    // Definition lokal 1: session (18) – Sportart
    u8(0x41); u8(0); u8(0); u16(18); u8(1); [5, 1, 0].forEach(u8); u8(1); u8(sport);
    // Definition lokal 2: lap (19) – Ende der Runde; zwei Runden: Mitte und Schluss
    u8(0x42); u8(0); u8(0); u16(19); u8(1); [253, 4, 0x86].forEach(u8);
    for (const ms of [pts[Math.floor(pts.length / 2)][2], pts.at(-1)[2]]) { u8(2); u32(Math.round(ms / 1000) - 631065600); }
    const head = [14, 0x20, 0, 0, bytes.length & 255, (bytes.length >> 8) & 255, (bytes.length >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
    return new Uint8Array([...head, ...bytes, 0, 0]).buffer;
  };
  await tracks.putQuiet({ ...buildTrack(mk(8, N, 10, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Bootstour', keepAll: true }), id: 'mF', sport: 'rowing' });
  await addFiles([{ name: 'Zepp.fit', bytes: fit(mk(8, N, 1, (i) => [120, i % 7 ? 28 : 0, 0]), 23) }, { name: 'neu.fit', bytes: fit(mk(9, N, 1, () => [130, 30, 0]), 23) }], false);
  await wait(300);
  const fitCards = [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3')).slice(-2);
  out.fitCards = fitCards.map((s) => [...s.querySelectorAll('.settings-hint')].at(-1).innerText.replace(/\s+/g, ' ').trim() + ' | ' + s.querySelector('.sync-actions > .button:not([data-act=view])').innerText.replace(/\s+/g, ' ').trim());
  // nach jedem Klick wird neu gezeichnet – die Knöpfe jedes Mal neu suchen
  [...document.querySelectorAll('button[data-act=merge]')].at(-1).click();
  out.picksF = await confirmMerge(['shape']);
  out.view = [...document.querySelectorAll('button[data-act=view]')].length;
  [...document.querySelectorAll('button[data-act=track]')].at(-1).click(); await wait(1200);
  out.F = await info('mF');
  out.fitNew = await (async () => { const t = (await tracks.all()).find((x) => x.name === 'neu'); return t && { sport: t.sport, cad: mean(t.cad), hr: mean(t.hr) }; })();
  // 8. Mehrere gewählt: Frage kommt von selbst → selbst einstellen
  for (const [k, day] of [['H1', 11], ['H2', 12], ['H3', 13], ['J1', 14], ['J2', 15]]) await tracks.putQuiet({ ...buildTrack(mk(day, N, 10, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Tour ' + k, keepAll: true }), id: 'm' + k });
  const untick = (k) => { ask().querySelector(`[data-pick=${k}]`).checked = false; };
  addFiles([11, 12, 13].map((day, i) => ({ name: `h${i + 1}.gpx`, text: asFile(mk(day, N, 1, () => [120, 27, 0]), 'Zepp H' + (i + 1)) })));
  await wait(1200);
  out.autoAsk = [title(), labels()];
  await press(/Selbst einstellen/);
  out.one = [title(), labels(), ask().innerText.includes('h1.gpx')];
  untick('shape');
  await press(/Weiter/);
  out.two = [title(), ask().innerText.includes('h2.gpx')];
  untick('cad');
  await press(/Für alle so/, 2500);
  out.H = [await info('mH1'), await info('mH2'), await info('mH3')];
  // 9. Später weitermachen / Abbrechen mittendrin
  addFiles([14, 15].map((day, i) => ({ name: `j${i + 1}.gpx`, text: asFile(mk(day, N, 1, () => [120, 27, 0]), 'Zepp J' + (i + 1)) })));
  await wait(1200);
  await press(/Selbst einstellen/);
  await press(/Später weitermachen/, 1500);
  out.later = [await info('mJ1'), await info('mJ2'), text('.import-all [data-act=all]')];
  document.querySelector('.import-all [data-act=all]').click();
  await wait(700);
  await press(/Selbst einstellen/);
  await press(/Weiter/);
  out.lastLabels = labels();
  await press(/Abbrechen/, 1500);
  out.aborted = [await info('mJ1'), await info('mJ2')];
  // Abbrechen: nichts passiert
  await tracks.putQuiet({ ...buildTrack(mk(10, N, 10, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Bleibt so', keepAll: true }), id: 'mG' });
  await addFiles([{ name: 'g.gpx', text: asFile(mk(10, N, 1, () => [120, 27, 0]), 'Zepp G') }]);
  await wait(300);
  [...document.querySelectorAll('button[data-act=merge]')].at(-1).click();
  await wait(600);
  [...dlg().querySelectorAll('.confirm-actions button')].find((x) => /Abbrechen/.test(x.innerText)).click();
  await wait(600);
  out.G = await info('mG');
  for (const t of await tracks.all()) if (/^m([ABDEFG]|[HJ]\d)$/.test(t.id) || t.name === 'Ganz neu' || t.name === 'neu') await tracks.remove(t.id);
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=900) as b:
    b.open('import.html', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 90))
    if not isinstance(r, dict):
        print(r); sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.shot('import-merge')
    A0, A1, B0, B1, E0, E1 = r['before']['A'], r['after']['A'], r['before']['B'], r['after']['B'], r['before']['E'], r['E']
    checks = {
        '1. Übersicht: 1 neu, 2 zu einer vorhandenen Tour, 1 gibt es schon': r['summary'] == '1 neu · 2 zu einer Tour, die es schon gibt · 1 gibt es schon' and r['allButton'].endswith('Alle 3 übernehmen …'),
        '2. Frage für alle: ja / selbst einstellen / abbrechen': r['askAll'] == ['3 Dateien', ['Ja, überall die genaueren Daten', 'Selbst einstellen', 'Abbrechen']],
        '2. Abbrechen: nichts passiert': r['cancelled'] == {'A': r['before']['A'], 'n': r['before']['n']},
        '1. Karten nennen, was die Datei mehr hat': 'Schlagfrequenz (fehlt hier)' in r['cards'][0] and 'genauere Strecke (88 statt 41 Punkte)' in r['cards'][0] and 'Puls weicht ab' in r['cards'][1] and 'Als aufgezeichnete Tour speichern' in r['cards'][2] and 'nichts, was hier fehlt' in r['cards'][3],
        '2. A: Frequenz dazu, alle Punkte der Datei, Puls bleibt; Name, Art, Farbe bleiben': A0['cad'] == 0 and A1['cad'] == 24 and A1['pts'] == 88 and A1['hr'] == 120 and [A1['name'], A1['sport'], A1['color']] == ['Meine Ruderrunde', 'rowing', '#ae3ec9'],
        '3. B: abweichender Puls bleibt der vorhandene': B1 == B0,
        '4. D unverändert, die neue Datei ist gespeichert, sonst kein Eintrag mehr': r['after']['D'] == r['before']['D'] and r['after']['neu'] and r['after']['n'] == r['before']['n'] + 1,
        '4. danach: Karten zeigen „Ergänzt“ bzw. „Gespeichert“': [c.split(' ', 1)[1] for c in r['cardsAfter']] == ['Ergänzt – ansehen', 'Gibt es schon – ansehen', 'Gespeichert – ansehen', 'Gibt es schon – ansehen'],
        '6. FIT-Datei: Schlagfrequenz kommt in die vorhandene Tour (Strecke im Dialog abgewählt)': 'Schlagfrequenz (fehlt hier)' in r['fitCards'][0] and 'Runden der Uhr (fehlen hier)' in r['fitCards'][0] and r['F']['cad'] == 28 and r['F']['pts'] == 41 and r['F']['sport'] == 'rowing' and r['F'].get('marks') == [1000],
        '6. neue FIT-Datei: gespeichert als Rudern mit Puls und Frequenz': 'Als aufgezeichnete Tour speichern' in r['fitCards'][1] and r['fitNew'] == {'sport': 'rowing', 'cad': 30, 'hr': 130},
        '5. Dialog mit Haken: Strecke und Frequenz vorgeschlagen': ['shape', True] in r['picksE'] and ['cad', True] in r['picksE'],
        '7. Abbrechen im Dialog: nichts passiert; „Ansehen“ steht an Dateien mit Zeiten': r['G']['cad'] == 0 and r['G']['pts'] == 41 and r['view'] >= 1,
        '8. mehrere gewählt: Frage kommt von selbst; selbst einstellen → Haken je Datei mit Weiter / für alle so / für alle die genaueren / später': r['autoAsk'] == ['3 Dateien', ['Ja, überall die genaueren Daten', 'Selbst einstellen', 'Abbrechen']] and r['one'] == ['Zusammenführen (1 von 3)', ['Weiter', 'Für alle so übernehmen', 'Für alle die genaueren Daten', 'Später weitermachen', 'Abbrechen'], True] and r['two'] == ['Zusammenführen (2 von 3)', True],
        '8. erste: nur Frequenz (Strecke abgewählt); zweite und dritte: nur die Strecke („für alle so“)': [(h['pts'], h['cad']) for h in r['H']] == [(41, 27), (88, 0), (88, 0)] and [h['name'] for h in r['H']] == ['Tour H1', 'Tour H2', 'Tour H3'],
        '9. später weitermachen: nichts geändert, beide stehen weiter zum Übernehmen da': [(h['pts'], h['cad']) for h in r['later'][:2]] == [(41, 0), (41, 0)] and (r['later'][2] or '').endswith('Alle 2 übernehmen …'),
        '9. letzte Datei: Zusammenführen / Später / Abbrechen; Abbrechen dort: auch die erste bleibt': r['lastLabels'] == ['Zusammenführen', 'Später', 'Abbrechen'] and [(h['pts'], h['cad']) for h in r['aborted']] == [(41, 0), (41, 0)],
        '5. Strecke nein: Frequenz kommt dazu, Punkte und Kilometer bleiben': E1['cad'] == 26 and E1['pts'] == E0['pts'] == 41 and E1['km'] == E0['km'],
    }
    for name, ok in checks.items():
        print('ok    ' if ok else 'FALSCH', name)
    if not all(checks.values()):
        b.errors.append(('import_merge', 'Ergebnis falsch'))
    sys.exit(b.report())
