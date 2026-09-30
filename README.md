# WMap – Karte, Navigation und Touren

WMap ist eine Karte für unterwegs: suchen, Routen planen, navigieren, Touren
planen und aufzeichnen, Wanderwege entdecken – alles auf Basis offener Daten
(OpenStreetMap), ohne Konto und ohne dass eigene Daten das Gerät verlassen.

Online: <https://app.wuefl.de/wmap/> · als App installierbar (PWA), als
Desktop-App (Tauri, siehe [`src-tauri/README.md`](src-tauri/README.md)) und für
Android (`tauri-android wmap`, siehe [Werkzeuge](#werkzeuge)).

Diese Datei beschreibt **jede Ansicht so, wie sie sich verhält** – mit den
Zahlen, die im Code stehen. Sie ist zum Nachprüfen gedacht („ist das so
gewollt?“) und als Grundlage für Erklärungen in der App.

---

## Inhalt

1. [Aufbau: zwei Hauptbildschirme](#1-aufbau-zwei-hauptbildschirme)
2. [Karte](#2-karte)
3. [Suchen und Orte](#3-suchen-und-orte)
4. [Route planen](#4-route-planen)
5. [Navigation](#5-navigation)
6. [Ebenen: Satellit, Wandern & Rad, Plugins](#6-ebenen-satellit-wandern--rad-plugins)
7. [3D, Gelände und Höhen](#7-3d-gelände-und-höhen)
8. [Tastatur und Fliegen](#8-tastatur-und-fliegen)
9. [Übersicht (Dashboard)](#9-übersicht-dashboard)
10. [Meine Touren: Geplant, Aufgezeichnet, Bus & Bahn, Orte](#10-meine-touren-geplant-aufgezeichnet-bus--bahn-orte)
11. [Tour planen](#11-tour-planen)
12. [Aufzeichnen](#12-aufzeichnen)
13. [Entdecken](#13-entdecken)
14. [Plugins und eigene Ebenen](#14-plugins-und-eigene-ebenen)
15. [Sicherung & Synchronisation: Ordner, Health Connect, ZIP](#15-sicherung--synchronisation-ordner-health-connect-zip)
16. [Teilen, Standort anfragen, Bild in Bild](#16-teilen-standort-anfragen-bild-in-bild)
17. [Mitmachen bei OpenStreetMap, Meldungen](#17-mitmachen-bei-openstreetmap-meldungen)
18. [WMap-Konto (OpenStreetMap) und Server](#18-wmap-konto-openstreetmap-und-server)
19. [Einstellungen](#19-einstellungen)
20. [Offline und Datenverbrauch](#20-offline-und-datenverbrauch)
21. [Was wo gespeichert wird](#21-was-wo-gespeichert-wird)
22. [Aufruf per Link](#22-aufruf-per-link)
23. [Werkzeuge](#werkzeuge)
24. [Entwicklung](#entwicklung)

---

## 1. Aufbau: zwei Hauptbildschirme

| Bildschirm | Wozu | Datei |
|---|---|---|
| **Karte** | Start. Suchen, Route, Navigation, Aufzeichnen, Fliegen | `index.html` |
| **Übersicht** | Kacheln zu allen Ansichten, Gespeichertes, Dank | `dashboard.html` |

Man startet immer mit der Karte.

- **Seiten mit Karte** (Karte, Meine Touren, Entdecken, Tour planen) haben
  oben rechts das **Menü** (neun Punkte): oben die Schnellwege – Übersicht,
  Karte, Meine Touren, Tour planen, Entdecken, Plugins, Fliegen –, nach einem
  Strich die Einträge der Seite (auf der Karte z. B. Aufzeichnen, Standort
  teilen/anfragen, Tastatur, Einstellungen). Mitmachen steht nicht
  im Menü, sondern in der Übersicht und im Hinweis nach einer Fahrt.
- **Seiten ohne Karte** (Übersicht, Plugins, Einstellungen) zeichnen keine Karte, sondern
  haben eine **Navigationsleiste** – am Rechner links, am Handy unten:
  Übersicht · Karte · Touren · Entdecken · Plugins.

**Kartenseiten mit Panel** (Meine Touren, Entdecken) sind alle gleich gebaut:

- Karte über den ganzen Bildschirm, daneben das Panel als **Seitenleiste zum
  Ziehen** (wuefl-libs `userDialog` → `sheet`) – **am Rechner links in voller
  Höhe, am Handy von unten**. Kein grauer Hintergrund: die Karte bleibt
  bedienbar.
- **← oben links:** in der Liste zurück zur Übersicht, in einer Detailansicht
  zurück zur Liste. Im Detail steht oben der Name der Tour/des Wegs.
- **✕ oben rechts:** schließt die Seite und führt zur Karte.
- **Griff** über die ganze Kante (am Rechner der rechte Rand, am Handy oben):
  **ziehen** macht das Panel breiter bzw. höher (mind. 300 px, höchstens
  70 % der Breite; am Handy 160 px bis 92 % der Höhe). **Weiter als das
  Minimum gezogen** klappt es ganz ein – nur der Griff bleibt am Rand.
  **Antippen** klappt ein und aus; Pfeiltasten auf dem Griff ändern die Größe.
  Größe und Zustand bleiben gespeichert.
- **Esc:** im Detail zurück zur Liste, in der Liste klappt Esc das Panel ein
  (führt aber nie aus der Seite heraus).
- Die Karte passt ihren Ausschnitt an den freien Platz neben/über dem Panel an.

---

## 2. Karte

- **Navigation unten bzw. links** (ui/appbar.js): Karte · Übersicht · Touren ·
  Entdecken · Plugins – am Handy unten (ein offener Dialog legt sich darüber,
  sein ✕ gibt sie frei), am Rechner als Leiste links; beim Navigieren weg.
- **Dialoge am Rechner links** unter der Suche, so hoch wie ihr Inhalt – die
  Karte rechts bleibt frei und passt Routen und Orte daneben ein.
- **Ampeln** ab Zoom 15 als kleines Symbol – nur wo eine steht, ohne Rot/Grün
  (OSM `highway=traffic_signals` per Overpass; die Grundkarte kennt keine
  Ampeln). Geholt wird in Feldern von etwa 1 km: nur Felder im Blick, die
  noch fehlen – beim Verschieben der neue Streifen, beim Zurückschieben
  nichts. Die Abfrage fragt die Server nacheinander statt parallel; ein
  Server, der ablehnt (429) oder überlastet ist (5xx), bekommt 60 bzw. 20 s
  Pause – das gilt für alle Overpass-Abfragen der App.
- **Kartenbild:** OpenFreeMap „Liberty“ mit deutschen Namen (`name:de` vor
  `name`; bei nicht-lateinischer Schrift steht der deutsche Name vorn und das
  Original darunter). Gebäude haben Farben nach Nutzung und Schatten am Boden,
  damit man ihre Höhe liest; Dächer sind eine eigene helle Fläche.
- **Globus:** ganz herausgezoomt ist die Erde eine Kugel.
- **Hell und dunkel:** Karte und App folgen dem Modus des Geräts (auch wenn er
  abends umschaltet) oder fest „Hell“/„Dunkel“ aus Einstellungen → Darstellung.
  Dunkel wird der helle Kartenstil umgefärbt – Wasser bleibt blau, Wald grün,
  Straßen heller als der Boden, Häuser fast grau; 3D, POIs und eigene Ebenen
  bleiben. Knöpfe, Popups und Dialoge wechseln mit.
- **Knöpfe rechts oben** (alle 40 px, eckig mit runden Ecken wie der Menüknopf
  darüber): Zoom +/−, Kompass (Norden oben; zeigt die Neigung),
  eigener Standort, **Ebenen** (siehe [6](#6-ebenen-satellit-wandern--rad-plugins)),
  Gelände an/aus.
- **Quellenangabe:** nur ein kleines (i) unten links, das erst beim Antippen
  aufgeht. Ausführlich stehen die Quellen, Version und Impressum unten auf
  der Übersicht (Danke-Banner).
  In der Navigation gibt es kein (i).
- **Letzter Ausschnitt:** Die Karte merkt sich Mitte, Zoom, Neigung und
  Richtung (`wmap.view`) und startet dort wieder.
- **Antippen:** ein Ort der Karte (Laden, Haltestelle …) öffnet seine Karte
  unten; ein Treffer einer eigenen Ebene zeigt alle Werte des Objekts.
- **Haltestellen und Bahnhöfe** (die Symbole der Grundkarte):
  - Zuerst der **Fahrplan** (EFA der NVBW, ganz Deutschland, gut ¼ s, mit
    Echtzeit, wo es sie gibt). Seine Steige haben Koordinaten: der nächste
    zum angetippten Symbol ist **diese Straßenseite**, also eine Richtung
    (passt der IFOPT-Schlüssel aus OSM, zählt der – auch wenn die EFA eine
    andere Kreisnummer nutzt).
  - Nur noch **Abfahrten**, zeitlich sortiert: Uhrzeit, Verspätung, Linie,
    Ziel, „in N min“, Steig. Darüber die Wahl des Steigs: **Hier** (die
    angetippte Seite – Vorgabe), **Alle Steige** oder ein einzelner Steig.
  - Eine Abfahrt antippen zeigt **genau diese Fahrt** auf der Karte –
    Verlauf und Halte aus dem Fahrplan (XML_STOPSEQCOORD_REQUEST, rund ⅕ s):
    ab hier kräftig, der Weg bis hierher blass. Darunter klappt auf, wann sie
    wo ist: alle Halte mit Zeit, gefahrene blass, dieser Halt fett. Kennt der
    Fahrplan den Verlauf nicht, kommt die Linie aus OSM (Overpass).
  - OSM (Overpass) läuft nur nebenher im Hintergrund-Modus für die echten
    Linienfarben; ohne Fahrplan (Ausland) liefert es die Linien wie früher.
  - **Merken** (wie bei jedem Ort) legt die Haltestelle als Lesezeichen ab –
    in der Routenplanung mit Bus & Bahn steht sie dann ganz oben.
  - Ein eigenes Liniennetz wird nie gezeichnet.

- **Bus & Bahn** (Art in der Routenplanung): Verbindungen nach Fahrplan über
  die EFA der NVBW (ganz Deutschland, ohne Schlüssel, Echtzeit wo es sie
  gibt). Keine Navigation; Zwischenziele zählen hier nicht.
  - **Wann:** im Formular „Abfahrt ab“ oder „Ankunft bis“ mit Datum und
    Uhrzeit; leer heißt jetzt, „Jetzt“ setzt zurück. Fahrten vor der Zeit
    (bzw. mit späterer Ankunft), die die EFA mitliefert, fallen weg.
  - **Schnell zuerst:** Die Verbindungen kommen ohne Verlauf und
    Fußweg-Texte (`genC=0`, `genP=0` – rund 3 s statt 9 s, ein Drittel der
    Daten) und stehen erst von Halt zu Halt auf der Karte. Für die gewählte
    Verbindung lädt `refineJourney()` den echten Verlauf nach (je Fahrt aus
    dem Fahrplan, Fußwege über Valhalla samt Wegbeschreibung) – gut 1 s.
  - Zwei Anfragen zugleich (normal und „langsam umsteigen“), zusammen bis
    zu sechs Verbindungen: Abfahrt–Ankunft, Linien, Dauer, Umstiege und
    „Schnellste“ (bei „Ankunft bis“: „Späteste Abfahrt“) bzw. „≥ N min
    umsteigen“ / „knapp: N min umsteigen“.
  - **Filter-Knopf** (siehe [4](#4-route-planen)): Verkehrsmittel
    (Fernzüge ICE/IC, Regionalzug/S-Bahn, U-Bahn/Tram, Bus), **Umsteigezeit
    mindestens** 2–20 min, **Schnellste auch zeigen** (auch wenn knapp).
    Gezeigt werden alle mit genug Umsteigezeit, dazu – wenn eingeschaltet –
    die schnellste.
  - **Abschnitte direkt unter der gewählten Verbindung** (die
    Wegbeschreibung unten entfällt bei Bus & Bahn): „Zu Fuß nach …“ mit
    Zeit, Strecke und Tempo; „Bus 91 nehmen → Roringen“ mit Einstieg →
    Ausstieg samt Steigen, Halte · Fahrzeit · km. Zwischen zwei Fahrten
    steht immer die Umsteigezeit und wo (knapp: orange). Einen Abschnitt
    antippen (Liste oder Karte) hebt ihn hervor, zoomt hin und klappt die
    Halte dazwischen mit Zeiten bzw. den Fußweg auf.
  - Auf der Karte jede Fahrt in der Farbe ihres Verkehrsmittels, Fußwege
    gestrichelt, an jedem Ein- und Ausstieg ein Punkt.
  - **Merken** legt die Verbindung unter Meine Touren → Bus & Bahn ab.
  - **Ticket bei der Bahn** (wenn Züge dabei sind): Suche auf bahn.de mit
    erstem und letztem Bahnhof und Abfahrt. Reine Bus-/Tramfahrten haben
    keinen Link (Verbund, Deutschlandticket).

## 3. Suchen und Orte

- **Suchfeld oben:** Orte, Adressen und Kategorien. Tippfehler werden
  verziehen („Parkplaz“, „Backerei“: ein Buchstabe Abweichung).
- **Kategorien** („Parkplatz“, „Bäckerei“, „Fluss“ …): zuerst sofort aus den
  Kartenkacheln (Zoom 14, ohne Netzabfrage), dann ergänzt aus Overpass
  (Flächen, Linien, seltene Kategorien). Restaurants zeigen auch Imbisse.
- **Ortskarte:** Name, Art, Öffnungszeiten, Adresse, Bild und Kurztext aus
  Wikipedia/Commons, an Bahnhöfen die Abfahrten, an Tankstellen die Preise
  (mit eigenem Tankerkönig-Schlüssel). Knöpfe: **Route**, Teilen,
  Erreichbar, Merken, Bearbeiten (OSM) bzw. am freien Punkt „Hier
  eintragen“ („Als Start“ gibt es in der Routenplanung).
- **Merken:** ein Tipp legt ein **Lesezeichen** in der Liste „Allgemein“ an
  (Ort, Adresse, Haltestelle); die Meldung bietet „Ändern“: eigener Name
  („Oma“, „Verein“ …), eine andere oder neue **Liste** („Hannover Urlaub“),
  Zuhause oder Arbeit. „Gemerkt“ antippen öffnet denselben Dialog mit
  „Entfernen“.
- **In der Suche** (und in den Feldern der Routenplanung): ohne Eingabe
  Zuhause und Arbeit ganz oben; beim Tippen dazu die Lesezeichen, deren
  Name, Ort oder Liste passt – im Abschnitt „Lesezeichen“ vor den
  Suchergebnissen (bei Bus & Bahn gemerkte Haltestellen zuerst).
- **Listen ansehen und teilen:** Meine Touren → Orte.
- **Zuletzt gesucht:** WMap merkt sich Orte, Kategorien und Routen; löschbar
  in den Einstellungen und in der Übersicht.

## 4. Route planen

- Knopf **Route** neben dem Suchfeld oder „Route“ in einer Ortskarte.
- **Profile** immer oben: Zu Fuß, Fahrrad, Auto (Valhalla auf Servern der
  FOSSGIS), Bus & Bahn (Fahrplan, siehe [2](#2-karte)).
- **Filter-Knopf** (unten neben „Zwischenziel“ und in der zusammengeklappten
  Zeile; ein Punkt zeigt, dass etwas verstellt ist) öffnet eine Notiz:
  Auto – Autobahnen, Mautstraßen, Fähren vermeiden; Fahrrad – unbefestigte
  Wege, Fähren; zu Fuß – Fähren; Bus & Bahn – siehe oben. Gilt auch fürs
  Neuberechnen in der Navigation (`wmap.routePrefs`).
- **Lange Strecken zu Fuß und mit dem Rad** (Göttingen → Hamburg): Valhalla
  rechnet am Stück nur 90 bzw. 135 km Luftlinie. Darüber wird die Strecke
  wie im Tourenplaner in Stücke geteilt und zusammengesetzt – eine Route
  ohne Alternativen; die Navigation rechnet unterwegs genauso neu.
- Start ist standardmäßig der eigene Standort; ein Klick in die Karte füllt
  das erste leere Feld. Zwischenziele lassen sich hinzufügen.
- Wo es welche gibt, stehen Alternativen zur Auswahl – mit Zeit, Strecke und Höhenprofil.
- **Entlang der Route** suchen (Tankstelle, Bäckerei …) – ab der aktuellen
  Stelle der Navigation.
- **Erreichbarkeit** (Suchfeld antippen → „Was ist von hier erreichbar?“, oder
  Punkt auf der Karte → „Erreichbar“): Flächen, die man in 5, 10, 15, 30 oder 60 Minuten
  (bzw. 1–25 km) erreicht, optional mit Treffern einer Kategorie darin.
- Jede berechnete Route landet in „Letzte Routen“ (Übersicht, löschbar).

## 5. Navigation

Start mit **Los** unter einer Route. Die Karte wechselt in die Fahreransicht.

**Pfeil und Straße**

- Der Pfeil gleitet zwischen zwei GPS-Meldungen auf der Straße entlang
  (30 Bilder/s). Kommt eine Meldung spät (Tunnel, Häuserschlucht), rollt er
  bis zu **4 s** mit dem letzten Tempo weiter.
- Die Richtung folgt der Straße voraus (Blick 12–55 m nach vorn, je nach
  Tempo), nicht der sprunghaften GPS-Richtung.
- **Im Stand** wandert das GPS um einige Meter und meldet ein kleines Tempo.
  Zwei ruhige Meldungen hintereinander (unter 0,5 m/s) → der Pfeil hält in
  der Mitte der beiden, Tempo **0**. Er läuft erst wieder, wenn das GPS
  Fahrt misst (ab 0,9 m/s) oder man sich weiter entfernt als die doppelte
  Ungenauigkeit (mindestens 12 m).
- Der Pfeil sitzt im unteren Drittel; der Rand oben wird bei jeder
  Größenänderung neu berechnet – so bleibt er auch im kleinen Bild in Bild
  sichtbar.
- Der Pfeil bleibt auf der Straße, bis **3 Meldungen hintereinander mehr als
  40 m** daneben liegen – erst dann gilt man als abgekommen und die Route wird
  neu berechnet (danach 10 s Pause bis zur nächsten Neuberechnung).
- Ab Zoom **16,2** wird die Fahrbahn mit ihren **echten Spuren** gezeichnet
  (Breite in Metern, Pfeile auf dem Asphalt, Übergänge über 50 m weich). Der
  Pfeil fährt dann in seiner Spur rechts der Mitte.

**Standort** (`js/core/native.js`, `#startGps` in `js/nav/navigation.js`)

- Im Browser `watchPosition`. Nach 6 s ohne Meldung steht „GPS-Signal
  schwach“; neu gestartet wird erst nach **20 s** Stille (ein Neustart
  braucht selbst Sekunden bis zur ersten Position), nach einer
  Zeitüberschreitung gar nicht – die Abfrage läuft laut Standard weiter.
- In der Handy-App das Tauri-Plugin `geolocation`. Es kennt nur **einen**
  Empfänger (jede neue Abfrage ersetzt die vorige) und nimmt `timeout` als
  Abstand zwischen zwei Meldungen. Darum eine gemeinsame Abfrage mit **1 s**
  Abstand für alle (Navigation, Aufzeichnung); sie endet erst 0,5 s nach dem
  letzten Empfänger, ein Neustart der Navigation nutzt dieselbe weiter.

**Kamera** – feste Stufen statt ständigem Nachregeln; eher von schräg oben
als aus Fahrersicht, damit Häuser Straße und Abzweig nicht verdecken:

| Umgebung | normal | kurz vor dem Abbiegen* |
|---|---|---|
| Stadt | Zoom 17,5 · 45° | 18,1 · 45° |
| Land | 16,6 · 50° | 17,5 · 50° |
| Autobahn/schnell (≥ 100 km/h) | 15,6 · 52° | 16,9 · 52° |
| Zu Fuß | 18,1 · 40° | 18,7 · 45° |
| verzwickte Stelle (Kreisel, ≥ 3 Spuren, zwei Manöver dicht) | – | 18,4 · 40° |

\* „kurz vor dem Abbiegen“: weniger als 30 s oder 150 m (zu Fuß 40 m).
Einstellung „Zoom in der Navigation“: Näher +0,7, Mehr Überblick −0,9. Der
eigene Standort liegt im unteren Drittel, damit man voraus sieht.

**Knöpfe**

- **Folgen-Knopf** (einer für alles): **blau**, solange die Karte folgt.
  Antippen, während sie folgt, wechselt zwischen geneigt (3D) und flach.
  Verschiebt, dreht, neigt oder zoomt man die Karte selbst, hört sie auf zu
  folgen und der Knopf wird **farblos**; Antippen holt sie zurück.
- **Kompass:** Fahrtrichtung oben ↔ Norden oben.
- **Übersicht:** ganze Restroute im Bild.
- **Stumm**, **Suchen** (entlang der Route), **Melden**, **Teilen**
  (Ankunftszeit als Link), **Beenden**. Nach dem Beenden ist die Route weg.

**Ansagen**

- Immer mit Richtung: „In 300 Metern links abbiegen Richtung Kassel / B 3 /
  A 7“, „… in die Weender Straße“.
- Zeitpunkt: früh bei „far“ (Auto 500 m, Rad 200 m, Fuß 80 m) bzw. 20 s
  vorher, wenn man schnell ist; jetzt bei „near“ (Auto 60 m, Rad 30 m, Fuß
  15 m) bzw. 6 s vorher.
- Nach einem Manöver, wenn das nächste weit ist: „2 Kilometer der Route folgen.“
- Die Stimme ist wählbar (Einstellungen → Stimme); deutsche Stimmen der großen
  Anbieter werden bevorzugt.
- **Android-App:** Das WebView kennt keine Web-Sprachausgabe
  (`speechSynthesis`) – dort spricht Android selbst (TextToSpeech über
  `window.WMapAndroid.speak`, `tools/android/MainActivity.kt`); Musik wird
  währenddessen leiser. Stimme und Tempo aus den Android-Einstellungen
  („Sprachausgabe“).

**Spurleiste:** Vor einer Kreuzung (bis 700 m vorher) zeigt die Leiste oben
alle Spuren mit Pfeilen; die richtigen sind hervorgehoben.

**Tempo:** aktuelles Tempo und – wo bekannt – das erlaubte; über dem Limit
(+3 km/h) wird die Anzeige rot.

**Sonstiges:** Der Bildschirm bleibt an (Wake Lock). Vor dem Start wird auf
Wunsch die Karte entlang der Route offline gespeichert. In der Navigation
nutzt das Gelände gröbere Höhendaten (siehe [7](#7-3d-gelände-und-höhen)).

**Simulation zum Testen** (am Schreibtisch, ohne GPS): `sim` an die Adresse
hängen, Route planen, auf „Los“ tippen – ein simulierter Standort fährt die
Route ab, mit Ansagen, Umleitung und allem.

```
index.html?from=Göttingen&to=Kassel&profile=car&sim           Auto, echtes Tempo
index.html?from=9.9338,51.5374&to=9.95,51.54&profile=bike&sim&tempo=5
index.html?sim=verfahren&from=…&to=…                          biegt einmal falsch ab (neu berechnen)
index.html?sim=rauschen&from=…&to=…                           wackliges GPS (± 8 m, Ausreißer)
```

- Tempo: zu Fuß 5,4 km/h, Rad 18 km/h, Auto so schnell wie erlaubt (höchstens
  120 km/h); `tempo=2` … `10` als Zeitraffer.
- Ohne `from`/`to` geht es auch: mit `?sim` öffnen und die Route wie sonst
  planen. Startet die Route bei „Mein Standort“, fragt der Browser trotzdem
  einmal nach dem Standort.
- Simulierte Fahrten werden nicht aufgezeichnet und nicht als Spur gemerkt.
- In der App gibt es keine Adresszeile – dort am Rechner im Browser testen.

## 6. Ebenen: Satellit, Wandern & Rad, Plugins

Knopf **Ebenen** rechts oben auf der Karte. Die Wahl bleibt gespeichert.

- **Grundkarte**
  - **Karte** – das normale Kartenbild.
  - **Satellit** – weltweit Sentinel-2 cloudless (EOX, 10 m), darüber ab Zoom
    11 die amtlichen Luftbilder (20–40 cm) von **Niedersachsen, NRW, Bayern,
    Hessen, Thüringen, Sachsen, Brandenburg, Berlin, Mecklenburg-Vorpommern,
    Rheinland-Pfalz, Saarland und Baden-Württemberg** (offen, Abruf aus dem
    Browser erlaubt; Sachsen-Anhalt sperrt ihn, Hamburg hat keinen passenden
    Dienst). Hessen liefert sein 20-cm-Bild erst ab Zoom 15; darunter
    springen die gröberen Übersichten desselben Dienstes (3,2 m, 50 m) ein.
    Hessen, Rheinland-Pfalz und das Saarland liefern JPEG statt PNG (ein
    Drittel bis ein Zehntel der Daten). Straßen (etwas zurückgenommen), Flüsse und Namen liegen obenauf.
    **Gebäude** (ab Zoom 14,5): graue, deckende Wände, auf dem Dach das
    Luftbild – eine eigene WebGL-Ebene (map/sat-buildings.js), weil MapLibre
    einer 3D-Fläche nur eine Farbe gibt. Sie baut sich neu, sobald Gebäude-
    oder Geländekacheln nachgeladen sind; weiter hinten bleiben Dächer grau.
- **Wandern & Rad** (Schwerpunkt): große Straßen (Autobahn bis Kreisstraße)
  treten auf 40 % zurück, die Wanderwege von Waymarked Trails liegen darüber,
  das Relief wird kräftiger.
- **Ebenen:** Relief (Schummerung), Wanderwege, Radwege, Mountainbike.
- **Eigene Ebenen & Plugins:** jede eigene Ebene und jedes geholte Plugin mit
  Schalter „auf der Karte“. Darunter nur ein Knopf **Verwalten** → Plugin-
  Seite: Plugins holen, eigene Quelle (Kacheln, WMS, GeoJSON – auf Wunsch mit
  Benutzer und Passwort), Deckkraft.
- **Plugin-Ordner** (`js/data/plugin-folders.js`, Anleitung für Nutzer:
  `plugin-anleitung.html`, verlinkt auf der Plugin-Seite): mehrere lokale
  Ordner, gemerkt und mit „Neu einlesen“ aktualisierbar. Lose `.geojson` →
  Ebene, lose `.js` → Erweiterung; ein Unterordner mit `wmap-plugin.json`
  ist ein Plugin: GeoJSON-Ebene (`data`, `color`, `colorBy`, `description`,
  `operator`, `attribution`), Kartenkacheln (`tiles`, `minzoom`, `maxzoom`,
  `opacity`) oder Erweiterung (`type: "extension"`, `script`; der Code läuft
  als Blob-Modul, erst nach dem Aktivieren). Neu einlesen ersetzt, was aus
  dem Ordner kam, und behält „auf der Karte“ bzw. „aktiv“.
  App: Plugin `folder` mit je einem Platz (`slot` „layers“, „layers2“ …);
  Chrome/Edge: File System Access, der Zugriff liegt in IndexedDB (nach
  einem Neustart fragt der Browser beim Neu-Einlesen einmal nach);
  Firefox/Safari: nur einmal einlesen (`<input webkitdirectory>`) – beide
  bieten `showDirectoryPicker` nicht an (Mozilla hält dauerhaften
  Ordnerzugriff für Webseiten für zu riskant).

## 7. 3D, Gelände und Höhen

- **Von selbst 3D:** Ab Zoom **15,5** neigt sich die Karte auf 50° und das
  Gelände kommt dazu; unter Zoom **12,5** wird sie wieder flach. Wer selbst
  neigt oder das Gelände schaltet, behält seine Wahl.
- **Höhendaten:** Mapterhorn, in Deutschland bis Zoom 16 – das sind
  **≈ 0,75 m je Pixel**, gerechnet aus den amtlichen 1-m-Geländemodellen der
  Länder. Die **Schummerung nutzt diese volle Auflösung**, das **Gelände**
  Zoom 14 (≈ 3 m): Die Kacheln mit den Häusern gehen nur bis Zoom 14, und mit
  feinerem Gelände rechnet MapLibre die Höhe der 3D-Häuser falsch – sie
  schweben dann neben ihrem Grundriss. In der **Navigation** reicht Zoom 13
  (≈ 6 m): weniger Daten, und die Straße liegt ruhiger, weil kleine
  Höhenfehler sie sonst wellen.
- **Warnungen:** Der Grundstil wird vor dem ersten Zeichnen gerichtet –
  fehlende Gebäudehöhen gelten als 0, Zahlenvergleiche in Filtern bekommen
  ein `has`, fehlende Symbole des Grundstils (`atm`, `gate` …) werden leer
  nachgeliefert. Sonst meldet MapLibre das je Kachel in der Konsole.
- **Eigener Standort:** ein ruhiger Punkt – das Pulsieren von MapLibre ist aus.
- **Überhöhung:** weit draußen 1,5-fach, ab Zoom 12 1,25, ab Zoom 14 1-fach.
- **Relief (Schummerung):** Schatten an Hängen, damit Berge und Täler auch
  flach von oben sichtbar sind – kräftig bis Zoom 12, nah heran schwächer
  (in Städten nutzt Mapterhorn teils Oberflächenmodelle, dort würden Häuser
  als Hügel erscheinen). Im Schwerpunkt „Wandern & Rad“ stärker.
- **Mobilfunk:** Einmal je Sitzung wird gefragt, ob 3D Daten laden darf. Im
  Datensparmodus bleibt alles flach.
- **Funkloch:** Scheitern Höhenkacheln dreimal, geht das Gelände aus und wird
  nach einer Minute wieder versucht.

## 8. Tastatur und Fliegen

**Tastatur** (solange kein Eingabefeld den Fokus hat):

| Taste | Wirkung |
|---|---|
| W / S | vor / zurück in Blickrichtung |
| A / D | nach links / rechts |
| Q / E | drehen |
| R / F | nach oben / unten schauen (Neigung) |
| Leertaste / Shift | höher / tiefer |
| Esc | flach und Norden oben; in der Navigation zurück zum Standort |

Das Tempo beginnt **langsam** und wird beim Halten schneller – sanft
ansteigend bis zum **Sechsfachen nach 2,5 s**.

**Fliegen** (Menü → Fliegen, Übersicht → Fliegen, `?action=fly`):

- Die Karte neigt sich auf mindestens 65° und zoomt auf mindestens 14,5.
- **Maus und Tasten gleichzeitig** – beides wird in einer Schleife zu einem
  Bild verrechnet.
- **Ohne Klick:** Die Bildmitte dreht sich zum Mauszeiger hin – je näher am
  Rand, desto schneller (bis 70°/s zur Seite, 40°/s nach oben/unten); in der
  Mitte (12 %) ruht sie.
- **Nach einem Klick in die Karte** verschwindet der Zeiger (Pointer Lock):
  Maus nach links/rechts dreht die Blickrichtung, nach oben/unten neigt sie.
  Der Klick öffnet dabei nichts auf der Karte.
- **W fliegt genau dorthin:** Schaut man steil nach unten, geht es abwärts
  (näher heran), schaut man zum Horizont, geradeaus. A/D seitlich,
  Leertaste/Shift hoch/runter.
- Ein Hinweis unten zeigt die Tasten; Suchfeld und Knöpfe treten zurück.
- Q/E drehen, R/F neigen auch im Flug. Das Tempo richtet sich nach der Höhe:
  weit oben schneller, nah am Boden langsamer.
- **Esc beendet** das Fliegen (mit gesperrtem Zeiger gibt Esc zuerst die Maus
  frei – das beendet den Flug ebenfalls).

## 9. Übersicht (Dashboard)

Zweiter Hauptbildschirm (`dashboard.html`), ohne Karte, mit Navigationsleiste.

- **Kacheln** nur für Ansichten, mit großem blassem Symbol, Titel, einem Satz
  und – wo es passt – einer Zahl: Karte (groß), Geplante Touren (Anzahl),
  Aufgezeichnete Touren (Anzahl, km in diesem Jahr), Entdecken, Plugins
  (Anzahl aktiv), Offline-Karten, Mitmachen, **Sicherung & Synchronisation**
  (verbundener Ordner und letzter Abgleich, rot bei einem Fehler),
  Einstellungen. Tour planen, Aufzeichnen, Fliegen und Erreichbarkeit gibt
  es in Karte bzw. Touren.
- **Gespeichert auf diesem Gerät:**
  - Karten für die Navigation: jede vorgeladene Navigation mit Datum, Anzahl
    Kacheln und wie viele Tage sie noch bleibt; dazu Kacheln angesehener
    Gegenden – alles löschen
  - Letzte Routen – einzeln (✕) oder alle löschen; antippen öffnet sie
  - Suchverlauf – löschen
  - Speicher insgesamt
- **Danke-Banner** (grün, Hand mit Herz) mit allen Anbietern und dem Knopf
  „Entwicklung unterstützen“ (paypal.me/wuefl), darunter Version und Impressum.

## 10. Meine Touren: Geplant, Aufgezeichnet, Bus & Bahn, Orte

Eine Seite, vier Reiter (`wege.html`; am Handy scrollen die Reiter in sich).
**Bus & Bahn** (`?tab=bahn`) zeigt gemerkte Verbindungen: kommende
oben, **vergangene zugeklappt** darunter; im Detail alle Abschnitte zum
Aufklappen, auf der Karte jede Fahrt in ihrer Farbe; Knöpfe Neu suchen,
Ticket bei der Bahn, Löschen.

**Orte** (`?tab=orte`): die Lesezeichen – Zuhause & Arbeit, dann je Liste
(„Allgemein“, „Hannover Urlaub“ …) mit Farbe; auf der Karte alle als Punkte
mit Namen. Je Liste „Liste teilen“ (Link `wege.html?liste=…`, alle Orte
gepackt in der Adresse, ohne Server) und „Auf der Karte“; je Ort Route
dorthin. Ein geteilter Link zeigt die Liste rot zur Vorschau mit
„Als Liste übernehmen“ bzw. „Verwerfen“.

Die ersten zwei:

| | Geplant | Aufgezeichnet |
|---|---|---|
| Was | Touren, die man noch machen will | was man wirklich gefahren/gelaufen ist |
| Woher | Planer, übernommene bekannte Wege, GPX ohne Zeiten | Aufzeichnen, Navigation, GPX mit Zeiten |
| Gruppen | Zu Fuß · Rad · Auto | Jahre (je Jahr eine Farbe) |
| Zahlen | Strecke, Anstieg | Strecke, Zeit in Bewegung, Tempo, Puls |

- **Oben:** Tour planen bzw. Aufzeichnen und GPX importieren (doppelte Wege
  werden erkannt), darunter die Suche (Name, Ort, Jahr, Monat, Profil …),
  dann je Gruppe eine Tabelle – Jahre bzw. Gruppen als Aufklapp-Zeile mit
  Pfeil. Überfahren einer Zeile hebt die Linie auf der Karte hervor.
- **Karte:** nur der aktive Reiter. Weit herausgezoomt (unter Zoom 9) je
  Tour ein Punkt am Start, nahe beieinander zusammengefasst mit der Anzahl
  (antippen zoomt hinein); näher die Linien. Die gewählte Tour trägt
  **Kilometermarken** 1, 2, 3 … (lange Touren alle 5 bzw. 10 km); der Punkt
  aus dem Diagramm liegt über der Linie.
- **Unten:** ein Hinweis auf „Sicherung & Synchronisation“ (Ordner, Health
  Connect, ZIP) – die Knöpfe dafür stehen nur noch dort.
- **Detail** (Zeile oder Linie antippen): Name oben, ← zurück zur Liste.
  - Aufgezeichnet: Name änderbar, Datum und Uhrzeit, Strecke, Zeit in
    Bewegung, Ø und max. km/h, Anstieg, Ø/max. Puls, Ø Frequenz und
    Leistung (aus GPX oder Health Connect); die Linie ist nach Tempo
    gefärbt (langsam orange → schnell grün).
    **Diagramm** mit Umschalter: Höhe, Tempo, Puls, Schritt- bzw.
    Trittfrequenz, Leistung – nur, was gemessen wurde; Zeiger im Diagramm
    und auf der Linie zeigen dieselbe Stelle.
    **Runden** zu 1, 2 oder 5 km (gemerkt): Zeit, Tempo (zu Fuß als min/km),
    Ø Puls, Anstieg; die schnellste grün, die langsamste rot, eine Runde
    antippen hebt sie auf der Karte hervor (`js/data/track-stats.js`).
    Knöpfe: Als Tour speichern, Als Tour teilen, GPX, Löschen.
    Puls, Frequenz und Leistung stehen je Punkt am Weg und gehen als
    GPX-Erweiterung (gpxtpx:hr/cad, power) mit in den verbundenen Ordner;
    beim Ausdünnen bleibt mindestens alle 30 s ein Punkt.
  - Geplant: Profil, Strecke, Dauer, Anstieg/Abstieg, Beschreibung,
    Höhenprofil. Knöpfe: **Tour starten** (Karte mit den Punkten der Tour
    als Route, Profil passend – Wandern → zu Fuß, Rennrad → Rad –, die
    Navigation startet von selbst: `index.html?tour=ID&start`; sie wird
    immer unter Aufgezeichnete Touren gespeichert), Im Planer öffnen,
    Teilen, GPX, Löschen.

## 11. Tour planen

`tour.html` – Punkte in die Karte setzen, dazwischen wird nach Profil geroutet.

- **Aufbau:** Panel wie bei Meine Touren und Entdecken – am Rechner links in
  voller Höhe (Breite ziehen, ganz einklappen), am Handy unten. Kopf: ← zu
  Meine Touren, Name, Speichern als Symbol (grüner Haken = gesichert), ✕ zur
  Karte. Ganz oben: Ort suchen, daneben das blaue **i** (Anleitung als Notiz,
  am Handy volle Breite). Darunter Werkzeuge, Zahlen, Art, Hintergrund,
  Höhenprofil, Wege, Beschreibung, unten Teilen · GPX · Veröffentlichen ·
  Löschen. Ebenen-Knopf (Satellit …) wie auf der Hauptkarte; Straßennamen
  eine Zoomstufe früher und dichter als auf der geneigten Hauptkarte.

- **Profile:** Wandern, Spazieren, Rennrad (Asphalt), Tourenrad, Gravel
  (Schotter), Mountainbike, Ausfahrt (Auto).
- Unten stehen immer Strecke, Zeit, Anstieg, Höhenprofil und die Anteile von
  Wegtypen und Belägen.
- **Lange Touren** (Fernwanderung, mehrtägige Radtour) gehen mit wenigen
  Punkten: große Abstände werden automatisch in Stücke geteilt.
- **Fester Verlauf:** Übernommene bekannte Wege und GPX-Importe behalten ihren
  Originalverlauf; erst wenn man Punkte verschiebt, wird neu gerechnet.
- **Hintergrund:** bekannte Wege (aus Entdecken → „Im Planer öffnen“, oder
  „Weg oder Tour dazulegen“ mit Suche) und eigene Touren liegen farbig unter
  der Planung – bekannte Wege so, wie sie in OpenStreetMap erfasst sind,
  Lücken bleiben Lücken. Mehrere gleichzeitig; ✕ nimmt einen heraus. Sie
  werden mit der Tour gespeichert (geteilt: die bekannten Wege).
  - **Selbst planen:** Punkte nah an einem Hintergrund rasten auf ihm ein
    (auch beim Ziehen). Liegen zwei Punkte nacheinander darauf, folgt die
    Strecke dazwischen **genau dem Weg** – der kürzere Weg entlang, bei
    Rundwegen auch über Start/Ziel hinweg, über Lücken hinweg der verbundene
    Verlauf. Liegt ein Punkt daneben, wird dorthin normal geroutet.
  - **So übernehmen:** der ganze Weg auf einen Klick als fester Verlauf
    (auch Rundwege). **Neu planen** leert die eigenen Punkte.
- **Ort suchen:** ein Treffer landet nicht gleich in der Tour, sondern
  erscheint als blaue Nadel mit Menü: „Als nächsten Punkt anhängen“,
  „Einfügen, wo es passt“ (kleinster Umweg), „Als Start setzen“,
  „Verwerfen“. Tippen in die Karte schließt die Vorschau.
- **Punkt antippen:** Punkt entfernen; am Start „Auch als Ziel – Rundweg“;
  an anderen Punkten „Zum Start machen“ (im Rundweg „Hier starten und
  enden“: die Runde dreht sich, der Punkt wird Start und Ziel) und „Zum Ziel
  machen“.
- **Touren entdecken** (bei den Werkzeugen) → Entdecken.
- **Etappen – in Tagestouren teilen** (ab 5 km): „Etappen“ an, dann setzt ein
  Tipp auf die Linie ein Tagesende (Fähnchen mit Nummer, antippen entfernt
  es) – oder „Alle X km“ → Automatisch teilen. Die Tage erscheinen abwechselnd
  orange/violett auf der Karte und als Liste mit Länge, Höhenmetern, Zeit und
  Ort am Tagesende. „Als N Tagestouren speichern“ legt jede Etappe als eigene
  Tour mit dem Originalverlauf an („Karstwanderweg – Tag 3“). Geht auch bei
  geteilten, nur lesbaren Touren (z. B. aus Entdecken); die Tagesenden werden
  mit der Tour gespeichert.
- **Speichern:** Der Knopf zeigt den Zustand – neu, geändert, „✓ Gespeichert“.
- **Menü:** Teilen (Link, ohne Server), Als GPX speichern, Veröffentlichen
  (sofort für alle unter Entdecken → Von anderen; braucht ein Konto), Löschen.

## 12. Aufzeichnen

- Menü → Aufzeichnen, Art wählen (zu Fuß, Rad, Auto), los. Unten Zeit, Strecke
  und Tempo, Pause und Stopp; die Linie wächst live mit.
- Punkte werden nur genommen, wenn das GPS auf **35 m** genau ist und man sich
  **4 m** bewegt hat. Stehzeiten zählen nicht zur Bewegungszeit.
- Nach Absturz oder Neuladen geht es weiter (bis 12 Stunden).
- Beim Stopp einen Namen geben oder verwerfen. Gespeichert wird nur auf dem
  Gerät. Navigationen einer geplanten Tour (Meine Touren → Tour starten)
  werden immer aufgezeichnet, andere Navigationen nur mit Einstellungen →
  „Jede Navigation merken“ (Standard: aus).
- Browser zeichnen im Hintergrund nicht auf – der Bildschirm bleibt an.

## 13. Entdecken

`entdecken.html` – zwei Reiter; Plugins haben eine eigene Seite (`plugins.html`).

**Wege** (Wander-, Rad-, MTB-Routen aus OpenStreetMap)

- Oben die Art (Wandern, Rad, Mountainbike). Die Karte zeigt das Wegenetz
  (Waymarked Trails). Rundwege stehen als „Rundweg“ in der Zeile.
- Die Liste zeigt **alle Wege im Kartenausschnitt** (ab Zoom 8,5; aktualisiert
  sich 0,7 s nach dem Verschieben) als Tabelle, **gruppiert nach dem
  Gesamtweg**: Etappen des Harzer-Hexen-Stiegs stehen unter „Harzer-Hexen-
  Stieg · 3 Etappen hier · 97 km“, mit „Ganzen Weg ansehen“. Gehört eine
  Etappe zu mehreren (E6 und nationaler Weg), zählt der bedeutendere.
- **Filtern:** Tippen filtert die Tabelle sofort (Name, Nummer, Gesamtweg).
  **Enter** sucht den Namen überall („Karstwanderweg“): was im Ausschnitt
  passt, steht sofort oben, dazu kommen die Treffer aus dem Suchindex von
  Waymarked Trails (rund 1 s; fällt der aus, Overpass über ganz Deutschland).
- **Auf eine farbige Linie tippen:** Waymarked Trails nennt die Wege an genau
  dieser Stelle (unter 1 s). Ist es einer, öffnet er sich gleich; liegen
  mehrere übereinander (Fernweg und örtlicher Weg), kommt eine kurze Auswahl
  mit den Wegzeichen. Geht auch aus der Detailansicht heraus.
- **Hervorheben:** Fährt man mit der Maus über eine Zeile, erscheint der Weg
  als Vorschau. Geöffnet steht er kräftig mit hellem Rand auf der Karte, das
  übrige Wegenetz tritt zurück.
- **Detail:** Verlauf auf der Karte (von Waymarked Trails, ~0,2 s; sonst
  Overpass), Netz, Nummer, Länge, von → nach, Wegzeichen mit Beschreibung,
  Webseite, Etappen im Ausschnitt; „Im Planer öffnen“ setzt den Verlauf
  zusammen: Ist der Weg in OSM lückenhaft erfasst (Karstwanderweg: sieben
  Stücke), werden die Stücke der Lage nach aneinandergereiht, winzige
  Bruchstücke abseits weggelassen und Lücken über echte Wege geroutet statt
  als gerade Linie gezogen; „Im Planer öffnen“ übernimmt den
  Originalverlauf. Gesamtwege mit bis zu 60 Etappen werden zusammengesetzt.

**Von anderen:** Touren, die WMap-Nutzer veröffentlicht haben, im
Kartenausschnitt – mit Sternen. Detail mit Kommentaren, Bewerten (Konto),
Im Planer öffnen; eigene lassen sich löschen.

Unten in „Von anderen“: Konto-Zeile (Anmelden/Abmelden).

## 14. Plugins und eigene Ebenen

`plugins.html` – wie ein App-Store, ohne Karte.

- **Filter:** Alle · Kartenebenen · Erweiterungen · Eigene · Aktiv, dazu eine
  Suche. Jedes Plugin ist eine Kachel mit Symbol, Name, Anbieter, zwei Zeilen
  Beschreibung und „Aktiv“-Marke.
- **Antippen** zeigt es groß: Beschreibung, Art, Anbieter, Stand der Daten,
  Namensnennung, Kontakt, Quelle – und **Aktivieren/Deaktivieren**.
- **Kartenebenen:** aus dem Katalog (WMap-Server) und eingebaut (Wander-,
  Rad-, MTB-Wege von Waymarked Trails;
  Geologie und Gesteinsarten Deutschland der BGR, GÜK250, zu sehen ab Zoom 9;
  Geologie weltweit von Macrostrat). Aktivieren legt sie auf die Hauptkarte
  (im Ebenen-Menü an/aus), Deaktivieren nimmt sie wieder weg.
- **Was ist hier? (langes Drücken / Rechtsklick):** Mit einer Geologie-Ebene
  an steht unter „Punkt auf der Karte“, was dort ist – Gesteinsart
  („Schluff, schwach tonig …“) bzw. Erdzeitalter, bei Macrostrat Einheit,
  Alter in Millionen Jahren und Gestein. Ein einfacher Klick bleibt für Orte.
- **Deckkraft:** im Plugin-Detail (gilt beim nächsten Öffnen der Karte).
  Kartenkacheln starten bei 70 %, Daten bei 100 %.
- **Legende:** im Plugin-Detail und im Info-Dialog aufklappbar – bei der BGR
  das Legendenbild in Originalgröße (scrollbar), bei Macrostrat ein Satz zu
  den Farben der Zeitskala.
- **Erweiterungen:** JavaScript, das die App verändert – ein ES-Modul unter
  einer https-Adresse mit `export function activate(wmap)`; `wmap` bietet
  `map`, `maplibregl`, `onMapReady`, `toast`, `addMenuItem`, `storage`.
  Aktivieren erst nach dem Hinweis, dass die Erweiterung alles darf, was WMap
  darf. Sie laufen beim Start der Karte.
- **Hinzufügen:** GeoJSON-Datei, **ganzer Ordner** (mit Unterordnern; alle
  `.geojson`/`.json`), Adresse (Kacheln, WMS, GeoJSON – auch mit Benutzer und
  Passwort), Erweiterung per Adresse, **Plugin anbieten** (privat oder sofort
  öffentlich; Konto nötig). Die Konto-Zeile steht in Entdecken.

**Eigene Ebenen ansehen** (`ebenen.html`, aus dem Plugin-Detail „Auf der Karte
ansehen“) – GeoJSON auf heller Karte (z. B. aus QGIS).

- Koordinaten müssen WGS84 (Grad) sein – sonst eine klare Meldung.
- **Farbe nach Messwert:** Eigenschaften mit Zahlen werden erkannt (auch „12,5“
  als Text); Verlauf blau (niedrig) → rot (hoch), mit Legende.
- Objekte antippen zeigt alle Werte als Tabelle.
- „Auch auf der Hauptkarte“ = derselbe Schalter wie im Ebenen-Menü und
  Aktivieren auf der Plugin-Seite.
- **Als Plugin:** hochladen (bis 2 MB), privat oder öffentlich.
- Alles liegt nur im Browser (IndexedDB).

**Health Connect** (nur Android-App): Sicherung & Synchronisation → „Trainings
holen“ übernimmt neue Trainings mit Route als Wege (Name aus dem Training
oder „Rudern am …“, Profil aus der Art, sonst am Tempo erkannt), dazu Puls,
Tempo, Frequenz und Leistung je Punkt. Jeder Weg behält Art und App: Symbol
und „Rudern · Zepp“ in Liste und Detail, auch in der Suche. Schon
Übernommenes kommt nicht doppelt. Indoor-Trainings (Rudergerät, Workout,
Laufband …) haben keine Strecke – hängt eine App trotzdem eine Route mit
Rückfrage an (Zepp), wird sie still übergangen. Routen fremder Apps gibt Health Connect
nur mit „Immer erlauben“ ohne Rückfrage heraus – lehnt man eine Rückfrage
ab, fragt der Import für den Rest nicht mehr, übernimmt aber alles andere
(`js/services/health.js`, Plugin in `src-tauri/plugins/health`).
Automatisch holen: siehe Abschnitt 15.

**Berechtigungen** (nur Android-App, `js/ui/permissions.js`): Nach dem
Willkommen beim ersten Start erklärt ein Dialog Standort und Health Connect –
je Recht wofür, der Zustand und darunter der Knopf (erlauben bzw. in die
Einstellungen von Android oder Health Connect zum Ändern und Widerrufen).
Derselbe Dialog kommt, wenn etwas den Standort oder Health Connect braucht,
das noch nicht erlaubt ist (Standort-Knopf, Navigation, Aufzeichnen, Route
ab „Mein Standort“), und unter Einstellungen → Berechtigungen. Beim Start
der Karte wird nicht gefragt – ohne Freigabe bleibt die letzte Ansicht.

## 15. Sicherung & Synchronisation: Ordner, Health Connect

Eigene Seite `sync.html` (Kachel in der Übersicht; Einstellungen → Daten und
unten in Meine Touren verweisen dorthin). Zwei Teile, je mit letztem
Abgleich, Fehler (rot, auch auf der Kachel) und **Automatisch**: aus / beim
Öffnen von WMap / beim Öffnen und alle 30 Minuten (`js/data/auto-sync.js`).

**Knöpfe der Ordner-Kachel:**

| Zustand | Knöpfe |
|---|---|
| kein Ordner | **Ordner synchronisieren** · Aus Ordner importieren · Exportieren (ZIP) |
| Ordner verbunden | Jetzt abgleichen · Ordner ändern · Exportieren (ZIP) · Trennen – dazu „Synchronisiert mit *Name*“ |
| Firefox, Safari | Aus Ordner importieren · Exportieren (ZIP) |

Darunter „Export als ZIP wieder einspielen: ZIP wählen“ (nicht bei
verbundenem Ordner – der hat ja schon alles).

### Ordner

Alles, was man in WMap anlegt, als Dateien in einem Ordner, den ein
Sync-Programm abgleicht – **Nextcloud, Proton Drive, Google Drive,
Syncthing**. Jede WMap, die denselben Ordner verbindet, liest ihn ein und
gleicht mit ab: dieselben Daten auf allen Geräten, bewusst lokal, ohne Konto
und ohne Server.

```
WMap/
├─ settings.json                     Einstellungen (hell/dunkel, Navigation, Stimme …)
├─ Geplante Touren/Harzer Hexenstieg.gpx
├─ Aufgezeichnete Touren/2026/09 September/2026-09-20 Radtour am Samstagnachmittag.gpx
├─ Bus & Bahn/2026-09-30 08.15 Göttingen → Kassel.json   je gemerkte Verbindung
└─ Lesezeichen.json                  Zuhause, Arbeit, Lesezeichen mit Listen
```

- Heißt der verbundene Ordner selbst „WMap“, entfällt diese Ebene. Dateien
  aus der alten Ordnung (`Geplant/`, `Abgeschlossen/<Jahr>/`, `Gemerkt.json`)
  ziehen beim ersten Abgleich um.
- **Fortschritt:** „Gleiche ab … 40 von 96 (42 %) · noch etwa 1 Min.“ mit
  Balken, in der Übersicht „Gleiche ab …“ auf der Kachel. Alle 2 s wird der
  Stand gespeichert (`pending`) und schon Übernommenes gemeldet (Meine
  Touren zeigt es sofort). Wer die Seite wechselt, bricht den Abgleich ab –
  die nächste Seite mit `autoSync()` macht dort weiter (auch bei Automatik
  „Aus“) und liest nur, was noch nicht im Stand war.
- **Abgleich** beim Öffnen und 2,5 s nach jeder Änderung (je nach
  Automatik), sonst mit „Jetzt abgleichen“:
  - nur im Ordner → übernehmen; nur in WMap → Datei schreiben
  - im Ordner gelöscht → auch in WMap weg; in WMap gelöscht → Datei weg
  - beides geändert → das Neuere gewinnt; geändert heißt: andere Zeit und
    anderer Inhalt als beim letzten Abgleich (manche Cloud-Ordner unter
    Android melden keine Zeit)
  - `Lesezeichen.json`: je Eintrag das Neuere, Gelöschtes steht ein Jahr in
    `deleted`, damit es nicht von einem anderen Gerät zurückkommt
  - `settings.json`: hier geändert → schreiben, nur dort geändert →
    übernehmen; beim ersten Abgleich eines Geräts gilt die Datei. Nicht
    dabei: Konten, Verlauf, Kartenausschnitt.
- Erkannt wird eine Datei am Stichwort `wmap:ID` (GPX) bzw. an der `id`
  (JSON). Fremde GPX (Garmin, Komoot-Export …) dürfen irgendwo im Ordner
  liegen – mit Zeiten werden sie ein Weg, sonst eine Tour; sie bleiben, wo
  sie sind. Puls, Frequenz, Leistung bleiben erhalten.
- **Wo es geht:**
  - **WMap-App** (Android, Linux, macOS, Windows): eigenes Plugin
    `src-tauri/plugins/folder` – Android wählt den Ordner über den
    Speicherzugriff des Systems (auch Nextcloud, Drive …), am Rechner ein
    Ordnerdialog. Die App liest und schreibt nur in diesem Ordner.
  - **Chrome und Edge** (File System Access API); der Browser fragt nach
    einem Neustart ggf. erneut („Erlauben und abgleichen“).
  - **Firefox, Safari:** kein fester Ordner – nur importieren und
    exportieren.
- **Aus Ordner importieren** (`importFolder`): liest einen Ordner einmal ein,
  ohne ihn zu verbinden – in der App über das Plugin (eigener Platz
  `import`, danach wieder freigegeben), im Browser über die Ordnerauswahl.
  Liegt eine `wmap-sicherung.json` darin (ausgepackter Export), kommt alles
  daraus, sonst die GPX-Dateien (Doppelte werden erkannt).

### Health Connect (Android-App)

Standard: automatisch beim Öffnen – ohne Freigabe still, ohne Fehler.
„Trainings holen“ übernimmt neue Trainings mit Route – der Fortschritt steht
am Knopf, am Ende nur eine Meldung „x importiert“. Routen, für die Health
Connect einzeln fragt, bleiben beim automatischen Holen liegen (Hinweis:
in Health Connect WMap → Trainingsrouten „Immer erlauben“). Dazu
„Berechtigungen“ (Dialog aus Abschnitt 14).

### Export als ZIP

Dieselbe Ordnung wie im Ordner (GPX, Bus & Bahn, `Lesezeichen.json`), dazu
`WMap/wmap-sicherung.json` mit allem für die Wiederherstellung. „ZIP wählen“
nimmt das ZIP (oder eine alte `.json`); ein ZIP ohne JSON, etwa ein
gezippter GPX-Ordner von woanders, wird als GPX eingelesen.

### GPX öffnen (`import.html`)

Eine GPX-Datei antippen bzw. doppelklicken öffnet WMap – und dort je Datei:

- **Als aufgezeichnete Tour speichern** (nur mit Zeiten in der Datei):
  vorher Prüfung auf Doppelte (WMap-ID im Stichwort `wmap:…` bzw. derselbe
  Weg – `sameTrack`); gibt es ihn schon: „Gibt es schon – ansehen“. Sonst
  speichern und gleich zeigen (`wege.html?id=…`), der Ordner gleicht ihn mit ab.
- **Als geplante Tour öffnen:** nur öffnen, wie eine geteilte Tour
  (`tour.html#t=…`, Speichern mit Ausrufezeichen) – gespeichert wird erst dort.

Wie die Datei ankommt:

| Wo | Wie |
|---|---|
| Android-App | „Öffnen mit“ (`ACTION_VIEW`) und „Teilen“ (`ACTION_SEND`) – Intent-Filter aus `tools/android-einbinden.py`, das folder-Plugin liest die Datei (nur mit `<gpx`), `opened` gibt sie der Seite |
| Rechner-Apps | Dateizuordnung `.gpx` (`bundle.fileAssociations`): Start mit Datei, zweiter Start (single-instance) bzw. macOS „Opened“ → `open_paths()` im folder-Plugin |
| installierte Web-App | Chrome/Edge am Rechner: `file_handlers` im Manifest (`launchQueue`); am Handy das Teilen-Menü: `share_target` → `sw.js` legt die Dateien in den Cache `wmap-share` → `import.html?shared` |
| sonst | Dateiauswahl auf der Seite |

In der App schickt `js/core/theme.js` beim Start einer Seite zu
`import.html`, wenn das Plugin Dateien bereithält (`opened { peek }`).

## 16. Teilen, Standort anfragen, Bild in Bild

- **Teilen per Link** – ohne Server, alles steckt in der Adresse: ein Ort,
  „Hier bin ich“ (mit Uhrzeit), eine Route mit Profil und Wegpunkten, eine
  Tour (`tour.html#t=…`), in der Navigation die Ankunftszeit.
- **Standort anfragen:** Link schicken; wer ihn öffnet, schickt seinen
  Standort zurück.
- **Teilen-Dialog:** Teilen-Menü des Geräts, Text mit Link kopieren oder nur
  den Link. Die Android-App öffnet das Teilen-Menü von Android und kopiert
  über das System (Plugin `browser`) – das WebView kann beides nicht.
- **Weblinks in der App** (Website eines Orts, Quellen …, `js/core/links.js`):
  nicht im Fenster von WMap, sondern darüber mit einer Leiste – ✕ links
  schließt, rechts „Im Browser öffnen“. Android: Custom Tab des Systems,
  Rechner: eigenes Fenster. Im Browser wie gewohnt ein neuer Tab.
- **Bild in Bild** während der Navigation – überall nur die Karte mit dem
  eigenen Standort und oben die nächste Anweisung, keine Knöpfe, Leisten oder
  Zeiten (`js/nav/pip.js`):
  - **Android-App:** Wischt man die App weg (oder drückt Home), geht sie von
    selbst ins Mini-Fenster – die ganze App, per `html.pip-mode`
    (`css/app/dialogs.css`) auf Karte und Anweisung reduziert. Der Knopf in
    der Navigation geht sofort hinein. Ab Android 12 schaltet das System
    selbst, bei 8–11 WMap beim Verlassen. Karte und GPS laufen im
    Mini-Fenster weiter (`MainActivity.kt` setzt die Plugins nach der Pause
    gleich wieder fort; wird das Fenster weggewischt, ruhen sie).
  - **Chrome, Edge am Rechner, neue Firefox:** der Knopf schiebt die Karte
    samt Anweisung in ein Mini-Fenster über anderen Apps und Tabs
    (Document Picture-in-Picture); schließt man es, kehrt die Karte zurück.
  - **Chrome am Handy, Safari:** Video-Bild-in-Bild – Karte (nach jedem
    Kartenbild kopiert), Standortpfeil und Anweisung auf ein Canvas gemalt.

## 17. Mitmachen bei OpenStreetMap, Meldungen

- **Mitmachen:** Nach einer Fahrt kurze Fragen zu Orten, an denen man
  nachweislich war („Kostet das Parken hier etwas?“, „Hat die Bäckerei noch
  diese Zeiten?“, Belag, Beleuchtung, fehlende Wege). Zu Fuß/Rad im
  Vorbeigehen (≤ 30 m), mit dem Auto nur, wo man angehalten hat. Öffnungszeiten
  mit Wochen-Editor, „Rund um die Uhr“ und „Gibt es nicht mehr“.
- Hochladen mit OSM-Konto direkt in die Karte, sonst anonym als Hinweis.
  Das OSM-Konto ist zugleich das WMap-Konto (Abschnitt 18).
  Die Anmeldung braucht eine **OAuth-Client-ID** in `OSM_AUTH` in
  `js/core/config.js` und dieselbe in `OSM_CLIENT_ID` in `bEnd/config.php`
  (Einstellungen → Für Entwickler kann sie im Browser überschreiben – dann
  nur Karte bearbeiten, kein WMap-Konto). Einmal anlegen: openstreetmap.org
  → Mein Konto → OAuth 2 Anwendungen → „Neue Anwendung“, Weiterleitungs-URL
  `https://app.wuefl.de/wmap/oauth.html`, **nicht vertraulich** (PKCE – ohne
  diesen Haken will OSM ein Client-Geheimnis, das eine App nicht geheim
  halten kann), Rechte „Benutzereinstellungen lesen“, „Karte bearbeiten“,
  „Notizen bearbeiten“, „Melde dich mit OpenStreetMap an“ (`openid`).
  Die Client-ID ist nicht geheim und steht im Repository; ein
  Client-Geheimnis gehört nirgends hin.
  Alle WMaps (Browser, App, lokal) nutzen diese eine Weiterleitung:
  `oauth.html` reicht den Code an die WMap weiter, von der die Anmeldung
  kam (steht im `state`). In der App läuft die Anmeldung im selben Fenster
  statt im Popup; danach geht es zurück auf die Seite, von der sie kam
  (`osm/login-return.js`, geladen von `theme.js`, Ereignis `wmap:login`).
- Die Aufzeichnung dafür bleibt 14 Tage auf dem Gerät, abschaltbar.
- **Gezählt** (`osm/stats.js`): jeder hochgeladene Beitrag – Ja/Nein-Frage,
  Ort bearbeitet, Ort neu; direkt in die Karte oder als Hinweis. Auf dem Gerät
  (Einstellungen → Mitmachen: „Du hast über WMap …“) und anonym auf dem Server.
- **Orte bearbeiten und eintragen** (osm/edit.js): in der Ortskarte
  **Bearbeiten**; neben jedem Feld steht klein der OSM-Schlüssel. Der Dialog
  von oben nach unten:
  1. **Name**.
  2. **Angaben** – je Art dieselben Felder wie in den Kacheln der Ortskarte
     (`SCHEMA` in ui/poi-info.js, `editFields()`), auch die „unbekannten“:
     Zahl (Stellplätze, Ladepunkte, Höhe …), Auswahl (Gebühr, Belag, Zugang,
     Art …), Häkchen (Kraftstoffe `fuel:…`, Bezahlung `payment:…` – abhaken
     entfernt ein „yes“), an Ladesäulen je Stecker Anzahl und Leistung
     (`socket:type2`, `socket:type2:output` …), Öffnungszeiten.
  3. **Grundlegendes**, soweit nicht schon bei den Angaben: Beschreibung
     (`description`, kurz und sachlich), Öffnungszeiten, Telefon, Website.
     Telefon und Website ändern den Tag, den es schon gibt (`contact:phone`,
     `contact:website`), statt einen zweiten anzulegen.
  4. **Ausgefülltes** aus dem Rest – Adresse, Programm (`website:events`, wie
     WMap es für Veranstaltungen nutzt), Bild, Merkmale mit Wert.
  5. **Weiteres** (zugeklappt): dieselben Felder, solange sie leer sind, und
     am Ende immer **Alle Tags**.

  Die Kacheln der Ortskarte selbst öffnen nichts – bearbeitet wird nur über
  den Knopf. Bild: ein Link zu einem freien Foto (`image`); ein Link auf
  Wikimedia Commons wird zu `wikimedia_commons=File:…`.
  **Merkmale:** Lieferdienst, Zum Mitnehmen, Bio, Vegan, Vegetarisch, Draußen
  sitzen, WLAN, Drive-in, Rollstuhl – je Ja/Nur/Nein (was schon bei den
  Angaben steht, nicht noch einmal). Die Ortskarte zeigt sie wie bei Google
  unter dem Namen („Bäckerei · Lieferdienst · Bio“), darunter die
  Beschreibung (ui/poi-info.js `TRAITS`).
  **Alle Tags:** die Rohdaten, eine Zeile `Schlüssel=Wert` – ändern,
  ergänzen, Zeile löschen = Tag entfernen; was man oben in den Feldern
  ändert, läuft dort gleich mit und gilt vorrangig.
  **Eintragen:** Art (mit Suche), Marke, Name, die Angaben der gewählten Art
  (passen sich beim Wechsel an), Beschreibung, Öffnungszeiten, Telefon,
  Website, Adresse; unter „Weiteres“ Programm, Bild, Merkmale und „Weitere
  Tags“, die zu den Angaben dazukommen.
  Die **Öffnungszeiten** als aufklappbarer Block (osm/hours-editor.js):
  Montag bis Sonntag und Feiertage untereinander, rechts die Zeiten (mehrere
  je Tag, schmale Felder fürs Handy), „+ Zeit“, bei Feiertagen „wie
  Sonntag“; unten „Montag für Di–Fr“, „24/7 geöffnet“, „Dauerhaft
  geschlossen“ (geht immer als Hinweis) und „Als Text“ – zurück aus dem Text
  wird gelesen, was dasteht, nie Platzhalterzeiten. Verschachteltes
  (Monate, Schulferien) bleibt als Text, Unverändertes bleibt genau so
  stehen.
  Lange drücken → **Hier eintragen** legt einen Ort an: Art aus einer
  gruppierten Auswahl mit Suche (Einkaufen – Supermarkt, Bäckerei,
  Getränkemarkt, Drogerie … –, Essen & Trinken, Dienstleistung, Kultur &
  Freizeit; wuefl-libs selectpicker), bei Läden und Ketten die **Marke**
  (`brand`) mit Vorschlägen passend zur Art (EDEKA, REWE … bzw. Getränke
  Hoffmann, trinkgut …), Name, Öffnungszeiten, Kontakt, Adresse aus der
  Rückwärtssuche. Mit OSM-Konto geht es direkt in die Karte (ein Changeset,
  Konflikte werden erkannt). Ohne Konto erklärt ein Dialog, wozu es gebraucht
  wird: **Konto verbinden** führt zu Einstellungen → Konto
  (`settings.html#osm`), **Als Hinweis senden** schickt es anonym als Hinweis.
- **Meldungen unterwegs** (Stau, Unfall, Baustelle) mit kurzer Rückfrage für
  andere („Baustelle noch da? Ja/Nein“). Autobahn-Verkehrslage aus den offenen
  Daten der Autobahn GmbH.

## 18. WMap-Konto (OpenStreetMap) und Server

- Nur nötig zum **Eintragen in OSM, Veröffentlichen, Bewerten und für
  Plugins**. Das Konto ist das **OpenStreetMap-Konto** – bei WMap gibt es
  kein Passwort. Eine Anmeldung gilt für beides (Karte bearbeiten und
  WMap-Konto), Abmelden ebenso (`services/konto.js`).
- Ablauf: Anmelden bei OSM mit Recht `openid` → OSM schickt mit dem
  Zugangstoken ein **id_token** → `auth/osm` auf dem WMap-Server prüft es
  (`bEnd/osm_login.php`: Signatur RS256 mit den öffentlichen Schlüsseln von
  OSM, zwischengespeichert in `bEnd/data/osm-jwks.json`; Aussteller
  `https://www.openstreetmap.org`; `aud` = `OSM_CLIENT_ID`; Ablauf) → Konto
  zur OSM-Nutzernummer (`Users.osm_id`) anlegen oder wiederfinden, Name wie
  bei OSM → eigenes WMap-Token (180 Tage). Mit dem OSM-Testserver gibt es
  kein WMap-Konto.
- **Konten aus der Passkey-Zeit:** Wer noch damit angemeldet ist, bekommt
  sein Konto bei der ersten OSM-Anmeldung übernommen (mit Touren, Plugins,
  Bewertungen). Nicht mehr angemeldete Passkey-Konten bleiben in der
  Datenbank, sind aber nicht mehr erreichbar (Tabellen `Credentials`,
  `Challenges` und Spalte `handle` nur noch in alten Datenbanken).
- Server: `bEnd/api.php` (PHP, SQLite in `bEnd/data/`, von außen gesperrt).
- **Statistik** (Tabelle `Statistics`, `bEnd/api_stats.php`): eine Zeile je
  Ereignis mit Zeit (UTC), `event`, `frage` (1 = Ja/Nein-Frage, 0 = bewusst
  bearbeitet/eingetragen) und `detail` – ohne Konto, Gerät, Ort oder IP.
  Ereignisse: `osm` (von der App gemeldet, z. B. „frage karte“, „neu hinweis“),
  `konto_neu`, `konto_geloescht`, `tour_neu`, `plugin_neu`, `bewertung`
  (trägt der Server selbst ein). `stats/summary` liefert Summen und Monate.
- **Veröffentlichen ist sofort öffentlich**, wie bei Komoot. Privat heißt:
  nur für dich, aber auf allen deinen Geräten. Löschen kann jeder nur Eigenes.
- **Konto löschen:** `deleteKonto.html` (auch ohne App erreichbar, für den
  Play Store: `https://app.wuefl.de/wmap/deleteKonto.html`; Knopf in den
  Einstellungen). Nicht angemeldet: erst mit OSM anmelden, dann löschen
  (`auth/delete`). Gelöscht werden in einem Rutsch Name, OSM-Nutzernummer,
  Sitzungen, alle Touren (samt Bewertungen anderer dazu), alle Plugins und
  die eigenen Bewertungen; das OSM-Konto selbst bleibt. Anmelden geht nicht:
  per E-Mail an contact@wuefl.de.

## 19. Einstellungen

`settings.html` – eigene Seite ohne Karte (Menü der Karte → Einstellungen,
Kachel in der Übersicht).
Was die Karte betrifft (Datensparmodus), gilt beim nächsten Öffnen der Karte.

- **Darstellung:** hell oder dunkel – wie das System (Standard), Hell, Dunkel;
  in der Android-App „Berechtigungen“. Am Handy stehen Auswahlfelder unter
  ihrer Beschriftung, lange Knopftexte brechen um.
- **Unterwegs:** Karte für die Navigation offline speichern, Zoom in der
  Navigation (Automatisch/Näher/Mehr Überblick), 3D in der Navigation,
  Datensparmodus, Stimme, Spritpreise.
- **Konto** (`#osm`): Anmelden mit OpenStreetMap (zugleich WMap-Konto), wer
  angemeldet ist, Abmelden, „Konto löschen“ (→ `deleteKonto.html`), für
  Entwickler Server und Client-ID.
- **Mitmachen:** Weg aufzeichnen und danach fragen, anonym als Hinweis.
- **Daten:** Jede Navigation merken (Standard: aus – geplante Touren und
  „Aufzeichnen“ werden immer gespeichert), Sicherung & Synchronisation,
  aufgezeichnete Wege, Suchverlauf löschen.

## 20. Offline und Datenverbrauch

- Der Service Worker (`sw.js`) hält **genau eine Version** der App bereit –
  **erst Cache, sonst Netz**, auch mit Netz. Jede Version hat ihren Cache
  `wmap-app-<Version>`; beim Installieren lädt er alle Dateien aus
  `appdata/sw-files.json` vorab (von `appdata/version.py` erzeugt: alles,
  was die Seiten über `import`, `@import`, `url()`, `src`/`href` erreichen –
  aus wuefl-libs nur das Genutzte, zurzeit gut 8 MB). Nur
  `appdata/messages.json` kommt immer erst aus dem Netz (sie sagt, ob es
  Neues gibt), `bEnd/` nur aus dem Netz.
- **Updates** (`js/ui/news.js`, nur mit Netz): Ist im `changelog` eine
  neuere Version, lädt der Browser die neue `sw.js` im Hintergrund, und es
  kommt „Neue Version verfügbar“ – **Aktualisieren** oder **Später** (dann
  erst beim nächsten Start wieder). Ausgelassene Versionen werden
  übersprungen; nach dem Aktualisieren zeigt die Seite alles Neue seit der
  zuletzt gesehenen Version. Zwingend (ohne Später, Escape schließt nicht)
  bei `minVersion` bzw. `minAppVersion`, siehe `messages.json` unten.
- Auf **localhost** arbeitet der Service Worker wie früher erst mit Netz –
  Änderungen sind beim Entwickeln sofort zu sehen. Cache first ausprobieren:
  über `127.0.0.1` statt `localhost` öffnen (so auch `test/update.py`).
- Kacheln, Schriften und Symbole angesehener Gegenden bleiben im Cache
  `wmap-tiles-v1` (bis 8000 Kacheln, älteste zuerst raus).
- Vor der Navigation werden bis zu 2500 Kacheln entlang der Route geladen –
  jede Navigation in einen eigenen Cache `wmap-nav-<Zeit>`. Nach **10 Tagen**
  wird er gelöscht; reicht der Platz vorher nicht, weicht zuerst die
  **älteste** Navigation. Schon vorhandene Kacheln werden übernommen statt
  neu geladen. Höhendaten nicht – ohne Netz bleibt die Karte darum flach.
  Ohne Service Worker (App mit eingepackter Oberfläche – `http://tauri.localhost`
  darf keinen anmelden) lädt die Seite selbst vor, sechs zugleich; die
  Kacheln liegen dann im HTTP-Cache des WebViews (`saveRouteOffline`).
- **Offline-Karten** (`offline.html`, Kachel in der Übersicht, Link in den
  Einstellungen): Gebiete als Rechteck (zwei Ecken ziehen) oder freie Form
  (Punkte tippen) aufs Gerät laden. Vorher steht die Größe da – geschätzt
  aus einer Stichprobe echter Kacheln, in der Stadt sind sie viel größer als
  auf dem Land. Detail „Alles“ (bis Zoom 14) oder „Übersicht“ (bis 11), auf
  Wunsch das Gelände bis Zoom 13 für Schummerung und 3D; höchstens 60 000
  Kacheln je Gebiet. Jedes Gebiet hat einen eigenen Cache
  `wmap-area-<id>-<Zeit>` und bleibt, bis man es löscht. In der Liste:
  hinzoomen, **Neu laden** (in einen neuen Cache, der alte bleibt bis zum
  Ende nutzbar), **Weiter laden** nach Abbruch, umbenennen, löschen. Die
  Kacheln von OpenFreeMap liegen dort ohne Version im Pfad – OpenFreeMap
  baut die Karte wöchentlich neu, das Gebiet passt trotzdem
  (`sw.js`, `js/data/offline-areas.js`).
- Suche, Routing und Overpass gehen nur mit Netz.

## 21. Was wo gespeichert wird

| Was | Wo | Verlässt das Gerät? |
|---|---|---|
| Aufgezeichnete Wege | IndexedDB `wmap` / tracks | nur per Ordner, GPX, Sicherung |
| Geplante Touren | localStorage `wmap.tours` | nur per Ordner, GPX, Link, Veröffentlichen |
| Eigene Ebenen, Plugins, Zugangsdaten | IndexedDB / layers | nur „Als Plugin“ |
| Verbundener Ordner | IndexedDB / kv | nein |
| Aktive Erweiterungen | IndexedDB / kv „extensions“ | nein (der Code kommt vom Anbieter) |
| Gemerkte Verbindungen, Zuhause/Arbeit, Lesezeichen mit Listen | localStorage `wmap.saved` | nur per Ordner (`Bus & Bahn/`, `Lesezeichen.json`) oder geteilte Liste |
| Einstellungen (Auswahl) | localStorage `wmap.*` | nur per Ordner (`settings.json`) |
| Offline-Gebiete | localStorage `wmap.areas`, Kacheln im Cache `wmap-area-…` | nein |
| Verlauf, Einstellungen, Ansicht | localStorage `wmap.*` | nein |
| Veröffentlichte Touren, Bewertungen, Plugins | Server (SQLite) | ja, gewollt |

## 22. Aufruf per Link

| Link | Wirkung |
|---|---|
| `?view=lon,lat,zoom,neigung,richtung` | Kamera |
| `?q=Parkplatz` | Suche |
| `?from=Göttingen&to=Kassel&profile=bike` | Route (auch `lon,lat`) |
| `?reach=lon,lat` | Erreichbarkeit |
| `?action=route\|record\|fly\|reach\|survey` | Ansicht öffnen |
| `?ort=…`, `?route=…`, `?anfrage=…` | Geteiltes |
| `?geo=geo:51.53,9.93?q=…` | Karten-Link einer anderen App (`geo:`) – Punkt, Punkt mit Namen oder Suche |
| `?sim`, `?tempo=4` | Navigation simulieren |
| `wege.html?tab=geplant`, `?tour=ID`, `?id=ID` | Meine Touren |
| `entdecken.html#wege\|andere`, `?view=lon,lat,zoom` | Entdecken |
| `offline.html?neu` | Offline-Karten: gleich ein neues Gebiet wählen |
| `plugins.html?f=layer\|extension\|own\|active`, `?id=…` | Plugins |

## Werkzeuge

Zentral für alle Projekte unter `wuefl_products` – die Skripte liegen neben
`git-release` in `~/wuefl_profiles/shell_scripts` (im PATH):

```bash
tauri-android wmap              # bauen, aufs Handy, Protokoll
tauri-android wmap build        # nur bauen (auch: clean, install, log, connect)
tauri-android wmap release      # signiertes AAB (Play Store) + APKs → src-tauri/target/android-release/
takeshots wmap                  # Screenshots nach appdata/images/
takeshots wmap --eigener-server # ohne Docker
```

- `tauri-android` liest den Paketnamen aus `src-tauri/tauri.conf.json` und
  ruft vor jedem Bauen `tools/android-einbinden.py` des Projekts auf (bei
  WMap: Standortrechte, App-Symbol, Bild in Bild und – für `release` – die
  Upload-Signatur).
- **App-Symbol:** `python3 tools/android-symbole.py` baut
  `appdata/icons/android/` aus `appdata/wmap-1024.png` – das Logo so klein,
  dass es in jeder Maske (rund, eckig, Tropfen) ganz bleibt, auf dem
  Hintergrund des maskierbaren Web-Symbols. Nicht `cargo tauri icon` dafür
  nehmen: das legt das Logo randlos hin, dann fehlen die Ecken.
- **Release fürs Hochladen:** braucht einmalig den Upload-Schlüssel in
  `.secrets/` (weder in Git noch per FTP auf dem Server). Wie er angelegt
  und für GitHub Actions hochgeladen wird, steht in
  [`.secrets/README.md`](.secrets/README.md); fehlt er, zeigt auch
  `tauri-android wmap release` die Schritte. Gradle signiert damit AAB und
  APKs selbst. Die Version (versionCode) kommt aus
  `src-tauri/tauri.conf.json` – vor jedem Upload erhöhen.
- `takeshots` liest `appdata/takeshots.json`, setzt `{base}` auf den
  Docker-Server (`http://localhost:8080/web/wuefl_products/wmap/`) und bricht
  mit „Server nicht erreichbar“ ab, wenn der nicht läuft.
- **GitHub Actions** (`.github/workflows/build.yml`, wie bei WKeePass): ein Tag
  `v*` (von `git-release`) baut Windows (.exe), macOS (.dmg), Linux (RPM,
  AppImage, je x86_64/aarch64) und Android (AAB + APKs) und hängt alles an
  ein Release – mit festen Dateinamen, auf die wuefl.de/wmap über
  `releases/latest/download/…` zeigt: `wmap-windows-setup.exe`,
  `wmap-macos.dmg`, `wmap-x86_64.AppImage`, `wmap-aarch64.AppImage`,
  `wmap-x86_64.rpm`, `wmap-aarch64.rpm`, `wmap-android.apk` (dazu `-armv7`,
  `-x86_64`) und `wmap-android.aab`. `wuefl-libs` holt `.github/actions/wuefl-libs` (neuester Tag),
  die Web-Dateien kopiert je Job `src-tauri/web-kopieren.sh`
  (`src-tauri/tauri.ci.json` schaltet dafür den beforeBuildCommand ab). Die
  Android-Signatur kommt aus den Secrets (siehe `.secrets/README.md`).
- Weitere Hinweise: [`tools/README.md`](tools/README.md).

## Entwicklung

- Kein Build-Schritt: ES-Module direkt im Browser, UI-Bausteine aus
  `libs/wuefl-libs` (Verweis aufs Nachbarprojekt, nicht in Git).
- **Ordner in `js/`** – nach Art gruppiert:

  | Ordner | Was drin ist |
  |---|---|
  | `app.js`, `app/` | Kartenseite (`index.html`): Einstieg und ihre Teile, siehe unten |
  | `pages/` | Einstieg jeder anderen Seite: Übersicht, Meine Touren, Tour planen, Entdecken, Ebenen, Plugins, Einstellungen, Konto löschen |
  | `ui/` | HTML-Bausteine: Dialoge und Toast, Sheet, Leiste und Menü, Teilen, Höhenprofil, Ebenen-Menü, Ort-Infos, Routen-Filter, Abschnitte Bus & Bahn, Aufzeichnen, Etappen |
  | `map/` | Karte: Stil und Ebenen, eigene Ebenen, fertige Ebenen, Gebäude im Satellitenmodus, Ampeln, Orte aus den Kacheln, Tastatur, Plugins ausführen |
  | `nav/` | Navigation unterwegs: Ansicht, Ansagen, Hinweise, Bild in Bild, Meldungen |
  | `services/` | Dienste im Netz: WMap-API und Konto, Suche, Routing, Overpass, Fahrplan, ÖPNV, Verkehr, Bilder, bekannte Touren |
  | `data/` | Was auf dem Gerät bleibt: Speicher, Datenbank, Gemerktes, Wege, Spur, Ordner, ZIP, Offline |
  | `osm/` | OpenStreetMap: Anmelden und Hochladen, Objekte laden, Bearbeiten, Fragen (Mitmachen), Beiträge zählen |
  | `core/` | Grundlagen ohne Oberfläche: Endpunkte und Profile, Geometrie, Kategorien, Danksagung, Geräte-Funktionen, Hell/Dunkel |

- **Aufbau der Kartenseite** (`index.html`): `js/app.js` ist nur der Einstieg
  (Startansicht, Menü, Aufruf per Link). Die Teile liegen in `js/app/`:

  | Modul | Was |
  |---|---|
  | `core.js` | Karte, Zustand, Hilfen (Einpassen, Marker, Chips) – hängt von keinem anderen Teil ab |
  | `views.js` | Bottom-Sheet mit Zurück-Stapel |
  | `search.js` | Suchfeld, Vorschläge, Zuletzt genutzt, Merken |
  | `place.js` | Ort im Sheet, Punkt auf der Karte, Verkehrsmeldung |
  | `category.js` | Kategorien und Trefferlisten |
  | `reach.js` | Erreichbarkeit |
  | `route-plan.js` | Wegpunkte, Profil, Abfahrt ab / Ankunft bis |
  | `route-results.js` | Routen berechnen und zeigen, Bus & Bahn im Sheet |
  | `traffic-along.js` | Verkehrslage und „Entlang der Route“ |
  | `stops.js` | Haltestellen: Abfahrten, Steige, Fahrt im Detail |
  | `map-clicks.js` | Klicks und langes Drücken, Ebenen-Menü, Tastatur |
  | `nav.js` | Navigation, Bild in Bild, Offline, Suche unterwegs |
  | `report.js` | Fragen und Melden unterwegs |
  | `mitmachen.js` | Mitmachen bei OpenStreetMap |

  Die Teile rufen sich gegenseitig über Funktionen auf. Was ein Teil an
  Zustand besitzt, ändern andere nur über seine Funktionen (z. B.
  `removePlaceMarker()`, `resetStop()`, `cancelSuggestions()`).
  Oberste Ebene eines Teils: nur `core.js` benutzen – sonst kann beim Laden
  ein Wert eines anderen Teils noch fehlen.
- **Stile der Kartenseite** liegen in `css/app/` (Grundlage, Suche, Sheet,
  Karte, Navigation, Menü, Ort, Verkehr/Mitmachen, Einstellungen, Dialoge,
  Ebenen, Haltestellen, Leiste, Bus & Bahn). `css/index.css` bindet sie in
  fester Reihenfolge ein – die Reihenfolge ist die Kaskade, nicht umsortieren.
- Fremde Bibliotheken liegen fest versioniert in `libs/` und stehen in Git –
  kein CDN, damit Web, App und Offline-Cache dasselbe laden:
  MapLibre GL JS (`libs/maplibre-gl/`) und Apache ECharts für das Höhenprofil
  (`libs/echarts/`) und earcut für die Dächer der Satelliten-Häuser
  (`libs/earcut/`). Versionen in `libs/VERSIONEN.txt`; neue Version: Nummer
  in `tools/libs-holen.sh` ändern und das Skript laufen lassen.
- Lokal: Docker-Container `php` (Port 8080), Live-Neuladen auf Port 3001 nur
  mit `LIVE=1 docker compose up -d php`.
- Dienste: OpenFreeMap, Mapterhorn, Photon, Valhalla (FOSSGIS), Overpass,
  Waymarked Trails, EOX Sentinel-2, Luftbilder der Länder (12 Vermessungs-
  verwaltungen), Fahrplanauskunft (EFA) der NVBW für Bus & Bahn (DELFI-Daten,
  nicht opendata-oepnv.de), Autobahn GmbH, Tankerkönig, Geologie BGR
  (GÜK250) und Macrostrat. Die Danksagung im Dashboard kommt aus
  `js/core/credits.js`.
- **`appdata/messages.json`** – was die App den Nutzern sagt (`js/ui/news.js`):

  ```json
  {
    "welcome": ["Absatz", "…"],
    "minVersion": "2.1.0",
    "minAppVersion": "2.1.0",
    "messages": [
      { "id": "wartung-okt", "title": "Wartung", "text": ["Absatz", "…"],
        "icon": "construction", "from": "2026-10-01", "until": "2026-10-05" }
    ],
    "changelog": [{ "version": "1.0.0", "date": "2026-09-28", "changes": ["…"] }]
  }
  ```

  | Feld | Wirkung |
  |---|---|
  | `welcome` | Dialog beim allerersten Start |
  | `changelog` | nach einem Update: alle Versionen seit der zuletzt gesehenen bis zur laufenden; in der Übersicht über die Versionsnummer alles. Oberster Eintrag = neueste Version – daraus macht `git-release` den Tag und GitHub den Release-Text |
  | `messages` | Nachrichten als Dialog, jede einmal (gemerkt über `id`); `from`/`until` (Datum) optional, `text` HTML erlaubt |
  | `minVersion` | kleinste Version der **Oberfläche**. Ist die laufende älter (z. B. nach einer Änderung an der Server-API): „Update nötig“ – nur **Aktualisieren**, lädt den neuen Service Worker |
  | `minAppVersion` | kleinste Version der **App selbst** (Tauri-Teil: Rust, Kotlin, Plugins, Rechte). Ist die installierte App älter: gesperrt mit „WMap-App aktualisieren“ – sichern (in den Ordner bzw. als ZIP), dann Play Store bzw. wuefl.de. Im Browser gilt es nicht (`src-tauri/README.md`) |

  **Neue Version:** oben im `changelog` eintragen, dann
  `python3 appdata/version.py` – trägt die Nummer in `js/core/config.js`,
  `sw.js`, `src-tauri/tauri.conf.json`, `Cargo.toml` und `Cargo.lock` ein und
  schreibt `appdata/sw-files.json` neu
  (`--pruefen` nur prüfen; `git-release` prüft das vor dem Tag).

  Die Dialoge kommen nur beim normalen Start der Karte, nicht wenn ein Link
  etwas öffnet – dann beim nächsten Mal (so auch nicht auf den Screenshots).
  Gemerkt wird in localStorage `wmap.seen`. Zum Ausprobieren:
  `localStorage.setItem('wmap.seen', '{"version":"0.9.0","messages":[]}')`.
