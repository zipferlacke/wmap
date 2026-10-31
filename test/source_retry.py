"""Kartenquelle neu laden (js/map/map.js retryFailedSources): Scheitert beim Start die TileJSON von OpenFreeMap
(kurz kein Netz), blieb die Karte bis zum Neustart ohne Straßen, Orte und Namen. Jetzt versucht WMap es selbst neu –
hier scheitern die ersten beiden Anfragen, nach wenigen Sekunden sind die Kacheln trotzdem da."""
import sys
import time
from common import Browser

# Die ersten zwei Abrufe der TileJSON (…/planet ohne weiteren Pfad) scheitern wie ohne Netz
PRELOAD = """() => {
  const own = window.fetch.bind(window); let fails = 0; window.__fails = () => fails;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (/tiles\\.openfreemap\\.org\\/planet\\/?$/.test(url) && fails < 2) { fails += 1; return Promise.reject(new TypeError('NetworkError')); }
    return own(input, init);
  };
}"""

STATE = """const m = window.__wmap.map; const t = (m.style.tileManagers ?? m.style.sourceCaches).openmaptiles;
return { fails: window.__fails?.(), errored: t._sourceErrored, loaded: t._sourceLoaded,
  roads: m.queryRenderedFeatures().filter((f) => f.sourceLayer === 'transportation').length }"""

with Browser(1000, 760) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.open('index.html?view=9.9353,51.5340,15', 3)
    early = b.js(STATE)
    print('gleich nach dem Start:', early)
    end = time.time() + 30
    late = early
    while time.time() < end:
        time.sleep(1)
        late = b.js(STATE)
        if late['loaded'] and late['roads']:
            break
    print('danach:', late)
    checks = {
        'TileJSON scheiterte zweimal': late['fails'] == 2,
        'Quelle danach geladen, Straßen gezeichnet': late['loaded'] and late['roads'] > 0,
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    # Die beiden absichtlichen Fehler sind keine JS-Fehler von WMap
    b.errors = [e for e in b.errors if 'NetworkError' not in e[1]]
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
