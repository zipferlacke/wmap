#!/bin/sh
# Web-Dateien für die Tauri-App nach src-tauri/web/ kopieren – Symlinks
# aufgelöst (libs/wuefl-libs zeigt auf das Nachbarprojekt), ohne Werbung und
# Screenshots. Läuft automatisch vor `cargo tauri build` (beforeBuildCommand).
# Die Kopie ist generiert und steht nicht in Git.
set -e
cd "$(dirname "$0")/.."
OUT=src-tauri/web
rm -rf "$OUT"
mkdir -p "$OUT/appdata" "$OUT/libs"
cp ./*.html sw.js "$OUT/"
cp -r css js "$OUT/"
cp -rL libs/wuefl-libs "$OUT/libs/"
rm -rf "$OUT/libs/wuefl-libs/.git"
cp appdata/manifest.json appdata/messages.json appdata/logo.svg appdata/logo.png appdata/wmap-*.png "$OUT/appdata/"
cp -r appdata/icons "$OUT/appdata/"
echo "$OUT bereit: $(du -sh "$OUT" | cut -f1)"
