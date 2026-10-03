"""Seite „Offline“ (offline-daten.html, js/pages/offline-daten.js): alles, was ohne Netz auf dem Gerät liegt, nach Art.
1. Die Kachel „Offline“ der Übersicht führt hin.
2. Ohne Ordner: Karten-Gebiet mit Größe und Stand, alle aufgezeichneten Touren „ganz auf diesem Gerät“, geplante
   Touren mit Verweis auf ihre Ansicht, vorgeladene Navigation mit Resttagen.
3. Mit verbundenem Ordner: nur die als „offline verfügbar“ markierte Tour steht in der Liste und führt zu ihrer
   Ansicht; „Nicht mehr offline“ nimmt die Markierung weg.
4. „Nicht mehr offline“ am Gebiet (mit Rückfrage) löscht es; an der Navigation deren Karte.
5. Der Verweis eines Gebiets (offline.html?gebiet=ID) zoomt im Editor auf das Gebiet; „Neues Gebiet“ führt zu ?neu."""
import json
import sys
import time
from common import Browser

SETUP = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { tracks, buildTrack } = await import('./js/data/tracks.js');
  const { tours } = await import('./js/data/store.js');
  const ring = [[10.0, 51.5], [10.2, 51.5], [10.2, 51.4], [10.0, 51.4]];
  localStorage.setItem('wmap.areas', JSON.stringify([{ id: 'harz1', name: 'Gebiet um Rittmarshausen', ring, detail: 'full', terrain: true, status: 'ok', bytes: 42e6, tiles: 1234, at: Date.UTC(2026, 8, 20), cache: 'wmap-area-harz1-1' }]));
  await caches.open('wmap-area-harz1-1');
  const nav = 'wmap-nav-' + (Date.now() - 3 * 864e5);
  await (await caches.open(nav)).put('./kachel-test', new Response('x'));
  const mk = (id, name, daysAgo, extra = {}) => {
    const t0 = Date.now() - daysAgo * 864e5;
    const pts = []; for (let i = 0; i < 60; i += 1) pts.push([9.9 + i * 0.0004, 51.53 + Math.sin(i / 7) * 0.002, t0 + i * 20000]);
    return { ...buildTrack(pts, { kind: 'rec', profile: 'bike', name }), id, ...extra };
  };
  await tracks.putQuiet(mk('alt1', 'Alte Runde', 300));
  await tracks.putQuiet(mk('pin1', 'Wichtige Runde', 200, { pin: true }));
  await tracks.putQuiet(mk('neu1', 'Neue Runde', 3));
  tours.save({ id: 'tA', name: 'Harzrunde', profile: 'hike', points: [[10.5, 51.8], [10.6, 51.8]], shape: '_p~iF~ps|U_ulLnnqC', stats: { length: 7000 } });
  tours.save({ id: 'tB', name: 'Zum Bahnhof', profile: 'drive', points: [[10.1, 51.48], [9.93, 51.54]], shape: '_p~iF~ps|U_ulLnnqC', stats: { length: 16000 } });
  return nav;
})().then(done, (e) => done('FEHLER ' + e));
"""

# Der Ordner im Speicher muss in der Seite selbst leben: Funktionen aus einem Selenium-Skript sind nach dessen Ende
# tot („dead object“) – der Abgleich hielte den Ordner dann für verschwunden und trennte ihn.
FOLDER = r"""
const done = arguments[arguments.length - 1];
const el = document.createElement('script');
el.type = 'module';
el.textContent = `
  import { folder } from './js/data/folder.js';
  localStorage.setItem('wmap.tracks.keep', '"30"');
  const files = new Map(); let clock = Date.now();
  folder._useBackend({
    permission: async () => 'granted',
    list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
    read: async (p) => { if (!files.has(p)) throw new Error('fehlt ' + p); return files.get(p).text; },
    write: async (p, text) => { clock += 1000; files.set(p, { text, modified: clock }); return clock; },
    remove: async (p) => { files.delete(p); },
  }, 'Nextcloud');
  await folder.sync();
  dispatchEvent(new CustomEvent('wmap:folder', { detail: {} }));
  window.__folderReady = true;
`;
document.head.append(el);
const t = setInterval(() => { if (window.__folderReady) { clearInterval(t); setTimeout(() => done(true), 700); } }, 100);
"""

SECTION = """const s = document.querySelector(arguments[0]); if (!s) return null;
return { text: s.innerText.replace(/\\s+/g, ' ').trim(), items: [...s.querySelectorAll('.off-item')].map((li) => [li.querySelector('strong').textContent, li.querySelector('a.off-main')?.getAttribute('href') ?? null, !!li.querySelector('.off-remove')]),
  links: [...s.querySelectorAll('.sync-actions a')].map((a) => a.getAttribute('href')) };"""

with Browser(width=1100, height=1000) as b:
    b.open('dashboard.html', wait=3)
    nav = b.d.execute_async_script(SETUP)
    print('angelegt:', nav)
    b.open('dashboard.html', wait=3)
    tile = b.js("const a = [...document.querySelectorAll('.dash-tile')].find((x) => x.querySelector('strong').textContent === 'Offline'); return a && [a.getAttribute('href'), a.querySelector('em')?.textContent ?? '']")
    print('Kachel:', tile)

    b.open('offline-daten.html', wait=3)
    areas = b.js(SECTION, '#gebiete')
    recorded = b.js(SECTION, '#touren')
    planned = b.js(SECTION, '#geplant')
    navs = b.js(SECTION, '#navigation')
    for name, sec in [('Gebiete', areas), ('Aufgezeichnet', recorded), ('Geplant', planned), ('Navigation', navs)]:
        print(name + ':', json.dumps(sec, ensure_ascii=False))
    b.shot('offline-daten')

    # ── 3. Mit Ordner ──
    print('Ordner verbunden:', b.d.execute_async_script(FOLDER))
    with_folder = b.js(SECTION, '#touren')
    print('Aufgezeichnet mit Ordner:', json.dumps(with_folder, ensure_ascii=False))
    b.shot('offline-daten-ordner')
    b.js("document.querySelector('#touren .off-remove').click()")
    time.sleep(1)
    unpinned = b.d.execute_async_script("const done = arguments[arguments.length - 1]; import('./js/data/tracks.js').then(async (m) => done((await m.tracks.get('pin1')).pin ?? null))")
    after_unpin = b.js(SECTION, '#touren')
    print('nach „Nicht mehr offline“:', unpinned, after_unpin['items'])

    # ── 4. Gebiet und Navigation entfernen ──
    b.js("document.querySelector('#navigation .off-remove').click()")
    time.sleep(1)
    nav_gone = b.d.execute_async_script("const done = arguments[arguments.length - 1]; caches.keys().then((k) => done(!k.some((x) => x.startsWith('wmap-nav-'))))")
    b.js("document.querySelector('#gebiete .off-remove').click()")
    b.wait("return document.querySelector('dialog[open] button[value=yes]')", 5)
    asked = b.js("return document.querySelector('dialog[open] .uD-title').innerText.replace(/\\s+/g, ' ').trim()")
    b.js("document.querySelector('dialog[open] button[value=no]').click()")
    time.sleep(.5)
    kept = b.js("return JSON.parse(localStorage.getItem('wmap.areas')).length")
    print('Rückfrage:', asked, '· nach „Abbrechen“ noch da:', kept, '· Navigationskarte weg:', nav_gone)

    # ── 5. Verweis in den Editor ──
    b.open('offline.html?gebiet=harz1', wait=6)
    view = b.js("const c = __wmap.map.getCenter(); return [+c.lng.toFixed(2), +c.lat.toFixed(2), +__wmap.map.getZoom().toFixed(1), document.querySelector('.tour-head a').getAttribute('href')]")
    print('Editor mit ?gebiet:', view)
    b.open('offline-daten.html', wait=2)
    b.js("document.querySelector('#gebiete .off-remove').click()")
    b.wait("return document.querySelector('dialog[open] button[value=yes]')", 5)
    b.js("document.querySelector('dialog[open] button[value=yes]').click()")
    time.sleep(1.5)
    removed = b.d.execute_async_script("const done = arguments[arguments.length - 1]; caches.keys().then((k) => done([JSON.parse(localStorage.getItem('wmap.areas')).length, k.some((x) => x.startsWith('wmap-area-'))]))")
    empty = b.js(SECTION, '#gebiete')
    print('Gebiet entfernt:', removed, empty['text'][:90])

    checks = {
        '1. Kachel „Offline“ führt zur Seite, mit Gebiet und Größe': tile and tile[0] == './offline-daten.html' and '1 Gebiet' in tile[1],
        '2. Gebiet mit Größe, Kacheln, Stand; führt in den Editor': areas['items'] == [['Gebiet um Rittmarshausen', './offline.html?gebiet=harz1', True]] and '40,1 MB' in areas['text'] and 'mit Gelände' in areas['text'] and 'Stand 20. Sept. 2026' in areas['text'],
        '2. „Neues Gebiet“ und „Gebiete bearbeiten“': areas['links'] == ['./offline.html?neu', './offline.html'],
        '2. ohne Ordner: alle Touren ganz auf dem Gerät, keine Liste': 'Alle 3 Touren liegen ganz auf diesem Gerät' in recorded['text'] and recorded['items'] == [],
        '2. geplante Touren führen zu ihrer Ansicht': sorted(planned['items']) == [['Harzrunde', './wege.html?tour=tA', False], ['Zum Bahnhof', './wege.html?tour=tB', False]],
        '2. vorgeladene Navigation mit Resttagen': len(navs['items']) == 1 and '1 Kachel' in navs['text'] and 'noch 7 Tage' in navs['text'],
        '3. mit Ordner: nur Neues und Markiertes ganz in der App, Markiertes in der Liste': '2 von 3 Touren liegen ganz in der App' in with_folder['text'] and with_folder['items'] == [['Wichtige Runde', './wege.html?id=pin1', True]],
        '3. „Nicht mehr offline“ nimmt die Markierung weg': unpinned is None and after_unpin['items'] == [],
        '4. Navigationskarte gelöscht': nav_gone is True,
        '4. Gebiet: Rückfrage, Abbrechen behält': 'nicht mehr offline?' in asked and kept == 1,
        '5. Editor zoomt auf das Gebiet, zurück geht es zu „Offline“': 9.9 < view[0] < 10.3 and 51.3 < view[1] < 51.6 and view[2] > 8 and view[3] == './offline-daten.html',
        '4. Gebiet entfernt samt Kacheln': removed == [0, False] and 'Noch kein Gebiet' in empty['text'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
