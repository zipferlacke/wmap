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
  zeichnet auf“. Holt den Standort selbst (alle 2 s, hohe Genauigkeit) und sammelt die Punkte im
  Arbeitsspeicher, höchstens 30 000. **Ab 2.3.0 immer** (`always: true` in `take_recorded`), die Seite nimmt für
  die Aufzeichnung nur noch diese Punkte. Bis 2.2.0 nur, solange die App nicht zu sehen war (`hidden`): Beim
  Zurückkommen kam ein frischer Punkt der Seite vor den nachgereichten an, die dann als „zu alt“ wegfielen –
  Luftlinie statt Strecke; und am Sperrbildschirm (Bildschirm an, App gilt als vorn) zählte niemand.
- Die Benachrichtigung zeigt Zeit und Strecke und hat „Pause“/„Weiter“ und „Beenden“; den Stand gibt die Seite
  mit (`state` bei `start_recording` und `take_recorded`: Start, Pausen, Strecke, letzter Punkt), „Beenden“
  kommt als Vermerk am Start-Intent zurück (`onNewIntent`).
- Befehle `start_recording`, `stop_recording`, `take_recorded` (`{ points: [[lon, lat, Genauigkeit, Zeit]],
  running, paused, pausedAt, pausedMs, stop }`) – Kotlin, `src/commands.rs`, `src/mobile.rs`, `build.rs`; freigegeben in
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
