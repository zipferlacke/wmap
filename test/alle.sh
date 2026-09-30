#!/bin/sh
# Alle Browser-Tests nacheinander – bricht nicht ab, zeigt am Ende, was fehlschlug.
# Alles steht zugleich in out/all.log (live mitlesen: tail -f test/out/all.log).
cd "$(dirname "$0")"
PY="${PYTHON:-.venv/bin/python}"
LOG=out/all.log
mkdir -p out
echo "== Start $(date '+%Y-%m-%d %H:%M:%S')" > "$LOG"
fehler=""
for t in smoke share geo_links news offline_areas freeform track_charts hours edit_tags folder_sync folder_devices duplicates sync_progress nav_still smooth_dot ask_along update import_gpx plugin_folders planner konto_osm; do
  echo "== $t" | tee -a "$LOG"
  # -u: ungepuffert, damit das Log sofort mitläuft; der Rückgabewert geht sonst in der Pipe verloren
  { "$PY" -u "$t.py" 2>&1; echo $? > out/.rc; } | tee -a "$LOG"
  [ "$(cat out/.rc)" = 0 ] || fehler="$fehler $t"
done
rm -f out/.rc
if [ -z "$fehler" ]; then
  echo "== alles ohne JS-Fehler ($(date '+%H:%M:%S'))" | tee -a "$LOG"
else
  echo "== fehlgeschlagen:$fehler ($(date '+%H:%M:%S'))" | tee -a "$LOG"
  exit 1
fi
