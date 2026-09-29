"""Freie Form: Punkt an der Kante einfügen, markieren + Entf, Doppeltipp löscht (ohne Zoom)."""
import sys
import time
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from common import Browser

with Browser() as b:
    pts = lambda: b.js("return [...document.querySelectorAll('.area-handle')].map((h) => { const r = h.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })")
    b.open('offline.html', 4)
    b.js("__wmap.map.jumpTo({ center: [9.935, 51.533], zoom: 12 })")
    time.sleep(1)
    b.css('[data-act=new]').click()
    b.css('[data-shape=free]').click()
    body = b.css('body')
    tap = lambda x, y: (ActionChains(b.d).move_to_element_with_offset(body, x - 650, y - 450).click().perform(), time.sleep(.4))
    for x, y in [(700, 250), (1000, 250), (1000, 550), (700, 550)]:
        tap(x, y)
    print('4 Punkte:', pts())
    tap(850, 240)
    print('eingefügt oben (2. Stelle):', pts())
    b.d.find_elements('css selector', '.area-handle')[1].click()
    time.sleep(.3)
    print('markiert:', b.js("return document.querySelectorAll('.area-handle.selected').length"))
    ActionChains(b.d).send_keys(Keys.DELETE).perform()
    time.sleep(.4)
    print('nach Entf:', pts())
    zoom = b.js("return __wmap.map.getZoom()")
    ActionChains(b.d).double_click(b.d.find_elements('css selector', '.area-handle')[2]).perform()
    time.sleep(.4)
    print('nach Doppeltipp:', pts(), '– Zoom gleich:', abs(b.js("return __wmap.map.getZoom()") - zoom) < .01)
    b.shot('freeform')
    sys.exit(b.report())
