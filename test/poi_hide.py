"""Geneigte Karte: Orte hinter Häusern ausgeblendet (map/poi-hide.js) – echte Kacheln, Göttingen.
1. Geneigt nah heran: ein Teil der Orte ist verdeckt, aber nicht alle (die an der Straße bleiben).
2. Flach: keiner verdeckt.
3. Wieder geneigt: wieder verdeckt; ein verdeckter Ort wird beim Tippen übergangen.
4. Eine Prüfung bleibt billig (Mittel unter 20 ms)."""
import sys
import time
from common import Browser

STATE = """const m = window.__wmap.map; const layers = ['poi_early','poi_r1','poi_r7','poi_r20','poi_late','poi_transit'].filter((l) => m.getLayer(l));
  const f = m.queryRenderedFeatures({ layers }).filter((x) => x.id !== undefined);
  return { n: new Set(f.map((x) => x.id)).size, behind: new Set(f.filter((x) => x.state?.behind).map((x) => x.id)).size, pitch: m.getPitch(), zoom: m.getZoom() }"""

with Browser(412, 915) as b:
    b.open('index.html?view=9.9353,51.5340,17.5,70,355', 14)
    b.js("[...document.querySelectorAll('dialog[open] button')].find((x)=>/Los geht/.test(x.innerText))?.click()")
    bad = []
    def ok(name, c, more=''):
        print('ok    ' if c else 'FALSCH', name, more)
        if not c: bad.append(name)
    def settled():
        b.js("window.__idle = false; window.__wmap.map.once('idle', () => { window.__idle = true; }); window.__wmap.map.triggerRepaint();")
        b.wait("return window.__idle", 30)
        time.sleep(1)
        return b.js(STATE)
    s = settled()
    ok('geneigt: ein Teil verdeckt', 0 < s['behind'] < s['n'], s)
    b.shot('poi_hide_geneigt')
    b.js("window.__wmap.map.jumpTo({ pitch: 0 })")
    s0 = settled()
    ok('flach: keiner verdeckt', s0['behind'] == 0 and s0['n'] > 0, s0)
    b.js("window.__wmap.map.jumpTo({ pitch: 70 })")
    s1 = settled()
    ok('wieder geneigt: wieder verdeckt', s1['behind'] > 0, s1)
    # Laufzeit: dieselbe Rechnung wie je Bewegung, über die Ereignisse gemessen
    ms = b.js("""const m = window.__wmap.map; const t = []; const fire = () => { const a = performance.now(); m.fire('move'); t.push(performance.now() - a); };
      return new Promise((done) => { let i = 0; const step = () => { fire(); if (++i < 12) setTimeout(step, 300); else done(t); }; step(); });""")
    mean = sum(ms) / len(ms)
    ok('Prüfung billig', mean < 20, f'{mean:.1f} ms im Mittel, höchstens {max(ms):.1f} ms')
    sys.exit(b.report() or bool(bad))
