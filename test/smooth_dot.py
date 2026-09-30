"""Standortpunkt glätten (core/smooth.js): im Stand bleibt der Punkt ruhig und rückt nur selten auf das Mittel – auch wenn das GPS dabei 1–2 m/s meldet,
in Fahrt folgt er ohne großen Rückstand, ein einzelner Ausreißer wird verworfen, drei hintereinander gelten."""
import json
import sys
from common import Browser

STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
(async () => {
  const { smoother } = await import('./js/core/smooth.js');
  const { distance } = await import('./js/core/geo.js');
  const m = 1 / 111000, k = 1 / 69000;               // Grad je Meter (Breite, Länge bei 51,5°)
  const at = [9.9368, 51.5413];
  let t = 1e6;
  const pos = (x, y, acc, speed = null, heading = null) => ({ coords: { longitude: x, latitude: y, accuracy: acc, speed, heading }, timestamp: (t += 1000) });
  const s = smoother();

  // Stehen: 60 s Rauschen ±3 m bei 20 m Ungenauigkeit
  s(pos(at[0], at[1], 20, 0));
  let out = 0, far = 0;
  for (let i = 0; i < 60; i++) {
    // Tempo wie am Handy bei schwachem Signal: 0,9–1,9 m/s, obwohl man steht
    const r = s(pos(at[0] + (Math.random() - 0.5) * 6 * k, at[1] + (Math.random() - 0.5) * 6 * m, 20, 0.9 + Math.random()));
    if (r) { out++; far = Math.max(far, distance(at, [r.coords.longitude, r.coords.latitude])); }
  }

  // Fahren: 15 m/s nach Osten, Rauschen ±4 m
  const lag = [];
  let x = at[0];
  for (let i = 0; i < 20; i++) {
    x += 15 * k;
    const r = s(pos(x + (Math.random() - 0.5) * 8 * k, at[1] + (Math.random() - 0.5) * 8 * m, 6, 15, 90));
    if (i > 5 && r) lag.push(Math.round(distance([x, at[1]], [r.coords.longitude, r.coords.latitude])));
  }

  // Ausreißer: 400 m daneben – einmal verworfen, dreimal gilt
  x += 15 * k;
  const one = s(pos(x, at[1] + 400 * m, 6, 15, 90));
  const two = s(pos(x, at[1] + 400 * m, 6, 15, 90));
  const three = s(pos(x, at[1] + 400 * m, 6, 15, 90));
  return { standingOut: out, standingFar: Math.round(far * 10) / 10, lag, outlier: [one === null, two === null, three !== null] };
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=860) as b:
    b.open('index.html', wait=4)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 30))
    print(json.dumps(r, ensure_ascii=False))
    ok = isinstance(r, dict)
    calm = ok and r['standingOut'] <= 6 and r['standingFar'] < 4
    follows = ok and max(r['lag']) < 8
    outlier = ok and r['outlier'] == [True, True, True]
    print('Im Stand ruhig:', calm, '· folgt in Fahrt:', follows, '· Ausreißer:', outlier)
    if not (calm and follows and outlier):
        sys.exit(1)
