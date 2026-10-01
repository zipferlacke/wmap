"""Speicher voll (data/tracks.js makeRoom) – nachgestellt: das Speichern eines Wegs scheitert einmal mit
QuotaExceededError.
1. Ohne Ordner: die fünf ältesten Wege weichen (der als „offline verfügbar“ markierte nicht), der neue ist gespeichert,
   eine Meldung sagt Bescheid; ein gelöschter Weg aus Health Connect kommt von dort nicht wieder.
   Ohne vollen Speicher wird nie etwas nach Zeit gelöscht – auch ein Weg von vor 20 Jahren bleibt.
2. Mit verbundenem Ordner (Einstellung „alles in der App“): gelöscht wird nichts – die ältesten Wege werden zur
   Karteikarte, ihre Dateien bleiben im Ordner, der nächste Abgleich löscht und schreibt nichts."""
import json
import sys
from common import Browser

TEST = r"""
const { folder } = await import('./js/data/folder.js');
const { tracks, buildTrack, healthGone } = await import('./js/data/tracks.js');
const DAY = 864e5;
const mk = (id, name, daysAgo, extra = {}) => {
  const t0 = Date.now() - daysAgo * DAY;
  const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.9 + i * 0.0004, 51.53 + Math.sin(i / 7) * 0.002, t0 + i * 20000, 100 + (i % 40)]);
  return { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name }), id, ...extra };
};
// Das nächste Speichern eines Wegs scheitert `n`-mal wie bei vollem Speicher
const put = IDBObjectStore.prototype.put;
let fail = 0;
IDBObjectStore.prototype.put = function (...a) {
  if (this.name === 'tracks' && fail > 0) { fail -= 1; throw new DOMException('Speicher voll', 'QuotaExceededError'); }
  return put.apply(this, a);
};
const ids = async () => (await tracks.all()).map((t) => t.id).reverse();
const out = {};

// ── 1. Ohne Ordner ──
await tracks.putQuiet(mk('p0', 'Uralt, offline verfügbar', 7300, { pin: true }));
for (let i = 1; i <= 8; i += 1) await tracks.putQuiet(mk(`a${i}`, `Weg ${i}`, 400 - i * 10, i === 2 ? { kind: 'health', source: { health: 'HC2' } } : {}));
out.before = await ids();
fail = 1;
await tracks.put(mk('neu', 'Heute', 0));
out.after = await ids();
await new Promise((r) => setTimeout(r, 400));
out.toast = document.getElementById('toast')?.textContent ?? null;
out.gone = healthGone.all().has('HC2');
// Ein anderer Fehler als „voll“ löscht nichts
IDBObjectStore.prototype.put = function (...a) { if (this.name === 'tracks' && fail > 0) { fail -= 1; throw new DOMException('kaputt', 'DataError'); } return put.apply(this, a); };
fail = 1;
out.other = await tracks.put(mk('x', 'Geht nicht', 0)).then(() => 'gespeichert', (e) => e.name);
out.afterOther = (await ids()).length;

// ── 2. Mit Ordner ──
localStorage.setItem('wmap.tracks.keep', '"all"');
const files = new Map();
let clock = Date.now(), writes = 0, removes = 0;
folder._useBackend({
  permission: async () => 'granted',
  list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
  read: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).text; },
  write: async (p, text) => { clock += 1000; if (/\.gpx$/.test(p)) writes += 1; files.set(p, { text, modified: clock }); return clock; },
  remove: async (p) => { removes += 1; files.delete(p); },
}, 'Nextcloud');
await folder.sync();
const gpx = () => [...files.keys()].filter((p) => p.endsWith('.gpx')).length;
out.files = gpx();
IDBObjectStore.prototype.put = function (...a) {
  if (this.name === 'tracks' && fail > 0) { fail -= 1; throw new DOMException('Speicher voll', 'QuotaExceededError'); }
  return put.apply(this, a);
};
fail = 1;
await tracks.put(mk('neu2', 'Noch einer', 1));
await new Promise((r) => setTimeout(r, 400));
const all = await tracks.all();
out.cards = all.filter((t) => t.stub).map((t) => t.id).reverse();
out.count = all.length;
out.toast2 = document.getElementById('toast')?.textContent ?? null;
writes = 0; removes = 0;
await new Promise((r) => setTimeout(r, 300));
const r = await folder.sync();
out.sync = { files: gpx(), writes, removes, count: (await tracks.all()).length, removed: r?.removed ?? 0 };
IDBObjectStore.prototype.put = put;
return out;
"""

with Browser() as b:
    b.open('wege.html', wait=3)
    r = b.d.execute_async_script(f"const done = arguments[arguments.length - 1]; (async () => {{ {TEST} }})().then(done, (e) => done('FEHLER ' + (e?.stack ?? e)));")
    print(json.dumps(r, ensure_ascii=False, indent=1) if isinstance(r, dict) else r)
    if not isinstance(r, dict):
        sys.exit(1)
    checks = {
        '1. vorher: der uralte markierte und acht Wege': r['before'] == ['p0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
        '1. die fünf ältesten weichen, der markierte und der neue bleiben': r['after'] == ['p0', 'a6', 'a7', 'a8', 'neu'],
        '1. Meldung': bool(r['toast']) and '5 ältesten Touren' in r['toast'],
        '1. der gelöschte aus Health Connect kommt nicht wieder': r['gone'] is True,
        '1. anderer Fehler: nichts gelöscht, Fehler kommt an': r['other'] == 'DataError' and r['afterOther'] == 5,
        '2. Ordner hat alle fünf Dateien': r['files'] == 5,
        '2. voll: die ältesten ohne Markierung werden Karteikarten, keiner fehlt': r['cards'] == ['a6', 'a7', 'a8', 'neu'] and r['count'] == 6,
        '2. Meldung': bool(r['toast2']) and 'nur noch im Ordner' in r['toast2'],
        '2. nächster Abgleich: schreibt nur den neuen, löscht nichts': r['sync'] == {'files': 6, 'writes': 1, 'removes': 0, 'count': 6, 'removed': 0},
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
