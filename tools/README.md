# Werkzeuge

## Screenshots für Manifest und Store

Aufgenommen wird mit [takeShots](../../takeShots/README.md) (WebKitGTK ohne
Fenster). Die Ansichten steuert die App über Link-Parameter an (`?view=`,
`?q=`, `?from=&to=`, `?reach=`, `?sim` – siehe `js/app.js`, „Aufruf per Link“),
es muss also nichts geklickt werden außer „Starten“ und einer Kategorie.

```bash
# 1. im wmap-Ordner einen Server starten (eigenes Terminal)
python3 -m http.server 8765 --bind 127.0.0.1

# 2. Screenshots aufnehmen – hell und dunkel, Handy und Laptop
gjs ../takeShots/takeShots.js shots tools/takeshots.json
```

Ergebnis in `appdata/`: `screenshot-{narrow,wide}-{1..6}{,_light}.png`,
passend zu den Einträgen in `appdata/manifest.json`.

| Nr. | Ansicht |
|---|---|
| 1 | Göttingen in 3D |
| 2 | Parkplätze im Kartenausschnitt |
| 3 | Café mit Öffnungszeiten |
| 4 | Radroute mit Höhenprofil |
| 5 | Navigation (simuliert) |
| 6 | Erreichbarkeit mit Bäckereien |

Hinweise:

- `offline` steht auf `false`: Karte, Suche und Routing kommen aus dem Netz.
- Die Wartezeiten sind großzügig, weil Kacheln, Photon, Valhalla und Overpass
  antworten müssen. Ist ein Bild leer oder halb fertig, dort `wait` erhöhen.
- Overpass ist manchmal überlastet; dann fehlen in Bild 2 und 6 die Flächen
  bzw. Treffer – einfach das eine Bild noch einmal aufnehmen.
- Icons und Logo (`appdata/wmap-*.png`, `appdata/logo.svg`) fehlen noch.
