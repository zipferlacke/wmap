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
| `smoke.py` | alle Seiten laden (auch „Offline“); Health-Knopf im Browser versteckt |
| `dialogs.py` | Dialoge über den `userDialog` aus wuefl-libs: Rückfragen (Fußzeile der Bibliothek oder eigene Knopfzeile, ✕, Esc, Feld mit Enter, Knopf der offen lässt, nicht schließbar) und die Seitenleisten von Meine Touren, Entdecken, Tour planen (Starthöhe 58 % am Handy, größer ziehen, einklappen, Größe gemerkt, bleibt bei Enter und Esc stehen) |
| `share.py` | Teilen-Dialog (Text mit Link / nur Link) und Toast, hell und dunkel |
| `geo_links.py` | `?geo=` – Punkt, Punkt mit Namen, Adresse, Suche in der Nähe, kaputter Link |
| `news.py` | Willkommen, Neues nach Update, nichts bei Link-Aufruf, „Was ist neu“ |
| `offline_areas.py` | Offline-Karten: Größe, freie Form laden, Kachel ohne Kartenversion, löschen |
| `freeform.py` | freie Form: an der Kante einfügen, markieren + Entf, Doppeltipp |
| `track_charts.py` | Weg mit Puls und Frequenz: Diagramm-Umschalter, Runden (1/2/5 km), schnellste/langsamste, GPX mit Messwerten |
| `hours.py` | Öffnungszeiten je Tag: lesen, ändern, 24/7, dauerhaft geschlossen, Feiertage, zu Verschachteltes als Text |
| `edit_tags.py` | Ort bearbeiten: Beschreibung, Merkmale, alle Tags (Tag entfernen), was hochgeladen würde (OSM im Browser nachgestellt); Ortskarte mit Merkmalen; Ladesäule: Angaben je Art (Stecker mit Anzahl und Leistung, Ladepunkte, Gebühr, Bezahlung), am Feld geöffnet, `contact:website` bleibt; Ortskarte mit antippbaren Angaben |
| `folder_sync.py` | Ordner-Abgleich: neue Ordnung, Umzug aus der alten, fremde GPX bleiben, Bus & Bahn je Datei, Lesezeichen.json, settings.json von einem anderen Gerät, Löschen |
| `folder_devices.py` | Ordner-Abgleich mit mehreren Geräten: anderswo gelöscht (`Gelöscht.json`) → hier weg, auch ohne Index; Health Connect + Ordner der alten App → ein Weg mit der ID aus dem Ordner; hier gelöscht → Gelöscht.json, Health Connect holt ihn nicht wieder; wieder eingespielt → gilt wieder; einmal nicht lesbar → bleibt bekannt; Kartenausschnitt über den Ordner; Verzeichnis `Inhalt.json`: ohne Änderungszeiten wird beim zweiten Abgleich nichts gelesen, neu verbunden mit vorhandenen Einträgen auch nicht; von Hand in die Ordnung gelegt kommt dazu, irgendwo abgelegt nicht; von Hand gelöscht → Eintrag weg; Kopie mit derselben Kennung → eine Datei; dieselbe Aufzeichnung unter mehreren Kennungen → die kleinste bleibt, Puls kommt dazu, die anderen in `Gelöscht.json` – auch auf einem zweiten Gerät; nicht lesbare Datei: Eintrag bleibt, keine zweite Datei daneben; automatisch nicht bei jeder Seite; feste Kennung für Wege aus Health Connect |
| `folder_shelf.py` | In der App oder nur im Ordner: ältere Wege werden zur Karteikarte, neue und „offline verfügbar“ bleiben ganz; `tracks.full` holt alle Punkte und den Puls; zweiter Abgleich liest und schreibt nichts; geänderte Karteikarte → Datei mit allen Punkten, neuem Namen und Farbe; anderswo geändert kommt an; Einstellung „alles“; Datei gelöscht → Eintrag weg; Sicherung enthält ganze Wege; Trennen holt alles zurück; Datei einer älteren WMap wird erst neu geschrieben; neues Gerät |
| `storage_full.py` | Speicher voll (nachgestellt: `QuotaExceededError`): ohne Ordner weichen die fünf ältesten Wege, der als „offline verfügbar“ markierte nicht, Meldung, Gelöschtes aus Health Connect kommt nicht wieder, ein anderer Fehler löscht nichts; mit Ordner wird nichts gelöscht – die ältesten werden Karteikarten, der nächste Abgleich löscht und schreibt nichts |
| `offline_data.py` | Seite „Offline“: Kachel der Übersicht; Gebiet mit Größe und Stand, alle Touren ohne Ordner, geplante Touren, vorgeladene Navigation mit Resttagen; mit Ordner nur Markiertes in der Liste, „Nicht mehr offline“ nimmt die Markierung; Gebiet (mit Rückfrage) und Navigationskarte entfernen; `offline.html?gebiet=ID` zoomt hin |
| `track_look.py` | Aufgezeichnete Touren: Symbol und Farbe nach Art, ohne Art neutral „GPX“, Symbol für Gesundheitsdaten statt Uhrzeit, Auge je Zeile; Karte: ältere blasser; Zeitraum „letzte 365 Tage“ mit Auge am Jahr; Tour: Art wählen (Rudern → Tempo je 500 m), eigene Farbe, einzeln ausblenden – auch in der GPX-Datei; Block „Art, Farbe und Anzeige“ zu, bleibt beim Ändern offen; GPX auf die Seite ziehen; „Erneut navigieren“ |
| `tour_actions.py` | Aufgezeichnete Tour: Knöpfe Navigieren · Als Planung öffnen · Teilen; Teilen mit Auswahl (Puls) als Link `wege.html#weg=…` – geöffnet mit Tempo und Puls, ungespeichert, „Bei mir speichern“ einmal; ohne Haken fehlt der Puls; Als Planung öffnen → Planer ungespeichert; Navigieren: Frage „Tour aufzeichnen?“, Aufnahme-Knopf startet später, pausiert, verwirft |
| `car_share.py` | App und Android Auto teilen ihre Daten (gemeinsamer Speicher nachgestellt, App unter localhost, Auto unter 127.0.0.1): Touren ohne Vorschaubild, Lesezeichen, Ziele, Einstellungen; im Auto mit eigenem, leerem Speicher erscheinen die fürs Auto geplanten Touren der App, Wander- und Radtouren nicht; im Auto Gemerktes kommt in der App an, dort Gelöschtes verschwindet im Auto; bei gleicher Adresse (fertige App) fasst das Auto nichts an; das Auto meldet sich alle 5 s, die App zeichnet so lange nur 10 Bilder je Sekunde; die eingepackte Kopie vor dem Wechsel zur Webversion legt nichts ab |
| `duplicates.py` | „Sicherung & Synchronisation“: Abschnitt „Doppelte Touren“ nur mit Doppelten; dieselbe Aktivität aus zwei Quellen (anderer Start, andere Länge) gilt als doppelt, ein Weg zur selben Zeit woanders nicht; getrennte Wahl, wessen Strecke (GPS) bleibt und von welcher Aufzeichnung die Gesundheitsdaten kommen – die gewählte bekommt Kennung und Puls der anderen; Hinweis auf „Meine Touren“; GPX von WMap kommt mit derselben Strecke, Zeit und Herkunft zurück, eine alte Datei ohne diese Angaben gilt als derselbe Weg |
| `car.py` | Autobildschirm (`index.html?car`, js/car/car.js): nur die Karte; die Schnittstelle für Android Auto liefert Kategorien, Parkplätze in der Nähe (Kacheln, dann Overpass), Suche mit Kategorie, Ort mit Details, Route, Navigation mit Anweisungen als Daten, Frage als Hinweis mit Ja/Nein, Tour fürs Auto als Route (eine Wandertour wird abgelehnt), immer Profil Auto, die Karte zoomt auf die Treffer einer Kategorie heraus; Treffer mit „, (1)“ am Namen und nummeriertem Punkt; die Routenvorschau füllt die freie Fläche neben der Liste; Lesezeichen als Kacheln (Zuhause zuerst, nicht doppelt in der leeren Suche); Entfernung in den Listen: die ersten drei auf der Straße (gleich der Länge der Route), danach „≈“ und Luftlinie; Filter (Autobahnen vermeiden) gespeichert und neu gerechnet, Änderung der App kommt an; Frage mit ✕ und „Bestätigen“; „Ziel erreicht“ endet von selbst; höchstens gut 20 Bilder je Sekunde; Start am mitgegebenen bzw. gemerkten Standort |
| `sync_progress.py` | Abgleich mit Fortschritt: Abbruch mittendrin (Seitenwechsel), der nächste liest nur den Rest; Seite zeigt „x von n (… %)“, Sicherung klappt mit Ordner zu. Standort in der App: eine gemeinsame Abfrage für Navigation und Aufzeichnung, jede Sekunde; der Punkt auf der Karte je nach Bewegung 1 s / 5 s / 30 s |
| `update.py` | Updates über `127.0.0.1` (cache first): Service Worker lädt die Version vorab; „Neue Version verfügbar“ mit Später; `minVersion` zwingend (Escape schließt nicht); `minAppVersion` sperrt (sichern, Download-Seite); Aktualisieren zeigt alles Neue seit der gesehenen Version |
| `nav_still.py` | Navigation mit nachgestelltem GPS: im Stand trotz Rauschen (± 3 m, GPS meldet dabei 0,9–1,9 m/s wie am Handy gemessen) kein Wandern und Tempo 0, beim Losgehen läuft der Pfeil wieder mit; im Bild in Bild der Android-App (kleines Fenster, `pip-mode`) bleibt der Pfeil unter dem Banner sichtbar |
| `smooth_dot.py` | Punkt auf der Karte geglättet (`core/smooth.js`): im Stand (Rauschen ± 6 m) ruhig, in Fahrt kaum Rückstand, einzelner Ausreißer verworfen, drei hintereinander gelten |
| `ask_along.py` | Kurze Fragen ohne Navigation: Laden aus den Kartenkacheln, nach dem Vorbeigehen fragt die (nachgestellte) OSM-API – seit über zwei Jahren unbestätigt → Pille „Gibt es … noch?“, ✕ vergisst sie, frisch bestätigter Laden ohne Pille |
| `drive_target.py` | Fahrziel fürs Auto (`app/drive-target.js`): zu einem Geschäft endet die Fahrt am Parkplatz direkt davor (Satz im Sheet, „P“ auf der Karte, Nadel bleibt am Geschäft); nicht mit dem Rad, nicht ohne Merker `poi`, nicht bei Tankstelle, Parkplatz, Adresse |
| `import_gpx.py` | GPX öffnen (`import.html`): mit Zeiten als aufgezeichnete Tour speichern, dieselbe Datei noch einmal → „Gibt es schon“; ohne Zeiten nur als geplante Tour – öffnet `tour.html` ungespeichert (Speichern mit Ausrufezeichen) |
| `planner.py` | Tourenplaner: Punkt-Menü (Rundweg, zum Start/Ziel machen), im Rundweg gleich viel hinauf wie hinunter, Suche als Vorschau statt gleich anzuhängen |
| `plugin_folders.py` | Plugin-Ordner: lose GeoJSON/JS, `wmap-plugin.json` (Ebene, Kacheln, Erweiterung), kaputte Datei, neu einlesen behält Schalter, Erweiterung startet; Firefox nur einmal einlesen; Anleitung |
| `konto_osm.py` | Konto über OpenStreetMap: id_token prüfen (Testschlüssel statt OSM), Konto anlegen/übernehmen/löschen; im Browser Rückkehr von OSM, Einstellungen, Abmelden, Konto löschen |

Screenshots landen in `test/out/`. `common.py` hat die Hilfen (`Browser`,
`open`, `js`, `wait`, `shot`, `theme`).

**Nachrichten und minVersion** lassen sich nur mit einer geänderten
`appdata/messages.json` prüfen: `minVersion` über die laufende Version setzen
und eine Nachricht mit neuer `id` eintragen, `news.py` laufen lassen, Datei
zurücksetzen (`git checkout appdata/messages.json`).

**Health Connect** geht nur in der Android-App auf dem Handy – siehe
`src-tauri/README.md`. **Android Auto** (die Vorlagen in `tools/android/car/`)
ebenso nur mit Handy und Simulator (`tools/android-auto.sh`); `car.py` prüft
die Karten-Seite dahinter.
