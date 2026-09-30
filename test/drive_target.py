"""Fahrziel fürs Auto (js/app/drive-target.js): Zu einem Geschäft endet die Fahrt am Parkplatz davor – die Nadel
bleibt am Geschäft, „P“ und ein Satz im Sheet zeigen es. Nicht mit dem Rad, nicht ohne den Merker `poi`
(Adresse, Punkt auf der Karte) und nicht bei Orten, in die man hineinfährt (Tankstelle, Parkplatz)."""
import sys
from common import Browser

START = [9.9355, 51.5335]       # Göttingen, Innenstadt

SETUP = """
const start = arguments[0];
const { isPoi, parkingNear } = await import('./js/app/drive-target.js');
const { poisInBounds } = await import('./js/map/tile-pois.js');
const { enterRoute, setProfile } = await import('./js/app/route-plan.js');
const { distance } = await import('./js/core/geo.js');
const { map, state } = window.__wmap;
Object.assign(window, { isPoi, parkingNear, enterRoute, setProfile, distance });
const f = (properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties });
window.kinds = [isPoi(f({ osm_key: 'shop', osm_value: 'supermarket' })), isPoi(f({ _tags: { amenity: 'restaurant' } })), isPoi(f({ name: 'Gemerkt', _poi: true })),
  isPoi(f({ osm_key: 'amenity', osm_value: 'fuel' })), isPoi(f({ osm_key: 'amenity', osm_value: 'parking' })), isPoi(f({ osm_key: 'building', osm_value: 'yes', housenumber: '8' })), isPoi(f({ name: 'Punkt', _point: true }))];
// Supermärkte aus den Kartenkacheln – so hängt der Test an keinem festen Punkt: einer mit Parkplatz direkt davor
// (dessen Mitte keine 70 m weg), einer ohne (der nächste über 110 m weg)
const b = map.getBounds();
const pois = await poisInBounds(map, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
const lots = pois.filter((p) => p.props.subclass === 'parking');
const shops = pois.filter((p) => p.props.subclass === 'supermarket').map((p) => ({ name: p.props.name ?? 'Markt', point: p.point, lot: Math.round(Math.min(...lots.map((l) => distance(l.point, p.point)))) }));
window.shop = shops.filter((s) => s.lot < 70).sort((x, y) => x.lot - y.lot)[0] ?? null;
window.far = shops.find((s) => s.lot > 110) ?? null;
window.route = (poi) => enterRoute({ from: { label: 'Start', point: start, me: false }, to: { label: window.shop.name, point: window.shop.point, me: false, ...(poi ? { poi: true } : {}) } });
window.result = () => { const r = state.routes.find((x) => x.id === state.selected); const el = document.querySelector('.route-park');
  return r && !document.querySelector('[data-view="route"]').classList.contains('loading') ? {
    park: el.hidden ? null : el.textContent.trim(), marker: !!document.querySelector('.wp-marker.park'),
    pin: Math.round(distance(state.waypoints.at(-1).point, window.shop.point)), moved: Math.round(distance(state.drive.at(-1), state.points.at(-1))),
    endToShop: Math.round(distance(r.coords.at(-1), window.shop.point)), endToDrive: Math.round(distance(r.coords.at(-1), state.drive.at(-1))) } : null; };
return 1;
"""

ok = True
def check(name, value, good):
    global ok
    ok = ok and bool(good)
    print(f"{name}: {value}{'' if good else '  ← FALSCH'}")

with Browser(width=420, height=900) as b:
    b.open('index.html?view=9.9300,51.5560,14', wait=5)
    r = b.d.execute_async_script('const done = arguments[arguments.length - 1]; (async () => {' + SETUP + '})().then(done, (e) => done(String(e)))', START)
    check('Module geladen', r, r == 1)
    k = b.js('return window.kinds')
    check('Geschäft, Lokal, gemerkter Ort sind Orte zum Davorparken', k[:3], k[:3] == [True, True, True])
    check('Tankstelle, Parkplatz, Adresse, Punkt auf der Karte nicht', k[3:], k[3:] == [False, False, False, False])
    shop = b.js('return window.shop')
    check('Supermarkt mit Parkplatz davor (aus den Kacheln)', shop, bool(shop))
    far = b.js('return window.far')
    if far:
        n = b.d.execute_async_script('const done = arguments[arguments.length - 1]; parkingNear(window.far.point).then(done, (e) => done(String(e)))')
        check(f'Markt ohne Parkplatz direkt davor (nächster {far["lot"]} m): keiner', n, n is None)
    # Nur zur Ansicht (hängt an den OSM-Daten): Edeka in Rittmarshausen, der nächste eingetragene Parkplatz liegt 125 m weg
    print('Edeka Rittmarshausen:', b.d.execute_async_script('const done = arguments[arguments.length - 1]; parkingNear([10.0997, 51.48163]).then(done, (e) => done(String(e)))'))
    if shop:
        p = b.d.execute_async_script('const done = arguments[arguments.length - 1]; parkingNear(window.shop.point).then(done, (e) => done(String(e)))')
        check('Parkplatz direkt davor', p, isinstance(p, dict) and p['dist'] <= 120)

        b.js("setProfile('car'); route(true)")
        a = b.wait('return window.result()', 40)
        check('Auto: Satz im Sheet und „P“ auf der Karte', a, a and a['park'] and 'Parkplatz davor' in a['park'] and a['marker'])
        check('Nadel bleibt am Geschäft, gefahren wird zum Parkplatz', a, a and a['pin'] == 0 and a['moved'] == p['dist'] and a['endToDrive'] <= 60)
        b.shot('drive_target')

        b.js("setProfile('bike'); route(true)")
        c = b.wait('return window.result()', 40)
        check('Rad: bis zum Geschäft, kein Hinweis', c, c and c['park'] is None and not c['marker'] and c['moved'] == 0)

        b.js("setProfile('car'); route(false)")
        d = b.wait('return window.result()', 40)
        check('Auto ohne Merker (Adresse): wie bisher zum Punkt', d, d and d['park'] is None and not d['marker'] and d['moved'] == 0)
    print('keine JS-Fehler' if not b.errors else b.errors)
    sys.exit(0 if ok and not b.errors else 1)
