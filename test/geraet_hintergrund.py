"""Gerätetest (nicht in alle.sh): Aufzeichnen mit ausgeschaltetem Bildschirm – kommen weiter GPS-Punkte?
Braucht ein per USB verbundenes, ENTSPERRTES Handy mit der Debug-App (de.wuefl.wmap.debug), Standort an.

Ablauf: App starten → Aufzeichnung starten (js/data/tracks.js recorder) → Bildschirm aus (Einschaltknopf per adb)
→ 30 s warten → beim Dienst abholen, was er gesammelt hat (plugin:geolocation|take_recorded) → mindestens 5 Punkte?
→ Aufzeichnung verwerfen. Gesteuert wird die Seite über die WebView-Diagnose (nur im Debug-Build offen).

    test/.venv/bin/python -u test/geraet_hintergrund.py [Sekunden]
"""
import json
import subprocess
import sys
import time
import urllib.request
import websocket

PKG = 'de.wuefl.wmap.debug'
PORT = 9334
WAIT = int(sys.argv[1]) if len(sys.argv) > 1 else 30


def adb(*args):
    return subprocess.run(['adb', *args], capture_output=True, text=True).stdout.strip()


if 'device' not in adb('devices').split('\n', 1)[-1]:
    print('FEHLER kein Handy per adb verbunden'); sys.exit(2)
if 'isKeyguardShowing=true' in adb('shell', 'dumpsys', 'window'):
    print('FEHLER das Handy ist gesperrt – bitte entsperren und noch einmal starten'); sys.exit(2)

adb('shell', 'am', 'force-stop', PKG)
adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
time.sleep(8)
pid = adb('shell', 'pidof', PKG)
adb('forward', f'tcp:{PORT}', f'localabstract:webview_devtools_remote_{pid}')
pages = [p for p in json.load(urllib.request.urlopen(f'http://localhost:{PORT}/json')) if p.get('type') == 'page' and p.get('url', '').startswith('http')]
print('Seite:', pages[0]['url'])
ws = websocket.create_connection(pages[0]['webSocketDebuggerUrl'], suppress_origin=True)
n = 0


def js(code):
    """Ausdruck in der Seite auswerten (async erlaubt) → Wert"""
    global n
    n += 1
    ws.send(json.dumps({'id': n, 'method': 'Runtime.evaluate', 'params': {'expression': f'(async () => {{ {code} }})()', 'awaitPromise': True, 'returnByValue': True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == n:
            r = m['result']
            if 'exceptionDetails' in r:
                raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description', str(r['exceptionDetails'])))
            return r['result'].get('value')


TAKE = "const r = await window.__TAURI__.core.invoke('plugin:geolocation|take_recorded'); return { n: r.points.length, running: r.running, always: !!r.always, first: r.points[0] ?? null, last: r.points.at(-1) ?? null };"
if js("const { recorder } = await import('./js/data/tracks.js'); return recorder.active;"):
    print('FEHLER auf dem Handy läuft schon eine Aufzeichnung – die fasse ich nicht an'); sys.exit(2)
js("const { recorder } = await import('./js/data/tracks.js'); recorder.start({ kind: 'rec', profile: 'foot', name: 'Gerätetest Hintergrund' }); return true;")
time.sleep(6)
before = js(TAKE)
print('läuft, Bildschirm an:', before)
adb('shell', 'input', 'keyevent', '26')   # Einschaltknopf: Bildschirm aus
time.sleep(2)
print('Bildschirm:', [l.strip() for l in adb('shell', 'dumpsys', 'power').split('\n') if 'mWakefulness=' in l])
time.sleep(WAIT)
got = js(TAKE)
print(f'nach {WAIT} s mit Bildschirm aus:', got)
js("const { recorder } = await import('./js/data/tracks.js'); recorder.discard(); return true;")
time.sleep(1)
after = js(TAKE)
adb('shell', 'input', 'keyevent', '224')  # wieder wecken
checks = {
    'Dienst läuft und sammelt immer (always)': bool(before['running'] and before['always']),
    f'Bildschirm aus, {WAIT} s: mindestens 5 Punkte vom Dienst': got['n'] >= 5,
    'die Punkte stammen aus der Zeit mit Bildschirm aus': bool(got['first']) and got['last']['timestamp'] - got['first']['timestamp'] >= 8000 if got['n'] >= 2 and isinstance(got['first'], dict) and 'timestamp' in got['first'] else got['n'] >= 5,
    'nach dem Verwerfen läuft der Dienst nicht mehr': not after['running'],
}
for k, v in checks.items():
    print(('ok    ' if v else 'FALSCH') + ' ' + k)
sys.exit(0 if all(checks.values()) else 1)
