"""Willkommen beim ersten Start, Neues nach Update, nichts bei Link-Aufruf, „Was ist neu“ im Dashboard.
Nachrichten und minVersion: messages.json vorübergehend ändern (siehe README) und erneut starten."""
import json
import sys
import time
from common import Browser

LANG = '../appdata/lang/'
title = lambda c: 'waving_hand ' + json.load(open(f'{LANG}{c}.json', encoding='utf-8'))['news']['welcome']['title']
codes = [l['code'] for l in json.load(open(f'{LANG}languages.json', encoding='utf-8'))]


def pick(b, code):
    """Sprache in der Begrüßung wählen → Seite lädt neu und begrüßt in ihr"""
    b.js(f"const s = document.querySelector('dialog.news[open] select[name=language]'); s.value = '{code}'; s.dispatchEvent(new Event('change', {{ bubbles: true }}));")
    time.sleep(2)


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
    choice = b.js("const s = document.querySelector('dialog.news[open] select[name=language]'); return s && [s.value, [...s.options].map((o) => o.value)]")
    stats = b.js("const c = document.querySelector('dialog.news[open] input[name=stats]'); return c && [c.checked, localStorage.getItem('wmap.stats.asked')]")
    # Farbschema gleich hier: wirkt sofort, ohne neu zu laden
    b.js("const s = document.querySelector('dialog.news[open] select[name=theme]'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true }));")
    dark = b.js("return [localStorage.getItem('wmap.theme'), !!document.querySelector('dialog.news[open]')]")
    pick(b, 'en_GB')
    english = dialog(b)
    pick(b, 'de_DE')
    german = dialog(b)
    langs_ok = choice == ['de_DE', codes] and dark == ['dark', True] and stats == [True, '1'] and english[0] == title('en_GB') and german[0] == title('de_DE')
    print('1b. Sprache, Farbschema und Statistik in der Begrüßung:', choice, dark, stats, english, german, '→', langs_ok)
    if not langs_ok:
        b.errors.append(('news', 'Sprachwahl in der Begrüßung stimmt nicht'))
    ok(b)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '0.9.0', messages: [] }))")
    b.open('index.html', 0)
    print('2. nach Update von 0.9.0:', dialog(b))
    ok(b)
    # Wer WMap schon kannte: einmal nach der Statistik fragen, Vorgabe erlauben; „Nicht senden“ schaltet sie aus
    b.js("localStorage.removeItem('wmap.stats.asked'); localStorage.removeItem('wmap.stats')")
    b.open('index.html', 0)
    asked = dialog(b)
    b.js("document.querySelector('dialog.news[open] button[value=no]')?.click()")
    time.sleep(.8)
    after = b.js("return [localStorage.getItem('wmap.stats'), localStorage.getItem('wmap.stats.asked')]")
    b.open('index.html', 0)
    again = dialog(b)
    stats_ok = asked and asked[0] == 'bar_chart Anonyme Nutzungsstatistik' and after == ['0', '1'] and again is None
    print('2b. Statistik einmal fragen:', asked, after, again, '→', stats_ok)
    if not stats_ok:
        b.errors.append(('news', 'Frage nach der Statistik stimmt nicht'))
    b.open('index.html?q=Bäckerei', 0)
    print('3. mit Link (nichts):', dialog(b))
    b.open('dashboard.html', 1)
    b.css('.dash-version').click()
    time.sleep(1)
    print('4. Dashboard „Was ist neu“:', b.js("return document.querySelector('dialog.news[open] .uD-title')?.textContent.trim()"))
    sys.exit(b.report())
