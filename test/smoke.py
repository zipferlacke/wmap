"""Alle Seiten laden – keine JS-Fehler."""
import sys
from common import Browser

PAGES = ['index.html', 'dashboard.html', 'wege.html', 'wege.html?tab=geplant', 'wege.html?tab=bahn', 'tour.html',
         'entdecken.html', 'plugins.html', 'settings.html', 'ebenen.html', 'deleteKonto.html', 'offline.html', 'sync.html', 'plugin-anleitung.html', 'import.html',
         'offline.html?neu', 'index.html?from=9.9338,51.5374&to=9.4467,51.3130&profile=transit']

with Browser() as b:
    for p in PAGES:
        b.open(p, wait=6 if 'transit' in p else 3)
    # Health Connect gibt es nur in der Android-App
    b.open('wege.html')
    print('Health-Knopf im Browser versteckt:', not b.js("return document.querySelector('[data-tool=health]')"))
    sys.exit(b.report())
