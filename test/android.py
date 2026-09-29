"""JavaScript in der Debug-App auf dem Handy ausführen (WebView-Debugging über adb).

    .venv/bin/python android.py "return location.href"
    .venv/bin/python android.py --datei skript.js
    .venv/bin/python android.py --seite wege.html "return document.title"

Startet die App, falls sie nicht läuft (Paket $WMAP_PAKET, Standard
de.wuefl.wmap.debug). Der Code läuft als async-Funktion – `await` geht.
Braucht: adb mit verbundenem Handy, `pip install websocket-client`.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import websocket

PAKET = os.environ.get('WMAP_PAKET', 'de.wuefl.wmap.debug')
PORT = 9333


def adb(*args):
    return subprocess.run(['adb', *args], capture_output=True, text=True).stdout


def socket():
    for _ in range(20):
        m = re.search(r'webview_devtools_remote_\d+', adb('shell', 'cat', '/proc/net/unix'))
        if m:
            return m.group(0)
        adb('shell', 'monkey', '-p', PAKET, '-c', 'android.intent.category.LAUNCHER', '1')
        time.sleep(2)
    sys.exit('Kein WebView zum Debuggen – läuft die Debug-App?')


def page():
    adb('forward', f'tcp:{PORT}', f'localabstract:{socket()}')
    pages = json.load(urllib.request.urlopen(f'http://localhost:{PORT}/json'))
    return next(p for p in pages if p['type'] == 'page')


class Remote:
    def __init__(self):
        self.ws = websocket.create_connection(page()['webSocketDebuggerUrl'], timeout=600)
        self.n = 0

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self.n:
                return msg

    def run(self, code):
        r = self.call('Runtime.evaluate', expression=f'(async () => {{ {code} }})()', awaitPromise=True, returnByValue=True)
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            d = res['exceptionDetails']
            return f"FEHLER: {d.get('exception', {}).get('description') or d.get('text')}"
        return res.get('result', {}).get('value')

    def open(self, path, wait=4):
        self.run(f"location.href = '/{path}'; return 1")
        time.sleep(wait)


if __name__ == '__main__':
    args = sys.argv[1:]
    r = Remote()
    if args[:1] == ['--seite']:
        r.open(args[1])
        args = args[2:]
    code = open(args[1]).read() if args[:1] == ['--datei'] else ' '.join(args)
    out = r.run(code)
    print(json.dumps(out, ensure_ascii=False, indent=2) if not isinstance(out, str) else out)
