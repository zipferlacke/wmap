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
15. [Sicherung & Synchronisation: Ordner, Health Connect](#15-sicherung--synchronisation-ordner-health-connect)
16. [Teilen, Standort anfragen, Bild in Bild](#16-teilen-standort-anfragen-bild-in-bild)
17. [Mitmachen bei OpenStreetMap, Meldungen](#17-mitmachen-bei-openstreetmap-meldungen)
18. [WMap-Konto (OpenStreetMap) und Server](#18-wmap-konto-openstreetmap-und-server)
19. [Einstellungen](#19-einstellungen)
20. [Offline und Datenverbrauch](#20-offline-und-datenverbrauch)
21. [Was wo gespeichert wird](#21-was-wo-gespeichert-wird)
22. [Aufruf per Link](#22-aufruf-per-link)
23. [Android Auto](#23-android-auto)
24. [Werkzeuge](#werkzeuge)
25. [Entwicklung](#entwicklung)

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
- **Seiten ohne Karte** (Übersicht, Plugins, Einstellungen, Sicherung &
  Synchronisation, Offline, GPX öffnen) zeichnen keine Karte, sondern haben
  eine **Navigationsleiste** – am Rechner links, am Handy unten:
  Karte · Übersicht · Touren · Entdecken · Plugins (`js/ui/appbar.js`).

**Kartenseiten mit Panel** (Meine Touren, Entdecken) sind alle gleich gebaut:

- Karte über den ganzen Bildschirm, daneben das Panel als **Seitenleiste zum
  Ziehen** – ein `userDialog` aus wuefl-libs mit `position: { wide: 'left',
  small: 'bottom' }` und `backgroundUsage` (`js/ui/side-panel.js`): **am
  Rechner links in voller Höhe, am Handy von unten**. Kein grauer Hintergrund:
  die Karte bleibt bedienbar. Der Inhalt steht im HTML der Seite und zieht beim
  Start in den Dialog um – hinter dessen Formular, weil die Seiten eigene
  Formulare haben (Suche, Bewertung). Was die Bibliothek nicht anbietet, läuft
  dort über ihren Griff: Starthöhe am Handy (58 %), gemerkte Größe und
  Einklappen aus dem Programm.
- **← oben links:** in der Liste zurück zur Übersicht, in einer Detailansicht
  zurück zur Liste. Im Detail steht oben der Name der Tour/des Wegs.
- **✕ oben rechts:** schließt die Seite und führt zur Karte.
- **Griff** über die ganze Kante (am Rechner der rechte Rand, am Handy oben):
  **ziehen** macht das Panel breiter bzw. höher (mind. 300 px, höchstens
  70 % der Breite; am Handy bis 92 % der Höhe). **Weiter als das
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
  Server, der ablehnt (429 bzw. 406) oder überlastet ist (5xx), bekommt 60,
  30 bzw. 20 s Pause – das gilt für alle Overpass-Abfragen der App.
- **Overpass und Kennung:** Die öffentlichen Server verlangen einen
  User-Agent oder Referer, der die App eindeutig erkennen lässt (sonst 406;
  [Nutzungsregeln](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances):
  unter 10 000 Abfragen und 1 GB am Tag, nach 406/429 mindestens 30 s
  Pause). Im Browser schickt der Browser den Referer `app.wuefl.de` mit. Die
  Apps laufen auf `tauri://localhost` bzw. `http://tauri.localhost` – ohne
  bzw. ohne eindeutigen Referer; dort fragt die App selbst (Befehl
  `overpass` in `src-tauri/src/lib.rs`, nur die Server aus
  `API.overpass`) mit User-Agent `WMap/<Version> (+https://wuefl.de/wmap)`
  und Referer `https://app.wuefl.de/wmap/`. Eine E-Mail braucht es nicht.
  Für eine App für alle raten die Regeln langfristig zu einem eigenen
  Overpass-Server.
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
- **Eigener Standort von Anfang an:** Ist der Standort schon freigegeben,
  steht der Punkt gleich auf der Karte – auch in der Routenansicht, wo
  „Mein Standort“ keinen eigenen Startpunkt hat –, ohne dass die Karte
  dafür verschoben wird (`showDot` in `js/app/core.js`: der Standort-Knopf
  startet „im Hintergrund“). Ein Tipp auf den Knopf springt wie gewohnt
  hin. Gefragt wird beim Start nicht. In der **Routenansicht** steht er als
  Pfeil wie in der Navigation (weiße Scheibe, blauer Pfeil in
  Blickrichtung; `.wmap-arrow`, `body.route-view`).
- **Folgen endet, wenn die Karte von selbst woanders hingeht** (Route
  einpassen, Ort zeigen – `releaseLock` in `js/app/core.js`): MapLibre
  lässt den Standort-Knopf nur beim Verschieben los, nicht bei einem Flug
  mit Zoom; die Routenübersicht sprang sonst mit der nächsten
  Standortmeldung zurück zum eigenen Standort.
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
- **Nahes zuerst** (`js/services/geocode.js`): Photon reiht bekannte Orte
  weit weg – auch im Ausland – gern vor gleichnamige um die Ecke. Darum
  fragt die Suche zusätzlich nur die Umgebung (40 km um den eigenen
  Standort, solange er im Kartenausschnitt liegt, sonst um die Kartenmitte)
  und stellt diese Treffer nach vorn; nur ein großer Ort (Stadt, Land) als
  erster Treffer bleibt vorn – wer „Berlin“ tippt, meint Berlin. Unter dem
  Namen steht der **Ort vor der Gemeinde**: „Rittmarshausen, Gleichen“
  statt nur „Gleichen“.
- **Entfernung an jedem Treffer** (rechts über der Art), sobald der eigene
  Standort bekannt ist: bei den ersten drei die Strecke auf der Straße –
  dieselbe Zahl wie danach in der Route, gerechnet mit dem zuletzt
  genutzten Profil –, bei den übrigen „≈“ und die Luftlinie. Die genauen
  Zahlen kommen kurz nach der Liste (`fillRoad` in `js/app/search.js`,
  `roadDistances` in `js/services/routing.js`).
- **Kategorien** („Parkplatz“, „Bäckerei“, „Fluss“ …): zuerst sofort aus den
  Kartenkacheln (Zoom 14, ohne Netzabfrage), dann ergänzt aus Overpass
  (Flächen, Linien, seltene Kategorien). Restaurants zeigen auch Imbisse.
- **Treffer mit Nummer:** In jeder Trefferliste (Kategorie, Erreichbarkeit,
  entlang der Route, in der Navigation) trägt der Eintrag seine Nummer am
  Namen – „Parkplatz, (3)“ – und steht mit derselben Nummer auf der Karte:
  eine Pille in der Farbe der Kategorie mit ihrem Symbol und der Nummer,
  auch an Flächen (`numberHits` in `js/app/category.js`; Ebenen `hl-nr`,
  `poi-nr`, Bild `hit-<Kategorie>-<Nummer>` in `js/map/map.js`). Treffer,
  die die Liste nicht mehr zeigt, behalten den Tropfen ohne Nummer.
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
  Auf der Karte ist die gewählte Route breit mit weißem Rand, die Alternativen sind etwas
  schmaler und leicht durchscheinend (`route-main`, `route-alt` in `js/map/map.js`).
  Das Höhenprofil folgt dem in WMap gewählten Thema und zeichnet sich beim Wechsel neu
  (`js/ui/elevation.js`); Gitter und Achsen sind hell wie dunkel dasselbe leichte Grau.
- **Mit dem Auto zu einem Geschäft, Lokal, einer Praxis …:** Hineinfahren kann man dort nicht – die Route
  endete an der Straße, die dem Punkt des Orts am nächsten liegt (oft die Rückseite), und „Ziel erreicht“
  kam dort. Liegt ein Parkplatz direkt am Ort (sein Rand höchstens 75 m vom Punkt, nicht privat), endet die
  Fahrt jetzt dort: Die Nadel bleibt am Ort, ein „P“ markiert das Ende, im Sheet steht „Die Fahrt endet am
  Parkplatz davor – 40 m bis …“; Navigation und Neuberechnen fahren denselben Punkt an (`state.drive`).
  Sonst bleibt alles wie bisher. Gilt für Ziele, die als Ort gewählt wurden (Wegpunkt mit `poi` – Suche,
  Kategorie, Tipp auf die Karte, damit gemerkte Lesezeichen und letzte Ziele, auch im Auto), nicht für
  Adressen, Punkte auf der Karte, Zwischenziele oder Orte, in die man hineinfährt (Parkplatz, Tankstelle,
  Ladesäule). Gefragt wird Overpass (höchstens 2,5 s, kennt „privat“), sonst zählen die Parkplätze aus den
  Kartenkacheln (`js/app/drive-target.js`).
- **Routenserver antwortet nicht:** Die Abfrage versucht es nach 1,5 s von selbst noch einmal.
  Klappt auch das nicht, steht statt „Load failed“ ein verständlicher Satz da (Server nicht
  erreichbar, überlastet oder kein Netz) und darunter der Knopf **Erneut versuchen**
  (`request` in `js/services/routing.js`, `routeStatus` in `js/app/route-results.js`).
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
- **Start:** in gut 1,5 s in der Fahreransicht (Zoom, Neigung, Richtung
  die ersten 3 s zügig), danach wird ruhig nachgeführt.
- **Strom:** Bewegt sich nichts (Ampel, Pause), wird nicht gezeichnet und nur
  alle 250 ms nachgesehen statt bei jedem Bild des Bildschirms (bis 120/s);
  eine neue Meldung weckt sofort. Die Route wird nur neu an die Karte
  gegeben, wenn man ≥ 8 m weiter ist (sie wird dabei jedes Mal neu in
  Kacheln zerlegt).
- Die Richtung folgt der Straße voraus (Blick 12–55 m nach vorn, je nach
  Tempo), nicht der sprunghaften GPS-Richtung.
- **Im Stand** wandert das GPS um einige Meter und meldet ein kleines Tempo.
  Zwei ruhige Meldungen hintereinander (unter 0,5 m/s) → der Pfeil hält in
  der Mitte der beiden, Tempo **0**. Er läuft erst wieder, wenn das GPS
  zweimal hintereinander Fahrt misst (ab 0,9 m/s) oder man sich weiter
  entfernt als die doppelte Ungenauigkeit (mindestens 12 m).
- Bei schwachem Signal meldet das GPS auch im Stand 1–2 m/s (am Handy
  gemessen). Das Tempo zählt darum nur, wenn man in den letzten 8 s auch
  vorangekommen ist (≥ 6–8 m je nach Ungenauigkeit, gut ein Drittel dessen,
  was das Tempo verspricht) und in den letzten 5 s ≥ 3–5 m – sonst 0
  (`trustedSpeed` in `core/smooth.js`, ebenso für den Punkt auf der Karte
  und wie oft er fragt).
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
- **Korrigiertes Plugin:** `tauri-plugin-geolocation` 2.4.0 beantwortet unter
  Android den Aufruf `watchPosition` nie; die Rust-Seite wartet blockierend
  darauf und hält je Aufruf einen Arbeits-Thread der App fest. Nach acht
  solchen Aufrufen (Pixel 9) antwortete die App auf nichts mehr – „Webseite
  nicht verfügbar – http://tauri.localhost“. WMap bringt das Plugin darum
  als korrigierte Kopie mit (`src-tauri/plugins/geolocation`, was geändert
  ist, steht dort in `WMAP.md`; eingebunden über `[patch.crates-io]` in
  `src-tauri/Cargo.toml`). Läuft die Oberfläche in einer älteren App ohne
  diese Korrektur, startet `native.js` die Abfrage nur neu, wenn sie öfter
  kommen muss.

**Kamera** – feste Stufen statt ständigem Nachregeln; eher von schräg oben
als aus Fahrersicht, damit Häuser Straße und Abzweig nicht verdecken:

| Umgebung | normal | kurz vor dem Abbiegen* |
|---|---|---|
| Stadt | Zoom 17,1 · 49° | 17,8 · 45° |
| Land | 16,2 · 54° | 17,2 · 50° |
| Autobahn/schnell (≥ 100 km/h) | 15,2 · 56° | 16,6 · 52° |
| Zu Fuß | 17,7 · 44° | 18,4 · 45° |
| verzwickte Stelle (Kreisel, ≥ 3 Spuren, zwei Manöver dicht) | – | 18,1 · 40° |

\* „kurz vor dem Abbiegen“: weniger als 30 s oder 150 m (zu Fuß 40 m).
Einstellung „Zoom in der Navigation“: Näher +0,7, Mehr Überblick −0,9. Der
eigene Standort liegt im unteren Drittel, damit man voraus sieht.

**Knöpfe**

- **Folgen-Knopf** (einer für alles): **blau**, solange die Karte folgt.
  Antippen, während sie folgt, wechselt zwischen geneigt (3D) und flach.
  Verschiebt, dreht, neigt oder zoomt man die Karte selbst, hört sie auf zu
  folgen und der Knopf wird **farblos** und zeigt die Nadel im Kreis
  (`share_location`); Antippen holt sie zurück.
- **Kompass:** Fahrtrichtung oben ↔ Norden oben.
- **Übersicht:** ganze Restroute im Bild.
- **Stumm**, **Suchen** (entlang der Route), **Teilen** (Ankunftszeit als
  Link, mit dem üblichen Teilen-Symbol), **Beenden**. Nach dem Beenden ist die Route weg. **Melden** (Glocke)
  ist vorerst ausgeblendet (`.nav-report` in `css/app/navigation.css`), bis
  es fertig ist.
- Knöpfe rechts und Tempo links stehen immer über der Leiste unten – deren
  Höhe misst ein ResizeObserver (`--nav-bar-h`; Gestenleiste, große
  Systemschrift, Offline-Hinweis).

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
  (Anzahl aktiv), **Offline** (Gebiete und ihre Größe; führt zur Seite
  „Offline“, siehe [20](#20-offline-und-datenverbrauch)), Mitmachen,
  **Sicherung & Synchronisation**
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
| Gruppen | Zu Fuß · Rad · Auto | Jahre, jede Tour in der Farbe ihrer Art |
| Zahlen | Strecke, Anstieg | Strecke, Zeit in Bewegung, Tempo, Puls |

- **Oben:** Tour planen bzw. Aufzeichnen und GPX/FIT importieren (mehrere
  Dateien bzw. solche, die es als Tour schon gibt: mit der Rückfrage aus
  [15](#mehrere-dateien-eine-frage-für-alle)), darunter die Suche (Name, Ort, Jahr, Monat, Profil …),
  dann je Gruppe eine Tabelle – Jahre bzw. Gruppen als Aufklapp-Zeile mit
  Pfeil. Überfahren einer Zeile hebt die Linie auf der Karte hervor.
  **GPX- und FIT-Dateien lassen sich auf die Seite ziehen** (Drag & Drop, eine
  oder mehrere – dieselbe Rückfrage): unter
  „Geplant“ werden es Touren, sonst aufgezeichnete Touren.
- **Aufgezeichnet – Art, Farbe, Alter** (`js/data/track-look.js`):
  - Jede Tour hat eine **Art** (Gehen, Wandern, Laufen, Rad, Auto, Rudern …):
    aus Health Connect, bei eigenen Aufzeichnungen aus dem Profil, aus einer
    fremden GPX-Datei, wenn sie sie in `<type>` nennt (running, cycling …) –
    oder von Hand gewählt. Ohne Art heißt sie nur „GPX“, mit neutralem
    Symbol in Grau.
  - **Farbe:** die der Art (Gehen orange, Rad grün, Rudern petrol, Auto blau
    …) oder eine eigene je Tour. **Je älter, desto blasser:** bis einen
    Monat voll, dann in Monatsschritten bis 0,4 ab zwei Jahren.
  - **Zeile:** Symbol der Art in ihrer Farbe, Name, darunter Datum · Art ·
    Herkunft (ohne Uhrzeit) und kleine Symbole: Gesundheitsdaten (Puls,
    Frequenz, Leistung), offline verfügbar, liegt im Ordner. Rechts das
    **Auge der Zeile**: diese eine Tour auf der Karte aus- bzw. einblenden.
  - **Auf der Karte** liegt, was in den eingestellten Zeitraum fällt
    (Einstellungen → Daten: alle · dieses Jahr · letzte 365 · letzte 30
    Tage). Das **Auge am Jahr** blendet ein Jahr ein oder aus, das Auge an
    der Zeile (und „Auf der Karte“ in der Tour) eine einzelne – das geht
    vor; Jahre ohne Sichtbares sind
    zugeklappt, das Auge durchgestrichen. Die Suche zeigt alle Treffer.
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
    gefärbt (langsam grün → schnell rot).
    **Diagramm** mit Umschalter: Höhe, Tempo, Puls, Schritt- bzw.
    Trittfrequenz, Leistung – nur, was gemessen wurde; Zeiger im Diagramm
    und auf der Linie zeigen dieselbe Stelle. Der Knopf rechts im Kopf
    öffnet es im **Vollbild** (auch in der Route und im Tourenplaner; die
    Umschalter ziehen mit, zoomen geht nur dort – `js/ui/elevation.js`).
    **Runden** – die der Uhr („Uhr“, wenn die Tour welche hat: aus der
    FIT-Datei, `marks`) oder zu 1, 2 oder 5 km (gemerkt; Rudern und Paddeln 500 m, 1, 2 km):
    Zeit, Tempo (zu Fuß als min/km, Rudern je 500 m, Schwimmen je 100 m),
    Ø Puls, Anstieg; die schnellste grün, die langsamste rot, eine Runde
    antippen hebt sie auf der Karte hervor (`js/data/track-stats.js`).
    Die Frequenz heißt je Art Schritt-, Tritt-, Schlag- bzw. Zugfrequenz.
    (Zepp liefert über Health Connect fürs Rudern nur Puls und Strecke:
    als Frequenz kommen ein paar Werte aus den letzten Sekunden, alle 0,
    und ein einziger Abschnitt mit „1 Wiederholung“ – am Handy
    nachgemessen. Die Schlagfrequenz steht nur in der FIT-Datei, die Zepp
    exportiert – im GPX von Zepp ist sie bei Bootstouren 0. Über „GPX
    öffnen“ kommt sie in die vorhandene Tour; `tools/zepp/` exportiert
    alle Trainings aus der Zepp-App.)
    **Herunterladen** fragt nach GPX (alles, was WMap zur Tour weiß) oder
    FIT (`js/data/fit.js` – Punkte, Puls, Frequenz, Leistung, Runden,
    Sportart); **Teilen** gibt immer nur den Link, nie eine Datei.
    **Art, Farbe und Anzeige** – ein Block zum Auf- und Zuklappen (zu; der
    Kopf nennt Art, Farbe und ob die Tour ausgeblendet bzw. offline
    verfügbar ist; beim Ändern bleibt er offen): Art wählen, Farbe (die der
    Art, eine von zwölf oder frei), „Auf der Karte“ ein/aus und – mit
    verbundenem Ordner – „Offline verfügbar“ (bleibt ganz in der App, siehe
    [15](#15-sicherung--synchronisation-ordner-health-connect)).
    Art, Farbe und Ausblenden stehen in der GPX-Datei (`<wmap:track sport
    color hidden …/>`) und gelten damit auf allen Geräten.
    Knöpfe:
    - **Navigieren** (`index.html?track=ID&start`): der Verlauf als Punkte,
      dazwischen wird neu gerechnet – wie „Tour starten“ bei einer geplanten.
    - **Als Planung öffnen:** der Verlauf als neue Tour im Planer
      (`tour.html#t=…`) – gespeichert wird erst dort.
    - **Teilen:** die Aufzeichnung selbst, nicht nur ihr Verlauf – Strecke,
      Zeiten und Tempo, dazu nach Wahl Puls, Frequenz, Leistung (Haken im
      Dialog). Als **Link** (`wege.html#weg=…`, alles gepackt in der Adresse,
      lange Wege auf 500 Punkte ausgedünnt, `js/data/track-share.js`): wer ihn
      öffnet, sieht die Tour mit Diagrammen und kann sie „Bei mir speichern“.
      Oder als **GPX-Datei** (Teilen-Menü des Geräts, sonst speichern).
    - GPX, Löschen.
    Liegt die Tour nur im Ordner, zeigt die Seite erst die Karteikarte und
    holt dann alle Punkte; ist der Ordner nicht erreichbar, bleiben Zahlen
    und grober Verlauf mit einem Hinweis.
    Puls, Frequenz und Leistung stehen je Punkt am Weg und gehen als
    GPX-Erweiterung (gpxtpx:hr/cad, power) mit in den verbundenen Ordner;
    beim Ausdünnen bleibt mindestens alle 30 s ein Punkt.
  - Geplant: Profil, Strecke, Dauer, Anstieg/Abstieg, Beschreibung,
    Höhenprofil. Knöpfe: **Tour starten** (Karte mit den Punkten der Tour
    als Route, Profil passend – Wandern → zu Fuß, Rennrad → Rad –, die
    Navigation startet von selbst: `index.html?tour=ID&start`; vorher
    fragt WMap, ob die Tour aufgezeichnet werden soll), Im Planer
    öffnen, Teilen, GPX, Löschen.

## 11. Tour planen

`tour.html` – Punkte in die Karte setzen, dazwischen wird nach Profil geroutet.

- **Aufbau:** Panel wie bei Meine Touren und Entdecken – am Rechner links in
  voller Höhe (Breite ziehen, ganz einklappen), am Handy unten. Kopf: ← zu
  Meine Touren, Name, Speichern als Symbol (grüner Haken = gesichert), ✕ zur
  Karte. Ganz oben: Ort suchen, daneben das blaue **i** (Anleitung als Notiz,
  am Handy volle Breite). Darunter Werkzeuge, Zahlen, „Unterwegs als“, Hintergrund,
  Höhenprofil, Wege, Beschreibung, unten Teilen · GPX · Veröffentlichen ·
  Löschen. Ebenen-Knopf (Satellit …) wie auf der Hauptkarte; Straßennamen
  eine Zoomstufe früher und dichter als auf der geneigten Hauptkarte.

- **Unterwegs als** (Auswahlliste mit dem Symbol der gewählten Art):
  Wandern, Spazieren, Rennrad (Asphalt), Tourenrad, Gravel (Schotter),
  Mountainbike, Auto. Nur Touren mit „Auto“ erscheinen in Android Auto
  (siehe [23](#23-android-auto)).
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
  Gerät.
- **In der Navigation:** Startet man eine Tour (geplant: „Tour starten“,
  aufgezeichnet: „Navigieren“), fragt WMap vorher **„Tour aufzeichnen?“**
  (im Auto geht keine Rückfrage – dort wird sie aufgezeichnet). Andere
  Navigationen werden nur mit Einstellungen → „Jede Navigation merken“
  aufgezeichnet (Standard: aus). Unterwegs steht rechts oben in der
  Knopfleiste der **Aufnahme-Knopf**: grau = aus (antippen startet die
  Aufzeichnung auch nachträglich), rot = läuft, orange = Pause; bei
  laufender Aufzeichnung öffnet er Pause/Weiter, „Beenden und speichern“
  und „Verwerfen“ – die Navigation läuft dabei weiter (`js/app/nav.js`).
- Browser zeichnen im Hintergrund nicht auf – der Bildschirm bleibt an.
- **Android-App (ab 2.2.0): Aufzeichnen bei ausgeschaltetem Bildschirm.** Mit dem Start der Aufzeichnung
  startet ein Vordergrund-Dienst mit der Benachrichtigung „WMap zeichnet auf“
  (`src-tauri/plugins/geolocation/…/RecordService.kt`). Er holt den Standort selbst und sammelt die Punkte,
  solange die App nicht zu sehen ist; zurück im Bild trägt der Recorder sie nach (`geo.background` in
  `js/core/native.js`, `recorder.addAll`). Der Bildschirm muss dann nicht an bleiben.
  - **Benachrichtigung:** in der Kopfzeile die Zeit (läuft von selbst mit, ohne die Pausen), darunter die
    Strecke; aufgeklappt „Pause“/„Weiter“ und „Beenden“. Pause wirkt sofort im Dienst, die Seite übernimmt sie
    beim nächsten Abgleich (alle 1,5 s, solange sie zu sehen ist – `#sync` im Recorder). „Beenden“ holt die
    App nach vorn und öffnet dort „Aufzeichnung beenden“ (Name, Speichern, Verwerfen) bzw. in der Navigation
    die Auswahl des Aufnahme-Knopfs. Ist die App nicht zu sehen, zählt der Dienst die Strecke mit denselben
    Regeln weiter wie der Recorder.
  - **Hinweis vor der Freigabe:** Vor dem Start einer Aufzeichnung erklärt ein Hinweis der App, wofür die
    Benachrichtigung da ist (`recordingNotice` in `js/ui/permissions.js`); erst „Erlauben“ holt das Fenster von
    Android – fragt Android nicht mehr (zweimal abgelehnt), öffnen sich die Einstellungen der App. „Später“:
    weiter ohne. Solange die Benachrichtigung nicht erlaubt ist, kommt der Hinweis bei jedem Aufzeichnen
    wieder; die Aufzeichnung beginnt erst danach. Auch unter Einstellungen → Berechtigungen.
  - **Pause:** Die Zeit steht in der Pause (`recorder.elapsed`, Pausen im laufenden Stand).

  Gilt für jede
  Aufzeichnung, auch die während der Navigation (der Recorder in `js/data/tracks.js` startet den Dienst). Die
  Navigation selbst – Ansagen, Karte – macht weiter, sobald der Bildschirm wieder an ist. Ältere Apps und iOS bleiben
  beim angeschalteten Bildschirm.

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
Frequenz und Leistung je Punkt (das Tempo rechnet WMap aus der Strecke – die
Geschwindigkeit aus Health Connect wird nicht gelesen, die Berechtigung dafür
gibt es seit 2.3.0 nicht mehr). Jeder Weg behält Art und App: Symbol
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

**Standort in der App** (`js/core/native.js`): eine gemeinsame Abfrage über
das Plugin „geolocation“ für alle – so oft, wie der Eifrigste es braucht:
Navigation und Aufzeichnen jede Sekunde, der Punkt auf der Karte (MapLibres
Standort-Knopf, über `geolocationApi` statt `navigator.geolocation`) je nach
Bewegung: in Bewegung jede Sekunde, wer steht, nach 15 s alle 5 s, nach einer
Minute alle 30 s (`geo.retime`). Beim Losgehen meldet der
Beschleunigungssensor (`devicemotion`) Schritte bzw. Fahrt gleich – dann
sofort wieder jede Sekunde. Fehlt das Recht aufs Plugin, geht es über den
Standort des WebViews (dort bestimmt der Browser den Abstand).

**Ruhiger Punkt auf der Karte** (`js/core/smooth.js`, auch im Browser): Nah
an der letzten Stelle und ohne Fahrt bleibt der Punkt stehen, die Meldungen
werden im Hintergrund gemittelt (genaue zählen mehr) – höchstens alle 10 s
rückt er auf das Mittel, wenn es sich ≥ 3 m verschoben hat. Sonst geht er ¾
zur neuen Meldung (ungenauere zählen weniger), in Fahrt mit Richtung und
Tempo des GPS vorausgerechnet, damit er nicht hinterherhinkt. Ausreißer
(Sprung, der nicht zum Tempo passt, oder viel ungenauer) werden verworfen,
drei hintereinander gelten. Zwischen zwei Meldungen gleitet der Punkt
(nur der Marker, die Karte wird dafür nicht neu gezeichnet). Im Stand kommt
nichts Neues – auch die Karte muss nicht nachgeführt werden.

**Punkt, Kreis, Richtung** (`js/map/location-dot.js`): Der Kreis der
Ungenauigkeit ist blau durchsichtig und ruhig (geglättete Ungenauigkeit, kein
Pulsieren); ist der Standort genau (≤ 12 m), ist er ganz weg. Die
Blickrichtung zeigt ein Kegel am Punkt – in Fahrt die Richtung des GPS,
sonst der Kompass (`deviceorientationabsolute`). MapLibre selbst kennt keine
Richtung (`showUserHeading` gibt es nur bei Mapbox).

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
(der gewählte Ordner)
├─ settings.json                     Einstellungen (hell/dunkel, Navigation, Stimme …)
├─ Geplante Touren/Harzer Hexenstieg.gpx
├─ Aufgezeichnete Touren/2026/09 September/2026-09-20 Radtour am Samstagnachmittag.gpx
├─ Aufgezeichnete Touren/2026/09 September/2026-09-21 Rudern.fit   FIT der Uhr – bleibt, wie sie ist
├─ Bus & Bahn/2026-09-30 08.15 Göttingen → Kassel.json   je gemerkte Verbindung
├─ Lesezeichen.json                  Zuhause, Arbeit, Lesezeichen mit Listen
├─ Gelöscht.json                     auf einem Gerät Gelöschtes (IDs, ein Jahr)
├─ Kartenausschnitt.json             wo die Karte zuletzt stand
├─ Unbekannte Dateien/                  was keine Tour ist oder sich nicht lesen ließ – 30 Tage
└─ Inhalt.json                       Verzeichnis: je Datei ID, Art, Fingerabdruck, Stand
```

- **Direkt im gewählten Ordner** (seit 2.3.0). Bis 2.2 lag alles im
  Unterordner `WMap/` – der Inhalt zieht beim ersten Abgleich eine Ebene hoch
  (`liftOld`), die gemerkten Pfade ziehen mit. Darum `minVersion` 2.3.0: Eine
  ältere Oberfläche fände ihre Dateien nicht mehr und hielte sie für gelöscht.
- **Jede GPX- und FIT-Datei im Ordner zählt**, egal wo sie liegt (außer unter
  `Unbekannte Dateien/`), dazu `Bus & Bahn/` und die Dateien von WMap selbst.
  Was nicht an seinem Platz liegt (eigener Unterordner, falscher Ordner),
  zieht dorthin; leer gewordene Ordner gehen.
- **Andere Dateien** (Fotos, Dokumente – weder GPX/FIT noch von WMap,
  `foreign` in `data/folder.js`) gehören nicht in den Ordner: Sie kommen nach
  `Unbekannte Dateien/` – aber erst, wenn das einmal bestätigt ist. Beim
  ersten Fund fragt die Seite (`offerOthers` in `js/ui/folder-inbox.js`):
  „Nach ‚Unbekannte Dateien‘“ oder „Liegen lassen“. Die Antwort gilt für den
  Ordner (`sweep`), auch für alles, was später dazukommt; wer sie liegen
  lässt, sieht sie auf der Seite mit „Aufräumen …“. So räumt WMap keinen
  Ordner ungefragt leer, der noch anderes enthält. Die Plugins listen dafür
  alle Dateien (`list { all }`).
- **Neue Dateien: erst fragen.** Eine Datei ohne WMap-Kennung, die kein Gerät
  kennt (Export der Uhr, Garmin, Komoot …), fasst der Abgleich nicht an – sie
  steht in `inbox`, und die Seite fragt beim Start (`js/ui/folder-inbox.js`)
  mit derselben Rückfrage wie beim Wählen und Hineinziehen von Dateien
  ([Mehrere Dateien](#mehrere-dateien-eine-frage-für-alle)): „Ja, überall die
  genaueren Daten“, „Selbst einstellen“ oder „Später“. Der Abgleich bekommt
  die Antwort als `folder.sync({ decide })` (`rest`: `'best'`, `'later'` oder
  Haken für alle; `files`: je Pfad). Wartende Dateien werden nicht bei jedem Abgleich
  neu gelesen.
  - GPX ohne Zeiten → geplante Tour, als WMap-Datei unter `Geplante Touren/`
  - neue Aufzeichnung → GPX wird zur WMap-Datei unter Jahr/Monat; **FIT bleibt
    FIT** und zieht dorthin. Name, Art und Farbe einer FIT-Tour stehen im
    Verzeichnis (`Inhalt.json`, `meta`), ebenso ihre Kennung – auf allen
    Geräten dieselbe. Außerhalb der Aufbewahrungszeit liegt in der App nur die
    Karteikarte, der ganze Weg kommt beim Öffnen aus der FIT-Datei
  - gibt es die Tour schon → zusammenführen mit Haken je Angabe (Strecke,
    Puls, Frequenz, Leistung, Runden; `data/duplicates.js` `choices`/`combine`,
    Dialog `js/ui/merge-ask.js`). Das Ergebnis steht in der WMap-Datei der
    Tour; die GPX geht, die FIT bleibt daneben und steht für die Tour. Hat die
    Datei nichts anderes, ohne Frage
- **Unbekannte Dateien:** GPX/FIT, lesbar, aber keine Tour darin → `Unbekannte Dateien/`
  (ohne Frage), ebenso andere Dateien nach der Bestätigung oben.
  Die Seite nennt sie mit dem Hinweis, selbst nachzusehen, und (in der App)
  einem Knopf zum Dateimanager (`folder.reveal`); 30 Tage nach dem Fund löscht
  WMap sie (Zeitpunkt in `Inhalt.json`, `broken`). Leere und gerade nicht
  lesbare Dateien (Cloud-Ordner hakt) bleiben liegen.
- **Schnell durch das Verzeichnis `Inhalt.json`:** Jede WMap trägt dort ein,
  was sie geschrieben oder gelesen hat. Ein Abgleich holt die Liste des
  Ordners (Namen, Änderungszeit) und das Verzeichnis – den Inhalt einer
  Datei nur, wenn sie neu ist (nicht im Verzeichnis: von Hand hineingelegt),
  sich laut Änderungszeit bzw. Verzeichnis geändert hat oder hier fehlt.
  Manche Cloud-Ordner unter Android melden keine Änderungszeit; dort gilt
  der Fingerabdruck aus dem Verzeichnis, sonst würde jedes Mal alles
  gelesen. Ein neu verbundener Ordner, dessen Einträge hier schon da sind,
  wird ebenfalls nicht gelesen (gleiche ID, gleicher Fingerabdruck). Das
  Verzeichnis ist nur eine Abkürzung – was da ist, sagt die Liste des
  Ordners; fehlt oder irrt es, wird gelesen. Was gelesen werden muss (erster
  Abgleich eines neuen Geräts), kommt zu viert zugleich.
- **In der App oder nur im Ordner** („In der App behalten“ auf der Seite:
  letzte 30 Tage – Standard –, 90 Tage, letztes Jahr, alles; gilt je Gerät).
  Mit verbundenem Ordner müssen aufgezeichnete Touren nicht doppelt liegen:
  - Ganz in der App bleiben die Touren aus dem gewählten Zeitraum und alles,
    was in Meine Touren als **offline verfügbar** markiert ist (`pin`).
  - Von den älteren bleibt eine **Karteikarte** (`stub`: Name, Zeiten,
    Strecke, Art, Farbe, grober Verlauf mit höchstens 60 Punkten, welche
    Messwerte es gibt) – sobald die Datei im Ordner denselben Stand hat.
    Eine Datei aus einer älteren WMap wird dafür erst neu geschrieben.
  - Öffnet man so eine Tour, kommen Punkte und Messwerte aus der Datei
    (`tracks.full` → `readTrack`). Liste, Karte und Suche brauchen den
    Ordner nicht.
  - Ändert man die Karteikarte (Name, Art, Farbe), schreibt der Abgleich
    die Datei aus ihrem Inhalt und der Karteikarte neu – nie aus der
    Karteikarte allein.
  - Sicherung und ZIP holen alles ganz; „Trennen“ und „Ordner ändern“ holen
    vorher alles zurück in die App.
  - Geplante Touren, Verbindungen und Lesezeichen bleiben immer ganz in der
    App – sie sind klein, und navigieren soll auch ohne den Ordner gehen.
- **Ohne Ordner** bleibt jede Aufzeichnung ganz in der App, so lange man
  will – nach Zeit wird nie gelöscht. Eine Tour belegt rund 2 KB (am Handy
  gemessen: 90 Touren aus neun Monaten = 182 KB; in 30 Jahren wären das
  etwa 7 MB bei rund 10 GB, die der Browser erlaubt).
- **Speicher voll** (`makeRoom` in `js/data/tracks.js`): Nimmt das Gerät
  eine Tour nicht mehr an (`QuotaExceededError`), macht WMap Platz und
  speichert noch einmal. Mit Ordner werden die zehn ältesten Touren zur
  Karteikarte (`shelveOldest` – nur, wenn ihre Datei im Ordner denselben
  Stand hat), gelöscht wird nichts. Ohne Ordner weichen die fünf ältesten
  – nie etwas als „offline verfügbar“ Markiertes; was aus Health Connect
  kam, holt der nächste Import nicht wieder. Eine Meldung sagt, was
  geschehen ist.
- **Von Hand im Ordner:** eine Datei in die Ordnung gelegt → wird
  übernommen und ins Verzeichnis eingetragen; eine Datei gelöscht, die das
  Gerät schon kannte → der Eintrag verschwindet auch in WMap.

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
  Automatik), sonst mit „Jetzt abgleichen“. Beim Öffnen einer Seite höchstens
  alle 5 Minuten (`autoFolderSync` – WMap hat mehrere Seiten, sonst liefe er
  bei jedem Wechsel neu an); holt Health Connect gerade Trainings, wartet er
  bis danach (`bulk` in `js/data/tracks.js`):
  - nur im Ordner → übernehmen; nur in WMap → Datei schreiben
  - im Ordner gelöscht → auch in WMap weg; in WMap gelöscht → Datei weg
    und Eintrag in `Gelöscht.json` (ein Jahr) – jedes Gerät löscht es dann
    auch und schreibt es nie zurück, auch eins, das den Ordner neu verbunden
    hat oder lange nicht abgeglichen hat (sein Gedächtnis, welche Dateien
    schon da waren, reicht dafür nicht). Wieder angelegt (ZIP einspielen,
    Import, Bearbeiten) → gilt wieder
  - eine Datei ist einmal nicht lesbar (Cloud-Ordner hakt) → bleibt bekannt,
    der Eintrag hier bleibt; eine unbekannte, nicht lesbare Datei → in
    diesem Lauf wird nichts Gleichnamiges daneben geschrieben
  - **derselbe Weg zweimal im Ordner** – der Abgleich legt zusammen, auf
    jedem Gerät mit derselben Wahl (sonst löschte jedes eine andere Datei):
    - dieselbe Kennung in zwei Dateien (Kopie, „… (2).gpx“): die Datei ohne
      Zusatz bzw. mit dem kleineren Pfad bleibt
    - dieselbe Aufzeichnung unter zwei Kennungen (`sameRecordings`: dasselbe
      Training aus Health Connect – `wmap-hc:…` neben `wmap:ID` – oder
      gleicher Start und gleiche Länge): die Datei mit der kleinsten Kennung
      bleibt, was nur die anderen hatten (Puls …), kommt dazu, die anderen
      Kennungen stehen in `Gelöscht.json`. So etwas entstand, wenn nach einer
      Neuinstallation Health Connect noch einmal gelesen wurde, während der
      Ordner die Wege schon hatte
    - Wege aus Health Connect bekommen ihre Kennung darum aus Start und
      Kennung des Trainings (`healthTrackId`), nicht gewürfelt – dasselbe
      Training hat überall dieselbe. Health Connect holt Gelöschtes nicht
      wieder und erkennt Wege aus dem Ordner am Start (± 5 s) und der Länge
  - Doppelte ohne ID (fremde GPX): Weg an Start und Länge (`sameTrack` in
    `js/data/tracks.js`: Start ± 5 s und Länge ± 2 % – oder gleicher Start
    und gleiches Ende bei bis zu 15 % anderer Länge, so kommt eine GPX-Datei
    einer älteren WMap zurück, die nur die vereinfachten Punkte enthielt);
    geplante Tour an Verlauf und Name
  - GPX-Dateien von WMap tragen neben den vereinfachten Punkten, was aus
    allen gemessen wurde (Strecke, Zeit in Bewegung, Spitze), die Herkunft
    und das Aussehen (Art, Farbe, ein-/ausgeblendet, Start und Ziel –
    `<wmap:track …/>` in `metadata/extensions`) – auf dem nächsten Gerät ist
    der Weg derselbe, nicht kürzer und nicht nur „GPX“. Wieder eingelesen
    wird so eine Datei Punkt für Punkt übernommen, nicht noch einmal
    ausgedünnt
  - dieselbe Aktivität aus zwei Quellen (mit der Uhr über Health Connect und
    mit dem Handy aufgezeichnet, oder als GPX in den Ordner gelegt –
    `sameActivity`: Zeiten überlappen zu 80 %, Längen bis 15 % verschieden,
    Gebiete berühren sich): beide bleiben erst stehen, zusammengeführt wird
    unter „Doppelte Touren“ – dort wählt man je Tour getrennt, **wessen
    Strecke (GPS)** bleibt und – wenn mehrere Aufzeichnungen Puls, Frequenz
    oder Leistung haben – **von welcher die Gesundheitsdaten** kommen (je
    Aufzeichnung stehen Herkunft, km, Dauer, Punkte und z. B. „Puls (Ø 120)“
    da); die Werte kommen nach der Uhrzeit an die Punkte der gewählten
    Strecke (`withValuesFrom`)
  - schon vorhandene Doppelte: **Frage am Anfang** (einmal je Sitzung,
    `js/ui/duplicates-ask.js` aus `data/auto-sync.js`) mit denselben Dialogen
    wie beim Import – „Ja, überall die genaueren Daten“ (je Gruppe bleibt die
    Aufzeichnung mit den meisten Angaben, von den anderen kommt, was fehlt,
    und Abweichendes von der Seite mit mehr Punkten), „Selbst einstellen“
    (Haken je doppelter Aufzeichnung) oder „Später“; geschrieben wird erst am
    Ende (`resolveDuplicates`). Wer wählen will, welche Aufzeichnung bleibt:
    Abschnitt „Doppelte Touren“ mit
    „Zusammenführen“ auf dieser Seite, nur wenn es welche gibt
    (`js/data/duplicates.js`) – je Gruppe bleibt die gewählte Aufzeichnung,
    ohne Wahl der Eintrag mit den meisten Angaben (Kennung aus Health
    Connect, Puls & Co.), die anderen werden
    gelöscht und stehen damit in `Gelöscht.json`
  - `Kartenausschnitt.json`: beim Start der Karte steht sie sofort am
    Ausschnitt dieser App, gleich danach wird nur diese Datei gelesen (nicht
    der ganze Abgleich) – ist sie neuer (anderes Gerät oder hier noch keiner),
    springt die Karte dorthin, solange man sie nicht selbst bewegt hat.
    Geschrieben beim Verlassen der Karte, sonst höchstens alle 2 Minuten
  - beides geändert → das Neuere gewinnt; geändert heißt: andere Zeit und
    anderer Inhalt als beim letzten Abgleich (manche Cloud-Ordner unter
    Android melden keine Zeit)
  - `Lesezeichen.json`: je Eintrag das Neuere, Gelöschtes steht ein Jahr in
    `deleted`, damit es nicht von einem anderen Gerät zurückkommt
  - `settings.json`: hier geändert → schreiben, nur dort geändert →
    übernehmen; beim ersten Abgleich eines Geräts gilt die Datei. Nicht
    dabei: Konten, Verlauf, Kartenausschnitt (eigene Datei, s. u.).
- Erkannt wird eine Datei am Stichwort `wmap:ID` (GPX) bzw. an der `id`
  (JSON). Fremde GPX (Garmin, Komoot-Export …) gehören in `Geplante
  Touren/` (wird eine Tour) bzw. `Aufgezeichnete Touren/` (mit Zeiten ein
  Weg); sie bleiben, wo sie dort liegen. Puls, Frequenz, Leistung bleiben
  erhalten.
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
`WMap/wmap-sicherung.json` mit allem für die Wiederherstellung. Beim Export
fragt ein Dialog, ob die aufgezeichneten Touren als GPX oder als FIT in die ZIP
kommen (`zipBackup({ format })`); geplante Touren sind immer GPX. „ZIP wählen“
nimmt das ZIP (oder eine alte `.json`); ein ZIP ohne JSON, etwa ein
gezippter GPX-Ordner von woanders, wird als GPX eingelesen.

### GPX öffnen (`import.html`)

Eine GPX-Datei antippen bzw. doppelklicken öffnet WMap; über die Dateiauswahl
geht auch **FIT** (Garmin, Zepp/Amazfit, Wahoo – `js/data/fit.js` liest Ort,
Zeit, Puls, Frequenz, Leistung, Sportart und die Runden der Uhr). Je Datei:

- **Als aufgezeichnete Tour speichern** (nur mit Zeiten in der Datei):
  vorher Prüfung auf Doppelte (WMap-ID im Stichwort `wmap:…` bzw. derselbe
  Weg – `sameTrack`); gibt es ihn schon: „Gibt es schon – ansehen“. Sonst
  speichern und gleich zeigen (`wege.html?id=…`), der Ordner gleicht ihn mit ab.
- **Erst ansehen:** Eine einzelne geöffnete Datei („Öffnen mit“, „Teilen“,
  Doppelklick) wird gleich gezeigt, gespeichert ist da noch nichts – mit
  Zeiten als Aufzeichnung in Meine Touren (`wege.html#datei`, die Datei liegt
  für die Sitzung in `sessionStorage`), sonst im Planer. Dort: **Als
  aufgezeichnete Tour speichern** oder **Als geplante Tour öffnen**. Bei
  mehreren Dateien hat jede Karte „Ansehen“.
- **Zusammenführen mit Haken:** Gibt es die Tour schon, kommt ein Dialog mit
  einem Haken je Angabe, die die Datei anders hat – Strecke („x Punkte mehr/weniger in der
  Datei, y hier“), Puls, Frequenz, Leistung, Runden der Uhr. Angehakt ist, wo
  die genaueren Daten gewinnen; „Zusammenführen“ übernimmt, „Abbrechen“ ändert
  nichts (`choices`/`combine`, `js/ui/merge-ask.js`).
- **Mehrere Dateien:** oben die Übersicht (neu / zu einer Tour, die es schon
  gibt / gibt es schon) und „Alle … übernehmen …“; die Frage für alle kommt
  gleich nach dem Wählen von selbst (nächster Abschnitt).
- **Als geplante Tour öffnen:** nur öffnen, wie eine geteilte Tour
  (`tour.html#t=…`, Speichern mit Ausrufezeichen) – gespeichert wird erst dort.

#### Mehrere Dateien: eine Frage für alle

Dieselbe Rückfrage auf allen drei Wegen (`js/ui/import-ask.js`; eingelesen und
übernommen wird in `js/data/import-files.js`):

| Weg | Wo |
|---|---|
| Dateien wählen | „GPX/FIT öffnen“ (`import.html`), „GPX/FIT importieren“ auf Meine Touren |
| Hineinziehen | auf Meine Touren, eine oder mehrere GPX/FIT |
| Ordner | von Hand in den verbundenen Ordner gelegt – gefragt wird beim Start |

1. **Eine Frage für alle** (`askAll`): „Ja, überall die genaueren Daten“ ·
   „Selbst einstellen“ · „Abbrechen“ (Ordner: „Später“). Sie kommt, sobald es
   etwas zu entscheiden gibt – mehrere Dateien, von denen mindestens eine zu
   einer vorhandenen Tour gehört (im Ordner immer: dort fasst WMap sonst
   nichts an). Nur neue Touren: werden ohne Frage gespeichert. Eine einzelne
   Datei, die es schon gibt: gleich die Haken.
2. **Ja:** Neue werden gespeichert; gibt es die Tour schon, gilt der Vorschlag
   (`choices`: was fehlt, kommt dazu; Abweichendes von der Seite mit mehr
   Punkten). Name, Art und Farbe bleiben.
3. **Selbst einstellen** (`askOne`): Neue kommen dazu; je Datei, die es schon
   gibt, die Schalter – vorbelegt mit dem Vorschlag, oben die Frage „Die Tour
   … gibt es schon. Was willst du aus der Datei … übernehmen?“. Darunter
   **Weiter** (bei der letzten „Zusammenführen“), **Für alle Dateien so
   übernehmen** (die Schalter gelten für den Rest), **Für alle die genaueren
   Daten** und **Später weitermachen**: Was bis dahin gewählt ist, gilt; diese
   und der Rest bleiben liegen – auf `import.html` in der Liste, im Ordner als
   wartende Dateien. Ein „Abbrechen“ gibt es hier nicht; das ✕ heißt
   ebenfalls „Später weitermachen“.

Wie die Datei ankommt:

| Wo | Wie |
|---|---|
| Android-App | „Öffnen mit“ (`ACTION_VIEW`) und „Teilen“ (`ACTION_SEND`) – Intent-Filter aus `tools/android-einbinden.py`, das folder-Plugin liest die Datei (nur mit `<gpx` oder FIT-Kopf; FIT kommt in Base64 als `data`), `opened` gibt sie der Seite |
| Rechner-Apps | Dateizuordnung `.gpx` und `.fit` (`bundle.fileAssociations`): Start mit Datei, zweiter Start (single-instance) bzw. macOS „Opened“ → `open_paths()` im folder-Plugin |
| installierte Web-App | Chrome/Edge am Rechner: `file_handlers` im Manifest (`launchQueue`); am Handy das Teilen-Menü: `share_target` → `sw.js` legt die Dateien in den Cache `wmap-share` → `import.html?shared` |
| sonst | Dateiauswahl auf der Seite |

In der App schickt `js/core/theme.js` beim Start einer Seite zu
`import.html`, wenn das Plugin Dateien bereithält (`opened { peek }`).

## 16. Teilen, Standort anfragen, Bild in Bild

- **Kurzer Link** (`js/data/short-link.js`, `bEnd/api_share.php`): Der Link
  einer Aufzeichnung oder Tour ist bei vielen Daten zu lang für manches
  Chatfeld. Ab 400 Zeichen bietet der Teilen-Dialog „Kurzen Link erstellen“:
  Der gepackte Inhalt liegt dann 30 Tage unverschlüsselt auf dem WMap-Server
  (Tabelle `Shares`), der Link trägt nur die Kennung (`wege.html#k=…`,
  `tour.html#k=…`). Beim Öffnen holt die Seite den Inhalt und setzt den langen
  Link in die Adresse (`resolveShort`). Ohne Anmeldung, höchstens 40 Links je
  Herkunft und Tag; Älteres löscht der Server bei jedem Aufruf. Der lange Link
  ohne Server bleibt die Voreinstellung.
- **Teilen per Link** – ohne Server, alles steckt in der Adresse: ein Ort,
  „Hier bin ich“ (mit Uhrzeit), eine Route mit Profil und Wegpunkten, eine
  Tour (`tour.html#t=…`), in der Navigation die Ankunftszeit. Die Links
  zeigen immer auf `app.wuefl.de/wmap/` – auch aus den Apps; die
  Android-App öffnet sie selbst (src-tauri/README.md, „Geteilte Links“).
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
  eigenen Standort (weit unten, ~80 %) und oben der Pfeil der nächsten
  Anweisung mit der Entfernung; kein Text, keine Knöpfe, Leisten oder Zeiten
  (`js/nav/pip.js`):
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
  diese Zeiten?“, Belag, Beleuchtung). Öffnungszeiten und Parkplätze nur,
  wo man angehalten hat (≥ 3 min) – im Vorbeigehen sieht man sie nicht.
  Öffnungszeiten mit Wochen-Editor, „Rund um die Uhr“ und „Gibt es nicht
  mehr“. Jede Frage hat ein ✕ (vergessen – kommt man wieder vorbei, darf sie wiederkommen);
  „Weiß nicht / später“ stellt sie einen Tag zurück. Die Übersicht zeigt
  bei „Mitmachen“, wie viele Fragen offen sind.
- **Fragen unterwegs** (`js/app/ask-along.js`) – in der Navigation und
  ohne sie, wenn man mit dem Standortpunkt unterwegs ist (Fortbewegung dann
  nach dem Tempo; „Gesperrt?“ nur in der Navigation), als kleine Pille (`quickAsk({ pill: true })`): links ✕, die Frage, rechts
  „Bestätigen“ in Grün; sie läuft nach 12 s von selbst ab und steht dann am
  Ende in der Liste, ✕ heißt vergessen. Keine Höchstzahl, aber zwischen
  zwei Pillen 2 min oder 1 km:
  - **„Neue Straße?“ / „Neuer Weg?“** – mindestens 200 m am Stück mehr als
    30 m neben jedem Weg der Karte (Schicht `transportation` der
    Kartenkacheln), nur in Bewegung und bei Genauigkeit ≤ 20 m; Bestätigen
    schickt einen Hinweis mit dem Verlauf.
  - **„Gesperrt?“** – nach einer Neuberechnung erst, wenn man ≥ 100 m neben
    der alten Route ist (zurück auf ihr: keine Frage).
  - **„Gibt es … noch?“** – Läden und Lokale direkt am Weg (zu Fuß 15 m,
    Rad 20 m, Auto 25 m und nur langsamer als 30 km/h), seit über zwei
    Jahren unbestätigt – nach dem Vorbeikommen; Bestätigen setzt
    `check_date`. Die Orte kommen aus den Kartenkacheln (Schicht `poi`, kein
    Netz); erst nach dem Vorbeikommen fragt eine Anfrage bei der OSM-API nach
    genau diesem Ort (Art, Stand). Im Auto nur Läden an der eigenen Straße:
    Liegt eine andere Straße fürs Auto ≥ 8 m näher am Laden (Rückseite,
    Parallelstraße), wird nicht gefragt.
  - **Meldungen auf der Route** („Immer noch Stau?“, „Immer noch
    gesperrt?“, „Baustelle noch da?“ – Autobahn-Verkehrslage und geteilte
    Meldungen, `js/app/report.js`) kommen immer sofort als Pille
    (`urgent`), auch kurz nach einer anderen, die sie wegschiebt; ✕ heißt
    „nicht mehr da“, die Antwort geht an die Meldung.
  - Die Abfrage der Kartenkacheln für „Neuer Weg?“ (lokal, kein Netz) läuft
    höchstens alle 5 s bzw. 25 m.
  Je Fortbewegung abschaltbar (Einstellungen → Unterwegs: Zu Fuß, Rad,
  Auto); dann kommen „Neuer Weg?“ und „Gesperrt?“ gleich in die Liste.
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
  andere als Pille („Immer noch Stau?“, siehe Fragen unterwegs). Autobahn-Verkehrslage aus den offenen
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
  im Browser am Rechner „Karten-Links (geo:) mit WMap öffnen“, in der
  Android-App „Berechtigungen“. Am Handy stehen Auswahlfelder unter
  ihrer Beschriftung, lange Knopftexte brechen um.
- **Unterwegs:** Karte für die Navigation offline speichern, Zoom in der
  Navigation (Automatisch/Näher/Mehr Überblick), 3D in der Navigation,
  **Kurze Fragen unterwegs** je Fortbewegung (Zu Fuß, Rad, Auto – siehe
  [17](#17-mitmachen-bei-openstreetmap-meldungen)), Datensparmodus, Stimme,
  Spritpreise, Offline-Karten (Gebiete-Editor).
- **Konto** (`#osm`): Anmelden mit OpenStreetMap (zugleich WMap-Konto), wer
  angemeldet ist, Abmelden, „Konto löschen“ (→ `deleteKonto.html`), für
  Entwickler Server und Client-ID.
- **Mitmachen:** Weg aufzeichnen und danach fragen, Aufzeichnung löschen,
  ohne Konto als Hinweis senden, eigene Beiträge.
- **Daten:** Jede Navigation merken (Standard: aus – geplante Touren und
  „Aufzeichnen“ werden immer gespeichert), **Aufgezeichnete Touren auf der
  Karte** (alle · dieses Jahr · letzte 365 Tage · letzte 30 Tage, siehe
  [10](#10-meine-touren-geplant-aufgezeichnet-bus--bahn-orte)), Sicherung &
  Synchronisation, aufgezeichnete Wege, Suchverlauf löschen.

## 20. Offline und Datenverbrauch

- Der Service Worker (`sw.js`) hält **genau eine Version** der App bereit –
  **erst Cache, sonst Netz**, auch mit Netz. Jede Fassung hat ihren Cache
  `wmap-app-<Version>-<Stand>`; beim Installieren lädt er alle Dateien aus
  `appdata/sw-files.json` vorab (von `appdata/version.py` erzeugt: alles,
  was die Seiten über `import`, `@import`, `url()`, `src`/`href` erreichen –
  aus wuefl-libs nur das Genutzte, zurzeit gut 8 MB) – im Hintergrund, sechs
  zugleich, jede Datei nur nachgefragt (unverändert bzw. gerade von der Seite
  geladen: 304, nichts wird doppelt übertragen). Angemeldet wird er beim
  ersten Besuch erst, wenn die Seite steht. Der **Stand** (`BUILD` in
  `sw.js`) ist eine Prüfsumme über alle diese Dateien: Dieselbe Nummer mit
  geänderten Dateien noch einmal hochgeladen ist ein neuer Service Worker
  mit eigenem Speicher – die laufende Seite bleibt ganz bei ihrer Fassung,
  die neue gilt ab dem nächsten Start (Alt und Neu mischen sich nie). Nur
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
- **Seite „Offline“** (`offline-daten.html`, Kachel in der Übersicht,
  `js/pages/offline-daten.js`): alles, was ohne Netz auf dem Gerät liegt,
  nach Art – je Eintrag **„Nicht mehr offline“**:
  - **Karten-Gebiete** mit Größe, Kacheln und Stand; antippen zeigt das
    Gebiet im Editor (`offline.html?gebiet=ID`), „Neues Gebiet“ und
    „Gebiete bearbeiten“ führen hin. Entfernen fragt nach.
  - **Aufgezeichnete Touren:** ohne Ordner liegen alle ganz auf dem Gerät
    (nur die Zahl); mit Ordner die der letzten Zeit und die als „offline
    verfügbar“ markierten – diese als Liste, antippen öffnet die Tour.
  - **Geplante Touren** – immer ganz in der App, antippen öffnet sie.
  - **Karten der Navigation** mit Datum, Kacheln und Resttagen, einzeln
    oder alle löschen (`navCaches`, `clearNavCaches` in
    `js/data/offline.js`, auch für die Übersicht).
  Unten steht der belegte Speicher. Offline-Gebiete werden **nicht von
  selbst aktualisiert** – nur mit „Neu laden“ im Editor.
- **Offline-Karten – der Gebiete-Editor** (`offline.html`, von der Seite
  „Offline“ und aus den Einstellungen): Gebiete als Rechteck (zwei Ecken ziehen) oder freie Form
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
| Aufgezeichnete Wege | IndexedDB `wmap` / tracks – mit verbundenem Ordner von älteren nur die Karteikarte, der Rest in der GPX-Datei | nur per Ordner, GPX, Sicherung |
| Für Android Auto: geplante Touren, Lesezeichen, letzte Ziele, ein paar Einstellungen, „Karte im Auto läuft“ | Android SharedPreferences `wmap_shared` (nur in der Android-App) | nein |
| Android Auto: letzter Standort für den nächsten Start | localStorage `wmap.carPos` | nein |
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
| `?geo=geo:51.53,9.93?q=…` | Karten-Link einer anderen App (`geo:`) – Punkt, Punkt mit Namen oder Suche. In der App: `open_link` (läuft schon) bzw. beim Start `pending_link` – die Seite holt den Link selbst ab (`js/core/theme.js`), am Handy kommt das Umschalten beim Start sonst nicht an |
| `?sim`, `?tempo=4` | Navigation simulieren – auch am Handy im Browser oder in der App (Link `https://app.wuefl.de/wmap/index.html?from=…&to=…&profile=car&sim` öffnen); `sim=verfahren`, `sim=rauschen` |
| `?car`, `&at=lon,lat` | Karte für den Autobildschirm (Android Auto, siehe [23](#23-android-auto)); `at`: dort beginnen |
| `?tour=ID&start`, `?track=ID&start` | geplante bzw. aufgezeichnete Tour navigieren |
| `wege.html?tab=geplant`, `?tour=ID`, `?id=ID`, `#weg=…` | Meine Touren; `#weg=` ist eine geteilte Aufzeichnung |
| `entdecken.html#wege\|andere`, `?view=lon,lat,zoom` | Entdecken |
| `offline-daten.html` | Seite „Offline“: alles, was ohne Netz auf dem Gerät liegt |
| `offline.html?neu`, `?gebiet=ID` | Gebiete-Editor: gleich ein neues Gebiet wählen bzw. auf ein Gebiet zoomen |
| `sync.html`, `import.html` | Sicherung & Synchronisation; GPX öffnen |
| `plugins.html?f=layer\|extension\|own\|active`, `?id=…` | Plugins |

**Shortcuts** (lange aufs App-Symbol – installierte Web-App, Android, Linux):
Route planen, Aufzeichnen, Meine Touren (`shortcuts` in
`appdata/manifest.json`; für die Apps siehe `src-tauri/README.md`).

## 23. Android Auto

Mit dem Handy am Auto erscheint WMap in Android Auto als Navigations-App.
Das Auto zeigt dabei nur Googles Vorlagen – eigene Oberflächen lässt
Android Auto nicht zu (Ablenkung). WMap malt einzig die Karte selbst:

**Kombiinstrument und Head-up-Display:** Jeder Abbiegehinweis geht auch als Daten ans Auto
(`NavigationManager.updateTrip` in `tools/android/car/WMapCarService.kt`: nächster Schritt mit Entfernung, Ziel
mit Reststrecke und Ankunft) – Autos, die das anzeigen, zeigen ihn hinter dem Lenkrad.
**Simulierte Fahrt:** Schaltet das Auto sie ein (`onAutoDriveEnabled`, Googles Prüfung von Navigations-Apps),
lädt sich die Karte mit `?sim` neu und fährt jede Route von selbst ab (`autoDrive` in `js/car/car.js`) – ohne
Aufzeichnung.

**Ans Auto senden** (Android-App ab 2.2.0, nur solange das Handy mit Android Auto verbunden ist –
`js/data/car-link.js`, `tools/android/car/CarLink.kt`):
- **Ort:** in der Ortsansicht der Knopf „Ans Auto“ – im Auto öffnet sich die Routenübersicht dorthin, mit dem
  Parkplatz davor als Ziel (bei Geschäften …) und „Los“.
- **Route:** in der Routenplanung das Auto-Symbol neben „Starten“ (nur bei Auto-Profilen) – dieselben Punkte,
  gewählt ist im Auto die Alternative, die der am Handy gewählten am nächsten kommt (Länge und Fahrzeit;
  gerechnet wird im Auto neu, ab dessen Standort, wenn die Route bei „Mein Standort“ begann).
- **Geplante Tour:** in „Meine Touren“ bei fürs Auto geplanten Touren „Ans Auto“ – im Auto wie aus „Meine
  Touren“ dort.
- Läuft WMap im Auto schon, übernimmt es sofort; sonst wartet das Gesendete bis zu 15 Minuten, bis WMap im Auto
  geöffnet wird. Im Auto: `shared` in `js/car/car.js`.

**Geplante Tour verlassen:** Wer bei der Navigation einer geplanten Tour von der Strecke abkommt, wird so schnell
wie möglich auf sie zurückgeführt – die Neuberechnung geht über einen Punkt der geplanten Strecke ein Stück
voraus (300 m bis 2 km, je weiter weg, desto weiter vorn; `#rejoin` in `js/nav/navigation.js`, Durchfahrtspunkt
ohne Halt und ohne Ansage), ab dort wieder wie geplant. Andere Navigationen rechnen wie bisher den schnellsten
Weg zum Ziel. Gilt am Handy und im Auto; nach einem Neustart der App mitten in der Navigation nicht mehr.

- **Start am Standort:** Die Karte beginnt gleich dort, wo das Auto steht,
  geneigt – nicht beim Globus oder beim letzten Ausschnitt der App. Android
  gibt den letzten bekannten Standort schon mit der Adresse mit
  (`?car&at=lon,lat`, `CarWeb.startAt`), sonst gilt der zuletzt im Auto
  gemerkte (`wmap.carPos`, alle 15 s aus `js/car/drive.js`).
- **Startseite:** links eine feste Such-„Leiste“ – **Suchen** und daneben das
  Routen-Symbol (Ziel wählen, ein Tipp plant gleich die Route). Sie bleibt
  stehen; die Leisten des Autos blendet Android Auto nach ein paar Sekunden
  aus. Rechts von oben: Übersicht (nur mit Route), +, −, Standort.
- **Suchen:** oben das Suchfeld, rechts der Umschalter **Meine Touren** /
  **Orte** (Reiter erlaubt Android Auto nur auf der Startseite). Orte leer:
  **In der Nähe** (Parkplatz und Tanken als Knöpfe, antippen: alle
  Kategorien als Raster mit großen Symbolen), darunter **Lesezeichen**
  (Zuhause und Arbeit als Knöpfe, antippen: alle gemerkten Orte als Raster
  aus Kacheln mit Entfernung – `bookmarks` in `js/car/car.js`,
  `BookmarksScreen`; die Zeile steht auch ohne Gemerktes da), dann die
  letzten Ziele. Kachel, Knopf und letztes
  Ziel führen gleich zur Routenwahl. Mit Text findet die Suche gemerkte
  Orte weiter in der Liste.
  **Meine Touren:** nur die **fürs Auto geplanten** Touren (Planer →
  Unterwegs als „Auto“; Wander- und Radtouren fehlen, ohne
  solche steht „Keine Touren fürs Auto geplant“), das Suchfeld filtert.
- **In der Nähe:** Eine Kategorie zeigt ihre Treffer als Liste neben der
  Karte, die Karte zoomt dafür auf die nächsten acht heraus (`fitHits`).
  Jeder Treffer trägt eine **Nummer in Klammern hinter dem Namen**
  („Parkplatz, (3)“ – mit Komma, sie gehört nicht zum Namen) und steht mit derselben Nummer und dem Symbol der Kategorie auf der Karte (`showNumbers` – statt der
  Symbole, die nicht sagen, welcher es ist). Ein Treffer der Liste führt
  direkt zur Routenwahl, ohne die Ortskarte dazwischen; ein Tipp auf den
  nummerierten Punkt öffnet den Ort.
- **Entfernungen in den Listen** (Suche, letzte Ziele, Lesezeichen, „In der
  Nähe“): bei den **ersten drei** die Strecke auf der Straße – dieselbe
  Zahl wie danach in der Route –, bei den übrigen **„≈“ und die
  Luftlinie**. So fragt nicht jede Zeile den Routenserver
  (`roadDistances` in `js/services/routing.js`: nahe Ziele in einer
  Sammelabfrage `sources_to_targets`, ferne einzeln als Route ohne
  Wegbeschreibung; gemerkt je Start und Ziel). Dasselbe gilt für die
  Vorschläge der Suche in der App.
- **Immer mit dem Auto:** Im Auto wird jede Route mit dem Profil Auto
  gerechnet – auch wenn am Handy zuletzt Rad oder zu Fuß gewählt war; die
  Wahl am Handy bleibt davon unberührt (`setProfile` in
  `js/app/route-plan.js`).
- **Standort-Knopf wie in der Navigation am Handy:** ◎, solange die Karte
  nicht folgt, sonst Pfeil (geneigt) bzw. Kompass (flach); antippen holt
  zurück bzw. wechselt geneigt ↔ flach (Neigen mit zwei Fingern reicht das
  Auto nicht an Apps weiter).
- **Fahren ohne Route wie in der Navigation:** Pfeil statt Punkt, beim
  Fahren (ab ~7 km/h) auf der Straße (nächste Autostraße aus den
  Kartenkacheln, passend zur Fahrtrichtung), die Karte folgt geneigt; immer sichtbar Tempo,
  Tempolimit (Valhalla `/locate`, höchstens alle 10 s) und der
  Straßenname (`js/car/drive.js`). Beim Navigieren kommen Tempo und Limit
  von der Navigation.
- **Orte antippen** auf der Karte (Parkplatz, Laden, Treffer) oder aus der
  Suche öffnen: wie der Dialog in der App – Art, Adresse, Öffnungszeiten,
  Merken als Stern oben. Die Route dorthin wird gleich mitgerechnet und
  auf der Karte gezeigt; in der ersten Zeile stehen Dauer und Strecke der
  gewählten, unten **Los** und **Filter**. Eine andere Route wählt man
  durch Antippen in der Karte. Während einer laufenden Navigation bleibt
  es bei „Route“ und „Abbrechen“ (das Ansehen eines Orts soll die Fahrt
  nicht abbrechen). Ein Ziel kommt erst mit „Los“ in die letzten Ziele.
- **✕ oben** (ab dem dritten Bildschirm) führt in einem Schritt zurück zur
  Karte – statt mehrmals „Zurück“.
- **Routenwahl** gebaut wie der Ort: Karte mit Feld daneben, je Route eine
  Zeile mit Dauer und Länge (höchstens vier, immer in derselben
  Reihenfolge): die gewählte mit Pfeil und „Gewählt“, jede andere mit einem
  **Haken-Knopf zum Wählen** – die Zeilen selbst lässt Android Auto in
  diesem Feld nicht antippen. Auch ein **Tipp auf die Route in der Karte**
  wählt sie. Am eigenen Standort steht kein Startpunkt (er verdeckte den
  Pfeil). Darunter groß **Los** und **Filter**. Die Routen füllen die
  freie Fläche neben dem Feld: `fitTo` nimmt der Karte vorher den Rand, den
  sie aus der freien Fahrt noch trägt – MapLibre zählt ihn sonst zum neuen
  dazu, die Route lag dann winzig in der Mitte.
- **Filter:** Autobahnen, Mautstraßen, Fähren vermeiden – dieselben
  Einstellungen wie hinter dem Filter-Knopf der App (`wmap.routePrefs`;
  das Auto liest sie vor jeder Route neu, eine Änderung im Auto gilt auch
  in der App). Zurück in der Routenwahl wird neu gerechnet
  (`RoutePrefsScreen`, `routesAgain`).
- Beim Start der Navigation verschwindet der Pfeil der freien Fahrt sofort
  (nicht erst mit der nächsten Standortmeldung), nach dem Ende steht er
  gleich wieder am letzten Standort (`js/car/drive.js`).
- „Los“ startet die
  Navigation: Pfeil, Entfernung, Straße und Ankunftszeit in der Vorlage des
  Autos, Ansagen über die Lautsprecher des Autos, Ton aus, „In der Nähe“
  unterwegs, Übersicht der ganzen Route; beendet wird mit dem ✕ neben der
  Ankunftszeit (von Android Auto, auch wo Anweisung und Zeit stehen, legt
  das Auto fest).
- **Ziel erreicht:** Die Ankunftskarte bleibt stehen (0 min · 0 m) – an
  ihr hängt das ✕ zum Beenden; nach **30 s** endet die Navigation von
  selbst (`ARRIVED_MS` in `js/car/car.js`).
- **Kurze Fragen zum Mitmachen** (Pillen, „Immer noch Stau?“) kommen als
  Hinweis des Autos – die Pille wie am Handy mit **✕** und „Bestätigen“,
  sonst mit ihren ersten zwei Knöpfen. Hinweise zeigt Android Auto nur
  während der Navigation.
- **Fragen nach der Fahrt** („3 kurze Fragen zu deinem Weg“) kommen im Auto
  nicht – dort lassen sie sich nicht beantworten. Die App bietet sie beim
  nächsten Start an (`wmap.survey.fromCar`, `js/app/mitmachen.js`).
- **Offline-Gebiete** der App nutzt die Karte im Auto mit: In der fertigen
  App laden beide von app.wuefl.de und teilen sich Speicher und Service
  Worker (am Gerät nachgeprüft: eine Kachel aus einem Gebiet der App kommt
  in der Auto-Seite an).
- Ohne Standort-Freigabe fragt das Auto am Handy danach.
- „Navigiere zu …“ aus anderen Apps oder per Sprache (`geo:`) öffnet die
  Routenwahl bzw. die Suche.

**Fahrt-Protokoll (Fehlersuche bei Hängern im Auto):** Einstellungen → „Android Auto: Fahrt protokollieren“
(nur in der Android-App; liegt im gemeinsamen Speicher `wmap_shared`, Schlüssel `carlog`). Ab dem nächsten Start
von WMap im Auto schreibt die App je Fahrt eine Datei – erst nach `Android/data/<Paket>/files/car-log/`, am Ende
der Fahrt (bzw. beim nächsten Start) nach **Download/WMap/**`wmap-auto-<Datum>.log`. Geht auch in der fertigen App
aus dem Play Store – eine Debug-Fassung nimmt Google Play nicht an. Zeilen (`tools/android/car/CarLog.kt`,
`js/car/carlog.js`):

| Zeile | Inhalt |
|---|---|
| `start`, `js anfang` | Gerät, Android, App, Fläche des Autos; wer zeichnet (`grafik` – „SwiftShader“ hieße: ohne Grafikchip), Bildpunkte, Bildrate |
| `fix` | Standort vom Handy: Alter der Messung, Abstand zur vorigen, Genauigkeit, Tempo |
| `js` (je Sekunde) | `b` Kartenbilder · `pause` längste Zeit zwischen zwei Bildern · `lang` lange Aufgaben (Anzahl/Summe/längste) · `takt` größter Verzug eines 100-ms-Takts · `fix`, `weg` (App → Seite), `alter` (GPS-Zeit → Seite) · Messstellen `fahrt`, `strasse`, `hinweis` (Anzahl/Summe/längste) · `nav`, Zoom, Neigung, Kacheln geladen |
| `call` | Anfrage der Vorlagen an die Seite über 300 ms |
| `mainlag` | Haupt-Thread der App hing über 150 ms (er trägt das WebView, die Vorlagen und den Standort) |
| `sys` (alle 10 s), `thermal` | Wärmestufe, Akku-Temperatur, Handy-Bildschirm an?, Zähler (Hinweise, Neuzeichnen) |
| `surface`, `page` | Fläche des Autos kam/ging; Warnungen und Fehler der Seite |

Die Zeilen der Seite kommen nur, wenn die Karte im Auto diesen Stand der Webversion lädt (fertige App:
app.wuefl.de; Debug-Fassung: der Rechner über `adb reverse`, sonst ebenfalls app.wuefl.de).

Technik: Die Vorlagen stehen in `tools/android/car/` (Kotlin, Car App
Library), `tools/android-einbinden.py` setzt sie ins erzeugte Android-Projekt.
Die Karte ist die Webversion mit `?car` (`js/car/car.js`, `js/car/drive.js`, `css/app/car.css`)
in einem eigenen WebView auf der Kartenfläche des Autos (virtuelles Display);
sie beantwortet die Fragen der Vorlagen – Suche, Kategorien, Ort, Routen,
Touren – mit derselben Logik wie die App. Die Debug-Fassung lädt sie vom
Rechner (`adb reverse tcp:8080 tcp:8080`), sonst von app.wuefl.de.

**Dieselben Touren und Lesezeichen wie in der App:** Die fertige App läuft
wie die Karte im Auto von app.wuefl.de – beide WebViews haben dann
denselben Browser-Speicher, es gibt nichts abzugleichen. Anders, wenn die
Adressen verschieden sind: Die Debug-Fassung läuft unter `tauri.localhost`
(die Karte im Auto vom Rechner), ebenso eine App, die ohne Netz bei ihrer
eingepackten Kopie bleibt – „Meine Touren“ war dort im Auto leer. Beide
Seiten gleichen darum über einen gemeinsamen Speicher von Android ab
(SharedPreferences `wmap_shared`, `WMapAndroid.shareGet/shareSet` in
`MainActivity.kt` und `car/CarWeb.kt`, `js/data/car-share.js`): geplante
Touren und ein paar Einstellungen (Routen-Vorlieben, Stimme, Spritpreise)
von der App ins Auto, Lesezeichen und letzte Ziele in beide Richtungen (je
Eintrag das Neuere, Gelöschtes bleibt gelöscht). Jede Seite legt ihre
Adresse dazu; übernommen wird nur von einer anderen Adresse – bei
gemeinsamem Speicher fasst das Auto nichts an. Die App legt beim Start und
nach jeder Änderung ab, das Auto liest beim Start und bevor es Touren oder
Ziele auflistet. Die App muss dafür einmal geöffnet gewesen sein.

**Rechenzeit und Wärme** (`js/core/fps.js`): Die Karte im Auto und die App
sind zwei WebViews derselben App – sie teilen sich einen Rechen-Thread. Am
Pixel 9 gemessen zeichnete die Auto-Seite bei freier Fahrt gut 40
Kartenbilder je Sekunde zu je 15–19 ms (64–80 % der Rechenzeit); navigierte
die App dazu, fiel jede auf rund 20 Bilder, das Handy wurde heiß und
drosselte – die Karte hing dann hunderte Meter hinter dem Standort her und
reagierte erst nach Sekunden. Darum:

- Im Auto höchstens **20 Bilder je Sekunde** (30, solange ein Finger die
  Karte verschiebt) – gemessen danach 18 Bilder, 30 % der Rechenzeit.
- Die **App zeichnet nur noch 10 Bilder je Sekunde**, solange die Karte im
  Auto läuft: Das Auto meldet sich alle 5 s im gemeinsamen Speicher
  (`carAlive`, `js/data/car-share.js`); bleibt die Meldung 15 s aus, gilt
  die App wieder allein.
- **Nur die neueste Standortmeldung zählt** (`__carFix` in `index.html`):
  Kommt die Seite einmal nicht nach, staut sich nichts auf. Wischen und
  Zoomen werden je Bild zu einem Schritt zusammengefasst.

**Höchstens fünf Bildschirme hintereinander:** Android Auto zählt mit, wie
viele Vorlagen eine App nacheinander zeigt („Task step … of 5“ im Protokoll
des Autos); der sechste bleibt leer. Die Navigation setzt den Zähler zurück,
„Zurück“ senkt ihn, ein Neuzeichnen derselben Vorlage zählt nicht. Darum
sind die Wege kurz gehalten: Das Raster „In der Nähe“ **ersetzt** die Suche,
statt über ihr zu liegen (erst zurück zur Karte, die öffnet es dann –
`WMapSession.afterHome`, `SearchScreen.replace` in
`tools/android/car/CarScreens.kt`), und ein Treffer geht ohne Ortskarte zur
Routenwahl. So ist „Los“ auch auf dem längsten Weg (Suchen → In der Nähe →
Treffer → Routenwahl) der vierte Schritt, der Filter der fünfte.

**Routenwahl ohne Googles Vorlage:** `RoutePreviewNavigationTemplate` blieb
in der aktuellen Fassung von Android Auto leer, sobald der Bildschirm davor
schon eine Karte zeigte (Ort nach Kartentipp, Trefferliste) – sie ging nur
direkt aus der Suche. Die Routenwahl ist darum ab Car API 7 eine
`MapWithContentTemplate` mit `PaneTemplate`; Googles Vorlage bleibt für
ältere Autos (`RoutePreviewScreen.classic()`).

Zeigt das Auto eine Vorlage ohne Karte (Suche, Listen), nimmt es der App die
Kartenfläche weg. Die Seite läuft dann weiter (`CarWeb.onSurfaceDestroyed`
hält sie nicht an, ihr Prozess bleibt wichtig) – sie beantwortet ja gerade
dann die Suche, „Meine Touren“ und die Ziele. Angehalten kamen Timer und
Netz der Seite nicht mehr zurück: die Listen blieben leer.

Ausprobieren ohne Auto: Android Auto auf dem Handy → Version zehnmal
antippen → Entwicklereinstellungen → „Unbekannte Quellen“ an (sonst fehlt
eine nicht aus dem Play Store installierte App) → Menü „Head Unit Server
starten“; am Rechner `tools/android-auto.sh` (lädt Googles Desktop Head
Unit beim ersten Mal, richtet die adb-Weiterleitungen ein; auf ARM-Linux
über muvm/FEX, siehe `tools/README.md`). Mit `id3`, `mercedes`, `golf` oder
`klein` als erstem Wort zeigt es den Bildschirm dieses Autos
(`tools/dhu/*.ini`). **Mit Kabel:** Über WLAN meldet sich adb bei jedem
Aussetzer mit anderem Port neu an, die Weiterleitungen sind dann weg und
der Simulator verliert das Handy – das Skript nimmt darum das Kabel, wenn
beides verbunden ist, und startet den Simulator nach einem Abriss von
selbst neu. Was Android Auto mit den Vorlagen macht, zeigt
`adb shell setprop log.tag.CarApp.H.Dis VERBOSE` (ebenso `CarApp`,
`CarApp.H`, `CarApp.H.Tem`; gilt bis zum Neustart des Handys) in `adb
logcat`.

## Werkzeuge

Zentral für alle Projekte unter `wuefl_products` – die Skripte liegen neben
`git-release` in `~/wuefl_profiles/shell_scripts` (im PATH):

```bash
tauri-android wmap              # bauen, aufs Handy, Protokoll (Debug-Fassung: heißt „wmap-Debug“)
tauri-android wmap build        # nur bauen (auch: clean, install, log, connect)
tauri-android wmap release      # signiertes AAB (Play Store) + APKs → src-tauri/target/android-release/
takeshots wmap                  # Screenshots nach appdata/images/, Werbebilder nach appdata/werbung/
takeshots wmap compose          # nur die Werbebilder neu zusammensetzen (auch: shots)
takeshots wmap --eigener-server # ohne Docker
tools/android-auto.sh id3       # Android Auto am Rechner (Simulator), siehe Abschnitt 23
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
  `.secrets/README.md` (liegt wie der ganze Ordner nur lokal, nicht in Git); fehlt er, zeigt auch
  `tauri-android wmap release` die Schritte. Gradle signiert damit AAB und
  APKs selbst. Die Version (versionCode) kommt aus
  `src-tauri/tauri.conf.json` – vor jedem Upload erhöhen.
- `takeshots` liest `appdata/takeshots.json`, setzt `{base}` auf den
  Docker-Server (`http://localhost:8080/web/wuefl_products/wmap/`) und bricht
  mit „Server nicht erreichbar“ ab, wenn der nicht läuft. Welches Bild was
  zeigt und welche acht Werbebilder in den Play Store gehören, steht in
  [`tools/README.md`](tools/README.md); die Store-Texte liegen in
  `appdata/store/de-DE/`. Die Bilder aus Android Auto kommen aus dem
  Simulator: Navigation (`screenshot-auto*.png`) und Routenwahl mit „Los“
  (`screenshot-auto-route*.png`), je Tag und Nacht.
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
  Android-Signatur kommt aus den Secrets (siehe `.secrets/README.md`, nur lokal).
- Weitere Hinweise: [`tools/README.md`](tools/README.md).

## Entwicklung

- Kein Build-Schritt: ES-Module direkt im Browser, UI-Bausteine aus
  `libs/wuefl-libs` (Verweis aufs Nachbarprojekt, nicht in Git).
- **Ordner in `js/`** – nach Art gruppiert:

  | Ordner | Was drin ist |
  |---|---|
  | `app.js`, `app/` | Kartenseite (`index.html`): Einstieg und ihre Teile, siehe unten |
  | `pages/` | Einstieg jeder anderen Seite: Übersicht, Meine Touren, Tour planen, Entdecken, Ebenen, Plugins, Einstellungen, Sicherung & Synchronisation, Offline, Offline-Karten (Gebiete), GPX öffnen, Konto löschen |
  | `car/` | Karte für Android Auto (`index.html?car`): Schnittstelle für die Vorlagen des Autos, Fahren ohne Route |
  | `ui/` | HTML-Bausteine: Dialoge und Toast, Sheet, Leiste und Menü, Teilen, Höhenprofil, Ebenen-Menü, Ort-Infos, Routen-Filter, Abschnitte Bus & Bahn, Aufzeichnen, Etappen |
  | `map/` | Karte: Stil und Ebenen, eigene Ebenen, fertige Ebenen, Gebäude im Satellitenmodus, Ampeln, Orte aus den Kacheln, Tastatur, Plugins ausführen |
  | `nav/` | Navigation unterwegs: Ansicht, Ansagen, Hinweise, Bild in Bild, Meldungen |
  | `services/` | Dienste im Netz: WMap-API und Konto, Suche, Routing, Overpass, Fahrplan, ÖPNV, Verkehr, Bilder, bekannte Touren |
  | `data/` | Was auf dem Gerät bleibt: Speicher, Datenbank, Gemerktes, Wege (Aussehen, Zahlen, Teilen, Doppelte), Spur, Ordner und Abgleich, ZIP, Offline, Plugin-Ordner, Abgleich mit Android Auto |
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
  | `ask-along.js` | Kurze Fragen unterwegs („Neuer Weg?“, „Gibt es … noch?“) |
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
    "changelog": [{ "version": "1.0.0", "date": "2026-09-28", "appVersion": "1.0.0", "changes": ["…"] }]
  }
  ```

  | Feld | Wirkung |
  |---|---|
  | `welcome` | Dialog beim allerersten Start |
  | `changelog` | nach einem Update: alle Versionen seit der zuletzt gesehenen bis zur laufenden; in der Übersicht über die Versionsnummer alles. Oberster Eintrag = neueste Version – daraus macht `git-release` den Tag und GitHub den Release-Text |
  | `messages` | Nachrichten als Dialog, jede einmal (gemerkt über `id`); `from`/`until` (Datum) optional, `text` HTML erlaubt |
  | `minVersion` | kleinste Version der **Oberfläche**. Ist die laufende älter (z. B. nach einer Änderung an der Server-API): „Update nötig“ – nur **Aktualisieren**, lädt den neuen Service Worker |
  | `minAppVersion` | kleinste Version der **App selbst** (Tauri-Teil: Rust, Kotlin, Plugins, Rechte). Ist die installierte App älter: gesperrt mit „WMap-App aktualisieren“ – sichern (in den Ordner bzw. als ZIP), dann Play Store bzw. wuefl.de. Im Browser gilt es nicht (`src-tauri/README.md`) |
  | `changelog[].appVersion` | die **App** (Tauri-Teil), die zu dieser Version gehört – steht an jedem Eintrag, es gilt die des neuesten. Ist die installierte App älter: Hinweis „Neue Version der WMap-App“ mit Link zum Play Store bzw. zu wuefl.de („Später“ geht) – und die neue Oberfläche kommt so lange nicht: Der neue Service Worker fragt die offene Seite nach der App-Version und installiert sich in einer älteren App nicht (`sw.js` `appCurrent`). Die neue App muss deshalb vor der Web-App zu haben sein |

  **Neue Version:** oben im `changelog` eintragen, dann
  `python3 appdata/version.py` – trägt die Nummer in `js/core/config.js`,
  `sw.js`, `src-tauri/tauri.conf.json`, `Cargo.toml` und `Cargo.lock` ein und
  schreibt `appdata/sw-files.json` und den Stand (`BUILD` in `sw.js`) neu
  (`--pruefen` nur prüfen; `git-release` prüft das vor dem Tag). **Vor jedem
  Hochladen** laufen lassen, auch ohne neue Nummer – sonst bekommen
  Installierte die geänderten Dateien nicht.

  Die Dialoge kommen nur beim normalen Start der Karte, nicht wenn ein Link
  etwas öffnet – dann beim nächsten Mal (so auch nicht auf den Screenshots).
  Sie kommen sofort beim Start (nicht erst, wenn die Karte geladen ist) und
  nacheinander: Was von selbst kommt (Willkommen, Neuigkeiten, „Navigation
  fortsetzen?“, 3D im Mobilfunk), wartet, bis kein anderer Dialog offen ist
  (`ask({ auto: true })` bzw. `whenFree()` in `js/ui/dialogs.js`).

  **Alle Rückfragen** laufen über `ask()` und damit über den `userDialog`
  aus wuefl-libs (ab 2.7.0; `sheet()` und eigene `<dialog>`-Fassungen gibt es
  nicht mehr): am Rechner mittig, am Handy von unten mit Griff. Ein Hauptknopf
  und höchstens ein zweiter stehen in der Fußzeile der Bibliothek; mehr
  Knöpfe, „stacked“ und Knöpfe, die den Dialog offen lassen (`run`), stehen
  als eigene Zeile im Inhalt. ✕ oben rechts und Esc liefern `null`;
  `closable: false` nimmt beides weg (zwingendes Update). Auch Tastatur-Hilfe,
  „Mobilfunk erkannt“, Stimme, Update und „Aufzeichnung beenden“ gehen diesen
  Weg. Das Blatt der Hauptkarte und die Leisten von „Ebenen“ und
  „Offline-Karten“ sind weiter eigene Blätter (`js/ui/sheet.js`).
  Gemerkt wird in localStorage `wmap.seen`. Zum Ausprobieren:
  `localStorage.setItem('wmap.seen', '{"version":"0.9.0","messages":[]}')`.
