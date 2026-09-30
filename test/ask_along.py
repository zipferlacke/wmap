"""Kurze Fragen unterwegs (app/ask-along.js) ohne Navigation: Laden aus den Kartenkacheln, beim Vorbeigehen
(15 m) und Weitergehen fragt die OSM-API nach genau diesem Ort (hier nachgestellt, nichts geht ins Netz) –
seit über zwei Jahren unbestätigt → Pille „Gibt es … noch?“; ✕ vergisst die Frage. Ein frisch bestätigter Laden
bekommt keine Pille."""
import json
import sys
from common import Browser

STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { map } = await import('./js/app/core.js');
  const { alongMap } = await import('./js/app/ask-along.js');
  const { osmRef } = await import('./js/map/map.js');
  const { destination } = await import('./js/core/geo.js');
  map.jumpTo({ center: [9.9357, 51.5335], zoom: 17 });
  await wait(500);
  for (let i = 0; i < 100 && !(map.loaded() && map.areTilesLoaded()); i++) await wait(200);
  const all = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })
    .filter((f) => f.properties.name && f.geometry.type === 'Point' && osmRef(f) && /shop|grocery|bakery|clothing|cafe|restaurant/.test(f.properties.class));
  if (all.length < 2) return 'FEHLER keine Läden in den Kacheln';
  // OSM-API nachstellen: der erste Laden ist alt, der zweite frisch bestätigt
  const [old, fresh] = all;
  const asked = [];
  const realFetch = window.fetch;
  window.fetch = async (url, o) => {
    const m = String(url).match(/\/api\/0\.6\/(node|way|relation)\/(\d+)\.json/);
    if (!m) return realFetch(url, o);
    asked.push(`${m[1]}/${m[2]}`);
    const isOld = Number(m[2]) === osmRef(old).id;
    const el = { type: m[1], id: Number(m[2]), timestamp: isOld ? '2019-05-01T10:00:00Z' : new Date().toISOString(), lat: 0, lon: 0,
      tags: { name: 'Testladen', shop: 'bakery', ...(isOld ? {} : { check_date: new Date().toISOString().slice(0, 10) }) } };
    return new Response(JSON.stringify({ elements: [el] }), { headers: { 'Content-Type': 'application/json' } });
  };
  let t = Date.now();
  const walkPast = async (f) => {
    const at = f.geometry.coordinates;
    map.jumpTo({ center: at, zoom: 17 });
    await wait(1500);
    for (const [bear, m] of [[0, 10], [0, 70]]) {
      const [x, y] = destination(at, bear, m);
      alongMap({ coords: { longitude: x, latitude: y, accuracy: 8, speed: 1.4, heading: 0 }, timestamp: (t += 6000) });
      await wait(300);
    }
    await wait(1200);
  };
  // Erst der frisch bestätigte Laden: keine Pille (und der Abstand zwischen Pillen bleibt frei) …
  await walkPast(fresh);
  const second = document.querySelector('.quick-ask.pill strong')?.textContent ?? null;
  // … dann der alte: Pille, ✕ vergisst sie (nichts in der Liste)
  await walkPast(old);
  const pill = document.querySelector('.quick-ask.pill strong')?.textContent ?? null;
  document.querySelector('.quick-ask.pill .qa-no')?.click();
  await wait(500);
  const { questions } = await import('./js/osm/survey.js');
  const listed = questions.all().filter((q) => q.quest === 'exists').length;
  return { pill, listed, second, asked: asked.length };
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=860) as b:
    b.open('index.html', wait=6)
    b.js("localStorage.setItem('wmap.contribute.seen', 'true')")
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 90))
    print(json.dumps(r, ensure_ascii=False))
    ok = isinstance(r, dict) and r['pill'] == 'Gibt es Testladen noch?' and r['listed'] == 0 and r['second'] is None and r['asked'] == 2
    print('Pille für alten Laden, ✕ vergisst, frischer Laden ohne Pille:', ok)
    if not ok:
        sys.exit(1)
