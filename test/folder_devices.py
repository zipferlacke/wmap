"""Ordner-Abgleich mit mehreren Geräten (data/folder.js), Ordner im Speicher:
1. Auf einem anderen Gerät gelöscht (Gelöscht.json) – hier wird gelöscht, nicht zurückgeschrieben, auch wenn dieses
   Gerät den Ordner nicht mehr kennt (Index weg, z. B. neu verbunden).
2. Neue App: derselbe Weg schon aus Health Connect geholt, im Ordner noch mit der ID der alten App – bleibt einmal,
   mit der ID aus dem Ordner und der Health-Connect-Kennung.
3. Hier gelöscht: steht in Gelöscht.json; Health Connect holt ihn nicht wieder (healthGone).
4. Gelöscht und wieder eingespielt (ZIP): gilt wieder, die Datei kommt zurück.
5. Datei einmal nicht lesbar: bleibt bekannt – dort gelöscht heißt dann hier auch gelöscht.
6. Kartenausschnitt über den Ordner (Kartenausschnitt.json): schreiben, nicht zu oft, lesen.
7. Verzeichnis (Inhalt.json): ein Ordner ohne Änderungszeiten wird beim zweiten Abgleich nicht noch einmal gelesen.
8. Ordner neu verbunden (Index weg), Einträge noch da: laut Verzeichnis gleich – keine Datei wird gelesen.
9. Die Ordnung gilt: von Hand hineingelegt (unter „Aufgezeichnete Touren/“) kommt dazu, irgendwo abgelegt nicht.
10. Von Hand im Ordner gelöscht: der Eintrag verschwindet hier, das Verzeichnis nennt die Datei nicht mehr."""
import json
import sys
from common import Browser

TEST = r"""
const { folder } = await import('./js/data/folder.js');
const { tracks, buildTrack, trackGpx, healthGone } = await import('./js/data/tracks.js');
const { tours, toGpx } = await import('./js/data/store.js');
const { knownHealthIds } = await import('./js/services/health.js');
const files = new Map();
let clock = Date.now(), broken = null;
const be = {
  permission: async () => 'granted',
  list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
  read: async (p) => { if (p === broken) throw new Error('hakt'); if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).text; },
  write: async (p, text) => { clock += 1000; files.set(p, { text, modified: clock }); return clock; },
  remove: async (p) => { files.delete(p); },
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const tourFiles = () => [...files.keys()].filter((p) => p.includes('Geplante Touren/')).sort();
const trackFiles = () => [...files.keys()].filter((p) => p.includes('Aufgezeichnete Touren/')).sort();

// ── 1. Anderswo gelöscht, hier Index weg ──
folder._useBackend(be, 'Nextcloud');
tours.put({ id: 'tourA', name: 'Harzrunde', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, updated: Date.now(), stats: {} });
tours.put({ id: 'tourB', name: 'Leinerunde', profile: 'hike', points: [[9.9, 51.5], [9.95, 51.52]], shape: 'abc', fixed: true, updated: Date.now(), stats: {} });
await wait(50);
await folder.sync();
out.before = tourFiles();
// Das andere Gerät löscht Harzrunde: Datei weg, Eintrag in Gelöscht.json
files.delete(tourFiles().find((p) => p.includes('Harzrunde')));
files.set('WMap/Gelöscht.json', { text: JSON.stringify({ app: 'WMap', deleted: { tourA: Date.now() } }), modified: clock += 1000 });
folder._useBackend(be, 'Nextcloud');          // hier: Index weg (neu verbunden)
out.one = await folder.sync();
out.oneTours = tours.all().map((t) => t.name).sort();
out.oneFiles = tourFiles();

// ── 2. Neue App: Health Connect war schneller als der Ordner ──
const pts = []; for (let i = 0; i < 80; i += 1) pts.push([9.9 + i * 0.0005, 51.53 + Math.sin(i / 5) * 0.0005, Date.UTC(2026, 8, 20, 7, 0, i * 10)]);
const old = { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name: 'Lauf (alte App)' }), id: 'old1' };
files.set('WMap/Aufgezeichnete Touren/2026/09 September/2026-09-20 Lauf.gpx', { text: trackGpx(old), modified: clock += 1000 });
await tracks.putQuiet({ ...buildTrack(pts, { kind: 'health', profile: 'foot', name: 'Lauf am Sonntagmorgen' }), id: 'hc1', source: { health: 'S1', app: 'com.fitbit', type: 'running' } });
out.two = await folder.sync();
const all2 = await tracks.all();
out.twoTracks = all2.map((t) => [t.id, t.source?.health ?? null]);
out.twoFiles = trackFiles();
out.twoKeywords = files.get(trackFiles()[0]).text.match(/<keywords>([^<]*)</)?.[1];

// ── 3. Hier gelöscht ──
await tracks.remove('old1');
await wait(50);
out.three = await folder.sync();
out.threeGone = Object.keys(JSON.parse(files.get('WMap/Gelöscht.json').text).deleted).sort();
out.threeFiles = trackFiles();
out.threeHealthKnown = (await knownHealthIds()).has('S1');

// ── 4. Gelöscht, dann aus der Sicherung wieder da ──
tours.remove('tourB');
await wait(50);
await folder.sync();
tours.save({ id: 'tourB', name: 'Leinerunde', profile: 'hike', points: [[9.9, 51.5], [9.95, 51.52]], shape: 'abc', fixed: true, stats: {} });  // wie restore()
await wait(50);
out.four = await folder.sync();
out.fourTours = tours.all().map((t) => t.name).sort();
out.fourFiles = tourFiles();
out.fourGone = Object.keys(JSON.parse(files.get('WMap/Gelöscht.json').text).deleted).sort();

// ── 5. Datei einmal nicht lesbar, dann dort gelöscht ──
tours.put({ id: 'tourC', name: 'Werrarunde', profile: 'hike', points: [[9.8, 51.3], [9.85, 51.32]], shape: 'xyz', fixed: true, updated: Date.now(), stats: {} });
await wait(50);
await folder.sync();
const cPath = tourFiles().find((p) => p.includes('Werrarunde'));
files.set(cPath, { ...files.get(cPath), modified: clock += 1000 });   // geändert gemeldet …
broken = cPath;                                                       // … aber nicht lesbar
await folder.sync();
broken = null;
files.delete(cPath);                                                  // dort gelöscht (ohne Gelöscht.json, ältere App)
out.five = await folder.sync();
out.fiveTours = tours.all().map((t) => t.name).sort();
out.fiveFiles = tourFiles();

// ── 6. Kartenausschnitt über den Ordner ──
const view = { center: [9.93, 51.53], zoom: 14.2, pitch: 0, bearing: 0, at: Date.now() };
out.sixFirst = await folder.writeView(view, { now: true });
out.sixThrottled = await folder.writeView({ ...view, zoom: 15, at: Date.now() });          // gleich danach: nicht schon wieder
out.sixRead = (await folder.readView())?.zoom;
out.sixIgnored = (await folder.sync(), [...files.keys()].some((p) => p.endsWith('Kartenausschnitt.json')));

// ── 7. Verzeichnis: Ordner ohne Änderungszeiten ──
// (wie manche Cloud-Ordner unter Android) – gezählt wird, welche Touren und Wege gelesen werden
let reads = [];
const noTime = {
  ...be,
  list: async () => [...files].map(([path]) => ({ path, lastModified: 0 })),
  read: async (p) => { if (/\.gpx$/.test(p)) reads.push(p); return be.read(p); },
  write: async (p, text) => { await be.write(p, text); return 0; },
};
const mk = (k, name) => ({ ...buildTrack(pts.map(([x, y, ms]) => [x + k * 0.02, y, ms + k * 864e5]), { kind: 'rec', profile: 'foot', name }), id: `m${k}` });
for (let k = 1; k <= 3; k += 1) await tracks.putQuiet(mk(k, `Verzeichnis ${k}`));
folder._useBackend(noTime, 'Nextcloud');
await folder.sync();                               // erster Abgleich mit diesem Ordner: liest, was da ist, schreibt die drei
reads = [];
out.sevenSecond = await folder.sync();
out.sevenReads = reads.length;
const manifest = () => JSON.parse(files.get('WMap/Inhalt.json').text).files;
out.sevenListed = Object.values(manifest()).filter((v) => /^m\d$/.test(v.id)).length;

// ── 8. Neu verbunden: Index weg, Einträge da ──
folder._useBackend(noTime, 'Nextcloud');
reads = [];
out.eight = await folder.sync();
out.eightReads = reads.length;
out.eightCount = (await tracks.all()).filter((t) => /^m\d$/.test(t.id)).length;

// ── 9. Von Hand hineingelegt – in die Ordnung und irgendwohin ──
const hand = trackGpx(mk(7, 'Von Hand')).replace(/<keywords>[^<]*<\/keywords>/, '');
files.set('WMap/Aufgezeichnete Touren/2026/09 September/Von Hand.gpx', { text: hand, modified: 0 });
files.set('WMap/Sonstiges/Irgendwo.gpx', { text: trackGpx(mk(8, 'Irgendwo')).replace(/<keywords>[^<]*<\/keywords>/, ''), modified: 0 });
reads = [];
out.nine = await folder.sync();
out.nineReads = reads.map((p) => p.split('/').pop());
out.nineNames = (await tracks.all()).map((t) => t.name).filter((n) => /Von Hand|Irgendwo/.test(n));
out.nineListed = Object.keys(manifest()).some((p) => p.endsWith('Von Hand.gpx'));

// ── 10. Von Hand gelöscht ──
const gonePath = [...files.keys()].find((p) => p.includes('Verzeichnis 2'));
files.delete(gonePath);
out.ten = await folder.sync();
out.tenNames = (await tracks.all()).map((t) => t.name).filter((n) => /Verzeichnis/.test(n)).sort();
out.tenListed = Object.keys(manifest()).some((p) => p.includes('Verzeichnis 2'));
out.tenFiles = [...files.keys()].some((p) => p.includes('Verzeichnis 2'));
return out;
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => {" + TEST + "})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));")
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    checks = {
        '1. anderswo gelöscht → hier weg, nicht zurück': r['oneTours'] == ['Leinerunde'] and not any('Harzrunde' in p for p in r['oneFiles']),
        '2. Health Connect + alte App → einmal, ID aus dem Ordner': r['twoTracks'] == [['old1', 'S1']] and len(r['twoFiles']) == 1 and 'wmap:old1' in r['twoKeywords'] and 'wmap-hc:S1' in r['twoKeywords'],
        '3. hier gelöscht → Gelöscht.json, Health Connect holt ihn nicht wieder': 'old1' in r['threeGone'] and r['threeFiles'] == [] and r['threeHealthKnown'],
        '4. wieder eingespielt → gilt wieder': 'Leinerunde' in r['fourTours'] and any('Leinerunde' in p for p in r['fourFiles']) and 'tourB' not in r['fourGone'],
        '5. einmal nicht lesbar, dann dort gelöscht → hier weg': 'Werrarunde' not in r['fiveTours'] and not any('Werrarunde' in p for p in r['fiveFiles']),
        '6. Kartenausschnitt: schreiben, nicht zu oft, lesen, Abgleich lässt ihn stehen': r['sixFirst'] and not r['sixThrottled'] and r['sixRead'] == 14.2 and r['sixIgnored'],
        '7. Verzeichnis: ohne Änderungszeiten wird beim zweiten Abgleich nichts gelesen': r['sevenReads'] == 0 and r['sevenListed'] == 3 and r['sevenSecond']['imported'] == 0 and r['sevenSecond']['written'] == 0,
        '8. neu verbunden, Einträge da: laut Verzeichnis gleich – nichts gelesen, nichts doppelt': r['eightReads'] == 0 and r['eightCount'] == 3 and r['eight']['imported'] == 0 and r['eight']['written'] == 0,
        '9. von Hand in die Ordnung gelegt kommt dazu (nur sie wird gelesen), irgendwo abgelegt nicht': r['nineReads'] == ['Von Hand.gpx'] and r['nineNames'] == ['Von Hand'] and r['nineListed'],
        '10. von Hand gelöscht → Eintrag weg, nicht mehr im Verzeichnis, nicht zurückgeschrieben': r['tenNames'] == ['Verzeichnis 1', 'Verzeichnis 3'] and not r['tenListed'] and not r['tenFiles'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    if not all(checks.values()):
        sys.exit(1)
    sys.exit(b.report())
