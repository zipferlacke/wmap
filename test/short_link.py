"""Kurzer Link beim Teilen (bEnd/api_share.php, js/data/short-link.js): Aufzeichnung teilen → der Dialog bietet bei
langem Link „Kurzen Link erstellen“; der kurze Link (wege.html#k=…) zeigt dieselbe Aufzeichnung; ein unbekannter
kurzer Link gibt eine Meldung. Dazu der Server: put/get, falsche Eingaben."""
import json
import sys
from common import Browser

STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { tracks, buildTrack } = await import('./js/data/tracks.js');
  const { api } = await import('./js/services/api.js');
  const pts = []; for (let i = 0; i < 400; i += 1) pts.push([9.91 + i * 0.0006 + Math.sin(i) * 0.0001, 51.52 + Math.sin(i / 6) * 0.0016, Date.UTC(2026, 5, 3, 7, 0, i * 12), 110 + (i * 7) % 40, 70 + (i * 3) % 20]);
  if (!new URLSearchParams(location.search).get('id')) {
    await tracks.put({ ...buildTrack(pts, { kind: 'rec', profile: 'bike', name: 'Kurzlink-Runde', keepAll: true }), id: 'kl1' });
    return 'angelegt';
  }
  await wait(1500);
  const out = {};
  const dlg = () => document.querySelector('dialog.confirm[open]');
  const press = (re) => [...dlg().querySelectorAll('.confirm-actions button')].find((x) => re.test(x.innerText)).click();
  document.querySelector('.weg-actions [data-do=share]').click();
  await wait(600);
  press(/Als Link teilen/);
  await wait(900);
  out.long = dlg().querySelector('.share-url').innerText;
  out.buttons = [...dlg().querySelectorAll('.confirm-actions button')].map((x) => x.innerText.replace(/^\S+\s+/, '').trim());
  press(/Kurzen Link/);
  await wait(2500);
  out.short = dlg()?.querySelector('.share-url')?.innerText ?? null;
  out.note = dlg()?.querySelector('.share-note')?.innerText ?? null;
  press(/Abbrechen/);
  // Server: falsche Eingaben
  const bad = async (path, data) => { try { await api(path, data); return null; } catch (e) { return e.message; } };
  out.badKind = await bad(['share', 'put'], { kind: 'x', code: 'zabc' });
  out.badCode = await bad(['share', 'put'], { kind: 'weg', code: '<script>' });
  out.badId = await bad(['share', 'get'], { id: 'gibtesnicht1' });
  await tracks.remove('kl1');
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=900) as b:
    b.open('wege.html', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    b.wait("return window.__result", 30)
    b.open('wege.html?id=kl1', wait=3)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 60))
    if not isinstance(r, dict):
        print(r)
        sys.exit(1)
    print(json.dumps({**r, 'long': r['long'][:80] + ' …'}, ensure_ascii=False, indent=1))
    short = r['short'] or ''
    # Den kurzen Link öffnen: dieselbe Aufzeichnung als geteilte Ansicht
    seen = None
    if '#k=' in short:
        b.open('wege.html#k=' + short.split('#k=')[1], wait=3)
        seen = b.wait("return document.querySelector('.weg-note') && [document.querySelector('.weg-name input').value, location.hash.slice(0, 5), document.querySelector('.weg-note').innerText.trim()]", 20)
    print('Geöffnet:', seen)
    b.open('wege.html#k=gibtesnicht1', wait=3)
    gone = b.wait("return [...document.querySelectorAll('.toast, .wmap-toast, [role=status]')].map((x) => x.innerText).join(' ') || document.body.innerText.includes('gibt es nicht mehr')", 10)
    print('Unbekannt:', gone)
    checks = {
        '1. langer Link: „Kurzen Link erstellen“ steht dabei': len(r['long']) > 100 and 'Kurzen Link erstellen' in r['buttons'],
        '2. kurzer Link wege.html#k=… mit Hinweis auf die 30 Tage': '#k=' in short and len(short) < 80 and bool(r['note']) and '30 Tage' in r['note'],
        '3. kurzer Link geöffnet: dieselbe Aufzeichnung, noch nicht gespeichert': bool(seen) and seen[0] == 'Kurzlink-Runde' and seen[1] == '#weg=' and 'Geteilte Aufzeichnung' in seen[2],
        '4. unbekannter kurzer Link: Meldung': bool(gone) and (gone is True or 'gibt es nicht mehr' in str(gone)),
        '5. Server lehnt falsche Art, falschen Inhalt und unbekannte Kennung ab': r['badKind'] == 'Unbekannte Art' and r['badCode'] == 'Der Inhalt passt nicht' and 'gibt es nicht mehr' in (r['badId'] or ''),
    }
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    sys.exit(0 if all(checks.values()) else 1)
