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
  Sprachausgabe            → <queries> für TTS_SERVICE (ab Android 11 sieht
                             die App den Dienst sonst nicht – keine Ansagen)
  GPX öffnen               → Intent-Filter an die <activity>: „Öffnen mit“
                             (VIEW) und „Teilen“ (SEND) für GPX-Dateien; das
                             folder-Plugin nimmt sie an (opened → import.html)
  minSdk                   → app/build.gradle.kts aus tauri.conf.json
                             (bundle.android.minSdkVersion; Health Connect
                             braucht 26 – ein früher erzeugtes Projekt hat 24)
  Upload-Signatur          → app/build.gradle.kts, wenn es die Schlüssel-
                             datei gibt (für `tauri-android wmap release`)
  Android Auto             → tools/android/car/*.kt nach …/wmap/car/, ihre
                             Symbole (res/), Car App Library in Gradle, im
                             Manifest Dienst, Berechtigungen und
                             automotive_app_desc (WMap als Navigations-App)

  Name der Debug-Fassung   → app/src/debug/res/values/strings.xml: „wmap-Debug“
                             (Startbildschirm, App-Liste, Android Auto) – so
                             ist sie neben der App aus dem Play Store zu erkennen

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

# GPX und FIT öffnen und teilen. Dateimanager melden beide oft als octet-stream
# (GPX auch als XML) – das Plugin nimmt nur, was wirklich <gpx enthält oder mit
# dem FIT-Kopf beginnt.
GPX_MARKE = "<!-- wmap:gpx -->"
GPX_FILTER = f"""            {GPX_MARKE}
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/gpx+xml" />
                <data android:mimeType="application/gpx" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/xml" />
                <data android:mimeType="text/xml" />
                <data android:mimeType="application/vnd.ant.fit" />
                <data android:mimeType="application/fits" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/gpx+xml" />
                <data android:mimeType="application/gpx" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/xml" />
                <data android:mimeType="text/xml" />
                <data android:mimeType="application/vnd.ant.fit" />
                <data android:mimeType="application/fits" />
            </intent-filter>
"""

# Ab Android 11 nur sichtbar, was im Manifest steht – für TextToSpeech der Dienst
TTS_MARKE = "<!-- wmap:tts -->"
TTS_QUERIES = f"""    {TTS_MARKE}
    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>
"""

# Android Auto (tools/android/car): Navigations-App mit eigener Kartenfläche
CAR_LIB = 'implementation("androidx.car.app:app:1.7.0")'
# Standort im Auto wie in der App (Fused Location – das Standort-Plugin bringt es nur für sich mit)
CAR_LOC = 'implementation("com.google.android.gms:play-services-location:21.3.0")'
CAR_MARKE = "<!-- wmap:car -->"
CAR_DIENST = f"""        {CAR_MARKE}
        <service
            android:name=".car.WMapCarService"
            android:exported="true">
            <intent-filter>
                <action android:name="androidx.car.app.CarAppService" />
                <category android:name="androidx.car.app.category.NAVIGATION" />
            </intent-filter>
            <intent-filter>
                <action android:name="androidx.car.app.action.NAVIGATE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="geo" />
            </intent-filter>
        </service>
        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />
        <meta-data
            android:name="androidx.car.app.minCarApiLevel"
            android:value="5" />
"""

BERECHTIGUNGEN = [
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    # Navigation mit ausgeschaltetem Bildschirm
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    # Android Auto: Navigationsvorlagen und eigene Kartenfläche
    '<uses-permission android:name="androidx.car.app.NAVIGATION_TEMPLATES" />',
    '<uses-permission android:name="androidx.car.app.ACCESS_SURFACE" />',
]


def auto() -> None:
    """Android Auto: Kotlin, Symbole und die Car App Library."""
    quelle = PROJEKT / "tools/android/car"
    ziel = next((APP / "src/main/java").rglob("MainActivity.kt"), None)
    if ziel:
        (ziel.parent / "car").mkdir(exist_ok=True)
        for kt in quelle.glob("*.kt"):
            shutil.copyfile(kt, ziel.parent / "car" / kt.name)
    shutil.copytree(quelle / "res", APP / "src/main/res", dirs_exist_ok=True)
    datei = APP / "build.gradle.kts"
    text = datei.read_text(encoding="utf-8")
    for lib in (CAR_LIB, CAR_LOC):
        if lib not in text:
            text = text.replace("dependencies {\n", "dependencies {\n    " + lib + "\n", 1)
    datei.write_text(text, encoding="utf-8")


DEBUG_NAME = "wmap-Debug"


def debug_name() -> None:
    """Die Debug-Fassung heißt anders – Ressourcen unter src/debug gelten nur für sie."""
    ziel = APP / "src/debug/res/values"
    ziel.mkdir(parents=True, exist_ok=True)
    (ziel / "strings.xml").write_text(
        "<resources>\n"
        f'    <string name="app_name">"{DEBUG_NAME}"</string>\n'
        f'    <string name="main_activity_title">"{DEBUG_NAME}"</string>\n'
        "</resources>\n", encoding="utf-8")


def min_sdk() -> None:
    import json
    conf = json.loads((PROJEKT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    wert = conf.get("bundle", {}).get("android", {}).get("minSdkVersion")
    if not wert:
        return
    datei = APP / "build.gradle.kts"
    text = datei.read_text(encoding="utf-8")
    neu = re.sub(r"minSdk = \d+", f"minSdk = {wert}", text, count=1)
    if neu != text:
        datei.write_text(neu, encoding="utf-8")


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
    if TTS_MARKE not in text:
        text = text.replace("    <application", TTS_QUERIES + "\n    <application", 1)
    # Bestehenden Block ersetzen (die Liste der Typen kann sich ändern)
    alt = re.search(r" *" + re.escape(GPX_MARKE) + r"\n(?: *<intent-filter>\n(?:.*\n)*? *</intent-filter>\n){2}", text)
    if alt:
        text = text[:alt.start()] + GPX_FILTER + text[alt.end():]
    else:
        text = text.replace("        </activity>", GPX_FILTER + "        </activity>", 1)
    if CAR_MARKE not in text:
        text = text.replace("    </application>", CAR_DIENST + "    </application>", 1)
    if "supportsPictureInPicture" not in text:
        text = text.replace('android:name=".MainActivity"',
                            'android:name=".MainActivity"\n            android:supportsPictureInPicture="true"', 1)
    datei.write_text(text, encoding="utf-8")

    # Eigene Activity (Bild in Bild) über die erzeugte legen
    ziel = next((APP / "src/main/java").rglob("MainActivity.kt"), None)
    if ziel:
        shutil.copyfile(PROJEKT / "tools/android/MainActivity.kt", ziel)
    auto()
    debug_name()
    min_sdk()
    signatur()
    print("==> WMap-Teile eingesetzt (Symbol, Standort, Bild in Bild, Sprachausgabe, GPX öffnen, Android Auto"
          + (", Upload-Signatur)" if SIGNATUR.is_file() else ")"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
