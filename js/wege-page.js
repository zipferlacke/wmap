/**
 * Meine Touren: alles Eigene auf einer Karte – zwei Reiter im Panel.
 *
 *   Geplant        Touren aus dem Planer, übernommene bekannte Wege, GPX-
 *                  Importe. Gruppiert nach Zu Fuß / Rad / Auto.
 *   Aufgezeichnet  Wege, die du gefahren oder gelaufen bist (Aufzeichnung,
 *                  Navigation, GPX mit Zeiten). Nach Jahren gruppiert und
 *                  gefärbt; der gewählte Weg zeigt Tempo, Höhe und Puls.
 *
 * Das Panel (Rechner links, Handy unten) zeigt die Liste – Suche oben,
 * Tabelle je Gruppe – oder eine Tour/einen Weg im Detail. Kopfzeile siehe
 * mappage.js: ← Übersicht bzw. Liste, ✕ zur Karte, Griff zum Einklappen.
 *
 * Aufruf: wege.html · ?tab=geplant · ?tour=… (geplante Tour) · ?id=… (Weg)
 */
import { createMap, showHover } from './map.js';
import { heightsAlong } from './routing.js';
import { ElevationProfile } from './elevation.js';
import { tracks, trackCoords, trackGpx, parseGpx, sameTrack, backup, restore, PROFILE_GROUP } from './tracks.js';
import { tours, shapeOf, coordsOf, encodeShare, toGpx, download } from './store.js';
import { PROFILES } from './config.js';
import { ask } from './ui.js';
import { share } from './share.js';
import { mountFolder, tourFromGpx } from './folder.js';
import { mapPage } from './mappage.js';
import { cumulative, pointAt, nearestOnLine, simplifyTo, distance, fmtDistance, fmtDuration, esc } from './geo.js';

const $ = (s, root = document) => root.querySelector(s);

export const GROUP = {
  foot: { label: 'Zu Fuß', icon: 'directions_walk', color: '#e8590c' },
  bike: { label: 'Rad', icon: 'directions_bike', color: '#2f9e44' },
  car: { label: 'Auto', icon: 'directions_car', color: '#1a73e8' },
};
const groupKey = (t) => PROFILE_GROUP[t.profile] ?? 'foot';
const groupOf = (t) => GROUP[groupKey(t)];
const YEAR_COLORS = ['#1a73e8', '#e8590c', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e64980', '#5c940d', '#495057'];
const yearOf = (t) => new Date(t.start).getFullYear();

const DATE = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const SHORT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const LONG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const km = (m) => (m >= 100000 ? `${Math.round(m / 1000).toLocaleString('de-DE')} km` : fmtDistance(m));
const moving = (t) => t.moving || (t.end - t.start) / 1000;

function toast(text) {
  let el = $('#toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ── Zustand ──────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
let tab = params.get('tab') === 'geplant' || params.has('tour') ? 'geplant' : 'wege';
let all = [];                      // aufgezeichnete Wege
let planned = [];                  // geplante Touren
const query = { wege: '', geplant: '' };
let selected = null;               // gewählter Weg oder Tour
let years = [];
const yearColor = (y) => YEAR_COLORS[Math.min(Math.max(0, years.indexOf(y)), YEAR_COLORS.length - 1)];

const panel = $('.wege-panel');
const content = $('.wege-content');

const { map } = createMap('map', { auto3d: false, zoom: 5 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage(panel, { map, onFit: () => fitView() });

function fitView() {
  const list = selected ? [selected] : tab === 'geplant' ? visiblePlanned() : visible();
  const boxes = list.map((t) => t.bbox ?? bboxOfTour(t)).filter(Boolean);
  if (!boxes.length) return;
  const b = boxes.reduce((a, x) => [Math.min(a[0], x[0]), Math.min(a[1], x[1]), Math.max(a[2], x[2]), Math.max(a[3], x[3])], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: page.padding(), maxZoom: 15, duration: 600 });
}

const bboxCache = new Map();
function bboxOfTour(t) {
  if (!t.shape) return null;
  if (!bboxCache.has(t.shape)) {
    const c = coordsOf(t.shape);
    bboxCache.set(t.shape, c.length ? c.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]) : null);
  }
  return bboxCache.get(t.shape);
}

/* ── Liste ────────────────────────────────────────────────────────────────── */

const norm = (s) => String(s ?? '').toLowerCase();
function visible() {
  const q = norm(query.wege).trim();
  if (!q) return all;
  return all.filter((t) => [t.name, t.from, t.to, yearOf(t), DATE.format(t.start), LONG.format(t.start), groupOf(t).label].some((x) => norm(x).includes(q)));
}
function visiblePlanned() {
  const q = norm(query.geplant).trim();
  if (!q) return planned;
  return planned.filter((t) => [t.name, t.description, PROFILES[t.profile]?.label, groupOf(t).label].some((x) => norm(x).includes(q)));
}

function showList({ push = false } = {}) {
  selected = null;
  if (push) history.pushState(null, '', `./wege.html${tab === 'geplant' ? '?tab=geplant' : ''}`);
  document.title = 'Meine Touren – WMap';
  page.header('Meine Touren');
  const isPlan = tab === 'geplant';
  const empty = isPlan
    ? `<div class="tour-empty"><span class="msr">route</span><p>Noch keine Touren geplant.</p>
        <p class="muted">Plane eine Tour Punkt für Punkt, übernimm einen bekannten Wanderweg unter „Entdecken“ – oder speichere eine Route als Tour.</p>
        <a class="button primary" href="./tour.html"><span class="msr">add_road</span> Tour planen</a></div>`
    : `<div class="tour-empty"><span class="msr">timeline</span><p>Noch keine Wege aufgezeichnet.</p>
        <p class="muted">Wenn du navigierst, merkt sich WMap die Strecke – oder starte selbst eine Aufzeichnung.</p>
        <a class="button primary" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a></div>`;
  content.innerHTML = `
    <nav class="tours-tabs ent-tabs" role="tablist">
      <a role="tab" href="?tab=geplant" data-tab="geplant" aria-selected="${isPlan}"><span class="msr">route</span> Geplant <small>${planned.length}</small></a>
      <a role="tab" href="./wege.html" data-tab="wege" aria-selected="${!isPlan}"><span class="msr">timeline</span> Aufgezeichnet <small>${all.length}</small></a>
    </nav>
    <p class="muted tab-hint">${isPlan ? 'Geplant: Touren, die du noch fahren oder laufen willst – aus dem Planer, übernommen oder importiert.'
      : 'Aufgezeichnet: Wege, die du wirklich gefahren oder gelaufen bist – mit Zeit, Tempo und Puls.'}</p>
    <form class="wege-search tour-search" role="search" onsubmit="return false">
      <span class="msr">search</span>
      <input type="search" placeholder="${isPlan ? 'Suchen – Name, Beschreibung, Rad, Wandern …' : 'Suchen – Name, Ort, Jahr, Monat …'}" value="${esc(query[tab])}" aria-label="Suchen">
    </form>
    ${(isPlan ? planned : all).length ? '' : empty}
    <div class="wege-groups"></div>
    <footer class="wege-tools">
      ${isPlan ? `
      <a class="button" href="./tour.html"><span class="msr">add_road</span> Tour planen</a>
      <a class="button" href="./entdecken.html"><span class="msr">explore</span> Bekannte Wege finden</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx-tour"></label>` : `
      <a class="button" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx"></label>`}
      <button type="button" class="button" data-tool="backup"><span class="msr">save</span> Sicherung speichern</button>
      <label class="button"><span class="msr">settings_backup_restore</span> Sicherung laden<input type="file" accept=".json,application/json" hidden data-file="restore"></label>
      <div class="wege-folder"></div>
      <p class="muted">Alles bleibt auf diesem Gerät – außer du verbindest einen Ordner, den Nextcloud, Proton Drive o. Ä. abgleicht, oder nimmst es mit der Sicherungsdatei mit.</p>
    </footer>`;
  mountFolder($('.wege-folder', content), { toast });
  paintGroups();
  page.open();
}

/** Nur die Gruppen neu – das Suchfeld bleibt, wie es ist */
function paintGroups() {
  const box = $('.wege-groups', content);
  if (!box) return;
  if (tab === 'geplant') {
    const list = visiblePlanned();
    const by = new Map(Object.keys(GROUP).map((k) => [k, []]));
    for (const t of list) by.get(groupKey(t)).push(t);
    box.innerHTML = [...by].filter(([, ts]) => ts.length).map(([k, ts]) => {
      const g = GROUP[k];
      const sum = ts.reduce((a, t) => a + (t.stats?.length ?? 0), 0);
      return `<details class="wege-year" open>
        <summary><span class="msr" style="color:${g.color}">${g.icon}</span><strong>${g.label}</strong>
          <small>${ts.length} ${ts.length === 1 ? 'Tour' : 'Touren'} · ${km(sum)}</small></summary>
        <table class="wege-table"><tbody>${ts.map((t) => `
          <tr data-tour="${esc(t.id)}" tabindex="0">
            <td class="w-icon"><span class="msr" style="color:${g.color}">${PROFILES[t.profile]?.icon ?? g.icon}</span></td>
            <td class="w-name"><strong>${esc(t.name || 'Tour')}</strong><small>${esc([PROFILES[t.profile]?.label, t.fixed ? 'fester Verlauf' : '', t.updated ? SHORT.format(t.updated) : ''].filter(Boolean).join(' · '))}</small></td>
            <td class="w-num">${t.stats?.length ? fmtDistance(t.stats.length) : '–'}<small>${t.stats?.ascent ? `↗ ${t.stats.ascent} m` : ''}</small></td>
          </tr>`).join('')}</tbody></table>
      </details>`;
    }).join('') + (planned.length && !list.length ? `<p class="muted">Nichts gefunden für „${esc(query.geplant)}“.</p>` : '');
  } else {
    const list = visible();
    const byYear = new Map();
    for (const t of list) { const y = yearOf(t); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(t); }
    box.innerHTML = [...byYear].map(([y, ts]) => {
      const sum = ts.reduce((a, t) => a + t.length, 0), time = ts.reduce((a, t) => a + moving(t), 0);
      return `<details class="wege-year" open>
        <summary><i style="background:${yearColor(y)}"></i><strong>${y}</strong>
          <small>${ts.length} ${ts.length === 1 ? 'Weg' : 'Wege'} · ${km(sum)} · ${fmtDuration(time)}</small></summary>
        <table class="wege-table"><tbody>${ts.map((t) => `
          <tr data-id="${esc(t.id)}" tabindex="0">
            <td class="w-icon"><span class="msr" style="color:${groupOf(t).color}">${groupOf(t).icon}</span></td>
            <td class="w-name"><strong>${esc(t.name || 'Weg')}</strong><small>${DATE.format(t.start)} · ${TIME.format(t.start)}${t.kind === 'nav' ? ' · Navigation' : t.kind === 'gpx' ? ' · GPX' : ''}</small></td>
            <td class="w-num">${fmtDistance(t.length)}<small>${fmtDuration(moving(t))}</small></td>
          </tr>`).join('')}</tbody></table>
      </details>`;
    }).join('') + (all.length && !list.length ? `<p class="muted">Nichts gefunden für „${esc(query.wege)}“.</p>` : '');
  }
  paintMap();
}

content.addEventListener('input', (e) => {
  if (!e.target.matches('.wege-search input')) return;
  query[tab] = e.target.value;
  paintGroups();
});
content.addEventListener('click', (e) => {
  const t = e.target.closest('[role="tab"]');
  if (t) {
    e.preventDefault();
    if (t.dataset.tab !== tab) { tab = t.dataset.tab; showList({ push: true }); fitView(); }
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) { select(row.dataset.id, { push: true }); return; }
  const trow = e.target.closest('tr[data-tour]');
  if (trow) { selectTour(trow.dataset.tour, { push: true }); return; }
  const tool = e.target.closest('[data-tool]')?.dataset.tool;
  if (tool === 'backup') backup().then((txt) => download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.json`, txt, 'application/json'));
});
content.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('tr[data-id]')) select(e.target.dataset.id, { push: true });
  if (e.target.matches('tr[data-tour]')) selectTour(e.target.dataset.tour, { push: true });
});
content.addEventListener('mouseover', (e) => hover(e.target.closest('tr[data-id], tr[data-tour]')?.dataset.id ?? e.target.closest('tr[data-tour]')?.dataset.tour ?? null));
content.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-file]');
  if (!inp?.files?.length) return;
  try {
    let n = 0;
    if (inp.dataset.file === 'gpx') {
      let twice = 0;
      for (const f of inp.files) {
        for (const t of parseGpx(await f.text())) {
          if (all.some((x) => sameTrack(x, t))) { twice += 1; continue; }
          await tracks.put(t);
          all.push(t);
          n += 1;
        }
      }
      toast(n ? `${n} ${n === 1 ? 'Weg' : 'Wege'} importiert${twice ? ` (${twice} gab es schon)` : ''}` : twice ? 'Die Wege gibt es schon' : 'In der Datei war kein Weg');
    } else if (inp.dataset.file === 'gpx-tour') {
      for (const f of inp.files) {
        const t = tourFromGpx(await f.text(), f.name);
        if (!t) continue;
        tours.save({ ...t, id: tours.newId(), description: t.description || `Aus ${f.name} importiert` });
        n += 1;
      }
      toast(n ? `${n} ${n === 1 ? 'Tour' : 'Touren'} importiert – mit Originalverlauf` : 'In der Datei war keine Tour');
    } else {
      n = await restore(await inp.files[0].text());
      toast(`${n} Einträge aus der Sicherung übernommen`);
    }
  } catch (err) { toast(err.message); }
  inp.value = '';
  await load();
  showList();
  fitView();
});

/* ── Ein aufgezeichneter Weg ──────────────────────────────────────────────── */

let heights = null;
let elevation = null;

async function select(id, { push = false } = {}) {
  const t = all.find((x) => x.id === id);
  if (!t) { showList(); return; }
  tab = 'wege';
  selected = t;
  heights = null;
  if (push) history.pushState({ id }, '', `./wege.html?id=${encodeURIComponent(id)}`);
  document.title = `${t.name || 'Weg'} – WMap`;
  page.header(t.name || 'Weg', () => showList({ push: true }));
  const g = groupOf(t);
  const mv = moving(t);
  const hr = (t.hr ?? []).filter((x) => x > 0);
  content.innerHTML = `
    <label class="weg-name"><span class="msr">edit</span><input type="text" value="${esc(t.name ?? '')}" placeholder="Name" aria-label="Name des Wegs"></label>
    <p class="weg-when"><span class="msr" style="color:${g.color}">${g.icon}</span>
      ${LONG.format(t.start)}, ${TIME.format(t.start)}–${TIME.format(t.end)} Uhr
      ${t.from || t.to ? `<br><span class="muted">${esc([t.from, t.to].filter(Boolean).map((x) => x.split(',')[0]).join(' → '))}</span>` : ''}</p>
    <div class="weg-stats">
      <div><strong>${fmtDistance(t.length)}</strong><small>Strecke</small></div>
      <div><strong>${fmtDuration(mv)}</strong><small>in Bewegung</small></div>
      <div><strong>${mv ? (t.length / mv * 3.6).toFixed(1).replace('.', ',') : '–'}</strong><small>Ø km/h</small></div>
      <div><strong>${t.top ? Math.round(t.top * 3.6) : '–'}</strong><small>max. km/h</small></div>
      <div><strong class="st-up">…</strong><small>Anstieg</small></div>
      ${hr.length ? `<div><strong>${Math.round(hr.reduce((a, b) => a + b) / hr.length)}</strong><small>Ø Puls</small></div>
        <div><strong>${Math.max(...hr)}</strong><small>max. Puls</small></div>` : ''}
    </div>
    <div class="track-legend" hidden><span>langsam</span><i></i><span>schnell</span></div>
    <div class="elevation"></div>
    <div class="weg-actions">
      <button type="button" class="button primary" data-do="tour"><span class="msr">bookmark_add</span> Als Tour speichern</button>
      <button type="button" class="button" data-do="share"><span class="msr">share</span> Als Tour teilen</button>
      <button type="button" class="button" data-do="gpx"><span class="msr">download</span> GPX</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> Löschen</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
  showElevation(trackCoords(t), t, (h) => { $('.st-up', content).textContent = h ? `${h.ascent} m` : '–'; });
}

/** Höhenprofil unter den Zahlen; `done(h)` bekommt die Höhen (oder null) */
async function showElevation(coords, item, done) {
  elevation = new ElevationProfile($('.elevation', content), {
    onHover(kmv) {
      const cum = cumulative(coords);
      showHover(map, kmv === null ? null : pointAt(coords, cum, kmv * 1000 * (cum.at(-1) / (heights?.length || cum.at(-1)))));
    },
  });
  try {
    const h = await heightsAlong(coords);
    if (selected !== item) return;
    heights = { ...h, length: h.elevation.at(-1)?.[0] * 1000 || cumulative(coords).at(-1) };
    done(h);
    if (h.elevation.length) elevation.show(heights);
  } catch { done(null); }
}

content.addEventListener('change', async (e) => {
  if (!e.target.matches('.weg-name input') || !selected || !('start' in selected)) return;
  selected.name = e.target.value.trim();
  selected.updated = Date.now();
  await tracks.put(selected);
  page.header(selected.name || 'Weg', () => showList({ push: true }));
  toast('Name gespeichert');
});

content.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-do]')?.dataset.do;
  const t = selected;
  if (!act || !t) return;
  if (act === 'tour') {
    try { const saved = tours.save(asTour(t)); location.href = `./tour.html?id=${encodeURIComponent(saved.id)}`; } catch (err) { toast(err.message); }
  } else if (act === 'share') {
    share({ title: t.name, text: t.name, url: async () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#t=${await encodeShare('start' in t ? asTour(t) : t)}` }, toast);
  } else if (act === 'gpx') {
    download(`${(t.name || 'weg').replace(/[^\wäöüß]+/gi, '-')}.gpx`, 'start' in t ? trackGpx(t) : toGpx(t, coordsOf(t.shape)));
  } else if (act === 'delete') {
    const isTrack = 'start' in t;
    const v = await ask({ icon: 'delete', title: `„${t.name || (isTrack ? 'Weg' : 'Tour')}“ löschen?`, text: `${isTrack ? 'Der Weg' : 'Die Tour'} verschwindet von diesem Gerät.`,
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    if (isTrack) await tracks.remove(t.id); else tours.remove(t.id);
    await load();
    showList({ push: true });
    fitView();
  }
});

/** Aus einem Weg eine Tour: fester Verlauf, ein paar Punkte zum Weiterplanen */
function asTour(t) {
  const coords = trackCoords(t);
  const g = PROFILE_GROUP[t.profile] ?? 'foot';
  const profile = g === 'car' ? 'drive' : g === 'bike' ? (['road', 'gravel', 'mtb', 'tour'].includes(t.profile) ? t.profile : 'tour')
    : (heights?.ascent ?? 0) > 150 || t.length > 8000 ? 'hike' : 'walk';
  return {
    id: tours.newId(), name: t.name || 'Tour', description: `Aufgezeichnet am ${LONG.format(t.start)}`, profile,
    points: simplifyTo(coords, Math.min(30, Math.max(6, Math.round(t.length / 1000)))),
    shape: shapeOf(coords), fixed: true,
    stats: { length: t.length, time: moving(t), ascent: heights?.ascent ?? 0, descent: heights?.descent ?? 0 },
  };
}

/* ── Eine geplante Tour ───────────────────────────────────────────────────── */

function selectTour(id, { push = false } = {}) {
  const t = planned.find((x) => x.id === id);
  if (!t) { showList(); return; }
  tab = 'geplant';
  selected = t;
  heights = null;
  if (push) history.pushState({ tour: id }, '', `./wege.html?tour=${encodeURIComponent(id)}`);
  document.title = `${t.name || 'Tour'} – WMap`;
  page.header(t.name || 'Tour', () => showList({ push: true }));
  const p = PROFILES[t.profile];
  const g = groupOf(t);
  const st = t.stats ?? {};
  content.innerHTML = `
    <p class="weg-when"><span class="msr" style="color:${g.color}">${p?.icon ?? g.icon}</span>
      ${esc(p?.label ?? g.label)}${t.fixed ? ' · fester Verlauf' : ''}<br>
      <span class="muted">Zuletzt geändert am ${t.updated ? LONG.format(t.updated) : '–'}</span></p>
    <div class="weg-stats">
      <div><strong>${st.length ? fmtDistance(st.length) : '–'}</strong><small>Strecke</small></div>
      ${st.time ? `<div><strong>${fmtDuration(st.time)}</strong><small>Dauer</small></div>` : ''}
      <div><strong class="st-up">${st.ascent ? `${st.ascent} m` : '…'}</strong><small>Anstieg</small></div>
      <div><strong class="st-down">${st.descent ? `${st.descent} m` : '…'}</strong><small>Abstieg</small></div>
    </div>
    ${t.description ? `<p class="tour-text">${esc(t.description)}</p>` : ''}
    <div class="elevation"></div>
    <div class="weg-actions">
      <a class="button primary" href="./tour.html?id=${encodeURIComponent(t.id)}"><span class="msr">edit_road</span> Im Planer öffnen</a>
      <button type="button" class="button" data-do="share"><span class="msr">share</span> Teilen</button>
      <button type="button" class="button" data-do="gpx"><span class="msr">download</span> GPX</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> Löschen</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
  showElevation(coordsOf(t.shape), t, (h) => {
    if (!h) return;
    if (!st.ascent) $('.st-up', content).textContent = `${h.ascent} m`;
    if (!st.descent) $('.st-down', content).textContent = `${h.descent ?? 0} m`;
  });
}

/* ── Karte ────────────────────────────────────────────────────────────────── */

/**
 * Tempo als Farbverlauf entlang des gewählten Wegs (langsam orange, schnell
 * grün) – eingeordnet zwischen dem langsamsten und schnellsten Zehntel.
 */
function speedGradient(t) {
  const c = trackCoords(t), ts = t.times, cum = cumulative(c);
  if (!ts || ts.length !== c.length || c.length < 3) return null;
  const v = [];
  for (let i = 1; i < c.length; i += 1) { const dt = ts[i] - ts[i - 1]; v.push(dt > 0 ? distance(c[i - 1], c[i]) / dt : null); }
  const ok = v.filter((x) => x !== null && x < 70).sort((a, b) => a - b);
  if (ok.length < 3) return null;
  const lo = ok[Math.floor(ok.length * 0.1)], hi = ok[Math.floor(ok.length * 0.9)];
  if (hi - lo < 0.5) return null;
  const total = cum.at(-1);
  const color = (x) => { const k = Math.max(0, Math.min(1, ((x ?? lo) - lo) / (hi - lo))); return `hsl(${Math.round(25 + k * 110)} 80% ${Math.round(48 - k * 8)}%)`; };
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
  return stops.length >= 4 ? ['interpolate', ['linear'], ['line-progress'], ...stops] : null;
}

let markers = [];
async function paintMap() {
  await ready;
  // Nur der aktive Reiter liegt auf der Karte – sonst mischt sich Geplantes mit Gefahrenem
  const fc = tab === 'geplant'
    ? { type: 'FeatureCollection', features: visiblePlanned().map((t) => ({
      type: 'Feature', properties: { id: t.id, color: groupOf(t).color }, geometry: { type: 'LineString', coordinates: coordsOf(t.shape) },
    })) }
    : { type: 'FeatureCollection', features: [...visible()].sort((a, b) => a.start - b.start).map((t) => ({
      type: 'Feature', properties: { id: t.id, color: yearColor(yearOf(t)) }, geometry: { type: 'LineString', coordinates: trackCoords(t) },
    })) };
  if (!map.getSource('wege')) {
    map.addSource('wege', { type: 'geojson', data: fc });
    map.addSource('weg-sel', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 6, a, 14, b];
    map.addLayer({ id: 'wege-casing', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(3, 7), 'line-opacity': 0.8 } });
    map.addLayer({ id: 'wege-line', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(1.8, 4), 'line-opacity': 0.9 } });
    map.addLayer({ id: 'wege-hover', type: 'line', source: 'wege', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(4, 8) } });
    map.addLayer({ id: 'weg-sel-casing', type: 'line', source: 'weg-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(6, 12) } });
    map.addLayer({ id: 'weg-sel', type: 'line', source: 'weg-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': w(3.5, 7) } });
    map.on('click', 'wege-line', (e) => {
      const id = e.features[0].properties.id;
      if (tab === 'geplant') selectTour(id, { push: true }); else select(id, { push: true });
    });
    map.on('mousemove', 'wege-line', (e) => { map.getCanvas().style.cursor = 'pointer'; hover(e.features[0].properties.id); });
    map.on('mouseleave', 'wege-line', () => { map.getCanvas().style.cursor = ''; hover(null); });
    map.on('mousemove', 'weg-sel', (e) => {
      if (!selected || !heights) return;
      const c = 'start' in selected ? trackCoords(selected) : coordsOf(selected.shape), cum = cumulative(c);
      const p = nearestOnLine(c, cum, e.lngLat.toArray());
      showHover(map, p.point);
      elevation?.showAt(p.along / 1000 * (heights.length / cum.at(-1)));
    });
    map.on('mouseleave', 'weg-sel', () => { showHover(map, null); elevation?.showAt(null); });
  } else map.getSource('wege').setData(fc);

  // Gewähltes obenauf (Wege nach Tempo gefärbt); der Rest tritt zurück
  map.setPaintProperty('wege-line', 'line-opacity', selected ? 0.25 : 0.9);
  map.setPaintProperty('wege-casing', 'line-opacity', selected ? 0.3 : 0.8);
  markers.forEach((m) => m.remove());
  markers = [];
  if (selected) {
    const isTrack = 'start' in selected;
    const c = isTrack ? trackCoords(selected) : coordsOf(selected.shape);
    map.getSource('weg-sel').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
    const grad = isTrack ? speedGradient(selected) : null;
    map.setPaintProperty('weg-sel', 'line-gradient', grad ?? undefined);
    if (!grad) map.setPaintProperty('weg-sel', 'line-color', isTrack ? yearColor(yearOf(selected)) : groupOf(selected).color);
    $('.track-legend', content)?.toggleAttribute('hidden', !grad);
    for (const [p, cls, icon] of [[c[0], 'start', 'trip_origin'], [c.at(-1), 'dest', 'sports_score']]) {
      if (!p) continue;
      const el = Object.assign(document.createElement('div'), { className: `wp-marker ${cls}`, innerHTML: `<span class="msr">${icon}</span>` });
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map));
    }
  } else {
    map.getSource('weg-sel').setData({ type: 'FeatureCollection', features: [] });
  }
}

function hover(id) {
  if (map.getLayer('wege-hover')) map.setFilter('wege-hover', ['==', ['get', 'id'], id ?? '']);
  content.querySelectorAll('tr.hover').forEach((r) => r.classList.remove('hover'));
  if (id) content.querySelector(`tr[data-id="${CSS.escape(id)}"], tr[data-tour="${CSS.escape(id)}"]`)?.classList.add('hover');
}

/* ── Start ────────────────────────────────────────────────────────────────── */

async function load() {
  try { all = await tracks.all(); } catch { all = []; }
  planned = tours.all();
  years = [...new Set(all.map(yearOf))].sort((a, b) => b - a);
}

function route() {
  const p = new URLSearchParams(location.search);
  tab = p.get('tab') === 'geplant' || p.has('tour') ? 'geplant' : 'wege';
  if (p.get('id')) select(p.get('id'));
  else if (p.get('tour')) selectTour(p.get('tour'));
  else showList();
}
addEventListener('popstate', () => { route(); fitView(); });

/* Aus dem Ordner kam etwas dazu oder ging weg */
addEventListener('wmap:folder', async () => {
  await load();
  const list = tab === 'geplant' ? planned : all;
  if (selected) { if (!list.some((t) => t.id === selected.id)) showList(); } else showList();
});

await load();
route();
fitView();
