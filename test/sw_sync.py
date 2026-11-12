"""Abgleich im Service Worker (js/sw/sync.js) wie in der App: Ordner über eine offene Seite als Boten (core/tauri.js).
Statt Tauri ein nachgebautes `window.__TAURI__` mit einem Ordner im localStorage (jede Seite sieht denselben),
jedes Lesen dauert 600 ms – so läuft der Abgleich lange genug, um mittendrin die Seite zu wechseln.
1. Der Service Worker läuft als Modul und gleicht ab (sync:caps → folder).
2. 40 Wege im Ordner: Abgleich auf Meine Touren angestoßen; mittendrin zum Dashboard – der Abgleich läuft weiter,
   jede Datei wird genau einmal gelesen (nicht neu angefangen), am Ende sind alle 40 da.
3. Neue Dateien im Ordner, Abgleich angestoßen: Meine Touren zeigt sie ohne Neuladen.
4. Eine Tour hier gespeichert: Der Service Worker schreibt sie in den Ordner (sync:soon, über den Boten).
5. Einstellung von einem anderen Gerät (settings.json): kommt im localStorage der offenen Seite an.
6. Texte im Service Worker: core/i18n.js nicht erreichbar, kein t() beim Laden; frisch gestartet (gerade erst
   schlafen gelegt) kommt die erste Meldung als Text, nie als Schlüssel – in der Sprache der Seite, ohne Datei auf dem
   Server aus dem Speicher der Fassung."""
import json
import re
import sys
import time
from pathlib import Path
from common import Browser

PRELOAD = """() => {
  const KEY = 'test.ordner';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const save = (f) => localStorage.setItem(KEY, JSON.stringify(f));
  const log = (x) => { const l = JSON.parse(localStorage.getItem('test.log') || '[]'); l.push(x); localStorage.setItem('test.log', JSON.stringify(l)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let clock = Date.now();
  const folder = {
    info: () => ({ connected: localStorage.getItem('test.connected') === '1', name: 'Testordner' }),
    list: () => ({ files: Object.entries(load()).map(([path, f]) => ({ path, modified: f.modified })) }),
    read: async ({ path }) => {
      await sleep(Number(localStorage.getItem('test.delay') || 0));
      log('read ' + path);
      const f = load()[path];
      if (!f) throw 'Nicht gefunden: ' + path;
      return { text: f.text };
    },
    write: ({ path, text }) => { log('write ' + path); const all = load(); all[path] = { text, modified: ++clock }; save(all); return { modified: clock }; },
    remove: ({ path }) => { const all = load(); delete all[path]; save(all); return {}; },
    rename: ({ path, to }) => { const all = load(); all[to] = { ...all[path], modified: ++clock }; delete all[path]; save(all); return { modified: clock }; },
    disconnect: () => { localStorage.removeItem('test.connected'); return {}; },
  };
  window.__TAURI__ = { core: { invoke: async (cmd, args = {}) => {
    const [, p, c] = cmd.match(/^plugin:(\\w+)\\|(\\w+)$/) ?? [];
    if (p === 'folder' && folder[c]) return folder[c](args);
    throw new Error('nicht im Test: ' + cmd);
  } } };
}"""

# 40 Wege als WMap-Dateien (mit Kennung) in den Ordner – `from` erste Nummer, `n` Anzahl
FILL = """const [from, n] = arguments; const done = arguments[2];
(async () => {
  const { buildTrack, trackGpx } = await import('./js/data/tracks.js');
  const all = JSON.parse(localStorage.getItem('test.ordner') || '{}');
  for (let k = from; k < from + n; k += 1) {
    const pts = []; for (let i = 0; i < 40; i += 1) pts.push([9.9 + i * 0.0005 + k * 0.01, 51.53 + Math.sin(i / 5) * 0.0005, Date.UTC(2026, 8, 1 + Math.floor(k / 10), 6 + (k % 10), 0, i * 10)]);
    const t = { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name: `Runde ${k}` }), id: `sw${k}` };
    all[`Aufgezeichnete Touren/2026/09 September/Runde ${k}.gpx`] = { text: trackGpx(t), modified: 1000 + k };
  }
  localStorage.setItem('test.ordner', JSON.stringify(all));
  done(Object.keys(all).length);
})();"""
STATE = "const done = arguments[0]; import('./js/core/sw-link.js').then(async (m) => done(await m.swCall('sync:state'))).catch((e) => done(String(e)))"
ROWS = "return document.querySelectorAll('tr[data-id^=sw]').length"


def idle(b, seconds=90):
    """Bis der Service Worker nichts mehr abgleicht"""
    for _ in range(seconds * 2):
        s = b.d.execute_async_script(STATE)
        if isinstance(s, dict) and not s.get('busy'):
            return s
        time.sleep(.5)
    return None


ROOT = Path(__file__).resolve().parent.parent
EXTRA = ROOT / 'appdata/lang/en_GB.json'


def sw_modules():
    """Alles, was js/sw/sync.js fest lädt"""
    seen, todo = set(), [ROOT / 'js/sw/sync.js']
    while todo:
        f = todo.pop().resolve()
        if f in seen:
            continue
        seen.add(f)
        for rel in re.findall(r"^(?:import|export) (?:[^;]*? from )?'(\.[^']+)';", f.read_text(encoding='utf-8'), re.M):
            todo.append(f.parent / rel)
    return seen


# Beim ersten Aufruf nach dem Schlafen legen: eine Datei, die keine ZIP ist – ihr Fehler ist Text aus der Sprachdatei
ZIP_ERROR = """const done = arguments[0];
import('./js/core/sw-link.js').then((m) => m.swCall('sync:restore-zip', { file: new File(['kein zip'], 'x.zip') }))
  .then((r) => done('kein Fehler: ' + JSON.stringify(r)), (e) => done(e.message));"""


# Ein ganz neuer Service Worker: Nichts ist geladen, wenn der erste Auftrag kommt. Danach `prepare` (etwa in den Speicher legen)
RESTART = """const done = arguments[0];
(async () => {
  const old = await navigator.serviceWorker.getRegistration();
  const url = old.active.scriptURL;
  await old.unregister();
  const reg = await navigator.serviceWorker.register(url, { type: 'module' });
  const w = reg.installing ?? reg.waiting ?? reg.active;
  if (w.state !== 'activated') await new Promise((r) => w.addEventListener('statechange', () => { if (w.state === 'activated') r(); }));
  done(true);
})().catch((e) => done(String(e)));"""


def sw_error(b, before=None):
    assert b.d.execute_async_script(RESTART) is True
    if before:
        b.d.execute_async_script(before)
    b.open('dashboard.html', wait=0)
    return b.d.execute_async_script(ZIP_ERROR)


with Browser(width=420, height=900) as b:
    checks = {}
    b.d.script.add_preload_script(PRELOAD)
    # Service Worker anmelden (die Karte tut das) – noch ohne Ordner
    b.open('index.html', wait=4)
    b.wait("return navigator.serviceWorker.getRegistration().then((r) => !!r?.active)", 60)
    caps = b.d.execute_async_script("const done = arguments[0]; import('./js/core/sw-link.js').then(async (m) => done(await m.swSync()))")
    print('Fähigkeiten:', caps)
    checks['1. Service Worker als Modul, gleicht den Ordner ab'] = bool(caps and caps.get('folder'))

    # 2. 40 Wege, Abgleich beim Öffnen von Meine Touren, mittendrin Seitenwechsel
    b.js("localStorage.setItem('test.delay', '600'); localStorage.setItem('test.connected', '1'); localStorage.removeItem('test.log')")
    b.js("return import('./js/data/store.js').then((m) => m.local.set('wmap.tracks.keep', 'all'))")
    print('Dateien im Ordner:', b.d.execute_async_script(FILL, 0, 40))
    b.open('wege.html', wait=2)
    # Anstoßen wie „Jetzt abgleichen“ (beim Öffnen lief vielleicht schon einer – die 5-Minuten-Regel greift dann)
    b.js("import('./js/data/folder.js').then((m) => m.folder.sync())")
    started = b.wait("const n = JSON.parse(localStorage.getItem('test.log') || '[]').filter((x) => x.startsWith('read Aufgezeichnete')).length; return n >= 8 && n < 30 && n", 60)
    print('Mittendrin:', started)
    b.open('dashboard.html', wait=1)
    mid = b.d.execute_async_script(STATE)
    print('Nach dem Wechsel:', mid)
    end = idle(b)
    log = b.js("return JSON.parse(localStorage.getItem('test.log') || '[]')")
    reads = [x for x in log if x.startswith('read Aufgezeichnete')]
    n = b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(async (m) => done((await m.tracks.all()).filter((t) => t.id.startsWith('sw')).length))")
    print('Gelesen:', len(reads), 'verschieden:', len(set(reads)), 'Wege:', n)
    checks['2. Abgleich lief über den Seitenwechsel weiter (mittendrin noch busy)'] = bool(started) and isinstance(mid, dict) and mid.get('busy')
    checks['2. Jede Datei genau einmal gelesen, alle 40 Wege da'] = len(reads) == 40 and len(set(reads)) == 40 and n == 40

    # 3. Neue Dateien – Meine Touren zeigt sie ohne Neuladen
    b.open('wege.html?tab=wege', wait=3)
    idle(b)
    before = b.js(ROWS)
    b.js("localStorage.setItem('test.delay', '0')")
    b.d.execute_async_script(FILL, 40, 3)
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/folder.js').then((m) => m.folder.sync()).then((r) => done(r), (e) => done(String(e)))")
    after = b.wait(f"const n = {ROWS.replace('return ', '')}; return n > {before} && n", 30)
    print('Zeilen vorher/nachher:', before, after)
    checks['3. Neue Wege erscheinen ohne Neuladen'] = before == 40 and after == 43

    # 4. Tour hier gespeichert → Datei im Ordner
    b.js("return import('./js/data/store.js').then((m) => m.tours.save({ id: 'swtour', name: 'Bote', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', fixed: true, stats: {} }))")
    wrote = b.wait("return Object.keys(JSON.parse(localStorage.getItem('test.ordner') || '{}')).find((p) => p.startsWith('Geplante Touren/') && p.includes('Bote'))", 30)
    print('Geschrieben:', wrote)
    checks['4. Tour vom Service Worker in den Ordner geschrieben'] = bool(wrote)

    # 5. Einstellung von einem anderen Gerät
    idle(b)
    b.js("""const all = JSON.parse(localStorage.getItem('test.ordner')); const s = JSON.parse(all['settings.json'].text);
      all['settings.json'] = { text: JSON.stringify({ ...s, updated: s.updated + 5000, values: { ...s.values, 'wmap.lapsize': '"500"' } }), modified: Date.now() + 5000 };
      localStorage.setItem('test.ordner', JSON.stringify(all));""")
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/folder.js').then((m) => m.folder.sync()).then((r) => done(r), (e) => done(String(e)))")
    lap = b.wait("return localStorage.getItem('wmap.lapsize') === '\"500\"'", 20)
    print('Rundenlänge hier:', b.js("return localStorage.getItem('wmap.lapsize')"))
    checks['5. Einstellung aus dem Ordner kommt in der Seite an'] = bool(lap)

    # 6. Texte im Service Worker
    mods = sw_modules()
    names = sorted(str(m.relative_to(ROOT)) for m in mods)
    print('Service Worker lädt:', len(names), 'Module')
    checks['6. core/i18n.js nicht vom Service Worker erreichbar'] = 'js/core/i18n.js' not in names and 'js/core/i18n-text.js' in names
    # Oben im Modul (keine Einrückung, keine Funktion): dort gäbe es noch keine Texte
    early = [f'{m.name}: {l[:60]}' for m in mods for l in m.read_text(encoding='utf-8').split('\n')
             if re.match(r'(export )?(const|let) ', l) and re.search(r"\bt\(['`]", l) and not re.search(r"=>|get \w+\(\)", l.split("t('")[0])]
    print('t() beim Laden:', early)
    checks['6. kein t() beim Laden der Module'] = not early
    first = sw_error(b)
    print('Erste Meldung nach dem Aufwachen:', first)
    checks['6. frisch gestartet: Text, kein Schlüssel'] = first == 'Das ist keine ZIP-Datei'
    kept = EXTRA.read_text(encoding='utf-8') if EXTRA.exists() else None   # echte Übersetzung nicht verlieren
    try:
        EXTRA.write_text(json.dumps({'_meta': {'name': 'English', 'locale': 'en-GB'}, 'backup': {'error': {'not_zip': 'That is no ZIP'}}}), encoding='utf-8')
        b.js("localStorage.setItem('wmap.lang', 'en_GB')")
        english = sw_error(b)
        print('Sprache der Seite:', english)
        checks['6. Meldung in der Sprache der Seite'] = english == 'That is no ZIP'
        # Eine Sprache, die der Server nicht hat, nur im Speicher
        b.js("localStorage.setItem('wmap.lang', 'it_IT')")
        stored = sw_error(b, """const done = arguments[0];
          caches.open('wmap-app-test').then((c) => c.put(new URL('appdata/lang/it_IT.json', location.href).href,
            new Response(JSON.stringify({ _meta: { name: 'Italiano', locale: 'it-IT' }, backup: { error: { not_zip: 'Stored: no ZIP' } } }), { headers: { 'Content-Type': 'application/json' } }))).then(() => done())""")
        print('Aus dem Speicher:', stored)
        checks['6. Sprachdatei aus dem Speicher der Fassung'] = stored == 'Stored: no ZIP'
    finally:
        if kept is None: EXTRA.unlink(missing_ok=True)
        else: EXTRA.write_text(kept, encoding='utf-8')
        b.js("localStorage.removeItem('wmap.lang')")

    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
