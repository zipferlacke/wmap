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
                                BUILD – Prüfsumme über alle Dateien aus sw-files.json:
                                ändert sich eine Datei bei gleicher Nummer, ist es
                                trotzdem ein neuer Service Worker mit eigenem Speicher
    appdata/lang/languages.json welche Sprachen es gibt (eine Datei je Sprache im selben Ordner)
    appdata/sw-files.json       was der Service Worker vorab lädt (alle Dateien,
                                die die Seiten über import/@import/url()/src/href
                                erreichen – aus wuefl-libs nur die genutzten), mit
                                BUILD und je Datei einem Prüfwert (sw.js precache)
    src-tauri/tauri.conf.json   Version der App (Android: versionCode daraus)
    src-tauri/Cargo.toml        Version des Rust-Pakets
    src-tauri/Cargo.lock        dieselbe, damit Cargo nichts nachträgt

git-release ruft das Skript vor dem Tag auf, wenn es da ist.
"""
import hashlib
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
    re.compile(r'''new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url'''),  # new URL('…', import.meta.url)
]


def app_files():
    """Alle Dateien, die von den Seiten aus erreichbar sind – relativ zu sw.js"""
    # dazu der Service Worker als Modul (sw-app.js → js/sw/sync.js)
    todo = sorted(ROOT.glob('*.html')) + [ROOT / 'sw-app.js']
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
    # sw.js selbst nicht: Es trägt BUILD, die Prüfsumme über diese Liste
    files = [x for x in files if not x.startswith(('test/', 'src-tauri/', 'bEnd/')) and x != 'sw.js']
    lang = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'appdata/lang').glob('*.json'))
    return EXTRA + lang + [x for x in files if x not in EXTRA and x not in lang]


def write_languages(check):
    """appdata/lang/languages.json: was im Ordner liegt, mit dem Namen aus der Datei"""
    folder = ROOT / 'appdata/lang'
    path = folder / 'languages.json'
    found = [{'code': f.stem, 'name': json.loads(f.read_text(encoding='utf-8'))['_meta']['name']}
             for f in sorted(folder.glob('*.json')) if f != path]
    text = json.dumps(found, ensure_ascii=False, indent=1) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return None
    if not check:
        path.write_text(text, encoding='utf-8')
    return 'appdata/lang/languages.json: Sprachen neu'


LIBS = 'libs/wuefl-libs/'


LIST = 'appdata/sw-files.json'


def file_hashes():
    """Je Datei der Anfang ihres SHA-256 – der Service Worker vergleicht beim Vorladen (sw.js precache). Die Liste
    selbst ohne Prüfwert (null): Sie trägt BUILD und hinge sonst von sich selbst ab."""
    out = {}
    for rel in app_files():
        f = ROOT / ('index.html' if rel == './' else rel)
        if rel == LIST:
            out[rel] = None
        elif f.is_file():
            out[rel] = hashlib.sha256(f.read_bytes()).hexdigest()[:12]
    return out


def build_of(hashes):
    """BUILD: Prüfsumme über alle Prüfwerte"""
    h = hashlib.sha256()
    for rel, sha in hashes.items():
        if sha:
            h.update(f'{rel}\0{sha}\0'.encode())
    return h.hexdigest()[:10]


def write_files(check, hashes, build):
    """appdata/sw-files.json: { build, files: { Pfad: Prüfwert } } – gehört genau zu diesem sw.js (BUILD). Passt
    beim Vorladen eine Datei nicht (Upload noch nicht fertig), installiert sich die Fassung nicht."""
    path = ROOT / LIST
    text = json.dumps({'build': build, 'files': hashes}, ensure_ascii=False, indent=0) + '\n'
    old = path.read_text(encoding='utf-8') if path.exists() else ''
    if old == text:
        return None
    # git-release prüft einen Export (git archive) – dort fehlt libs/wuefl-libs
    # (Verweis aufs Nachbarprojekt, in .gitignore). Dann nur den Rest vergleichen.
    if check and not (ROOT / LIBS).is_dir():
        try:
            before = {k: v for k, v in json.loads(old)['files'].items() if not k.startswith(LIBS)}
        except (ValueError, KeyError, TypeError, AttributeError):
            before = None
        if before == {k: v for k, v in hashes.items() if not k.startswith(LIBS)}:
            return None
    if not check:
        path.write_text(text, encoding='utf-8')
    return f'{LIST}: Dateiliste neu'


BUILD = r"(const BUILD = ')([^']*)(')"


def write_build(check, build):
    """BUILD in sw.js – ändert sich eine Datei bei gleicher Nummer, ist es trotzdem ein neuer Service Worker"""
    # Im Export von git-release fehlt libs/wuefl-libs – dort lässt sich nichts prüfen
    if check and not (ROOT / LIBS).is_dir():
        return None
    path = ROOT / 'sw.js'
    text = path.read_text(encoding='utf-8')
    m = re.search(BUILD, text)
    if not m:
        sys.exit('sw.js: BUILD nicht gefunden')
    if m.group(2) == build:
        return None
    if not check:
        path.write_text(text[:m.start(2)] + build + text[m.end(2):], encoding='utf-8')
    return f'sw.js: Stand {m.group(2)} → {build}'


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
    langs = write_languages(check)
    if langs:
        off.append(langs)
    hashes = file_hashes()
    build = build_of(hashes)
    files = write_files(check, hashes, build)
    if files:
        off.append(files)
    stand = write_build(check, build)
    if stand:
        off.append(stand)
    if not off:
        print(f'Version {version} steht überall.')
        return 0
    print(('Weicht ab:' if check else f'Version {version} eingetragen:') + '\n  ' + '\n  '.join(off))
    return 1 if check else 0


if __name__ == '__main__':
    sys.exit(main())
