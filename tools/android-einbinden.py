#!/usr/bin/env python3
"""Setzt die WMap-Teile in das von Tauri erzeugte Android-Projekt ein.

`src-tauri/gen/android` ist Wegwerfware: Tauri erzeugt es neu, und es steht
nicht im Repository. Was WMap darüber hinaus braucht, kommt hier hinein –
aufgerufen von `tauri-android wmap` (wuefl_products/tools) vor jedem Bauen:

  appdata/icons/android/   → app/src/main/res/ (App-Symbol)
  Standort-Berechtigungen  → vor <application> (tauri-plugin-geolocation
                             fragt nur nach, was im Manifest steht)
  tools/android/MainActivity.kt → Bild in Bild während der Navigation
                             (beim Rauswischen von selbst, siehe js/pip.js)
  supportsPictureInPicture → an die <activity>

Mehrfach aufrufbar: alles wird nur einmal eingetragen.
"""

import shutil
import sys
from pathlib import Path

PROJEKT = Path(__file__).resolve().parent.parent
APP = PROJEKT / "src-tauri/gen/android/app"

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
    print("==> WMap-Teile eingesetzt (Symbol, Standort, Bild in Bild)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
