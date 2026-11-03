"""Sprachen (js/core/i18n.js, appdata/lang/): Texte kommen aus de_DE.json, alle benutzten Schlüssel gibt es, weitere Sprache: in den Einstellungen wählbar, die Karte bietet sie einmal an, was ihr fehlt, bleibt Deutsch."""
import json
import re
import sys
import time
from pathlib import Path
from common import Browser

ROOT = Path(__file__).resolve().parent.parent
LANG = ROOT / 'appdata/lang'
de = json.loads((LANG / 'de_DE.json').read_text(encoding='utf-8'))
def has(key):
    d = de
    for k in key.split('.'):
        if not isinstance(d, dict) or k not in d:
            return False
        d = d[k]
    return True
# Feste Schlüssel im Code und im HTML
used = set()
for f in [*ROOT.glob('js/**/*.js'), *ROOT.glob('*.html')]:
    if f.name == 'i18n.js':
        continue
    used |= set(re.findall(r"\bt\('([\w.]+)'", f.read_text(encoding='utf-8')))
    used |= set(re.findall(r'data-i18n(?:-[\w-]+)?="([\w.]+)"', f.read_text(encoding='utf-8')))
missing = sorted(k for k in used if not has(k))
print('Schlüssel benutzt:', len(used), '· fehlen:', missing)

extra = LANG / 'en_GB.json'
listing = LANG / 'languages.json'
before = listing.read_text(encoding='utf-8')
kept = extra.read_text(encoding='utf-8') if extra.exists() else None   # echte Übersetzung nicht verlieren
try:
    extra.write_text(json.dumps({'_meta': {'name': 'English', 'locale': 'en-GB'},
        'settings': {'title': 'Settings', 'look': {'title': 'Appearance'}},
        'common': {'language': {'offer_title': '{name} is available', 'offer_text': 'x', 'switch': 'Switch', 'stay': 'Not now'}}}), encoding='utf-8')
    listing.write_text(json.dumps([{'code': 'de_DE', 'name': 'Deutsch'}, {'code': 'en_GB', 'name': 'English'}]), encoding='utf-8')
    with Browser(width=420, height=900) as b:
        b.open('settings.html', wait=2)
        german = b.js("return [document.querySelector('h1').textContent, document.querySelector('.settings h3').textContent, document.documentElement.lang, !!document.querySelector('select[name=language]')]")
        print('Deutsch:', german)
        b.js("const s = document.querySelector('select[name=language]'); s.value = 'en_GB'; s.dispatchEvent(new Event('change', { bubbles: true }));")
        time.sleep(2)
        english = b.js("return [document.querySelector('h1').textContent, document.querySelector('.settings h3').textContent, document.documentElement.lang, [...document.querySelectorAll('.settings h3')][1].textContent]")
        print('Englisch, Rest Deutsch:', english)
        # Angebot: kennt WMap schon (Begrüßung gesehen), Gerät auf Englisch, nichts gewählt
        b.js("localStorage.removeItem('wmap.lang'); localStorage.removeItem('wmap.lang.asked'); localStorage.setItem('wmap.seen', JSON.stringify({ version: '3.1.0', messages: [] })); localStorage.setItem('wmap.stats.asked', '1');")
        b.open('settings.html', wait=2)
        b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = \"Object.defineProperty(navigator, 'languages', { value: ['en-US'] }); const i = await import('./js/core/i18n.js'); window.__offer = await i.languageOffer(); window.__match = [i.matchLanguage(['de_DE', 'en_GB'], ['fr-FR', 'en-US']), i.matchLanguage(['de_DE'], ['fr-FR'])]; window.__first = [i.firstLanguage(['de_DE', 'en_GB'], ['fr-FR']), i.firstLanguage(['de_DE', 'en_GB'], ['de-AT', 'en'])];\"; document.head.append(s);")
        time.sleep(1)
        offer = b.js("return [window.__offer?.code, window.__offer?.name, window.__match]")
        print('Angebot:', offer)
        # Erster Start: Sprache des Geräts, gibt es sie nicht, Englisch
        first = b.js("return window.__first")
        print('Erster Start:', first)
    ok = not missing and german == ['Einstellungen', 'Darstellung', 'de', True] \
        and english == ['Settings', 'Appearance', 'en', 'Unterwegs'] and offer == ['en_GB', 'English', ['en_GB', None]] and first == ['en_GB', 'de_DE']
finally:
    if kept is None: extra.unlink(missing_ok=True)
    else: extra.write_text(kept, encoding='utf-8')
    listing.write_text(before, encoding='utf-8')
print('stimmt:', ok)
sys.exit(0 if ok else 1)
