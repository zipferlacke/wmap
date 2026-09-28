#!/bin/sh
# Fremde Bibliotheken nach libs/ holen – feste Versionen, damit Web, App und
# Offline-Cache dasselbe laden. Neue Version: Nummer hier ändern, Skript
# laufen lassen, testen, committen.
#   MapLibre GL JS  Karte                       libs/maplibre-gl/
#   Apache ECharts  Höhenprofil (elevation.js)  libs/echarts/
set -e
cd "$(dirname "$0")/.."
MAPLIBRE=5.24.0
ECHARTS=5.6.0

mkdir -p libs/maplibre-gl libs/echarts
for f in maplibre-gl.js maplibre-gl.css LICENSE.txt; do
  curl -fsSL "https://unpkg.com/maplibre-gl@$MAPLIBRE/$( [ "$f" = LICENSE.txt ] && echo "$f" || echo "dist/$f" )" -o "libs/maplibre-gl/$f"
done
curl -fsSL "https://unpkg.com/echarts@$ECHARTS/dist/echarts.esm.min.js" -o libs/echarts/echarts.esm.min.js
curl -fsSL "https://unpkg.com/echarts@$ECHARTS/LICENSE" -o libs/echarts/LICENSE
echo "maplibre-gl $MAPLIBRE" > libs/VERSIONEN.txt
echo "echarts $ECHARTS" >> libs/VERSIONEN.txt
du -sh libs/maplibre-gl libs/echarts
