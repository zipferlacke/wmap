"""Zepp: alle Trainings der Liste (Seite „Alle“) nach unten hin exportieren (GPX, TCX oder FIT).

Zepp schreibt jede Datei nach Download/Zepp<Datum><Uhrzeit>.gpx; am Ende schiebt das Skript alle zusammen
nach Download/zepp_export/ (nur das Umpacken: python3 zepp_export.py 0).

Ablauf je Training: antippen → drei Punkte → Exportdaten → GPX-Format → zurück zur Liste. Getippt wird,
sobald der richtige Bildschirm da ist (keine festen Wartezeiten). Gelesen wird der Bildschirm als Text
(uiautomator), nicht als Bild.

Vorher: Handy per USB, entsperrt, in Zepp die Trainingsliste offen und dort, wo es losgehen soll (ganz oben
für alle); währenddessen nicht anfassen. Das Skript geht von dort nach unten bis zum Ende der Liste.
Aufruf: python3 zepp_export.py [gpx|tcx|fit] [max]
        Stand in zepp_done.json (gpx) bzw. zepp_done_fit.json – ein zweiter Lauf überspringt Erledigtes;
        Datei löschen = alles noch einmal. FIT ist das vollständigste Format (Frequenz auch beim Rudern, Runden).
Gerät:  ANDROID_SERIAL=… (sonst das in ui.py eingetragene)"""
import json, os, sys, time
import ui
HERE = os.path.dirname(os.path.abspath(__file__))
DONE = os.path.join(HERE, 'zepp_done.json')
LIST, DETAIL, EXPORT, OK = 'ExerciseHistoryActivity', 'SportDetailPageActivity', 'ExportGPXActivity', 'ExportSuccessActivity'
ARGS = sys.argv[1:]
# Format: gpx (Vorgabe), tcx oder fit – FIT ist das vollständigste (Frequenz auch beim Rudern, Runden der Uhr)
FORMAT = next((a for a in ARGS if a in ('gpx', 'tcx', 'fit')), 'gpx')
MAX = next((int(a) for a in ARGS if a.isdigit()), 10 ** 6)
LABEL = {'gpx': 'GPX-Format', 'tcx': 'TCX-Format', 'fit': 'FIT-Format'}[FORMAT]
SPOT_Y = {'gpx': 427, 'tcx': 631, 'fit': 835}[FORMAT]       # Stelle auf der Exportseite, wenn alle drei Formate da sind
if FORMAT != 'gpx': DONE = os.path.join(HERE, f'zepp_done_{FORMAT}.json')
done = json.load(open(DONE)) if os.path.exists(DONE) else {}

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)
def focus():
    return ui.adb('shell', 'dumpsys window | grep mCurrentFocus')
def wait(act, secs=10):
    end = time.time() + secs
    while time.time() < end:
        if act in focus(): return True
        time.sleep(0.05)
    return False
def back(): ui.adb('shell', 'input', 'keyevent', '4')
def to_list():
    for _ in range(40):
        if LIST in focus(): return True
        back(); time.sleep(0.1)
    return LIST in focus()
DL, OUT = '/sdcard/Download', '/sdcard/Download/zepp_export'
def files():
    # Trainings ohne Strecke (z. B. „Freies Training“) haben kein GPX – an derselben Stelle steht dann TCX
    return set(ui.adb('shell', f'ls -p {DL}/ | grep -E "^Zepp[0-9]+\\.(gpx|tcx|fit)$"').split())
def tidy():
    """Am Ende: alles, was Zepp nach Download geschrieben hat, in den eigenen Ordner"""
    ui.adb('shell', f'mkdir -p {OUT}; for f in {DL}/Zepp*.gpx {DL}/Zepp*.tcx {DL}/Zepp*.fit; do [ -f "$f" ] && mv "$f" {OUT}/; done')
def items(nodes):
    """Sichtbare Trainings: [(Schlüssel, x, y)] – Schlüssel aus Art, Beginn, Dauer, Strecke"""
    out, cur = [], None
    for n in nodes:
        if n['id'] == 'sportsType': cur = {'type': n['text'], 'y': n['y']}; out.append(cur)
        elif cur and n['id'] in ('sportsBegin', 'sportCostTime', 'sportsTypeData'): cur[n['id']] = n['text']
    res = []
    for c in out:
        if not all(k in c for k in ('sportsBegin', 'sportCostTime', 'sportsTypeData')): continue   # am Rand angeschnitten
        if not 340 < c['y'] + 40 < 2150: continue
        res.append(('|'.join([c['type'], c['sportsBegin'], c['sportCostTime'], c['sportsTypeData']]), 540, c['y'] + 40))
    return res

def export_one(key, x, y):
    """Feste Stellen antippen, sobald der richtige Bildschirm da ist. → (Ergebnis, Zeiten der Schritte in s)"""
    t, steps = time.time(), []
    def lap(name):
        nonlocal t
        steps.append(f'{name} {time.time() - t:.1f}'); t = time.time()
    before = files()
    ui.tap(x, y)
    if not wait(DETAIL): return 'Ansicht ging nicht auf', steps
    lap('Ansicht')
    # Drei Punkte oben rechts: Das Blatt „Aktionen“ ist ein eigenes Fenster – es ist da, sobald das Fenster im
    # Vordergrund ein anderes ist. Der Knopf geht schon, bevor die Ansicht fertig geladen ist; verpufft ein
    # Tipp trotzdem, gleich noch einmal
    base, sheet = focus(), False
    for _ in range(40):
        ui.tap(1014, 235)
        end = time.time() + 0.35
        while time.time() < end and not sheet:
            f = focus()
            sheet = DETAIL in f and f != base
        if sheet: break
    if not sheet: return 'Blatt „Aktionen“ ging nicht auf', steps
    lap('Blatt')
    # „Exportdaten“ steht im frisch geöffneten Blatt an fester Stelle
    ui.tap(845, 1946)
    if not wait(EXPORT, 2):
        # Reihe verschoben: Bildschirm lesen und suchen
        spot = next(iter(ui.find('^Exportdaten$')), None)
        if not spot:
            ui.tap_text('^Abbruch$'); return 'kein „Exportdaten“', steps
        ui.tap(spot['x'], spot['y'])
        if not wait(EXPORT, 6): return 'Exportseite ging nicht auf', steps
    lap('Exportseite')
    # Format antippen: Der erste Tipp verpufft oft (Seite baut sich noch auf) – in kurzen Abständen wiederholen.
    # Trainings ohne Strecke haben weniger Formate, die Stelle stimmt dann nicht: Bildschirm lesen und suchen
    for _ in range(4):
        ui.tap(540, SPOT_Y)
        if wait(OK, 0.6): break
    else:
        spot = next(iter(ui.find(f'^{LABEL}$')), None)
        if not spot: return f'kein „{LABEL}“', steps
        for _ in range(20):
            ui.tap(spot['x'], spot['y'])
            if wait(OK, 0.6): break
        else: return 'Export nicht bestätigt', steps
    lap('GPX')
    new = sorted(files() - before)
    # zurück, bis die Liste da ist (Bestätigung → Exportseite → Ansicht → Liste)
    for _ in range(8):
        if LIST in focus(): break
        back()
        time.sleep(0.15)
    lap('zurück')
    # Der Dateiname trägt die Startzeit – passt sie nicht zur Zeile, wurde ein anderes Training getroffen
    begin = key.split('|')[1].replace(':', '')
    if new and new[0][12:16] != begin: return f'andere Zeile getroffen ({new[0]})', steps
    if new and not new[0].endswith('.' + FORMAT): return f'anderes Format geschrieben ({new[0]})', steps
    return '→ ' + (new[0] if new else 'Zepp (Datei gab es schon)'), steps

def main():
    if not to_list(): log('Bitte in Zepp die Trainingsliste öffnen'); return 1
    n, still, t0 = 0, 0, time.time()
    vis = items(ui.dump())
    while n < MAX:
        todo = [v for v in vis if v[0] not in done]
        # Die Liste steht nach dem Zurück an derselben Stelle – alle sichtbaren nacheinander, ohne neu zu lesen
        for key, x, y in todo:
            if n >= MAX: break
            res, steps = export_one(key, x, y)
            done[key] = res
            json.dump(done, open(DONE, 'w'), ensure_ascii=False, indent=1)
            n += 1
            log(f'{n:3d}', 'ok    ' if '→ Zepp' in res else 'FEHLT ', key, '·', res, '·', ', '.join(steps))
            if not to_list(): log('Liste nicht wiedergefunden – Abbruch'); tidy(); return 1
        # weiter: langsam ziehen (kein Schwung, sonst rutschen Zeilen ungesehen durch), einmal lesen
        before = [k for k, *_ in vis]
        t = time.time()
        ui.adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '500')
        vis = items(ui.dump())
        log(f'    weiter gescrollt und gelesen in {time.time() - t:.1f} s, sichtbar {len(vis)}')
        still = still + 1 if [k for k, *_ in vis] == before else 0
        if still >= 3: break
    tidy()
    n_files = ui.adb('shell', f'ls {OUT} | wc -l').strip()
    log('in', OUT + ':', n_files, 'Dateien')
    log('fertig:', n, 'in diesem Lauf in', round(time.time() - t0), 's,', len(done), 'insgesamt,', sum('→ Zepp' not in v for v in done.values()), 'ohne Export')
    return 0

if __name__ == '__main__':
    sys.exit(main())
