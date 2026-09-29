#!/bin/sh
# Alle Browser-Tests nacheinander – bricht nicht ab, zeigt am Ende, was fehlschlug.
cd "$(dirname "$0")"
PY="${PYTHON:-.venv/bin/python}"
fehler=""
for t in smoke share geo_links news offline_areas freeform track_charts hours edit_tags folder_sync plugin_folders planner konto_osm; do
  echo "== $t"
  "$PY" "$t.py" || fehler="$fehler $t"
done
[ -z "$fehler" ] && echo "== alles ohne JS-Fehler" || { echo "== fehlgeschlagen:$fehler"; exit 1; }
