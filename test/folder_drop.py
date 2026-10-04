"""Verbundener Ordner (js/data/folder.js): Umzug aus dem Unterordner „WMap“, neu hineingelegte Dateien, FIT, Kaputtes
0. Bis 2.2 lag alles unter „WMap/“: zieht eine Ebene hoch, nichts wird doppelt, der Unterordner ist leer.
1. Neue Dateien (egal wohin gelegt, auch in einen eigenen Unterordner): Ohne Entscheidung bleiben sie liegen und
   stehen in `inbox` (neu / zusammenführen); beim nächsten Abgleich werden sie nicht noch einmal gelesen.
   Eine Datei, die nichts anderes hat als die Tour hier, geht ohne Frage.
2. Kaputte Dateien (lesbar, keine Tour darin) → „Kaputte Dateien/“; nach 30 Tagen gelöscht.
3. Entschieden: neue GPX → WMap-Datei unter Jahr/Monat; neue FIT bleibt FIT und zieht dorthin (keine GPX daneben);
   FIT zu einer vorhandenen Tour (Karteikarte): die angehakten Angaben kommen in deren Datei, die FIT bleibt.
4. Zweiter Abgleich: nichts zu tun, nichts gelesen.
5. FIT-Tour umbenannt: Der Name steht im Verzeichnis – ein zweites Gerät bekommt dieselbe Kennung und den Namen,
   ohne Rückfrage; die FIT-Datei bleibt unverändert.
6. Seite „Sicherung & Synchronisation“: Die Frage „Neue Datei im Ordner“ kommt von selbst (genaueste / einzeln /
   später); „Später“ lässt alles liegen, der Hinweis mit „Neue Dateien ansehen“ bleibt; „Einzeln entscheiden“ →
   „Übernehmen“. Kaputte Dateien stehen mit Hinweis da."""
import json
import sys
from common import Browser

TEST = r"""
const { folder } = await import('./js/data/folder.js');
const { tracks, buildTrack, trackGpx, parseGpx } = await import('./js/data/tracks.js');
const files = new Map();
let clock = Date.now();
const enc = new TextEncoder();
const be = {
  permission: async () => 'granted',
  list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
  read: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).text; },
  bytes: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).bytes; },
  write: async (p, text) => { clock += 1000; files.set(p, { text, modified: clock }); return clock; },
  remove: async (p) => { files.delete(p); },
};
const drop = (p, what) => { clock += 1000; files.set(p, typeof what === 'string' ? { text: what, modified: clock } : { bytes: what, modified: clock }); };
const mk = (day, n, step, vals) => { const p = []; for (let i = 0; i < n; i += step) p.push([9.91 + i * 0.0003, 51.52 + Math.sin(i / 40) * 0.003, Date.UTC(2025, 5, day, 7, 0, i * 5), ...vals(i)]); return p; };
const foreign = (pts, name) => trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name, keepAll: true }), id: 'x' }).replace(/<keywords>[^<]*<\/keywords>/, '').replace(/<wmap:track[^>]*\/>/, '');
const fit = (pts, sport) => {
  const bytes = [];
  const u8 = (x) => bytes.push(x & 255), u16 = (x) => { u8(x); u8(x >> 8); }, u32 = (x) => { u16(x); u16(x >>> 16); };
  u8(0x40); u8(0); u8(0); u16(20); u8(5); [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [3, 1, 2], [4, 1, 2]].forEach((f) => f.forEach(u8));
  for (const [lon, lat, ms, hr, cad] of pts) { u8(0); u32(Math.round(ms / 1000) - 631065600); u32(Math.round(lat * 2 ** 31 / 180)); u32(Math.round(lon * 2 ** 31 / 180)); u8(hr); u8(cad || 255); }
  u8(0x41); u8(0); u8(0); u16(18); u8(1); [5, 1, 0].forEach(u8); u8(1); u8(sport);
  u8(0x42); u8(0); u8(0); u16(19); u8(1); [253, 4, 0x86].forEach(u8);
  for (const ms of [pts[Math.floor(pts.length / 2)][2], pts.at(-1)[2]]) { u8(2); u32(Math.round(ms / 1000) - 631065600); }
  const head = [14, 0x20, 0, 0, bytes.length & 255, (bytes.length >> 8) & 255, (bytes.length >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...head, ...bytes, 0, 0]).buffer;
};
const mean = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : 0; };
const trackFiles = () => [...files.keys()].filter((p) => p.includes('Aufgezeichnete Touren/')).sort();
const inFile = (p) => { const [t] = parseGpx(files.get(p).text); return { cad: mean(t.cad), hr: mean(t.hr), marks: t.marks?.length ?? 0, sport: t.sport ?? null, id: /wmap:([\w-]+)/.exec(files.get(p).text)?.[1] ?? null }; };
const N = 401, out = {};
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
be.move = async (a, b2) => { if (files.has(b2)) throw new Error('gibt es schon'); clock += 1000; files.set(b2, { ...files.get(a), modified: clock }); files.delete(a); return clock; };
let reads = [];
const read0 = be.read, bytes0 = be.bytes;
be.read = async (p) => { reads.push(p); return read0(p); };
be.bytes = async (p) => { reads.push(p); return bytes0(p); };
const names = async () => (await tracks.all()).map((t) => t.name).sort();
const gpxOf = (id) => [...files.keys()].find((p) => p.endsWith('.gpx') && files.get(p).text?.includes('wmap:' + id)) ?? null;
const manifest = () => JSON.parse(files.get('Inhalt.json').text);

// ── 0. Alte Ordnung: alles unter „WMap/“ (ein Weg ohne Frequenz von 2025, einer ganz) ──
localStorage.setItem('wmap.tracks.keep', '"30"');
folder._useBackend(be, 'Nextcloud');
const A = { ...buildTrack(mk(3, N, 1, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Meine Ruderrunde', keepAll: true }), id: 'keepA', sport: 'rowing' };
const D = { ...buildTrack(mk(4, N, 1, () => [110, 80, 0]), { kind: 'gpx', profile: 'foot', name: 'Schon ganz da', keepAll: true }), id: 'keepD' };
drop('WMap/Aufgezeichnete Touren/2025/06 Juni/2025-06-03 Meine Ruderrunde.gpx', trackGpx(A));
drop('WMap/Aufgezeichnete Touren/2025/06 Juni/2025-06-04 Schon ganz da.gpx', trackGpx(D));
drop('WMap/Lesezeichen.json', JSON.stringify({ app: 'WMap', places: [], deleted: {} }));
out.lift = await folder.sync();
out.liftFiles = [...files.keys()].sort();
out.liftNames = await names();
out.liftAgain = await folder.sync();
out.stub = !!(await tracks.get('keepA')).stub;

// ── 1./2. Hineingelegt – an falsche Stellen ──
const month = 'Aufgezeichnete Touren/2025/06 Juni/';
drop('Meine Touren xy/garmin.gpx', foreign(mk(5, N, 1, () => [100, 0, 0]), 'Ganz neu'));
drop('Zepp neu.fit', fit(mk(6, N, 1, () => [130, 30, 0]), 23));
drop('Geplante Touren/Unterordner/Zepp alt.fit', fit(mk(3, N, 1, (i) => [120, i % 7 ? 28 : 0, 0]), 23));
drop('Aufgezeichnete Touren/doppelt.gpx', foreign(mk(4, N, 1, () => [110, 80, 0]), 'Kopie'));
drop('Aufgezeichnete Touren/kaputt.fit', new Uint8Array([1, 2, 3, 4]).buffer);
drop('Meine Touren xy/kaputt.gpx', '<gpx><nichts/></gpx>');
drop('Meine Touren xy/leer.gpx', '');
out.found = await folder.sync();
out.inbox = out.found.inbox.map((x) => [x.file, x.kind, x.kind === 'merge' ? x.list.map((c) => c.key + (c.on ? '+' : '-')).join(' ') : '']).sort();
out.foundNames = await names();
out.foundFiles = [...files.keys()].sort();
out.brokenInfo = Object.keys((await folder.info()).broken).sort();
reads = [];
out.parked = await folder.sync();
out.parkedReads = reads.filter((p) => /garmin|Zepp/.test(p)).length;

// ── 3. Entschieden: Datei für Datei ──
const mergePath = out.found.inbox.find((x) => x.file === 'Zepp alt.fit').path;
out.taken = await folder.sync({ decide: { rest: 'later', files: { 'Meine Touren xy/garmin.gpx': 'take', 'Zepp neu.fit': 'take', [mergePath]: { shape: false, cad: true, marks: true } } } });
out.files = [...files.keys()].sort();
out.names = await names();
const all = await tracks.all();
const neu = all.find((t) => t.name === 'Ganz neu'), zepp = all.find((t) => /Zepp neu/.test(t.name));
out.neu = neu && { gpx: gpxOf(neu.id) };
out.zepp = zepp && { gpx: gpxOf(zepp.id), fit: out.files.find((p) => /Zepp neu\.fit$/.test(p)), sport: zepp.sport, cad: mean(zepp.cad), marks: zepp.marks?.length ?? 0 };
out.keepA = { name: (await tracks.get('keepA')).name, ...inFile(gpxOf('keepA')), fit: out.files.find((p) => /Meine Ruderrunde\.fit$/.test(p)) ?? null };

// ── 4. Noch einmal: nichts zu tun ──
reads = [];
out.again = await folder.sync();
out.againReads = reads.filter((p) => /\.(gpx|fit)$/.test(p) && !/leer/.test(p)).length;

// ── 5. FIT-Tour umbenennen → zweites Gerät ──
await new Promise((r) => setTimeout(r, 20));
await tracks.put({ ...(await tracks.get(zepp.id)), name: 'Rudern am Abend', color: '#ae3ec9', updated: clock += 1000 });
out.renamed = await folder.sync();
out.meta = Object.entries(manifest().files).find(([p]) => p.endsWith('.fit') && /Zepp neu/.test(p))?.[1]?.meta ?? null;
const fitBytes = files.get(out.zepp.fit).bytes.byteLength;
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
folder._useBackend(be, 'Nextcloud');
out.second = await folder.sync();
const again = (await tracks.all()).find((t) => t.id === zepp.id);
out.secondTrack = again && { name: again.name, color: again.color, sport: again.sport };
out.secondCount = (await tracks.all()).length;
out.fitSame = files.get(out.zepp.fit)?.bytes.byteLength === fitBytes;

// ── 2. Kaputte Dateien nach 30 Tagen ──
const m = manifest();
out.brokenBefore = Object.keys(m.broken ?? {}).sort();
for (const k of Object.keys(m.broken)) m.broken[k] = Date.now() - 31 * 24 * 3600 * 1000;
files.set('Inhalt.json', { text: JSON.stringify(m), modified: clock += 1000 });
out.old = await folder.sync();
out.brokenAfter = [...files.keys()].filter((p) => p.startsWith('Kaputte Dateien/'));
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
localStorage.removeItem('wmap.tracks.keep');
return out;
"""

UI = r"""
(async () => {
  const done = (v) => { window.__result = JSON.stringify(v); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const { folder } = await import('./js/data/folder.js');
    const { tracks, buildTrack, trackGpx } = await import('./js/data/tracks.js');
    const files = new Map();
    let clock = 1000;
    const be = {
      permission: async () => 'granted',
      list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
      read: async (p) => files.get(p).text,
      write: async (p, text) => { clock += 1000; files.set(p, { text, modified: clock }); return clock; },
      remove: async (p) => { files.delete(p); },
    };
    const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.91 + i * 0.0006, 51.52, Date.UTC(2026, 5, 3, 7, 0, i * 12)]);
    const foreign = trackGpx({ ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Aus der Uhr' }), id: 'x' }).replace(/<keywords>[^<]*<\/keywords>/, '');
    folder.supported = true;
    folder._useBackend(be, 'Nextcloud');
    files.set('Meine Sachen/uhr.gpx', { text: foreign, modified: clock += 1000 });
    files.set('Meine Sachen/murks.gpx', { text: '<gpx><nichts/></gpx>', modified: clock += 1000 });
    const dlg = () => document.querySelector('dialog.confirm[open]');
    const buttons = () => [...dlg().querySelectorAll('.confirm-actions button')].map((x) => x.innerText.replace(/^\S+\s+/, '').trim());
    const press = (re) => [...dlg().querySelectorAll('.confirm-actions button')].find((x) => re.test(x.innerText)).click();
    const names = async () => (await tracks.all()).map((t) => t.name).filter((n) => n === 'Aus der Uhr');
    const out = {};
    await folder.sync();
    await wait(1200);
    out.title = dlg()?.querySelector('.uD-title')?.innerText.replace(/^\S+\s+/, '').trim() ?? null;
    out.buttons = dlg() ? buttons() : null;
    press(/Später/);
    await wait(600);
    out.laterNames = await names();
    out.laterFile = files.has('Meine Sachen/uhr.gpx');
    out.hint = document.querySelector('.folder-inbox')?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    out.broken = document.querySelector('.folder-broken')?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    document.querySelector('.folder-inbox [data-act=inbox]').click();
    await wait(800);
    press(/Einzeln/);
    await wait(800);
    out.each = dlg() ? [dlg().innerText.includes('Aus der Uhr'), buttons()] : null;
    press(/Übernehmen/);
    await wait(1800);
    out.names = await names();
    out.fileGone = !files.has('Meine Sachen/uhr.gpx');
    out.sorted = [...files.keys()].filter((p) => p.endsWith('Aus der Uhr.gpx'));
    out.hintAfter = !!document.querySelector('.folder-inbox');
    for (const t of await tracks.all()) if (t.name === 'Aus der Uhr') await tracks.removeQuiet(t.id);
    sessionStorage.removeItem('wmap.folder.inbox.later');
    await folder.disconnect();
    done(out);
  } catch (e) { done('FEHLER ' + e + ' ' + e.stack); }
})();
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => {" + TEST + "})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));")
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    month = 'Aufgezeichnete Touren/2025/06 Juni/'
    checks = {
        '0. Umzug: nichts mehr unter „WMap/“, zwei Wege einmal, danach Ruhe': not any(p.startswith('WMap/') for p in r['liftFiles']) and month + '2025-06-03 Meine Ruderrunde.gpx' in r['liftFiles'] and 'Lesezeichen.json' in r['liftFiles'] and r['liftNames'] == ['Meine Ruderrunde', 'Schon ganz da'] and r['liftAgain']['imported'] == 0 and r['liftAgain']['written'] == 0 and r['liftAgain']['removed'] == 0 and r['stub'],
        '1. neue Dateien: erst fragen – drei im Eingang, nichts übernommen': r['inbox'] == [['Zepp alt.fit', 'merge', 'shape- cad+ marks+'], ['Zepp neu.fit', 'new', ''], ['garmin.gpx', 'new', '']] and r['foundNames'] == ['Meine Ruderrunde', 'Schon ganz da'] and 'Meine Touren xy/garmin.gpx' in r['foundFiles'],
        '1. Datei ohne Neues geht ohne Frage; wartende werden nicht noch einmal gelesen': 'Aufgezeichnete Touren/doppelt.gpx' not in r['foundFiles'] and r['parkedReads'] == 0 and len(r['parked']['inbox']) == 3,
        '2. kaputte GPX und FIT liegen unter „Kaputte Dateien/“, die leere Datei bleibt': r['brokenInfo'] == ['Kaputte Dateien/kaputt.fit', 'Kaputte Dateien/kaputt.gpx'] and 'Meine Touren xy/leer.gpx' in r['foundFiles'],
        '3. neue GPX: WMap-Datei unter Jahr/Monat, die hineingelegte weg': bool(r['neu']) and (r['neu']['gpx'] or '').startswith(month) and 'Meine Touren xy/garmin.gpx' not in r['files'],
        '3. neue FIT: bleibt FIT unter Jahr/Monat, keine GPX daneben – Rudern mit Frequenz und Runden': bool(r['zepp']) and r['zepp']['gpx'] is None and (r['zepp']['fit'] or '').startswith(month) and r['zepp']['sport'] == 'rowing' and r['zepp']['cad'] == 30 and r['zepp']['marks'] == 1,
        '3. FIT zur vorhandenen Tour: Frequenz und Runden in deren Datei, Strecke bleibt, FIT bleibt daneben': r['keepA']['name'] == 'Meine Ruderrunde' and r['keepA']['cad'] == 28 and r['keepA']['hr'] == 120 and r['keepA']['marks'] == 1 and r['keepA']['id'] == 'keepA' and (r['keepA']['fit'] or '').startswith(month),
        '3. vier Touren, Eingang leer': r['names'] == ['Ganz neu', 'Meine Ruderrunde', 'Schon ganz da', 'Zepp neu'] and r['taken']['inbox'] == [],
        '4. zweiter Abgleich: nichts zu tun, nichts gelesen': r['again']['imported'] == 0 and r['again']['written'] == 0 and r['again']['moved'] == 0 and r['again']['merged'] == 0 and r['againReads'] == 0,
        '5. FIT-Tour umbenannt: Name und Farbe im Verzeichnis, zweites Gerät hat Kennung und Namen, keine Frage': r['meta'] and r['meta']['name'] == 'Rudern am Abend' and r['secondTrack'] == {'name': 'Rudern am Abend', 'color': '#ae3ec9', 'sport': 'rowing'} and r['second']['inbox'] == [] and r['secondCount'] == 4 and r['fitSame'],
        '2. kaputte Dateien nach 30 Tagen gelöscht': len(r['brokenBefore']) == 2 and r['brokenAfter'] == [],
    }

    b.open('sync.html', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", UI)
    u = json.loads(b.wait("return window.__result", 60))
    if not isinstance(u, dict):
        print(u)
        sys.exit(1)
    print(json.dumps(u, ensure_ascii=False, indent=1))
    b.shot('folder-drop')
    checks.update({
        '6. Frage kommt von selbst: genaueste / einzeln / später': u['title'] == 'Neue Datei im Ordner' and u['buttons'] == ['Immer die genauesten Daten', 'Einzeln entscheiden', 'Später'],
        '6. „Später“: nichts übernommen, Datei bleibt, Hinweis mit „Neue Dateien ansehen“': u['laterNames'] == [] and u['laterFile'] and u['hint'] and 'uhr.gpx' in u['hint'] and 'Neue Dateien ansehen' in u['hint'],
        '6. kaputte Datei steht mit Hinweis da': bool(u['broken']) and 'murks.gpx' in u['broken'] and 'Kaputte Dateien' in u['broken'] and '30 Tage' in u['broken'],
        '6. einzeln → „Übernehmen“: Tour da, Datei einsortiert, Hinweis weg': bool(u['each']) and u['each'][0] and u['each'][1][0] == 'Übernehmen' and u['names'] == ['Aus der Uhr'] and u['fileGone'] and len(u['sorted']) == 1 and u['sorted'][0].startswith('Aufgezeichnete Touren/2026/06 Juni/') and not u['hintAfter'],
    })
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(0 if all(checks.values()) else 1)
