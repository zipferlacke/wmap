#!/bin/sh
# Web-Dateien für die Tauri-App nach dist/ kopieren – Symlinks aufgelöst
# (libs/wuefl-libs zeigt auf das Nachbarprojekt), ohne Werbung und Screenshots.
# Läuft automatisch vor `cargo tauri build` (beforeBuildCommand).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/appdata dist/libs
cp ./*.html sw.js dist/
cp -r css js dist/
cp -rL libs/wuefl-libs dist/libs/
rm -rf dist/libs/wuefl-libs/.git
cp appdata/manifest.json appdata/messages.json appdata/logo.svg appdata/logo.png appdata/wmap-*.png dist/appdata/
cp -r appdata/icons dist/appdata/
echo "dist/ bereit: $(du -sh dist | cut -f1)"
