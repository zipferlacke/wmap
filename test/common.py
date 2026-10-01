"""Gemeinsames für die Browser-Tests: Firefox ohne Fenster, JS-Fehler sammeln.

Adresse der App: $WMAP_URL, sonst der lokale Docker-Server.
Screenshots landen in test/out/ (nicht im Repository).
"""
import os
import time
from pathlib import Path
from selenium import webdriver

BASE = os.environ.get('WMAP_URL', 'http://localhost:8080/web/wuefl_products/wmap/')
OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)
CANCELLED = 'A ServiceWorker intercepted the request and encountered an unexpected error'


class Browser:
    """with Browser() as b: b.open('index.html'); b.js('return 1'); b.errors"""

    def __init__(self, width=1300, height=900):
        o = webdriver.FirefoxOptions()
        o.add_argument('-headless')
        o.enable_bidi = True
        self.d = webdriver.Firefox(options=o)
        self.errors = []
        self.d.script.add_javascript_error_handler(lambda e: self.errors.append((self.d.current_url, e.text)))
        self.d.set_window_size(width, height)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.d.quit()

    def open(self, path, wait=3):
        self.d.get(BASE + path)
        time.sleep(wait)

    def js(self, code, *args):
        return self.d.execute_script(code, *args)

    def wait(self, code, seconds=60):
        """Wartet, bis der JS-Ausdruck (mit return) etwas Wahres liefert."""
        for _ in range(seconds * 2):
            v = self.js(code)
            if v:
                return v
            time.sleep(.5)
        return None

    def css(self, selector):
        return self.d.find_element('css selector', selector)

    def shot(self, name):
        self.d.save_screenshot(str(OUT / f'{name}.png'))

    def theme(self, mode):
        """'light' | 'dark' – gilt ab dem nächsten Laden"""
        self.js(f"localStorage.setItem('wmap.theme', '{mode}')")

    def report(self):
        # Firefox meldet abgebrochene Abrufe, die über den Service Worker liefen (Seite gewechselt,
        # Karte weiterbewegt), als „… encountered an unexpected error“ – das ist kein Fehler der
        # Seite. Solche Zeilen stehen als Hinweis im Log, lassen den Test aber nicht scheitern.
        cancelled = [e for e in self.errors if CANCELLED in e[1]]
        errors = [e for e in self.errors if CANCELLED not in e[1]]
        for url, text in cancelled:
            print('HINWEIS (abgebrochener Abruf)', url, text)
        if errors:
            for url, text in errors:
                print('FEHLER', url, text)
            return 1
        print('keine JS-Fehler')
        return 0
