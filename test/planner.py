"""Tourenplaner: Punkt-Menü (Rundweg, zum Start/Ziel machen), im Rundweg gleich viel hinauf wie hinunter, und Suche als Vorschau statt gleich anzuhängen."""
import sys
import time
from common import Browser

MENU = "return [...document.querySelectorAll('.maplibregl-popup .popup.context button')].map(b => b.innerText.replace(/^\\S+\\s/, '').trim())"
PTS = "return [...document.querySelectorAll('.wp-marker:not(.found)')].map(m => m.className.replace('wp-marker ', '').split(' ')[0] + (m.innerText.match(/\\d+/)?.[0] ?? ''))"

with Browser(width=1200, height=850) as b:
    b.open('tour.html', wait=4)
    b.js("window.__wmap.map.jumpTo({ center: [9.962, 51.530], zoom: 13.5 })")
    time.sleep(3)
    canvas = b.css('.maplibregl-canvas')
    from selenium.webdriver.common.action_chains import ActionChains
    for x, y in [(-150, -80), (0, -120), (150, -40)]:
        ActionChains(b.d).move_to_element_with_offset(canvas, x + 200, y).click().perform()
        time.sleep(1.2)
    print('Punkte:', b.js(PTS))
    b.js("document.querySelector('.wp-marker.start').click()")
    print('Menü Start:', b.js(MENU))
    b.js("[...document.querySelectorAll('.popup.context button')].find(x => /Rundweg/.test(x.innerText)).click()")
    time.sleep(1.5)
    print('Rundweg:', b.js(PTS))
    # Rundweg: gleich viel hinauf wie hinunter
    b.wait("return !document.querySelector('.tour-status').textContent && document.querySelector('.st-up').textContent !== '–'", 30)
    up, down = b.js("return [document.querySelector('.st-up').textContent, document.querySelector('.st-down').textContent]")
    print('Höhenmeter im Rundweg:', up, down)
    balanced = up == down and up not in ('–', '0 m')
    b.js("document.querySelectorAll('.wp-marker.via')[1].click()")
    print('Menü Punkt 2 im Rundweg:', b.js(MENU))
    # Lage eines Markers in Koordinaten (unabhängig davon, wohin die Karte schwenkt)
    AT = """const m = window.__wmap.map, c = m.getCanvas().getBoundingClientRect();
      const ll = (el) => { const r = el.getBoundingClientRect(); return m.unproject([r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y]).toArray().map((v) => +v.toFixed(4)); };
      return arguments[0] === 'via2' ? ll(document.querySelectorAll('.wp-marker.via')[1]) : [ll(document.querySelector('.wp-marker.start')), ll(document.querySelector('.wp-marker.dest'))];"""
    before = b.js(AT, 'via2')
    b.js("[...document.querySelectorAll('.popup.context button')].find(x => /starten und enden/.test(x.innerText)).click()")
    time.sleep(1.5)
    after = b.js(AT, 'ends')
    near = lambda a, c: abs(a[0] - c[0]) < 0.001 and abs(a[1] - c[1]) < 0.001   # Ziel-Nadel sitzt etwas anders
    print('Punkt 2 ist jetzt Start und Ziel:', near(after[0], before) and near(after[1], before), b.js(PTS))
    # Suche: erst Vorschau, nichts angehängt
    n0 = len(b.js(PTS))
    inp = b.css('#tour-search')
    inp.send_keys('Gänseliesel Göttingen')
    b.wait("return document.querySelector('.tour-search-results button')", 20)
    b.js("document.querySelector('.tour-search-results button').click()")
    time.sleep(2)
    print('Vorschau:', b.js("return !!document.querySelector('.wp-marker.found')"), '– Punkte unverändert:', len(b.js(PTS)) == n0)
    print('Menü Treffer:', b.js(MENU))
    b.shot('planer-treffer')
    b.js("[...document.querySelectorAll('.popup.context button')].find(x => /Einfügen|anhängen/.test(x.innerText))?.click()")
    time.sleep(1.5)
    print('Nach „Einfügen“ bzw. „Anhängen“:', len(b.js(PTS)) == n0 + 1, b.js(PTS))
    # Routing-Server am Limit (429) ist kein Fehler von WMap
    b.errors = [e for e in b.errors if 'valhalla' not in e[1]]
    if not balanced:
        print('FALSCH Rundweg: Anstieg und Abstieg verschieden')
        sys.exit(1)
    sys.exit(b.report())
