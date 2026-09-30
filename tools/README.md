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

Ergebnis in `appdata/images/`: `screenshot-{narrow,wide}-{1..8}{,_light}.png`,
passend zu den Einträgen in `appdata/manifest.json`.

| Nr. | Ansicht |
|---|---|
| 1 | Göttingen in 3D |
| 2 | Parkplätze im Kartenausschnitt |
| 3 | Café mit Öffnungszeiten |
| 4 | Radroute mit Höhenprofil |
| 5 | Navigation (simuliert) |
| 6 | Erreichbarkeit mit Bäckereien |
| 7 | Entdecken: Wege im Harz |
| 8 | Übersicht |

Hinweise:

- `offline` steht auf `false`: Karte, Suche und Routing kommen aus dem Netz.
- Die Wartezeiten sind großzügig, weil Kacheln, Photon, Valhalla und Overpass
  antworten müssen. Ist ein Bild leer oder halb fertig, dort `wait` erhöhen.
- Overpass ist manchmal überlastet; dann fehlen in Bild 2 und 6 die Flächen
  bzw. Treffer – einfach das eine Bild noch einmal aufnehmen.
- Icons und Logo (`appdata/wmap-*.png`, `appdata/logo.svg`) fehlen noch.

## Android Auto am Rechner (`android-auto.sh`)

Startet Googles Desktop Head Unit – ein Autobildschirm im Fenster – für die
Debug-App am per adb verbundenen Handy (siehe README, Abschnitt 23). Lädt die
DHU beim ersten Mal nach `~/.cache/wmap-dhu`. Die DHU gibt es nur für
x86-64: auf ARM-Linux (Asahi) läuft sie in muvm/FEX, libc++ kommt aus Fedoras
x86-64-Paket, socat reicht den Port 5277 aus der VM zum Rechner durch.

Auf dem Handy: Android Auto → Version zehnmal antippen → ⋮ →
Entwicklereinstellungen → „Unbekannte Quellen“ an; dann ⋮ → „Head Unit
Server starten“.
