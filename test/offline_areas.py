"""Offline-Karten: Größe schätzen, freie Form laden, Kachel ohne Kartenversion finden, Dashboard, löschen."""
import sys
import time
from selenium.webdriver.common.action_chains import ActionChains
from common import Browser

with Browser() as b:
    b.open('offline.html', 4)
    b.js("__wmap.map.jumpTo({ center: [9.935, 51.533], zoom: 12 })")
    time.sleep(2)
    b.css('[data-act=new]').click()
    print('Schätzung Rechteck:', b.wait("const t = document.querySelector('.area-estimate').textContent; return t.includes('MB') && t.trim()"))
    print('Name:', b.wait("return document.querySelector('[name=name]').value"))
    b.css('[data-shape=free]').click()
    canvas = b.css('#map canvas')
    for dx, dy in [(100, -150), (350, -100), (380, 150), (150, 200)]:
        ActionChains(b.d).move_to_element_with_offset(canvas, dx, dy).click().perform()
        time.sleep(.3)
    print('Schätzung frei:', b.wait("const t = document.querySelector('.area-estimate').textContent; return t.includes('MB') && !t.includes('berechnet') && t.trim()"))
    b.shot('area-free')
    b.css('[data-act=save]').click()
    a = b.wait("const a = JSON.parse(localStorage.getItem('wmap.areas') || '[]')[0]; return a && a.status !== 'loading' && a", 180)
    print('Gebiet:', {k: a[k] for k in ('name', 'status', 'bytes', 'tiles')})
    print('Cache (Einträge, Kachel mit fremder Version → Status):', b.js("""return (async () => {
      const a = JSON.parse(localStorage.getItem('wmap.areas'))[0];
      const keys = (await (await caches.open(a.cache)).keys()).map((k) => k.url);
      const tile = keys.find((u) => u.includes('/planet/offline/14/'));
      const res = await fetch(tile.replace('/planet/offline/', '/planet/20990101_000000_pt/'));
      return [keys.length, res.status];
    })()"""))
    b.open('dashboard.html', 2)
    print('Dashboard:', b.js("return [...document.querySelectorAll('.dash-tile')].find((t) => t.textContent.includes('Offline-Karten'))?.querySelector('em')?.textContent"))
    b.open('offline.html', 3)
    b.css('.area [data-act=delete]').click()
    time.sleep(.5)
    b.css('dialog[open] button[value=yes]').click()
    time.sleep(1)
    print('nach Löschen:', b.js("return (async () => [localStorage.getItem('wmap.areas'), (await caches.keys()).filter((k) => k.startsWith('wmap-area-'))])()"))
    sys.exit(b.report())
