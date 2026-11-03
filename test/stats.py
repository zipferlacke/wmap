"""Weiterleitung und Statistik (bEnd/proxy.php, bEnd/stats.php, services/ping.js, services/usage.js):

1. Weiterleitung: Suche und Rückwärtssuche kommen an, fremde Dienste und Pfade nicht (404).
2. App: „wmap:photon“ steht hinter den direkten Servern; eine Suche zählt je Dienst (wmap.usage).
3. Ping (nur wenn die Nutzungsstatistik an und gefragt ist): einmal am Tag – mit den Zählern der App, danach ist wmap.usage leer und wmap.ping gesetzt; ein zweiter Start
   am selben Tag schickt nichts.
4. stats.php: ohne Schlüssel 403; mit Schlüssel Geräte, Anfragen (client:photon), Weiterleitung und Diagramme, keine
   JS-Fehler. Der Schlüssel steht in bEnd/keys.php (fehlt er, wird der Teil übersprungen).
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from common import BASE, Browser

ROOT = Path(__file__).resolve().parent.parent
checks = {}


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def module(b, body, seconds=60):
    """Async-Code als Modul in der Seite (import() geht aus Selenium-Skripten nicht) → Ergebnis von return"""
    b.js("window.__r = undefined; const s = document.createElement('script'); s.type = 'module'; "
         "s.textContent = `window.__r = await (async () => {${arguments[0]}})().catch((e) => 'FEHLER ' + e);`; document.head.append(s);", body)
    return b.wait("return window.__r", seconds)


status, body = get('bEnd/proxy.php/photon/api?q=G%C3%B6ttingen&limit=1')
checks['1. Weiterleitung Suche'] = status == 200 and 'features' in body
status, body = get('bEnd/proxy.php/photon/reverse?lon=9.935&lat=51.533&limit=1')
checks['1. Weiterleitung Rückwärtssuche'] = status == 200 and 'features' in body
checks['1. fremder Pfad abgelehnt'] = get('bEnd/proxy.php/photon/status')[0] == 404
checks['1. fremder Dienst abgelehnt'] = get('bEnd/proxy.php/nominatim/search')[0] == 404

with Browser(420, 900) as b:
    b.open('index.html', 3)
    # 2. Reihenfolge und Zähler
    b.js("localStorage.removeItem('wmap.usage'); localStorage.setItem('wmap.stats.asked', '1'); localStorage.removeItem('wmap.stats')")
    used = module(b, """const c = await import('./js/core/config.js');
        const s = await import('./js/services/servers.js');
        const res = await s.askServer('photon', '/api?q=Kassel&limit=1');
        return [res.ok, JSON.parse(localStorage.getItem('wmap.usage')), c.API.photon.at(-1)];""")
    print('Suche über askServer:', used)
    checks['2. Suche kommt an (direkt oder über WMap) und zählt'] = isinstance(used, list) and used[0] and used[1].get('photon') == 1 and used[2] == 'wmap:photon'

    # 3. Ping mit den Zählern
    b.js("localStorage.removeItem('wmap.ping'); localStorage.setItem('wmap.usage', JSON.stringify({ photon: 3, valhalla: 1 }))")
    sent = module(b, """const p = await import('./js/services/ping.js');
        await p.ping();
        const first = [localStorage.getItem('wmap.ping'), localStorage.getItem('wmap.usage')];
        localStorage.setItem('wmap.usage', JSON.stringify({ photon: 5 }));
        await p.ping();
        return [...first, localStorage.getItem('wmap.usage')];""")
    print('Ping:', sent)
    checks['3. Ping gesendet, Zähler geleert'] = isinstance(sent, list) and bool(re.match(r'\d{4}-\d\d-\d\d$', sent[0] or '')) and sent[1] is None
    checks['3. zweiter Start am selben Tag schickt nichts'] = isinstance(sent, list) and sent[2] == '{"photon":5}'

    # 3b. Ausgeschaltet: nichts gezählt, nichts geschickt
    off = module(b, """const u = await import('./js/services/usage.js');
        const p = await import('./js/services/ping.js');
        u.statsSetting.set(false);
        localStorage.removeItem('wmap.ping');
        u.used('photon');
        await p.ping();
        const r = [localStorage.getItem('wmap.usage'), localStorage.getItem('wmap.ping')];
        u.statsSetting.set(true);
        return r;""")
    print('Ausgeschaltet:', off)
    checks['3b. aus: nichts gezählt, nichts geschickt'] = off == [None, None]

    # 4. Übersicht
    keys = ROOT / 'bEnd/keys.php'
    m = re.search(r"'stats'\s*=>\s*'([^']+)'", keys.read_text(encoding='utf-8')) if keys.exists() else None
    if not m:
        print(f'{keys} ohne Schlüssel – stats.php übersprungen')
    else:
        checks['4. ohne Schlüssel 403'] = get('bEnd/stats.php')[0] == 403
        b.open(f'bEnd/stats.php?key={m.group(1)}', 4)
        page = b.js("""return {
            tiles: [...document.querySelectorAll('.tile')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim()),
            client: [...document.querySelectorAll('td')].some((td) => td.textContent === 'photon'),
            servers: document.querySelectorAll('section:nth-of-type(3) tr').length,
            charts: document.querySelectorAll('.chart .dg_canvas, .chart canvas, .chart svg').length,
        }""")
        print('stats.php:', json.dumps(page, ensure_ascii=False))
        b.shot('stats')
        checks['4. Geräte heute gezählt'] = any(re.match(r'^[1-9][\d.]*\s*Aktiv heute$', t) for t in page['tiles'])
        checks['4. Anfragen der App (photon)'] = page['client']
        checks['4. Server der Weiterleitung'] = page['servers'] > 1
        checks['4. Diagramme gezeichnet'] = page['charts'] >= 3

    for k, v in checks.items():
        print('ok    ' if v else 'FALSCH', k)
    if not all(checks.values()):
        b.errors.append(('stats', 'Prüfung fehlgeschlagen'))
    sys.exit(b.report())
