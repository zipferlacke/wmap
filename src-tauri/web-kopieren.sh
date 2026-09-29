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
cp -rL libs/wuefl-libs libs/maplibre-gl libs/echarts libs/earcut "$OUT/libs/"
rm -rf "$OUT/libs/wuefl-libs/.git"
cp appdata/manifest.json appdata/messages.json appdata/logo.svg appdata/logo.png appdata/wmap-*.png "$OUT/appdata/"
cp -r appdata/icons "$OUT/appdata/"
# Start der App: zur Webversion wechseln, wenn sie erreichbar ist (tauri-start.js).
# Nicht im Debug-Build (Tauri setzt TAURI_ENV_DEBUG): der zeigt die Dateien
# von hier – so lässt sich Neues auf dem Handy testen, bevor es hochgeladen ist.
if [ "${TAURI_ENV_DEBUG:-false}" != "true" ]; then
  cp src-tauri/tauri-start.js "$OUT/"
  # Zum Testen eine andere Webversion (z. B. den lokalen Server) – die Adresse
  # muss dann auch in src-tauri/capabilities unter „remote“ stehen
  if [ -n "${WMAP_REMOTE:-}" ]; then
    sed -i.bak "s|const REMOTE = 'https://app.wuefl.de/wmap/';|const REMOTE = '$WMAP_REMOTE';|" "$OUT/tauri-start.js" && rm "$OUT/tauri-start.js.bak"
    echo "Webversion zum Testen: $WMAP_REMOTE"
  fi
  # -i.bak statt -i: geht mit GNU-sed (Linux) und BSD-sed (macOS, GitHub Actions)
  sed -i.bak 's|<head>|<head>\
    <script src="./tauri-start.js"></script>|' "$OUT/index.html" && rm "$OUT/index.html.bak"
else
  echo "Debug-Build: bleibt bei den eingepackten Dateien (ohne tauri-start.js)"
fi
echo "$OUT bereit: $(du -sh "$OUT" | cut -f1)"
