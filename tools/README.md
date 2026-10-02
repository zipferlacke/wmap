# Werkzeuge

## Screenshots für Manifest und Store

Aufgenommen wird mit [takeShots](../../takeShots/README.md) (WebKitGTK ohne
Fenster) über das zentrale Skript `takeshots` (`~/wuefl_profiles/shell_scripts`,
neben `git-release`). Die Config liegt in `appdata/takeshots.json`; in den
Adressen steht `{base}`. Die Ansichten steuert die App über Link-Parameter an
(`?view=`, `?q=`, `?from=&to=`, `?reach=`, `?sim` – siehe `js/app.js`,
„Aufruf per Link“).

```bash
takeshots wmap                    # Docker-Server (Port 8080) muss laufen
takeshots wmap --eigener-server   # startet selbst einen Server auf 8765
```

Ergebnis in `appdata/images/`: `screenshot-{narrow,wide}-{1..13}{,_light}.png`
(1–6 stehen in `appdata/manifest.json`), daraus die Werbebilder in
`appdata/werbung/`.

| Nr. | Ansicht |
|---|---|
| 1 | Göttingen in 3D |
| 2 | Parkplätze im Kartenausschnitt |
| 3 | Ort mit Adresse und Knöpfen |
| 4 | Radroute mit Höhenprofil |
| 5 | Navigation (simuliert) |
| 6 | Erreichbarkeit mit Bäckereien |
| 7 | Entdecken: Wege im Harz |
| 8 | Übersicht |
| 9 | Aufgezeichnete Tour mit Puls-Diagramm |
| 10 | Meine Touren: Aufgezeichnet |
| 11 | Tourenplaner |
| 12 | Bus & Bahn: Göttingen → Kassel |
| 13 | Seite „Offline“ |

**Beispieldaten:** Der erste Eintrag der Config öffnet `tools/demo.html`. Die
Seite legt Touren (Strecken von Valhalla, Zeiten und Puls ausgedacht),
geplante Touren, Lesezeichen und zwei Offline-Gebiete in den Speicher –
takeShots nimmt je Lauf ein leeres Profil, darum bei jedem Lauf neu. Nur auf
localhost; im eigenen Browser geöffnet landen die Beispiele bei den eigenen
Daten (`tools/demo.html?weg` entfernt sie wieder). Inhalt: acht aufgezeichnete
Touren (Rad um Göttingen zum Kerstlingeröder Feld, um Rittmarshausen, in
Darmstadt vom Woog zum Jagdschloss Kranichstein; dazu Wandern, Laufen,
Rudern), vier geplante (Weser, Darmstadt, Eichsfeld mit dem Auto,
Rittmarshausen), Lesezeichen (Kulturverein Rittmarshausen, Alte Feuerwache
Göttingen, Kerstlingeröder Feld, Listen „Darmstadt“ und „Hannover Urlaub“).

Die Strecken dazu liegen in `tools/demo-strecken.json` – einmal berechnet mit
`cd test && .venv/bin/python demo_strecken.py` (zehn Routen nacheinander mit
Pause; neu laufen lassen, wenn sich Wegpunkte in `demo.html` ändern). So
braucht die Aufnahme den Routenserver für die Beispieldaten nicht: Der ist ein
Gemeinschaftsdienst und hat diesen Anschluss schon einmal ausgesperrt, als
zwei Läufe zugleich je zehn Routen auf einmal anfragten. Fehlt die Datei,
rechnet `demo.html` selbst – nacheinander, nie mehrere zugleich.

### Werbebilder (`appdata/werbung/`)

`handy-N-….png` (1080×1920) und `breit-N-….png` (3840×2160) in derselben
Reihenfolge. **Der Play Store nimmt höchstens acht Screenshots – das sind
`handy-1` bis `handy-8`**; alle weiteren sieht man nur auf wuefl.de/wmap
(dort als WebP in `wuefl/wmap/img/`, die Diashow in `wuefl/wmap/index.html`).

| Nr. | Bild | Play Store |
|---|---|---|
| 1 | Titel | ja |
| 2 | Karte in 3D | ja |
| 3 | Suche | ja |
| 4 | Route | ja |
| 5 | Navigation | ja |
| 6 | Android Auto | ja |
| 7 | Touren aufzeichnen und auswerten | ja |
| 8 | Entdecken | ja |
| 9 | Bus & Bahn | nur Webseite |
| 10 | Tour planen | nur Webseite |
| 11 | Erreichbar | nur Webseite |
| 12 | Offline | nur Webseite |
| 13 | Auf allen Geräten | nur Webseite |

Die Texte für den Play Store stehen in `appdata/store/de-DE/`
(`short_description.txt` höchstens 80 Zeichen, `full_description.txt`
höchstens 4000).

Hinweise:

- `offline` steht auf `false`: Karte, Suche und Routing kommen aus dem Netz.
- Die Wartezeiten sind großzügig, weil Kacheln, Photon, Valhalla und Overpass
  antworten müssen. Ist ein Bild leer oder halb fertig, dort `wait` erhöhen.
- Overpass ist manchmal überlastet; dann fehlen in Bild 2 und 6 die Flächen
  bzw. Treffer – einfach das eine Bild noch einmal aufnehmen.
- **Android Auto** (1920×720) nimmt takeShots nicht auf – die Bilder kommen
  aus dem Simulator (`tools/android-auto.sh id3`, Handy am Kabel):
  `screenshot-auto{,_light}.png` zeigen die Navigation (für die Werbebilder
  `*-6-auto` und `auto-tag.webp` auf der Webseite),
  `screenshot-auto-route{,_light}.png` die Routenwahl mit „Los“ (noch in
  keinem Werbebild). Ablauf: Die Auto-Seite mit `&sim` neu laden (über die
  Entwicklerwerkzeuge der WebView, `chrome://inspect` – dann fährt die
  Navigation die Route von selbst ab), Ziel wählen, „Los“; etwa 6 s danach
  sind die Knöpfe am rechten Rand noch zu sehen. Tag und Nacht:
  `echo day >> ~/.cache/wmap-dhu/eingabe` bzw. `night`. Aufnehmen:
  `echo "screenshot $HOME/.cache/wmap-dhu/x.png" >> ~/.cache/wmap-dhu/eingabe`
  und das Auto-Bild herausschneiden (`magick x.png -crop 1920x720+0+180`).
  Die Rahmen setzt `takeshots wmap compose` (Element `display`).

## Android Auto am Rechner (`android-auto.sh`)

Startet Googles Desktop Head Unit – ein Autobildschirm im Fenster – für die
Debug-App am per adb verbundenen Handy (siehe README, Abschnitt 23). Lädt die
DHU beim ersten Mal nach `~/.cache/wmap-dhu`. Die DHU gibt es nur für
x86-64: auf ARM-Linux (Asahi) läuft sie in muvm/FEX, libc++ kommt aus Fedoras
x86-64-Paket, socat reicht den Port 5277 aus der VM zum Rechner durch.

Auf dem Handy: Android Auto → Version zehnmal antippen → ⋮ →
Entwicklereinstellungen → „Unbekannte Quellen“ an; dann ⋮ → „Head Unit
Server starten“.

```bash
tools/android-auto.sh          # Bildschirm der DHU
tools/android-auto.sh id3      # wie ein Auto: id3, mercedes, golf, klein (tools/dhu/*.ini)
```

- **Kabel statt WLAN:** Hängt das Handy per Kabel und per WLAN an adb, nimmt
  das Skript das Kabel. Über WLAN meldet sich adb bei jedem Aussetzer mit
  anderem Port neu an – die Weiterleitungen (5277 zum Head Unit Server, 8080
  für die Karte vom Rechner) sind dann weg und die DHU endet mit „Failed to
  read from transport“. Das Skript wartet, bis das Handy wieder da ist, und
  startet die DHU neu (das Fenster zu schließen beendet es).
- **Befehle an die laufende DHU** (in der VM hat sie keine Eingabe, darum
  über eine Datei): `echo night >> ~/.cache/wmap-dhu/eingabe`, ebenso `day`
  und `screenshot <datei>`. `tap` nimmt die DHU nicht an – bedient wird mit
  der Maus im Fenster.
- **Was Android Auto mit den Vorlagen macht** (welcher Schritt von fünf,
  warum ein Bildschirm leer bleibt): `adb shell setprop log.tag.CarApp.H.Dis
  VERBOSE` (ebenso `CarApp`, `CarApp.H`, `CarApp.H.Tem`), dann `adb logcat |
  grep CarApp`. Gilt bis zum Neustart des Handys.
- Mit zwei adb-Verbindungen zum selben Handy braucht jeder eigene adb-Befehl
  `ANDROID_SERIAL=<Seriennummer>`.
