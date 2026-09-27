/**
 * Ein aufgezeichneter Weg: Karte mit der Linie, nach Tempo eingefärbt
 * (langsam orange, schnell grün), darunter Zahlen und Höhenprofil.
 *
 * Aus einem Weg wird mit „Als Tour“ eine Tour zum Nachfahren oder Teilen –
 * dafür reichen ein paar Dutzend Stützpunkte, der Planer legt den Rest auf
 * die Wege.
 *
 * Aufruf: track.html?id=…
 */
import { createMap, showHover } from './map.js';
import { heightsAlong } from './routing.js';
import { ElevationProfile } from './elevation.js';
import { tracks, trackCoords, trackGpx, PROFILE_GROUP } from './tracks.js';
import { tours, shapeOf, encodeShare, download } from './store.js';
import { Sheet } from './sheet.js';
import { mountAppNav } from './appnav.js';
import { cumulative, pointAt, nearestOnLine, simplifyTo, distance, fmtDistance, fmtDuration, esc } from './geo.js';
import { GROUP } from './wege.js';

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

const id = new URLSearchParams(location.search).get('id');
const track = id ? await tracks.get(id).catch(() => null) : null;
if (!track) {
  document.body.innerHTML = `<div class="tour-empty"><span class="msr">timeline</span><p>Diesen Weg gibt es auf diesem Gerät nicht (mehr).</p>
    <a class="button primary" href="./tours.html#wege">Zu meinen Wegen</a></div>`;
  throw new Error('Weg nicht gefunden');
}

const coords = trackCoords(track);
const cum = cumulative(coords);
const group = GROUP[PROFILE_GROUP[track.profile] ?? 'foot'];
const [w, s, e, n] = track.bbox;

const { map } = createMap('map', { center: [(w + e) / 2, (s + n) / 2], zoom: 12, auto3d: false, snapshot: true });
$('.tour-head').append(mountAppNav().el);

const sheet = $('#sheet');
sheet.show();
document.activeElement?.blur();                // kein Fokusrahmen um den Griff
new Sheet(sheet, { onResize: () => fit(), topLimit: () => $('.tour-head').getBoundingClientRect().bottom });

function fit() {
  const h = map.getContainer().clientHeight;
  const top = $('.tour-head').getBoundingClientRect().bottom + 16;
  let bottom = sheet.getBoundingClientRect().height + 24;
  if (top + bottom > h - 100) bottom = Math.max(24, h - 100 - top);
  map.fitBounds([[w, s], [e, n]], { padding: { top, bottom, left: 24, right: 64 }, maxZoom: 16, duration: 600 });
}

/* ── Name ─────────────────────────────────────────────────────────────────── */

const nameInput = $('#tour-name');
nameInput.value = track.name ?? '';
document.title = `${track.name || 'Weg'} – WMap`;
let nameTimer = null;
nameInput.addEventListener('input', () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => {
    track.name = nameInput.value.trim();
    await tracks.put(track);
    document.title = `${track.name || 'Weg'} – WMap`;
    const saved = $('.tour-saved');
    saved.textContent = 'Gespeichert';
    saved.classList.add('show');
    setTimeout(() => saved.classList.remove('show'), 1500);
  }, 600);
});

/* ── Zahlen ───────────────────────────────────────────────────────────────── */

const moving = track.moving || (track.end - track.start) / 1000;
$('.st-length').textContent = fmtDistance(track.length);
$('.st-time').textContent = fmtDuration(moving);
$('.st-speed').textContent = moving ? (track.length / moving * 3.6).toFixed(1).replace('.', ',') : '–';
const DATE = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
$('.track-when').innerHTML = `<span class="msr" style="color:${group.color}">${group.icon}</span>
  ${DATE.format(track.start)}, ${TIME.format(track.start)}–${TIME.format(track.end)} Uhr
  ${track.from || track.to ? `<br><span class="muted">${esc([track.from, track.to].filter(Boolean).map((x) => x.split(',')[0]).join(' → '))}</span>` : ''}`;

/* ── Linie nach Tempo ─────────────────────────────────────────────────────── */

/**
 * Farbverlauf entlang der Linie: Tempo je Abschnitt, geglättet, eingeordnet
 * zwischen dem langsamsten und dem schnellsten Zehntel des Wegs.
 */
function speedGradient() {
  const t = track.times;
  if (!t || t.length !== coords.length || coords.length < 3) return null;
  const v = [];
  for (let i = 1; i < coords.length; i += 1) {
    const dt = t[i] - t[i - 1];
    v.push(dt > 0 ? distance(coords[i - 1], coords[i]) / dt : null);
  }
  const ok = v.filter((x) => x !== null && x < 70).sort((a, b) => a - b);
  if (ok.length < 3) return null;
  const lo = ok[Math.floor(ok.length * 0.1)], hi = ok[Math.floor(ok.length * 0.9)];
  if (hi - lo < 0.5) return null;
  const total = cum[cum.length - 1];
  const color = (x) => {
    const k = Math.max(0, Math.min(1, ((x ?? lo) - lo) / (hi - lo)));
    return `hsl(${Math.round(25 + k * 110)} 80% ${Math.round(48 - k * 8)}%)`;
  };
  // Höchstens ~150 Stufen; Fortschritt muss streng steigen
  const stops = [];
  let last = -1;
  const step = Math.max(1, Math.floor(v.length / 150));
  for (let i = 0; i < v.length; i += step) {
    const p = ((cum[i] + cum[i + 1]) / 2) / total;
    if (p <= last + 1e-6) continue;
    const win = v.slice(Math.max(0, i - 2), i + step + 2).filter((x) => x !== null);
    stops.push(p, color(win.length ? win.reduce((a, b) => a + b) / win.length : null));
    last = p;
  }
  if (stops.length < 4) return null;
  $('.track-legend').hidden = false;
  $('.track-top').textContent = track.top ? `max. ${Math.round(track.top * 3.6)} km/h` : '';
  return ['interpolate', ['linear'], ['line-progress'], ...stops];
}

map.on('load', () => {
  map.addSource('track', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
  map.addLayer({ id: 'track-casing', type: 'line', source: 'track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 11] } });
  const gradient = speedGradient();
  map.addLayer({
    id: 'track-line', type: 'line', source: 'track', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 7], ...(gradient ? { 'line-gradient': gradient } : { 'line-color': group.color }) },
  });
  for (const [p, cls, icon] of [[coords[0], 'start', 'trip_origin'], [coords.at(-1), 'dest', 'sports_score']]) {
    const el = document.createElement('div');
    el.className = `wp-marker ${cls}`;
    el.innerHTML = `<span class="msr">${icon}</span>`;
    new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map);
  }
  fit();
});

/* ── Höhenprofil ──────────────────────────────────────────────────────────── */

let heights = null;
const elevation = new ElevationProfile($('.elevation', sheet), {
  onHover(km) {
    showHover(map, km === null ? null : pointAt(coords, cum, km * 1000 * (cum.at(-1) / (heights?.length || cum.at(-1)))));
  },
});
(async () => {
  try {
    const h = await heightsAlong(coords);
    if (!h.elevation.length) return;
    heights = { ...h, length: h.elevation.at(-1)[0] * 1000 };
    elevation.show(heights);
    $('.st-up').textContent = `${h.ascent} m`;
  } catch { elevation.show(null); }
})();

map.on('mousemove', 'track-line', (ev) => {
  const p = nearestOnLine(coords, cum, ev.lngLat.toArray());
  showHover(map, p.point);
  if (heights) elevation.showAt(p.along / 1000 * (heights.length / cum.at(-1)));
});
map.on('mouseleave', 'track-line', () => { showHover(map, null); elevation.showAt(null); });

/* ── Aktionen ─────────────────────────────────────────────────────────────── */

/** Tour-Profil zum Weg: Auto → Auto, Rad → Tourenrad, zu Fuß → Wandern bzw. Spazieren */
function tourProfile() {
  const g = PROFILE_GROUP[track.profile] ?? 'foot';
  if (g === 'car') return 'drive';
  if (g === 'bike') return ['road', 'gravel', 'mtb', 'tour'].includes(track.profile) ? track.profile : 'tour';
  return (heights?.ascent ?? 0) > 150 || track.length > 8000 ? 'hike' : 'walk';
}

function asTour() {
  return {
    id: tours.newId(),
    name: track.name || 'Tour',
    description: `Aufgezeichnet am ${DATE.format(track.start)}`,
    profile: tourProfile(),
    // Stützpunkte: genug, dass der Planer dem Weg folgt, aber handlich
    points: simplifyTo(coords, Math.min(40, Math.max(8, Math.round(track.length / 800)))),
    shape: shapeOf(coords),
    stats: { length: track.length, time: moving, ascent: heights?.ascent ?? 0, descent: heights?.descent ?? 0 },
  };
}

$('#as-tour').addEventListener('click', () => {
  try {
    const t = tours.save(asTour());
    location.href = `./tour.html?id=${encodeURIComponent(t.id)}`;
  } catch (err) { toast(err.message); }
});

$('#export').addEventListener('click', () => {
  download(`${(track.name || 'weg').replace(/[^\wäöüß]+/gi, '-')}.gpx`, trackGpx(track));
});

$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#t=${await encodeShare(asTour())}`;
  if (navigator.share) { try { await navigator.share({ title: track.name, url }); return; } catch { /* dann kopieren */ } }
  try { await navigator.clipboard.writeText(url); toast('Link kopiert – er öffnet den Weg als Tour'); } catch { prompt('Link zum Teilen:', url); }
});

$('#delete').addEventListener('click', async () => {
  if (!confirm(`„${track.name || 'Weg'}“ wirklich löschen?`)) return;
  await tracks.remove(track.id);
  location.href = './tours.html#wege';
});
