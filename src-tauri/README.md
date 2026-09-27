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
| `src/lib.rs` | App starten; unter Linux Standortabfragen von WebKitGTK erlauben |
| `build.rs` | von Tauri vorgegeben |
| `capabilities/default.json` | Rechte der Web-App im Fenster (nur Standard) |
| `capabilities/mobile.json` | Handy-Apps: zusätzlich Standort über das Gerät |
| `icons/` | App-Icons, erzeugt mit `cargo tauri icon ../appdata/wmap-512.png` |
| `web-kopieren.sh` | kopiert die Web-Dateien vor jedem Build nach `web/` |

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
auf Android), fragt `../js/native.js` erst nach Tauri und nimmt sonst die
Browser-Schnittstelle – die Webversion verliert dadurch nichts.
