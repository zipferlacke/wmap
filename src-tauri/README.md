# WMap als App (Tauri)

Die App ist nur eine Hülle um dieselbe Web-App wie im Browser. Alles, was
WMap kann, steckt in `../js`, `../css` und den HTML-Seiten – hier liegt nur,
was Tauri zum Verpacken braucht. Nichts davon wird auf den Server geladen
(steht in `.vscode/sftp.json` unter `ignore`).

## Dateien

| Datei / Ordner | Wofür |
|---|---|
| `tauri.conf.json` | Name, Version, Kennung `de.wuefl.wmap`, Fenstergröße, Paketarten |
| `Cargo.toml`, `Cargo.lock` | Rust-Abhängigkeiten |
| `src/main.rs` | Startpunkt – ruft nur `wmap_lib::run()` |
| `src/lib.rs` | App starten; `geo:`-Links an die Kartenseite (`index.html?geo=…`); unter Linux Standortabfragen von WebKitGTK erlauben |
| `build.rs` | von Tauri vorgegeben |
| `capabilities/default.json` | Rechte der Web-App im Fenster (nur Standard) – auch für `https://app.wuefl.de/*` |
| `capabilities/mobile.json` | Handy-Apps: zusätzlich Standort über das Gerät – auch für die Webversion |
| `plugins/health/` | eigenes Plugin: Trainings und Routen aus Health Connect (Android, Kotlin) – siehe unten |
| `plugins/folder/` | eigenes Plugin: Ordner verbinden (Android: Speicherzugriff des Systems, Kotlin; Rechner: Ordnerdialog, Rust) – siehe unten |
| `plugins/browser/` | eigenes Plugin: Weblinks über der App (Android: Custom Tab; Rechner: Fenster mit Leiste), Android: teilen, Zwischenablage |
| `plugins/geolocation/` | Kopie von `tauri-plugin-geolocation` 2.4.0 mit Korrektur (Android: `watchPosition` beantwortet seinen Aufruf – sonst hing die App nach acht Aufrufen), eingebunden über `[patch.crates-io]`; siehe `plugins/geolocation/WMAP.md` |
| `tauri-start.js` | wechselt beim Start zur Webversion, wenn sie erreichbar ist (s. u.) |
| `icons/` | App-Icons, erzeugt mit `cargo tauri icon ../appdata/wmap-512.png` (Android: `tools/android-symbole.py`, mit Rand zum Maskieren) |
| `web-kopieren.sh` | kopiert die Web-Dateien vor jedem Build nach `web/` und bindet `tauri-start.js` in deren `index.html` ein |

Generiert, nicht in Git:

| Ordner | Was |
|---|---|
| `web/` | Kopie der Web-App, die in die App eingebaut wird |
| `target/` | Rust-Build und fertige Pakete (`target/release/bundle/…`) |
| `gen/` | von Tauri erzeugte Schemas |

## Befehle (im Ordner `wmap/`)

```sh
cargo tauri dev                    # Fenster mit http://localhost:8080/web/wuefl_products/wmap/
cargo tauri build --bundles rpm    # Paket für Fedora → target/release/bundle/rpm/
cargo tauri build --bundles deb    # Paket für Debian/Ubuntu
```

Windows (`nsis`) und macOS (`dmg`) sind eingestellt, müssen aber auf dem
jeweiligen System gebaut werden.

## Web zuerst

Die Web-App nutzt nur Browser-Schnittstellen. Wo die App mehr kann (z. B. GPS
auf Android), fragt `../js/core/native.js` erst nach Tauri und nimmt sonst die
Browser-Schnittstelle – die Webversion verliert dadurch nichts.

## Oberfläche aus dem Netz, Gerät aus Tauri

Die App startet mit der eingepackten Kopie (`web/`). `tauri-start.js` fragt
dort als Erstes, ob `https://app.wuefl.de/wmap/` erreichbar ist (höchstens
2,5 s) – dann läuft die App von dort. Gefragt wird mit `mode: 'no-cors'`:
Es zählt nur, ob der Server antwortet. app.wuefl.de schickt keine
CORS-Header – bis 2.0.1 scheiterte die Abfrage daran jedes Mal, und die App
blieb bei ihrer eingepackten Kopie (samt alter wuefl-libs). So kommt jede Änderung an HTML, CSS
und JavaScript ohne neue Version im Play Store an; ein neuer Build ist nur
nötig, wenn sich hier in `src-tauri/` etwas ändert (Rust, Plugins, Rechte,
Icons).

Ohne Netz geht die App trotzdem zur Webversion, sobald sie dort einmal
gelaufen ist: Deren Service Worker liefert dann den zuletzt geladenen Stand,
die angesehenen Karten und die Offline-Gebiete aus seinem Speicher. Nur beim
allerersten Start ohne Netz bleibt die eingepackte Kopie – ohne Karte, weil
noch nichts gespeichert ist.

**Zwei Versionen:** `APP_VERSION` (`js/core/config.js`) ist die der
Oberfläche und kommt mit jedem Hochladen neu; die der App selbst steht in
der Programmdatei (`tauri.conf.json`) und liefert `appVersion()` in
`js/core/native.js` über Tauri – kein Service Worker kann sie verfälschen.
Die Übersicht zeigt in der App beides („2.1.3 · App 2.1.0“). Braucht neue
Oberfläche einen neuen Tauri-Teil (Plugin, Rechte), `minAppVersion` in
`appdata/messages.json` auf diese Version setzen: Ältere Apps sind dann
gesperrt mit „WMap-App aktualisieren“ – sichern (in den Ordner bzw. als
ZIP), dann Play Store bzw. wuefl.de/wmap. `minVersion` gilt dagegen für die
Oberfläche (zwingendes Update über den Service Worker).

**Umzug:** Die Webversion hat ihren eigenen Speicher (app.wuefl.de statt
`tauri://localhost`). Hat die eingepackte Kopie noch eigene Daten (Apps bis
2.0.x), fragt `tauri-start.js` einmal vor dem Wechsel: in den verbundenen
Ordner sichern – die Webversion findet den Ordner im Plugin und holt alles
von dort – oder als ZIP speichern (dort unter Sicherung & Synchronisation →
„ZIP wählen“), oder ohne Sicherung weiter. Gemerkt in `wmap.umzug`.

Geräte-Funktionen kommen weiter aus Tauri: Die Webadresse steht in beiden
`capabilities/*.json` unter `remote`, darum findet `../js/core/native.js` auch dort
`window.__TAURI__` und nimmt z. B. das GPS des Handys. Weitere Plugins
(Dateien, Dialoge …) müssen in `Cargo.toml`, `src/lib.rs` und den Rechten
stehen – und die Webseite fragt vorher, ob es sie gibt.

Achtung: Wer die Webseite ändern kann, darf damit auch alles, was die Rechte
der App erlauben – die Rechte darum klein halten.

## GPX-Dateien (`fileAssociations`, Intent-Filter)

WMap meldet sich für `.gpx` an: am Rechner über `bundle.fileAssociations` in
`tauri.conf.json` (Windows-Installer, macOS, `.desktop` unter Linux), unter
Android über Intent-Filter für „Öffnen mit“ und „Teilen“
(`tools/android-einbinden.py`). Die Datei landet im folder-Plugin
(`opened`), die Seite `import.html` fragt, ob sie als aufgezeichnete Tour
gespeichert oder als geplante Tour geöffnet wird (README, Abschnitt 15).

## Shortcuts (lange aufs App-Symbol)

Dieselben drei wie in der Web-App (`shortcuts` in `appdata/manifest.json`):
Route planen (`index.html?action=route`), Aufzeichnen
(`index.html?action=record`), Meine Touren (`wege.html?tab=geplant`). Das
Manifest liest nur der Browser – die Apps melden sie selbst an:

| System | Wie |
|---|---|
| Android | folder-Plugin (`FolderPlugin.kt`) legt sie bei jedem Start als dynamische Shortcuts an (`ShortcutManager`, Symbole unter `plugins/folder/android/src/main/res/drawable/`). Eine statische `shortcuts.xml` bräuchte den Paketnamen fest – der Debug-Build heißt `de.wuefl.wmap.debug`. Intent `de.wuefl.wmap.SHORTCUT` mit der Kennung; läuft die App schon, geht es gleich zur Seite (`onNewIntent`) |
| Linux (deb, rpm) | eigene Vorlage `wmap.desktop` (`bundle.linux.*.desktopTemplate`, sonst wie die von Tauri) mit drei `[Desktop Action …]`: `wmap --wmap-go=index.html?action=route` … – im Menü bzw. Dock per Rechtsklick. Zweiter Start: single-instance bringt das offene Fenster auf die Seite (`open_page` in `src/lib.rs`); erster Start: das folder-Plugin merkt sie (`shortcut_page`, nur Seitennamen) |
| Windows, macOS | noch nicht (Sprungliste bzw. Dock-Menü bräuchten eigenen Code) |

Beim Start holt `js/core/theme.js` die Seite über `opened` ab (`go`, nur
einmal) – in der eingepackten Kopie erst auf der Webversion bzw. in
`tauri-start.js`, wenn es ohne Netz bei der Kopie bleibt.

## Geteilte Links (`https://app.wuefl.de/wmap/…`)

Geteilte Orte, Routen, Touren und Listen zeigen immer auf die Webversion
(`pageUrl`/`base` in `js/ui/share.js`, nie `tauri.localhost`). Die
Android-App meldet sich für diese Links an (`plugins.deep-link.mobile`,
`appLink: true`); `open_link` in `src/lib.rs` öffnet dieselbe Seite samt
`?…` und `#…` neben der gerade offenen – nur `*.html` direkt unter `/wmap/`.

Damit Android sie ohne Rückfrage an die App gibt (App Links), muss
`https://app.wuefl.de/.well-known/assetlinks.json` die Fingerabdrücke der
Signaturschlüssel nennen – Vorlage `appdata/assetlinks.json` (bisher nur die
Debug-App). Dazu gehören:

- **Play Store:** der App-Signaturschlüssel aus der Play Console (Einrichten →
  App-Integrität → App-Signatur, SHA-256).
- **APK von wuefl.de:** der Upload-Schlüssel –
  `keytool -list -v -keystore .secrets/wmap-upload.jks -alias wmap | grep SHA256`.

Ohne die Datei geht es trotzdem: App-Info → „Standardmäßig öffnen“ → Link
hinzufügen. Am Rechner nimmt der Browser https-Links selbst an.

## Karten-Links (`geo:`)

WMap meldet sich für `geo:`-Links an (`plugins.deep-link` in
`tauri.conf.json`) – so steht WMap unter „Öffnen mit …“ neben der
Standard-Karten-App:

| System | Wie |
|---|---|
| Android | Intent-Filter im Manifest (setzt das Plugin beim Bauen ein) |
| Windows | Eintrag in der Registry durch den NSIS-Installer |
| macOS | `CFBundleURLTypes` in der Info.plist der App |
| Linux (RPM, DEB) | `MimeType=x-scheme-handler/geo` in der .desktop-Datei |
| Linux (AppImage) | nur mit AppImageLauncher o. Ä. – das AppImage selbst trägt sich nicht ein |

`src/lib.rs` lädt dann `index.html?geo=<Link>` im Fenster; läuft die App
schon, gibt `tauri-plugin-single-instance` den Link ans offene Fenster
(Rechner). Selbst zur Standard-App macht sich WMap nicht
(`register_all()` fehlt mit Absicht) – das entscheidet, wer sie nutzt.

## Debug-Build: eingepackte Dateien

`web-kopieren.sh` bindet `tauri-start.js` nur in Release-Builds ein. Der
Debug-Build (`tauri-android wmap`) bleibt bei den eingepackten Dateien –
so lässt sich Neues auf dem Handy testen, bevor es auf dem Server liegt.

Einen Release-Build gegen eine andere Webversion testen (z. B. den lokalen
Server am Rechner): `WMAP_REMOTE=http://localhost:8080/web/wuefl_products/wmap/
cargo tauri build --no-bundle` – die Adresse muss dafür vorübergehend in
`capabilities/default.json` unter `remote` stehen (danach wieder heraus).

## Health Connect (`plugins/health`)

Eigenes Tauri-Plugin, nur Android tut etwas: Die Befehle stehen in Kotlin
(`android/src/main/java/HealthPlugin.kt`), Tauri leitet
`invoke('plugin:health|…')` direkt dorthin; Rust registriert nur.

| Befehl | Was |
|---|---|
| `status` | gibt es Health Connect, was ist freigegeben |
| `request_access` | Freigabe-Dialog von Health Connect |
| `sessions { days }` | alle Trainings: Art, Zeit, App, Route ja/nein/Nachfrage |
| `route { id }` | Punkte [lon, lat, Höhe, Zeit]; fremde Routen ohne Dauerfreigabe fragt Health Connect einzeln |
| `open_settings { target }` | `health`: Health Connect – die Seite einer App direkt dürfen nur System-Apps öffnen, dort WMap antippen (Routen „Immer erlauben“, widerrufen); `app`: App-Info (Standort); `location`: Standort am Gerät |

- Rechte (Manifest des Plugins): nur lesen – `READ_EXERCISE`,
  `READ_EXERCISE_ROUTES`, `READ_HEALTH_DATA_HISTORY` (sonst nur 30 Tage).
- `RationaleActivity` erklärt, wofür – ohne sie zeigt Health Connect den
  Freigabe-Dialog nicht (Android 13: Aktion, ab 14: Alias).
- minSdk 26 (`bundle.android.minSdkVersion`, `tools/android-einbinden.py`
  überträgt es ins erzeugte Projekt).
- In der Web-App: `js/services/health.js`, Knopf „Trainings holen“ auf der
  Seite Sicherung & Synchronisation (nur in der Android-App); Freigaben erklärt
  `js/ui/permissions.js` (auch den Standort – dafür stehen
  `geolocation:allow-check-permissions` und `…-request-permissions` in
  `capabilities/mobile.json`).
- **Play Store:** Gesundheitsdaten brauchen dort eine eigene Erklärung
  (Formular „Health Connect“ in der Play Console) und in der
  Datensicherheit „Fitness“ – erhoben, nur auf dem Gerät, nicht geteilt.


## Ordner verbinden (`plugins/folder`)

Das WebView der App kennt die File System Access API von Chrome nicht –
darum wählt das System den Ordner, und die App liest und schreibt nur darin
(`js/data/folder.js`, Seite „Sicherung & Synchronisation“). Ein zweiter
Ordner für eigene Ebenen (Plugins-Seite, `js/ui/own-source.js`) läuft über
`slot: "layers"` – jeder Befehl nimmt `slot`, leer ist der Ordner für die
Synchronisation.

| Befehl | Was |
|---|---|
| `pick` | Ordner wählen → `{ connected, name }` |
| `info` | `{ connected, name }` |
| `list` | `.gpx`/`.json`/`.geojson`/`.js` bis 5 Ebenen tief → `{ files: [{ path, modified }] }` |
| `read { path }` / `write { path, text }` / `remove { path }` | Pfade relativ zum Ordner mit „/“; `..` und absolute Pfade lehnt das Plugin ab; `write` legt fehlende Ordner an |
| `disconnect` | Ordner vergessen (Android: Freigabe zurückgeben) |
| `opened { peek }` | mit WMap geöffnete GPX-Dateien → `{ count, files: [{ name, text }], go? }`; `peek` zählt nur, sonst abholen; `go`: Seite des Shortcuts, mit dem die App gestartet wurde (einmal). Android: Intents `VIEW`/`SEND` (`onNewIntent` → gleich `import.html`), Rechner: `open_paths()` aus `src/lib.rs` (Argumente beim Start, zweiter Start, macOS `RunEvent::Opened`) |
| `save { name, data, mime }` | eine Datei (Base64) über den Speichern-Dialog ablegen → `{ name }`; Android `ACTION_CREATE_DOCUMENT`, Rechner Dialog von `rfd`. Nutzt `download()` in `js/data/store.js` in der App (ZIP-Export, GPX) – `<a download>` kommt in den WebViews nicht an |

- **Android** (`FolderPlugin.kt`): `ACTION_OPEN_DOCUMENT_TREE`, die Freigabe
  bleibt über Neustarts (`takePersistableUriPermission`); Dateien über
  `DocumentsContract` – geht auch mit Nextcloud, Google Drive, Proton Drive,
  wenn deren App Ordner anbietet. Manche melden keine Änderungszeit; der
  Abgleich vergleicht dann den Inhalt.
- **Rechner** (`desktop.rs`): Ordnerdialog über `rfd`, der Pfad steht in
  `ordner.json` (bzw. `ordner-<slot>.json`) im Konfigurationsordner der App.
- **Android:** je Ordner ein Eintrag in den SharedPreferences `wmap_folder`
  (`tree`, `tree.layers`); die Freigabe wird erst zurückgegeben, wenn kein
  anderer Eintrag denselben Ordner nutzt.
- **Der Ordnerdialog ist System-Oberfläche** – ein eigenes ✕ lässt sich dort
  nicht einbauen; abbrechen geht mit der Zurück-Geste (in Unterordnern
  mehrmals) bzw. „Abbrechen“ im Dialog am Rechner.

## Weblinks, Teilen (`plugins/browser`)

| Befehl | Was |
|---|---|
| `open { url, external }` | Link über der App: Android Custom Tab (✕ links, „Im Browser öffnen“ rechts), Rechner Fenster „link“ mit eingeblendeter Leiste; `external`: gleich im Standardbrowser |
| `share { title, text }` | nur Android: Teilen-Menü des Systems |
| `copy { text }` | nur Android: Zwischenablage |

`js/core/links.js` fängt in der App Klicks auf fremde http(s)-Links ab;
`js/ui/share.js` nutzt `share`/`copy` in der Android-App.
