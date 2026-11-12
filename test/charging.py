"""Ladesäulen mit Belegung (services/charging.js, app/charging.js). Die Ladesäulen-Datenbank (OCPDB) ist nachgebaut:
um die Göttinger Innenstadt sieben Standorte, Overpass ist gesperrt.

1. Öffnungszeiten (openNow): rund um die Uhr, Tageszeiten, über Mitternacht, Sonderschließung
2. „Ladesäulen in der Nähe“ mit „Nur freie“ (Vorgabe) und „Nur offene“: die 5 nächsten freien, offenen Standorte;
   die doppelte Säule aus dem Register zählt einmal, die belegte und die geschlossene fehlen
3. „Nur offene“ aus: die geschlossene kommt dazu
4. Stecker CCS: nur der Standort mit freiem CCS
5. Antippen: Ortskarte mit Stecker, Leistung und „1 von 2 frei“
6. „Nur freie“ aus: Liste aus der Karte, mit dem Chip „Nur freie“
"""
import json
import sys
from common import Browser

# Overpass weg, OCPDB nachgebaut – als Skript in der Seite selbst (siehe poi_open.py)
FAKE = r"""
{ const own = window.fetch;
  const C = [9.9360, 51.5341];
  const at = (m, east = 0) => ({ lat: String(C[1] + m / 111200), lon: String(C[0] + east / 69300) });
  const evse = (status, standard, kw) => ({ status, connectors: [{ standard, max_electric_power: kw * 1000 }] });
  const now = Date.now(), h = 3600e3;
  const loc = (id, name, m, evses, opening_times = { twentyfourseven: true }, east = 0) => ({ id, name, operator: { name: 'Testwerk' },
    address: 'Teststraße ' + id, postal_code: '37073', city: 'Göttingen', coordinates: at(m, east), evses, opening_times, last_updated: new Date(now).toISOString() });
  const items = [
    loc(1, 'Schnell', 200, [evse('AVAILABLE', 'IEC_62196_T2_COMBO', 150), evse('CHARGING', 'IEC_62196_T2_COMBO', 150)]),
    loc(2, 'Register', 205, [evse('STATIC', 'IEC_62196_T2_COMBO', 150)], null),
    loc(3, 'Belegt', 300, [evse('CHARGING', 'IEC_62196_T2', 22)]),
    loc(4, 'Zu', 400, [evse('AVAILABLE', 'IEC_62196_T2', 22)], { twentyfourseven: true, exceptional_closings: [{ period_begin: new Date(now - h).toISOString(), period_end: new Date(now + h).toISOString() }] }),
    ...[5, 6, 7, 8].map((i) => loc(i, 'Frei ' + i, 500 + i * 60, [evse('AVAILABLE', 'IEC_62196_T2', 11)], null, 50)),
  ];
  window.__ocpdb = 0;
  window.fetch = function (url, opts) {
    const u = String(url?.url ?? url);
    if (u.includes('/interpreter')) return Promise.reject(new TypeError('NetworkError'));
    if (u.includes('/ocpdb/')) { window.__ocpdb += 1; return Promise.resolve(new Response(JSON.stringify({ items, total_count: items.length }), { headers: { 'Content-Type': 'application/json' } })); }
    return own.call(this, url, opts);
  };
}"""
PRELOAD = """() => {
  if (typeof window === 'undefined' || !window.document) return;
  const inject = () => { const s = document.createElement('script'); s.textContent = %s; (document.head ?? document.documentElement).append(s); };
  if (document.documentElement) inject();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); inject(); } }).observe(document, { childList: true });
}""" % json.dumps(FAKE)
MODULE = """const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);"""
OPEN_NOW = """const { openNow } = await import('./js/services/charging.js');
  const mon = (h, m = 0) => new Date(2026, 10, 9, h, m);   // Montag
  const tue = (h, m = 0) => new Date(2026, 10, 10, h, m);
  const day = { regular_hours: [{ weekday: 1, period_begin: '08:00', period_end: '20:00' }] };
  const night = { regular_hours: [{ weekday: 1, period_begin: '22:00', period_end: '06:00' }] };
  window.__open = [openNow(null) === null, openNow({ twentyfourseven: true }) === true, openNow(day, mon(9)) === true, openNow(day, mon(21)) === false,
    openNow(day, tue(9)) === false, openNow(night, mon(23)) === true, openNow(night, tue(5)) === true, openNow(night, tue(7)) === false];"""
RUN = """const c = await import('./js/core/categories.js'); const m = await import('./js/app/category.js'); m.runCategory(c.byId('charging'));"""
LIST = """return { sub: document.querySelector('.cat-sub')?.innerText, names: [...document.querySelectorAll('.cat-list button[data-i] strong')].map((x) => x.innerText),
  free: document.querySelector('.cat-list [data-free]')?.getAttribute('aria-pressed'), calls: window.__ocpdb }"""
DONE = "return /Standort|Kein/.test(document.querySelector('.cat-sub')?.innerText ?? '') && !/…/.test(document.querySelector('.cat-sub').innerText)"
checks = {}


def listed(b, before=None):
    b.wait(DONE + (f" && window.__ocpdb > {before}" if before is not None else ''), 30)
    return b.js(LIST)


def tap(b, sel, before):
    b.js(f"document.querySelector({sel!r}).click()")
    return listed(b, before)


with Browser(width=420, height=900) as b:
    b.d.script.add_preload_script(PRELOAD)
    b.open('index.html', 3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1'); localStorage.removeItem('wmap.chargeFilter')")
    b.open('index.html?view=9.9360,51.5341,16,0,0', wait=6)

    b.js(MODULE, OPEN_NOW)
    b.wait("return Array.isArray(window.__open)", 10)
    res = b.js("return window.__open")
    print('1. openNow:', res)
    checks['1. Öffnungszeiten'] = all(res)

    b.wait("const m = window.__wmap?.map; return m && m.loaded()", 40)
    b.js(MODULE, RUN)
    a = listed(b)
    print('2.', a)
    checks['2. Fünf freie, offene, ohne Doppelte'] = a['names'] == ['Schnell, (1)', 'Frei 5, (2)', 'Frei 6, (3)', 'Frei 7, (4)', 'Frei 8, (5)'] and a['free'] == 'true'

    o = tap(b, '.cat-list [data-hf="open"]', a['calls'])
    print('3.', o)
    checks['3. „Nur offene“ aus: die geschlossene dabei'] = 'Zu, (2)' in o['names'] and 'Belegt, (3)' not in o['names']
    tap(b, '.cat-list [data-hf="open"]', o['calls'])

    c = tap(b, '.cat-list [data-plug="ccs"]', o['calls'] + 1)
    print('4.', c)
    checks['4. CCS: nur der Schnelllader'] = c['names'] == ['Schnell, (1)'] and 'Kein' not in c['sub']

    b.js("document.querySelector('.cat-list button[data-i=\"0\"]').click()")
    b.wait("return !!document.querySelector('.place-media .charger')", 10)
    card = b.js("return document.querySelector('.place-media .charger').innerText")
    print('5.', card)
    b.shot('charging-card')
    checks['5. Ortskarte mit Stecker und Belegung'] = 'CCS' in card and '150 kW' in card and '1 von 2 frei' in card

    b.js(MODULE, RUN)
    b.wait(DONE + " && !!document.querySelector('.cat-list [data-free]')", 30)
    b.js("document.querySelector('.cat-list [data-free]').click()")
    b.wait("return document.querySelector('.cat-list [data-free]')?.getAttribute('aria-pressed') === 'false'", 30)
    m = b.js(LIST)
    print('6.', m)
    b.shot('charging-map-list')
    checks['6. Ohne „Nur freie“: Liste aus der Karte'] = m['free'] == 'false' and 'Schnell, (1)' not in m['names']

    b.js("localStorage.removeItem('wmap.chargeFilter')")
    b.errors[:] = [e for e in b.errors if 'NetworkError' not in str(e) and 'Overpass' not in str(e) and 'photon.komoot' not in str(e)]
    for k, v in checks.items():
        print('ok    ' if v else 'FALSCH', k)
    if not all(checks.values()):
        b.errors.append(('charging', 'Prüfung fehlgeschlagen'))
    sys.exit(b.report())
