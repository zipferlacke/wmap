/**
 * Meine Wege: alles, was aufgezeichnet wurde – nach Jahren. Oben die Summen
 * (Wege, Kilometer, Stunden, je Auto/Rad/zu Fuß), darunter eine Karte mit
 * allen Wegen des Jahres und die Liste nach Monaten.
 *
 * Alles liegt im Browser (tracks.js). Weg auf ein anderes Gerät: Sicherung
 * speichern und dort laden – oder GPX.
 */
import { createMap } from './map.js';
import { tracks, trackCoords, yearStats, parseGpx, backup, restore, PROFILE_GROUP } from './tracks.js';
import { download } from './store.js';
import { svgPreview } from './preview.js';
import { fmtDistance, fmtDuration, esc } from './geo.js';

export const GROUP = {
  car: { label: 'Auto', icon: 'directions_car', color: '#1a73e8' },
  bike: { label: 'Rad', icon: 'directions_bike', color: '#2f9e44' },
  foot: { label: 'Zu Fuß', icon: 'directions_walk', color: '#e8590c' },
};
const groupOf = (t) => GROUP[PROFILE_GROUP[t.profile] ?? 'foot'];

const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

const km = (m) => (m >= 100000 ? `${Math.round(m / 1000).toLocaleString('de-DE')} km` : fmtDistance(m));

export function mountWege(root) {
  let all = [];
  let year = null;                  // null = alle Jahre
  let map = null;
  let shown = false;

  root.innerHTML = `
    <div class="wege-years chip-row" role="radiogroup" aria-label="Jahr"></div>
    <section class="wege-summary"></section>
    <div class="wege-map-wrap"><div id="wege-map" class="wege-map"></div></div>
    <div class="wege-list"></div>
    <footer class="wege-tools">
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-act="gpx"></label>
      <button type="button" class="button" data-act="backup"><span class="msr">save</span> Sicherung speichern</button>
      <label class="button"><span class="msr">settings_backup_restore</span> Sicherung laden<input type="file" accept=".json,application/json" hidden data-act="restore"></label>
      <p class="muted">Deine Wege bleiben nur auf diesem Gerät – kein Konto, kein Server. Mit der Sicherungsdatei nimmst du sie auf ein anderes Gerät mit.</p>
    </footer>`;
  const $ = (s) => root.querySelector(s);

  async function load() {
    try { all = await tracks.all(); } catch { all = []; }
    const years = [...new Set(all.map((t) => new Date(t.start).getFullYear()))].sort((a, b) => b - a);
    if (year !== null && !years.includes(year)) year = null;
    year ??= years[0] ?? null;
    paint(years);
  }

  function paint(years) {
    const stats = yearStats(all);
    $('.wege-years').innerHTML = years.length > 0
      ? [...years.map((y) => `<button type="button" class="chip" role="radio" data-year="${y}" aria-pressed="${y === year}" aria-checked="${y === year}">${y}</button>`),
        years.length > 1 ? `<button type="button" class="chip" role="radio" data-year="all" aria-pressed="${year === 'all'}" aria-checked="${year === 'all'}">Alle</button>` : ''].join('')
      : '';
    const list = year === 'all' ? all : all.filter((t) => new Date(t.start).getFullYear() === year);

    if (!all.length) {
      $('.wege-summary').innerHTML = `<div class="tour-empty">
        <span class="msr">timeline</span>
        <p>Noch keine Wege aufgezeichnet.</p>
        <p class="muted">Wenn du navigierst, merkt sich WMap die Strecke. Oder starte selbst eine Aufzeichnung – für Spaziergänge, Radtouren, Wanderungen.</p>
        <a class="button primary" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a></div>`;
      $('.wege-map-wrap').hidden = true;
      $('.wege-list').innerHTML = '';
      return;
    }

    // Summen – für ein Jahr aus yearStats, für „Alle“ zusammengezählt
    const s = year === 'all'
      ? Object.values(stats).reduce((a, b) => ({ n: a.n + b.n, length: a.length + b.length, moving: a.moving + b.moving,
        by: Object.fromEntries(Object.keys(GROUP).map((g) => [g, (a.by[g] ?? 0) + (b.by[g] ?? 0)])) }), { n: 0, length: 0, moving: 0, by: {} })
      : stats[year];
    $('.wege-summary').innerHTML = `
      <div class="wege-totals">
        <div><strong>${s.n}</strong><small>${s.n === 1 ? 'Weg' : 'Wege'}</small></div>
        <div><strong>${km(s.length)}</strong><small>Strecke</small></div>
        <div><strong>${fmtDuration(s.moving)}</strong><small>unterwegs</small></div>
      </div>
      <div class="wege-groups">${Object.entries(GROUP).filter(([g]) => s.by[g]).map(([g, x]) =>
        `<span style="--c:${x.color}"><span class="msr">${x.icon}</span>${km(s.by[g])}</span>`).join('')}</div>`;

    // Liste nach Monaten
    let month = '';
    $('.wege-list').innerHTML = list.map((t) => {
      const m = MONTH.format(t.start);
      const head = m !== month ? `<h2 class="wege-month">${m}</h2>` : '';
      month = m;
      const g = groupOf(t);
      return `${head}<a class="weg" href="./track.html?id=${encodeURIComponent(t.id)}" data-id="${esc(t.id)}">
        ${svgPreview(trackCoords(t), { color: g.color, w: 120, h: 90, cls: 'weg-thumb' })}
        <span class="weg-body">
          <strong>${esc(t.name || 'Weg')}</strong>
          <small>${DAY.format(t.start)} · ${TIME.format(t.start)}${t.kind === 'nav' ? ' · Navigation' : t.kind === 'gpx' ? ' · GPX' : ''}</small>
          <span class="weg-meta"><span class="msr" style="color:${g.color}">${g.icon}</span>${fmtDistance(t.length)} · ${fmtDuration(t.moving || (t.end - t.start) / 1000)}</span>
        </span>
      </a>`;
    }).join('');

    $('.wege-map-wrap').hidden = false;
    paintMap(list);
  }

  function paintMap(list) {
    if (!shown) return;
    if (!map) {
      ({ map } = createMap('wege-map', { auto3d: false, zoom: 5 }));
      map.on('load', () => {
        map.addSource('wege', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'wege-casing', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 14, 7], 'line-opacity': 0.8 } });
        map.addLayer({ id: 'wege-line', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 14, 4], 'line-opacity': 0.85 } });
        map.addLayer({ id: 'wege-hover', type: 'line', source: 'wege', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 4, 14, 8] } });
        map.on('click', 'wege-line', (e) => { location.href = `./track.html?id=${encodeURIComponent(e.features[0].properties.id)}`; });
        map.on('mousemove', 'wege-line', (e) => { map.getCanvas().style.cursor = 'pointer'; hover(e.features[0].properties.id); });
        map.on('mouseleave', 'wege-line', () => { map.getCanvas().style.cursor = ''; hover(null); });
        setLines(currentList());
      });
    } else if (map.getSource('wege')) setLines(list);
  }

  function currentList() {
    return year === 'all' ? all : all.filter((t) => new Date(t.start).getFullYear() === year);
  }

  function setLines(list) {
    map.getSource('wege').setData({ type: 'FeatureCollection', features: list.map((t) => ({
      type: 'Feature', properties: { id: t.id, color: groupOf(t).color },
      geometry: { type: 'LineString', coordinates: trackCoords(t) },
    })) });
    const b = list.reduce((a, t) => [Math.min(a[0], t.bbox[0]), Math.min(a[1], t.bbox[1]), Math.max(a[2], t.bbox[2]), Math.max(a[3], t.bbox[3])], [180, 90, -180, -90]);
    if (list.length) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, maxZoom: 14, duration: 0 });
  }

  function hover(id) {
    map?.getLayer('wege-hover') && map.setFilter('wege-hover', ['==', ['get', 'id'], id ?? '']);
    root.querySelectorAll('.weg.hover').forEach((el) => el.classList.remove('hover'));
    if (id) root.querySelector(`.weg[data-id="${CSS.escape(id)}"]`)?.classList.add('hover');
  }

  root.addEventListener('click', (e) => {
    const y = e.target.closest('[data-year]');
    if (y) { year = y.dataset.year === 'all' ? 'all' : +y.dataset.year; load(); return; }
    if (e.target.closest('[data-act="backup"]')) saveBackup();
  });
  root.addEventListener('mouseover', (e) => { const w = e.target.closest('.weg'); if (w && map) hover(w.dataset.id); });
  root.addEventListener('mouseleave', () => hover(null));
  root.addEventListener('change', async (e) => {
    const inp = e.target;
    if (!inp.files?.length) return;
    try {
      if (inp.dataset.act === 'gpx') {
        let n = 0;
        for (const f of inp.files) {
          for (const t of parseGpx(await f.text())) { await tracks.put(guessProfile(t)); n += 1; }
        }
        alert(n ? `${n} ${n === 1 ? 'Weg' : 'Wege'} importiert` : 'In der Datei war kein Weg');
      } else if (inp.dataset.act === 'restore') {
        const n = await restore(await inp.files[0].text());
        alert(`${n} Einträge aus der Sicherung übernommen`);
      }
    } catch (err) { alert(err.message); }
    inp.value = '';
    year = null;
    load();
  });

  async function saveBackup() {
    download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.json`, await backup(), 'application/json');
  }

  return {
    show() {
      shown = true;
      if (map) map.resize();
      load();
    },
  };
}

/** Importierte Wege: am Tempo erkennen, womit man unterwegs war. */
function guessProfile(t) {
  const v = t.moving ? t.length / t.moving : 0;          // m/s
  const profile = v > 9 ? 'car' : v > 3.2 ? 'bike' : 'foot';
  return { ...t, profile };
}

