"""Abgleich mit Fortschritt (data/folder.js, pages/sync.js): Fortschritt je Datei, Abbruch mittendrin →
der nächste Abgleich liest nur den Rest, Seite zeigt „x von n (… %)“, Sicherung klappt mit Ordner zu.
Standort in der App (core/native.js): eine gemeinsame Abfrage für alle, jede Sekunde statt alle 10 s."""
import json
import sys
import time
from common import Browser

# Läuft als Modul in der Seite selbst: Skripte aus WebDriver haben in Firefox eigene Module
# (die Seite sähe den Test-Ordner sonst nicht)
FOLDER = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
(async () => {
  const { folder } = await import('./js/data/folder.js');
  const { tracks, buildTrack, trackGpx } = await import('./js/data/tracks.js');
  // 60 Wege von einem anderen Gerät (mit WMap-ID, alle im Januar), Lesen dauert je 60 ms
  const files = new Map();
  let clock = 5000;
  for (let k = 0; k < 60; k += 1) {
    const pts = []; for (let i = 0; i < 40; i += 1) pts.push([9.9 + k * 0.01 + i * 0.0005, 51.5 + i * 0.0003, Date.UTC(2026, 0, 1 + (k % 28), 8 + 3 * Math.floor(k / 28), 0, i * 10)]);
    const t = { ...buildTrack(pts, { kind: 'rec', profile: 'foot', name: `Test ${k}` }), id: `prog${k}` };
    files.set(`WMap/Aufgezeichnete Touren/2026/01 Januar/Test ${k}.gpx`, { text: trackGpx(t), modified: 1000 + k });
  }
  let reads = 0, fail = Infinity;
  const be = {
    permission: async () => 'granted',
    list: async () => [...files].map(([path, f]) => ({ path, lastModified: f.modified })),
    // Abbruch mitten im Abgleich (wie ein Seitenwechsel): Lesefehler übergeht der Abgleich,
    // darum hier ein Inhalt, an dem er selbst scheitert
    read: async (p) => {
      reads += 1;
      if (reads > fail) return { match() { throw new Error('Seite gewechselt'); } };
      await new Promise((r) => setTimeout(r, 60));
      return files.get(p).text;
    },
    write: async (p, text) => { clock += 1; files.set(p, { text, modified: clock }); return clock; },
    remove: async (p) => { files.delete(p); },
  };
  const events = [];
  addEventListener('wmap:folder-progress', (e) => events.push(e.detail));
  const partial = [];
  addEventListener('wmap:folder', (e) => { if (e.detail?.partial) partial.push(e.detail.imported); });
  folder._useBackend(be, 'Nextcloud');

  // 1. Abbruch nach 55 Dateien (wie ein Seitenwechsel)
  fail = 55;
  let err = null;
  try { await folder.sync(); } catch (e) { err = e.message; }
  const firstReads = reads;
  // Seite zeigt beim Abgleich den Fortschritt
  const out = { err, firstReads, events: events.length, last: events.filter((e) => e.n).at(-1), partial };
  // 2. Weiter: nur, was noch nicht im Stand war. Die Seite zeigt dabei den Fortschritt
  // (Firefox kann keine Ordner – für die Anzeige tun wir so)
  folder.supported = true;
  fail = Infinity; reads = 0; events.length = 0;
  const p = folder.sync();
  await new Promise((r) => setTimeout(r, 120));
  out.busyText = document.querySelector('.folder-progress')?.innerText ?? null;
  out.second = await p;
  out.secondReads = reads;
  out.done = events.some((e) => e.done);
  out.count = (await tracks.all()).filter((t) => t.id.startsWith('prog')).length;
  out.pendingAfter = (await folder.info()).pending;
  await new Promise((r) => setTimeout(r, 300));
  out.backup = !!document.querySelector('details.sync-backup');
  out.text = document.querySelector('.sync').innerText.slice(0, 200);
  for (let k = 0; k < 60; k += 1) await tracks.remove(`prog${k}`);
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

GPS = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const calls = [];
  const chans = [];
  window.__TAURI__ = { core: {
    Channel: class { constructor() { this.id = chans.push(this); } },
    invoke: async (cmd, args) => {
      calls.push([cmd, args?.options?.timeout ?? args?.channelId ?? null]);
      if (/permission/.test(cmd)) return { location: 'granted', coarseLocation: 'granted' };
      return null;
    },
  } };
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' });
  const { geo } = await import('./js/core/native.js?test-gps');
  const got = { nav: 0, rec: 0 };
  const rec = geo.watch(() => { got.rec += 1; }, null, { timeout: 15000 });
  let nav = geo.watch(() => { got.nav += 1; }, null, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 100));
  const watches = () => calls.filter(([c]) => c === 'plugin:geolocation|watch_position');
  const out = { watchCalls: watches().length, interval: watches()[0]?.[1] };
  // Eine Meldung des Plugins erreicht beide (vorher bekam nur der zuletzt gestartete etwas)
  chans.at(-1).onmessage({ coords: { latitude: 51.5, longitude: 9.9, accuracy: 5 }, timestamp: Date.now() });
  out.got = { ...got };
  // Navigation startet nach Stille neu: clear + watch → keine neue Abfrage
  geo.clear(nav);
  nav = geo.watch(() => { got.nav += 1; }, null, {});
  await new Promise((r) => setTimeout(r, 700));
  out.afterRestart = watches().length;
  out.clears = calls.filter(([c]) => c === 'plugin:geolocation|clear_watch').length;
  geo.clear(nav); geo.clear(rec);
  await new Promise((r) => setTimeout(r, 700));
  out.clearsEnd = calls.filter(([c]) => c === 'plugin:geolocation|clear_watch').length;
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=900) as b:
    b.d.set_script_timeout(120)
    b.open('sync.html', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", FOLDER)
    r = json.loads(b.wait("return window.__result", 120))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    ok = isinstance(r, dict) and r['err'] == 'Seite gewechselt' and r['events'] > 5 and r['partial'] \
        and r['secondReads'] < 40 and r['count'] == 60 and r['done'] and r['pendingAfter'] is False \
        and r['busyText'] and '%' in r['busyText'] and r['backup']
    print('Abgleich stimmt:', ok)
    if not ok:
        b.errors.append(('abgleich', 'Ergebnis falsch'))
    b.shot('sync-fertig')

    b.open('sync.html', wait=2)
    g = b.d.execute_async_script(GPS)
    print(json.dumps(g, ensure_ascii=False, indent=1))
    ok = isinstance(g, dict) and g['watchCalls'] == 1 and g['interval'] == 1000 and g['afterRestart'] == 1 \
        and g['got'] == {'nav': 1, 'rec': 1} \
        and g['clears'] == 0 and g['clearsEnd'] == 1
    print('Standort stimmt:', ok)
    if not ok:
        b.errors.append(('standort', 'Ergebnis falsch'))
    sys.exit(b.report())
