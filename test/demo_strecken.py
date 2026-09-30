"""Strecken der Beispieldaten einmal berechnen und ablegen (tools/demo-strecken.json).

tools/demo.html nimmt sie dann aus der Datei – die Screenshot-Aufnahme (takeShots) braucht den Routenserver
dafür nicht mehr. Neu laufen lassen, wenn sich die Wegpunkte in tools/demo.html ändern:

    cd test && .venv/bin/python demo_strecken.py

Fragt zehn Routen nacheinander mit Pause an (rund 20 s). Gehört nicht zur Testreihe (alle.sh).
"""
import json
import sys
from pathlib import Path
from common import Browser

OUT = Path(__file__).resolve().parent.parent / 'tools' / 'demo-strecken.json'

with Browser(width=500, height=900) as b:
    b.open('tools/demo.html?neu', wait=2)
    b.wait("return document.body.dataset.fertig", 120)
    log = b.js("return [...document.querySelectorAll('#log li')].map((l) => l.className + ' ' + l.textContent)")
    print('\n'.join(log))
    routes = b.js("return window.__demoStrecken ? JSON.stringify(window.__demoStrecken) : null")
    b.js("return 1")
    # Die Beispiele wieder aus diesem (ohnehin flüchtigen) Profil nehmen
    if not routes:
        print('Keine Strecken – Routenserver nicht erreichbar?')
        sys.exit(1)
    data = json.loads(routes)
    OUT.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print(f'{len(data)} Strecken → {OUT} ({OUT.stat().st_size // 1024} kB)')
