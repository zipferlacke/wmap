#!/bin/sh
# Alle Browser-Tests nacheinander – bricht nicht ab, zeigt am Ende, was fehlschlug.
# Alles steht zugleich in out/all.log (live mitlesen: tail -f test/out/all.log).
cd "$(dirname "$0")"
PY="${PYTHON:-.venv/bin/python}"
LOG=out/all.log
mkdir -p out
echo "== Start $(date '+%Y-%m-%d %H:%M:%S')" > "$LOG"
fehler=""
for t in smoke i18n servers stats transit_earlier line_search search_offline poi_hide dialogs share geo_links news offline_areas freeform track_charts list_fresh list_pick track_compare track_names near_filter back_key health_power hours edit_tags folder_sync folder_devices folder_drop folder_shelf storage_full duplicates duplicates_ask sync_progress sw_sync record_bg record_follow offline_data track_look tour_actions nav_still smooth_dot locate map_look street street_roofs tilt_gestures tilt_labels poi_icons poi_order my_places search_direct source_retry ask_along drive_target car car_send car_share update import_gpx import_merge import_drop short_link tour_collab plugin_folders planner konto_osm; do
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
