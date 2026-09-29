"""Karten-Links geo: über ?geo= – Punkt, Punkt mit Namen, Adresse, Suche in der Nähe, kaputt."""
import sys
import urllib.parse
from common import Browser

CASES = ['geo:51.5319,9.9355', 'geo:0,0?q=51.5319,9.9355(Gänseliesel)', 'geo:0,0?q=Weender+Straße+Göttingen',
         'geo:51.53,9.93?z=15&q=Bäckerei', 'geo:kaputt']

with Browser(1200, 850) as b:
    for c in CASES:
        b.open('index.html?geo=' + urllib.parse.quote(c, safe=''), 6)
        print(c, '→', b.js("""return [document.querySelector('#sheet, .sheet')?.dataset.current,
          document.querySelector('[data-view=place] h2, [data-view=place] .place-title')?.textContent?.trim()]"""))
    sys.exit(b.report())
