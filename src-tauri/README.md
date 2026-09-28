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
| `tauri-start.js` | wechselt beim Start zur Webversion, wenn sie erreichbar ist (s. u.) |
| `icons/` | App-Icons, erzeugt mit `cargo tauri icon ../appdata/wmap-512.png` |
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
