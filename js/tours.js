/**
 * Meine Touren – zwei Reiter:
 *   Geplant     Liste mit Vorschau, Name, Zahlen und Beschreibung. Neue
 *               Touren entstehen im Planer oder über „Als Tour speichern“.
 *   Meine Wege  was aufgezeichnet wurde, nach Jahren (wege.js)
 */
import { PROFILES } from './config.js';
import { tours, coordsOf, encodeShare, toGpx, download } from './store.js';
import { mountAppNav } from './appnav.js';
import { fmtDistance, fmtDuration, esc } from './geo.js';
import { svgPreview } from './preview.js';
import { mountWege } from './wege.js';

const list = document.getElementById('touren');
const nav = mountAppNav();
document.querySelector('.tours-head').append(nav.el);

/* Reiter: #wege oder geplant – der Link merkt sich, wo man war */
let wege = null;
function showTab() {
  const tab = location.hash === '#wege' ? 'wege' : 'geplant';
  for (const el of document.querySelectorAll('[data-tab]')) {
    if (el.matches('[role="tab"]')) el.setAttribute('aria-selected', String(el.dataset.tab === tab));
    else el.hidden = el.dataset.tab !== tab;
  }
  document.title = `${tab === 'wege' ? 'Meine Wege' : 'Meine Touren'} – WMap`;
  if (tab === 'wege') (wege ??= mountWege(document.getElementById('wege'))).show();
}
addEventListener('hashchange', showTab);

function render() {
  const all = tours.all();
  if (!all.length) {
    list.innerHTML = `<div class="tour-empty">
      <span class="msr">route</span>
      <p>Noch keine Touren gespeichert.</p>
      <p class="muted">Plane eine Tour Punkt für Punkt – oder plane eine Route und tippe auf <span class="msr">bookmark_add</span> „Als Tour speichern“.</p>
      <a class="button primary" href="./tour.html"><span class="msr">add_road</span> Tour planen</a></div>`;
    return;
  }
  list.innerHTML = all.map((t) => {
    const p = PROFILES[t.profile];
    const st = t.stats;
    return `<article class="tour-card" data-id="${esc(t.id)}">
      <a class="tour-open" href="./tour.html?id=${encodeURIComponent(t.id)}" aria-label="${esc(t.name)} öffnen">
        ${t.preview ? `<img class="tour-thumb" src="${t.preview}" alt="">` : svgPreview(coordsOf(t.shape))}
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
showTab();
