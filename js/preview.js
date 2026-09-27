/**
 * Linie als kleines SVG – Vorschau für Touren und Wege, ohne Karte und
 * ohne Netz. Nordoben, auf die Breite entzerrt.
 */
export function svgPreview(coords, { color = '#1a73e8', w = 480, h = 300, cls = 'tour-thumb' } = {}) {
  if (coords.length < 2) return `<div class="${cls} empty"><span class="msr">route</span></div>`;
  const lat0 = coords[0][1] * Math.PI / 180;
  const pts = coords.map(([x, y]) => [x * Math.cos(lat0), -y]);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = Math.round(Math.min(w, h) * 0.08);
  const s = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (h - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * s + ox).toFixed(1)},${((y - minY) * s + oy).toFixed(1)}`).join('');
  const sw = Math.max(2.5, w / 96);
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#fff" stroke-width="${sw * 1.8}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
