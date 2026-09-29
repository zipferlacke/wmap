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
2,5 s) – dann läuft die App von dort. So kommt jede Änderung an HTML, CSS
und JavaScript ohne neue Version im Play Store an; ein neuer Build ist nur
nötig, wenn sich hier in `src-tauri/` etwas ändert (Rust, Plugins, Rechte,
Icons).

Ohne Netz geht die App trotzdem zur Webversion, sobald sie dort einmal
gelaufen ist: Deren Service Worker liefert dann den zuletzt geladenen Stand,
die angesehenen Karten und die Offline-Gebiete aus seinem Speicher. Nur beim
allerersten Start ohne Netz bleibt die eingepackte Kopie – ohne Karte, weil
noch nichts gespeichert ist.

Geräte-Funktionen kommen weiter aus Tauri: Die Webadresse steht in beiden
`capabilities/*.json` unter `remote`, darum findet `../js/core/native.js` auch dort
`window.__TAURI__` und nimmt z. B. das GPS des Handys. Weitere Plugins
(Dateien, Dialoge …) müssen in `Cargo.toml`, `src/lib.rs` und den Rechten
stehen – und die Webseite fragt vorher, ob es sie gibt.

Achtung: Wer die Webseite ändern kann, darf damit auch alles, was die Rechte
der App erlauben – die Rechte darum klein halten.

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
  Seite Sicherung & Abgleich (nur in der Android-App); Freigaben erklärt
  `js/ui/permissions.js` (auch den Standort – dafür stehen
  `geolocation:allow-check-permissions` und `…-request-permissions` in
  `capabilities/mobile.json`).
- **Play Store:** Gesundheitsdaten brauchen dort eine eigene Erklärung
  (Formular „Health Connect“ in der Play Console) und in der
  Datensicherheit „Fitness“ – erhoben, nur auf dem Gerät, nicht geteilt.


## Ordner verbinden (`plugins/folder`)

Das WebView der App kennt die File System Access API von Chrome nicht –
darum wählt das System den Ordner, und die App liest und schreibt nur darin
(`js/data/folder.js`, Seite „Sicherung & Abgleich“).

| Befehl | Was |
|---|---|
| `pick` | Ordner wählen → `{ connected, name }` |
| `info` | `{ connected, name }` |
| `list` | `.gpx`/`.json` bis 5 Ebenen tief → `{ files: [{ path, modified }] }` |
| `read { path }` / `write { path, text }` / `remove { path }` | Pfade relativ zum Ordner mit „/“; `..` und absolute Pfade lehnt das Plugin ab; `write` legt fehlende Ordner an |
| `disconnect` | Ordner vergessen (Android: Freigabe zurückgeben) |

- **Android** (`FolderPlugin.kt`): `ACTION_OPEN_DOCUMENT_TREE`, die Freigabe
  bleibt über Neustarts (`takePersistableUriPermission`); Dateien über
  `DocumentsContract` – geht auch mit Nextcloud, Google Drive, Proton Drive,
  wenn deren App Ordner anbietet. Manche melden keine Änderungszeit; der
  Abgleich vergleicht dann den Inhalt.
- **Rechner** (`desktop.rs`): Ordnerdialog über `rfd`, der Pfad steht in
  `ordner.json` im Konfigurationsordner der App.

## Weblinks, Teilen (`plugins/browser`)

| Befehl | Was |
|---|---|
| `open { url, external }` | Link über der App: Android Custom Tab (✕ links, „Im Browser öffnen“ rechts), Rechner Fenster „link“ mit eingeblendeter Leiste; `external`: gleich im Standardbrowser |
| `share { title, text }` | nur Android: Teilen-Menü des Systems |
| `copy { text }` | nur Android: Zwischenablage |

`js/core/links.js` fängt in der App Klicks auf fremde http(s)-Links ab;
`js/ui/share.js` nutzt `share`/`copy` in der Android-App.
