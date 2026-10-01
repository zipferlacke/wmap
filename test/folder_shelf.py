"""In der App oder nur im Ordner (data/folder.js shelve, tracks.js stubOf/full), Ordner im Speicher:
1. Ältere Wege werden nach dem Abgleich zur Karteikarte (ohne Punkte-Zeiten und Messwerte, grober Verlauf);
   die der letzten 30 Tage und „offline verfügbar“ markierte bleiben ganz.
2. tracks.full holt den ganzen Weg aus dem Ordner – mit allen Punkten und dem Puls.
3. Zweiter Abgleich: nichts gelesen, nichts geschrieben.
4. Karteikarte umbenannt und gefärbt: Die Datei behält alle Punkte und den Puls, bekommt Name und Farbe.
5. Datei auf einem anderen Gerät geändert: kommt hier an, bleibt Karteikarte.
6. „Offline verfügbar“ gesetzt: der Weg ist nach dem Abgleich wieder ganz da; Einstellung „alle“: alle ganz.
7. Datei einer Karteikarte von Hand gelöscht: der Eintrag verschwindet.
8. Sicherung (backup) enthält die ganzen Wege.
9. Ordner trennen: alles kommt zurück in die App.
10. Datei aus einer älteren WMap (ohne <wmap:track>): wird neu geschrieben, dann erst ausgelagert – nichts geht verloren.
11. Neues Gerät verbindet den Ordner: Ältere sind gleich Karteikarten, nichts wird zurückgeschrieben."""
import json
import sys
from common import Browser

TEST = r"""
const { folder } = await import('./js/data/folder.js');
const { tracks, buildTrack, trackGpx, trackCoords, backup, hasValues } = await import('./js/data/tracks.js');
localStorage.setItem('wmap.tracks.keep', '"30"');
const files = new Map();
let clock = Date.now(), reads = [], writes = [];
const be = {
  permission: async () => 'granted',
  list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
  read: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); if (/\.gpx$/.test(p)) reads.push(p); return files.get(p).text; },
  write: async (p, text) => { clock += 1000; if (/\.gpx$/.test(p)) writes.push(p); files.set(p, { text, modified: clock }); return clock; },
  remove: async (p) => { files.delete(p); },
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5;
const mk = (id, name, daysAgo, extra = {}) => {
  const t0 = Date.now() - daysAgo * DAY;
  const pts = []; for (let i = 0; i < 200; i += 1) pts.push([9.9 + i * 0.0004 + Math.sin(i / 3) * 0.0003, 51.53 + Math.sin(i / 7) * 0.002, t0 + i * 20000, 100 + (i % 40)]);
  return { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name }), id, ...extra };
};
const out = {};
const info = async (id) => { const t = await tracks.get(id); return t ? { stub: !!t.stub, times: t.times?.length ?? 0, pts: trackCoords(t).length, hr: !!t.hr, has: t.has ?? null, name: t.name, color: t.color ?? null } : null; };
const fileOf = (name) => [...files.keys()].find((p) => p.includes(name));
const ptsIn = (name) => (files.get(fileOf(name)).text.match(/<trkpt/g) ?? []).length;

// ── 1. Auslagern ──
folder._useBackend(be, 'Nextcloud');
const old = mk('old1', 'Alter Weg', 100), fresh = mk('new1', 'Neuer Weg', 5), pinned = mk('pin1', 'Wichtiger Weg', 200, { pin: true });
for (const t of [old, fresh, pinned]) await tracks.putQuiet(t);
out.one = await folder.sync();
out.oneOld = await info('old1'); out.oneNew = await info('new1'); out.onePin = await info('pin1');
out.oneFiles = [...files.keys()].filter((p) => p.endsWith('.gpx')).length;
out.onePoints = [trackCoords(old).length, ptsIn('Alter Weg')];
out.oneHasValues = hasValues(await tracks.get('old1'));

// ── 2. Ganz holen ──
const full = await tracks.full('old1');
out.two = { times: full.times.length, hr: full.hr.filter((v) => v > 0).length, length: full.length, sameShape: full.shape === old.shape, stub: !!full.stub, hrOrig: old.hr.filter((v) => v > 0).length, lengthOrig: old.length };

// ── 3. Zweiter Abgleich ──
reads = []; writes = [];
out.three = await folder.sync();
out.threeIo = [reads.length, writes.length];
out.threeOld = await info('old1');

// ── 4. Karteikarte geändert ──
const card = await tracks.get('old1');
await tracks.put({ ...card, name: 'Alter Weg umbenannt', color: '#ae3ec9', updated: Date.now() });
await wait(50);
out.four = await folder.sync();
const text4 = files.get(fileOf('Alter Weg')).text;       // der Dateiname bleibt, der Name steht in der Datei
out.fourFile = { pts: ptsIn('Alter Weg'), hr: /gpxtpx:hr/.test(text4), color: /color="#ae3ec9"/.test(text4), name: /<name>Alter Weg umbenannt</.test(text4),
  count: [...files.keys()].filter((p) => p.includes('Alter Weg')).length };
out.fourOld = await info('old1');
const full4 = await tracks.full('old1');
out.fourFull = { name: full4.name, color: full4.color, times: full4.times.length, hr: full4.hr.filter((v) => v > 0).length };
out.fourAgain = await folder.sync();

// ── 5. Anderswo geändert ──
const p5 = fileOf('Alter Weg');
files.set(p5, { text: files.get(p5).text.replaceAll('Alter Weg umbenannt', 'Vom anderen Gerät'), modified: clock += 5000 });
out.five = await folder.sync();
out.fiveOld = await info('old1');

// ── 6. Offline verfügbar, dann „alle“ ──
await tracks.putQuiet({ ...(await tracks.get('old1')), pin: true });
out.six = await folder.sync();
out.sixOld = await info('old1');
await tracks.putQuiet({ ...(await tracks.get('old1')), pin: false });
out.sixBack = (await folder.sync(), await info('old1'));
folder.keep = 'all';
out.sixAll = (await folder.sync(), await info('old1'));
folder.keep = '30';
await folder.sync();

// ── 8. Sicherung ──
const saved = JSON.parse(await backup());
out.eight = saved.tracks.map((t) => [t.id, t.times?.length ?? 0, !!t.stub]).sort();

// ── 7. Datei der Karteikarte gelöscht ──
const extra = mk('gone1', 'Zum Löschen', 150);
await tracks.putQuiet(extra);
await folder.sync();
out.sevenStub = (await info('gone1')).stub;
files.delete(fileOf('Zum Löschen'));
out.seven = await folder.sync();
out.sevenGone = await info('gone1');

// ── 9. Trennen ──
out.nineBefore = (await info('old1')).stub;
await folder.disconnect();
out.nine = await info('old1');

// ── 10. Datei aus einer älteren WMap ──
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
files.clear();
const legacy = mk('leg1', 'Aus alter App', 300);
const legacyText = trackGpx(legacy).replace(/<extensions><wmap:track[^>]*\/><\/extensions>/, '');
files.set('WMap/Aufgezeichnete Touren/2025/12 Dezember/Aus alter App.gpx', { text: legacyText, modified: clock += 1000 });
// hier frisch aus Health Connect geholt (eigene Kennung, volle Länge) – dieselbe Aufzeichnung
await tracks.putQuiet({ ...legacy, id: 'hc10', kind: 'health', source: { health: 'L1', app: 'com.zepp', type: 'rowing' } });
folder._useBackend(be, 'Nextcloud');
out.ten = await folder.sync();
out.tenAgain = await folder.sync();
out.tenCard = await info('leg1');
const full10 = await tracks.full('leg1');
out.tenFull = { length: full10.length, lengthOrig: legacy.length, type: full10.source?.type, kind: full10.kind, times: full10.times.length };
out.tenIds = (await tracks.all()).map((t) => t.id);
out.tenFile = /<wmap:track/.test(files.get(fileOf('Aus alter App')).text);

// ── 11. Neues Gerät ──
for (const t of await tracks.all()) await tracks.removeQuiet(t.id);
localStorage.removeItem('wmap.health.gone');
files.set('WMap/Aufgezeichnete Touren/Neu.gpx', { text: trackGpx(mk('new2', 'Ganz neu', 2)), modified: clock += 1000 });
folder._useBackend(be, 'Nextcloud');
writes = [];
out.eleven = await folder.sync();
out.elevenWrites = writes.length;
out.elevenTracks = (await tracks.all()).map((t) => [t.id, !!t.stub]).sort();
return out;
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => {" + TEST + "})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));")
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    full = lambda x: x and not x['stub'] and x['times'] > 0
    card = lambda x: x and x['stub'] and x['times'] == 0 and x['pts'] <= 60
    checks = {
        '1. älterer Weg → Karteikarte (grober Verlauf, weiß von Puls); neuer und „offline verfügbar“ bleiben ganz': card(r['oneOld']) and r['oneOld']['has'] == ['hr'] and r['oneHasValues'] and full(r['oneNew']) and full(r['onePin']) and r['one']['shelved'] == 1 and r['oneFiles'] == 3,
        '1. die Datei im Ordner hat alle Punkte': r['onePoints'][0] == r['onePoints'][1] and r['onePoints'][0] > 60,
        '2. tracks.full: alle Punkte, Puls und Länge wie vorher': r['two']['times'] == r['onePoints'][0] and r['two']['hr'] == r['two']['hrOrig'] and r['two']['length'] == r['two']['lengthOrig'] and r['two']['sameShape'] and not r['two']['stub'],
        '3. zweiter Abgleich: nichts gelesen, nichts geschrieben, bleibt Karteikarte': r['threeIo'] == [0, 0] and card(r['threeOld']) and r['three']['shelved'] == 0,
        '4. Karteikarte geändert → Datei mit allen Punkten, Puls, neuem Namen und Farbe; eine Datei': r['fourFile'] == {'pts': r['onePoints'][0], 'hr': True, 'color': True, 'name': True, 'count': 1} and card(r['fourOld']) and r['fourOld']['name'] == 'Alter Weg umbenannt',
        '4. ganz geholt: neuer Name, Farbe, alle Punkte; danach Ruhe': r['fourFull']['name'] == 'Alter Weg umbenannt' and r['fourFull']['color'] == '#ae3ec9' and r['fourFull']['times'] == r['onePoints'][0] and r['fourFull']['hr'] > 0 and r['fourAgain']['written'] == 0,
        '5. anderswo geändert → kommt an, bleibt Karteikarte': card(r['fiveOld']) and r['fiveOld']['name'] == 'Vom anderen Gerät',
        '6. offline verfügbar → wieder ganz; zurückgenommen → Karteikarte; Einstellung „alle“ → ganz': full(r['sixOld']) and r['six']['filled'] == 1 and card(r['sixBack']) and full(r['sixAll']),
        '7. Datei der Karteikarte gelöscht → Eintrag weg': r['sevenStub'] and r['sevenGone'] is None and r['seven']['removed'] == 1,
        '8. Sicherung enthält ganze Wege': all(n > 0 and not s for _, n, s in r['eight']) and len(r['eight']) == 3,
        '9. Trennen holt alles zurück': r['nineBefore'] and full(r['nine']),
        '10. Datei einer älteren WMap → neu geschrieben, dann Karteikarte; ganz geholt: Länge und Art wie vorher': card(r['tenCard']) and r['tenFile'] and r['tenFull']['length'] == r['tenFull']['lengthOrig'] and r['tenFull']['type'] == 'rowing' and r['tenFull']['kind'] == 'health' and r['tenAgain']['written'] == 0 and r['tenIds'] == ['leg1'],
        '11. neues Gerät: Ältere gleich Karteikarte, Neues ganz, nichts zurückgeschrieben': r['elevenTracks'] == [['leg1', True], ['new2', False]] and r['elevenWrites'] == r['eleven']['moved'] == 1,
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    if not all(checks.values()):
        sys.exit(1)
    sys.exit(b.report())
