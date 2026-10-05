"""Aufzeichnen mit dem Dienst der Android-App (js/data/tracks.js Recorder, geo.background):
1. App 2.2.0 (Dienst sammelt nur ohne Bild): Zurück im Bild kommt ein frischer Punkt der Seite, bevor das Gesammelte
   da ist – es wird trotzdem in der richtigen Reihenfolge nachgetragen (früher: Luftlinie).
2. App ab 2.3.0 (`always`): Für die Aufzeichnung zählen nur die Punkte des Dienstes, die der Seite bleiben außen vor."""
import json
import sys
from common import Browser

TEST = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = { always: false, queue: [], delay: 0, takes: 0 };
  window.__TAURI__ = { core: {
    Channel: class {},
    invoke: async (cmd) => {
      if (/permission/.test(cmd)) return { location: 'granted', coarseLocation: 'granted' };
      if (cmd === 'plugin:geolocation|take_recorded') {
        state.takes += 1;
        const points = state.queue; state.queue = [];
        if (state.delay) await wait(state.delay);
        return { points, running: true, paused: false, pausedAt: 0, pausedMs: 0, stop: false, ...(state.always ? { always: true } : {}) };
      }
      return null;
    },
  } };
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' });
  localStorage.removeItem('wmap.rec');
  const { recorder } = await import('./js/data/tracks.js');
  const visible = (v) => { Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
  const t0 = Date.now();
  const p = (i) => [9.9 + i * 0.0005, 51.5];           // je Schritt rund 35 m nach Osten
  const out = {};
  for (const always of [false, true]) {
    state.always = always; state.queue = []; state.delay = 0;
    recorder.start({ kind: 'rec', profile: 'foot' });
    await wait(300);                                     // Dienst läuft, erster Abgleich durch
    recorder.add({ point: p(0), accuracy: 5 });
    recorder.add({ point: p(1), accuracy: 5 });
    await wait(1700);                                    // ein Abgleich im Bild (alle 1,5 s)
    const visibleN = recorder.points.length;
    // Bildschirm aus: Der Dienst sammelt vier Punkte
    visible('hidden');
    state.queue = [2, 3, 4, 5].map((i) => [...p(i), 5, Date.now() + i]);
    await wait(50);
    // Zurück: Das Abholen dauert – inzwischen meldet die Seite schon den frischen Punkt
    state.delay = 400;
    visible('visible');
    await wait(50);
    recorder.add({ point: p(6), accuracy: 5 });
    await wait(700);
    state.delay = 0;
    out[always ? 'neu' : 'alt'] = { visibleN, n: recorder.points.length, lons: recorder.points.map((x) => Math.round((x[0] - 9.9) / 0.0005)), km: Math.round(recorder.length) };
    recorder.discard();
    await wait(100);
  }
  out.takes = state.takes;
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser() as b:
    b.open('plugin-anleitung.html', wait=2)
    r = b.d.execute_async_script(TEST)
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False))
    checks = {
        '1. App 2.2.0: im Bild zählen die Punkte der Seite': r['alt']['visibleN'] == 2,
        '1. App 2.2.0: Gesammeltes vor dem frischen Punkt nachgetragen – keine Luftlinie': r['alt']['lons'] == [0, 1, 2, 3, 4, 5, 6],
        '2. App 2.3.0: nur die Punkte des Dienstes – die frischen der Seite bleiben außen vor': r['neu']['lons'][-4:] == [2, 3, 4, 5] and 6 not in r['neu']['lons'],
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(0 if all(checks.values()) else 1)
