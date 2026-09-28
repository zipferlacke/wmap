# .secrets – Schlüssel für den Android-Release

Hier liegen Dateien, die **nie** ins Repository und nie auf den Server
dürfen. `.secrets/` steht in `.gitignore` (nur diese README ist ausgenommen)
und in der Ausschlussliste von `.vscode/sftp.json`.

| Datei | Was |
|---|---|
| `wmap-upload.jks` | Upload-Schlüssel für den Play Store (Keystore) |
| `wmap.properties` | Pfad, Alias und Passwort dazu – liest Gradle beim Release |

Ohne den Schlüssel gibt es **keine Updates** im Play Store (außer über einen
Antrag bei Google auf einen neuen Upload-Schlüssel). Darum zusätzlich sicher
aufbewahren, z. B. im Passwortmanager (WKeePass: Datei als Anhang).

## 1. Schlüssel einmalig anlegen

Im Ordner `wmap/` – fragt nach Passwort und Namen:

```bash
~/.local/share/android-studio/jbr/bin/keytool -genkeypair -v \
  -keystore .secrets/wmap-upload.jks \
  -alias wmap -keyalg RSA -keysize 4096 -validity 10000
chmod 600 .secrets/wmap-upload.jks
```

Dann `.secrets/wmap.properties` anlegen (Pfad absolut, `chmod 600`):

```properties
storeFile=/home/wuefl/Dokumente/dev/web/wuefl_products/wmap/.secrets/wmap-upload.jks
storePassword=DEIN_PASSWORT
keyAlias=wmap
keyPassword=DEIN_PASSWORT
```

## 2. Release bauen

```bash
tauri-android wmap release
```

Baut ein signiertes AAB (alle Prozessortypen, für den Play Store) und je
Typ eine APK nach `src-tauri/target/android-release/`:

- `wmap-android.aab` → in der Play Console hochladen
- `wmap-android.apk` (arm64, fast alle Handys), `-armv7`, `-x86_64`

Vor jedem Upload die Version in `src-tauri/tauri.conf.json` erhöhen – der
Play Store nimmt jede versionCode nur einmal an.

## 3. Für GitHub Actions hinterlegen (per Hand im Browser)

Soll GitHub den Release bauen (wie bei WKeePass), braucht der Workflow den
Schlüssel als drei **Repository-Secrets**. GitHub nimmt nur Text an – der
Keystore wird deshalb vorher in Base64-Text umgewandelt.

**a) Keystore als Text** – im Ordner `wmap/`:

```bash
base64 -w0 .secrets/wmap-upload.jks > .secrets/wmap-upload.base64.txt
```

Die Datei `.secrets/wmap-upload.base64.txt` im Editor (VS Code) öffnen und
den **ganzen** Inhalt kopieren (Strg+A, Strg+C) – eine einzige lange Zeile.

**b) Secrets anlegen** – auf github.com:

1. Das Repository öffnen (z. B. `github.com/zipferlacke/wmap`).
2. Oben **Settings** (Zahnrad) → links **Secrets and variables** →
   **Actions**.
3. Reiter **Secrets** → **New repository secret**.
4. Dreimal anlegen, jeweils **Name** eintragen, **Secret** einfügen,
   **Add secret**:

   | Name | Secret |
   |---|---|
   | `ANDROID_KEYSTORE` | der kopierte Base64-Text aus a) |
   | `ANDROID_KEYSTORE_PASSWORD` | das Passwort des Keystores |
   | `ANDROID_KEY_ALIAS` | `wmap` |

Danach stehen die drei Namen in der Liste. Den Inhalt zeigt GitHub nie
wieder an – ändern geht nur über **Update**.

**c) Aufräumen** – die Textdatei wird nicht mehr gebraucht:

```bash
rm .secrets/wmap-upload.base64.txt
```

Der Workflow von WKeePass (`keepass/.github/workflows/build.yml`, Schritt
„Signieren“) zeigt, wie die drei Secrets dort benutzt werden. Für WMap gibt
es noch kein GitHub-Repository und keinen Workflow – bis dahin baut
`tauri-android wmap release` lokal.
