/**
 * Seite „Offline-Karten“: Gebiete als Rechteck oder freie Form auf der Karte
 * wählen, Größe vorher sehen, herunterladen. In der Liste: hinzoomen, neu
 * laden (Aktualisieren), umbenennen, löschen. Die Logik liegt in
 * data/offline-areas.js, das Ausliefern ohne Netz in sw.js.
 */
import { createMap } from '../map/map.js';
import { Sheet } from '../ui/sheet.js';
import { mountAppNav } from '../ui/appnav.js';
import { ask, toast } from '../ui/dialogs.js';
import { local } from '../data/store.js';
import { registerOffline } from '../data/offline.js';
import { areas, newArea, DETAIL, estimate, download, tilesOf } from '../data/offline-areas.js';
import * as geocode from '../services/geocode.js';
import { esc } from '../core/geo.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

registerOffline();
const view = local.get('wmap.view');
const { map } = createMap('map', { center: view?.center ?? [9.93, 51.53], zoom: view?.zoom ?? 9, auto3d: false });
window.__wmap = { map };
$('.tour-head').append(mountAppNav().el);
const sheet = $('#sheet');
sheet.show();
document.activeElement?.blur();
new Sheet(sheet, { topLimit: () => $('.tour-head').getBoundingClientRect().bottom });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));

const MB = (b) => `${(b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: b >= 1e8 ? 0 : 1 })} MB`;
const size = (b) => (b >= 1e9 ? `${(b / 1073741824).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : MB(b));
const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const COLOR = '#1a73e8';
const DRAFT = '#e8710a';

/* ── Karte: gespeicherte Gebiete und der Entwurf ──────────────────────────── */

const polygon = (ring, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
const collection = (features) => ({ type: 'FeatureCollection', features });

ready.then(() => {
  map.addSource('areas', { type: 'geojson', data: collection([]) });
  map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': COLOR, 'fill-opacity': 0.1 } });
  map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': COLOR, 'line-width': 2 } });
  map.addSource('draft', { type: 'geojson', data: collection([]) });
  map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': DRAFT, 'fill-opacity': 0.15 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': DRAFT, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  paint();
  const list = areas.all();
  if (list.length && !view) fit(list[0].ring);
});

function showAreas() {
  map.getSource('areas')?.setData(collection(areas.all().map((a) => polygon(a.ring, { id: a.id }))));
}

/** Freier Kartenausschnitt neben bzw. über dem Panel (in Pixeln der Karte) */
function freeBox() {
  const c = map.getContainer().getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  const head = $('.tour-head').getBoundingClientRect().bottom - c.top;
  const box = { left: 0, top: Math.max(0, head), right: c.width, bottom: c.height };
  if (s.width && s.height) {
    if (s.width < c.width * 0.6 && s.left - c.left < 40) box.left = Math.max(box.left, s.right - c.left);
    else box.bottom = Math.min(box.bottom, s.top - c.top);
  }
  return box;
}

function fit(ring) {
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const c = map.getContainer().getBoundingClientRect();
  const b = freeBox();
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
    padding: { left: b.left + 30, top: b.top + 30, right: c.width - b.right + 50, bottom: c.height - b.bottom + 30 }, duration: 700,
  });
}

/* ── Liste ────────────────────────────────────────────────────────────────── */

const running = new Map();   // id → { ctl, done, total, bytes }

function status(a) {
  const run = running.get(a.id);
  const what = `${DETAIL[a.detail]?.label.split(' – ')[0] ?? ''}${a.terrain ? ' · mit Gelände' : ''}`;
  if (run) {
    const pct = run.total ? Math.floor((run.done / run.total) * 100) : 0;
    return `<small>Lädt … ${pct} % · ${size(run.bytes)}</small><progress max="100" value="${pct}"></progress>`;
  }
  if (a.status === 'ok') return `<small>${size(a.bytes)} · ${a.tiles.toLocaleString('de-DE')} Kacheln · ${what} · Stand ${DATE.format(a.at)}</small>`;
  return `<small class="area-partial"><span class="msr">error</span> Unvollständig${a.bytes ? ` (${size(a.bytes)})` : ''} – ${what}</small>`;
}

function paint() {
  const list = areas.all();
  const ul = $('.area-list');
  ul.innerHTML = list.length ? list.map((a) => {
    const run = running.get(a.id);
    return `<li class="area" data-id="${esc(a.id)}">
      <div class="area-head">
        <span class="msr area-icon">${a.status === 'ok' && !run ? 'offline_pin' : 'downloading'}</span>
        <button type="button" class="area-name" data-act="fit" title="Hinzoomen"><strong>${esc(a.name)}</strong>${status(a)}</button>
      </div>
      <div class="area-actions">
        ${run ? '<button type="button" class="link-button" data-act="stop"><span class="msr">stop_circle</span> Anhalten</button>'
          : `${a.status !== 'ok' ? '<button type="button" class="link-button" data-act="resume"><span class="msr">play_arrow</span> Weiter laden</button>' : ''}
             <button type="button" class="link-button" data-act="refresh"><span class="msr">refresh</span> Neu laden</button>
             <button type="button" class="link-button" data-act="rename"><span class="msr">edit</span> Umbenennen</button>
             <button type="button" class="link-button" data-act="delete"><span class="msr">delete</span> Löschen</button>`}
      </div>
    </li>`;
  }).join('') : '<li class="muted area-empty">Noch keine Gebiete. Tippe auf „Neues Gebiet“ und wähle auf der Karte, was offline da sein soll.</li>';
  showAreas();
  usage();
}

async function usage() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const total = areas.bytes();
  $('.area-usage').textContent = [
    total ? `Gebiete zusammen: ${size(total)}.` : '',
    est?.quota ? `Frei für WMap: ${size(Math.max(0, est.quota - est.usage))}.` : '',
  ].filter(Boolean).join(' ');
}

async function run(a, { fresh = false } = {}) {
  await ready;
  const ctl = new AbortController();
  const state = { ctl, done: 0, total: 0, bytes: 0 };
  running.set(a.id, state);
  paint();
  try {
    const r = await download(map, a, {
      fresh, signal: ctl.signal,
      onProgress: (p) => { Object.assign(state, p); paintOne(a.id); },
    });
    running.delete(a.id);
    if (ctl.signal.aborted) toast(`„${a.name}“ angehalten – später weiter laden`);
    else if (r.status === 'ok') toast(`„${a.name}“ ist offline da (${size(r.bytes)})`);
    else toast(`„${a.name}“: ${r.failed.toLocaleString('de-DE')} Kacheln fehlen – „Weiter laden“ versucht es noch einmal`);
  } catch (err) {
    running.delete(a.id);
    toast(err.message);
  }
  paint();
}

/** Nur den Fortschritt eines Eintrags neu – die Liste bleibt ruhig */
function paintOne(id) {
  const li = $(`.area[data-id="${CSS.escape(id)}"] .area-name`);
  const a = areas.get(id);
  if (li && a) li.innerHTML = `<strong>${esc(a.name)}</strong>${status(a)}`;
}

addEventListener('beforeunload', (e) => { if (running.size) e.preventDefault(); });

$('.area-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  const li = e.target.closest('.area');
  const a = li && areas.get(li.dataset.id);
  if (!b || !a) return;
  const act = b.dataset.act;
  if (act === 'fit') fit(a.ring);
  if (act === 'stop') running.get(a.id)?.ctl.abort();
  if (act === 'resume') run(a);
  if (act === 'refresh') run(a, { fresh: true });
  if (act === 'rename') {
    const name = await ask({
      icon: 'edit', title: 'Umbenennen',
      html: `<input type="text" class="area-rename" maxlength="80" value="${esc(a.name)}">`,
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Speichern', primary: true }],
      read: (dlg) => dlg.querySelector('.area-rename').value.trim(),
    });
    if (name && name !== 'no') { areas.put({ ...a, name }); paint(); }
  }
  if (act === 'delete') {
    const v = await ask({ icon: 'delete', title: `„${a.name}“ löschen?`, text: `${a.bytes ? `${size(a.bytes)} werden frei. ` : ''}Ohne Netz ist die Karte dort dann nicht mehr da.`,
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    await areas.remove(a.id);
    paint();
  }
});

/* ── Neues Gebiet: Rechteck mit zwei Ecken oder freie Form ────────────────── */

const form = $('.area-new');
const nameInput = form.querySelector('[name="name"]');
form.detail.innerHTML = Object.entries(DETAIL).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
let shape = 'rect';
let corners = [];            // Rechteck: [Nordwest, Südost] als [lon, lat]
let points = [];             // freie Form
let markers = [];
let selected = -1;           // freie Form: angetippter Punkt (zum Löschen)
let estCtl = null;
let estTimer = null;
let named = false;           // Name selbst eingegeben → nicht mehr überschreiben

const ring = () => (shape === 'rect'
  ? corners.length === 2 ? [corners[0], [corners[1][0], corners[0][1]], corners[1], [corners[0][0], corners[1][1]]] : []
  : points);

function handle(lngLat, i) {
  const el = document.createElement('div');
  el.className = `area-handle${shape === 'free' && i === selected ? ' selected' : ''}`;
  const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lngLat).addTo(map);
  let dragged = false;
  m.on('dragstart', () => { dragged = true; });
  m.on('drag', () => {
    const p = m.getLngLat().toArray();
    if (shape === 'rect') corners[i] = p; else points[i] = p;
    draw();
  });
  m.on('dragend', () => {
    if (shape === 'rect') normalize();
    schedule();
    setTimeout(() => { dragged = false; }, 0);   // der Klick nach dem Ziehen zählt nicht
  });
  if (shape === 'free') {
    // Antippen markiert den Punkt (dann „Punkt löschen“ oder Entf), doppelt tippen löscht ihn
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragged) return;
      selected = selected === i ? -1 : i;
      markers.forEach((x, j) => x.getElement().classList.toggle('selected', j === selected));
      tools();
    });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); removePoint(i); });
  }
  return m;
}

/** Punkt der freien Form löschen – der markierte, sonst der zuletzt gesetzte */
function removePoint(i = selected >= 0 ? selected : points.length - 1) {
  if (i < 0 || i >= points.length) return;
  points.splice(i, 1);
  selected = -1;
  resetHandles();
  draw();
  schedule();
}

/**
 * Neuer Punkt der freien Form: an die Kante, an der der Umriss am wenigsten
 * länger wird – ein Tipp zwischen zwei Punkten setzt ihn also genau dort ein.
 * Gerechnet in Bildschirmpunkten, damit es sich überall gleich anfühlt.
 */
function insertPoint(lngLat) {
  const p = lngLat.toArray();
  if (points.length < 3) { points.push(p); return; }
  const px = map.project(lngLat);
  const xy = points.map((q) => map.project(q));
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let best = 0, cost = Infinity;
  for (let i = 0; i < xy.length; i += 1) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    const c = d(a, px) + d(px, b) - d(a, b);
    if (c < cost) { cost = c; best = i; }
  }
  points.splice(best + 1, 0, p);
}

/** Knöpfe der freien Form: Löschen nur, wenn es einen Punkt gibt */
function tools() {
  const del = form.querySelector('[data-act="remove"]');
  del.disabled = !points.length;
  del.lastChild.textContent = selected >= 0 ? ' Markierten Punkt löschen' : ' Letzten Punkt löschen';
  form.querySelector('[data-act="clear"]').disabled = !points.length;
}

/** Ecken nach dem Ziehen wieder als Nordwest/Südost ordnen */
function normalize() {
  const [a, b] = corners;
  corners = [[Math.min(a[0], b[0]), Math.max(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])]];
  markers.forEach((m, i) => m.setLngLat(corners[i]));
}

function resetHandles() {
  for (const m of markers) m.remove();
  const list = shape === 'rect' ? corners : points;
  markers = list.map((p, i) => handle(p, i));
  tools();
}

function draw() {
  const r = ring();
  map.getSource('draft')?.setData(collection(r.length >= 3 ? [polygon(r)] : []));
  if (shape === 'free' && r.length < 3) {
    $('.area-estimate').innerHTML = '<span class="muted">Mindestens drei Punkte setzen.</span>';
  }
}

function hint() {
  $('.area-hint').textContent = shape === 'rect'
    ? 'Die Ecken des Rechtecks ziehen, um es anzupassen.'
    : 'Auf die Karte tippen, um Punkte zu setzen – ein Tipp nahe einer Kante setzt den Punkt dort ein. Punkte lassen sich ziehen; antippen markiert, doppelt tippen löscht.';
  $('.area-free-tools').hidden = shape !== 'free';
  // Doppelt tippen setzt in der freien Form Punkte, statt zu zoomen
  if (shape === 'free' && !form.hidden) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  for (const b of $$('.area-shape .chip')) b.setAttribute('aria-pressed', String(b.dataset.shape === shape));
}

function startRect() {
  const b = freeBox();
  const w = b.right - b.left, h = b.bottom - b.top;
  corners = [
    map.unproject([b.left + w * 0.2, b.top + h * 0.2]).toArray(),
    map.unproject([b.left + w * 0.8, b.top + h * 0.8]).toArray(),
  ];
}

function openNew() {
  $('.area-home').hidden = true;
  form.hidden = false;
  form.reset();
  named = false;
  shape = 'rect';
  points = [];
  selected = -1;
  startRect();
  resetHandles();
  hint();
  draw();
  schedule();
  sheet.querySelector('.view').scrollTop = 0;
}

function closeNew() {
  estCtl?.abort();
  for (const m of markers) m.remove();
  markers = [];
  map.getSource('draft')?.setData(collection([]));
  form.hidden = true;
  $('.area-home').hidden = false;
  map.doubleClickZoom.enable();
}

/** Größe neu schätzen – kurz nach der letzten Änderung */
function schedule() {
  clearTimeout(estTimer);
  estCtl?.abort();
  const r = ring();
  const save = form.querySelector('[data-act="save"]');
  save.disabled = true;
  if (r.length < 3) { draw(); return; }
  const area = { ring: r, detail: form.detail.value, terrain: form.terrain.checked };
  const t = tilesOf(area);
  if (!t) {
    $('.area-estimate').innerHTML = '<span class="area-too-big"><span class="msr">block</span> Zu groß – kleineres Gebiet oder „Übersicht“ wählen.</span>';
    return;
  }
  const count = t.vector.length + t.terrain.length;
  $('.area-estimate').innerHTML = `<span class="msr spin">progress_activity</span> ${count.toLocaleString('de-DE')} Kacheln – Größe wird berechnet …`;
  estTimer = setTimeout(async () => {
    estCtl = new AbortController();
    try {
      await ready;
      const [est, disk] = await Promise.all([estimate(map, area, { signal: estCtl.signal }), navigator.storage?.estimate?.().catch(() => null)]);
      const free = disk?.quota ? disk.quota - disk.usage : null;
      const tight = free !== null && est.bytes > free;
      $('.area-estimate').innerHTML = `<strong>ca. ${size(est.bytes)}</strong> · ${est.tiles.toLocaleString('de-DE')} Kacheln
        ${tight ? `<br><span class="area-too-big"><span class="msr">warning</span> Frei sind nur ${size(free)} – das reicht wohl nicht.</span>` : ''}`;
      save.disabled = false;
    } catch (err) {
      if (err.name !== 'AbortError') $('.area-estimate').textContent = `Größe nicht abrufbar (${err.message}) – ${count.toLocaleString('de-DE')} Kacheln`;
      if (err.name !== 'AbortError') save.disabled = false;
    }
  }, 500);
  suggestName(r);
}

/** Name vorschlagen: der Ort in der Mitte */
let nameCtl = null;
function suggestName(r) {
  if (named) return;
  nameCtl?.abort();
  nameCtl = new AbortController();
  const lon = r.reduce((s, p) => s + p[0], 0) / r.length;
  const lat = r.reduce((s, p) => s + p[1], 0) / r.length;
  geocode.reverse([lon, lat], { signal: nameCtl.signal }).then((f) => {
    const p = f?.properties ?? {};
    const place = p.city || p.town || p.village || p.county || p.name;
    if (place && !named) nameInput.value = `Gebiet um ${place}`;
  }).catch(() => {});
}

$('[data-act="new"]').addEventListener('click', openNew);
form.addEventListener('click', (e) => {
  const chip = e.target.closest('.area-shape .chip');
  if (chip && chip.dataset.shape !== shape) {
    shape = chip.dataset.shape;
    if (shape === 'rect') startRect();
    resetHandles();
    hint();
    draw();
    schedule();
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'cancel') closeNew();
  if (act === 'remove') removePoint();
  if (act === 'clear') { points = []; selected = -1; resetHandles(); draw(); schedule(); }
});
form.addEventListener('input', (e) => { if (e.target.name === 'name') named = true; });
form.addEventListener('change', (e) => { if (['detail', 'terrain'].includes(e.target.name)) schedule(); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const r = ring();
  if (r.length < 3) return;
  const a = areas.put(newArea({ name: nameInput.value.trim() || 'Gebiet', ring: r, detail: form.detail.value, terrain: form.terrain.checked }));
  closeNew();
  run(a);
});

/* Freie Form: Tippen setzt einen Punkt, Entf löscht den markierten */
map.on('click', (e) => {
  if (form.hidden || shape !== 'free') return;
  insertPoint(e.lngLat);
  selected = -1;
  resetHandles();
  draw();
  schedule();
});

addEventListener('keydown', (e) => {
  if (form.hidden || shape !== 'free' || selected < 0 || e.target.closest('input, select, textarea')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePoint(); }
});

// Beim Öffnen aus dem Dashboard mit ?neu gleich ein Gebiet anlegen
ready.then(() => { if (new URLSearchParams(location.search).has('neu')) openNew(); });
