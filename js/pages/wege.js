/**
 * Meine Touren: alles Eigene auf einer Karte – zwei Reiter im Panel.
 *
 *   Geplant        Touren aus dem Planer, übernommene bekannte Wege, GPX-
 *                  Importe. Gruppiert nach Zu Fuß / Rad / Auto.
 *   Aufgezeichnet  Wege, die du gefahren oder gelaufen bist (Aufzeichnung,
 *                  Navigation, GPX mit Zeiten). Nach Jahren gruppiert und
 *                  gefärbt; der gewählte Weg zeigt Tempo, Höhe und Puls.
 *   Bus & Bahn     gemerkte Verbindungen (data/saved.js): kommende oben,
 *                  vergangene zugeklappt darunter; im Detail alle Abschnitte
 *
 * Das Panel (Rechner links, Handy unten) zeigt die Liste – Suche oben,
 * Tabelle je Gruppe – oder eine Tour/einen Weg im Detail. Kopfzeile siehe
 * ui/map-page.js: ← Übersicht bzw. Liste, ✕ zur Karte, Griff zum Einklappen.
 *
 * Aufruf: wege.html · ?tab=geplant · ?tab=bahn · ?tour=… (geplante Tour) · ?id=… (Weg) · ?conn=… (Verbindung)
 */
import { createMap, showHover } from '../map/map.js';
import { heightsAlong } from '../services/routing.js';
import { ElevationProfile } from '../ui/elevation.js';
import { tracks, trackCoords, trackGpx, parseGpx, sameTrack, PROFILE_GROUP } from '../data/tracks.js';
import { tours, shapeOf, coordsOf, encodeShare, toGpx, download, local } from '../data/store.js';
import { metrics, laps, lapLine } from '../data/track-stats.js';
import { PROFILES } from '../core/config.js';
import { ask, toast } from '../ui/dialogs.js';
import { share } from '../ui/share.js';
import { tourFromGpx } from '../data/folder.js';
import { autoSync } from '../data/auto-sync.js';
import { mapPage } from '../ui/map-page.js';
import { cumulative, pointAt, nearestOnLine, simplifyTo, distance, fmtDistance, fmtDuration, esc, bbox } from '../core/geo.js';
import { connections } from '../data/saved.js';
import { legBadge, changesText, transitLegsHtml } from '../ui/transit-legs.js';
import { healthAvailable, refreshHealthValues, appName, typeName, typeIcon } from '../services/health.js';

const $ = (s, root = document) => root.querySelector(s);

const GROUP = {
  foot: { label: 'Zu Fuß', icon: 'directions_walk', color: '#e8590c' },
  bike: { label: 'Rad', icon: 'directions_bike', color: '#2f9e44' },
  car: { label: 'Auto', icon: 'directions_car', color: '#1a73e8' },
};
const groupKey = (t) => PROFILE_GROUP[t.profile] ?? 'foot';
const groupOf = (t) => GROUP[groupKey(t)];
/** Symbol eines Wegs: aus Health Connect die Art (Rudern …), sonst die Gruppe */
const iconOf = (t) => (t.source?.type ? typeIcon(t.source.type) : groupOf(t).icon);
/** Herkunft in der Liste: „Navigation“, „GPX“, „Rudern · Fitbit“ */
const originOf = (t) => (t.kind === 'nav' ? 'Navigation' : t.kind === 'gpx' ? 'GPX'
  : t.kind === 'health' ? [t.source?.type ? typeName(t.source.type) : '', appName(t.source?.app)].filter(Boolean).join(' · ') : '');
const YEAR_COLORS = ['#1a73e8', '#e8590c', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e64980', '#5c940d', '#495057'];
const yearOf = (t) => new Date(t.start).getFullYear();

const DATE = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const SHORT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const LONG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const km = (m) => (m >= 100000 ? `${Math.round(m / 1000).toLocaleString('de-DE')} km` : fmtDistance(m));
const moving = (t) => t.moving || (t.end - t.start) / 1000;

/* ── Zustand ──────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
const tabOf = (p) => (p.get('tab') === 'bahn' || p.has('conn') ? 'bahn' : p.get('tab') === 'geplant' || p.has('tour') ? 'geplant' : 'wege');
let tab = tabOf(params);
let all = [];                      // aufgezeichnete Wege
let planned = [];                  // geplante Touren
let conns = [];                    // gemerkte Verbindungen mit Bus & Bahn
const query = { wege: '', geplant: '', bahn: '' };
let selected = null;               // gewählter Weg oder Tour
let years = [];
const yearColor = (y) => YEAR_COLORS[Math.min(Math.max(0, years.indexOf(y)), YEAR_COLORS.length - 1)];

const panel = $('.wege-panel');
const content = $('.wege-content');

const { map } = createMap('map', { auto3d: false, zoom: 5 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage(panel, { map, onFit: () => fitView() });

function fitView() {
  const list = selected ? [selected] : tab === 'geplant' ? visiblePlanned() : tab === 'bahn' ? visibleConns() : visible();
  const boxes = list.map((t) => (t.legs ? bbox(connCoords(t)) : t.bbox ?? bboxOfTour(t))).filter(Boolean);
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
  return all.filter((t) => [t.name, t.from, t.to, yearOf(t), DATE.format(t.start), LONG.format(t.start), groupOf(t).label, originOf(t)].some((x) => norm(x).includes(q)));
}
function visiblePlanned() {
  const q = norm(query.geplant).trim();
  if (!q) return planned;
  return planned.filter((t) => [t.name, t.description, PROFILES[t.profile]?.label, groupOf(t).label].some((x) => norm(x).includes(q)));
}

const connCoords = (c) => c.legs.flatMap((l) => l.coords ?? []);
const connName = (c) => `${c.from?.label?.split(',')[0] ?? 'Start'} → ${c.to?.label?.split(',')[0] ?? 'Ziel'}`;
function visibleConns() {
  const q = norm(query.bahn).trim();
  if (!q) return conns;
  return conns.filter((c) => [connName(c), DATE.format(c.dep), LONG.format(c.dep), ...c.legs.map((l) => l.line)].some((x) => norm(x).includes(q)));
}

function showList({ push = false } = {}) {
  selected = null;
  if (push) history.pushState(null, '', `./wege.html${tab === 'wege' ? '' : `?tab=${tab}`}`);
  document.title = 'Meine Touren – WMap';
  page.header('Meine Touren');
  const isPlan = tab === 'geplant', isBahn = tab === 'bahn';
  const empty = isBahn
    ? `<div class="tour-empty"><span class="msr">directions_transit</span><p>Noch keine Verbindungen gemerkt.</p>
        <p class="muted">Plane auf der Karte eine Route mit Bus &amp; Bahn und tippe bei der passenden Verbindung auf „Merken“.</p>
        <a class="button primary" href="./index.html"><span class="msr">directions</span> Route planen</a></div>`
    : isPlan
    ? `<div class="tour-empty"><span class="msr">route</span><p>Noch keine Touren geplant.</p>
        <p class="muted">Plane eine Tour Punkt für Punkt, übernimm einen bekannten Wanderweg unter „Entdecken“ – oder speichere eine Route als Tour.</p>
        <a class="button primary" href="./tour.html"><span class="msr">add_road</span> Tour planen</a></div>`
    : `<div class="tour-empty"><span class="msr">timeline</span><p>Noch keine Wege aufgezeichnet.</p>
        <p class="muted">Wenn du navigierst, merkt sich WMap die Strecke – oder starte selbst eine Aufzeichnung.</p>
        <a class="button primary" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a></div>`;
  content.innerHTML = `
    <nav class="tours-tabs ent-tabs" role="tablist">
      <a role="tab" href="?tab=geplant" data-tab="geplant" aria-selected="${isPlan}"><span class="msr">route</span> Geplant <small>${planned.length}</small></a>
      <a role="tab" href="./wege.html" data-tab="wege" aria-selected="${tab === 'wege'}"><span class="msr">timeline</span> Aufgezeichnet <small>${all.length}</small></a>
      <a role="tab" href="?tab=bahn" data-tab="bahn" aria-selected="${isBahn}"><span class="msr">directions_transit</span> Bus &amp; Bahn <small>${conns.length}</small></a>
    </nav>
    <p class="muted tab-hint">${isBahn ? 'Bus & Bahn: gemerkte Verbindungen – kommende oben, vergangene zugeklappt darunter.'
      : isPlan ? 'Geplant: Touren, die du noch fahren oder laufen willst – aus dem Planer, übernommen oder importiert.'
        : 'Aufgezeichnet: Wege, die du wirklich gefahren oder gelaufen bist – mit Zeit, Tempo und Puls.'}</p>
    ${isBahn ? '' : `<div class="wege-tools">${isPlan ? `
      <a class="button" href="./tour.html"><span class="msr">add_road</span> Tour planen</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx-tour"></label>` : `
      <a class="button" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx"></label>`}
    </div>`}
    <form class="wege-search tour-search" role="search" onsubmit="return false">
      <span class="msr">search</span>
      <input type="search" placeholder="${isBahn ? 'Suchen – Ort, Linie, Datum …' : isPlan ? 'Suchen – Name, Beschreibung, Rad, Wandern …' : 'Suchen – Name, Ort, Jahr, Monat …'}" value="${esc(query[tab])}" aria-label="Suchen">
    </form>
    ${(isBahn ? conns : isPlan ? planned : all).length ? '' : empty}
    <div class="wege-groups"></div>
    <a class="wege-sync-hint" href="./sync.html">
      <span class="msr">sync</span>
      <span>Alles bleibt auf diesem Gerät. Auf andere Geräte über einen Ordner (Nextcloud, Drive …), Health Connect
        oder eine Sicherung: <strong>Sicherung &amp; Abgleich</strong></span>
      <span class="msr">chevron_right</span>
    </a>`;
  paintGroups();
  page.open();
}

/** Nur die Gruppen neu – das Suchfeld bleibt, wie es ist */
function paintGroups() {
  const box = $('.wege-groups', content);
  if (!box) return;
  if (tab === 'bahn') {
    const list = visibleConns();
    const now = Date.now();
    const row = (c) => `<tr data-conn="${esc(c.id)}" tabindex="0">
      <td class="w-icon"><span class="msr" style="color:#1a73e8">directions_transit</span></td>
      <td class="w-name"><strong>${esc(connName(c))}</strong><small>${DATE.format(c.dep)} · ${TIME.format(c.dep)}–${TIME.format(c.arr)} · ${changesText(c)}</small>
        <span class="legs">${c.legs.filter((l) => !l.walk).map(legBadge).join(' ')}</span></td>
      <td class="w-num">${fmtDuration((c.arr - c.dep) / 1000)}</td>
    </tr>`;
    const next = list.filter((c) => c.arr >= now), past = list.filter((c) => c.arr < now).reverse();
    box.innerHTML = (next.length ? `<details class="wege-year" open>
        <summary><span class="msr" style="color:#1a73e8">schedule</span><strong>Kommende</strong><small>${next.length} ${next.length === 1 ? 'Verbindung' : 'Verbindungen'}</small></summary>
        <table class="wege-table conn-table"><tbody>${next.map(row).join('')}</tbody></table></details>` : '')
      + (past.length ? `<details class="wege-year">
        <summary><span class="msr" style="color:var(--muted)">history</span><strong>Vergangene</strong><small>${past.length} ${past.length === 1 ? 'Verbindung' : 'Verbindungen'}</small></summary>
        <table class="wege-table conn-table"><tbody>${past.map(row).join('')}</tbody></table></details>` : '')
      + (conns.length && !list.length ? `<p class="muted">Nichts gefunden für „${esc(query.bahn)}“.</p>` : '');
  } else if (tab === 'geplant') {
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
            <td class="w-icon"><span class="msr" style="color:${groupOf(t).color}">${iconOf(t)}</span></td>
            <td class="w-name"><strong>${esc(t.name || 'Weg')}</strong><small>${esc([`${DATE.format(t.start)} · ${TIME.format(t.start)}`, originOf(t)].filter(Boolean).join(' · '))}</small></td>
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
  const crow = e.target.closest('tr[data-conn]');
  if (crow) { selectConn(crow.dataset.conn, { push: true }); return; }
  // Abschnitt einer Verbindung auf- und zuklappen
  const leg = e.target.closest('.leg-head');
  if (leg) {
    const li = leg.closest('.leg');
    li.classList.toggle('open');
    leg.setAttribute('aria-expanded', li.classList.contains('open'));
    $('.leg-detail', li).hidden = !li.classList.contains('open');
    return;
  }
  const act = e.target.closest('[data-conn-do]')?.dataset.connDo;
  if (act === 'delete' && selected?.legs) {
    connections.remove(selected.id);
    conns = connections.all();
    toast('Verbindung gelöscht');
    showList({ push: true });
    fitView();
    return;
  }
});
content.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('tr[data-id]')) select(e.target.dataset.id, { push: true });
  if (e.target.matches('tr[data-tour]')) selectTour(e.target.dataset.tour, { push: true });
  if (e.target.matches('tr[data-conn]')) selectConn(e.target.dataset.conn, { push: true });
});
content.addEventListener('mouseover', (e) => {
  const tr = e.target.closest('tr[data-id], tr[data-tour], tr[data-conn]');
  hover(tr?.dataset.id ?? tr?.dataset.tour ?? tr?.dataset.conn ?? null);
});
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
// Diagramm-Kilometer je Kilometer der Strecke (das Höhenprofil misst selbst)
let chartScale = 1;

/** Was das Diagramm zeigen kann – Höhe immer, der Rest, wenn gemessen */
const CHARTS = {
  ele: { name: 'Höhe', icon: 'landscape' },
  speed: { name: 'Tempo', unit: 'km/h', icon: 'speed', color: 'light-dark(#1a73e8, #74a7f5)', decimals: 1 },
  hr: { name: 'Puls', unit: 'bpm', icon: 'favorite', color: 'light-dark(#e03131, #ff8787)' },
  cad: { name: 'Frequenz', unit: '/min', icon: 'autorenew', color: 'light-dark(#ae3ec9, #e599f7)' },
  pow: { name: 'Leistung', unit: 'W', icon: 'bolt', color: 'light-dark(#e8590c, #ffa94d)' },
};
/** Frequenz heißt je nach Art anders */
const cadName = (t) => (groupKey(t) === 'bike' ? 'Trittfrequenz' : groupKey(t) === 'foot' ? 'Schrittfrequenz' : 'Frequenz');
const avg = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y) / v.length) : null; };
const top = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.max(...v) : null; };

const LAP_SIZES = [1000, 2000, 5000];
/** Rundenlänge: gewählt (gemerkt) – sonst 5 km fürs Rad, 1 km zu Fuß und fürs Wasser */
const lapSize = (t) => local.get('wmap.lapsize') ?? (groupKey(t) === 'foot' ? 1000 : 5000);
/** „5:12“ bzw. „1:02:03“ */
const clock = (sec) => {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
/** Zu Fuß als Pace (min/km), sonst km/h */
const tempo = (t, mps) => (!mps ? '–' : groupKey(t) === 'foot' ? `${clock(1000 / mps)} /km` : `${(mps * 3.6).toFixed(1).replace('.', ',')} km/h`);

async function select(id, { push = false } = {}) {
  const t = all.find((x) => x.id === id);
  if (!t) { showList(); return; }
  tab = 'wege';
  selected = t;
  heights = null;
  chartScale = 1;
  showLap(null);
  if (push) history.pushState({ id }, '', `./wege.html?id=${encodeURIComponent(id)}`);
  document.title = `${t.name || 'Weg'} – WMap`;
  page.header(t.name || 'Weg', () => showList({ push: true }));
  const g = groupOf(t);
  const mv = moving(t);
  const hr = (t.hr ?? []).filter((x) => x > 0);
  content.innerHTML = `
    <label class="weg-name"><span class="msr">edit</span><input type="text" value="${esc(t.name ?? '')}" placeholder="Name" aria-label="Name des Wegs"></label>
    <p class="weg-when"><span class="msr" style="color:${g.color}">${iconOf(t)}</span>
      ${LONG.format(t.start)}, ${TIME.format(t.start)}–${TIME.format(t.end)} Uhr
      ${t.kind === 'health' ? `<br><span class="muted">${esc(originOf(t))} · aus Health Connect</span>` : ''}
      ${t.from || t.to ? `<br><span class="muted">${esc([t.from, t.to].filter(Boolean).map((x) => x.split(',')[0]).join(' → '))}</span>` : ''}</p>
    <div class="weg-stats">
      <div><strong>${fmtDistance(t.length)}</strong><small>Strecke</small></div>
      <div><strong>${fmtDuration(mv)}</strong><small>in Bewegung</small></div>
      <div><strong>${mv ? (t.length / mv * 3.6).toFixed(1).replace('.', ',') : '–'}</strong><small>Ø km/h</small></div>
      <div><strong>${t.top ? Math.round(t.top * 3.6) : '–'}</strong><small>max. km/h</small></div>
      <div><strong class="st-up">…</strong><small>Anstieg</small></div>
      ${hr.length ? `<div><strong>${avg(hr)}</strong><small>Ø Puls</small></div>
        <div><strong>${top(hr)}</strong><small>max. Puls</small></div>` : ''}
      ${avg(t.cad) ? `<div><strong>${avg(t.cad)}</strong><small>Ø ${esc(cadName(t))}</small></div>` : ''}
      ${avg(t.pow) ? `<div><strong>${avg(t.pow)} W</strong><small>Ø Leistung</small></div>` : ''}
    </div>
    <div class="track-legend" hidden><span>langsam</span><i></i><span>schnell</span></div>
    <div class="chip-row weg-chart-tabs" role="group" aria-label="Diagramm" hidden></div>
    <div class="elevation"></div>
    <section class="weg-laps" hidden></section>
    <div class="weg-actions">
      <button type="button" class="button primary" data-do="tour"><span class="msr">bookmark_add</span> Als Tour speichern</button>
      <button type="button" class="button" data-do="share"><span class="msr">share</span> Als Tour teilen</button>
      <button type="button" class="button" data-do="gpx"><span class="msr">download</span> GPX</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> Löschen</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
  paintCharts(t);
  paintLaps(t);
  showElevation(trackCoords(t), t, (h) => {
    $('.st-up', content).textContent = h ? `${h.ascent} m` : '–';
    paintCharts(t);
    paintLaps(t);
  });
  // Aus Health Connect übernommen, aber noch ohne Puls & Co.: nachladen
  if (t.kind === 'health' && healthAvailable && !t.source?.values) {
    refreshHealthValues(t).then(async (next) => {
      if (!next) return;
      await load();
      if (selected?.id === t.id) select(t.id);
    }).catch(() => {});
  }
}

/** Umschalter über dem Diagramm: Höhe, Tempo, Puls … – nur, was es gibt */
let metricCache = { id: null, m: {} };
function paintCharts(t) {
  const bar = $('.weg-chart-tabs', content);
  if (!bar || !elevation) return;
  if (metricCache.id !== t.id) metricCache = { id: t.id, m: metrics(t) };
  const m = metricCache.m;
  const kinds = ['ele', ...['speed', 'hr', 'cad', 'pow'].filter((k) => m[k]?.length)];
  const want = local.get('wmap.chart') ?? 'ele';
  const kind = kinds.includes(want) && (want !== 'ele' || heights?.elevation?.length) ? want
    : heights?.elevation?.length ? 'ele' : kinds.find((k) => k !== 'ele') ?? 'ele';
  bar.hidden = kinds.length < 2;
  bar.innerHTML = kinds.map((k) => `<button type="button" class="chip" data-chart="${k}" aria-pressed="${k === kind}">
      <span class="msr">${CHARTS[k].icon}</span> ${esc(k === 'cad' ? cadName(t) : CHARTS[k].name)}</button>`).join('');
  const len = cumulative(trackCoords(t)).at(-1);
  if (kind === 'ele') {
    chartScale = heights?.length ? heights.length / len : 1;
    if (heights?.elevation?.length) elevation.show(heights);
    return;
  }
  chartScale = 1;
  const c = CHARTS[kind];
  const vals = m[kind].map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  elevation.showMetric({
    ...c, name: kind === 'cad' ? cadName(t) : c.name, points: m[kind], length: len,
    chips: [['functions', Math.round(mean * 10) / 10, 'Durchschnitt'], ['vertical_align_top', Math.max(...vals), 'Höchstwert']],
  });
}

/** Runden zu 1, 2 oder 5 km – schnellste grün, langsamste rot; antippen zeigt sie auf der Karte */
function paintLaps(t) {
  const box = $('.weg-laps', content);
  if (!box) return;
  const size = lapSize(t);
  const r = laps(t, size, heights);
  box.hidden = !r || r.list.length < 2;
  if (box.hidden) return;
  const hasHr = r.list.some((l) => l.hr), hasUp = r.list.some((l) => l.up !== null);
  const badge = (l) => (l.n === r.fastest ? '<span class="lap-badge fast"><span class="msr">bolt</span> schnellste</span>'
    : l.n === r.slowest ? '<span class="lap-badge slow"><span class="msr">hourglass_bottom</span> langsamste</span>' : '');
  box.innerHTML = `<div class="laps-head">
      <h3><span class="msr">flag</span> Runden</h3>
      <div class="chip-row" role="group" aria-label="Länge einer Runde">${LAP_SIZES.map((x) => `
        <button type="button" class="chip" data-lap-size="${x}" aria-pressed="${x === size}">${x / 1000} km</button>`).join('')}</div>
    </div>
    <table class="laps-table">
      <thead><tr><th>Runde</th><th>Zeit</th><th>Tempo</th>${hasHr ? '<th>Ø Puls</th>' : ''}${hasUp ? '<th>Anstieg</th>' : ''}</tr></thead>
      <tbody>${r.list.map((l) => `
        <tr data-lap="${l.n}" tabindex="0" class="${l.n === r.fastest ? 'fast' : l.n === r.slowest ? 'slow' : ''}">
          <td>${l.n}${l.dist < size - 1 ? ` <small>${fmtDistance(l.dist)}</small>` : ''}</td>
          <td>${clock(l.time)}</td>
          <td>${tempo(t, l.speed)}${badge(l)}</td>
          ${hasHr ? `<td>${l.hr ?? '–'}</td>` : ''}${hasUp ? `<td>${l.up ?? '–'} m</td>` : ''}
        </tr>`).join('')}</tbody>
    </table>`;
}

/** Runde auf der Karte hervorheben (null: aus) */
let lapShown = null;
function showLap(line) {
  lapShown = line;
  if (!map.getSource('lap-sel')) {
    if (!line || !map.getSource('wege')) return;
    map.addSource('lap-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 6, a, 14, b];
    map.addLayer({ id: 'lap-sel-casing', type: 'line', source: 'lap-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(8, 15) } });
    map.addLayer({ id: 'lap-sel', type: 'line', source: 'lap-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fab005', 'line-width': w(5, 9) } });
  }
  map.getSource('lap-sel').setData(line ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } : { type: 'FeatureCollection', features: [] });
  if (line) map.fitBounds(bbox(line), { padding: page.padding(), maxZoom: 16, duration: 600 });
}

content.addEventListener('click', (e) => {
  const t = selected;
  if (!t || !('start' in t)) return;
  const chart = e.target.closest('[data-chart]')?.dataset.chart;
  if (chart) { local.set('wmap.chart', chart); paintCharts(t); return; }
  const size = e.target.closest('[data-lap-size]')?.dataset.lapSize;
  if (size) { local.set('wmap.lapsize', Number(size)); showLap(null); paintLaps(t); return; }
  const row = e.target.closest('tr[data-lap]');
  if (row) {
    const on = !row.classList.contains('shown');
    content.querySelectorAll('tr[data-lap].shown').forEach((x) => x.classList.remove('shown'));
    const lap = on && laps(t, lapSize(t), heights)?.list.find((l) => l.n === Number(row.dataset.lap));
    row.classList.toggle('shown', !!lap);
    showLap(lap ? lapLine(t, lap) : null);
    if (!lap) fitView();
  }
});
content.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr[data-lap]')) e.target.click();
});

/** Höhenprofil unter den Zahlen; `done(h)` bekommt die Höhen (oder null) */
async function showElevation(coords, item, done) {
  elevation = new ElevationProfile($('.elevation', content), {
    onHover(kmv) {
      const cum = cumulative(coords);
      showHover(map, kmv === null ? null : pointAt(coords, cum, kmv * 1000 / chartScale));
    },
  });
  try {
    const h = await heightsAlong(coords);
    if (selected !== item) return;
    heights = { ...h, length: h.elevation.at(-1)?.[0] * 1000 || cumulative(coords).at(-1) };
    done(h);
    // Touren: gleich das Höhenprofil; Wege wählen es über paintCharts
    if (!('start' in item)) {
      chartScale = heights.length / (cumulative(coords).at(-1) || 1);
      if (h.elevation.length) elevation.show(heights);
    }
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

/* ── Eine gemerkte Verbindung ─────────────────────────────────────────────── */

function selectConn(id, { push = false } = {}) {
  const c = conns.find((x) => x.id === id);
  if (!c) { showList(); return; }
  tab = 'bahn';
  selected = c;
  heights = null;
  if (push) history.pushState({ conn: id }, '', `./wege.html?conn=${encodeURIComponent(id)}`);
  document.title = `${connName(c)} – WMap`;
  page.header(connName(c), () => showList({ push: true }));
  const pt = (x) => (x?.point ? x.point.map((v) => v.toFixed(5)).join(',') : '');
  const again = `./index.html?from=${pt(c.from)}&to=${pt(c.to)}&profile=transit`;
  content.innerHTML = `
    <p class="weg-when"><span class="msr" style="color:#1a73e8">directions_transit</span>
      ${LONG.format(c.dep)}<br><span class="muted">${TIME.format(c.dep)} – ${TIME.format(c.arr)} · ${fmtDuration((c.arr - c.dep) / 1000)} · ${changesText(c)}</span></p>
    ${c.arr < Date.now() ? '<p class="muted">Diese Verbindung liegt in der Vergangenheit.</p>' : ''}
    <ol class="step-list conn-legs">${transitLegsHtml(c, null)}</ol>
    <div class="weg-actions">
      <a class="button primary" href="${again}"><span class="msr">search</span> Neu suchen</a>
      ${c.booking ? `<a class="button" href="${esc(c.booking)}" target="_blank" rel="noopener"><span class="msr">confirmation_number</span> Ticket bei der Bahn</a>` : ''}
      <button type="button" class="button" data-conn-do="delete"><span class="msr">delete</span> Löschen</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
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
  const fc = tab === 'bahn'
    ? { type: 'FeatureCollection', features: visibleConns().map((c) => ({
      type: 'Feature', properties: { id: c.id, color: '#1a73e8' }, geometry: { type: 'LineString', coordinates: connCoords(c) },
    })) }
    : tab === 'geplant'
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
      if (tab === 'bahn') selectConn(id, { push: true }); else if (tab === 'geplant') selectTour(id, { push: true }); else select(id, { push: true });
    });
    map.on('mousemove', 'wege-line', (e) => { map.getCanvas().style.cursor = 'pointer'; hover(e.features[0].properties.id); });
    map.on('mouseleave', 'wege-line', () => { map.getCanvas().style.cursor = ''; hover(null); });
    map.on('mousemove', 'weg-sel', (e) => {
      if (!selected || !elevation) return;
      const c = 'start' in selected ? trackCoords(selected) : coordsOf(selected.shape), cum = cumulative(c);
      const p = nearestOnLine(c, cum, e.lngLat.toArray());
      showHover(map, p.point);
      elevation.showAt(p.along / 1000 * chartScale);
    });
    map.on('mouseleave', 'weg-sel', () => { showHover(map, null); elevation?.showAt(null); });
  } else map.getSource('wege').setData(fc);

  // Gewähltes obenauf (Wege nach Tempo gefärbt); der Rest tritt zurück
  map.setPaintProperty('wege-line', 'line-opacity', selected ? 0.25 : 0.9);
  map.setPaintProperty('wege-casing', 'line-opacity', selected ? 0.3 : 0.8);
  markers.forEach((m) => m.remove());
  markers = [];
  if (selected?.legs) {
    // Verbindung: jeder Abschnitt in seiner Farbe, Fußwege grau
    map.getSource('weg-sel').setData({ type: 'FeatureCollection', features: selected.legs.filter((l) => l.coords?.length > 1).map((l) => ({
      type: 'Feature', properties: { color: l.walk ? '#868e96' : (l.color ?? '#1a73e8') }, geometry: { type: 'LineString', coordinates: l.coords },
    })) });
    map.setPaintProperty('weg-sel', 'line-gradient', undefined);
    map.setPaintProperty('weg-sel', 'line-color', ['get', 'color']);
    const c = connCoords(selected);
    for (const [p, cls, icon] of [[c[0], 'start', 'trip_origin'], [c.at(-1), 'dest', 'sports_score']]) {
      if (!p) continue;
      const el = Object.assign(document.createElement('div'), { className: `wp-marker ${cls}`, innerHTML: `<span class="msr">${icon}</span>` });
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map));
    }
  } else if (selected) {
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
  // Runde gehört zum gewählten Weg – sonst weg damit
  if (lapShown && !(selected && 'start' in selected)) showLap(null);
}

function hover(id) {
  if (map.getLayer('wege-hover')) map.setFilter('wege-hover', ['==', ['get', 'id'], id ?? '']);
  content.querySelectorAll('tr.hover').forEach((r) => r.classList.remove('hover'));
  if (id) content.querySelector(`tr[data-id="${CSS.escape(id)}"], tr[data-tour="${CSS.escape(id)}"], tr[data-conn="${CSS.escape(id)}"]`)?.classList.add('hover');
}

/* ── Start ────────────────────────────────────────────────────────────────── */

async function load() {
  try { all = await tracks.all(); } catch { all = []; }
  planned = tours.all();
  conns = connections.all();
  years = [...new Set(all.map(yearOf))].sort((a, b) => b - a);
}

function route() {
  const p = new URLSearchParams(location.search);
  tab = tabOf(p);
  if (p.get('id')) select(p.get('id'));
  else if (p.get('conn')) selectConn(p.get('conn'));
  else if (p.get('tour')) selectTour(p.get('tour'));
  else showList();
}
addEventListener('popstate', () => { route(); fitView(); });

/* Aus dem Ordner kam etwas dazu oder ging weg */
addEventListener('wmap:folder', async () => {
  await load();
  const list = tab === 'bahn' ? conns : tab === 'geplant' ? planned : all;
  if (selected) { if (!list.some((t) => t.id === selected.id)) showList(); } else showList();
});

await load();
route();
fitView();
autoSync();
