/**
 * Meine Touren: Liste mit Vorschau, Name, Zahlen und Beschreibung.
 * Neue Touren entstehen in der Routenplanung über „Als Tour speichern“.
 */
import { PROFILES } from './config.js';
import { tours, coordsOf, encodeShare, toGpx, download } from './store.js';
import { mountAppNav } from './appnav.js';
import { fmtDistance, fmtDuration, esc } from './geo.js';

const list = document.getElementById('touren');
const nav = mountAppNav();
document.querySelector('.tours-head').append(nav.el);

/** Linie als SVG, wenn es (noch) kein Vorschaubild gibt. */
function svgPreview(shape) {
  const c = coordsOf(shape);
  if (c.length < 2) return '<div class="tour-thumb empty"><span class="msr">route</span></div>';
  const lat0 = c[0][1] * Math.PI / 180;
  const pts = c.map(([x, y]) => [x * Math.cos(lat0), -y]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 480, H = 300, pad = 24;
  const s = Math.min((W - 2 * pad) / (maxX - minX || 1e-9), (H - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * s + ox).toFixed(1)},${((y - minY) * s + oy).toFixed(1)}`).join('');
  return `<svg class="tour-thumb" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="#1a73e8" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function render() {
  const all = tours.all();
  if (!all.length) {
    list.innerHTML = `<div class="tour-empty">
      <span class="msr">route</span>
      <p>Noch keine Touren gespeichert.</p>
      <p class="muted">Plane eine Route und tippe unten auf <span class="msr">bookmark_add</span> „Als Tour speichern“.</p>
      <a class="button primary" href="./index.html"><span class="msr">directions</span> Route planen</a></div>`;
    return;
  }
  list.innerHTML = all.map((t) => {
    const p = PROFILES[t.profile];
    const st = t.stats;
    return `<article class="tour-card" data-id="${esc(t.id)}">
      <a class="tour-open" href="./tour.html?id=${encodeURIComponent(t.id)}" aria-label="${esc(t.name)} öffnen">
        ${t.preview ? `<img class="tour-thumb" src="${t.preview}" alt="">` : svgPreview(t.shape)}
      </a>
      <div class="tour-body">
        <h2><a href="./tour.html?id=${encodeURIComponent(t.id)}">${esc(t.name)}</a></h2>
        <p class="tour-meta">
          ${p ? `<span><span class="msr">${p.icon}</span>${esc(p.label)}</span>` : ''}
          ${st ? `<span>${fmtDistance(st.length)}</span><span>${fmtDuration(st.time)}</span>
          <span><span class="msr">north_east</span>${st.ascent} m</span>` : ''}
        </p>
        ${t.description ? `<p class="tour-text">${esc(t.description)}</p>` : ''}
        <div class="tour-actions">
          <button type="button" class="button" data-shape="round no-background" data-act="share" title="Teilen"><span class="msr">share</span></button>
          <button type="button" class="button" data-shape="round no-background" data-act="gpx" title="GPX"><span class="msr">download</span></button>
          <button type="button" class="button" data-shape="round no-background" data-act="delete" title="Löschen"><span class="msr">delete</span></button>
        </div>
      </div>
    </article>`;
  }).join('');
}

list.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const t = tours.get(b.closest('[data-id]').dataset.id);
  if (!t) return;
  if (b.dataset.act === 'delete') {
    if (confirm(`„${t.name}“ wirklich löschen?`)) { tours.remove(t.id); render(); }
  } else if (b.dataset.act === 'gpx') {
    download(`${t.name.replace(/[^\wäöüß]+/gi, '-')}.gpx`, toGpx(t, coordsOf(t.shape)));
  } else if (b.dataset.act === 'share') {
    const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#t=${await encodeShare(t)}`;
    if (navigator.share) { try { await navigator.share({ title: t.name, url }); return; } catch { /* dann kopieren */ } }
    try { await navigator.clipboard.writeText(url); alert('Link kopiert'); } catch { prompt('Link zum Teilen:', url); }
  }
});

render();
