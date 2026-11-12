"""Weiterleitung und Statistik (bEnd/proxy.php, bEnd/stats.php, services/ping.js, services/usage.js):

1. Weiterleitung: Suche und Rückwärtssuche kommen an, fremde Dienste und Pfade nicht (404).
2. App: „wmap:photon“ steht hinter den direkten Servern; eine Suche zählt je Dienst (wmap.usage); ein Feature zählt seine
   Nutzung (feat:lines) und die Anfragen dabei je Dienst (feat:lines:efa).
3. Ping (nur wenn die Nutzungsstatistik an und gefragt ist): einmal am Tag, mit App oder Website (isApp: im Browser
   Website, nach einem Start als App immer App) – mit den Zählern der App, danach ist wmap.usage leer und wmap.ping gesetzt; ein zweiter Start
   am selben Tag schickt nichts. Letzter Ping im Vormonat / in der Vorwoche → back_month / back_week, sonst nicht.
4. stats.php: ohne Schlüssel 403; mit Schlüssel Geräte, Anfragen – die Tests getrennt (Cookie wmap_test, test:…) –,
   Diagramme je Dienst, Features (Anfragen je Nutzung), Weiterleitung und Diagramme, keine
   JS-Fehler; Zeitpicker Tag / Woche / Monat → Werte je Tag, Jahr → je Monat, ohne Ausweichen auf gröbere Werte. Der Schlüssel steht in bEnd/keys.php (fehlt er, wird der Teil übersprungen).
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
        with urllib.request.urlopen(urllib.request.Request(BASE + path, headers={'Cookie': 'wmap_test=1'}), timeout=60) as r:
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

    feat = module(b, """const u = await import('./js/services/usage.js');
        localStorage.removeItem('wmap.usage');
        u.feature('lines'); u.used('efa', 'lines'); u.used('efa', 'lines'); u.used('overpass');
        return JSON.parse(localStorage.getItem('wmap.usage'));""")
    print('Feature:', feat)
    checks['2. Feature: Nutzung und Anfragen je Dienst'] = feat == {'feat:lines': 1, 'efa': 2, 'feat:lines:efa': 2, 'overpass': 1}

    # 3. Ping mit den Zählern
    b.js("localStorage.removeItem('wmap.ping'); localStorage.setItem('wmap.usage', JSON.stringify({ photon: 3, valhalla: 1, 'feat:lines': 1, 'feat:lines:efa': 2 }))")
    sent = module(b, """const p = await import('./js/services/ping.js');
        await p.ping();
        const first = [localStorage.getItem('wmap.ping'), localStorage.getItem('wmap.usage')];
        localStorage.setItem('wmap.usage', JSON.stringify({ photon: 5 }));
        await p.ping();
        return [...first, localStorage.getItem('wmap.usage')];""")
    print('Ping:', sent)
    checks['3. Ping gesendet, Zähler geleert'] = isinstance(sent, list) and bool(re.match(r'\d{4}-\d\d-\d\d$', sent[0] or '')) and sent[1] is None
    checks['3. zweiter Start am selben Tag schickt nichts'] = isinstance(sent, list) and sent[2] == '{"photon":5}'

    # 3c. App oder Website
    app = module(b, """const p = await import('./js/services/ping.js');
        localStorage.removeItem('wmap.installed');
        const r = [p.isApp()];
        localStorage.setItem('wmap.installed', '1');
        r.push(p.isApp());
        localStorage.removeItem('wmap.installed');
        return r;""")
    print('App/Website:', app)
    checks['3c. im Browser Website, nach einem Start als App App'] = app == [False, True]

    # 3a. Vorwoche / Vormonat – was der Ping schickt, aus fetch abgefangen
    back = module(b, """const p = await import('./js/services/ping.js');
        const sent = [];
        const orig = window.fetch;
        window.fetch = async (url, init) => { if (init?.body instanceof FormData) sent.push(JSON.parse(init.body.get('data'))); return orig(url, init); };
        const now = new Date();
        const day = (d) => d.toISOString().slice(0, 10);
        const runs = [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)), new Date(+now - 7 * 864e5), new Date(+now - 400 * 864e5)];
        for (const d of runs) { localStorage.setItem('wmap.ping', day(d)); await p.ping(); }
        window.fetch = orig;
        return sent.map((x) => [x.back_month, x.back_week]);""")
    print('Vormonat, Vorwoche, lange her:', back)
    checks['3a. Vormonat → back_month'] = isinstance(back, list) and back[0][0] is True
    checks['3a. Vorwoche → back_week'] = isinstance(back, list) and back[1][1] is True
    checks['3a. lange her → keins'] = isinstance(back, list) and back[2] == [False, False]

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
        b.js("for (const d of document.querySelectorAll('details')) d.open = true")
        time.sleep(2)
        page = b.js("""return {
            tiles: [...document.querySelectorAll('.tile')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim()),
            tests: [...document.querySelectorAll('#requests td')].map((td) => td.textContent),
            features: !!document.querySelector('#features table, #features p'),
            api: !!document.querySelector('#chart-api canvas, #chart-api svg'),
            proxyTitle: document.querySelector('#servers .chart')?.textContent.match(/Weiterleitung \\S+ je \\S+/)?.[0],
            servers: document.querySelectorAll('#servers tr').length,
            charts: document.querySelectorAll('.chart canvas, .chart svg').length,
        }""")
        views = {}
        for v in ('day', 'week', 'month', 'year'):
            b.js(f"document.querySelector('#picker .dgp_stufe[data-stufe={v}]').click()")
            time.sleep(1.5)
            views[v] = b.js("""const t = document.querySelector('#chart-devices').textContent;
                return [/Geräte je (Tag|Woche|Monat)/.exec(t)?.[0], t.includes('feiner lässt sich'), document.querySelector('#fine').textContent]""")
        b.js("document.querySelector('#picker .dgp_stufe[data-stufe=month]').click()")
        print('Ansichten:', views)
        checks['4. Tag, Woche, Monat → je Tag, Jahr → je Monat'] = [x[0] for x in views.values()] == ['Geräte je Tag', 'Geräte je Tag', 'Geräte je Tag', 'Geräte je Monat']
        checks['4. kein Ausweichen auf gröbere Werte'] = not any(x[1] for x in views.values())
        print('stats.php:', json.dumps(page, ensure_ascii=False))
        b.shot('stats')
        checks['4. Kachel aktiv heute'] = any(re.match(r'^[\d.]+\s*Aktiv heute', t) for t in page['tiles'])
        checks['4. Tests getrennt gezählt (Ping, photon, Weiterleitung)'] = all(x in page['tests'] for x in ('ping:active', 'client:photon', 'proxy:photon'))
        checks['4. Ping getrennt nach Website (bei den Tests)'] = 'ping:web:active' in page['tests']
        # Zugriffe: die Seiten holen messages.json über appdata/messages.php, das den Abruf zählt
        news = get('appdata/messages.php')
        checks['4. Zugriffe: messages.json kommt ganz an, Abruf gezählt (bei den Tests), Kacheln da'] = news[0] == 200 and 'changelog' in json.loads(news[1]) \
            and 'hit:page' in page['tests'] and sum(1 for t in page['tiles'] if re.match(r'^[\d.]+\s*(Heute|7 Tage|30 Tage)$', t)) == 3
        # Zähler der App getrennt nach App/Website: gespeichert, in der Tabelle nicht gezeigt
        now = int(time.time() * 1000)
        st, raw = get(f'bEnd/stats.php?key={m.group(1)}&data=1&stufe=day&start={now - 2 * 86400000}&end={now}&keys=test:web:client:photon')
        web = sum(x['change'] for x in json.loads(raw).get('test:web:client:photon', [])) if st == 200 else 0
        print('web:client:photon:', web)
        checks['4. Anfragen getrennt nach Website gespeichert, nicht gezeigt'] = web > 0 and not any(x.startswith(('web:', 'app:')) for x in page['tests'])
        checks['4. Features aus dem Ping (bei den Tests)'] = all(x in page['tests'] for x in ('feat:lines', 'feat:lines:efa')) and page['features']
        checks['4. API als eigenes Diagramm'] = page['api']
        checks['4. Weiterleitung folgt dem Picker'] = bool(page['proxyTitle'])
        checks['4. Kachel verloren'] = any('Verloren im' in t for t in page['tiles'])
        checks['4. Server der Weiterleitung'] = page['servers'] > 1
        checks['4. Diagramme gezeichnet'] = page['charts'] >= 3

    for k, v in checks.items():
        print('ok    ' if v else 'FALSCH', k)
    if not all(checks.values()):
        b.errors.append(('stats', 'Prüfung fehlgeschlagen'))
    sys.exit(b.report())
