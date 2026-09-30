#!/usr/bin/env python3
"""
Versionsnummer überall eintragen – aus dem obersten Eintrag im Changelog
von appdata/messages.json:

    python3 appdata/version.py           eintragen, zeigt was sich ändert
    python3 appdata/version.py --pruefen nur prüfen (Rückgabe 1, wenn etwas abweicht;
                                         ohne libs/wuefl-libs, etwa im Export von
                                         git-release, ohne deren Dateien)

Ziele:
    js/core/config.js           APP_VERSION (Anzeige, Neuigkeiten, minVersion)
    sw.js                       VERSION – neue Nummer = neuer Service Worker = Update
    appdata/sw-files.json       was der Service Worker vorab lädt (alle Dateien,
                                die die Seiten über import/@import/url()/src/href
                                erreichen – aus wuefl-libs nur die genutzten)
    src-tauri/tauri.conf.json   Version der App (Android: versionCode daraus)
    src-tauri/Cargo.toml        Version des Rust-Pakets
    src-tauri/Cargo.lock        dieselbe, damit Cargo nichts nachträgt

git-release ruft das Skript vor dem Tag auf, wenn es da ist.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def target_version():
    log = json.loads((ROOT / 'appdata/messages.json').read_text(encoding='utf-8')).get('changelog') or []
    if not log or not re.fullmatch(r'\d+\.\d+\.\d+', str(log[0].get('version', ''))):
        sys.exit('messages.json: oberster Changelog-Eintrag ohne gültige Version (x.y.z)')
    return log[0]['version']


# Datei, Muster (Gruppe 1 = davor, Gruppe 2 = Version, Gruppe 3 = danach)
TARGETS = [
    ('js/core/config.js', r"(export const APP_VERSION = ')([^']+)(')"),
    ('sw.js', r"(const VERSION = ')([^']+)(')"),
    ('src-tauri/tauri.conf.json', r'(\n  "version": ")([^"]+)(")'),
    ('src-tauri/Cargo.toml', r'(\[package\][^\[]*?\nversion = ")([^"]+)(")'),
    ('src-tauri/Cargo.lock', r'(\nname = "wmap"\nversion = ")([^"]+)(")'),
]


# Seiten und was sonst ohne Verweis gebraucht wird (Manifest, Symbole, Neuigkeiten)
EXTRA = ['./', 'appdata/manifest.json', 'appdata/messages.json', 'appdata/logo.svg', 'appdata/logo.png',
         'appdata/wmap-192.png', 'appdata/wmap-512.png', 'appdata/wmap-maskable-192.png']
REF = [
    re.compile(r'''(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]'''),       # import … from '…', import('…')
    re.compile(r'''@import\s+(?:url\()?\s*['"]?([^'")\s;]+)'''),           # @import
    re.compile(r'''url\(\s*['"]?([^'")]+)['"]?\s*\)'''),                    # url(…)
    re.compile(r'''(?:src|href)\s*=\s*["']([^"'#]+)["']'''),                # src=, href=
]


def app_files():
    """Alle Dateien, die von den Seiten aus erreichbar sind – relativ zu sw.js"""
    todo = sorted(ROOT.glob('*.html'))
    seen = set()
    while todo:
        f = todo.pop()
        if f in seen or not f.is_file():
            continue
        seen.add(f)
        if f.suffix not in ('.html', '.js', '.mjs', '.css'):
            continue
        text = f.read_text(encoding='utf-8', errors='ignore')
        for rx in REF:
            for ref in rx.findall(text):
                ref = ref.split('?')[0].split('#')[0]
                if not ref or re.match(r'^([a-z]+:|//|/|\$\{)', ref, re.I):
                    continue
                # Verweise in wuefl-libs gehen über den Symlink – Pfad über libs/ behalten
                target = Path(os.path.normpath(f.parent / ref))
                if target.is_file() and ROOT in target.parents:
                    todo.append(target)
    files = sorted(str(p.relative_to(ROOT)) for p in seen)
    files = [x for x in files if not x.startswith(('test/', 'src-tauri/', 'bEnd/'))]
    return EXTRA + [x for x in files if x not in EXTRA]


LIBS = 'libs/wuefl-libs/'


def write_files(check):
    path = ROOT / 'appdata/sw-files.json'
    files = app_files()
    text = json.dumps(files, ensure_ascii=False, indent=0) + '\n'
    old = path.read_text(encoding='utf-8') if path.exists() else ''
    if old == text:
        return None
    # git-release prüft einen Export (git archive) – dort fehlt libs/wuefl-libs
    # (Verweis aufs Nachbarprojekt, in .gitignore). Dann nur den Rest vergleichen.
    if check and not (ROOT / LIBS).is_dir():
        try:
            before = [x for x in json.loads(old) if not x.startswith(LIBS)]
        except ValueError:
            before = None
        if before == [x for x in files if not x.startswith(LIBS)]:
            return None
    if not check:
        path.write_text(text, encoding='utf-8')
    return 'appdata/sw-files.json: Dateiliste neu'


def main():
    check = '--pruefen' in sys.argv[1:]
    version = target_version()
    off = []
    for rel, pattern in TARGETS:
        path = ROOT / rel
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        m = re.search(pattern, text)
        if not m:
            sys.exit(f'{rel}: Versionsstelle nicht gefunden')
        if m.group(2) == version:
            continue
        off.append(f'{rel}: {m.group(2)} → {version}')
        if not check:
            path.write_text(text[:m.start(2)] + version + text[m.end(2):], encoding='utf-8')
    files = write_files(check)
    if files:
        off.append(files)
    if not off:
        print(f'Version {version} steht überall.')
        return 0
    print(('Weicht ab:' if check else f'Version {version} eingetragen:') + '\n  ' + '\n  '.join(off))
    return 1 if check else 0


if __name__ == '__main__':
    sys.exit(main())
