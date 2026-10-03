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

**Dazugekommen (2.2.0): Aufzeichnen bei ausgeschaltetem Bildschirm.**

- `android/src/main/java/RecordService.kt` – Vordergrund-Dienst (Typ `location`) mit Benachrichtigung „WMap
  zeichnet auf“. Holt den Standort selbst (alle 2 s, hohe Genauigkeit) und sammelt die Punkte, solange die App
  nicht zu sehen ist (`hidden`, gesetzt in `onPause`/`onResume` des Plugins) – im Arbeitsspeicher, höchstens
  30 000 Punkte.
- Befehle `start_recording`, `stop_recording`, `take_recorded` (`{ points: [[lon, lat, Genauigkeit, Zeit]],
  running }`) – Kotlin, `src/commands.rs`, `src/mobile.rs`, `build.rs`; freigegeben in
  `capabilities/mobile.json`. Auf dem Rechner und unter iOS meldet `start_recording` einen Fehler – die Seite
  bleibt dann beim angeschalteten Bildschirm.
- Befehle `notification_state`, `request_notification` (`{ state: "granted" | "prompt" }`) und die
  Freigabe-Gruppe `notifications` am Plugin: Das Fenster von Android kommt erst nach dem Hinweis der App
  (`recordingNotice` in `js/ui/permissions.js`), nicht beim Start des Dienstes.
- `android/src/main/AndroidManifest.xml` – der Dienst und die Berechtigungen `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.

Aufgerufen aus `js/core/native.js` (`geo.background`) vom Recorder in `js/data/tracks.js`.

Bei einer neuen Fassung des Plugins: prüfen, ob das dort behoben ist – dann diese Kopie und den Eintrag
`[patch.crates-io]` entfernen.
