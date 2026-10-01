# Tests

Browser-Tests mit Selenium und Firefox ohne Fenster gegen den lokalen
Docker-Server (`docker start php`). Jeder Test lädt Seiten, klickt sich
durch, druckt was er sieht und sammelt JS-Fehler. Der Rückgabewert ist 1,
wenn es welche gab.

```sh
cd test
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # einmal
./alle.sh                      # alle nacheinander, Log in out/all.log (tail -f zum Mitlesen)
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
| `edit_tags.py` | Ort bearbeiten: Beschreibung, Merkmale, alle Tags (Tag entfernen), was hochgeladen würde (OSM im Browser nachgestellt); Ortskarte mit Merkmalen; Ladesäule: Angaben je Art (Stecker mit Anzahl und Leistung, Ladepunkte, Gebühr, Bezahlung), am Feld geöffnet, `contact:website` bleibt; Ortskarte mit antippbaren Angaben |
| `folder_sync.py` | Ordner-Abgleich: neue Ordnung, Umzug aus der alten, fremde GPX bleiben, Bus & Bahn je Datei, Lesezeichen.json, settings.json von einem anderen Gerät, Löschen |
| `folder_devices.py` | Ordner-Abgleich mit mehreren Geräten: anderswo gelöscht (`Gelöscht.json`) → hier weg, auch ohne Index; Health Connect + Ordner der alten App → ein Weg mit der ID aus dem Ordner; hier gelöscht → Gelöscht.json, Health Connect holt ihn nicht wieder; wieder eingespielt → gilt wieder; einmal nicht lesbar → bleibt bekannt; Kartenausschnitt über den Ordner; Verzeichnis `Inhalt.json`: ohne Änderungszeiten wird beim zweiten Abgleich nichts gelesen, neu verbunden mit vorhandenen Einträgen auch nicht; von Hand in die Ordnung gelegt kommt dazu, irgendwo abgelegt nicht; von Hand gelöscht → Eintrag weg |
| `duplicates.py` | „Sicherung & Synchronisation“: Abschnitt „Doppelte Touren“ nur mit Doppelten; dieselbe Aktivität aus zwei Quellen (anderer Start, andere Länge) gilt als doppelt, ein Weg zur selben Zeit woanders nicht; Wahl, welche Aufzeichnung bleibt – die gewählte bekommt Kennung und Puls der anderen; Hinweis auf „Meine Touren“; GPX von WMap kommt mit derselben Strecke, Zeit und Herkunft zurück, eine alte Datei ohne diese Angaben gilt als derselbe Weg |
| `car.py` | Autobildschirm (`index.html?car`, js/car/car.js): nur die Karte; die Schnittstelle für Android Auto liefert Kategorien, Parkplätze in der Nähe (Kacheln, dann Overpass), Suche mit Kategorie, Ort mit Details, Route, Navigation mit Anweisungen als Daten, Frage als Hinweis mit Ja/Nein, geplante Tour als Route |
| `sync_progress.py` | Abgleich mit Fortschritt: Abbruch mittendrin (Seitenwechsel), der nächste liest nur den Rest; Seite zeigt „x von n (… %)“, Sicherung klappt mit Ordner zu. Standort in der App: eine gemeinsame Abfrage für Navigation und Aufzeichnung, jede Sekunde; der Punkt auf der Karte je nach Bewegung 1 s / 5 s / 30 s |
| `update.py` | Updates über `127.0.0.1` (cache first): Service Worker lädt die Version vorab; „Neue Version verfügbar“ mit Später; `minVersion` zwingend (Escape schließt nicht); `minAppVersion` sperrt (sichern, Download-Seite); Aktualisieren zeigt alles Neue seit der gesehenen Version |
| `nav_still.py` | Navigation mit nachgestelltem GPS: im Stand trotz Rauschen (± 3 m, GPS meldet dabei 0,9–1,9 m/s wie am Handy gemessen) kein Wandern und Tempo 0, beim Losgehen läuft der Pfeil wieder mit; im Bild in Bild der Android-App (kleines Fenster, `pip-mode`) bleibt der Pfeil unter dem Banner sichtbar |
| `smooth_dot.py` | Punkt auf der Karte geglättet (`core/smooth.js`): im Stand (Rauschen ± 6 m) ruhig, in Fahrt kaum Rückstand, einzelner Ausreißer verworfen, drei hintereinander gelten |
| `ask_along.py` | Kurze Fragen ohne Navigation: Laden aus den Kartenkacheln, nach dem Vorbeigehen fragt die (nachgestellte) OSM-API – seit über zwei Jahren unbestätigt → Pille „Gibt es … noch?“, ✕ vergisst sie, frisch bestätigter Laden ohne Pille |
| `import_gpx.py` | GPX öffnen (`import.html`): mit Zeiten als aufgezeichnete Tour speichern, dieselbe Datei noch einmal → „Gibt es schon“; ohne Zeiten nur als geplante Tour – öffnet `tour.html` ungespeichert (Speichern mit Ausrufezeichen) |
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
