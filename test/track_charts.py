"""Weg mit Puls und Frequenz: Diagramm-Umschalter, Runden (1/2/5 km), schnellste/langsamste, GPX mit Messwerten."""
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
const t = { ...buildTrack(pts, { kind: 'gpx', profile: 'foot', name: 'Testlauf' }), id: 'wtest1' };
await tracks.put(t);
const back = parseGpx(trackGpx(t))[0];
return { n: t.times.length, hr: !!t.hr, cad: !!t.cad, gpxHr: !!back.hr, gpxCad: !!back.cad };
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
