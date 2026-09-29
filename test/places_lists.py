"""Lesezeichen in Listen: Suche (leer nur Zuhause/Arbeit, getippt passende Lesezeichen), Orte-Reiter, Liste teilen und übernehmen."""
import sys
import time
from common import Browser

with Browser(width=420, height=900) as b:
    b.open('index.html', wait=2)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] }))")
    b.open('index.html', wait=4)
    b.d.execute_async_script("""const done = arguments[0]; (async () => {
      const { places } = await import('./js/data/saved.js');
      places.save({ kind: 'home', name: 'Zuhause', label: 'Lange Str. 1', point: [9.93, 51.53] });
      places.save({ kind: 'fav', name: 'Oma', label: 'Kirchweg 3', point: [9.95, 51.54] });
      places.save({ kind: 'fav', name: 'Maschsee', label: 'Hannover', point: [9.745, 52.355], list: 'Hannover Urlaub' });
      places.save({ kind: 'fav', name: 'Herrenhäuser Gärten', label: 'Hannover', point: [9.698, 52.391], list: 'Hannover Urlaub' });
    })().then(done)""")
    q = b.css('#q')
    q.click()
    time.sleep(1)
    print('leere Suche:', b.js("return [...document.querySelectorAll('#suggest li')].slice(0, 4).map(l => l.innerText.replace(/\\s+/g, ' '))"))
    q.send_keys('masch')
    b.wait("return [...document.querySelectorAll('#suggest li')].some(l => /Maschsee/.test(l.innerText))", 15)
    print('„masch“:', b.js("return [...document.querySelectorAll('#suggest li')].slice(0, 4).map(l => l.innerText.replace(/\\s+/g, ' '))"))
    b.open('wege.html?tab=orte', wait=4)
    print('Orte:', b.js("return [...document.querySelectorAll('.wege-year summary')].map(s => s.innerText.replace(/\\s+/g, ' '))"))
    # Liste als Link – wie beim Teilen
    code = b.d.execute_async_script("""const done = arguments[0]; (async () => {
      const { packJson } = await import('./js/data/store.js');
      return packJson({ n: 'Harz', p: [[10.61, 51.80, 'Brocken', 'Gipfel'], [10.56, 51.84, 'Torfhaus', '']] });
    })().then(done)""")
    b.open(f'wege.html?liste={code}', wait=4)
    print('geteilt:', b.js("return document.querySelector('.orte-shared p')?.innerText.replace(/\\s+/g, ' ')"))
    b.shot('orte')
    b.js("document.querySelector('[data-list-take]').click()")
    time.sleep(1)
    print('übernommen:', b.js("return [...document.querySelectorAll('.wege-year summary')].map(s => s.innerText.replace(/\\s+/g, ' '))"))
    sys.exit(b.report())
