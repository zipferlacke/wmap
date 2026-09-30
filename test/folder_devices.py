"""Ordner-Abgleich mit mehreren Geräten (data/folder.js), Ordner im Speicher:
1. Auf einem anderen Gerät gelöscht (Gelöscht.json) – hier wird gelöscht, nicht zurückgeschrieben, auch wenn dieses
   Gerät den Ordner nicht mehr kennt (Index weg, z. B. neu verbunden).
2. Neue App: derselbe Weg schon aus Health Connect geholt, im Ordner noch mit der ID der alten App – bleibt einmal,
   mit der ID aus dem Ordner und der Health-Connect-Kennung.
3. Hier gelöscht: steht in Gelöscht.json; Health Connect holt ihn nicht wieder (healthGone).
4. Gelöscht und wieder eingespielt (ZIP): gilt wieder, die Datei kommt zurück.
5. Datei einmal nicht lesbar: bleibt bekannt – dort gelöscht heißt dann hier auch gelöscht."""
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
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    if not all(checks.values()):
        sys.exit(1)
    sys.exit(b.report())
