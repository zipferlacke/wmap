"""Ordner-Abgleich (data/folder.js) mit einem Ordner im Speicher: neue Ordnung, Umzug aus der alten,
fremde GPX bleiben, Bus & Bahn je Datei, Lesezeichen.json, settings.json von einem anderen Gerät, Löschen."""
import sys
from common import Browser

TEST = r"""
const { folder } = await import('./js/data/folder.js');
// Diese Tests gelten dem Abgleich selbst: alle Wege bleiben ganz in der App (Karteikarten: folder_shelf.py)
localStorage.setItem('wmap.tracks.keep', '"all"');
const { tracks, buildTrack } = await import('./js/data/tracks.js');
const { tours } = await import('./js/data/store.js');
const { connections, places } = await import('./js/data/saved.js');
const files = new Map();                       // Pfad → { text, modified }
let clock = Date.now();
const be = {
  permission: async () => 'granted',
  list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
  read: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).text; },
  write: async (p, text) => { clock += 1000; files.set(p, { text, modified: clock }); return clock; },
  remove: async (p) => { files.delete(p); },
};
folder._useBackend(be, 'Nextcloud');
const out = {};

// Bestand: ein Weg, eine Tour, eine Verbindung, ein Lesezeichen, eine Einstellung
const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.9 + i * 0.0005, 51.53 + Math.sin(i / 5) * 0.0005, Date.UTC(2026, 8, 12, 9, 0, i * 10)]);
const t = { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name: 'Morgenrunde' }), id: 'wtrack1' };
await tracks.putQuiet(t);
tours.put({ id: 'tour1', name: 'Harzrunde', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, updated: Date.now(), stats: {} });
connections.putQuiet({ id: 'conn1', key: 'k1', updated: Date.now(), from: { label: 'Göttingen, Bahnhof' }, to: { label: 'Kassel-Wilhelmshöhe' },
  dep: Date.UTC(2026, 8, 30, 6, 15), arr: Date.UTC(2026, 8, 30, 7, 0), changes: 0, legs: [] });
places.save({ kind: 'fav', name: 'Oma', label: 'Lange Straße 1', point: [9.93, 51.53] });
localStorage.setItem('wmap.theme', '"dark"');
// Alte Ordnung: eigene Datei unter Abgeschlossen/ (derselbe Weg) und ein fremder Garmin-Export
const { trackGpx } = await import('./js/data/tracks.js');
files.set('WMap/Abgeschlossen/2026/2026-09-12 Morgenrunde.gpx', { text: trackGpx(t), modified: 1000 });
files.set('Garmin/lauf.gpx', { text: trackGpx({ ...buildTrack(pts.map(([x, y, ms]) => [x + 0.01, y, ms + 864e5]), { kind: 'gpx', profile: 'foot', name: 'Garmin' }) }).replace(/<keywords>[^<]*<\/keywords>/, ''), modified: 1000 });
files.set('WMap/Gemerkt.json', { text: JSON.stringify({ connections: [], places: [{ id: 'pold', kind: 'work', name: 'Arbeit', point: [9.95, 51.54], updated: 1 }], deleted: {} }), modified: 1000 });

out.first = await folder.sync();
out.paths1 = [...files.keys()].sort();

// Anderes Gerät ändert die Einstellungen
const s = JSON.parse(files.get('WMap/settings.json').text);
files.set('WMap/settings.json', { text: JSON.stringify({ ...s, updated: s.updated + 5000, values: { ...s.values, 'wmap.theme': '"light"' } }), modified: clock += 5000 });
out.second = await folder.sync();
out.theme = localStorage.getItem('wmap.theme');

// Auf dem anderen Gerät gelöscht: die Verbindungsdatei verschwindet
const connPath = [...files.keys()].find((p) => p.startsWith('WMap/Bus & Bahn/'));
files.delete(connPath);
out.third = await folder.sync();
out.connLeft = connections.all().length;

// Hier gelöscht: der Weg → Datei weg
await tracks.remove('wtrack1');
await new Promise((r) => setTimeout(r, 50));
out.fourth = await folder.sync();
out.paths4 = [...files.keys()].sort();
out.places = places.all().map((p) => p.name).sort();
return out;
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script('const done = arguments[0]; (async () => {' + TEST + '})().then(done, (e) => done("FEHLER " + e + "\\n" + e.stack))')
    if isinstance(r, str):
        print(r)
        sys.exit(1)
    print('1. Abgleich:', r['first'])
    for p in r['paths1']:
        print('   ', p)
    print('2. Einstellungen vom anderen Gerät:', r['second'].get('settings'), '→ Theme', r['theme'])
    print('3. Verbindung dort gelöscht:', r['third'], '→ noch', r['connLeft'])
    print('4. Weg hier gelöscht:', r['fourth'])
    for p in r['paths4']:
        print('   ', p)
    print('Lesezeichen:', r['places'])
    ok = ('WMap/Geplante Touren/Harzrunde.gpx' in r['paths1']
          and 'WMap/Aufgezeichnete Touren/2026/09 September/2026-09-12 Morgenrunde.gpx' in r['paths1']
          and 'Garmin/lauf.gpx' in r['paths1'] and 'WMap/Gemerkt.json' not in r['paths1']
          and not any('Abgeschlossen' in p for p in r['paths1'])
          and any(p.startswith('WMap/Bus & Bahn/2026-09-30') for p in r['paths1'])
          and r['theme'] == '"light"' and r['connLeft'] == 0
          and not any('Morgenrunde' in p for p in r['paths4'])
          and r['places'] == ['Arbeit', 'Oma'])
    print('stimmt' if ok else 'STIMMT NICHT')
    sys.exit(b.report() or (0 if ok else 1))
