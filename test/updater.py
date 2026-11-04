"""Gekapseltes Aktualisieren und Prüfen (js/core/updater.js, sw.js verify/repair) – über 127.0.0.1, damit der Service
Worker wie draußen cache first liefert und prüft:

1. Version kommt vom Service Worker (wmapUpdater.version, Dashboard) – die aus sw.js
2. Einstellungen → „App prüfen und neu laden“: alles heil → „… geprüft – alles in Ordnung“ nach dem Neuladen
3. Eine Datei im Speicher kaputt → derselbe Knopf erneuert sie („… 1 erneuert“), im Speicher wieder richtig
4. Modul passt nicht (Alt und Neu gemischt) → eigenes Fenster „WMap konnte nicht vollständig laden“, „Aktualisieren“
   repariert, danach Karte da
"""
import re
import sys
import time
import common
from common import Browser

common.BASE = common.BASE.replace('//localhost', '//127.0.0.1')
VERSION = re.search(r"const VERSION = '([^']+)'", open('../sw.js', encoding='utf-8').read()).group(1)
MAP = """const m = window.__wmap?.map; return !!m && m.loaded() && (m.getStyle?.()?.layers?.length ?? 0) > 10;"""
SPOIL = """const done = arguments[arguments.length - 1];
  (async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('wmap-app-'));
    const c = await caches.open(name);
    const url = new URL('js/services/usage.js', location.href).href;
    const key = (await c.keys()).find((r) => r.url === url) ?? url;
    await c.put(key, new Response(arguments[0], { headers: { 'Content-Type': 'text/javascript' } }));
    return name;
  })().then(done, (e) => done('FEHLER ' + e));"""
FRESH = """const done = arguments[arguments.length - 1];
  caches.keys().then((k) => caches.open(k.find((x) => x.startsWith('wmap-app-'))))
    .then((c) => c.match(new URL('js/services/usage.js', location.href).href)).then((r) => r ? r.text() : '')
    .then((t) => done(t.includes('statsSetting')), () => done(false));"""
checks = {}


def repair(b):
    """Einstellungen → „App prüfen und neu laden“ → Text im Toast nach dem Neuladen"""
    b.open('settings.html', 4)
    b.js("window.__vorher = 1")
    b.js("const k = document.querySelector('button[data-act=repair]'); k.scrollIntoView(); k.click()")
    # neu geladen (window.__vorher weg), dann das Ergebnis im Toast
    return b.wait("return !window.__vorher && document.getElementById('toast')?.textContent", 90)


with Browser(420, 900) as b:
    b.open('index.html', 3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1')")
    b.wait("return navigator.serviceWorker.controller && caches.keys().then((k) => k.some((x) => x.startsWith('wmap-app-')))", 90)
    time.sleep(4)

    # 1. Version vom Service Worker
    b.open('dashboard.html', 4)
    v = b.d.execute_async_script("const done = arguments[arguments.length - 1]; window.wmapUpdater.version().then(done, () => done(null))")
    dash = b.js("return document.querySelector('.dash-version')?.textContent")
    print('1. Version:', v, '· Dashboard:', dash)
    checks['1. Version vom Service Worker'] = isinstance(v, dict) and v.get('version') == VERSION and VERSION in (dash or '')

    # 2. Alles heil
    ok = repair(b)
    print('2. heil:', ok)
    checks['2. „alles in Ordnung“'] = bool(ok) and 'Ordnung' in ok

    # 3. Eine Datei kaputt: wird erneuert
    # dieselbe Datei mit einer Zeile mehr: läuft, passt aber nicht zum Prüfwert
    b.d.execute_async_script(SPOIL, open('../js/services/usage.js', encoding='utf-8').read() + '\n// kaputt\n')
    fixed = repair(b)
    fresh = b.d.execute_async_script(FRESH)
    print('3. kaputt:', fixed, '· Datei wieder richtig:', fresh)
    checks['3. Datei erneuert'] = bool(fixed) and '1 erneuert' in fixed and fresh

    # 4. Modul passt nicht: Rettungsfenster, Aktualisieren repariert
    b.d.execute_async_script(SPOIL, 'export const nichts = 1;')
    b.open('index.html', 0)
    shown = b.wait("return document.querySelector('dialog.wmap-rescue[open] h2')?.textContent", 30)
    print('4. Rettungsfenster:', shown)
    b.shot('updater-rescue')
    b.js("document.querySelector('dialog.wmap-rescue button[value=update]').click()")
    ok_map = b.wait(MAP, 90)
    fresh = b.d.execute_async_script(FRESH)
    print('4. danach Karte:', ok_map, '· Datei wieder richtig:', fresh)
    checks['4. Fenster kommt'] = shown == 'WMap konnte nicht vollständig laden'
    checks['4. Aktualisieren repariert, Karte da'] = bool(ok_map) and fresh

    # Die Fehler beim absichtlich kaputten Laden sind erwartet
    b.errors[:] = [e for e in b.errors if not re.search(r'usage\.js|nichts|statsSetting|export named|app\.js', str(e))]
    for k, val in checks.items():
        print('ok    ' if val else 'FALSCH', k)
    if not all(checks.values()):
        b.errors.append(('updater', 'Prüfung fehlgeschlagen'))
    sys.exit(b.report())
