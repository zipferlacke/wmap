#!/usr/bin/env python3
"""Setzt die WMap-Teile in das von Tauri erzeugte Android-Projekt ein.

`src-tauri/gen/android` ist Wegwerfware: Tauri erzeugt es neu, und es steht
nicht im Repository. Was WMap darüber hinaus braucht, kommt hier hinein –
aufgerufen von `tauri-android wmap` (wuefl_products/tools) vor jedem Bauen:

  appdata/icons/android/   → app/src/main/res/ (App-Symbol)
  Standort-Berechtigungen  → vor <application> (tauri-plugin-geolocation
                             fragt nur nach, was im Manifest steht)
  tools/android/MainActivity.kt → Bild in Bild während der Navigation
                             (beim Rauswischen von selbst, siehe js/nav/pip.js)
  supportsPictureInPicture → an die <activity>
  Upload-Signatur          → app/build.gradle.kts, wenn es die Schlüssel-
                             datei gibt (für `tauri-android wmap release`)

Mehrfach aufrufbar: alles wird nur einmal eingetragen.

Signatur: Die Datei `.secrets/wmap.properties` im Projekt (oder der Pfad in
$ANDROID_SIGNING). `.secrets/` steht in .gitignore und in der Ausschlussliste
von .vscode/sftp.json – kommt also weder ins Repository noch auf den Server:

  storeFile=/home/…/wuefl_products/wmap/.secrets/wmap-upload.jks
  storePassword=…
  keyAlias=wmap
  keyPassword=…

Gibt es sie, signiert Gradle den Release-Build (AAB und APKs) selbst – ohne
jarsigner. Debug-Builds bleiben davon unberührt.
"""

import os
import re
import shutil
import sys
from pathlib import Path

PROJEKT = Path(__file__).resolve().parent.parent
APP = PROJEKT / "src-tauri/gen/android/app"
SIGNATUR = Path(os.environ.get("ANDROID_SIGNING", PROJEKT / ".secrets/wmap.properties"))
ANFANG, ENDE = "// wmap:signatur-anfang", "// wmap:signatur-ende"


def signatur() -> None:
    """Release-Signatur in app/build.gradle.kts eintragen (bzw. erneuern)."""
    datei = APP / "build.gradle.kts"
    text = datei.read_text(encoding="utf-8")
    # Alte Einträge weg – so bleibt das Skript beliebig oft aufrufbar
    text = re.sub(re.escape(ANFANG) + r".*?" + re.escape(ENDE) + r"\n?", "", text, flags=re.S)
    if not SIGNATUR.is_file():
        datei.write_text(text, encoding="utf-8")
        return
    laden = (f"{ANFANG}\nval wmapSigning = Properties().apply {{\n"
             f"    val f = file(\"{SIGNATUR}\")\n    if (f.exists()) f.inputStream().use {{ load(it) }}\n}}\n{ENDE}\n")
    konfig = (f"    {ANFANG}\n    signingConfigs {{\n"
              "        if (wmapSigning.getProperty(\"storeFile\") != null) create(\"upload\") {\n"
              "            storeFile = file(wmapSigning.getProperty(\"storeFile\"))\n"
              "            storePassword = wmapSigning.getProperty(\"storePassword\")\n"
              "            keyAlias = wmapSigning.getProperty(\"keyAlias\")\n"
              "            keyPassword = wmapSigning.getProperty(\"keyPassword\")\n"
              "        }\n    }\n"
              f"    {ENDE}\n")
    nutzen = (f"            {ANFANG}\n"
              "            signingConfigs.findByName(\"upload\")?.let { signingConfig = it }\n"
              f"            {ENDE}\n")
    text = text.replace("android {\n", laden + "android {\n" + konfig, 1)
    text = text.replace('getByName("release") {\n', 'getByName("release") {\n' + nutzen, 1)
    datei.write_text(text, encoding="utf-8")

BERECHTIGUNGEN = [
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    # Navigation mit ausgeschaltetem Bildschirm
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
]


def main() -> int:
    if not APP.is_dir():
        print(f"{APP} fehlt – erst `cargo tauri android init`.", file=sys.stderr)
        return 1
    symbole = PROJEKT / "appdata/icons/android"
    if symbole.is_dir():
        shutil.copytree(symbole, APP / "src/main/res", dirs_exist_ok=True)

    datei = APP / "src/main/AndroidManifest.xml"
    text = datei.read_text(encoding="utf-8")
    fehlend = [b for b in BERECHTIGUNGEN if b not in text]
    if fehlend:
        zeilen = "".join(f"    {b}\n" for b in fehlend)
        text = text.replace("    <application", zeilen + "\n    <application", 1)
    if "supportsPictureInPicture" not in text:
        text = text.replace('android:name=".MainActivity"',
                            'android:name=".MainActivity"\n            android:supportsPictureInPicture="true"', 1)
    datei.write_text(text, encoding="utf-8")

    # Eigene Activity (Bild in Bild) über die erzeugte legen
    ziel = next((APP / "src/main/java").rglob("MainActivity.kt"), None)
    if ziel:
        shutil.copyfile(PROJEKT / "tools/android/MainActivity.kt", ziel)
    signatur()
    print("==> WMap-Teile eingesetzt (Symbol, Standort, Bild in Bild"
          + (", Upload-Signatur)" if SIGNATUR.is_file() else ")"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
