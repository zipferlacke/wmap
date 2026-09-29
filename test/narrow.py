"""Seiten in 360 px Breite (wie ein kleines Handy): ragt etwas über den Rand?"""
import sys
import time
from common import Browser, BASE

PAGES = ['settings.html', 'sync.html', 'dashboard.html', 'offline.html', 'plugins.html', 'wege.html', 'entdecken.html', 'index.html']
CHECK = """const d = document.querySelector('#f').contentDocument, w = d.documentElement.clientWidth;
  const wide = [...d.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).position === 'fixed' && r.right <= w + 1) return false;
    return r.right > w + 1 && !el.closest('.maplibregl-canvas-container, .maplibregl-ctrl, [hidden], .ent-tabs, .tours-tabs, .chip-row');
  }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(el.getBoundingClientRect().right)}`);
  return { scroll: d.documentElement.scrollWidth > w + 1, wide };"""

with Browser(width=900, height=900) as b:
    b.open('settings.html', wait=1)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '9.9.9', messages: [] }))")
    bad = 0
    for p in PAGES:
        b.js(f"document.body.innerHTML = '<iframe id=f src=\"{BASE}{p}\" style=\"width:360px;height:760px;border:0\"></iframe>'")
        time.sleep(4)
        r = b.js(CHECK)
        print(p, 'SEITLICH SCROLLBAR' if r['scroll'] else 'ok', r['wide'])
        bad += bool(r['scroll'] or r['wide'])
        b.css('#f').screenshot(str(__import__('common').OUT / f'schmal-{p.split(".")[0]}.png'))
    sys.exit(1 if bad else 0)
