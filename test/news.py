"""Willkommen beim ersten Start, Neues nach Update, nichts bei Link-Aufruf, „Was ist neu“ im Dashboard.
Nachrichten und minVersion: messages.json vorübergehend ändern (siehe README) und erneut starten."""
import sys
import time
from common import Browser


def dialog(b):
    time.sleep(6)
    return b.js("const d = document.querySelector('dialog.news[open]'); return d && [d.querySelector('.uD-title').textContent.trim(), d.querySelectorAll('.news-release').length]")


def ok(b):
    b.js("document.querySelector('dialog.news[open] button[value=ok]')?.click()")
    time.sleep(.8)


with Browser(1200, 850) as b:
    b.open('index.html', 0)
    print('1. erster Start:', dialog(b))
    b.shot('news-welcome')
    ok(b)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '0.9.0', messages: [] }))")
    b.open('index.html', 0)
    print('2. nach Update von 0.9.0:', dialog(b))
    ok(b)
    b.open('index.html?q=Bäckerei', 0)
    print('3. mit Link (nichts):', dialog(b))
    b.open('dashboard.html', 1)
    b.css('.dash-version').click()
    time.sleep(1)
    print('4. Dashboard „Was ist neu“:', b.js("return document.querySelector('dialog.news[open] .uD-title')?.textContent.trim()"))
    sys.exit(b.report())
