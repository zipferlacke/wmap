"""Street View (js/map/street.js) in der Fußgängerzone von Göttingen (Weender Straße):
1. ?action=street: Kamera auf Augenhöhe (Blick 82°, Zoom über 20), Boden als Modell (Straßen in Metern, kein Luftbild,
   Pflaster ohne Muster), Hinweis unten,
   oben die Straße, auf der man steht – Beschriftungen der Karte aus,
   Suche und Knöpfe weg; die Grundkarte wird nicht gespeichert.
2. W hält 3 s: etwa 1,6 m/s in Blickrichtung; Q dreht nach links. Klick ins Bild fängt die Maus, 100 px nach rechts
   drehen den Blick 15° nach rechts – ohne dass etwas auf der Karte aufgeht.
3. Ein Finger zieht 100 px nach rechts: der Blick dreht nach links, doppelt so weit wie 100 px des Bildes breit sind;
   nach unten ziehen: Blick hebt sich (auch
   über den Horizont, bis 60° in den Himmel).
4. Zwei Finger auseinander (100 → 200 px): etwa 14 m vor; zusammen: zurück.
5. Doppelt tippen auf die Straße vorn: man geht hin (bleibt 1,5 m davor stehen).
6. Esc: zurück zur Karte über dem Punkt, an dem man stand – Karte wie vorher, Muster und Bedienung wieder da.
7. „Umsehen“ an einem Ort startet Street View dort; der Knopf „Karte“ beendet.
8. „Teilen“: Link ?street=lon,lat,richtung,blick – geöffnet steht man genau so da.
9. Nicht in Häuser: 12 s quer zur Straße auf die Häuserzeile zu – man bleibt davor stehen.
10. Im Ebenen-Menü vorerst keine Street-View-Kachel (nur Karte und Satellit); Start über das Menü-Ereignis.
11. Geradeaus (Blick genau 90°) 30 s die Weender Straße hoch: Kacheln und Häuser kommen weiter nach, kein Fehler
    (MapLibre hielt die Kamera ab 90° für am Startpunkt und teilte Kacheln bis Zoom 26).
12. Geschäfte (map/street-shops.js): Namen an den Fassaden der Weender Straße, ihr Haus mit farbigem Erdgeschoss;
    auf eins schauen öffnet nach 0,8 s seinen Dialog, wegschauen schließt ihn. Bushaltestelle Jüdenstraße: Schild."""
import json
import math
import sys
import time
from common import Browser
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

LOADED = "window.__done=false;const m=window.__wmap.map;const f=()=>{if(m.areTilesLoaded()&&m.loaded())window.__done=true;else setTimeout(f,500)};setTimeout(f,1000)"
STATE = """const m=window.__wmap.map;const s=m.wmapStreet;const w=s.where;
return {on:s.active,cls:document.body.classList.contains('street-view'),where:w,pitch:+m.getPitch().toFixed(1),zoom:+m.getZoom().toFixed(2),
  sat:m.getLayoutProperty('sat-s2','visibility')??'none',pattern:m.getLayer('road_area_pattern')?(m.getLayoutProperty('road_area_pattern','visibility')??'visible')!=='none'&&!!m.getPaintProperty('road_area_pattern','fill-pattern'):'fehlt',
  model:Array.isArray(m.getPaintProperty('road_minor','line-width'))&&m.getPaintProperty('road_minor','line-width')[0]==='interpolate'&&JSON.stringify(m.getPaintProperty('road_minor','line-width')).includes('minor'),
  hud:!!document.querySelector('.street-hud'),search:getComputedStyle(document.querySelector('#search')).display!=='none',drag:m.dragPan.isEnabled(),maxPitch:m.getMaxPitch(),
  saved:JSON.parse(localStorage.getItem('wmap.layers')||'{}').base??'map',center:m.getCenter().toArray()}"""
# Zeiger-Ereignisse auf der Karte nachbilden (Finger): [[id, x, y], …] je Schritt
POINTERS = """const [type, list] = arguments; const el = window.__wmap.map.getCanvasContainer(); const r = el.getBoundingClientRect();
for (const [id, x, y] of list) el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0 }));"""


def meters(a, b):
    k = 111320
    return math.hypot((b[0] - a[0]) * k * math.cos(math.radians(a[1])), (b[1] - a[1]) * k)


def bearing(a, b):
    k = math.cos(math.radians(a[1]))
    return (math.degrees(math.atan2((b[0] - a[0]) * k, b[1] - a[1])) + 360) % 360


# Overpass (Haltestellen, Mauern, Bäume für Street View) ersetzt – die öffentlichen Server fallen oft aus; geprüft wird
# hier das Verhalten, nicht ihre Daten
NO_OVERPASS = """() => { const own = window.fetch; window.fetch = (url, opts) => String(url).includes('/interpreter')
  ? (window.__ovp = (window.__ovp ?? []).concat(String(opts?.body ?? ''))) && Promise.resolve(new Response('{"elements":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : own(url, opts); }"""

with Browser(412, 900) as b:
    b.d.script.add_preload_script(NO_OVERPASS)
    checks = {}

    def settle():
        b.js(LOADED)
        b.wait('return window.__done', 40)
        time.sleep(1)

    def st():
        return b.js(STATE)

    def fingers(type, *pts):
        b.js(POINTERS, type, [list(p) for p in pts])

    b.open('index.html?view=9.9353,51.5340,18,60,355&action=street', 4)
    settle()
    s0 = st()
    print('Start:', json.dumps(s0, ensure_ascii=False))
    checks['1. Augenhöhe: Blick 82°, Zoom über 20, Modell-Boden, Muster aus, Hinweis, Suche weg'] = (
        s0['on'] and s0['cls'] and s0['pitch'] == 82 and s0['zoom'] > 20 and s0['sat'] == 'none' and s0['model']
        and s0['pattern'] is False and s0['hud'] and not s0['search'] and not s0['drag'])
    checks['1. Grundkarte nicht gespeichert'] = s0['saved'] == 'map'
    b.shot('street_start')
    time.sleep(1)
    top = b.js("return [document.querySelector('.street-top')?.innerText, window.__wmap.map.getStyle().layers.filter((l)=>l.type==='symbol'&&window.__wmap.map.getLayoutProperty(l.id,'visibility')!=='none').length]")
    print('oben:', top)
    checks['1. Oben die Straße (Weender Straße), Beschriftungen der Karte aus'] = bool(top[0]) and 'Weender' in top[0] and top[1] == 0

    # 2. Tasten
    p0 = s0['where']['point']
    ActionChains(b.d).key_down('w').pause(3).key_up('w').perform()
    time.sleep(.5)
    s1 = st()
    d, dirn = meters(p0, s1['where']['point']), bearing(p0, s1['where']['point'])
    print(f'W 3 s: {d:.1f} m Richtung {dirn:.0f}° (Blick {s0["where"]["bearing"]:.0f}°)')
    checks['2. W: etwa 1,6 m/s in Blickrichtung'] = 3.5 < d < 6.5 and abs(((dirn - s0['where']['bearing']) + 540) % 360 - 180) < 5
    b.shot('street_w')
    ActionChains(b.d).key_down('q').pause(1).key_up('q').perform()
    time.sleep(.3)
    s2 = st()
    turned = s2['where']['bearing'] - s1['where']['bearing']
    print(f'Q 1 s: {turned:.0f}°')
    checks['2. Q dreht nach links'] = -90 < turned < -40
    # Maus fangen (echter Klick) und bewegen
    canvas = b.d.find_element('css selector', '.maplibregl-canvas')
    # Was offen ist (schaut man auf ein Geschäft, geht dessen Dialog von selbst auf) – der Klick darf nichts ändern
    PLACE = "return (document.querySelector('[data-view=place]')?.hidden ?? true) ? '' : document.querySelector('[data-view=place] .place-title').textContent"
    before = b.js(PLACE)
    ActionChains(b.d).move_to_element(canvas).click().perform()
    time.sleep(.5)
    lock = b.js("return [document.pointerLockElement?.className ?? null, document.body.classList.contains('street-locked'), document.querySelector('.street-hint').innerText]") + [b.js(PLACE) == before]
    print('Maus gefangen:', lock)
    b0 = st()['where']['bearing']
    b.js("document.dispatchEvent(new MouseEvent('mousemove', { movementX: 100, movementY: 0, bubbles: true }))")
    time.sleep(.4)
    b1 = st()['where']['bearing']
    print(f'Maus 100 px nach rechts: {b1 - b0:.1f}°')
    checks['2. Klick fängt die Maus, Hinweis „Maus umsehen“, nichts aufgegangen'] = bool(lock[0]) and lock[1] and 'Maus' in lock[2] and lock[3]
    checks['2. Gefangene Maus 100 px nach rechts: Blick 15° nach rechts'] = abs(b1 - b0 - 15) < 0.5
    b.js("document.exitPointerLock()")
    time.sleep(.3)
    s2 = st()

    # 3. Ein Finger ziehen
    fingers('pointerdown', (1, 200, 400))
    for x in range(210, 310, 10):
        fingers('pointermove', (1, x, 400))
    fingers('pointerup', (1, 300, 400))
    s3 = st()
    turned = s3['where']['bearing'] - s2['where']['bearing']
    print(f'Wischen 100 px nach rechts: {turned:.0f}°')
    view = b.js("const r=window.__wmap.map.getCanvas().getBoundingClientRect();const a=2*Math.atan(Math.tan(Math.PI/6)*r.width/r.height)*180/Math.PI;return [a/r.width*100, 60/r.height*50]")
    print(f'erwartet: {view[0]:.1f}° beim Wischen, {view[1]:.1f}° nach unten')
    checks['3. Wischen nach rechts: Blick nach links, doppelt so weit wie 100 px Bild'] = abs(turned + 2 * view[0]) < 0.5
    fingers('pointerdown', (1, 200, 300))
    for y in range(310, 360, 10):
        fingers('pointermove', (1, 200, y))
    fingers('pointerup', (1, 200, 350))
    s3b = st()
    print('Wischen nach unten: Blick', s3['where']['look'], '→', s3b['where']['look'])
    checks['3. Wischen 50 px nach unten: Blick hebt sich um 50 px Bild'] = abs(s3b['where']['look'] - s3['where']['look'] - view[1]) < 0.5
    b.shot('street_look')

    # 4. Zwei Finger – längs der Weender Straße (quer stünde nach 8 m die Häuserzeile im Weg)
    b.js("const s=window.__wmap.map.wmapStreet;const w=s.where;s.stop();s.start({point:w.point,bearing:355,look:82})")
    time.sleep(.5)
    s3b = st()
    p = s3b['where']['point']
    fingers('pointerdown', (1, 150, 450), (2, 250, 450))
    for k in range(1, 11):
        fingers('pointermove', (1, 150 - 5 * k, 450), (2, 250 + 5 * k, 450))
    fingers('pointerup', (1, 100, 450), (2, 300, 450))
    time.sleep(1.5)
    s4 = st()
    fwd = meters(p, s4['where']['point'])
    print(f'Zwei Finger auseinander: {fwd:.1f} m')
    checks['4. Zwei Finger auseinander: etwa 14 m vor'] = 12 < fwd < 16
    p = s4['where']['point']
    fingers('pointerdown', (1, 100, 450), (2, 300, 450))
    for k in range(1, 11):
        fingers('pointermove', (1, 100 + 5 * k, 450), (2, 300 - 5 * k, 450))
    fingers('pointerup', (1, 150, 450), (2, 250, 450))
    time.sleep(1.5)
    s5 = st()
    back = bearing(p, s5['where']['point'])
    print(f'Zusammen: {meters(p, s5["where"]["point"]):.1f} m Richtung {back:.0f}° (Blick {s5["where"]["bearing"] % 360:.0f}°)')
    checks['4. Zwei Finger zusammen: zurück'] = 12 < meters(p, s5['where']['point']) < 16 and abs(((back - s5['where']['bearing'] - 180) + 540) % 360 - 180) < 5

    # 5. Doppelt tippen
    p = s5['where']['point']
    # Beide Tipps direkt hintereinander – ohne Fenster ist der Browser so beschäftigt, dass zwei Aufrufe oder ein
    # setTimeout oft über 350 ms auseinander liegen
    b.js(POINTERS.replace('const [type, list] = arguments;', "const tap = (type) => { const list = [[1, 206, 560]];") + "}; tap('pointerdown'); tap('pointerup'); tap('pointerdown'); tap('pointerup');")
    time.sleep(4)
    s6 = st()
    went = meters(p, s6['where']['point'])
    print(f'Doppelt getippt: {went:.1f} m')
    checks['5. Doppelt tippen: hingegangen'] = 2 < went < 12
    b.shot('street_tap')

    # 6. Esc
    stood = s6['where']['point']
    ActionChains(b.d).send_keys('').perform()
    time.sleep(1)
    settle()
    s7 = st()
    print('Esc:', json.dumps(s7, ensure_ascii=False))
    checks['6. Esc: Karte über dem Standpunkt, Karte wie vorher, Bedienung wieder da'] = (
        not s7['on'] and not s7['cls'] and s7['sat'] == 'none' and not s7['model'] and s7['drag']
        and s7['search'] and s7['maxPitch'] == 85 and not s7['hud'] and meters(stood, s7['center']) < 1)
    b.shot('street_end')

    # 7. „Umsehen“ an einem Ort, „Karte“ beendet
    b.js("const m=window.__wmap.map;m.fire('contextmenu',{lngLat:new maplibregl.LngLat(9.9349,51.5343),point:m.project([9.9349,51.5343]),originalEvent:new MouseEvent('contextmenu')})")
    time.sleep(1.5)
    btn = b.js("return [...document.querySelectorAll('[data-view=place] .actions button')].map((x)=>x.innerText.trim())")
    print('Knöpfe am Ort:', btn)
    b.js("[...document.querySelectorAll('[data-view=place] .actions button')].find((x)=>x.innerText.includes('Umsehen'))?.click()")
    time.sleep(1)
    s8 = st()
    checks['7. „Umsehen“ startet am Ort'] = s8['on'] and meters([9.9349, 51.5343], s8['where']['point']) < 0.5
    share = b.js("const w=window.__wmap.map.wmapStreet.where;return import('./js/ui/share.js').then((m)=>[!!document.querySelector('.street-hud [data-s=share]'),m.streetUrl({point:[9.93512,51.53455],bearing:-30,look:79.5})])")
    print('Teilen:', share)
    checks['8. Knopf „Teilen“ da, Link ?street=9.93512,51.53455,330,79.5'] = share[0] and share[1].endswith('index.html?street=9.93512,51.53455,330,79.5')
    b.js("document.querySelector('.street-hud [data-s=close]').click()")
    time.sleep(.5)
    checks['7. Knopf „Karte“ beendet'] = not st()['on']

    # 7. „Umsehen“ an einem Punkt im Haus (Geschäft): auf den Weg davor, Blick aufs Haus
    house = b.js("""const m=window.__wmap.map, B=m.wmapBuildings, c=m.getCenter().toArray();
      for (const f of m.querySourceFeatures('openmaptiles',{sourceLayer:'building'})) { if (f.geometry.type!=='Polygon') continue;
        const r=f.geometry.coordinates[0], p=[r.reduce((a,q)=>a+q[0],0)/r.length, r.reduce((a,q)=>a+q[1],0)/r.length];
        if (Math.abs(p[0]-c[0])<0.001 && Math.abs(p[1]-c[1])<0.0007 && B.inside(p)) return p; } return null""")
    print('Punkt im Haus:', house)
    b.js("dispatchEvent(new CustomEvent('wmap:street', { detail: arguments[0] }))", house)
    time.sleep(1)
    s7b = st()
    w = s7b['where'] or {}
    out = b.js("return !window.__wmap.map.wmapBuildings.inside(arguments[0])", w.get('point'))
    dx, dy = (house[0] - w['point'][0]) * 111320 * math.cos(math.radians(house[1])), (house[1] - w['point'][1]) * 111320
    toward = abs(((math.degrees(math.atan2(dx, dy)) - w['bearing']) + 540) % 360 - 180) < 2
    print('Umsehen im Haus:', w, 'draußen', out, 'Abstand', round(meters(house, w['point']), 1), 'Blick aufs Haus', toward)
    checks['7. „Umsehen“ im Haus: auf dem Weg davor, Blick aufs Haus'] = bool(house) and s7b['on'] and out and meters(house, w['point']) < 80 and toward
    b.js("document.querySelector('.street-hud [data-s=close]').click()")
    time.sleep(.5)

    # 8. Geteilten Link öffnen
    b.open('index.html?street=9.93512,51.53455,330,79.5', 4)
    settle()
    s9 = st()
    print('Geteilt geöffnet:', s9['where'])
    w = s9['where'] or {}
    checks['8. Geteilter Link: Standpunkt, Richtung 330°, Blick 79,5°'] = s9['on'] and meters([9.93512, 51.53455], w.get('point', [0, 0])) < 0.5 and abs(w.get('bearing', 0) % 360 - 330) < 0.5 and abs(w.get('look', 0) - 79.5) < 0.1
    b.shot('street_shared')

    # 9. Gegen die Häuser: quer zur Weender Straße nach Westen
    b.open('index.html?street=9.93512,51.53455,270,82', 4)
    settle()
    p = st()['where']['point']
    ActionChains(b.d).key_down(Keys.SHIFT).key_down('w').pause(12).key_up('w').key_up(Keys.SHIFT).perform()
    time.sleep(.5)
    s10 = st()
    q = s10['where']['point']
    inside = b.js("return window.__wmap.map.wmapBuildings.inside(arguments[0])", q)
    print(f'12 s auf die Häuser zu: {meters(p, q):.1f} m, im Haus: {inside}')
    checks['9. Nicht ins Haus: vor der Wand stehen geblieben'] = not inside and 1 < meters(p, q) < 40
    b.shot('street_wall')
    b.js("document.querySelector('.street-hud [data-s=close]').click()")
    time.sleep(.5)

    # 10. Kachel im Ebenen-Menü
    b.js("document.querySelector('.layer-ctrl button').click()")
    time.sleep(.8)
    tiles = b.js("return [...document.querySelectorAll('.layer-bases button')].map((x)=>x.innerText.trim())")
    print('Kacheln:', tiles)
    checks['10. Keine Street-View-Kachel im Ebenen-Menü'] = tiles == ['Karte', 'Satellit']
    b.js("document.querySelector('.layer-ctrl button').click(); dispatchEvent(new CustomEvent('wmap:street'))")
    time.sleep(.8)
    checks['10. Menü-Ereignis startet Street View'] = st()['on']
    b.shot('street_tile')

    # 11. Geradeaus (90°) die Weender Straße hoch
    b.open('index.html?street=9.93512,51.53455,355,90', 4)
    settle()
    p = st()['where']['point']
    ActionChains(b.d).key_down(Keys.SHIFT).key_down('w').pause(30).key_up('w').key_up(Keys.SHIFT).perform()
    time.sleep(4)
    q = st()['where']['point']
    # Häuser im Umkreis von 60 m um den neuen Standpunkt sind geladen
    seen = b.js("""const m=window.__wmap.map;const [lon,lat]=arguments[0];const k=Math.cos(lat*Math.PI/180);
      return m.querySourceFeatures('openmaptiles',{sourceLayer:'building'}).filter((f)=>{const c=f.geometry.coordinates.flat(3);
        for(let i=0;i<c.length;i+=2)if(Math.hypot((c[i]-lon)*k,c[i+1]-lat)*111320<60)return true;return false}).length""", q)
    print(f'30 s geradeaus: {meters(p, q):.0f} m, Häuser im Umkreis von 60 m: {seen}')
    checks['11. Geradeaus über 120 m: Kacheln kommen nach, kein Fehler'] = meters(p, q) > 120 and seen > 0
    b.shot('street_far')

    # 12. Geschäfte: Namen, Dialog beim Hinschauen, Wartehäuschen
    b.open('index.html?street=9.93530,51.53400,0,86', 4)
    settle()
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => { if (d.id !== 'sheet') d.close(); })")
    names = b.js("return [...document.querySelectorAll('.street-label:not([hidden])')].map((e) => e.textContent)")
    print('Namen an Fassaden:', names[:8])
    checks['12. Namen der Geschäfte an den Fassaden'] = len(names) >= 3
    walls = b.js("return [...document.querySelectorAll('.street-label.on-wall:not([hidden])')].map((e) => [e.textContent, e.style.transform.slice(0, 40)])")
    print('An der Wand:', len(walls), walls[:3])
    checks['12. Nahe Namen kleben als Schild an der Wand (perspektivisch)'] = len(walls) >= 2 and all(t.startswith('matrix3d(') for _, t in walls)
    b.shot('street_schilder')
    near = b.js("""const w = window.__wmap.map.wmapStreet.where; const k = Math.cos(w.point[1] * Math.PI / 180);
      const l = [...document.querySelectorAll('.street-label:not([hidden])')].map((e) => { const [n, x, y] = e.dataset.shop.split('|');
        const dx = (x - w.point[0]) * 111320 * k, dy = (y - w.point[1]) * 111320; return [n, Math.atan2(dx, dy) * 180 / Math.PI, Math.hypot(dx, dy)]; });
      return l.filter((x) => x[2] < 30).sort((a, b) => a[2] - b[2])[0]""")
    print('Hinschauen auf:', near)
    b.js("const m = window.__wmap.map; const w = m.wmapStreet.where; m.wmapStreet.stop(); m.wmapStreet.start({ point: w.point, bearing: arguments[0], look: 88 });", near[1])
    opened = b.wait("const s = document.querySelector('#sheet'); return s.open && s.dataset.current === 'place' && document.querySelector('[data-view=place] .place-title').textContent", 10)
    print('Dialog:', opened)
    b.shot('street_shop')
    b.js("const m = window.__wmap.map; const w = m.wmapStreet.where; m.wmapStreet.stop(); m.wmapStreet.start({ point: w.point, bearing: arguments[0] + 120, look: 88 });", near[1])
    closed = b.wait("return !document.querySelector('#sheet').open", 10)
    checks['12. Hinschauen öffnet den Dialog, wegschauen schließt ihn'] = bool(opened) and bool(closed)
    b.open('index.html?street=9.93687,51.53365,180,84', 4)
    settle()
    b.shot('street_stop')
    stops = b.js("return window.__wmap.map.wmapBuildings.thingCount()")
    print('Haltestellen usw.:', stops)
    stop_btn = b.js("const e = document.querySelector('.street-label.stop'); if (!e) return null; const t = e.textContent; e.click(); return t")
    stop_dlg = stop_btn and b.wait("const s = document.querySelector('#sheet'); return s.open && s.dataset.current === 'place' && document.querySelector('[data-view=place] .place-title').textContent", 10)
    print('Haltestellen-Knopf:', stop_btn, '→ Dialog:', stop_dlg)
    checks['12. Haltestelle als Knopf über dem Schild, Klick öffnet ihren Dialog'] = bool(stop_btn) and bool(stop_dlg) and stop_dlg in stop_btn
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    checks['12. Haltestellen aus den Kacheln (Häuschen, wo ein Unterstand danebensteht)'] = stops['stops'] > 0
    asked = b.js("return (window.__ovp ?? []).map((q) => decodeURIComponent(q))")
    print('Overpass gefragt:', len(asked), 'mal')
    checks['12. Overpass nur für Mauern, Dächer, Bäume – je Feld (181 m Weg, Neuladen), höchstens 8'] = 0 < len(asked) <= 8 \
        and all('bus_stop' not in q and 'around' not in q for q in asked)

    # 13. 3D-Karte: nah dran Haltestellen mit Schild wie in Street View (ohne Overpass), weiter weg keine
    b.js("const m = window.__wmap.map; m.wmapStreet.active && m.wmapStreet.stop(); m.jumpTo({ center: [9.93530, 51.53400], zoom: 17.6, pitch: 60, bearing: 0 })")
    time.sleep(1); settle(); time.sleep(2)
    close = b.js("return window.__wmap.map.wmapBuildings.thingCount().mapStops")
    b.shot('karte_haltestellen')
    b.js("window.__wmap.map.jumpTo({ zoom: 16 })")
    time.sleep(1); settle(); time.sleep(1)
    farther = b.js("return window.__wmap.map.wmapBuildings.thingCount().mapStops")
    print('3D-Karte Haltestellen: Zoom 17,6:', close, ' Zoom 16:', farther)
    checks['13. 3D-Karte ab Zoom 17: Haltestellen mit Schild, darunter keine'] = close > 0 and farther == 0

    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    ok = not b.report() and all(checks.values())
    sys.exit(0 if ok else 1)
