"""GPX öffnen, Datei zu einer Tour, die es schon gibt (js/pages/import.js, data/duplicates.js gain/enrich):
1. Übersicht bei mehreren Dateien: neu / ergänzen / gibt es schon, zwei Fragen nur, wo nötig.
2. „Alle übernehmen“: fehlende Frequenz kommt dazu, die genauere Strecke der Datei gilt (88 statt 41 Punkte –
   fremde Dateien werden beim Einlesen ausgedünnt); Name, Art, Farbe bleiben.
3. Abweichender Puls: bleibt der vorhandene (Frage steht auf „nein“).
4. Datei ohne Neues: nichts geändert. Neue Datei: gespeichert.
5. Frage „genauere Strecke“ auf nein: nur die Frequenz kommt dazu, die Punkte bleiben."""
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
  const info = async (id) => { const t = await tracks.get(id); return t && { name: t.name, sport: t.sport ?? null, color: t.color ?? null, pts: t.times.length, hr: mean(t.hr), cad: mean(t.cad), km: Math.round(t.length) }; };
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
  ]);
  await wait(300);
  const text = (sel) => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
  const out = { before };
  out.summary = text('.import-all .settings-hint');
  out.toggles = [...document.querySelectorAll('.import-all [data-opt]')].map((x) => [x.dataset.opt, x.checked]);
  out.cards = [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3')).map((s) => [...s.querySelectorAll('.settings-hint')].at(-1).innerText.replace(/\s+/g, ' ').trim() + ' | ' + s.querySelector('.sync-actions > .button').innerText.replace(/\s+/g, ' ').trim());
  out.allButton = text('.import-all [data-act=all]');
  document.querySelector('.import-all [data-act=all]').click();
  await wait(2500);
  out.after = { A: await info('mA'), B: await info('mB'), D: await info('mD'), n: (await tracks.all()).length, neu: (await tracks.all()).some((t) => t.name === 'Ganz neu') };
  out.summaryAfter = text('.import-all .settings-hint');
  out.cardsAfter = [...document.querySelectorAll('.import section:not(.import-all)')].filter((s) => s.querySelector('h3')).map((s) => s.querySelector('.sync-actions > .button').innerText.replace(/\s+/g, ' ').trim());
  // 5. Strecke: nein
  await addFiles([{ name: 'e.gpx', text: asFile(mk(7, N, 1, () => [120, 26, 0]), 'Zepp E') }]);
  await wait(300);
  const sw = document.querySelector('.import-all [data-opt=shape]');
  sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('button[data-act=merge]').click();
  await wait(1500);
  out.E = await info('mE');
  for (const t of await tracks.all()) if (/^m[ABDE]$/.test(t.id) || t.name === 'Ganz neu') await tracks.remove(t.id);
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
        '1. Übersicht: 1 neu, 2 ergänzen, 1 gibt es schon': r['summary'] == '1 neu · 2 ergänzen eine vorhandene Tour · 1 gibt es schon' and r['allButton'].endswith('Alle 3 übernehmen'),
        '1. beide Fragen stehen da: genauere Strecke ja, abweichende Werte nein': r['toggles'] == [['shape', True], ['values', False]],
        '1. Karten nennen, was die Datei mehr hat': 'Schlagfrequenz (fehlt hier)' in r['cards'][0] and 'genauere Strecke (88 statt 41 Punkte)' in r['cards'][0] and 'Puls weicht ab' in r['cards'][1] and 'Als aufgezeichnete Tour speichern' in r['cards'][2] and 'nichts, was hier fehlt' in r['cards'][3],
        '2. A: Frequenz dazu, alle Punkte der Datei, Puls bleibt; Name, Art, Farbe bleiben': A0['cad'] == 0 and A1['cad'] == 24 and A1['pts'] == 88 and A1['hr'] == 120 and [A1['name'], A1['sport'], A1['color']] == ['Meine Ruderrunde', 'rowing', '#ae3ec9'],
        '3. B: abweichender Puls bleibt der vorhandene': B1 == B0,
        '4. D unverändert, die neue Datei ist gespeichert, sonst kein Eintrag mehr': r['after']['D'] == r['before']['D'] and r['after']['neu'] and r['after']['n'] == r['before']['n'] + 1,
        '4. danach: Karten zeigen „Ergänzt“ bzw. „Gespeichert“': [c.split(' ', 1)[1] for c in r['cardsAfter']] == ['Ergänzt – ansehen', 'Gibt es schon – ansehen', 'Gespeichert – ansehen', 'Gibt es schon – ansehen'],
        '5. Strecke nein: Frequenz kommt dazu, Punkte und Kilometer bleiben': E1['cad'] == 26 and E1['pts'] == E0['pts'] == 41 and E1['km'] == E0['km'],
    }
    for name, ok in checks.items():
        print('ok    ' if ok else 'FALSCH', name)
    if not all(checks.values()):
        b.errors.append(('import_merge', 'Ergebnis falsch'))
    sys.exit(b.report())
