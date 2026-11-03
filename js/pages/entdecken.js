/**
 * Entdecken: Wege, die es schon gibt – ohne selbst zu planen.
 *
 *   Wege         Wander-, Rad- und MTB-Routen aus OpenStreetMap. Die Karte
 *                zeigt das Wegenetz (Waymarked Trails), das Panel die Wege im
 *                Kartenausschnitt als Tabelle – gruppiert nach dem Gesamtweg,
 *                zu dem Etappen gehören – mit Filter. Suche nach Namen
 *                („Karstwanderweg“): erst was im Ausschnitt passt, dann
 *                Waymarked Trails (~1 s), sonst Overpass. Antippen in der
 *                Karte: die Wege an dieser Stelle.
 *   Von anderen  Touren, die WMap-Nutzer geteilt haben – mit Sternen und
 *                Kommentaren; bewerten braucht ein Konto (OpenStreetMap)
 *
 * Kopfzeile wie überall (ui/map-page.js): ← Übersicht bzw. Liste, ✕ zur Karte.
 */
import { createMap } from '../map/map.js';
import { api } from '../services/api.js';
import { konto, ensureLogin } from '../services/konto.js';
import { KINDS, toursInBox, findTours, toursAt, searchTours, tourLine, tourLink } from '../services/known-tours.js';
import { encodeShare, local, coordsOf } from '../data/store.js';
import { ask, toast } from '../ui/dialogs.js';
import { mapPage } from '../ui/map-page.js';
import { trapBack } from '../core/back.js';
import { bbox as bboxOf, simplifyTo, fmtDistance, esc } from '../core/geo.js';
import { locale, t } from '../core/i18n.js';

const $ = (s, root = document) => root.querySelector(s);
const content = $('.wege-content');

// ?view=lon,lat,zoom (Links, Screenshots) – sonst der letzte Kartenausschnitt
const asked = new URLSearchParams(location.search).get('view')?.split(',').map(Number);
const view = asked?.length >= 3 && asked.every(Number.isFinite) ? { center: asked.slice(0, 2), zoom: asked[2] } : local.get('wmap.view');
const { map } = createMap('map', { auto3d: false, center: view?.center ?? [10.2, 51.2], zoom: view?.zoom ? Math.min(view.zoom, 11) : 6 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage($('.wege-src'), { map, title: t('entdecken.title') });
const { panel } = page;

let tab = ['wege', 'andere'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'wege';
let kind = local.get('wmap.entdecken.kind', 'hike');
let ctl = null;

/* ── Reiter, Konto ────────────────────────────────────────────────────────── */

panel.addEventListener('click', (e) => {
  const tabEl = e.target.closest('[role="tab"]');
  if (tabEl) { e.preventDefault(); showTab(tabEl.dataset.tab); }
});

// Zurück-Taste (Handy, Browser) wie ← der Detailansicht; in der Liste verlässt sie die Seite
trapBack(() => page.pressBack());

function header(title, back = null) {
  page.header(title, back);
  $('.ent-tabs', panel).hidden = !!back;
}

function showTab(name) {
  tab = name;
  history.replaceState(null, '', `#${name}`);
  panel.querySelectorAll('[role="tab"]').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === name)));
  header(t('entdecken.title'));
  clearDetail();
  ({ wege: showWege, andere: showAndere })[name]();
}

/** Konto-Zeile unten in „Von anderen“ */
function kontoRow() {
  const u = konto.user();
  return `<div class="ent-konto">
    <span class="msr">account_circle</span>
    <span>${konto.loggedIn() ? t('entdecken.account.signed_in', { name: esc(u.name) }) : t('entdecken.account.need')}</span>
    <button type="button" class="button" data-konto>${konto.loggedIn() ? t('entdecken.account.logout.button') : t('entdecken.account.login')}</button>
  </div>`;
}
content.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-konto]')) return;
  if (konto.loggedIn()) {
    const v = await ask({ icon: 'logout', title: t('entdecken.account.logout.title', { name: konto.user().name }), text: t('entdecken.account.logout.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('entdecken.account.logout.button'), primary: true }] });
    if (v === 'yes') await konto.logout();
  } else await ensureLogin(t('entdecken.account.login_reason'));
  showTab(tab);
});
// Zurück von der Anmeldung in der App (osm/login-return.js)
addEventListener('wmap:login', () => showTab(tab));

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
    attribution: t('entdecken.ways.attribution'),
  });
  map.addLayer({ id: 'wmt', type: 'raster', source: 'wmt', paint: { 'raster-opacity': 0.85 } }, map.getLayer('detail-casing') ? 'detail-casing' : undefined);
}

/*
 * Hervorhebung: der gewählte Weg kräftig mit hellem Rand, das übrige
 * Wegenetz tritt zurück. „preview“ ist die dünnere Vorschau beim Überfahren
 * einer Zeile in der Liste.
 */
const WIDTH = {
  detail: { casing: [6, 7, 14, 15], line: [6, 4, 14, 8] },
  preview: { casing: [6, 5, 14, 10], line: [6, 3, 14, 5.5] },
};
async function lines(id, features, color) {
  await ready;
  const data = { type: 'FeatureCollection', features };
  if (map.getSource(id)) { map.getSource(id).setData(data); return; }
  const w = WIDTH[id] ?? WIDTH.preview;
  map.addSource(id, { type: 'geojson', data });
  map.addLayer({ id: `${id}-casing`, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#fff', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], ...w.casing] } });
  map.addLayer({ id, type: 'line', source: id, layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['coalesce', ['get', 'color'], color], 'line-width': ['interpolate', ['linear'], ['zoom'], ...w.line] } });
}

/** Übriges Wegenetz blass, solange ein Weg hervorgehoben ist */
function dimNet(on) {
  if (map.getLayer('wmt')) map.setPaintProperty('wmt', 'raster-opacity', on ? 0.3 : 0.85);
}

function clearDetail() { lines('detail', [], '#e8590c'); dimNet(false); }

/* Vorschau beim Überfahren einer Zeile (Rechner) – Verlauf kommt von Waymarked Trails, ~0,2 s */
let previewId = null;
let previewTimer = null;
function preview(id) {
  clearTimeout(previewTimer);
  previewId = id;
  if (!id) { lines('preview', [], '#e8590c'); return; }
  previewTimer = setTimeout(async () => {
    try {
      const { sections } = await tourLine(id, { kind });
      if (previewId !== id || page.detail) return;
      lines('preview', sections.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })), '#e8590c');
    } catch { /* ohne Vorschau */ }
  }, 180);
}
content.addEventListener('mouseover', (e) => {
  const r = e.target.closest('tr[data-route]');
  const id = r && !page.detail ? +r.dataset.route : null;
  if (id !== previewId) preview(id);
});
content.addEventListener('mouseleave', () => preview(null));

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
      <input type="search" placeholder="${t('entdecken.ways.search.placeholder')}" aria-label="${t('entdecken.ways.search.label')}" value="${esc(filter)}">
    </form>
    <p class="known-status muted"></p>
    <div class="ent-groups"></div>
    <p class="muted">${t('entdecken.ways.tip')}</p>`;
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
    status.innerHTML = `<span class="msr">zoom_in</span> ${t('entdecken.ways.zoom_in')}`;
    paintWege();
    return;
  }
  ctl?.abort();
  ctl = new AbortController();
  status.innerHTML = `<span class="msr spin">progress_activity</span> ${t('entdecken.ways.searching')}`;
  const b = map.getBounds();
  try {
    found = await toursInBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], kind, { center: map.getCenter().toArray(), signal: ctl.signal });
    modeTitle = found.clipped ? t('entdecken.ways.found.clipped', { n: found.routes.length }) : t('entdecken.ways.found.box', { n: found.routes.length });
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError' && $('.known-status', content)) $('.known-status', content).textContent = t('entdecken.ways.error_retry', { error: err.message });
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
      <td class="w-icon">${r.symbol ? `<img class="wmt-symbol" src="${esc(r.symbol)}" alt="" title="${esc(r.symbolText ?? '')}" loading="lazy">` : `<span class="msr">${icon}</span>`}</td>
      <td class="w-name"><strong>${esc(r.name)}</strong><small>${esc([r.network, r.ref, r.round ? t('entdecken.ways.round') : ''].filter(Boolean).join(' · '))}</small></td>
      <td class="w-num">${r.length ? fmtDistance(r.length) : ''}</td></tr>`;
  box.innerHTML = order.map((key) => {
    // Suchtreffer in ihrer Reihenfolge (Ausschnitt zuerst), sonst nach Namen
    const list = mode === 'search' ? groups.get(key) : groups.get(key).sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true }));
    if (key === 'rest') {
      return `<details class="wege-year" open><summary><span class="msr">${icon}</span><strong>${found.parents.length ? t('entdecken.ways.more') : t('entdecken.tabs.ways')}</strong><small>${list.length}</small></summary>
        <table class="wege-table"><tbody>${list.map(row).join('')}</tbody></table></details>`;
    }
    const p = byParent.get(key);
    return `<details class="wege-year" open><summary><span class="msr">flag</span><strong>${esc(p.name)}</strong>
        <small>${esc([p.network, t('entdecken.ways.stages_here', { n: list.length }), p.length ? fmtDistance(p.length) : ''].filter(Boolean).join(' · '))}</small></summary>
      <button type="button" class="link-button ent-whole" data-route="${p.id}"><span class="msr">route</span> ${t('entdecken.ways.whole')}</button>
      <table class="wege-table"><tbody>${list.map(row).join('')}</tbody></table></details>`;
  }).join('');
  const status = $('.known-status', content);
  if (status && (mode !== 'box' || map.getZoom() >= MIN_ZOOM)) {
    status.innerHTML = `${esc(q ? t('entdecken.ways.filtered', { i: rows.length, n: found.routes.length, filter: filter.trim() }) : modeTitle)}${mode !== 'box' ? ` · <button type="button" class="link-button" data-go="box">${t('entdecken.ways.back_to_box')}</button>` : ''}`;
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
  if (q.length < 3) { toast(t('entdecken.ways.search.min')); return; }
  ctl?.abort();
  ctl = new AbortController();
  mode = 'search';
  // Was schon im Ausschnitt geladen ist und passt, steht sofort da – und oben
  const low = q.toLowerCase();
  const here = (found?.routes ?? []).filter((r) => `${r.name} ${r.ref}`.toLowerCase().includes(low)).map((r) => ({ ...r, parent: undefined }));
  if (here.length) {
    found = { routes: here, parents: [] };
    filter = '';
    modeTitle = t('entdecken.ways.search.here_more', { n: here.length });
    paintWege();
  }
  $('.known-status', content).innerHTML = `<span class="msr spin">progress_activity</span> ${here.length ? t('entdecken.ways.search.here', { n: here.length }) : ''}${t('entdecken.ways.search.everywhere', { q: esc(q) })}`;
  try {
    const more = await searchTours(q, kind, { center: map.getCenter().toArray(), signal: ctl.signal });
    const seen = new Set(here.map((r) => r.id));
    const routes = [...here, ...more.filter((r) => !seen.has(r.id))];
    found = { routes, parents: [] };
    filter = '';
    $('.ent-search input', content).value = '';
    modeTitle = routes.length ? t('entdecken.ways.search.found', { n: routes.length, q }) : t('entdecken.ways.search.none', { kind: KINDS[kind].label.toLowerCase(), q });
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError') $('.known-status', content).textContent = t('entdecken.ways.error_retry', { error: err.message });
  }
});

map.on('click', async (e) => {
  // Auch in der Ansicht eines Wegs: Antippen einer anderen Linie öffnet diese
  if (tab !== 'wege') return;
  const p = e.lngLat.toArray();
  page.open();
  ctl?.abort();
  ctl = new AbortController();
  mode = 'here';
  $('.known-status', content).innerHTML = `<span class="msr spin">progress_activity</span> ${t('entdecken.ways.here.loading')}`;
  try {
    // Genau auf der farbigen Linie: ein paar Pixel Spielraum (schnell, Waymarked Trails);
    // antwortet die nicht, sucht Overpass im Umkreis
    const mpp = (40075016 * Math.cos((p[1] * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    let routes;
    try {
      routes = await toursAt(p, kind, { meters: Math.max(8, 12 * mpp), signal: ctl.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      routes = await findTours(p, kind, { radius: Math.max(30, 400 / 2 ** (map.getZoom() - 10)), signal: ctl.signal });
    }
    found = { routes, parents: [] };
    // Nur ein Weg an der Stelle: gleich öffnen
    if (routes.length === 1) { showKnown(routes[0]); return; }
    modeTitle = routes.length ? t('entdecken.ways.here.found', { n: routes.length }) : t('entdecken.ways.here.none');
    paintWege();
  } catch (err) {
    if (err.name !== 'AbortError') $('.known-status', content).textContent = t('entdecken.ways.error', { error: err.message });
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
async function showKnown(route) {
  header(route.name, () => showTab('wege'));
  content.innerHTML = `<p class="muted"><span class="msr spin">progress_activity</span> ${t('entdecken.known.loading')}</p>`;
  const stages = found.routes.filter((r) => r.parent === route.id);
  try {
    const { line, sections, tags, info } = await tourLine(route.id, { kind });
    if (!page.detail) return;
    preview(null);
    lines('detail', sections.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })), '#e8590c');
    dimNet(true);
    fitTo(line);
    let len = 0;
    for (const c of sections) for (let i = 1; i < c.length; i += 1) len += haversine(c[i - 1], c[i]);
    const inf = info ?? {};
    const website = inf.url || tags.website;
    const round = route.round || inf.round;
    content.innerHTML = `
      <div class="ent-facts">
        <span><span class="msr">${KINDS[kind].icon}</span>${esc(inf.network ?? route.network)}</span>
        ${route.ref ? `<span><span class="msr">signpost</span>${esc(route.ref)}</span>` : ''}
        <span><span class="msr">straighten</span>${fmtDistance(inf.length ?? route.length ?? len)}</span>
        ${round ? `<span><span class="msr">all_inclusive</span>${t('entdecken.ways.round')}</span>` : ''}
      </div>
      ${inf.from && inf.to && inf.from !== inf.to && !round ? `<p class="ent-itinerary"><span class="msr">trip_origin</span> ${esc(inf.via.join(' → '))}</p>` : ''}
      ${tags.symbol || inf.symbol ? `<p class="ent-mark">${inf.symbol ? `<img class="wmt-symbol" src="${esc(inf.symbol)}" alt="">` : ''}<span>${t('entdecken.known.mark', { mark: esc(tags.symbol ?? route.symbolText ?? '') })}</span></p>` : ''}
      ${inf.description || route.description ? `<p>${esc(inf.description || route.description)}</p>` : ''}
      ${website ? `<p><a href="${esc(website)}" target="_blank" rel="noopener">${esc(website.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      <div class="weg-actions">
        <button type="button" class="button primary" data-open-known><span class="msr">edit_road</span> ${t('entdecken.open_planner')}</button>
        <a class="button" href="https://www.openstreetmap.org/relation/${route.id}" target="_blank" rel="noopener"><span class="msr">open_in_new</span> ${t('entdecken.known.osm')}</a>
      </div>
      ${stages.length ? `<h3 class="ent-h">${t('entdecken.known.stages')}</h3>
        <table class="wege-table"><tbody>${stages.map((r) => `<tr data-route="${r.id}" tabindex="0"><td class="w-icon"><span class="msr">flag</span></td>
          <td class="w-name"><strong>${esc(r.name)}</strong><small>${esc(r.ref ?? '')}</small></td><td class="w-num">${r.length ? fmtDistance(r.length) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="muted">${t('entdecken.known.planner_hint')}</p>`;
    $('[data-open-known]', content).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.innerHTML = `<span class="msr spin">progress_activity</span> ${t('entdecken.known.opening')}`;
      try { location.href = await tourLink(route, kind); } catch (err) {
        toast(t('entdecken.known.open_failed', { error: err.message }));
        b.disabled = false;
        b.innerHTML = `<span class="msr">edit_road</span> ${t('entdecken.open_planner')}`;
      }
    });
  } catch (err) {
    content.innerHTML = `<p class="muted">${t('entdecken.known.load_failed', { error: esc(err.message) })}</p>`;
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
    <p class="muted">${t('entdecken.others.intro')}</p>
    <p class="known-status muted"><span class="msr spin">progress_activity</span> ${t('entdecken.others.loading')}</p>
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
  lines('andere', andereList.map((x, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: coordsOf(x.shape) } })), '#1a73e8');
  $('.known-status', content).textContent = andereList.length ? t('entdecken.others.count', { n: andereList.length }) : t('entdecken.others.none');
  $('.ent-andere tbody', content).innerHTML = andereList.map((x, i) => `
    <tr data-a="${i}" tabindex="0">
      <td class="w-icon"><span class="ent-stars" title="${x.stars ? t('entdecken.others.stars', { stars: x.stars, votes: x.votes }) : t('entdecken.others.not_rated')}">${stars(x.stars)}</span></td>
      <td class="w-name"><strong>${esc(x.name)}</strong><small>${esc([t('entdecken.others.by', { author: x.author }), x.status === 'private' ? t('entdecken.others.only_you') : ''].filter(Boolean).join(' · '))}</small></td>
      <td class="w-num">${fmtDistance(x.length)}</td>
    </tr>`).join('');
}

async function showTour(id) {
  header(t('entdecken.tour.title'), () => showTab('andere'));
  content.innerHTML = `<p class="muted"><span class="msr spin">progress_activity</span> ${t('entdecken.others.loading')}</p>`;
  let tour;
  try { tour = await api(['tours', 'get'], { id }); } catch (err) { content.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  header(tour.name, () => showTab('andere'));
  const coords = coordsOf(tour.shape);
  lines('detail', [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }], '#e8590c');
  fitTo(coords);
  content.innerHTML = `
    <div class="ent-facts">
      <span class="ent-stars">${stars(tour.stars)}</span><span>${tour.stars ? t('entdecken.tour.rating', { stars: tour.stars.toLocaleString(locale), votes: tour.votes }) : t('entdecken.others.not_rated')}</span>
      <span><span class="msr">straighten</span>${fmtDistance(tour.length)}</span>
      ${tour.ascent ? `<span><span class="msr">north_east</span>${t('entdecken.tour.ascent', { m: Math.round(tour.ascent) })}</span>` : ''}
      <span><span class="msr">person</span>${esc(tour.author)}</span>
    </div>
    ${tour.description ? `<p>${esc(tour.description)}</p>` : ''}
    <div class="weg-actions">
      <button type="button" class="button primary" data-t="open"><span class="msr">edit_road</span> ${t('entdecken.open_planner')}</button>
      ${tour.mine ? `<button type="button" class="button" data-t="delete"><span class="msr">delete</span> ${t('common.delete')}</button>` : ''}
    </div>
    ${tour.status === 'public' ? `
    <form class="ent-rate">
      <strong>${t('entdecken.tour.rate.title')}</strong>
      <div class="ent-rate-stars" role="radiogroup" aria-label="${t('entdecken.tour.rate.stars')}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${t('entdecken.tour.rate.star_n', { n })}">☆</button>`).join('')}</div>
      <textarea rows="2" maxlength="1000" placeholder="${t('entdecken.tour.rate.placeholder')}"></textarea>
      <button type="submit" class="button primary">${t('entdecken.tour.rate.button')}</button>
    </form>` : `<p class="muted">${t('entdecken.tour.private')}</p>`}
    <ul class="ent-comments">${(tour.ratings ?? []).map((r) => `<li><span class="ent-stars">${stars(r.stars)}</span> <strong>${esc(r.author)}</strong>
      <small>${new Date(`${r.time.replace(' ', 'T')}Z`).toLocaleDateString(locale)}</small>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</li>`).join('')}</ul>`;
  let chosen = 0;
  content.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => {
    chosen = +b.dataset.star;
    content.querySelectorAll('[data-star]').forEach((x) => { x.textContent = +x.dataset.star <= chosen ? '★' : '☆'; });
  }));
  $('.ent-rate', content)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!chosen) { toast(t('entdecken.tour.rate.need_stars')); return; }
    if (!await ensureLogin(t('entdecken.tour.rate.login_reason'))) return;
    try { await api(['tours', 'rate'], { id: tour.id, stars: chosen, comment: $('.ent-rate textarea', content).value }); toast(t('entdecken.tour.rate.thanks')); showTour(tour.id); } catch (err) { toast(err.message); }
  });
  content.querySelector('[data-t="open"]').addEventListener('click', async () => {
    const code = await encodeShare({ name: tour.name, description: `${tour.description ?? ''}\n${t('entdecken.tour.shared_by', { author: tour.author })}`.trim(), profile: tour.profile, points: simplifyTo(coords, 20), fixed: true, shape: tour.shape });
    location.href = `./tour.html#t=${code}`;
  });
  content.querySelector('[data-t="delete"]')?.addEventListener('click', async () => {
    const v = await ask({ icon: 'delete', title: t('entdecken.tour.delete.title', { name: tour.name }), text: t('entdecken.tour.delete.text'), buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
    if (v !== 'yes') return;
    try { await api(['tours', 'delete'], { id: tour.id }); toast(t('entdecken.tour.delete.done')); showTab('andere'); } catch (err) { toast(err.message); }
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
    const route = found.routes.find((x) => x.id === id) ?? found.parents.find((x) => x.id === id);
    if (route) showKnown(route);
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
