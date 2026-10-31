"""Zurück-Taste wie ← (js/core/back.js): Auf Seiten, deren ← auf eine andere Seite führt, führt auch die Zurück-Taste
(Browser, Handy) dorthin – nicht an die zuvor besuchte Seite.
1. Eigene Ebenen (vom Dashboard aus geöffnet): Zurück → Karte.
2. Offline-Karten: Zurück → „Offline“.
3. Tourenplaner: Zurück → Meine Touren, Geplant."""
import sys
import time
from common import Browser, BASE

with Browser(width=420, height=900) as b:
    checks = {}
    for name, page, want in [('1. Eigene Ebenen → Karte', 'ebenen.html', 'index.html'), ('2. Offline-Karten → Offline', 'offline.html', 'offline-daten.html'),
                             ('3. Tourenplaner → Meine Touren, Geplant', 'tour.html', 'wege.html?tab=geplant')]:
        b.open('dashboard.html', wait=2)
        b.open(page, wait=3)
        b.js("history.back()")
        time.sleep(3)
        url = b.d.current_url.replace(BASE, '')
        print(page, '→', url)
        checks[name] = url.startswith(want)
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
