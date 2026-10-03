"""Ans Auto senden (js/data/car-link.js → `shared` in js/car/car.js) und Zurückführen auf die geplante Tour.
1. Am Handy: Knopf „Ans Auto“ in Ortsansicht und Routenplanung nur mit verbundenem Auto (WMapAndroid nachgestellt);
   gesendet wird der Ort bzw. die Route mit der gewählten Alternative.
2. Im Auto (index.html?car): Die gesendete Route kommt mit denselben Punkten an, gewählt ist die Alternative,
   die der am Handy gewählten am nächsten kommt; ein gesendeter Ort öffnet die Routenübersicht dorthin.
3. Geplante Tour verlassen: Die Neuberechnung geht über einen Punkt der geplanten Strecke (Durchfahrtspunkt) –
   bei einer gewöhnlichen Navigation nicht."""
import json
import sys
import time
from common import Browser

CALL = "const [method, args] = arguments; const id = (window.__carId = (window.__carId ?? 0) + 1); window.wmapCar.call(id, method, args); return id;"
REPLY = "return JSON.stringify((window.__carOut ?? []).find((e) => e.type === 'reply' && e.data.id === arguments[0])?.data ?? null)"

def call(b, method, *args, seconds=60):
    i = b.js(CALL, method, list(args))
    for _ in range(seconds * 4):
        r = json.loads(b.js(REPLY, i))
        if r:
            if not r['ok']:
                print(f'  {method}: FEHLER {r["error"]}')
            return r.get('value')
        time.sleep(.25)
    print(f'  {method}: keine Antwort')
    return None

ok = True
def check(name, value, good):
    global ok
    ok = ok and bool(good)
    print(f"{name}: {value}{'' if good else '  ← FALSCH'}")

FAKE = "window.WMapAndroid = { carConnected: () => window.__carOn !== false, carSend: (j) => { (window.__sent ??= []).push(JSON.parse(j)); return 'sent'; } };"
GOE, HMU = [9.9355, 51.5335], [9.6500, 51.4180]

errors = []
with Browser(width=412, height=915) as b:
    b.open(f'index.html?from={GOE[0]},{GOE[1]}&to={HMU[0]},{HMU[1]}&profile=car', wait=3)
    if not b.js('return !!window.WMapAndroid'):
        # Firefox: vor dem Laden geht es nicht – nachträglich setzen und das Ereignis melden
        b.js(FAKE + " dispatchEvent(new CustomEvent('wmap:car', { detail: true }));")
    b.wait("return window.__wmap?.state.routes.length > 0", 60)
    b.js("dispatchEvent(new CustomEvent('wmap:car', { detail: true }))")
    # Über window.__wmap – ein eigener Import von core.js legte eine zweite Karte samt leerem Zustand an
    r = b.d.execute_async_script("""const done = arguments[0]; (async () => {
      const { state } = window.__wmap;
      const alt = state.routes.at(-1);
      document.querySelector(`.route-opt[data-id="${alt.id}"]`).click();
      await new Promise((r) => setTimeout(r, 500));
      const btn = document.querySelector('.send-car');
      const shown = !btn.hidden;
      btn.click();
      window.__carOn = false;
      dispatchEvent(new CustomEvent('wmap:car', { detail: false }));
      await new Promise((r) => setTimeout(r, 200));
      return { routes: state.routes.map((x) => [x.id, Math.round(x.length), Math.round(x.time)]), chosen: alt.id, selected: state.selected, shown, hiddenWithoutCar: btn.hidden, sent: window.__sent?.[0] ?? null };
    })().then(done, (e) => done(String(e)))""")
    sent = r['sent'] if isinstance(r, dict) else None
    check('Routenplanung: Knopf nur mit Auto, sendet die Route mit der gewählten Alternative', r if not sent else {k: r[k] for k in ('routes', 'chosen', 'selected', 'shown', 'hiddenWithoutCar')},
          sent and r['shown'] and r['hiddenWithoutCar'] and r['selected'] == r['chosen'] and sent['type'] == 'route' and len(sent['waypoints']) == 2 and sent['waypoints'][1]['point'] == HMU
          and round(sent['length']) == next(x[1] for x in r['routes'] if x[0] == r['chosen']))
    errors += b.errors

with Browser(width=800, height=480) as b:
    b.open('index.html?car&view=9.9355,51.5335,15.5', wait=6)
    b.wait("return (window.__carOut ?? []).some((e) => e.type === 'ready')", 30)
    b.js("window.__wmap.state.position = [9.9355, 51.5335]")
    if sent:
        v = call(b, 'shared', json.dumps(sent), seconds=90)
        pick = next((x for x in (v or {}).get('routes', []) if x['id'] == v.get('selected')), None)
        near = pick and abs(pick['length'] - sent['length']) <= min(abs(x['length'] - sent['length']) for x in v['routes']) + 1
        check('Auto: gesendete Route – dieselbe Alternative gewählt', v and {'routes': [[x['id'], round(x['length'])] for x in v['routes']], 'selected': v.get('selected'), 'title': v.get('title')}, v and near)
    time.sleep(1)
    v = call(b, 'shared', json.dumps({'type': 'place', 'point': HMU, 'label': 'Hann. Münden', 'poi': False}), seconds=90)
    check('Auto: gesendeter Ort – Routenübersicht dorthin', v and {'title': v.get('title'), 'routes': len(v.get('routes', []))}, v and v.get('title') == 'Hann. Münden' and len(v['routes']) >= 1)
    # Zurückführen: die Neuberechnung einer Tour geht über einen Punkt der geplanten Strecke
    r = b.d.execute_async_script("""const done = arguments[0]; (async () => {
      const { nearestOnLine } = await import('./js/core/geo.js');
      const { state, nav } = window.__wmap;
      const route = state.routes.find((x) => x.id === state.selected);
      const out = {};
      const real = window.fetch;
      // Standort der Navigation von hier: die Meldungen des Browsers abfangen
      Geolocation.prototype.watchPosition = function (ok) { window.__feed = ok; return 1; };
      Geolocation.prototype.clearWatch = function () {};
      for (const follow of [true, false]) {
        let seen = null;
        window.fetch = (url, o) => { try { const j = JSON.parse(o?.body ?? 'null'); if (j?.locations) seen = j.locations; } catch { /* anderes */ } return real(url, o); };
        nav.start(route, { profile: 'car', highways: true, targets: [route.coords.at(-1)], follow });
        // 400 m neben der Strecke, ein Stück nach dem Start
        const at = route.coords[Math.min(route.coords.length - 1, 40)];
        const off = [at[0] + 0.006, at[1]];
        for (let i = 0; i < 8 && !seen; i += 1) { window.__feed?.({ coords: { longitude: off[0], latitude: off[1], accuracy: 5, speed: 10, heading: 0 }, timestamp: Date.now() }); await new Promise((r) => setTimeout(r, 700)); }
        for (let i = 0; i < 20 && !seen; i += 1) await new Promise((r) => setTimeout(r, 300));
        out[follow ? 'tour' : 'normal'] = seen ? seen.map((l) => [l.type, Math.round(nearestOnLine(route.coords, route.cum, [l.lon, l.lat]).offset)]) : null;
        nav.stop();
        await new Promise((r) => setTimeout(r, 11000));
      }
      window.fetch = real;
      return out;
    })().then(done, (e) => done(String(e)))""")
    print('Neuberechnung (Art des Punkts, Abstand zur geplanten Strecke in m):', r)
    t, n = (r.get('tour'), r.get('normal')) if isinstance(r, dict) else (None, None)
    check('Tour: über einen Durchfahrtspunkt auf der geplanten Strecke', t, t and len(t) == 3 and t[1][0] == 'through' and t[1][1] < 5)
    check('gewöhnliche Navigation: direkt zum Ziel', n, n and len(n) == 2 and all(x[0] == 'break' for x in n))
    errors += b.errors

print('keine JS-Fehler' if not errors else errors)
sys.exit(0 if ok and not errors else 1)
