# Veröffentlichen – was vorher zu tun ist

Die Liste von oben nach unten abarbeiten. Schritte 1–7 bereiten vor (das
kann Claude), Schritt 8 veröffentlicht (das macht Florian selbst), Schritt 9
prüft nach. Einzelheiten zu den Werkzeugen: [`README.md`](README.md)
(Abschnitt „Werkzeuge“), [`tools/README.md`](tools/README.md),
[`test/README.md`](test/README.md).

**Immer:** Der Docker-Server `php` muss laufen (`docker start php`). Den
Routenserver vor Bildern und Tests **einmal** anfragen
(`curl -s -o /dev/null -w '%{http_code}\n' https://valhalla1.openstreetmap.de/status`)
und nie mit vielen Anfragen zugleich belasten – er sperrt sonst für Stunden.
Bilder, Tests und App-Bau nie gleichzeitig laufen lassen (Speicher,
`free -m`).

## 1. Bilder – neu, wo sich etwas geändert hat

- [ ] **Screenshots und Werbebilder:** `takeshots wmap` (hell und dunkel in
      einem Lauf, zwei Prozesse, rund 6 Minuten). Keine Zeile mit `!` im
      Ergebnis. Nur die Werbebilder neu: `takeshots wmap compose`.
- [ ] **Ansehen**, mindestens: Bild 2 (Suchergebnis fertig, kein „…“ in der
      Unterzeile, Schilder deckend – auch breit), Bild 4 (Route und
      Diagramm, dunkel), Bild 8 und 10 (Beispieltouren da), jedes Bild, das
      die Änderung betrifft. „Load failed“ oder halb geladene Karten →
      das Bild einzeln noch einmal.
- [ ] **Beispieldaten geändert** (`tools/demo.html`)? Dann die Strecken neu:
      `test/.venv/bin/python test/demo_strecken.py` → `tools/demo-strecken.json`.
- [ ] **Android Auto geändert?** Dann die vier Bilder aus dem Simulator neu
      (`screenshot-auto{,_light}.png`, `screenshot-auto-route{,_light}.png`) –
      Ablauf in `tools/README.md`: Start fest am Kulturverein Rittmarshausen,
      nie der Standort des Handys. Danach `takeshots wmap compose`.
- [ ] **Bilder der Webseite** aus den Werbebildern (nicht `social.png`):
      ```bash
      cd appdata/werbung && for f in handy-*.png breit-*.png; do
        magick "$f" -quality 82 ~/Dokumente/dev/web/wuefl/wmap/img/${f%.png}.webp; done
      magick ../images/screenshot-auto_light.png -quality 82 ~/Dokumente/dev/web/wuefl/wmap/img/auto-tag.webp
      ```

## 2. Texte

- [ ] **README.md** beschreibt jede Änderung (auch `tools/README.md`,
      `test/README.md`); Erledigtes aus `.claude/next.md` gestrichen.
- [ ] **Neuigkeiten** `appdata/messages.json`: Version und Datum stimmen, die
      Liste ist kurz, und was sie nennt, heißt in der App wirklich so
      (Namen von Einstellungen und Knöpfen nachsehen).
- [ ] **Store-Texte** `appdata/store/de-DE/`: `short_description.txt` höchstens
      80, `full_description.txt` höchstens 4000 Zeichen (`wc -m`); neue
      Funktionen stehen drin.
- [ ] **Webseite** `~/Dokumente/dev/web/wuefl/wmap/index.html`: Funktionen,
      Android Auto, „ab Version …“ stimmen.

## 3. wuefl-libs

- [ ] Wurde die Bibliothek geändert? Dann dort `appdata/messages.json`
      (Modul- und Bibliotheksversion, kleiner Sprung, „Fix: …“) und
      einchecken (`main`, danach `git branch -f production main`).
- [ ] Die Apps aus GitHub Actions holen den **neuesten Tag** von wuefl-libs –
      eine Änderung dort braucht also zuerst ein Release der Bibliothek
      (Schritt 8).

## 4. Version und Stand

- [ ] **Versionsnummer frei?** `git tag` und `git ls-remote --tags origin`.
      Android rechnet den Versionscode aus der Nummer (2.1.0 → 2001000), und
      Google Play nimmt jeden Code nur einmal: Liegt die Nummer schon bei
      Play, braucht es eine neue.
- [ ] `python3 appdata/version.py` – nach der letzten Änderung an Dateien der
      App (setzt die Version überall, die Dateiliste und den Stand in
      `sw.js`). Nicht, während Tests laufen.

## 5. Tests

- [ ] `cd test && ./alle.sh` – einmal ganz, am Ende muss
      `== alles ohne JS-Fehler` stehen und nirgends `FALSCH`
      (`grep -c FALSCH out/all.log`). Rund 11 Minuten; das Log läuft in
      `test/out/all.log` mit. Währenddessen keine Dateien der App ändern.

## 6. Android-App

- [ ] `tauri-android wmap build`, aufs Handy
      (`adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`),
      kurz ansehen, was sich geändert hat; danach Gradle beenden
      (`cd src-tauri/gen/android && ./gradlew --stop`).
- [ ] Android Auto geändert? Im Simulator ansehen (`tools/android-auto.sh id3`).

## 7. Git

- [ ] Alles auf `main` eingecheckt (ohne Zusatzzeilen wie „Co-Authored-By“),
      `git status` leer, `git branch -f production main`.
- [ ] Keine alten Zweige mehr (`git branch`): es bleiben `main`,
      `production`, `release`.

## 8. Veröffentlichen (Florian)

In dieser Reihenfolge:

1. **wuefl-libs**, falls geändert: `git-release` dort (neuer Tag).
2. **WMap:** `git-release` – der Tag `v*` lässt GitHub Actions Windows,
   macOS, Linux und Android bauen und an das Release hängen.
3. **Web-App** per SFTP nach `app.wuefl.de/wmap`. Die Bibliothek kommt dabei
   **nicht** mit (der Upload folgt dem Link `libs/wuefl-libs` nicht): bei
   geänderter Bibliothek ihren Inhalt eigens nach `wmap/libs/wuefl-libs`
   kopieren.
4. **Webseite** `wuefl/wmap` (Text und `img/`) per SFTP.
5. **Google Play:** AAB aus dem Release, Store-Texte, Werbebilder (welche
   acht: `tools/README.md`).

## 9. Danach prüfen

- [ ] `app.wuefl.de/wmap` lädt, „Was ist neu“ zeigt die Version.
- [ ] Die Bibliothek auf dem Server ist die neue (Datum von
      `…/wmap/libs/wuefl-libs/diagramm/diagramm.js`).
- [ ] Die Download-Links auf wuefl.de/wmap liefern die neue Version
      (`releases/latest/download/…`).
