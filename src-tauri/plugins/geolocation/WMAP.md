# tauri-plugin-geolocation 2.4.0 – Kopie mit Korrektur

Das Plugin von Tauri (Apache-2.0 OR MIT, https://github.com/tauri-apps/plugins-workspace), unverändert bis auf
drei Stellen im Android-Teil. Eingebunden über `[patch.crates-io]` in `src-tauri/Cargo.toml`.

**Warum:** `watchPosition` beantwortete seinen Aufruf nie. Die Rust-Seite wartet darauf blockierend
(`run_mobile_plugin` → `rx.recv()`), in einem der Arbeits-Threads der App (so viele wie Prozessorkerne, am
Pixel 9 acht). Jede gestartete Beobachtung – bei WMap je Seite eine und eine weitere bei jedem Wechsel des
Melde-Abstands – hielt so einen Thread für immer fest. Nach acht antwortete die App auf nichts mehr: keine
Plugin-Befehle, keine eigenen Seiten („Webseite nicht verfügbar – http://tauri.localhost“).
Nachgestellt am Gerät: acht `watch_position`, danach bleibt `check_permissions` ohne Antwort.

**Geändert:**

- `android/src/main/java/GeolocationPlugin.kt` – `watchPosition` ruft nach dem Start `invoke.resolve()`.
- `android/src/main/java/GeolocationPlugin.kt` – `onPause` vor `load()` (App gleich nach dem Start wieder
  verlassen) stürzte ab: „lateinit property implementation has not been initialized“. Jetzt wird das geprüft.
- `android/src/main/java/Geolocation.kt` – `sendLocation` meldet einen Fehler auch ohne Fehlertext
  (sonst bliebe `getCurrentPosition` offen).

Bei einer neuen Fassung des Plugins: prüfen, ob das dort behoben ist – dann diese Kopie und den Eintrag
`[patch.crates-io]` entfernen.
