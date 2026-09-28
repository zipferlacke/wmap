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
10. [Meine Touren: Geplant und Aufgezeichnet](#10-meine-touren-geplant-und-aufgezeichnet)
11. [Tour planen](#11-tour-planen)
12. [Aufzeichnen](#12-aufzeichnen)
13. [Entdecken](#13-entdecken)
14. [Plugins und eigene Ebenen](#14-plugins-und-eigene-ebenen)
15. [Ordner verbinden (Nextcloud, Proton Drive …)](#15-ordner-verbinden)
16. [Teilen, Standort anfragen, Bild in Bild](#16-teilen-standort-anfragen-bild-in-bild)
17. [Mitmachen bei OpenStreetMap, Meldungen](#17-mitmachen-bei-openstreetmap-meldungen)
18. [WMap-Konto (Passkey) und Server](#18-wmap-konto-passkey-und-server)
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
  (mit eigenem Tankerkönig-Schlüssel). Knöpfe: Route, Als Start,
  Erreichbar, Merken, Teilen, Bearbeiten (OSM) bzw. am freien Punkt „Hier
  eintragen“.
- **Merken:** ein Knopf für alles – ein Tipp legt ein **Lesezeichen** an
  (Ort, Adresse, Haltestelle), noch einer („Gemerkt“) nimmt es weg. Die
  Meldung danach bietet „Zuhause / Arbeit“ an. Lesezeichen stehen in der
  Suche und in den Feldern der Routenplanung ganz oben (bei Bus & Bahn die
  Haltestellen zuerst).
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
- Der Pfeil bleibt auf der Straße, bis **3 Meldungen hintereinander mehr als
  40 m** daneben liegen – erst dann gilt man als abgekommen und die Route wird
  neu berechnet (danach 10 s Pause bis zur nächsten Neuberechnung).
- Ab Zoom **16,2** wird die Fahrbahn mit ihren **echten Spuren** gezeichnet
  (Breite in Metern, Pfeile auf dem Asphalt, Übergänge über 50 m weich). Der
  Pfeil fährt dann in seiner Spur rechts der Mitte.

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

**Spurleiste:** Vor einer Kreuzung (bis 700 m vorher) zeigt die Leiste oben
alle Spuren mit Pfeilen; die richtigen sind hervorgehoben.

**Tempo:** aktuelles Tempo und – wo bekannt – das erlaubte; über dem Limit
(+3 km/h) wird die Anzeige rot.

**Sonstiges:** Der Bildschirm bleibt an (Wake Lock). Vor dem Start wird auf
Wunsch die Karte entlang der Route offline gespeichert. In der Navigation
nutzt das Gelände gröbere Höhendaten (siehe [7](#7-3d-gelände-und-höhen)).
Zum Testen: `?sim` fährt die Route simuliert ab, `?tempo=4` im Zeitraffer.

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

## 7. 3D, Gelände und Höhen

- **Von selbst 3D:** Ab Zoom **15,5** neigt sich die Karte auf 50° und das
  Gelände kommt dazu; unter Zoom **12,5** wird sie wieder flach. Wer selbst
  neigt oder das Gelände schaltet, behält seine Wahl.
- **Höhendaten:** Mapterhorn, in Deutschland bis Zoom 16 – das sind
  **≈ 0,75 m je Pixel**, gerechnet aus den amtlichen 1-m-Geländemodellen der
  Länder. Die **normale Karte nutzt diese volle Auflösung**. In der
  **Navigation** reicht Zoom 13 (≈ 6 m): weniger Daten, und die Straße liegt
  ruhiger, weil kleine Höhenfehler sie sonst wellen.
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
  und – wo es passt – einer Zahl: Karte (groß), Meine Touren (Anzahl
  geplant), Aufgezeichnet (Anzahl, km in diesem Jahr), Entdecken, Plugins
  (Anzahl aktiv), Mitmachen, Einstellungen. Tour planen, Aufzeichnen,
  Fliegen und Erreichbarkeit gibt es in Karte bzw. Touren.
- **Gespeichert auf diesem Gerät:**
  - Karten für die Navigation: jede vorgeladene Navigation mit Datum, Anzahl
    Kacheln und wie viele Tage sie noch bleibt; dazu Kacheln angesehener
    Gegenden – alles löschen
  - Letzte Routen – einzeln (✕) oder alle löschen; antippen öffnet sie
  - Suchverlauf – löschen
  - Speicher insgesamt, Ordner verbinden
- **Danke-Banner** (grün, Hand mit Herz) mit allen Anbietern und dem Knopf
  „Entwicklung unterstützen“ (paypal.me/wuefl), darunter Version und Impressum.

## 10. Meine Touren: Geplant, Aufgezeichnet, Bus & Bahn

Eine Seite, drei Reiter (`wege.html`). Der
dritte, **Bus & Bahn** (`?tab=bahn`), zeigt gemerkte Verbindungen: kommende
oben, **vergangene zugeklappt** darunter; im Detail alle Abschnitte zum
Aufklappen, auf der Karte jede Fahrt in ihrer Farbe; Knöpfe Neu suchen,
Ticket bei der Bahn, Löschen. Die ersten zwei:

| | Geplant | Aufgezeichnet |
|---|---|---|
| Was | Touren, die man noch machen will | was man wirklich gefahren/gelaufen ist |
| Woher | Planer, übernommene bekannte Wege, GPX ohne Zeiten | Aufzeichnen, Navigation, GPX mit Zeiten |
| Gruppen | Zu Fuß · Rad · Auto | Jahre (je Jahr eine Farbe) |
| Zahlen | Strecke, Anstieg | Strecke, Zeit in Bewegung, Tempo, Puls |

- **Liste:** Suche oben (Name, Ort, Jahr, Monat, Profil …), darunter je Gruppe
  eine Tabelle. Überfahren einer Zeile hebt die Linie auf der Karte hervor.
  Auf der Karte liegt nur der aktive Reiter.
- **Detail** (Zeile oder Linie antippen): Name oben, ← zurück zur Liste.
  - Aufgezeichnet: Name änderbar, Datum und Uhrzeit, Strecke, Zeit in
    Bewegung, Ø und max. km/h, Anstieg, Ø/max. Puls (aus GPX), Höhenprofil;
    die Linie ist nach Tempo gefärbt (langsam orange → schnell grün).
    Knöpfe: Als Tour speichern, Als Tour teilen, GPX, Löschen.
  - Geplant: Profil, Strecke, Dauer, Anstieg/Abstieg, Beschreibung,
    Höhenprofil. Knöpfe: Im Planer öffnen, Teilen, GPX, Löschen.
- **Unten:** Tour planen bzw. Aufzeichnen, GPX
  importieren (doppelte Wege werden erkannt), Sicherung speichern/laden,
  Ordner verbinden.

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
  Gerät. Auch Navigationen werden aufgezeichnet (abschaltbar: Einstellungen →
  Fahrten merken).
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

## 15. Ordner verbinden

Wege und Touren als GPX-Dateien in einem Ordner, den ein Sync-Programm mit der
Cloud abgleicht – **Nextcloud, Proton Drive, Google Drive, Syncthing**. WMap
braucht dafür kein Konto, es liest und schreibt nur Dateien.

```
WMap/Geplant/Harzer Hexenstieg.gpx
WMap/Abgeschlossen/2026/2026-09-20 Radtour am Samstagnachmittag.gpx
WMap/Gemerkt.json
```

`Gemerkt.json` hält gemerkte Verbindungen (Bus & Bahn), Zuhause, Arbeit und
Lesezeichen (data/saved.js): je Eintrag gewinnt das Neuere, Gelöschtes steht ein
Jahr lang in `deleted`, damit es nicht von einem anderen Gerät zurückkommt.

Heißt der verbundene Ordner selbst „WMap“, entfällt diese Ebene.

- Zu finden in Einstellungen → Daten, Meine Touren (unten) und Übersicht.
- **Abgleich** beim Öffnen einer Seite, nach jeder Aufzeichnung und nach dem
  Speichern im Planer (2,5 s nach der letzten Änderung):
  - nur im Ordner → übernehmen; nur in WMap → Datei schreiben
  - im Ordner gelöscht → auch in WMap weg; in WMap gelöscht → Datei weg
  - beides geändert → das Neuere gewinnt
- Erkannt wird eine Datei am Stichwort `wmap:ID` in der GPX-Datei; fremde
  GPX (Garmin, Komoot-Export …) dürfen irgendwo im Ordner liegen – mit Zeiten
  werden sie ein Weg, sonst eine Tour. Puls bleibt erhalten.
- **Wo es geht:** Chrome und Edge (Rechner und Android). Am Handy wählt man den
  Ordner in der Drive-App aus – ob Proton Drive dort Ordner anbietet, hängt
  von der Proton-App ab. Der Browser fragt nach einem Neustart ggf. erneut
  nach dem Zugriff („Erlauben und abgleichen“).
- **Sicherung als ZIP** (Meine Touren unten): dieselbe Ordnung
  (`WMap/Geplant/…`, `WMap/Abgeschlossen/<Jahr>/…`) als GPX, dazu
  `WMap/wmap-sicherung.json` mit allem für die Wiederherstellung. „Sicherung
  laden“ nimmt das ZIP (oder eine alte `.json`); ein ZIP ohne JSON, etwa ein
  gezippter GPX-Ordner von woanders, wird als GPX eingelesen.
- **Ohne Ordner-Zugriff** (Firefox, Safari, App): „Ordner einlesen“ holt alle
  GPX eines Ordners herein; „Alles teilen“ schickt alle GPX an das
  Teilen-Menü (z. B. „In Proton Drive speichern“).

## 16. Teilen, Standort anfragen, Bild in Bild

- **Teilen per Link** – ohne Server, alles steckt in der Adresse: ein Ort,
  „Hier bin ich“ (mit Uhrzeit), eine Route mit Profil und Wegpunkten, eine
  Tour (`tour.html#t=…`), in der Navigation die Ankunftszeit.
- **Standort anfragen:** Link schicken; wer ihn öffnet, schickt seinen
  Standort zurück.
- **Bild in Bild** während der Navigation:
  - **Android-App:** Wischt man die App weg (oder drückt Home), geht sie von
    selbst ins Mini-Fenster – die ganze App, also Karte und Anweisung; Knöpfe,
    Suche und Leisten verschwinden darin. Der Knopf in der Navigation geht
    sofort hinein. Ab Android 12 schaltet das System selbst, bei 8–11 WMap
    beim Verlassen. Die Karte läuft im Mini-Fenster weiter.
  - **Chrome, Edge, neue Firefox:** der Knopf schiebt die Karte samt
    Anweisung in ein Mini-Fenster über anderen Apps und Tabs; schließt man es,
    kehrt die Karte zurück.
  - **Safari:** nur die Anweisung, als Video.

## 17. Mitmachen bei OpenStreetMap, Meldungen

- **Mitmachen:** Nach einer Fahrt kurze Fragen zu Orten, an denen man
  nachweislich war („Kostet das Parken hier etwas?“, „Hat die Bäckerei noch
  diese Zeiten?“, Belag, Beleuchtung, fehlende Wege). Zu Fuß/Rad im
  Vorbeigehen (≤ 30 m), mit dem Auto nur, wo man angehalten hat. Öffnungszeiten
  mit Wochen-Editor, „Rund um die Uhr“ und „Gibt es nicht mehr“.
- Hochladen mit OSM-Konto direkt in die Karte, sonst anonym als Hinweis.
  Die Anmeldung braucht eine OAuth-Client-ID (Einstellungen → Für
  Entwickler); fehlt sie, sagt der Dialog das.
- Die Aufzeichnung dafür bleibt 14 Tage auf dem Gerät, abschaltbar.
- **Gezählt** (`osm/stats.js`): jeder hochgeladene Beitrag – Ja/Nein-Frage,
  Ort bearbeitet, Ort neu; direkt in die Karte oder als Hinweis. Auf dem Gerät
  (Einstellungen → Mitmachen: „Du hast über WMap …“) und anonym auf dem Server.
- **Orte bearbeiten und eintragen** (osm/edit.js): in der Ortskarte
  **Bearbeiten** (Name, Öffnungszeiten, Telefon, Website eines Orts aus OSM);
  lange drücken → **Hier eintragen** legt ein Unternehmen oder einen
  Veranstaltungsort an (Art, Name, Öffnungszeiten, Kontakt, Adresse aus der
  Rückwärtssuche). Mit OSM-Konto geht es direkt in die Karte (ein Changeset,
  Konflikte werden erkannt). Ohne Konto erklärt ein Dialog, wozu es gebraucht
  wird: **Konto verbinden** führt zu Einstellungen → OpenStreetMap
  (`settings.html#osm`), **Als Hinweis senden** schickt es anonym als Hinweis.
- **Meldungen unterwegs** (Stau, Unfall, Baustelle) mit kurzer Rückfrage für
  andere („Baustelle noch da? Ja/Nein“). Autobahn-Verkehrslage aus den offenen
  Daten der Autobahn GmbH.

## 18. WMap-Konto (Passkey) und Server

- Nur nötig zum **Veröffentlichen, Bewerten und für Plugins**. Anmeldung mit
  **Passkey** (Fingerabdruck, Gesicht, Geräte-PIN) – kein Passwort.
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
  Einstellungen). Bestätigt wird mit dem Passkey selbst (`auth/delete_options`,
  `auth/delete`) – das Token allein reicht nicht. Gelöscht werden in einem
  Rutsch Name, Passkeys, Sitzungen, alle Touren (samt Bewertungen anderer
  dazu), alle Plugins und die eigenen Bewertungen. Ohne Passkey: per E-Mail
  an contact@wuefl.de.

## 19. Einstellungen

`settings.html` – eigene Seite ohne Karte (Menü der Karte → Einstellungen,
Kachel in der Übersicht).
Was die Karte betrifft (Datensparmodus), gilt beim nächsten Öffnen der Karte.

- **Darstellung:** hell oder dunkel – wie das System (Standard), Hell, Dunkel.
- **Unterwegs:** Karte für die Navigation offline speichern, Zoom in der
  Navigation (Automatisch/Näher/Mehr Überblick), 3D in der Navigation,
  Datensparmodus, Stimme, Spritpreise.
- **Mitmachen:** Weg aufzeichnen und danach fragen, anonym als Hinweis,
  OSM-Konto.
- **WMap-Konto:** wer angemeldet ist, Knopf „Konto löschen“ (→ `deleteKonto.html`).
- **Daten:** Fahrten merken, Ordner verbinden, aufgezeichnete Wege,
  Suchverlauf löschen.

## 20. Offline und Datenverbrauch

- Der Service Worker hält die App offline bereit (erst Netz, sonst Cache).
- Kacheln, Schriften und Symbole angesehener Gegenden bleiben im Cache
  `wmap-tiles-v1` (bis 8000 Kacheln, älteste zuerst raus).
- Vor der Navigation werden bis zu 2500 Kacheln entlang der Route geladen –
  jede Navigation in einen eigenen Cache `wmap-nav-<Zeit>`. Nach **10 Tagen**
  wird er gelöscht; reicht der Platz vorher nicht, weicht zuerst die
  **älteste** Navigation. Schon vorhandene Kacheln werden übernommen statt
  neu geladen. Höhendaten nicht – ohne Netz bleibt die Karte darum flach.
- Suche, Routing und Overpass gehen nur mit Netz.

## 21. Was wo gespeichert wird

| Was | Wo | Verlässt das Gerät? |
|---|---|---|
| Aufgezeichnete Wege | IndexedDB `wmap` / tracks | nur per Ordner, GPX, Sicherung |
| Geplante Touren | localStorage `wmap.tours` | nur per Ordner, GPX, Link, Veröffentlichen |
| Eigene Ebenen, Plugins, Zugangsdaten | IndexedDB / layers | nur „Als Plugin“ |
| Verbundener Ordner | IndexedDB / kv | nein |
| Aktive Erweiterungen | IndexedDB / kv „extensions“ | nein (der Code kommt vom Anbieter) |
| Gemerkte Verbindungen, Zuhause/Arbeit, Lesezeichen | localStorage `wmap.saved` | nur per Ordner (`Gemerkt.json`) |
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
| `?sim`, `?tempo=4` | Navigation simulieren |
| `wege.html?tab=geplant`, `?tour=ID`, `?id=ID` | Meine Touren |
| `entdecken.html#wege\|andere`, `?view=lon,lat,zoom` | Entdecken |
| `plugins.html?f=layer\|extension\|own\|active`, `?id=…` | Plugins |

## Werkzeuge

Zentral für alle Projekte unter `wuefl_products` – die Skripte liegen neben
`git-release` in `~/wuefl_profiles/shell_scripts` (im PATH):

```bash
tauri-android wmap              # bauen, aufs Handy, Protokoll
tauri-android wmap bauen        # nur bauen (auch: sauber, install, log)
tauri-android wmap release      # signiertes AAB (Play Store) + APKs → src-tauri/target/android-release/
takeshots wmap                  # Screenshots nach appdata/images/
takeshots wmap --eigener-server # ohne Docker
```

- `tauri-android` liest den Paketnamen aus `src-tauri/tauri.conf.json` und
  ruft vor jedem Bauen `tools/android-einbinden.py` des Projekts auf (bei
  WMap: Standortrechte, App-Symbol, Bild in Bild und – für `release` – die
  Upload-Signatur).
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
  ein Release. `wuefl-libs` holt `.github/actions/wuefl-libs` (neuester Tag),
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
- Änderungen stehen in `appdata/messages.json` (erscheinen in der App).
