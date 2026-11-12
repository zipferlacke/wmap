"""Echtes Update nachspielen: eine frühere Fassung (Tag/Commit) läuft mit Service Worker (cache first, 127.0.0.1), dann
liegt der neue Stand auf dem „Server“, die Seite wird neu geöffnet, „Aktualisieren“ – danach muss die Karte laden und
müssen die Texte stimmen, auch beim nächsten Öffnen.

    python3 update_real.py [von] [nach] [--mix]   von: Tag/Commit (Vorgabe main), nach: Tag/Commit oder WORK (Arbeitsstand)

--mix: erst ein halber Upload (sw.js, sw-files.json, messages.json und die Sprachdateien neu, der Rest alt) – die neue
Fassung darf sich so nicht installieren (sw.js precache: Prüfwerte); danach der ganze Upload, dann klappt es.

Die Fassungen liegen in ~/Dokumente/dev/web/wmap-updatetest (neben dem Projekt, vom PHP-Container ausgeliefert).
"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
T = REPO.parent.parent / 'wmap-updatetest'
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
FROM = ARGS[0] if ARGS else 'main'
TO = ARGS[1] if len(ARGS) > 1 else 'WORK'
MIX = '--mix' in sys.argv
FIRST = ['sw.js', 'sw-app.js', 'appdata/sw-files.json', 'appdata/messages.json', 'appdata/lang']

os.environ['WMAP_URL'] = 'http://127.0.0.1:8080/web/wmap-updatetest/'
from common import Browser  # noqa: E402

MAP = """const m = window.__wmap?.map; if (!m) return 'keine Karte';
  return { loaded: m.loaded(), layers: m.getStyle?.()?.layers?.length ?? 0, ctrl: !!navigator.serviceWorker.controller };"""
SW = """const done = arguments[arguments.length - 1];
  Promise.all([caches.keys(), navigator.serviceWorker.getRegistration()]).then(([k, r]) =>
    done({ caches: k.filter((x) => x.startsWith('wmap-app')), waiting: !!r?.waiting, installing: !!r?.installing }));"""
# Texte der Seite: Schlüssel statt Text heißt, Sprachdatei und Code passen nicht zusammen
KEYS = r"""return (document.body.innerText.match(/\b(?:news|settings|common)\.[a-z_]+\.[a-z_.]+\b/g) || []).slice(0, 5)"""


def put(ref):
    """Fassung `ref` auf den „Server“ legen"""
    subprocess.run(f'chmod -R u+w {T} 2>/dev/null; rm -rf {T}; mkdir -p {T}/libs/wuefl-libs', shell=True, check=True)
    if ref == 'WORK':
        subprocess.run(f'cd {REPO} && git ls-files -z --cached --others --exclude-standard | xargs -0 -I{{}} cp --parents {{}} {T}/', shell=True, check=True)
    else:
        subprocess.run(f'cd {REPO} && git archive {ref} | tar -x -C {T}', shell=True, check=True)
    subprocess.run(f'rsync -aL --exclude .git {REPO}/libs/wuefl-libs/ {T}/libs/wuefl-libs/', shell=True, check=True)


def put_half():
    """Halber Upload: die Dateien aus FIRST schon neu, der Rest noch alt"""
    put(TO)
    keep = Path(str(T) + '-neu')
    subprocess.run(f'rm -rf {keep}; mkdir -p {keep}', shell=True, check=True)
    for f in FIRST:
        subprocess.run(f'cp -r --parents {f} {keep}/', shell=True, check=True, cwd=T)
    put(FROM)
    subprocess.run(f'cp -r {keep}/. {T}/ && rm -rf {keep}', shell=True, check=True)


def state(b, label):
    m = b.js(MAP)
    keys = b.js(KEYS)
    print(label, '· Karte:', m, '· Schlüssel:', keys, '· SW:', b.d.execute_async_script(SW))
    return isinstance(m, dict) and m['loaded'] and m['layers'] > 10 and not keys


def version(b):
    """Laufende Version (vom aktiven Service Worker) und ob noch eine installiert"""
    return b.d.execute_async_script("""const done = arguments[arguments.length - 1];
      navigator.serviceWorker.getRegistration().then((r) => {
        if (!r?.active) return done([null, !!r?.installing]);
        const ch = new MessageChannel();
        const t = setTimeout(() => done([null, !!r.installing]), 3000);
        ch.port1.onmessage = (e) => { clearTimeout(t); done([e.data?.version ?? null, !!r.installing]); };
        r.active.postMessage({ type: 'version' }, [ch.port2]);
      }, () => done([null, false]));""")


def update(b):
    """Öffnen, „Aktualisieren“ – und mitschreiben, was der Service Worker tut, bis die Seite neu geladen hat"""
    b.open('index.html', 12)
    print('Dialog:', b.js("return [...document.querySelectorAll('dialog[open] .uD-title')].map((d) => d.textContent.trim())"))
    b.js("""window.__vorher = 1; window.__log = [];
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'update-unavailable') window.__log.push(e.data.why); });
      [...document.querySelectorAll('dialog[open] button')].find((x) => /Aktualisieren/.test(x.textContent))?.click()""")
    seen = []
    for _ in range(60):
        try:
            x = b.js("return window.__vorher ? ['alt', window.__log.slice(-1)[0] ?? '', document.querySelector('.update-status')?.textContent ?? ''] : ['neu geladen']")
        except Exception:
            x = ['…']
        x = [*x, *b.d.execute_async_script(SW).values()] if x[0] != '…' else x
        if not seen or seen[-1] != x:
            seen.append(x)
        if x[0] == 'neu geladen':
            break
        time.sleep(2)
    for x in seen:
        print('   ', x)
    time.sleep(8)

put(FROM)
with Browser(420, 900) as b:
    b.open('index.html', 8)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '3.0.0', messages: [] })); localStorage.setItem('wmap.stats.asked', '1')")
    b.open('index.html', 8)
    before = state(b, f'{FROM}:')
    half = True
    if MIX:
        put_half()
        update(b)
        # Die neue Fassung darf sich nicht installieren: alte Oberfläche, ganz
        half = state(b, 'halber Upload, „Aktualisieren“:')
        b.open('index.html', 8)
        half = state(b, 'halber Upload, wieder geöffnet:') and half
        # Der gescheiterte Versuch muss bald zu Ende sein (sw.js bricht bei der ersten unpassenden Datei ab)
        for _ in range(60):
            if not version(b)[1]:
                break
            time.sleep(2)
        print('halber Upload, Versuch vorbei:', version(b))
    put(TO)
    update(b)
    after = state(b, 'nach „Aktualisieren“:')
    want = re.search(r"const VERSION = '([^']+)'", (T / 'sw.js').read_text(encoding='utf-8')).group(1)
    now = version(b)
    print('Version jetzt:', now, 'erwartet:', want)
    after = after and now[0] == want
    b.shot('update-real-1')
    b.open('index.html', 12)
    again = state(b, 'wieder geöffnet:')
    b.open('settings.html', 6)
    settings = b.js("return [!!document.querySelector('select[name=language]'), document.body.innerText.includes('Anonyme Nutzungsstatistik')]")
    print('Einstellungen (Sprache, Statistik):', settings)
    b.shot('update-real-2')
    print('Fehler:', b.errors[-10:])
    print('Karte vorher, halber Upload, danach, wieder:', before, half, after, again)
    # Beim halben Upload meldet der Service Worker das Scheitern nur in seiner Konsole – keine Fehler der Seite
    if not (before and half and after and again and settings == [True, True]):
        b.errors.append(('update_real', 'Update nicht sauber'))
    sys.exit(b.report())
