"""Aufzeichnung von Hand in den Ordner gelegt (js/data/folder.js adopt): GPX und FIT unter „Aufgezeichnete Touren/“
1. Neue GPX-Datei: wird ein Weg, liegt danach als WMap-Datei unter Jahr/Monat, die hineingelegte ist weg.
2. Neue FIT-Datei: ebenso – mit Sportart, Frequenz und den Runden der Uhr.
3. FIT zu einem Weg, den es schon gibt (ohne Frequenz): Frequenz und Runden kommen dazu, seine Datei wird neu
   geschrieben, Name und Kennung bleiben, die FIT-Datei ist weg – auch wenn der Weg nur als Karteikarte da ist.
4. Datei ohne Neues: nur weg. Zweiter Abgleich: nichts mehr zu tun.
5. FIT außerhalb von „Aufgezeichnete Touren/“ und kaputte FIT-Datei: bleiben liegen."""
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

// Vorhanden: ein Weg ohne Frequenz (2025 – älter als 30 Tage, wird beim Abgleich zur Karteikarte) und einer ganz
localStorage.setItem('wmap.tracks.keep', '"30"');
folder._useBackend(be, 'WMap');
await tracks.putQuiet({ ...buildTrack(mk(3, N, 1, () => [120, 0, 0]), { kind: 'health', profile: 'foot', name: 'Meine Ruderrunde', keepAll: true }), id: 'keepA', sport: 'rowing' });
await tracks.putQuiet({ ...buildTrack(mk(4, N, 1, () => [110, 80, 0]), { kind: 'gpx', profile: 'foot', name: 'Schon ganz da', keepAll: true }), id: 'keepD' });
out.first = await folder.sync();
out.stub = !!(await tracks.get('keepA')).stub;
out.filesBefore = trackFiles();

// Hineingelegt
drop('Aufgezeichnete Touren/garmin.gpx', foreign(mk(5, N, 1, () => [100, 0, 0]), 'Ganz neu'));
drop('Aufgezeichnete Touren/Zepp neu.fit', fit(mk(6, N, 1, () => [130, 30, 0]), 23));
drop('Aufgezeichnete Touren/Unterordner/Zepp alt.fit', fit(mk(3, N, 1, (i) => [120, i % 7 ? 28 : 0, 0]), 23));
drop('Aufgezeichnete Touren/doppelt.gpx', foreign(mk(4, N, 1, () => [110, 80, 0]), 'Kopie'));
drop('Aufgezeichnete Touren/kaputt.fit', new Uint8Array([1, 2, 3, 4]).buffer);
drop('Woanders/lose.fit', fit(mk(7, N, 1, () => [130, 30, 0]), 23));
out.sync = await folder.sync();
out.files = trackFiles();
const all = await tracks.all();
out.names = all.map((t) => t.name).sort();
const fileOf = (id) => trackFiles().find((p) => p.endsWith('.gpx') && files.get(p).text.includes('wmap:' + id));
const neu = all.find((t) => t.name === 'Ganz neu'), zepp = all.find((t) => /Zepp neu/.test(t.name));
out.neu = neu && { path: fileOf(neu.id) };
out.zepp = zepp && { path: fileOf(zepp.id), ...inFile(fileOf(zepp.id)) };
out.keepA = { name: (await tracks.get('keepA')).name, path: fileOf('keepA'), ...inFile(fileOf('keepA')) };
out.loose = files.has('Woanders/lose.fit');
out.again = await folder.sync();
out.filesAgain = trackFiles();
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
localStorage.removeItem('wmap.tracks.keep');
return out;
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => {" + TEST + "})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));")
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    month = 'Aufgezeichnete Touren/2025/06 Juni/'
    gpx = [p for p in r['files'] if p.endswith('.gpx')]
    checks = {
        '0. Ausgangslage: zwei Dateien, der alte Weg ist eine Karteikarte': len(r['filesBefore']) == 2 and r['stub'],
        '1. neue GPX-Datei: Weg da, als WMap-Datei unter Jahr/Monat, die hineingelegte weg': bool(r['neu']) and r['neu']['path'].startswith(month) and 'Aufgezeichnete Touren/garmin.gpx' not in r['files'],
        '2. neue FIT-Datei: Weg mit Sportart, Frequenz, Runden – als GPX unter Jahr/Monat': bool(r['zepp']) and r['zepp']['path'].startswith(month) and r['zepp']['sport'] == 'rowing' and r['zepp']['cad'] == 30 and r['zepp']['marks'] == 1,
        '3. FIT zu vorhandenem Weg (Karteikarte): Frequenz und Runden in seiner Datei, Name und Kennung bleiben': r['keepA']['name'] == 'Meine Ruderrunde' and r['keepA']['cad'] == 28 and r['keepA']['hr'] == 120 and r['keepA']['marks'] == 1 and r['keepA']['id'] == 'keepA',
        '4. Datei ohne Neues: nur weg; es bleiben vier Wege in vier Dateien': r['names'] == ['Ganz neu', 'Meine Ruderrunde', 'Schon ganz da', 'Zepp neu'] and len(gpx) == 4 and all(p.startswith(month) for p in gpx),
        '4. keine FIT-Datei mehr außer der kaputten': [p for p in r['files'] if p.endswith('.fit')] == ['Aufgezeichnete Touren/kaputt.fit'],
        '4. zweiter Abgleich: nichts mehr zu tun': r['again']['imported'] == 0 and r['again']['written'] == 0 and r['again']['moved'] == 0 and r['again']['merged'] == 0 and r['filesAgain'] == r['files'],
        '5. FIT außerhalb der Ordnung bleibt liegen': r['loose'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(0 if all(checks.values()) else 1)
