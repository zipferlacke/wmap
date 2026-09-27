/**
 * Tourenplaner: Punkte in die Karte setzen, dazwischen wird je nach Profil
 * über passende Wege geroutet (Rennrad auf Asphalt, Gravel über Schotter,
 * Wandern über Pfade …). Unten stehen immer Zahlen, Höhenprofil und die
 * Anteile von Wegtypen und Belägen.
 *
 * Aufruf:  tour.html            neue Tour
 *          tour.html?id=…       gespeicherte Tour bearbeiten
 *          tour.html#t=…        geteilte Tour ansehen (nur lesen, übernehmbar)
 */
import { PROFILES } from './config.js';
import { createMap, showRoutes, showHover } from './map.js';
import { segment, joinSegments, wayInfo } from './routing.js';
import { ElevationProfile } from './elevation.js';
import { tours, shapeOf, encodeShare, decodeShare, toGpx, download, local } from './store.js';
import { Sheet } from './sheet.js';
import { mountAppNav } from './appnav.js';
import * as geocode from './geocode.js';
import { nearestOnLine, pointAt, simplifyTo, bbox, fmtDistance, fmtDuration, esc } from './geo.js';

const $ = (s, root = document) => root.querySelector(s);

function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ══════════════════════════════════════════════════════════════════════════
   Tour laden
   ══════════════════════════════════════════════════════════════════════════ */

const TOUR_PROFILES = Object.entries(PROFILES).filter(([, p]) => p.tour).map(([id]) => id);
const shareCode = new URLSearchParams(location.hash.slice(1)).get('t');
const idParam = new URLSearchParams(location.search).get('id');

let tour = null;
let readOnly = false;
if (shareCode) {
  try {
    tour = { ...(await decodeShare(shareCode)), id: null };
    readOnly = true;
  } catch { toast('Der Link ist unvollständig oder beschädigt'); }
} else if (idParam) {
  tour = tours.get(idParam);
  if (!tour) toast('Tour nicht gefunden – hier geht es mit einer neuen los');
}
tour ??= { id: null, name: '', description: '', profile: local.get('wmap.tourProfile', 'hike'), points: [] };
if (!TOUR_PROFILES.includes(tour.profile)) tour.profile = 'hike';

document.body.classList.toggle('readonly', readOnly);

/* ══════════════════════════════════════════════════════════════════════════
   Karte und Panel
   ══════════════════════════════════════════════════════════════════════════ */

const lastView = local.get('wmap.view');
const start = tour.points.length ? bbox(tour.points) : null;
const { map } = createMap('map', {
  center: start ? [(start[0] + start[2]) / 2, (start[1] + start[3]) / 2] : lastView?.center ?? [9.93, 51.53],
  zoom: start ? 11 : Math.max(lastView?.zoom ?? 5, 5),
  snapshot: true,
  // Beim Planen stört das automatische Neigen – der Nutzer setzt Punkte
  auto3d: false,
});

const sheet = $('#sheet');
sheet.show();
document.activeElement?.blur();                // kein Fokusrahmen um den Griff
new Sheet(sheet, { onResize: () => fitRoute(), topLimit: () => $('.tour-head').getBoundingClientRect().bottom });

function viewPadding() {
  const h = map.getContainer().clientHeight;
  const top = $('.tour-profiles').getBoundingClientRect().bottom + 16;
  let bottom = sheet.getBoundingClientRect().height + 24;
  if (top + bottom > h - 100) bottom = Math.max(24, h - 100 - top);
  return { top, bottom, left: 24, right: 64 };
}

function fitRoute() {
  const b = route?.bounds ?? (tour.points.length > 1 ? bbox(tour.points) : null);
  if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: viewPadding(), maxZoom: 15, duration: 700 });
  else if (tour.points.length === 1) map.easeTo({ center: tour.points[0], zoom: Math.max(map.getZoom(), 13), padding: viewPadding() });
}

const nameInput = $('#tour-name');
const descInput = $('#tour-desc');
nameInput.value = tour.name;
descInput.value = tour.description ?? '';
nameInput.readOnly = descInput.readOnly = readOnly;
if (readOnly) $('.save-label').textContent = 'Übernehmen';

function paintTitle() {
  document.title = `${tour.name || 'Neue Tour'} – WMap`;
}
paintTitle();

const nav = mountAppNav();
$('.tour-head').append(nav.el);

/* Profile als Chips */
function paintProfiles() {
  $('.tour-profiles').innerHTML = TOUR_PROFILES.map((id) => {
    const p = PROFILES[id];
    return `<button type="button" class="chip" role="radio" data-profile="${id}" aria-pressed="${id === tour.profile}"
      aria-checked="${id === tour.profile}"><span class="msr">${p.icon}</span>${esc(p.label)}</button>`;
  }).join('');
}
paintProfiles();
$('.tour-profiles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-profile]');
  if (!b || b.dataset.profile === tour.profile) return;
  tour.profile = b.dataset.profile;
  local.set('wmap.tourProfile', tour.profile);
  paintProfiles();
  recompute();
});

/* ══════════════════════════════════════════════════════════════════════════
   Punkte setzen
   ══════════════════════════════════════════════════════════════════════════ */

const undoStack = [];

function change(fn) {
  undoStack.push(tour.points.map((p) => p.slice()));
  if (undoStack.length > 50) undoStack.shift();
  fn();
  recompute();
}

$('#undo').addEventListener('click', () => {
  const prev = undoStack.pop();
  if (!prev) return;
  tour.points = prev;
  recompute();
});
$('#reverse').addEventListener('click', () => change(() => tour.points.reverse()));
$('#roundtrip').addEventListener('click', () => {
  if (tour.points.length < 2) return;
  change(() => tour.points.push(tour.points[0].slice()));
});
$('#clear').addEventListener('click', () => {
  if (!tour.points.length) return;
  change(() => { tour.points = []; });
});

let markers = [];
let popup = null;

function markerEl(i, n) {
  const el = document.createElement('div');
  const kind = i === 0 ? 'start' : i === n - 1 ? 'dest' : 'via';
  el.className = `wp-marker ${kind}`;
  el.innerHTML = kind === 'start' ? '<span class="msr">trip_origin</span>'
    : kind === 'dest' ? '<span class="msr">sports_score</span>' : `<span class="wp-num">${i}</span>`;
  return el;
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  const n = tour.points.length;
  markers = tour.points.map((p, i) => {
    const el = markerEl(i, n);
    const m = new maplibregl.Marker({ element: el, draggable: !readOnly }).setLngLat(p).addTo(map);
    m.on('dragend', () => change(() => { tour.points[i] = m.getLngLat().toArray(); }));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (readOnly) return;
      pointPopup(i);
    });
    return m;
  });
  $('#undo').disabled = !undoStack.length;
  const hint = $('.tour-hint');
  hint.hidden = readOnly || n >= 2;
  hint.textContent = n === 0 ? 'Tippe in die Karte, um den Start zu setzen' : 'Und jetzt das nächste Ziel antippen';
}

function pointPopup(i) {
  popup?.remove();
  const el = document.createElement('div');
  el.className = 'popup context';
  const entries = [['delete', 'Punkt entfernen', () => change(() => tour.points.splice(i, 1))]];
  if (i > 0) entries.push(['trip_origin', 'Hier starten', () => change(() => { tour.points = tour.points.slice(i).concat(tour.points.slice(0, i)); })]);
  for (const [icon, text, fn] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="msr">${icon}</span> ${esc(text)}`;
    b.addEventListener('click', () => { popup?.remove(); fn(); });
    el.append(b);
  }
  popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setLngLat(tour.points[i]).setDOMContent(el).addTo(map);
}

map.on('click', (e) => {
  if (readOnly || e.originalEvent?.target?.closest?.('.wp-marker')) return;
  const p = e.lngLat.toArray();
  // Auf die Linie getippt: dort einen Punkt einfügen statt hinten anhängen
  const onLine = route && map.getLayer('route-main')
    && map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['route-main'] }).length;
  if (onLine) {
    const along = nearestOnLine(route.coords, route.cum, p).along;
    const i = route.stops.findIndex((m) => m > along);
    change(() => tour.points.splice(i < 1 ? tour.points.length - 1 : i, 0, p));
    return;
  }
  change(() => tour.points.push(p));
});

/* ══════════════════════════════════════════════════════════════════════════
   Route, Zahlen, Wege
   ══════════════════════════════════════════════════════════════════════════ */

let route = null;
let seq = 0;

const elevation = new ElevationProfile($('.elevation', sheet), {
  onHover(km) {
    if (!route || km === null) { showHover(map, null); return; }
    const total = route.cum[route.cum.length - 1];
    showHover(map, pointAt(route.coords, route.cum, km * 1000 * (total / (route.length || total))));
  },
});

map.on('mousemove', 'route-main', (e) => {
  if (!route) return;
  const s = nearestOnLine(route.coords, route.cum, e.lngLat.toArray());
  showHover(map, s.point);
  elevation.showAt((s.along / 1000) * ((route.length || 1) / route.cum[route.cum.length - 1]));
});
map.on('mouseleave', 'route-main', () => { showHover(map, null); elevation.showAt(null); });

function status(text, error = false) {
  const el = $('.tour-status');
  el.hidden = !text;
  el.textContent = text ?? '';
  el.classList.toggle('error', error);
}

async function recompute({ fit = false } = {}) {
  const my = ++seq;
  renderMarkers();
  if (tour.points.length < 2) {
    route = null;
    showRoutes(map, [], -1);
    elevation.show(null);
    paintStats();
    $('.tour-ways').innerHTML = '';
    status(null);
    scheduleSave();
    return;
  }
  status('Route wird berechnet …');
  try {
    const pairs = tour.points.slice(1).map((b, i) => [tour.points[i], b]);
    const parts = await Promise.all(pairs.map(([a, b]) => segment(a, b, tour.profile)));
    if (my !== seq) return;
    route = { ...joinSegments(parts, tour.profile), id: 0 };
    // Wo entlang der Linie die gesetzten Punkte liegen – für „Punkt einfügen“
    let acc = 0;
    route.stops = [0, ...parts.map((p) => (acc += p.cum[p.cum.length - 1]))];
    showRoutes(map, [route], 0);
    elevation.show(route);
    paintStats();
    status(null);
    if (fit) fitRoute();
    loadWays(my);
    scheduleSave();
  } catch (err) {
    if (my === seq) status(err.message, true);
  }
}

function paintStats() {
  $('.st-length').textContent = route ? fmtDistance(route.length) : '–';
  $('.st-time').textContent = route ? fmtDuration(route.time) : '–';
  $('.st-up').textContent = route ? `${route.ascent} m` : '–';
  $('.st-down').textContent = route ? `${route.descent} m` : '–';
}

/* Wegtypen und Beläge als Balken – wie viel Asphalt, Schotter, Pfad … */
const WAY_COLORS = {
  Radweg: '#1c7ed6', Fußweg: '#74c0fc', Pfad: '#2f9e44', Bergpfad: '#5c3d1e', Feldweg: '#a9791b', Treppe: '#868e96',
  Fähre: '#15aabf', Schnellstraße: '#c92a2a', Hauptstraße: '#f76707', Wohnstraße: '#fab005', Nebenstraße: '#ced4da',
  Asphalt: '#495057', Befestigt: '#868e96', Pflaster: '#adb5bd', Verdichtet: '#c9a36b', Erdweg: '#8b5e34',
  Schotter: '#b08968', Naturpfad: '#40c057', Unwegsam: '#e03131', Unbekannt: '#dee2e6',
};

async function loadWays(my) {
  const box = $('.tour-ways');
  box.innerHTML = '<p class="muted">Wegtypen werden ermittelt …</p>';
  try {
    const info = await wayInfo(route.coords, tour.profile);
    if (my !== seq) return;
    const block = (title, rows) => {
      const total = rows.reduce((a, [, m]) => a + m, 0) || 1;
      const main = rows.filter(([, m]) => m / total >= 0.005);
      return `<div class="ways-block">
        <h3 class="section-title">${title}</h3>
        <div class="ways-bar">${main.map(([n, m]) => `<span style="flex:${m};background:${WAY_COLORS[n] ?? '#adb5bd'}" title="${esc(n)}"></span>`).join('')}</div>
        <ul class="ways-legend">${main.map(([n, m]) => `
          <li><i style="background:${WAY_COLORS[n] ?? '#adb5bd'}"></i>${esc(n)} <b>${fmtDistance(m)}</b></li>`).join('')}</ul>
      </div>`;
    };
    box.innerHTML = block('Wegtypen', info.ways) + block('Beläge', info.surfaces);
  } catch {
    box.innerHTML = '';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Speichern, Teilen, Export, Löschen
   ══════════════════════════════════════════════════════════════════════════ */

async function defaultName() {
  if (!tour.points.length) return `Tour vom ${new Date().toLocaleDateString('de-DE')}`;
  try {
    const f = await geocode.reverse(tour.points[0]);
    const d = f && geocode.describe(f);
    const place = f?.properties.city ?? f?.properties.town ?? f?.properties.village ?? d?.title;
    if (place) return `${PROFILES[tour.profile].label} ab ${place}`;
  } catch { /* dann eben mit Datum */ }
  return `Tour vom ${new Date().toLocaleDateString('de-DE')}`;
}

function snapshotTour(preview) {
  return {
    ...tour,
    name: tour.name || 'Neue Tour',
    shape: route ? shapeOf(simplifyTo(route.coords, 1500)) : null,
    stats: route ? { length: route.length, time: route.time, ascent: route.ascent, descent: route.descent } : null,
    preview: preview === undefined ? tour.preview ?? null : preview,
  };
}

function markSaved(text = 'Gespeichert') {
  const el = $('.tour-saved');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2000);
}

/** Automatisch speichern, sobald es eine Strecke gibt – nichts geht verloren. */
const scheduleSave = debounce(async () => {
  if (readOnly || tour.points.length < 2) return;
  await save();
}, 900);

async function save(preview) {
  if (!tour.name) {
    tour.name = await defaultName();
    if (document.activeElement !== nameInput) nameInput.value = tour.name;
    paintTitle();
  }
  const isNew = !tour.id;
  tour.id ??= tours.newId();
  try {
    const saved = tours.save(snapshotTour(preview));
    tour.preview = saved.preview;
    tour.created = saved.created;
  } catch (err) { toast(err.message); return; }
  if (isNew) history.replaceState(null, '', `./tour.html?id=${encodeURIComponent(tour.id)}`);
  markSaved();
}

/** Vorschaubild: Route einpassen, Karte zeichnen lassen, Bild verkleinern. */
async function capturePreview() {
  if (!route) return null;
  const b = route.bounds;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 50, duration: 0, pitch: 0, bearing: 0 });
  await new Promise((r) => map.once('idle', r));
  try {
    const src = map.getCanvas();
    const W = 480, H = 300;
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const s = Math.max(W / src.width, H / src.height);
    c.getContext('2d').drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;     // Kachelserver ohne CORS → kein Bild, die Liste zeichnet dann die Linie
  } finally {
    fitRoute();
  }
}

$('#save').addEventListener('click', async () => {
  if (readOnly) {
    // Geteilte Tour als eigene übernehmen
    readOnly = false;
    document.body.classList.remove('readonly');
    nameInput.readOnly = descInput.readOnly = false;
    $('.save-label').textContent = 'Speichern';
    tour.id = null;
    history.replaceState(null, '', './tour.html');
    renderMarkers();
  }
  if (tour.points.length < 2) { toast('Setze mindestens zwei Punkte'); return; }
  await save(await capturePreview());
  toast('Tour gespeichert');
});

nameInput.addEventListener('input', () => {
  tour.name = nameInput.value.trim();
  paintTitle();
  scheduleSave();
});
descInput.addEventListener('input', () => {
  tour.description = descInput.value;
  scheduleSave();
});

/* Teilen: Link trägt die Tour selbst */
const shareDialog = $('#share-dialog');
$('#share').addEventListener('click', async () => {
  if (tour.points.length < 2) { toast('Erst eine Strecke planen'); return; }
  const code = await encodeShare({ ...tour, name: tour.name || nameInput.value || 'Tour' });
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#t=${code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: tour.name, text: `Tour: ${tour.name}`, url }); return; } catch { /* dann Dialog */ }
  }
  $('#share-link').value = url;
  shareDialog.showModal();
  $('#share-link').select();
});
shareDialog.addEventListener('click', async (e) => {
  const b = e.target.closest('button[value]');
  if (!b) return;
  if (b.value === 'copy') {
    try { await navigator.clipboard.writeText($('#share-link').value); toast('Link kopiert'); } catch {
      $('#share-link').select();
      document.execCommand?.('copy');
      toast('Link markiert – bitte kopieren');
    }
  }
  shareDialog.close();
});

/* GPX mit Höhen */
$('#export').addEventListener('click', () => {
  if (!route) { toast('Erst eine Strecke planen'); return; }
  const total = route.cum[route.cum.length - 1] || 1;
  const ele = route.elevation;
  const eleAt = (i) => {
    if (!ele.length) return null;
    const km = (route.cum[i] / 1000) * ((route.length || total) / total);
    let lo = 0, hi = ele.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ele[mid][0] <= km) lo = mid; else hi = mid; }
    const [k0, h0] = ele[lo], [k1, h1] = ele[hi];
    return k1 === k0 ? h0 : h0 + ((h1 - h0) * (km - k0)) / (k1 - k0);
  };
  const name = tour.name || 'tour';
  const file = `${name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '') || 'tour'}.gpx`;
  download(file, toGpx({ ...tour, name }, route.coords, eleAt));
});

$('#delete').addEventListener('click', () => {
  if (!tour.id) { location.href = './tours.html'; return; }
  if (!confirm(`„${tour.name}“ wirklich löschen?`)) return;
  tours.remove(tour.id);
  location.href = './tours.html';
});

/* Beim Verlassen das Vorschaubild nachziehen, falls es noch keins gibt */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden' && !readOnly && tour.id && !tour.preview && route) {
    await save(await capturePreview());
  }
});

/* ── Los ─────────────────────────────────────────────────────────────────── */

map.on('load', () => recompute({ fit: true }));

/* Profil-Leiste und Hinweis sitzen unter dem Kopf, dessen Höhe schwankt (Zeilenumbruch) */
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--panel-h', `${Math.round($('.tour-head').getBoundingClientRect().bottom)}px`);
}).observe($('.tour-head'));
