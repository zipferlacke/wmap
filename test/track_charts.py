"""Weg mit Puls und Frequenz: Diagramm-Umschalter, Diagramm im Vollbild, Runden (1/2/5 km), schnellste/langsamste, GPX mit Messwerten."""
import sys
from common import Browser

# 6,3 km nach Osten, alle 10 s ein Punkt; km 2–3 schnell, km 4–5 langsam
MAKE = """
const { buildTrack, tracks, trackGpx, parseGpx } = await import('./js/data/tracks.js');
const pts = []; let lon = 9.90, t0 = Date.UTC(2026, 8, 20, 8, 0, 0), ms = t0;
while ((lon - 9.90) * 69500 < 6300) {
  const km = (lon - 9.90) * 69.5;
  const v = km >= 2 && km < 3 ? 4.5 : km >= 4 && km < 5 ? 2.0 : 3.0;   // m/s
  pts.push([lon, 51.53, ms, 120 + Math.round(v * 10), 160 + Math.round(v * 5), 0]);
  lon += v * 10 / 69500; ms += 10000;
}
// Runden der Uhr: zwei Marken (nach 10 und 25 Minuten) → drei Runden
const t = { ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Testlauf' }), id: 'wtest1', marks: [600, 1500] };
await tracks.put(t);
const back = parseGpx(trackGpx(t))[0];
return { n: t.times.length, hr: !!t.hr, cad: !!t.cad, gpxHr: !!back.hr, gpxCad: !!back.cad, gpxMarks: back.marks };
"""

with Browser(width=420, height=900) as b:
    b.open('wege.html', wait=3)
    print('Weg angelegt:', b.d.execute_async_script(
        'const done = arguments[0]; (async () => {' + MAKE + '})().then(done, (e) => done(String(e)))'))
    b.open('wege.html?id=wtest1', wait=5)
    tabs = b.js("return [...document.querySelectorAll('.weg-chart-tabs .chip')].map(c => c.innerText.trim() + (c.getAttribute('aria-pressed') === 'true' ? ' *' : ''))")
    print('Diagramme:', tabs)
    for kind in ['hr', 'speed', 'cad']:
        b.js(f"document.querySelector('[data-chart={kind}]').click()")
        b.wait("return document.querySelector('.elevation .dg_tools')")
        print(' ', kind, '→', b.js("return document.querySelector('.elevation .elev-mountain')?.textContent + ' | ' + [...document.querySelectorAll('.elevation .dg_chip, .elevation [class*=chip]')].map(x => x.innerText.replace(/\\s+/g, ' ')).slice(0, 3).join(' / ')"))
    b.shot('weg-diagramm')
    # Vollbild: dasselbe Diagramm im Dialog, die Umschalter ziehen mit; zu per Knopf und per Esc, danach wieder zu öffnen
    import time
    state = "const d = document.querySelector('dialog.dg_fs'), bar = document.querySelector('.weg-chart-tabs'); return [!!d?.open, !!bar?.closest('dialog.dg_fs'), bar?.querySelector('[aria-pressed=true]')?.dataset.chart, document.querySelector('.dg_fsbtn')?.title, document.querySelector('.elev-mountain')?.title, document.querySelector('.elevation').offsetHeight > 400]"
    b.js("document.querySelector('.elevation .dg_fsbtn').click()"); time.sleep(1)
    full = b.js(state)
    b.js("document.querySelector('dialog.dg_fs [data-chart=hr]').click()"); time.sleep(1)
    switched = b.js(state)
    b.shot('weg-diagramm-vollbild')
    b.js("document.querySelector('dialog.dg_fs .dg_fsbtn').click()"); time.sleep(1)
    closed = b.js(state)
    b.js("document.querySelector('.elevation .dg_fsbtn').click()"); time.sleep(1)
    again = b.js(state)
    b.js("document.querySelector('dialog.dg_fs').close()"); time.sleep(1)
    esc = b.js(state)
    print('Vollbild:', full, switched, closed, again, esc)
    for name, ok in {
        'Vollbild: Diagramm füllt den Dialog, Umschalter sind dabei': full == [True, True, 'cad', 'Vollbild verlassen', 'Schrittfrequenz', True],
        'Vollbild: umschalten auf Puls, Knopf bleibt „verlassen“': switched == [True, True, 'hr', 'Vollbild verlassen', 'Puls', True],
        'Vollbild: zu per Knopf – Diagramm und Umschalter zurück im Blatt, Auswahl bleibt': closed == [False, False, 'hr', 'Vollbild', 'Puls', False],
        'Vollbild: geht danach wieder auf, zu per Esc': again[:2] == [True, True] and esc == closed,
    }.items():
        print('ok    ' if ok else 'FALSCH', name)
    b.js("document.querySelector('[data-lap-size=watch]').click()")
    watch = b.js("return [[...document.querySelectorAll('[data-lap-size]')].map(c => c.innerText.trim()), [...document.querySelectorAll('.laps-table tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').split(' ').slice(0, 4).join(' '))]")
    print('Runden der Uhr:', watch)
    for name, ok in {
        'Runden der Uhr: Auswahl „Uhr“ steht vorn, drei Runden mit Strecke und Zeit (10:00, 15:00, Rest)': watch[0][0] == 'Uhr' and len(watch[1]) == 3 and '10:00' in watch[1][0] and '15:00' in watch[1][1] and 'km' in watch[1][0],
    }.items():
        print('ok    ' if ok else 'FALSCH', name)
    for size in [1000, 2000, 5000]:
        b.js(f"document.querySelector('[data-lap-size=\"{size}\"]').click()")
        rows = b.js("return [...document.querySelectorAll('.laps-table tbody tr')].map(r => r.className + ': ' + r.innerText.replace(/\\s+/g, ' '))")
        print(f'Runden {size // 1000} km:', rows)
    b.js("document.querySelector('[data-lap-size=\"1000\"]').click()")
    b.js("document.querySelector('.laps-table tr.fast').click()")
    import time; time.sleep(1)
    print('Runde auf der Karte:', b.js("const m = window.__wmap.map; return [!!m.getLayer('lap-sel'), m.querySourceFeatures('lap-sel').length, document.querySelector('.laps-table tr.shown')?.innerText.replace(/\\s+/g, ' ')]"))
    b.shot('weg-runden')
    b.js("indexedDB && 1")
    b.d.execute_async_script("const done = arguments[0]; import('./js/data/tracks.js').then(m => m.tracks.remove('wtest1')).then(() => done(1), () => done(0))")
    sys.exit(b.report())
