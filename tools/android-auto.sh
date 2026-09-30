#!/usr/bin/env bash
#
# Android Auto am Rechner ausprobieren: Googles Desktop Head Unit (DHU) zeigt,
# was im Auto zu sehen wäre – das Handy hängt per adb am Rechner.
#
#   tools/android-auto.sh          DHU starten (lädt sie beim ersten Mal)
#   tools/android-auto.sh id3      wie ein Auto: id3, mercedes, golf, klein
#                                  (Bildschirme in tools/dhu/*.ini)
#
# Befehle an die laufende DHU (Tag/Nacht, Bildschirmfoto …):
#   echo night >> ~/.cache/wmap-dhu/eingabe      bzw. day, screenshot <datei>
#
# Auf dem Handy vorher, einmal: Android Auto → Version zehnmal antippen →
# Menü ⋮ → Entwicklereinstellungen → „Unbekannte Quellen“ an (die Debug-App
# kommt nicht aus dem Play Store). Jedes Mal: Menü ⋮ → „Head Unit Server
# starten“.
#
# Die DHU gibt es für Linux nur als x86-64. Auf ARM (Asahi) läuft sie über
# muvm/FEX; libc++ fehlt dort und kommt aus Fedoras x86-64-Paket. In der VM
# ist „localhost“ die VM – socat reicht den Port 5277 zum Rechner durch.
#
# Die Karte im Auto lädt die Debug-App vom Rechner: adb reverse 8080 (Docker).

set -Eeuo pipefail
# Auto aus tools/dhu/<name>.ini → -c <pfad>
AUTOS="$(cd "$(dirname "$0")" && pwd)/dhu"
if [[ $# -ge 1 && -f "$AUTOS/$1.ini" ]]; then set -- -c "$AUTOS/$1.ini" "${@:2}"; fi
DIR="${XDG_CACHE_HOME:-$HOME/.cache}/wmap-dhu"
ZIP=desktop-head-unit-linux-x64_r02.1.zip

if [[ ! -x "$DIR/desktop-head-unit" ]]; then
  echo "==> DHU laden nach $DIR"
  mkdir -p "$DIR"
  curl -sSLo "$DIR/$ZIP" "https://dl.google.com/android/repository/$ZIP"
  (cd "$DIR" && unzip -qo "$ZIP" && rm "$ZIP")
fi
if [[ "$(uname -m)" != x86_64 && ! -e "$DIR/libc++.so.1" ]]; then
  echo "==> libc++ (x86-64) für die DHU"
  tmp="$(mktemp -d)"
  (cd "$tmp" && dnf download -q --forcearch=x86_64 --arch=x86_64 libcxx libcxxabi \
    && for f in *.rpm; do rpm2cpio "$f" | cpio -idm 2>/dev/null; done \
    && cp -a usr/lib64/libc++*.so* "$DIR/")
  rm -rf "$tmp"
fi

# Dasselbe Handy über mehrere Wege verbunden (Kabel, WLAN): eines nehmen
[[ -n "${ANDROID_SERIAL:-}" ]] || export ANDROID_SERIAL="$(adb devices | awk '$2 == "device" { print $1; exit }')"
adb forward tcp:5277 tcp:5277 >/dev/null
adb reverse tcp:8080 tcp:8080 >/dev/null || true
echo "==> Head Unit Server auf dem Handy gestartet? (Android Auto → ⋮ → Head Unit Server starten)"

if [[ "$(uname -m)" == x86_64 ]]; then
  cd "$DIR" && exec ./desktop-head-unit "$@"
fi

# ARM: in der muvm-VM, Port 5277 über das Gateway (= Rechner) durchreichen
run="$DIR/run-vm.sh"
cat > "$run" <<EOF
#!/bin/sh
GW=\$(ip route | awk '/default/ {print \$3}')
socat TCP-LISTEN:5277,fork,reuseaddr,bind=127.0.0.1 TCP:\$GW:5277 &
cd "$DIR"
export LD_LIBRARY_PATH="$DIR"
# Die DHU liest Befehle von der Eingabe – ist die zu (VM), beendet sie sich
# sofort. Darum aus einer Datei: echo night >> ~/.cache/wmap-dhu/eingabe
: > "$DIR/eingabe"
tail -f "$DIR/eingabe" | ./desktop-head-unit $* > "$DIR/dhu.log" 2>&1
kill %1 2>/dev/null
EOF
chmod +x "$run"
echo "==> DHU in muvm (Protokoll: $DIR/dhu.log)"
exec muvm "$run"
