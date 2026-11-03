"""Zuhause und Arbeit auf der Karte (map/my-places.js).

1. Ohne Lesezeichen: Ebene da, nichts gezeichnet.
2. Zuhause (Göttingen, Gänseliesel) und Arbeit gemerkt → beide Abzeichen mit Namen auf der Karte,
   ein Lesezeichen „Allgemein“ (Stern) nicht.
3. Antippen öffnet den Ort: Titel „Zuhause“, Knopf „Gemerkt“.
4. Zuhause woanders hin und umbenannt → das Abzeichen zieht mit, ohne neu zu laden.
5. Dunkel: Schrift hell. Screenshots hell und dunkel.

Der Code läuft in der Seite (Skript-Element), nicht in Seleniums Sandbox: Ein import() dort lädt die App
ein zweites Mal – mit eigener Karte, deren Daten MapLibre nicht übergeben kann.
"""
import json
import sys
import time
from common import Browser

ok = True


def check(name, cond, info=''):
    global ok
    ok &= bool(cond)
    print('OK  ' if cond else 'FEHLER', name, info)


def page(b, body, seconds=40):
    """Modul-Code in der Seite; `return` liefert das Ergebnis (darf ein Promise sein)."""
    b.js("""window.__out = undefined; const s = document.createElement('script'); s.type = 'module';
      s.textContent = `const { map } = await import('./js/app/core.js'); const { places } = await import('./js/data/saved.js');
        try { window.__out = JSON.stringify(await (async () => { ${arguments[0]} })() ?? null); } catch (e) { window.__out = JSON.stringify('Fehler: ' + e); }`;
      document.head.append(s);""", body)
    v = b.wait("return window.__out !== undefined && window.__out", seconds)
    return json.loads(v) if v else None


READY = "await new Promise((ok) => { const t = () => map.getLayer('my-places') ? ok() : setTimeout(t, 200); t(); }); await new Promise((ok) => map.once('idle', ok)); return true"
DRAWN = """await new Promise((ok) => { map.triggerRepaint(); map.once('idle', ok); });
  return map.queryRenderedFeatures({ layers: ['my-places'] }).map((f) => [f.properties.kind, f.properties.name]).sort()"""
HOME = [9.9355, 51.5319]
WORK = [9.9385, 51.5327]
VIEW = "map.jumpTo({ center: [9.937, 51.5323], zoom: 16.5 });"

with Browser(1200, 850) as b:
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] })); localStorage.setItem('wmap.stats.asked', '1'); localStorage.removeItem('wmap.saved')")
    b.open('index.html', 3)
    check('1. Ebene da', page(b, VIEW + READY, 60))
    check('1. ohne Lesezeichen nichts gezeichnet', page(b, DRAWN) == [])

    page(b, f"""places.save({{ kind: 'home', name: 'Zuhause', label: 'Gänseliesel', point: {HOME} }});
      places.save({{ kind: 'work', name: 'Arbeit', label: 'Rathaus', point: {WORK} }});
      places.save({{ kind: 'fav', name: 'Bäcker', point: [9.9365, 51.5315] }}); return true""")
    r = page(b, DRAWN)
    check('2. Zuhause und Arbeit gezeichnet, Stern nicht', r == [['home', 'Zuhause'], ['work', 'Arbeit']], r)
    b.shot('my_places_hell')

    # 3. Antippen
    xy = page(b, f"const p = map.project({HOME}); return [p.x, p.y]")
    b.js("""const c = document.querySelector('#map canvas'); const r = c.getBoundingClientRect();
      const o = { bubbles: true, clientX: r.left + arguments[0], clientY: r.top + arguments[1], button: 0 };
      for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, o));""", xy[0], xy[1])
    shown = b.wait("""const v = document.querySelector('[data-view=place]'); return !v.hidden && [v.querySelector('.place-title').textContent,
      [...v.querySelectorAll('.actions button')].map((x) => x.textContent.trim())]""", 10)
    check('3. Antippen öffnet Zuhause', shown and shown[0] == 'Zuhause', shown)
    check('3. … als gemerkt', shown and any('Gemerkt' in t for t in shown[1]), shown and shown[1])

    # 4. Verlegen und umbenennen
    page(b, "places.save({ kind: 'home', name: 'Bei Oma', label: 'Wilhelmsplatz', point: [9.9375, 51.5335] }); return true")
    r = page(b, DRAWN)
    check('4. Zuhause umbenannt, ohne neu laden', r == [['home', 'Bei Oma'], ['work', 'Arbeit']], r)
    at = page(b, "return map.querySourceFeatures('my-places').find((f) => f.properties.kind === 'home')?.geometry.coordinates.map((v) => +v.toFixed(4))")
    check('4. … und verlegt', at == [9.9375, 51.5335], at)

    # 5. Dunkel
    b.theme('dark')
    b.open('index.html', 3)
    page(b, VIEW + READY, 60)
    color = page(b, "return map.getPaintProperty('my-places', 'text-color')")
    check('5. dunkel: helle Schrift', color == '#e8eaed', color)
    b.shot('my_places_dunkel')
    b.theme('light')

    rc = b.report()
    sys.exit(0 if ok and rc == 0 else 1)
