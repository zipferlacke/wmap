# Tests

Browser-Tests mit Selenium und Firefox ohne Fenster gegen den lokalen
Docker-Server (`docker start php`). Jeder Test lädt Seiten, klickt sich
durch, druckt was er sieht und sammelt JS-Fehler. Der Rückgabewert ist 1,
wenn es welche gab.

```sh
cd test
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # einmal
./alle.sh                      # alle nacheinander
.venv/bin/python smoke.py      # einzeln
WMAP_URL=https://app.wuefl.de/wmap/ .venv/bin/python smoke.py   # gegen den Server
```

| Test | Was |
|---|---|
| `smoke.py` | alle Seiten laden; Health-Knopf im Browser versteckt |
| `share.py` | Teilen-Dialog (Text mit Link / nur Link) und Toast, hell und dunkel |
| `geo_links.py` | `?geo=` – Punkt, Punkt mit Namen, Adresse, Suche in der Nähe, kaputter Link |
| `news.py` | Willkommen, Neues nach Update, nichts bei Link-Aufruf, „Was ist neu“ |
| `offline_areas.py` | Offline-Karten: Größe, freie Form laden, Kachel ohne Kartenversion, löschen |
| `freeform.py` | freie Form: an der Kante einfügen, markieren + Entf, Doppeltipp |
| `edit_tags.py` | Ort bearbeiten: Beschreibung, Merkmale, alle Tags (Tag entfernen), was hochgeladen würde (OSM im Browser nachgestellt); Ortskarte mit Merkmalen |
| `sync_progress.py` | Abgleich mit Fortschritt: Abbruch mittendrin (Seitenwechsel), der nächste liest nur den Rest; Seite zeigt „x von n (… %)“, Sicherung klappt mit Ordner zu. Standort in der App: eine gemeinsame Abfrage für Navigation und Aufzeichnung, jede Sekunde |
| `plugin_folders.py` | Plugin-Ordner: lose GeoJSON/JS, `wmap-plugin.json` (Ebene, Kacheln, Erweiterung), kaputte Datei, neu einlesen behält Schalter, Erweiterung startet; Firefox nur einmal einlesen; Anleitung |
| `konto_osm.py` | Konto über OpenStreetMap: id_token prüfen (Testschlüssel statt OSM), Konto anlegen/übernehmen/löschen; im Browser Rückkehr von OSM, Einstellungen, Abmelden, Konto löschen |

Screenshots landen in `test/out/`. `common.py` hat die Hilfen (`Browser`,
`open`, `js`, `wait`, `shot`, `theme`).

**Nachrichten und minVersion** lassen sich nur mit einer geänderten
`appdata/messages.json` prüfen: `minVersion` über die laufende Version setzen
und eine Nachricht mit neuer `id` eintragen, `news.py` laufen lassen, Datei
zurücksetzen (`git checkout appdata/messages.json`).

**Health Connect** geht nur in der Android-App auf dem Handy – siehe
`src-tauri/README.md`.
