"""Leistung (Watt) aus Health Connect – die ganze Kette, mit nachgebildetem Plugin (plugin:health|samples):
1. Zu einem aus Health Connect übernommenen Training ohne Messwerte liefert Health Connect Leistung (PowerRecord,
   src-tauri/plugins/health: `power`) – js/services/health.js hängt sie an die Punkte des Wegs (`pow`).
2. „Meine Touren“ → Aufgezeichnet → das Training: Kennzahl „Ø Leistung“ in Watt und der Diagramm-Umschalter
   „Leistung“; angetippt zeigt das Diagramm die Leistung entlang der Strecke.
3. Ohne Leistungswerte gibt es weder Kennzahl noch Umschalter (so sieht es aus, wenn die Testdaten keine haben)."""
import json
import sys
import time
from common import Browser

# Vor allen Modulen: das Plugin der App nachbilden – Health Connect liefert nur Leistung
PRELOAD = """() => {
  window.__samples = [];
  window.__TAURI__ = { core: { Channel: class {}, invoke: async (cmd, args) => {
    if (cmd === 'plugin:health|samples') { window.__asked = args; return { hr: [], steps: [], pedal: [], power: window.__samples }; }
    return null;
  } } };
}"""
MAKE = """
const done = arguments[arguments.length - 1];
(async () => {
  const { buildTrack, tracks } = await import('./js/data/tracks.js');
  const { refreshHealthValues } = await import('./js/services/health.js');
  const t0 = Date.now() - 3 * 864e5;
  const pts = []; for (let i = 0; i < 120; i += 1) pts.push([9.90 + i * 0.0004, 51.53, t0 + i * 10000]);
  const mk = (id, name, day = 0) => ({ ...buildTrack(pts.map(([x, y, ms]) => [x, y, ms - day * 864e5]), { kind: 'health', profile: 'bike', name }), id, sport: 'biking', source: { health: 'S-' + id, app: 'com.garmin.android.apps.connectmobile' } });
  await tracks.putQuiet(mk('hpow', 'Radrunde mit Leistungsmesser'));
  // einen Tag früher – sonst gälten die beiden als dieselbe Tour (Frage nach Doppelten)
  await tracks.putQuiet(mk('hnopow', 'Radrunde ohne Leistungsmesser', 1));
  // Health Connect: alle 5 s ein Wert, 180–240 W
  window.__samples = Array.from({ length: 240 }, (_, i) => [t0 + i * 5000, 180 + (i % 13) * 5]);
  const saved = await refreshHealthValues(await tracks.get('hpow'));
  window.__samples = [];
  const none = await refreshHealthValues(await tracks.get('hnopow'));
  const pow = (saved?.pow ?? []).filter((v) => v > 0);
  return { got: !!saved, n: pow.length, of: saved?.times.length ?? 0, mean: pow.length ? Math.round(pow.reduce((a, b) => a + b, 0) / pow.length) : 0, none: none === null, asked: !!window.__asked?.start };
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""
VIEW = "return { tabs: [...document.querySelectorAll('.weg-chart-tabs .chip')].map((c) => c.innerText.replace(/^\\S+\\s+/, '').trim() + (c.getAttribute('aria-pressed') === 'true' ? ' *' : '')), stat: [...document.querySelectorAll('#panel strong, .weg strong')].map((x) => x.parentElement.innerText.replace(/\\s+/g, ' ').trim()).find((x) => /Leistung/.test(x)) ?? null, title: document.querySelector('.elevation')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120) ?? null }"

with Browser(width=420, height=900) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.open('wege.html', wait=4)
    r = b.d.execute_async_script(MAKE)
    print('aus Health Connect:', r)
    if not isinstance(r, dict):
        sys.exit(1)
    b.open('wege.html?id=hpow', wait=5)
    with_pow = b.js(VIEW)
    print('mit Leistung:', json.dumps(with_pow, ensure_ascii=False))
    b.js("[...document.querySelectorAll('.weg-chart-tabs .chip')].find((c) => c.dataset.chart === 'pow')?.click()")
    time.sleep(1.5)
    chosen = b.js(VIEW)
    print('Diagramm Leistung:', json.dumps(chosen, ensure_ascii=False))
    b.shot('health-power')
    b.open('wege.html?id=hnopow', wait=5)
    without = b.js(VIEW)
    print('ohne Leistung:', json.dumps(without, ensure_ascii=False))
    b.d.execute_async_script("const done = arguments[arguments.length - 1]; (async () => { const { tracks } = await import('./js/data/tracks.js'); await tracks.removeQuiet('hpow'); await tracks.removeQuiet('hnopow'); localStorage.removeItem('wmap.chart'); })().then(done, done);")
    checks = {
        '1. Leistung aus Health Connect hängt an (fast) allen Punkten des Trainings, Ø um 210 W': r['got'] and r['asked'] and r['n'] >= r['of'] - 2 and 200 <= r['mean'] <= 220,
        '1. ohne Werte in Health Connect ändert sich nichts': r['none'],
        '2. Kennzahl „Ø Leistung“ in Watt und Umschalter „Leistung“': bool(with_pow['stat']) and ' W' in with_pow['stat'] and 'Ø Leistung' in with_pow['stat'] and any(t.startswith('Leistung') for t in with_pow['tabs']),
        '2. angetippt: Diagramm zeigt die Leistung (Ø 213 W, höchstens 240 W, Achse in W)': 'Leistung *' in chosen['tabs'] and '213 W' in (chosen['title'] or '') and '240 W' in (chosen['title'] or ''),
        '3. Training ohne Leistung: keine Kennzahl, kein Umschalter': without['stat'] is None and not any(t.startswith('Leistung') for t in without['tabs']),
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    rc = b.report()
    sys.exit(1 if not all(checks.values()) else rc)
