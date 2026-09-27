/**
 * Entdecken: Wege, die es schon gibt – ohne selbst zu planen.
 *
 *   Wege         Wander-, Rad- und MTB-Routen aus OpenStreetMap. Die Karte
 *                zeigt das Wegenetz (Waymarked Trails), das Panel die Wege im
 *                Kartenausschnitt als Tabelle – gruppiert nach dem Gesamtweg,
 *                zu dem Etappen gehören – mit Filter. Suche nach Namen in
 *                ganz Deutschland („Karstwanderweg“). Antippen in der Karte:
 *                die Wege an dieser Stelle.
 *   Von anderen  Touren, die WMap-Nutzer geteilt haben – mit Sternen und
 *                Kommentaren; bewerten braucht ein Konto (Passkey)
 *
 * Kopfzeile wie überall (mappage.js): ← Übersicht bzw. Liste, ✕ zur Karte.
 */
import { createMap } from './map.js';
import { api } from './api.js';
import { konto, ensureLogin } from './konto.js';
import { KINDS, toursInBox, findTours, searchTours, tourLine, tourLink } from './known-tours.js';
import { encodeShare, local, coordsOf } from './store.js';
import { ask } from './ui.js';
import { mapPage } from './mappage.js';
import { bbox as bboxOf, simplifyTo, fmtDistance, esc } from './geo.js';

const $ = (s, root = document) => root.querySelector(s);
const panel = $('.wege-panel');
const content = $('.wege-content');

function toast(text) {
  let el = $('#toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ?view=lon,lat,zoom (Links, Screenshots) – sonst der letzte Kartenausschnitt
const asked = new URLSearchParams(location.search).get('view')?.split(',').map(Number);
const view = asked?.length >= 3 && asked.every(Number.isFinite) ? { center: asked.slice(0, 2), zoom: asked[2] } : local.get('wmap.view');
const { map } = createMap('map', { auto3d: false, center: view?.center ?? [10.2, 51.2], zoom: view?.zoom ? Math.min(view.zoom, 11) : 6 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage(panel, { map });

// Alte Links auf den Reiter „Plugins“ führen zur eigenen Seite
if (location.hash === '#plugins') location.replace('./plugins.html');
addEventListener('hashchange', () => { if (location.hash === '#plugins') location.replace('./plugins.html'); });
let tab = ['wege', 'andere'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'wege';
let kind = local.get('wmap.entdecken.kind', 'hike');
let ctl = null;

/* ── Reiter, Konto ────────────────────────────────────────────────────────── */

panel.addEventListener('click', (e) => {
  const t = e.target.closest('[role="tab"]');
  if (t) { e.preventDefault(); showTab(t.dataset.tab); }
});

function header(title, back = null) {
  page.header(title, back);
  $('.ent-tabs', panel).hidden = !!back;
}

function showTab(t) {
  tab = t;
  history.replaceState(null, '', `#${t}`);
  panel.querySelectorAll('[role="tab"]').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === t)));
  header('Entdecken');
  clearDetail();
  ({ wege: showWege, andere: showAndere })[t]();
}

/** Konto-Zeile unten in „Von anderen“ */
function kontoRow() {
  const u = konto.user();
  return `<div class="ent-konto">
    <span class="msr">passkey</span>
    <span>${konto.loggedIn() ? `Angemeldet als <strong>${esc(u.name)}</strong>` : 'Zum Bewerten, Veröffentlichen und Anbieten brauchst du ein WMap-Konto – mit Passkey, ohne Passwort.'}</span>
    <button type="button" class="button" data-konto>${konto.loggedIn() ? 'Abmelden' : 'Anmelden'}</button>
  </div>`;
}
content.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-konto]')) return;
  if (konto.loggedIn()) {
    const v = await ask({ icon: 'logout', title: `Abmelden, ${konto.user().name}?`, text: 'Deine Touren und Bewertungen bleiben erhalten.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Abmelden', primary: true }] });
    if (v === 'yes') await konto.logout();
  } else await ensureLogin('Zum Bewerten und Veröffentlichen');
  showTab(tab);
});

/* ── Karte: Wegenetz, Linien ──────────────────────────────────────────────── */

const WMT = { hike: 'hiking', bike: 'cycling', mtb: 'mtb' };

async function overlay(on = true) {
  await ready;
  if (map.getLayer('wmt')) map.removeLayer('wmt');
  if (map.getSource('wmt')) map.removeSource('wmt');
  if (!on) return;
  map.addSource('wmt', {
    type: 'raster', tileSize: 256, maxzoom: 17,
    tiles: [`https://tile.waymarkedtrails.org/${WMT[kind]}/{z}/{x}/{y}.png`],
    attribution: 'Wege: <a href="https://waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> (CC BY-SA)',
  });
  map.addLayer({ id: 'wmt', type: 'raster', source: 'wmt', paint: { 'raster-opacity': 0.85 } }, map.getLayer('detail-casing') ? 'detail-casing' : undefined);
}

async function lines(id, features, color) {
  await ready;
  const data = { type: 'FeatureCollection', features };
  if (map.getSource(id)) { map.getSource(id).setData(data); return; }
  map.addSource(id, { type: 'geojson', data });
  map.addLayer({ id: `${id}-casing`, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 4, 14, 9] } });
  map.addLayer({ id, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], color], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 14, 5.5] } });
}

function clearDetail() { lines('detail', [], '#e8590c'); }

function fitTo(coords) {
  const b = bboxOf(coords);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: page.padding(), maxZoom: 14, duration: 700 });
}

/* ── Reiter „Wege“: Tabelle der Wege im Ausschnitt ────────────────────────── */

const MIN_ZOOM = 8.5;                 // weiter draußen wären es zu viele Wege
let found = { routes: [], parents: [] };
let mode = 'box';                     // box: Ausschnitt · search: Namenssuche · here: angetippte Stelle
let modeTitle = '';
let filter = '';

function showWege() {
  overlay();
  lines('andere', [], '#1a73e8');
  content.innerHTML = `
    <div class="chip-row known-kinds">${Object.entries(KINDS).map(([k, x]) =>
      `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === kind}"><span class="msr">${x.icon}</span>${x.label}</button>`).join('')}</div>
    <form class="tour-search ent-search" autocomplete="off">
      <span class="msr">search</span>
      <input type="search" placeholder="Filtern – oder Enter: in ganz Deutschland suchen" aria-label="Wege filtern oder suchen" value="${esc(filter)}">
    </form>
    <p class="known-status muted"></p>
    <div class="ent-groups"></div>
    <p class="muted">Tipp: Auf eine markierte Linie in der Karte tippen – dann erscheinen die Wege an genau dieser Stelle.</p>`;
  page.open();
  if (mode === 'box') loadBox(); else paintWege();
}

async function loadBox() {
  mode = 'box';
  if (tab !== 'wege' || page.detail) return;
  const status = $('.known-status', content);
  if (!status) return;
  if (map.getZoom() < MIN_ZOOM) {
    found = { routes: [], parents: [] };
    status.innerHTML = '<span class="msr">zoom_in</span> Näher heranzoomen, dann stehen hier alle Wege im Kartenausschnitt – oder oben nach einem Namen suchen.';
    paintWege();
    return;
  }
  ctl?.abort();
  ctl = new AbortController();
  status.innerHTML = '<span class="msr spin">progress_activity</span> Suche Wege im Kartenausschnitt …';
  const b = map.getBounds();
  try {
    found = await toursInBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], kind, { center: map.getCenter().toArray(), signal: ctl.signal });
    modeTitle = `${found.routes.length} Wege im Kartenausschnitt`;
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError' && $('.known-status', content)) $('.known-status', content).textContent = `Gerade nicht abrufbar – bitte gleich noch mal (${err.message})`;
  }
}

/** Tabelle: Gesamtwege mit ihren Etappen, danach die übrigen Wege */
function paintWege() {
  const box = $('.ent-groups', content);
  if (!box) return;
  const q = filter.trim().toLowerCase();
  const byParent = new Map(found.parents.map((p) => [p.id, p]));
  const hit = (r) => !q || [r.name, r.ref, r.network, byParent.get(r.parent)?.name].some((x) => String(x ?? '').toLowerCase().includes(q));
  const rows = found.routes.filter(hit);
  const groups = new Map();
  for (const r of rows) {
    const key = r.parent ?? 'rest';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const order = [...groups.keys()].sort((a, b) => (a === 'rest') - (b === 'rest') || (byParent.get(a)?.rank ?? 9) - (byParent.get(b)?.rank ?? 9));
  const icon = KINDS[kind].icon;
  const row = (r) => `<tr data-route="${r.id}" tabindex="0">
      <td class="w-icon"><span class="msr">${icon}</span></td>
      <td class="w-name"><strong>${esc(r.name)}</strong><small>${esc([r.network, r.ref, r.round ? 'Rundweg' : ''].filter(Boolean).join(' · '))}</small></td>
      <td class="w-num">${r.length ? fmtDistance(r.length) : ''}</td></tr>`;
  box.innerHTML = order.map((key) => {
    const list = groups.get(key).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    if (key === 'rest') {
      return `<details class="wege-year" open><summary><span class="msr">${icon}</span><strong>${found.parents.length ? 'Weitere Wege' : 'Wege'}</strong><small>${list.length}</small></summary>
        <table class="wege-table"><tbody>${list.map(row).join('')}</tbody></table></details>`;
    }
    const p = byParent.get(key);
    return `<details class="wege-year" open><summary><span class="msr">flag</span><strong>${esc(p.name)}</strong>
        <small>${esc([p.network, `${list.length} ${list.length === 1 ? 'Etappe' : 'Etappen'} hier`, p.length ? fmtDistance(p.length) : ''].filter(Boolean).join(' · '))}</small></summary>
      <button type="button" class="link-button ent-whole" data-route="${p.id}"><span class="msr">route</span> Ganzen Weg ansehen</button>
      <table class="wege-table"><tbody>${list.map(row).join('')}</tbody></table></details>`;
  }).join('');
  const status = $('.known-status', content);
  if (status && (mode !== 'box' || map.getZoom() >= MIN_ZOOM)) {
    status.innerHTML = `${esc(q ? `${rows.length} von ${found.routes.length} – gefiltert nach „${filter.trim()}“` : modeTitle)}${mode !== 'box' ? ' · <button type="button" class="link-button" data-go="box">zurück zum Ausschnitt</button>' : ''}`;
  }
}

content.addEventListener('input', (e) => {
  if (!e.target.matches('.ent-search input')) return;
  filter = e.target.value;
  paintWege();
});
content.addEventListener('submit', async (e) => {
  if (!e.target.matches('.ent-search')) return;
  e.preventDefault();
  const q = $('.ent-search input', content).value.trim();
  if (q.length < 3) { toast('Für die Suche in ganz Deutschland bitte mindestens drei Buchstaben'); return; }
  ctl?.abort();
  ctl = new AbortController();
  mode = 'search';
  $('.known-status', content).innerHTML = `<span class="msr spin">progress_activity</span> Suche „${esc(q)}“ in ganz Deutschland … (dauert ein paar Sekunden)`;
  try {
    const routes = await searchTours(q, kind, { center: map.getCenter().toArray(), signal: ctl.signal });
    found = { routes, parents: [] };
    filter = '';
    $('.ent-search input', content).value = '';
    modeTitle = routes.length ? `${routes.length} Wege zu „${q}“` : `Kein ${KINDS[kind].label.toLowerCase()}-Weg „${q}“ gefunden`;
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError') $('.known-status', content).textContent = `Gerade nicht abrufbar – bitte gleich noch mal (${err.message})`;
  }
});

map.on('click', async (e) => {
  if (tab !== 'wege' || page.detail) return;
  const p = e.lngLat.toArray();
  page.open();
  ctl?.abort();
  ctl = new AbortController();
  mode = 'here';
  $('.known-status', content).innerHTML = '<span class="msr spin">progress_activity</span> Welche Wege verlaufen hier …';
  try {
    const routes = await findTours(p, kind, { radius: Math.max(30, 400 / 2 ** (map.getZoom() - 10)), signal: ctl.signal });
    found = { routes, parents: [] };
    modeTitle = routes.length ? `${routes.length} Wege an dieser Stelle` : 'Hier verläuft kein markierter Weg – näher heranzoomen und genau auf die Linie tippen';
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError') $('.known-status', content).textContent = `Gerade nicht abrufbar (${err.message})`;
  }
});

let moveTimer = null;
map.on('moveend', () => {
  clearTimeout(moveTimer);
  if (page.detail) return;
  if (tab === 'wege' && mode === 'box') moveTimer = setTimeout(loadBox, 700);
  if (tab === 'andere') moveTimer = setTimeout(showAndere, 600);
});

/** Ein Weg oder Gesamtweg: Verlauf, Zahlen, Etappen, in den Planer */
async function showKnown(t) {
  header(t.name, () => showTab('wege'));
  content.innerHTML = '<p class="muted"><span class="msr spin">progress_activity</span> Verlauf wird geladen …</p>';
  const stages = found.routes.filter((r) => r.parent === t.id);
  try {
    const { line, tags } = await tourLine(t.id);
    if (!page.detail) return;
    lines('detail', [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }], '#e8590c');
    fitTo(line);
    let len = 0;
    for (let i = 1; i < line.length; i += 1) len += haversine(line[i - 1], line[i]);
    content.innerHTML = `
      <div class="ent-facts">
        <span><span class="msr">${KINDS[kind].icon}</span>${esc(t.network)}</span>
        ${t.ref ? `<span><span class="msr">signpost</span>${esc(t.ref)}</span>` : ''}
        <span><span class="msr">straighten</span>${fmtDistance(t.length ?? len)}</span>
        ${t.round ? '<span><span class="msr">all_inclusive</span>Rundweg</span>' : ''}
      </div>
      ${tags.symbol ? `<p><strong>Markierung:</strong> ${esc(tags.symbol)}</p>` : ''}
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      ${tags.website ? `<p><a href="${esc(tags.website)}" target="_blank" rel="noopener">${esc(tags.website.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      <div class="weg-actions">
        <button type="button" class="button primary" data-open-known><span class="msr">edit_road</span> Im Planer öffnen</button>
        <a class="button" href="https://www.openstreetmap.org/relation/${t.id}" target="_blank" rel="noopener"><span class="msr">open_in_new</span> Bei OpenStreetMap</a>
      </div>
      ${stages.length ? `<h3 class="ent-h">Etappen im Kartenausschnitt</h3>
        <table class="wege-table"><tbody>${stages.map((r) => `<tr data-route="${r.id}" tabindex="0"><td class="w-icon"><span class="msr">flag</span></td>
          <td class="w-name"><strong>${esc(r.name)}</strong><small>${esc(r.ref ?? '')}</small></td><td class="w-num">${r.length ? fmtDistance(r.length) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="muted">Im Planer siehst du Höhenprofil und Wegtypen und kannst die Tour speichern, ändern oder teilen.</p>`;
    $('[data-open-known]', content).addEventListener('click', async () => { location.href = await tourLink(t, kind); });
  } catch (err) {
    content.innerHTML = `<p class="muted">Der Verlauf ließ sich nicht laden: ${esc(err.message)}</p>`;
  }
}

function haversine([x1, y1], [x2, y2]) {
  const r = Math.PI / 180, a = Math.sin(((y2 - y1) * r) / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

/* ── Reiter „Von anderen“ (WMap-Server) ───────────────────────────────────── */

let andereList = [];
const stars = (n) => (n ? `${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}` : '☆☆☆☆☆');

async function showAndere() {
  overlay(false);
  content.innerHTML = `
    <p class="muted">Touren, die WMap-Nutzer geteilt haben – im Kartenausschnitt. Eigene teilst du im Planer über das Menü → „Veröffentlichen“.</p>
    <p class="known-status muted"><span class="msr spin">progress_activity</span> Lade …</p>
    <table class="wege-table ent-andere"><tbody></tbody></table>
    ${kontoRow()}`;
  page.open();
  const b = map.getBounds();
  try {
    andereList = await api(['tours', 'list'], { bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  } catch (err) {
    $('.known-status', content).textContent = err.message;
    return;
  }
  if (tab !== 'andere' || page.detail) return;
  lines('andere', andereList.map((t, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: coordsOf(t.shape) } })), '#1a73e8');
  $('.known-status', content).textContent = andereList.length ? `${andereList.length} Touren hier` : 'Hier hat noch niemand eine Tour geteilt – weiter herauszoomen?';
  $('.ent-andere tbody', content).innerHTML = andereList.map((t, i) => `
    <tr data-a="${i}" tabindex="0">
      <td class="w-icon"><span class="ent-stars" title="${t.stars ? `${t.stars} von 5 (${t.votes})` : 'noch nicht bewertet'}">${stars(t.stars)}</span></td>
      <td class="w-name"><strong>${esc(t.name)}</strong><small>${esc([`von ${t.author}`, t.status === 'private' ? 'nur für dich' : ''].filter(Boolean).join(' · '))}</small></td>
      <td class="w-num">${fmtDistance(t.length)}</td>
    </tr>`).join('');
}

async function showTour(id) {
  header('Tour', () => showTab('andere'));
  content.innerHTML = '<p class="muted"><span class="msr spin">progress_activity</span> Lade …</p>';
  let t;
  try { t = await api(['tours', 'get'], { id }); } catch (err) { content.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  header(t.name, () => showTab('andere'));
  const coords = coordsOf(t.shape);
  lines('detail', [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }], '#e8590c');
  fitTo(coords);
  content.innerHTML = `
    <div class="ent-facts">
      <span class="ent-stars">${stars(t.stars)}</span><span>${t.stars ? `${String(t.stars).replace('.', ',')} (${t.votes})` : 'noch nicht bewertet'}</span>
      <span><span class="msr">straighten</span>${fmtDistance(t.length)}</span>
      ${t.ascent ? `<span><span class="msr">north_east</span>${Math.round(t.ascent)} m</span>` : ''}
      <span><span class="msr">person</span>${esc(t.author)}</span>
    </div>
    ${t.description ? `<p>${esc(t.description)}</p>` : ''}
    <div class="weg-actions">
      <button type="button" class="button primary" data-t="open"><span class="msr">edit_road</span> Im Planer öffnen</button>
      ${t.mine ? '<button type="button" class="button" data-t="delete"><span class="msr">delete</span> Löschen</button>' : ''}
    </div>
    ${t.status === 'public' ? `
    <form class="ent-rate">
      <strong>Deine Bewertung</strong>
      <div class="ent-rate-stars" role="radiogroup" aria-label="Sterne">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} Sterne">☆</button>`).join('')}</div>
      <textarea rows="2" maxlength="1000" placeholder="Wie war es? (optional)"></textarea>
      <button type="submit" class="button primary">Bewerten</button>
    </form>` : '<p class="muted">Nur für dich sichtbar.</p>'}
    <ul class="ent-comments">${(t.ratings ?? []).map((r) => `<li><span class="ent-stars">${stars(r.stars)}</span> <strong>${esc(r.author)}</strong>
      <small>${new Date(`${r.time.replace(' ', 'T')}Z`).toLocaleDateString('de-DE')}</small>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</li>`).join('')}</ul>`;
  let chosen = 0;
  content.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => {
    chosen = +b.dataset.star;
    content.querySelectorAll('[data-star]').forEach((x) => { x.textContent = +x.dataset.star <= chosen ? '★' : '☆'; });
  }));
  $('.ent-rate', content)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!chosen) { toast('Bitte Sterne antippen'); return; }
    if (!await ensureLogin('Zum Bewerten')) return;
    try { await api(['tours', 'rate'], { id: t.id, stars: chosen, comment: $('.ent-rate textarea', content).value }); toast('Danke für die Bewertung!'); showTour(t.id); } catch (err) { toast(err.message); }
  });
  content.querySelector('[data-t="open"]').addEventListener('click', async () => {
    const code = await encodeShare({ name: t.name, description: `${t.description ?? ''}\nGeteilt von ${t.author} auf WMap`.trim(), profile: t.profile, points: simplifyTo(coords, 20), fixed: true, shape: t.shape });
    location.href = `./tour.html#t=${code}`;
  });
  content.querySelector('[data-t="delete"]')?.addEventListener('click', async () => {
    const v = await ask({ icon: 'delete', title: `„${t.name}“ löschen?`, text: 'Die Tour verschwindet für alle.', buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    try { await api(['tours', 'delete'], { id: t.id }); toast('Gelöscht'); showTab('andere'); } catch (err) { toast(err.message); }
  });
}

content.addEventListener('click', async (e) => {
  const k = e.target.closest('[data-kind]');
  if (k) {
    kind = k.dataset.kind;
    local.set('wmap.entdecken.kind', kind);
    content.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
    overlay();
    loadBox();
    return;
  }
  if (e.target.closest('[data-go="box"]')) { filter = ''; showWege(); loadBox(); return; }
  const r = e.target.closest('[data-route]');
  if (r) {
    const id = +r.dataset.route;
    const t = found.routes.find((x) => x.id === id) ?? found.parents.find((x) => x.id === id);
    if (t) showKnown(t);
    return;
  }
  const a = e.target.closest('tr[data-a]');
  if (a) showTour(andereList[+a.dataset.a].id);
});
content.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr[data-route], tr[data-a]')) e.target.click();
});

/* ── Start ────────────────────────────────────────────────────────────────── */

await ready;
showTab(tab);
