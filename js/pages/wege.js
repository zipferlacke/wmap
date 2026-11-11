/**
 * Meine Touren: alles Eigene auf einer Karte – zwei Reiter im Panel.
 *
 *   Geplant        Touren aus dem Planer, übernommene bekannte Wege, GPX-
 *                  Importe. Gruppiert nach Zu Fuß / Rad / Auto.
 *   Aufgezeichnet  Wege, die du gefahren oder gelaufen bist (Aufzeichnung,
 *                  Navigation, GPX mit Zeiten). Nach Jahren gruppiert, in der
 *                  Farbe ihrer Art (Gehen, Rad, Rudern … – oder einer eigenen,
 *                  data/track-look.js), je älter, desto blasser. Auf der Karte
 *                  liegt, was in den eingestellten Zeitraum fällt; Jahre und
 *                  einzelne Wege lassen sich ein- und ausblenden (Auge). Der
 *                  gewählte Weg zeigt Tempo, Höhe und Puls; dort wählt man
 *                  Art und Farbe, „offline verfügbar“ und navigiert ihn
 *                  erneut. GPX- und FIT-Dateien lassen sich auf die Seite ziehen.
 *   Bus & Bahn     gemerkte Verbindungen (data/saved.js): kommende oben,
 *                  vergangene zugeklappt darunter; im Detail alle Abschnitte
 *
 * Das Panel (Rechner links, Handy unten) zeigt die Liste – Suche oben,
 * Tabelle je Gruppe – oder eine Tour/einen Weg im Detail. Kopfzeile siehe
 * ui/map-page.js: ← Übersicht bzw. Liste, ✕ zur Karte, Griff zum Einklappen.
 *
 * Vergleichen: in Aufgezeichnet lange auf eine Zeile tippen, weitere ankreuzen – Zahlen, Verläufe und Entwicklung
 * (pages/wege-compare.js), auf der Karte jeder in seiner Farbe.
 *
 * Aufruf: wege.html · ?tab=geplant · ?tab=bahn · ?tour=… (geplante Tour) · ?id=… (Weg) · ?conn=… (Verbindung)
 *         · ?compare=id,id,… (Wege vergleichen)
 *         · #weg=… (geteilte Aufzeichnung, data/track-share.js)
 *         · #datei (geöffnete GPX-/FIT-Datei als Vorschau, pages/import.js)
 */
import { createMap, showHover } from '../map/map.js';
import { heightsAlong } from '../services/routing.js';
import { ElevationProfile } from '../ui/elevation.js';
import { tracks, trackCoords, trackGpx, sameTrack, trackAsTour, hasValues, PROFILE_GROUP } from '../data/tracks.js';
import { sportOf, sportName, sportIcon, sportColor, colorOf, ageOpacity, shownOnMap, trackShow, paceOf, cadName, lapSizes, SPORTS, COLORS } from '../data/track-look.js';
import { findDuplicates, choices, combine } from '../data/duplicates.js';
import { askMerge } from '../ui/merge-ask.js';
import { readFiles, fileOf } from '../data/import-files.js';
import { importAsk, importSummary } from '../ui/import-ask.js';
import { devLog } from '../core/devlog.js';
import { encodeTrack, decodeTrack, without } from '../data/track-share.js';
import { tours, shapeOf, coordsOf, encodeShare, toGpx, download, local } from '../data/store.js';
import { metrics, laps, lapLine } from '../data/track-stats.js';
import { PROFILES } from '../core/config.js';
import { ask, toast } from '../ui/dialogs.js';
import { share, pageUrl, canShareFiles, shareFile } from '../ui/share.js';
import { shortLink, resolveShort, collabState } from '../data/short-link.js';
import { openLinkText } from '../ui/open-link.js';
import { linkTarget } from '../core/map-links.js';
import { folder } from '../data/folder.js';
import { autoSync } from '../data/auto-sync.js';
import { mapPage } from '../ui/map-page.js';
import { carLink, sendToCar } from '../data/car-link.js';
import { cumulative, pointAt, nearestOnLine, simplifyTo, distance, fmtDistance, fmtDuration, fmtTime, fmtSpeed, speedUnit, esc, bbox, clockFormat } from '../core/geo.js';
import { speedOf } from '../core/units.js';
import { connections, places, DEFAULT_LIST, PLACE_KINDS } from '../data/saved.js';
import { packJson, unpackJson } from '../data/store.js';
import { legBadge, changesText, transitLegsHtml } from '../ui/transit-legs.js';
import { healthAvailable, refreshHealthValues, appName } from '../services/health.js';
import { paintCompare } from './wege-compare.js';
import { sameRoutes, SAME_LEVELS } from '../data/same-route.js';
import { nameAll } from '../data/auto-name.js';
import { locale, t } from '../core/i18n.js';

const $ = (s, root = document) => root.querySelector(s);

const GROUP = {
  foot: { label: t('wege.groups.foot'), icon: 'directions_walk', color: '#e8590c' },
  bike: { label: t('wege.groups.bike'), icon: 'directions_bike', color: '#2f9e44' },
  car: { label: t('wege.groups.car'), icon: 'directions_car', color: '#1a73e8' },
};
const groupKey = (tk) => PROFILE_GROUP[tk.profile] ?? 'foot';
const groupOf = (tk) => GROUP[groupKey(tk)];
/** Symbol eines Wegs: seine Art (Rudern, Rad …) – ohne Art ein neutrales */
const iconOf = (tk) => sportIcon(sportOf(tk));
/** Art und Herkunft in der Liste: „Rudern · Zepp“, „Autofahrt · Navigation“, ohne Art nur „GPX“ */
const originOf = (tk) => [sportName(sportOf(tk)), tk.kind === 'health' ? appName(tk.source?.app) : tk.kind === 'nav' ? t('wege.origin.nav') : ''].filter(Boolean).join(' · ');
const yearOf = (tk) => new Date(tk.start).getFullYear();

const DATE = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
const SHORT = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const LONG = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat(locale, { ...clockFormat() });
const km = fmtDistance;
const moving = (tk) => tk.moving || (tk.end - tk.start) / 1000;

/* ── Zustand ──────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
const tabOf = (p) => (p.get('tab') === 'bahn' || p.has('conn') ? 'bahn' : p.get('tab') === 'geplant' || p.has('tour') ? 'geplant'
  : p.get('tab') === 'orte' || p.has('liste') ? 'orte' : 'wege');
let tab = tabOf(params);
let all = [];                      // aufgezeichnete Wege
const COLLAB_BLUE = '#1a73e8';
/** Chip „Geteilt / Eingeladen von … · noch 28 Tage“ an gemeinsam geplanten Touren */
const collabChip = (c) => { const st = collabState(c); return `<span class="collab-chip${st.gone ? ' gone' : ''}"><span class="msr">${st.icon}</span>${esc(st.text)}</span>`; };
let planned = [];                  // geplante Touren
let conns = [];                    // gemerkte Verbindungen mit Bus & Bahn
const query = { wege: '', geplant: '', bahn: '', orte: '' };
let sharedList = null;             // geöffneter Link „?liste=“: { name, items: [{ name, label, point }] }
let selected = null;               // gewählter Weg oder Tour
let comparing = null;              // Wege im Vergleich (ganz geladen)
let compareFocus = null;           // ID des aktuellen Wegs im Vergleich (ohne Wahl der neueste)
let compareSame = null;            // gleiche Strecke: ID des Wegs, von dem aus verglichen wird
let compareView = null;            // paintCompare: { hover(id) }
let picking = null;                // Liste im Modus „Vergleichen“: Set der angekreuzten IDs
let folderOn = false;              // Ordner verbunden: „offline verfügbar“ anbieten
let lookOpen = false;              // Tour: Block „Art, Farbe und Anzeige“ aufgeklappt (bleibt es beim Neuzeichnen)

const content = $('.wege-content');

const { map } = createMap('map', { auto3d: false, zoom: 5 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage($('.wege-src'), { map, title: t('wege.title'), onFit: () => fitView() });
const { panel } = page;

function fitView() {
  if (tab === 'orte' && !selected) {
    const pts = orteFeatures().map((f) => f.geometry.coordinates);
    if (!pts.length) return;
    const b = bbox(pts);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: page.padding(), maxZoom: 15, duration: 600 });
    return;
  }
  const list = selected ? [selected] : comparing ?? (tab === 'geplant' ? visiblePlanned() : tab === 'bahn' ? visibleConns() : onMap());
  const boxes = list.map((tk) => (tk.legs ? bbox(connCoords(tk)) : tk.bbox ?? bboxOfTour(tk))).filter(Boolean);
  if (!boxes.length) return;
  const b = boxes.reduce((a, x) => [Math.min(a[0], x[0]), Math.min(a[1], x[1]), Math.max(a[2], x[2]), Math.max(a[3], x[3])], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: page.padding(), maxZoom: 15, duration: 600 });
}

const bboxCache = new Map();
function bboxOfTour(tk) {
  if (!tk.shape) return null;
  if (!bboxCache.has(tk.shape)) {
    const c = coordsOf(tk.shape);
    bboxCache.set(tk.shape, c.length ? c.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]) : null);
  }
  return bboxCache.get(tk.shape);
}

/* ── Liste ────────────────────────────────────────────────────────────────── */

const norm = (s) => String(s ?? '').toLowerCase();

/*
 * Kopfzeile über den Aufzeichnungen: sortieren (Datum, Länge, Dauer, Tempo, Name – nochmal tippen dreht um) und
 * filtern (Art, Tag, Zeitraum). Gemerkt in wmap.wegeView. Nach Datum bleiben die Jahre, sonst eine Liste
 */
const VIEW_KEY = 'wmap.wegeView';
const SORTS = {
  date: [t('wege.view.sort.date'), (tk) => tk.start],
  length: [t('wege.view.sort.length'), (tk) => tk.length ?? 0],
  time: [t('wege.view.sort.time'), (tk) => moving(tk)],
  speed: [t('wege.view.sort.speed'), (tk) => (moving(tk) > 0 ? (tk.length ?? 0) / moving(tk) : 0)],
  name: [t('wege.view.sort.name'), (tk) => norm(tk.name)],
};
const SINCE = { '': t('wege.view.since.any'), 30: t('wege.view.since.days30'), 90: t('wege.view.since.days90'), 365: t('wege.view.since.year'), year: t('wege.view.since.this_year') };
const view = { sort: 'date', dir: -1, sport: '', tag: '', since: '', ...(local.get(VIEW_KEY) ?? {}) };
const saveView = () => local.set(VIEW_KEY, view);
const tagsOf = (tk) => tk.tags ?? [];
const allTags = () => [...new Set(all.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, locale));
const sportKey = (tk) => sportOf(tk) ?? '';
function sinceOk(tk) {
  if (!view.since) return true;
  if (view.since === 'year') return yearOf(tk) === new Date().getFullYear();
  return tk.start >= Date.now() - Number(view.since) * 864e5;
}
const filtered = () => !!(view.sport || view.tag || view.since);

function visible() {
  const q = norm(query.wege).trim();
  const list = all.filter((tk) => (!view.sport || sportKey(tk) === view.sport) && (!view.tag || tagsOf(tk).includes(view.tag)) && sinceOk(tk)
    && (!q || [tk.name, tk.from, tk.to, yearOf(tk), DATE.format(tk.start), LONG.format(tk.start), groupOf(tk).label, originOf(tk), ...tagsOf(tk)].some((x) => norm(x).includes(q))));
  const key = SORTS[view.sort]?.[1] ?? SORTS.date[1];
  return list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * view.dir; });
}

/** Kopfzeile: Sortieren und Filtern – nur die Arten und Tags, die es gibt */
function viewHead() {
  const sports = [...new Set(all.map(sportKey))];
  const tags = allTags();
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="wege-head" role="toolbar" aria-label="${t('wege.view.toolbar')}">
    <label class="head-pick"><span class="msr">sort</span><select data-view="sort" aria-label="${t('wege.view.sort.label')}">
      ${Object.entries(SORTS).map(([k, [label]]) => opt(k, label, view.sort)).join('')}</select></label>
    <button type="button" class="chip head-dir" data-view-dir title="${view.dir < 0 ? t('wege.view.dir.down') : t('wege.view.dir.up')}">
      <span class="msr">${view.dir < 0 ? 'arrow_downward' : 'arrow_upward'}</span></button>
    <label class="head-pick${view.sport ? ' on' : ''}"><span class="msr">directions_run</span><select data-view="sport" aria-label="${t('wege.view.sport.label')}">
      ${opt('', t('wege.view.sport.all'), view.sport)}${sports.map((k) => opt(k, sportName(k || null), view.sport)).join('')}</select></label>
    ${tags.length || view.tag ? `<label class="head-pick${view.tag ? ' on' : ''}"><span class="msr">sell</span><select data-view="tag" aria-label="${t('wege.view.tag.label')}">
      ${opt('', t('wege.view.tag.all'), view.tag)}${tags.map((k) => opt(k, k, view.tag)).join('')}</select></label>` : ''}
    <label class="head-pick${view.since ? ' on' : ''}"><span class="msr">date_range</span><select data-view="since" aria-label="${t('wege.view.since.label')}">
      ${Object.entries(SINCE).map(([k, label]) => opt(k, label, view.since)).join('')}</select></label>
    ${filtered() ? `<button type="button" class="chip" data-view-reset><span class="msr">filter_alt_off</span> ${t('wege.view.reset')}</button>` : ''}
    ${picking ? `<button type="button" class="chip" data-list="pick-all"><span class="msr">select_all</span> ${t('wege.pick.all')}</button>` : ''}
  </div>`;
}
/** Was davon auf der Karte liegt (Zeitraum, Auge am Jahr und am Weg); mit Suche: alle Treffer */
const onMap = () => (norm(query.wege).trim() ? visible() : visible().filter((tk) => shownOnMap(tk)));
function visiblePlanned() {
  const q = norm(query.geplant).trim();
  if (!q) return planned;
  return planned.filter((tk) => [tk.name, tk.description, PROFILES[tk.profile]?.label, groupOf(tk).label].some((x) => norm(x).includes(q)));
}

const connCoords = (c) => c.legs.flatMap((l) => l.coords ?? []);
const connName = (c) => t('wege.conn.name', { from: c.from?.label?.split(',')[0] ?? t('wege.conn.start'), to: c.to?.label?.split(',')[0] ?? t('wege.conn.dest') });
function visibleConns() {
  const q = norm(query.bahn).trim();
  if (!q) return conns;
  return conns.filter((c) => [connName(c), DATE.format(c.dep), LONG.format(c.dep), ...c.legs.map((l) => l.line)].some((x) => norm(x).includes(q)));
}

/*
 * ← in einer Ansicht (Weg, Tour, Verbindung, Vergleich): im Verlauf zurück, wenn man innerhalb der Seite
 * hierher kam (Einträge mit `wege`) – dann führen ← und die Zurück-Taste (Handy, Browser) an dieselbe Stelle,
 * auch durch mehrere Wechsel hindurch. Direkt geöffnet (Link, Lesezeichen): zur Liste, ohne neuen Eintrag.
 */
function backToList() {
  if (history.state?.wege) { history.back(); return; }
  showList();
  history.replaceState(null, '', `./wege.html${tab === 'wege' ? '' : `?tab=${tab}`}`);
  fitView();
}

function showList({ push = false } = {}) {
  if (listStale) { listStale = false; listSoon(); }
  selected = null;
  comparing = null;
  compareFocus = null;
  compareSame = null;
  compareView = null;
  if (tab !== 'wege') picking = null;
  if (push) history.pushState({ wege: 1 }, '', `./wege.html${tab === 'wege' ? '' : `?tab=${tab}`}`);
  document.title = t('wege.page_title');
  page.header(t('wege.title'));
  const isPlan = tab === 'geplant', isBahn = tab === 'bahn', isOrte = tab === 'orte';
  const ownPlaces = places.all().filter((p) => p.kind !== 'home' && p.kind !== 'work');
  const empty = isOrte
    ? `<div class="tour-empty"><span class="msr">bookmarks</span><p>${t('wege.empty.places.title')}</p>
        <p class="muted">${t('wege.empty.places.text')}</p>
        <a class="button primary" href="./index.html"><span class="msr">map</span> ${t('wege.empty.places.button')}</a></div>`
    : isBahn
    ? `<div class="tour-empty"><span class="msr">directions_transit</span><p>${t('wege.empty.transit.title')}</p>
        <p class="muted">${t('wege.empty.transit.text')}</p>
        <a class="button primary" href="./index.html"><span class="msr">directions</span> ${t('wege.empty.transit.button')}</a></div>`
    : isPlan
    ? `<div class="tour-empty"><span class="msr">route</span><p>${t('wege.empty.planned.title')}</p>
        <p class="muted">${t('wege.empty.planned.text')}</p>
        <a class="button primary" href="./tour.html"><span class="msr">add_road</span> ${t('wege.tools.plan')}</a></div>`
    : `<div class="tour-empty"><span class="msr">timeline</span><p>${t('wege.empty.recorded.title')}</p>
        <p class="muted">${t('wege.empty.recorded.text')}</p>
        <a class="button primary" href="./index.html?action=record"><span class="msr">radio_button_checked</span> ${t('wege.tools.record')}</a></div>`;
  content.innerHTML = `
    <nav class="tours-tabs ent-tabs" role="tablist">
      <a role="tab" href="?tab=geplant" data-tab="geplant" aria-selected="${isPlan}"><span class="msr">route</span> ${t('wege.tabs.planned')} <small>${planned.length}</small></a>
      <a role="tab" href="./wege.html" data-tab="wege" aria-selected="${tab === 'wege'}"><span class="msr">timeline</span> ${t('wege.tabs.recorded')} <small>${all.length}</small></a>
      <a role="tab" href="?tab=bahn" data-tab="bahn" aria-selected="${isBahn}"><span class="msr">directions_transit</span> ${t('wege.tabs.transit')} <small>${conns.length}</small></a>
      <a role="tab" href="?tab=orte" data-tab="orte" aria-selected="${isOrte}"><span class="msr">bookmarks</span> ${t('wege.tabs.places')} <small>${ownPlaces.length}</small></a>
    </nav>
    <p class="muted tab-hint">${isOrte ? t('wege.hint.places')
      : isBahn ? t('wege.hint.transit')
      : isPlan ? t('wege.hint.planned')
        : `${t('wege.hint.recorded')}${all.length ? ` <span class="msr">visibility</span> ${t('wege.hint.on_map', { label: esc(trackShow.label()) })}` : ''}`}</p>
    ${isBahn || isOrte ? '' : `<div class="wege-tools">${isPlan ? `
      <a class="button" href="./tour.html"><span class="msr">add_road</span> ${t('wege.tools.plan')}</a>
      <label class="button"><span class="msr">upload_file</span> ${t('wege.tools.import')}<input type="file" accept=".gpx,.fit,application/gpx+xml" multiple hidden data-file="gpx-tour"></label>` : `
      <a class="button" href="./index.html?action=record"><span class="msr">radio_button_checked</span> ${t('wege.tools.record')}</a>
      <label class="button"><span class="msr">upload_file</span> ${t('wege.tools.import')}<input type="file" accept=".gpx,.fit,application/gpx+xml" multiple hidden data-file="gpx"></label>`}
    </div>`}
    <form class="wege-search tour-search" role="search">
      <span class="msr">search</span>
      <input type="search" placeholder="${isOrte ? t('wege.search.places') : isBahn ? t('wege.search.transit') : isPlan ? t('wege.search.planned') : t('wege.search.recorded')}" value="${esc(query[tab])}" aria-label="${t('wege.search.label')}">
    </form>
    <button type="button" class="wege-open-link" data-list="open-typed" hidden><span class="msr">link</span><span>${t('wege.search.open_link')}</span><span class="msr">chevron_right</span></button>
    ${(isOrte ? (ownPlaces.length || sharedList ? [1] : []) : isBahn ? conns : isPlan ? planned : all).length ? '' : empty}
    ${isBahn || isOrte ? '' : `<a class="wege-sync-hint wege-dup-hint" href="./sync.html#doppelt" hidden>
      <span class="msr">content_copy</span><span></span><span class="msr">chevron_right</span>
    </a>`}
    ${tab === 'wege' && all.length ? '<div class="wege-head-box"></div>' : ''}
    ${tab === 'wege' && picking ? `<div class="compare-bar" role="region" aria-label="${t('wege.pick.label')}">
      <span class="compare-count"></span>
      <button type="button" class="button" data-list="compare-cancel">${t('common.cancel')}</button>
      <button type="button" class="button" data-list="pick-tag"><span class="msr">sell</span> ${t('wege.pick.tag')}</button>
      <button type="button" class="button primary" data-list="compare-go"><span class="msr">compare_arrows</span> ${t('wege.pick.compare')}</button>
    </div>` : ''}
    <div class="wege-groups"></div>
    <a class="wege-sync-hint" href="./sync.html">
      <span class="msr">sync</span>
      <span>${t('wege.sync_hint')}</span>
      <span class="msr">chevron_right</span>
    </a>`;
  paintGroups();
  paintLinkHit();
  // Dieselbe Tour aus zwei Quellen (Uhr und Handy, Health Connect und Ordner): hier Bescheid sagen
  const dup = content.querySelector('.wege-dup-hint');
  if (dup) {
    findDuplicates().then((d) => {
      const n = (isPlan ? d.tours : d.tracks).reduce((sum, g) => sum + g.length - 1, 0);
      if (!n || !dup.isConnected) return;
      dup.children[1].innerHTML = t('wege.dup_hint', { n });
      dup.hidden = false;
    }).catch(() => {});
  }
  page.open();
  // Gewählter Reiter sichtbar – am Handy scrollen die Reiter
  const sel = content.querySelector('[role="tab"][aria-selected="true"]');
  sel?.parentElement.scrollTo({ left: sel.offsetLeft - 16 });
}

/** Nur die Gruppen neu – das Suchfeld bleibt, wie es ist */
/* ── Orte: Lesezeichen in Listen ──────────────────────────────────────────── */

const LIST_COLORS = ['#1a73e8', '#e8590c', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e64980', '#5c940d'];
const listColor = (name) => LIST_COLORS[Math.max(0, places.lists().indexOf(name)) % LIST_COLORS.length];

/** Orte, die gerade passen: je Liste; Zuhause/Arbeit als eigene Gruppe vorn */
function visibleOrte() {
  const q = norm(query.orte).trim();
  const hit = (p) => !q || [p.name, p.label, p.list, PLACE_KINDS[p.kind]?.label].some((x) => norm(x).includes(q));
  const fixedPl = places.all().filter((p) => (p.kind === 'home' || p.kind === 'work') && hit(p));
  const groups = places.lists().map((name) => [name, places.inList(name).filter(hit)]).filter(([, l]) => l.length);
  return { fixedPl, groups };
}

/** Punkte für die Karte: eigene Orte und die einer geteilten Liste */
function orteFeatures() {
  const { fixedPl, groups } = visibleOrte();
  const f = (p, color, extra = {}) => ({ type: 'Feature', properties: { id: p.id ?? '', name: p.name, color, ...extra }, geometry: { type: 'Point', coordinates: p.point } });
  return [
    ...fixedPl.map((p) => f(p, '#1a73e8')),
    ...groups.flatMap(([name, l]) => l.map((p) => f(p, listColor(name)))),
    ...(sharedList?.items ?? []).map((p, i) => f({ ...p, id: `shared-${i}` }, '#e03131', { shared: true })),
  ];
}

function paintOrte(box) {
  const { fixedPl, groups } = visibleOrte();
  const row = (p) => `<tr data-place="${esc(p.id)}" tabindex="0">
      <td class="w-icon"><span class="msr" style="color:${p.kind === 'home' || p.kind === 'work' ? '#1a73e8' : listColor(p.list || DEFAULT_LIST)}">${PLACE_KINDS[p.kind]?.icon ?? 'star'}</span></td>
      <td class="w-name"><strong>${esc(p.name)}</strong><small>${esc(p.label || PLACE_KINDS[p.kind]?.label || '')}</small></td>
      <td class="w-num"><button type="button" class="button" data-shape="round no-background" data-place-route="${esc(p.id)}" title="${t('wege.places.route')}"><span class="msr">directions</span></button></td>
    </tr>`;
  const shared = sharedList ? `<section class="orte-shared">
      <p><span class="msr">share</span> ${t('wege.places.shared.text', { name: esc(sharedList.name), n: sharedList.items.length })}</p>
      <div class="orte-shared-actions">
        <button type="button" class="button primary" data-list-take><span class="msr">bookmark_add</span> ${t('wege.places.shared.take')}</button>
        <button type="button" class="button" data-list-drop>${t('wege.places.shared.drop')}</button>
      </div>
      <table class="wege-table"><tbody>${sharedList.items.map((p) => `<tr><td class="w-icon"><span class="msr" style="color:#e03131">place</span></td>
        <td class="w-name"><strong>${esc(p.name)}</strong><small>${esc(p.label ?? '')}</small></td><td></td></tr>`).join('')}</tbody></table>
    </section>` : '';
  box.innerHTML = shared
    + (fixedPl.length ? `<details class="wege-year" open><summary><span class="msr" style="color:#1a73e8">home</span><strong>${t('wege.places.fixed')}</strong><small>${fixedPl.length}</small></summary>
        <table class="wege-table"><tbody>${fixedPl.map(row).join('')}</tbody></table></details>` : '')
    + groups.map(([name, l]) => `<details class="wege-year" open>
        <summary><i style="background:${listColor(name)}"></i><strong>${esc(name)}</strong><small>${t('wege.places.count', { n: l.length })}</small></summary>
        <div class="orte-list-actions">
          <button type="button" class="link-button" data-list-share="${esc(name)}"><span class="msr">share</span> ${t('wege.places.share')}</button>
          <button type="button" class="link-button" data-list-show="${esc(name)}"><span class="msr">zoom_out_map</span> ${t('wege.places.on_map')}</button>
        </div>
        <table class="wege-table"><tbody>${l.map(row).join('')}</tbody></table>
      </details>`).join('')
    + (query.orte && !fixedPl.length && !groups.length ? `<p class="muted">${t('wege.none_for', { q: esc(query.orte) })}</p>` : '');
  paintMap();
}

/** Liste als Link: alle Orte stecken gepackt in der Adresse – ohne Server */
async function shareList(name) {
  const items = places.inList(name).map((p) => [+p.point[0].toFixed(5), +p.point[1].toFixed(5), p.name, p.label ?? '']);
  share({ title: t('wege.places.share_title', { name }), text: t('wege.places.share_text', { name, n: items.length }), url: async () => `${pageUrl('wege.html')}?liste=${await packJson({ n: name, p: items })}` }, toast);
}

content.addEventListener('click', (e) => {
  if (tab !== 'orte') return;
  const b = e.target.closest('[data-list-share], [data-list-show], [data-list-take], [data-list-drop], [data-place-route], tr[data-place]');
  if (!b) return;
  if (b.dataset.listShare) shareList(b.dataset.listShare);
  else if (b.dataset.listShow) {
    const pts = places.inList(b.dataset.listShow).map((p) => p.point);
    const bb = bbox(pts);
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: page.padding(), maxZoom: 15, duration: 600 });
  } else if (b.hasAttribute('data-list-take')) {
    let name = sharedList.name;
    // Gleichnamige eigene Liste: nicht mischen, sondern „(geteilt)“
    if (places.lists().includes(name) && places.inList(name).length) name = t('wege.places.name_shared', { name });
    const n = places.addList(name, sharedList.items);
    toast(t('wege.places.taken', { n, name }));
    sharedList = null;
    history.replaceState(null, '', './wege.html?tab=orte');
    showList();
  } else if (b.hasAttribute('data-list-drop')) {
    sharedList = null;
    history.replaceState(null, '', './wege.html?tab=orte');
    showList();
  } else if (b.dataset.placeRoute) {
    const p = places.all().find((x) => x.id === b.dataset.placeRoute);
    if (p) location.href = `./index.html?to=${p.point[0].toFixed(5)},${p.point[1].toFixed(5)}`;
  } else {
    const p = places.all().find((x) => x.id === b.closest('tr').dataset.place);
    if (p) map.flyTo({ center: p.point, zoom: Math.max(map.getZoom(), 15), padding: page.padding(), duration: 800 });
  }
});

function paintGroups() {
  const box = $('.wege-groups', content);
  if (!box) return;
  if (tab === 'orte') { paintOrte(box); return; }
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
        <summary><span class="msr" style="color:#1a73e8">schedule</span><strong>${t('wege.conn.next')}</strong><small>${t('wege.conn.count', { n: next.length })}</small></summary>
        <table class="wege-table conn-table"><tbody>${next.map(row).join('')}</tbody></table></details>` : '')
      + (past.length ? `<details class="wege-year">
        <summary><span class="msr" style="color:var(--muted)">history</span><strong>${t('wege.conn.past')}</strong><small>${t('wege.conn.count', { n: past.length })}</small></summary>
        <table class="wege-table conn-table"><tbody>${past.map(row).join('')}</tbody></table></details>` : '')
      + (conns.length && !list.length ? `<p class="muted">${t('wege.none_for', { q: esc(query.bahn) })}</p>` : '');
  } else if (tab === 'geplant') {
    const list = visiblePlanned();
    const by = new Map(Object.keys(GROUP).map((k) => [k, []]));
    for (const tk of list) by.get(groupKey(tk)).push(tk);
    box.innerHTML = [...by].filter(([, ts]) => ts.length).map(([k, ts]) => {
      const g = GROUP[k];
      const sum = ts.reduce((a, tk) => a + (tk.stats?.length ?? 0), 0);
      return `<details class="wege-year" open>
        <summary><span class="msr" style="color:${g.color}">${g.icon}</span><strong>${g.label}</strong>
          <small>${t('wege.planned.sum', { n: ts.length, km: km(sum) })}</small></summary>
        <table class="wege-table"><tbody>${ts.map((tk) => `
          <tr data-tour="${esc(tk.id)}" tabindex="0">
            <td class="w-icon"><span class="msr" style="color:${tk.collab ? COLLAB_BLUE : g.color}">${PROFILES[tk.profile]?.icon ?? g.icon}</span></td>
            <td class="w-name"><strong>${esc(tk.name || t('wege.default_tour'))}</strong>${tk.collab ? collabChip(tk.collab) : ''}<small>${esc([PROFILES[tk.profile]?.label, tk.fixed ? t('wege.planned.fixed') : '', tk.updated ? SHORT.format(tk.updated) : ''].filter(Boolean).join(' · '))}</small></td>
            <td class="w-num">${tk.stats?.length ? fmtDistance(tk.stats.length) : '–'}<small>${tk.stats?.ascent ? t('wege.planned.ascent', { v: tk.stats.ascent }) : ''}</small></td>
          </tr>`).join('')}</tbody></table>
      </details>`;
    }).join('') + (planned.length && !list.length ? `<p class="muted">${t('wege.none_for', { q: esc(query.geplant) })}</p>` : '');
  } else {
    const list = visible();
    const searching = !!norm(query.wege).trim() || filtered();
    const head = $('.wege-head-box', content);
    if (head) head.innerHTML = viewHead();
    const byYear = new Map();
    for (const tk of list) { const y = yearOf(tk); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(tk); }
    const mark = (icon, title) => `<span class="msr w-mark" title="${title}">${icon}</span>`;
    const tagLine = (tk) => (tagsOf(tk).length ? `<span class="w-tags">${tagsOf(tk).map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '');
    const rowOf = (tk) => `
          <tr data-id="${esc(tk.id)}" tabindex="0" class="${shownOnMap(tk) ? '' : 'off-map'}">
            <td class="w-icon"><span class="msr" style="color:${colorOf(tk)}">${iconOf(tk)}</span></td>
            <td class="w-name"><strong>${esc(tk.name || t('wege.default_way'))}</strong><small>${esc([view.sort === 'date' ? DATE.format(tk.start) : SHORT.format(tk.start), originOf(tk)].filter(Boolean).join(' · '))}${
              hasValues(tk) ? mark('monitor_heart', t('wege.row.health')) : ''}${tk.pin ? mark('offline_pin', t('wege.row.pinned')) : ''}${
              tk.stub ? mark('folder', t('wege.row.stub')) : ''}</small>${tagLine(tk)}</td>
            <td class="w-num">${view.sort === 'speed' ? tempo(tk, moving(tk) > 0 ? tk.length / moving(tk) : 0) : fmtDistance(tk.length)}<small>${fmtTime(moving(tk))}</small></td>
            <td class="w-eye">${picking ? `<input type="checkbox" class="row-pick" data-pick="${esc(tk.id)}" ${picking.has(tk.id) ? 'checked' : ''} aria-label="${t('wege.row.compare')}">`
              : `<button type="button" class="row-eye" data-eye="${esc(tk.id)}" aria-pressed="${shownOnMap(tk)}"
              title="${shownOnMap(tk) ? t('wege.row.hide') : t('wege.row.show')}"><span class="msr">${shownOnMap(tk) ? 'visibility' : 'visibility_off'}</span></button>`}</td>
          </tr>`;
    // Nicht nach Datum: eine Liste, oben die Summe
    if (view.sort !== 'date') {
      const sum = list.reduce((a, tk) => a + tk.length, 0), time = list.reduce((a, tk) => a + moving(tk), 0);
      box.innerHTML = list.length ? `<p class="muted wege-sum">${t('wege.recorded.sum', { n: list.length, km: km(sum), time: fmtTime(time) })}</p>
        <table class="wege-table"><tbody>${list.map(rowOf).join('')}</tbody></table>`
        : all.length ? `<p class="muted">${t('wege.recorded.none')}</p>` : '';
      paintPicking();
      paintMap();
      return;
    }
    box.innerHTML = [...byYear].map(([y, ts]) => {
      const sum = ts.reduce((a, tk) => a + tk.length, 0), time = ts.reduce((a, tk) => a + moving(tk), 0);
      const shown = ts.filter((tk) => shownOnMap(tk)).length;
      return `<details class="wege-year${shown ? '' : ' off-map'}" ${shown || searching ? 'open' : ''}>
        <summary><button type="button" class="year-eye" data-year="${y}" aria-pressed="${shown > 0}"
            title="${shown ? t('wege.recorded.year_hide', { y }) : t('wege.recorded.year_show', { y })}"><span class="msr">${shown ? 'visibility' : 'visibility_off'}</span></button>
          <strong>${y}</strong>
          <small>${t('wege.recorded.sum', { n: ts.length, km: km(sum), time: fmtTime(time) })}${shown && shown < ts.length ? t('wege.recorded.shown', { n: shown }) : ''}</small></summary>
        <table class="wege-table"><tbody>${ts.map(rowOf).join('')}</tbody></table>
      </details>`;
    }).join('') + (all.length && !list.length ? `<p class="muted">${t('wege.recorded.none')}</p>` : '');
    paintPicking();
  }
  paintMap();
}

content.addEventListener('change', (e) => {
  const k = e.target.closest('[data-view]')?.dataset.view;
  if (!k || selected) return;
  view[k] = e.target.value;
  // Name: A–Z zuerst, Zahlen: das Größte zuerst
  if (k === 'sort') view.dir = e.target.value === 'name' ? 1 : -1;
  saveView();
  paintGroups();
  fitView();
});
content.addEventListener('input', (e) => {
  if (!e.target.matches('.wege-search input')) return;
  query[tab] = e.target.value;
  paintLinkHit();
  paintGroups();
});
/* Ein geteilter WMap-Link in der Suche (Tour, gemeinsam planen, Aufzeichnung): „Link öffnen“ darunter, Enter öffnet */
function paintLinkHit() {
  const b = $('.wege-open-link', content);
  if (b) b.hidden = !linkTarget(query[tab] ?? '');
}
content.addEventListener('submit', (e) => {
  if (!e.target.matches('.wege-search')) return;
  e.preventDefault();
  if (linkTarget(query[tab] ?? '')) openLinkText(query[tab]);
});
content.addEventListener('click', (e) => {
  // Auge am Jahr: alle Wege des Jahres auf der Karte ein- bzw. ausblenden (klappt das Jahr nicht zu)
  const eye = e.target.closest('.year-eye');
  if (eye) {
    e.preventDefault();
    trackShow.setYear(Number(eye.dataset.year), eye.getAttribute('aria-pressed') !== 'true');
    paintGroups();
    fitView();
    return;
  }
  // Auge an der Zeile: diesen einen Weg ein- bzw. ausblenden (öffnet ihn nicht)
  const rowEye = e.target.closest('.row-eye');
  if (rowEye) {
    e.stopPropagation();
    const item = all.find((x) => x.id === rowEye.dataset.eye);
    if (item) tracks.put({ ...withShown(item, !shownOnMap(item)), updated: Date.now() }).then(load).then(() => { paintGroups(); });
    return;
  }
  const tk = e.target.closest('[role="tab"]');
  if (tk) {
    e.preventDefault();
    if (tk.dataset.tab !== tab) { tab = tk.dataset.tab; showList({ push: true }); fitView(); }
    return;
  }
  if (e.target.closest('[data-view-dir]')) { view.dir = -view.dir; saveView(); paintGroups(); return; }
  if (e.target.closest('[data-view-reset]')) { Object.assign(view, { sport: '', tag: '', since: '' }); saveView(); paintGroups(); fitView(); return; }
  const listDo = e.target.closest('[data-list]')?.dataset.list;
  // Alle sichtbaren (Filter, Suche) zum Vergleich ankreuzen – nochmal: keinen
  if (listDo === 'pick-all' && picking) {
    const ids = visible().map((x) => x.id);
    if (ids.every((id) => picking.has(id))) picking.clear(); else ids.forEach((id) => picking.add(id));
    paintGroups();
    return;
  }
  if (listDo === 'open-typed') { openLinkText(query[tab]); return; }
  if (listDo === 'compare-cancel') { picking = null; showList(); return; }
  if (listDo === 'compare-go' && picking?.size > 1) { openCompare([...picking], { push: true }); return; }
  if (listDo === 'pick-tag' && picking?.size) { tagPicked(); return; }
  const row = e.target.closest('tr[data-id]');
  // Nach langem Tippen kommt beim Loslassen oft noch ein Klick – der wählt nicht gleich wieder ab
  if (row && longPressed && Date.now() - longPressed < 400) { longPressed = 0; return; }
  // Vergleichen: die Zeile kreuzt an, statt den Weg zu öffnen
  if (row && picking) {
    const id = row.dataset.id;
    if (picking.has(id)) picking.delete(id); else picking.add(id);
    const box = $(`.row-pick[data-pick="${CSS.escape(id)}"]`, row);
    if (box) box.checked = picking.has(id);
    paintPicking();
    return;
  }
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
    toast(t('wege.conn.deleted'));
    backToList();
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
/** Leiste „Vergleichen“: wie viele angekreuzt sind – vergleichen geht ab zwei, ein Tag ab einem */
function paintPicking() {
  const bar = $('.compare-bar', content);
  if (!bar || !picking) return;
  const n = picking.size;
  $('.compare-count', bar).textContent = n ? t('wege.pick.count', { n }) : t('wege.pick.none');
  $('[data-list="compare-go"]', bar).disabled = n < 2;
  $('[data-list="pick-tag"]', bar).disabled = n < 1;
}

/*
 * Lange auf eine Zeile tippen (oder die Maus halten): auswählen statt öffnen – die Liste geht in den Modus
 * „Vergleichen“ mit dieser Zeile angekreuzt; weitere kreuzt ein kurzer Tipp an. Bewegt sich der Finger (scrollen),
 * zählt es nicht.
 */
const LONG_MS = 500;
let longPressed = 0;                  // Zeit des Loslassens nach langem Tippen (0: keins)
let pressTimer = null, pressAt = null;
content.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.wege-table tr[data-id]');
  if (!row || tab !== 'wege' || selected || e.button > 0 || e.target.closest('button, input, a')) return;
  pressAt = [e.clientX, e.clientY];
  longPressed = 0;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    longPressed = -1;                 // läuft – beim Loslassen die Zeit
    navigator.vibrate?.(15);
    const id = row.dataset.id;
    if (!picking) {
      // Die Leiste kommt über der Liste dazu – die gedrückte Zeile bleibt, wo der Finger ist
      const at = row.getBoundingClientRect().top, y = content.scrollTop;
      picking = new Set([id]);
      showList();
      const now = content.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      content.scrollTop = y + (now ? now.getBoundingClientRect().top - at : 0);
      return;
    }
    if (picking.has(id)) picking.delete(id); else picking.add(id);
    const box = $(`.row-pick[data-pick="${CSS.escape(id)}"]`, row);
    if (box) box.checked = picking.has(id);
    paintPicking();
  }, LONG_MS);
});
const pressEnd = () => { clearTimeout(pressTimer); pressTimer = null; };
content.addEventListener('pointermove', (e) => { if (pressTimer && pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) pressEnd(); });
content.addEventListener('pointerup', () => { pressEnd(); if (longPressed === -1) longPressed = Date.now(); });
content.addEventListener('pointercancel', pressEnd);
// Langes Tippen öffnet am Handy sonst das Kontextmenü (Link kopieren …)
content.addEventListener('contextmenu', (e) => { if (e.target.closest('.wege-table tr[data-id]') && tab === 'wege') e.preventDefault(); });

/** Allen angekreuzten einen Tag geben – gespeichert wie im Weg selbst (auch in der GPX-Datei) */
async function tagPicked() {
  const ids = [...picking];
  const tag = await askTag(allTags());
  if (!tag) return;
  let n = 0;
  for (const id of ids) {
    const tk = await tracks.get(id).catch(() => null);
    if (!tk || tagsOf(tk).includes(tag)) continue;
    await tracks.put({ ...tk, tags: [...tagsOf(tk), tag], updated: Date.now() });
    n += 1;
  }
  await load();
  paintGroups();
  toast(n ? t('wege.pick.tagged', { tag, n }) : t('wege.pick.had_tag', { tag }));
}

/**
 * Wege vergleichen (pages/wege-compare.js) – liegen sie nur im Ordner, erst ganz holen. `focus`: der aktuelle (sonst
 * der neueste); `same`: gleiche Strecke vom Weg aus (Stufen oben). Ein anderer als aktueller (Auswahl, Doppelklick
 * auf der Karte) ist ein neuer Eintrag im Verlauf, Zurück führt wieder zum vorigen; andere Touren im Vergleich
 * (Mehrfachauswahl) ersetzen den Eintrag.
 */
async function openCompare(ids, { push = false, replace = false, focus = null, same = null } = {}) {
  tab = 'wege';
  selected = null;
  const url = `./wege.html?compare=${ids.map(encodeURIComponent).join(',')}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}${same ? `&same=${encodeURIComponent(same)}` : ''}`;
  if (push) history.pushState({ wege: 1, compare: ids, focus, same }, '', url);
  else if (replace) history.replaceState({ ...history.state, compare: ids, focus, same }, '', url);
  const cards = ids.map((id) => all.find((tk) => tk.id === id)).filter(Boolean);
  const own = same && all.find((tk) => tk.id === same);
  document.title = t('wege.window_title', { name: own ? t('wege.compare.same_route') : t('wege.compare.title') });
  if (own) page.header(own.name || t('wege.compare.same_route'), backToList, { icon: 'compare_arrows', color: colorOf(own) });
  else page.header(t('wege.compare.title'), backToList);
  if (cards.length < 2) { toast(t('wege.compare.need_two')); showList(); return; }
  content.innerHTML = `<p class="muted">${t('wege.compare.loading')}</p>`;
  page.open();
  const list = [];
  for (const c of cards) {
    try { list.push(c.stub ? await tracks.full(c) : c); } catch { toast(t('wege.compare.folder_away', { name: c.name || t('wege.default_way') })); }
  }
  if (list.length < 2) { showList(); return; }
  comparing = list;
  compareFocus = list.some((tk) => tk.id === focus) ? focus : list.reduce((a, b) => (b.start > a.start ? b : a)).id;
  compareSame = own ? same : null;
  picking = null;
  compareView = paintCompare(content, list, {
    focus: compareFocus, same: !!own, pool: all,
    onHover: (id) => compareHover(id),
    onSwitch: (id) => openCompare(ids, { push: true, focus: id, same: compareSame }),
    onSet: (next) => {
      if (next.length < 2) toast(t('wege.compare.need_two'));
      openCompare(next.length < 2 ? ids : next, { replace: true, focus: compareFocus, same: compareSame });
    },
  });
  if (own) paintSameLevels(own);
  paintMap();
  fitView();
}

/* Karte im Vergleich: der aktuelle Weg kräftig in seiner Farbe, die anderen schmal und grau, der unter der Maus dunkler */
const CMP_GREY = '#868e96', CMP_HOT = '#343a40';
const SEL_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 3.5, 14, 7];
const SEL_CASING = ['interpolate', ['linear'], ['zoom'], 6, 6, 14, 12];
let compareHot = null;              // Weg, der gerade hervorgehoben ist
function compareHover(id) {
  compareHot = id;
  if (!map.getLayer('weg-sel') || !comparing) return;
  const hot = ['==', ['get', 'id'], id ?? ''];
  const strong = ['any', hot, ['==', ['get', 'id'], compareFocus ?? '']];
  map.setPaintProperty('weg-sel', 'line-width', ['case', hot, 6, ['==', ['get', 'id'], compareFocus ?? ''], 6, 3]);
  map.setPaintProperty('weg-sel', 'line-color', ['case', hot, CMP_HOT, ['get', 'color']]);
  map.setPaintProperty('weg-sel', 'line-opacity', ['case', strong, 1, 0.6]);
  map.setPaintProperty('weg-sel-casing', 'line-width', ['case', strong, 10, 5]);
  // Die hervorgehobene obenauf
  map.setLayoutProperty('weg-sel', 'line-sort-key', ['case', hot, 2, ['==', ['get', 'id'], compareFocus ?? ''], 1, 0]);
}

/**
 * GPX- und FIT-Dateien übernehmen (gewählt oder hineingezogen) – als aufgezeichnete Touren (`gpx`) oder geplante
 * (`gpx-tour`). Aufzeichnungen: mehrere bzw. solche, die es schon gibt, mit der Rückfrage (ui/import-ask.js);
 * Dateien ohne Zeiten werden geplante Touren.
 */
async function importFiles(files, kind) {
  try {
    const read = await readFiles(await Promise.all(files.map((f) => fileOf(f))));
    const bad = read.filter((f) => f.error).length;
    const plan = read.filter((f) => !f.error && (kind === 'gpx-tour' || !f.track));
    for (const f of plan) tours.save({ ...f.tour, id: tours.newId(), description: f.tour.description || t('wege.import.description', { name: f.name }) });
    const planned = plan.length ? `${t('wege.import.planned', { n: plan.length })}${kind === 'gpx' ? t('wege.import.no_times') : t('wege.import.original')}` : '';
    const failed = bad ? t('wege.import.failed', { n: bad }) : '';
    if (kind === 'gpx' && read.some((f) => !f.error && f.track)) {
      const out = await importAsk(read);
      toast([out ? importSummary(out) : t('wege.import.nothing'), planned, failed].filter(Boolean).join(' · '));
    } else toast([planned, failed].filter(Boolean).join(' · ') || t('wege.import.no_tour'));
  } catch (err) { toast(err.message); }
  await load();
  showList();
  fitView();
  autoNames();
}
content.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-file]');
  if (!inp?.files?.length) return;
  await importFiles([...inp.files], inp.dataset.file);
  inp.value = '';
});

/*
 * GPX- und FIT-Dateien auf die Seite ziehen, eine oder mehrere: unter „Geplant“
 * werden es Touren, sonst aufgezeichnete Wege (wie „GPX/FIT importieren“).
 */
const dropHint = Object.assign(document.createElement('div'), { className: 'wege-drop', hidden: true });
document.body.append(dropHint);
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth += 1;
  dropHint.innerHTML = `<div><span class="msr">upload_file</span><strong>${t('wege.drop.title')}</strong>
    <small>${tab === 'geplant' ? t('wege.drop.planned') : t('wege.drop.recorded')}</small></div>`;
  dropHint.hidden = false;
});
addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && (dragDepth -= 1) <= 0) { dragDepth = 0; dropHint.hidden = true; } });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /\.(gpx|fit)$/i.test(f.name) || /gpx/.test(f.type));
  if (!files.length) { toast(t('wege.drop.bad')); return; }
  const plan = tab === 'geplant';
  if (!plan && tab !== 'wege') tab = 'wege';
  await importFiles(files, plan ? 'gpx-tour' : 'gpx');
});

/* ── Ein aufgezeichneter Weg ──────────────────────────────────────────────── */

let heights = null;
let elevation = null;
// Diagramm-Kilometer je Kilometer der Strecke (das Höhenprofil misst selbst)
let chartScale = 1;

/** Was das Diagramm zeigen kann – Höhe immer, der Rest, wenn gemessen */
const CHARTS = {
  ele: { name: t('wege.charts.ele'), icon: 'landscape' },
  speed: { name: t('wege.charts.speed'), unit: 'km/h', icon: 'speed', color: 'light-dark(#1a73e8, #74a7f5)', decimals: 1 },
  hr: { name: t('wege.charts.hr'), unit: 'bpm', icon: 'favorite', color: 'light-dark(#e03131, #ff8787)' },
  cad: { name: t('wege.charts.cad'), unit: '/min', icon: 'autorenew', color: 'light-dark(#ae3ec9, #e599f7)' },
  pow: { name: t('wege.charts.pow'), unit: 'W', icon: 'bolt', color: 'light-dark(#e8590c, #ffa94d)' },
};
const avg = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y) / v.length) : null; };
const top = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.max(...v) : null; };

/** Rundenlänge: gewählt (gemerkt), wenn es sie für die Art gibt – sonst 5 km fürs Rad, 1 km zu Fuß, 500 m auf dem Wasser */
const lapSize = (tk) => {
  const all = lapSizes(tk), want = local.get('wmap.lapsize');
  if (all.includes(want)) return want;
  const sizes = all.filter((x) => x !== 'watch');
  return sizes[0] === 1000 && groupKey(tk) !== 'foot' && !paceOf(tk) ? 5000 : sizes[sizes.length > 2 && sizes[0] < 500 ? 1 : 0];
};
/** „5:12“ bzw. „1:02:03“ */
const clock = (sec) => {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
/** Zu Fuß als Zeit je km, Rudern je 500 m, Schwimmen je 100 m – sonst km/h (track-look.js paceOf) */
const tempo = (tk, mps) => {
  if (!mps) return '–';
  const pace = paceOf(tk);
  return pace ? `${clock(pace.per / mps)} ${pace.unit}` : fmtSpeed(mps);
};

async function select(id, { push = false } = {}) {
  const card = all.find((x) => x.id === id);
  if (!card) { showList(); return; }
  tab = 'wege';
  selected = card;
  heights = null;
  chartScale = 1;
  showLap(null);
  if (push) history.pushState({ wege: 1, id }, '', `./wege.html?id=${encodeURIComponent(id)}`);
  document.title = t('wege.window_title', { name: card.name || t('wege.default_way') });
  trackHeader(card);
  // Liegt der Weg nur im Ordner (Karteikarte): erst zeigen, was die App weiß, dann alle Punkte holen
  let tk = card, missing = '';
  devLog('Tour geöffnet:', card.name || card.id, card.stub ? '(liegt nur im Ordner)' : '(ganz in der App)');
  if (card.stub) {
    paintTrack(card, t('wege.track.fetching'));
    const watch = folderWatch();
    try { tk = await tracks.full(card, watch.step); } catch (err) { missing = t('wege.track.missing', { error: folderError(err.message) }); }
    const took = watch.done(!missing);
    devLog(missing || 'Tour geholt.', took, selected !== card ? '– inzwischen etwas anderes gewählt, nicht gezeigt' : '');
    if (selected !== card) return;
    selected = tk;
    folderPaint = { id: tk.id, before: performance.now(), took };
  }
  paintTrack(tk, missing);
  paintSame(tk);
  if (tk.stub) return;
  paintCharts(tk);
  paintLaps(tk);
  if (folderPaint?.id === tk.id) {
    devLog('Tour gezeigt:', `${folderPaint.took} · anzeigen ${secs(performance.now() - folderPaint.before)}`);
    folderPaint = null;
  }
  showElevation(trackCoords(tk), tk, (h) => {
    $('.st-up', content).textContent = h ? t('wege.unit.m', { v: h.ascent }) : '–';
    paintCharts(tk);
    paintLaps(tk);
  });
  // Aus Health Connect übernommen, aber noch ohne Puls & Co.: nachladen
  if (tk.kind === 'health' && healthAvailable && !tk.source?.values) {
    refreshHealthValues(tk).then(async (next) => {
      if (!next) return;
      await load();
      if (selected?.id === tk.id) select(tk.id);
    }).catch(() => {});
  }
}

/* Zeitmessung beim Holen aus dem Ordner – nur fürs Protokoll der Debug-Fassung (core/devlog.js): jeder Schritt,
   bevor er beginnt, und am Ende die Dauer jedes Schritts. In der Ansicht steht davon nichts. */
let folderPaint = null;
const secs = (ms) => { const digits = ms < 9950 ? 1 : 0; return `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`; };
// Steht mitten im Satz: klein, wenn es unsere eigene Meldung zum Ordner ist
const folderError = (m) => ([t('sync.folder.error.not_connected'), t('sync.folder.error.unreachable')].includes(m) ? m[0].toLocaleLowerCase(locale) + m.slice(1) : m);
function folderWatch() {
  const steps = [], t0 = performance.now();
  let sync = false, file = '';
  return {
    step(name, info = {}) {
      devLog(`Tour aus dem Ordner: ${name} beginnt`, info.path ?? '', info.sync ? '(Abgleich läuft)' : '');
      steps.push({ name, at: performance.now() });
      if (info.sync) sync = true;
      if (info.kb != null) file = `, ${info.kb} kB`;
    },
    done(ok) {
      const end = performance.now();
      const parts = steps.map((s, i) => `${s.name} ${secs((steps[i + 1]?.at ?? end) - s.at)}`);
      return `${ok ? 'Aus dem Ordner in' : 'Versucht'} ${secs(end - t0)}${file}${sync ? ', während der Abgleich lief' : ''}: ${parts.join(' · ')}`;
    },
  };
}

/**
 * Gleiche Strecke schon öfter – in derselben Art (Lauf mit Lauf)? Dann im Weg nur eine Zeile „Mit 3 Touren
 * vergleichen“ (data/same-route.js). Wie streng
 * „gleich“ ist (Genau, Ähnlich, Grob), wählt man im Vergleich oben; gemerkt. Findet die gemerkte Stufe nichts, gilt
 * die strengste, die etwas findet.
 */
const SAME_KEY = 'wmap.sameLevel';
function sameFor(tk) {
  // Nur dieselbe Art: zu einem Lauf nur Läufe, keine Spaziergänge auf derselben Runde.
  // Grob zuerst (das Meiste) – Ähnlich und Genau suchen nur darin
  const rough = sameRoutes(tk, all.filter((x) => sportKey(x) === sportKey(tk)), 'rough');
  const found = Object.fromEntries(Object.keys(SAME_LEVELS).map((k) => [k, k === 'rough' ? rough : sameRoutes(tk, rough, k)]));
  let level = local.get(SAME_KEY) ?? 'exact';
  if (!found[level]?.length) level = Object.keys(SAME_LEVELS).find((k) => found[k].length) ?? 'exact';
  return { found, level, same: found[level] };
}
function paintSame(tk) {
  const box = $('.weg-same', content);
  if (!box || tk.shared) return;
  const { same } = sameFor(tk);
  box.hidden = !same.length;
  if (!same.length) return;
  box.innerHTML = `<button type="button" class="weg-same-go" data-do="same"><span class="msr">compare_arrows</span>
    <span>${t('wege.same.go', { n: same.length })}</span><span class="msr">chevron_right</span></button>`;
  box.dataset.ids = [tk.id, ...same.map((x) => x.id)].join(',');
}
/** Im Vergleich der gleichen Strecke oben: wie streng gleich – mit der Zahl je Stufe; ein Tipp vergleicht neu */
function paintSameLevels(own) {
  const { found, level } = sameFor(own);
  const row = Object.assign(document.createElement('div'), { className: 'chip-row same-level', role: 'group' });
  row.setAttribute('aria-label', t('wege.same.label'));
  row.innerHTML = Object.entries(SAME_LEVELS).map(([k, lv]) => `
    <button type="button" class="chip" data-same-level="${k}" aria-pressed="${k === level}" ${found[k].length ? '' : 'disabled'}
      title="${t('wege.same.title', { n: found[k].length, near: lv.near, len: Math.round(lv.len * 100) })}">${lv.label} <small>${found[k].length}</small></button>`).join('');
  content.prepend(row);
}
content.addEventListener('click', (e) => {
  const lv = e.target.closest('[data-same-level]')?.dataset.sameLevel;
  const own = compareSame && all.find((tk) => tk.id === compareSame);
  if (!lv || !own) return;
  local.set(SAME_KEY, lv);
  const { same } = sameFor(own);
  const ids = [own.id, ...same.map((x) => x.id)];
  if (same.length) openCompare(ids, { focus: ids.includes(compareFocus) ? compareFocus : own.id, same: own.id, replace: true });
});

/** Kopf, Zahlen, Aussehen und Knöpfe eines Wegs; `note`: Hinweis, solange bzw. weil die Punkte fehlen */
function paintTrack(tk, note = '') {
  const mv = moving(tk);
  const hr = (tk.hr ?? []).filter((x) => x > 0);
  const pace = paceOf(tk);
  const sport = sportOf(tk);
  // Art, die ohne eigene Wahl gälte (Health Connect bzw. Profil) – „Standard“ in der Auswahl
  const { sport: _own, ...plain } = tk;
  const natural = sportOf(plain);
  const color = colorOf(tk);
  const shown = shownOnMap(tk);
  content.innerHTML = `
    <p class="weg-when">${LONG.format(tk.start)}, ${t('wege.track.time', { from: TIME.format(tk.start), to: TIME.format(tk.end) })}
      <br><span class="muted">${esc(originOf(tk))}${tk.kind === 'health' ? t('wege.track.from_health') : ''}</span>
      ${tk.from || tk.to ? `<br><span class="muted">${esc([tk.from, tk.to].filter(Boolean).map((x) => x.split(',')[0]).join(' → '))}</span>` : ''}</p>
    ${tk.imported || tk.shared ? '' : `<div class="chip-row weg-tags" role="group" aria-label="${t('wege.tags.label')}"><span class="msr">sell</span>
      ${tagsOf(tk).map((x) => `<button type="button" class="chip" data-tag-del="${esc(x)}" aria-pressed="true" title="${t('wege.tags.remove')}">${esc(x)} <span class="msr">close</span></button>`).join('')}
      <button type="button" class="chip" data-tag-add><span class="msr">add</span> ${t('wege.tags.add')}</button></div>`}
    ${tk.imported ? `<p class="muted weg-note"><span class="msr">upload_file</span> ${t('wege.track.opened')}</p>` : tk.shared ? `<p class="muted weg-note"><span class="msr">share</span> ${t('wege.track.shared')}</p>` : ''}
    ${note ? `<p class="muted weg-note weg-folder"><span class="msr">folder</span><span>${esc(note)}</span></p>` : ''}
    <div class="weg-same" hidden></div>
    <div class="weg-stats">
      <div><strong>${fmtTime(mv)}</strong><small>${t('wege.stats.moving')}</small></div>
      <div><strong>${fmtDistance(tk.length)}</strong><small>${t('wege.stats.length')}</small></div>
      ${pace ? `<div><strong>${mv ? clock(pace.per / (tk.length / mv)) : '–'}</strong><small>${t('wege.stats.avg', { name: esc(pace.unit) })}</small></div>` : ''}
      <div><strong>${mv ? speedOf(tk.length / mv).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–'}</strong><small>${t('wege.stats.avg_kmh').replace(t('common.units.kmh'), speedUnit())}</small></div>
      <div><strong>${tk.top ? Math.round(speedOf(tk.top)) : '–'}</strong><small>${t('wege.stats.max_kmh').replace(t('common.units.kmh'), speedUnit())}</small></div>
      ${tk.stub ? '' : `<div><strong class="st-up">…</strong><small>${t('wege.stats.up')}</small></div>`}
      ${hr.length ? `<div><strong>${avg(hr)}</strong><small>${t('wege.stats.avg_hr')}</small></div>
        <div><strong>${top(hr)}</strong><small>${t('wege.stats.max_hr')}</small></div>` : ''}
      ${avg(tk.cad) ? `<div><strong>${avg(tk.cad)}</strong><small>${t('wege.stats.avg', { name: esc(cadName(tk)) })}</small></div>` : ''}
      ${avg(tk.pow) ? `<div><strong>${t('wege.stats.watt', { v: avg(tk.pow) })}</strong><small>${t('wege.stats.avg_pow')}</small></div>` : ''}
    </div>
    <div class="track-legend" hidden><span>${t('wege.legend.slow')}</span><i></i><span>${t('wege.legend.fast')}</span></div>
    <div class="chip-row weg-chart-tabs" role="group" aria-label="${t('wege.charts.label')}" hidden></div>
    <div class="elevation"></div>
    <section class="weg-laps" hidden></section>
    <details class="weg-look" ${lookOpen ? 'open' : ''} ${tk.shared ? 'hidden' : ''}>
      <summary><span class="msr">palette</span><span class="weg-look-title">${t('wege.look.title')}</span>
        <small><i class="weg-look-dot" style="--c:${esc(color)}"></i>${esc([sportName(sport), shown ? '' : t('wege.look.hidden'), tk.pin ? t('wege.look.pinned') : ''].filter(Boolean).join(' · '))}</small>
        <span class="msr weg-look-arrow">expand_more</span></summary>
      <label class="weg-sport"><span>${t('wege.look.sport.title')}</span>
        <select name="sport" aria-label="${t('wege.look.sport.label')}">
          <option value="">${natural ? t('wege.look.sport.standard', { name: esc(sportName(natural)) }) : t('wege.look.sport.none')}</option>
          ${SPORTS.filter((k) => k !== natural).map((k) => `<option value="${k}" ${tk.sport === k ? 'selected' : ''}>${esc(sportName(k))}</option>`).join('')}
        </select>
      </label>
      <div class="weg-colors" role="group" aria-label="${t('wege.look.color.label')}">
        <span>${t('wege.look.color.title')}</span>
        <button type="button" class="swatch auto" data-color="" aria-pressed="${!tk.color}" title="${t('wege.look.color.auto', { name: esc(sportName(sport)) })}" style="--c:${sportColor(sport)}"><span class="msr">auto_awesome</span></button>
        ${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-pressed="${tk.color === c}" title="${c}" style="--c:${c}"></button>`).join('')}
        <label class="swatch pick" title="${t('wege.look.color.own')}" style="--c:${tk.color && !COLORS.includes(tk.color) ? tk.color : 'transparent'}" aria-pressed="${!!tk.color && !COLORS.includes(tk.color)}">
          <span class="msr">colorize</span><input type="color" name="color" value="${color}" aria-label="${t('wege.look.color.own')}"></label>
      </div>
      <div class="chip-row weg-flags">
        <button type="button" class="chip" data-flag="map" aria-pressed="${shown}"><span class="msr">${shown ? 'visibility' : 'visibility_off'}</span> ${t('wege.look.on_map')}</button>
        ${folderOn ? `<button type="button" class="chip" data-flag="pin" aria-pressed="${!!tk.pin}" title="${t('wege.look.pin_title')}"><span class="msr">offline_pin</span> ${t('wege.row.pinned')}</button>` : ''}
      </div>
    </details>
    <div class="weg-actions">${tk.imported ? `
      <button type="button" class="button primary" data-do="keep"><span class="msr">directions_walk</span> ${t('wege.actions.save_track')}</button>
      <button type="button" class="button" data-do="plan" title="${t('wege.actions.plan_title')}"><span class="msr">edit_road</span> ${t('wege.actions.open_plan')}</button>` : tk.shared ? `
      <button type="button" class="button primary" data-do="keep"><span class="msr">bookmark_add</span> ${t('wege.actions.keep')}</button>
      <button type="button" class="button" data-do="gpx" title="${t('wege.actions.download_title')}"><span class="msr">download</span> ${t('wege.actions.download')}</button>` : `
      <a class="button primary" href="./index.html?track=${encodeURIComponent(tk.id)}&start"><span class="msr">navigation</span> ${t('wege.actions.navigate')}</a>
      <button type="button" class="button" data-do="plan" title="${t('wege.actions.plan_title')}"><span class="msr">edit_road</span> ${t('wege.actions.as_plan')}</button>
      <button type="button" class="button" data-do="share" title="${t('wege.actions.share_title')}"><span class="msr">share</span> ${t('wege.actions.share')}</button>
      <button type="button" class="button" data-do="gpx" title="${t('wege.actions.download_title')}"><span class="msr">download</span> ${t('wege.actions.download')}</button>
      <button type="button" class="button" data-do="compare" title="${t('wege.actions.compare_title')}"><span class="msr">compare_arrows</span> ${t('wege.pick.compare')}</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> ${t('common.delete')}</button>`}
    </div>`;
  $('.weg-look', content)?.addEventListener('toggle', (e) => { lookOpen = e.target.open; });
  page.open();
  paintMap();
  fitView();
}

/**
 * Weg auf der Karte zeigen bzw. ausblenden – von Hand gilt vor dem Jahr und
 * dem Zeitraum. Entspricht es dem, was ohnehin gälte, braucht es keinen Eintrag.
 */
function withShown(tk, want) {
  const { hidden: _h, ...plain } = tk;
  return shownOnMap(plain) === want ? plain : { ...plain, hidden: !want };
}

async function addTag(tk) {
  const tag = await askTag(allTags().filter((x) => !tagsOf(tk).includes(x)));
  if (!tag || tagsOf(tk).includes(tag)) return;
  await saveLook({ tags: [...tagsOf(tk), tag] });
}

/** Tag erfragen – vorhandene (`known`) zum Antippen → Text oder '' */
async function askTag(known) {
  const v = await ask({
    icon: 'sell', title: t('wege.tags.ask.title'),
    html: `<label>${t('wege.tags.ask.label')}<input type="text" name="tag" list="tag-list" maxlength="30" placeholder="${t('wege.tags.ask.placeholder')}"></label>
      <datalist id="tag-list">${known.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      ${known.length ? `<div class="chip-row">${known.map((x) => `<button type="button" class="chip" data-pick-tag="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('wege.tags.ask.add'), icon: 'add', primary: true }],
    // Nur „Hinzufügen“ liest das Feld – Abbrechen (oder Esc) gibt nichts, nicht den Text „null“
    read: (dlg) => ({ tag: dlg.querySelector('input').value.trim() }),
    setup: (dlg) => {
      const input = dlg.querySelector('input');
      input.focus();
      dlg.addEventListener('click', (e) => { const x = e.target.closest('[data-pick-tag]'); if (x) { input.value = x.dataset.pickTag; input.focus(); } });
    },
  });
  return typeof v?.tag === 'string' ? v.tag.replace(/\|/g, '/').trim() : '';
}

/** Art, Farbe, Sichtbarkeit, „offline verfügbar“ speichern und neu zeichnen */
async function saveLook(changes, { quiet = false } = {}) {
  const tk = { ...selected, ...changes };
  for (const k of Object.keys(changes)) if (changes[k] === undefined) delete tk[k];
  // „offline verfügbar“ gilt nur hier – das ist keine Änderung für den Ordner
  if (quiet) await tracks.putQuiet(tk); else await tracks.put({ ...tk, updated: Date.now() });
  if (!quiet) tk.updated = Date.now();
  selected = tk;
  await load();
  if ('sport' in changes || 'color' in changes) trackHeader(tk);
  // Die Ansicht wird neu gezeichnet – an derselben Stelle bleiben
  const keep = content.scrollTop;
  paintTrack(tk, $('.weg-folder span:last-child', content)?.textContent ?? '');
  if (!tk.stub) {
    metricCache = { id: null, m: {} };
    paintCharts(tk);
    paintLaps(tk);
    showElevation(trackCoords(tk), tk, (h) => { $('.st-up', content).textContent = h ? t('wege.unit.m', { v: h.ascent }) : '–'; paintCharts(tk); paintLaps(tk); });
  }
  if (keep) content.scrollTop = keep;
}

content.addEventListener('click', (e) => {
  const tk = selected;
  if (!tk || !('start' in tk)) return;
  const sw = e.target.closest('.swatch[data-color]');
  if (sw) { saveLook({ color: sw.dataset.color || undefined }); return; }
  // Tags: „Rennen“, „Vorbereitung“ … – zum Filtern in der Liste, stehen auch in der GPX-Datei
  const del = e.target.closest('[data-tag-del]')?.dataset.tagDel;
  if (del) { const left = tagsOf(tk).filter((x) => x !== del); saveLook({ tags: left.length ? left : undefined }); return; }
  if (e.target.closest('[data-tag-add]')) { addTag(tk); return; }
  const flag = e.target.closest('[data-flag]')?.dataset.flag;
  if (flag === 'map') {
    saveLook({ hidden: withShown(tk, !shownOnMap(tk)).hidden });
  } else if (flag === 'pin') {
    saveLook({ pin: !tk.pin || undefined }, { quiet: true }).then(() => {
      toast(selected.pin ? t('wege.look.pin_on') : t('wege.look.pin_off'));
      // Gleich abgleichen: holt bzw. lagert aus
      folder.sync().then(() => load()).catch(() => {});
    });
  }
});
content.addEventListener('change', (e) => {
  if (!selected || !('start' in selected)) return;
  if (e.target.matches('.weg-sport select')) saveLook({ sport: e.target.value || undefined });
  if (e.target.matches('.weg-colors input[type="color"]')) saveLook({ color: e.target.value });
});

/**
 * Umschalter über dem Diagramm: Höhe, Tempo, Puls … – nur, was es gibt. Frei kombinierbar: jeder Chip schaltet
 * seine Reihe dazu oder weg (mindestens eine bleibt), gemerkt als Liste in wmap.chart.
 */
let metricCache = { id: null, m: {} };
// Ohne eigene Wahl alle Reihen zusammen in einem Diagramm (Höhe, Tempo, Puls …) – je Reihe eine eigene Skala
const chartWant = () => { const v = local.get('wmap.chart') ?? ['ele', 'speed', 'hr', 'cad', 'pow']; return Array.isArray(v) ? v : [v]; };
function paintCharts(tk) {
  const bar = $('.weg-chart-tabs', content) ?? $('dialog.dg_fs .weg-chart-tabs');
  if (!bar || !elevation) return;
  if (metricCache.id !== tk.id) metricCache = { id: tk.id, m: metrics(tk) };
  const m = metricCache.m;
  const hasEle = !!heights?.elevation?.length;
  const kinds = ['ele', ...['speed', 'hr', 'cad', 'pow'].filter((k) => m[k]?.length)];
  let on = chartWant().filter((k) => kinds.includes(k) && (k !== 'ele' || hasEle));
  if (!on.length) on = [hasEle ? 'ele' : kinds.find((k) => k !== 'ele') ?? 'ele'];
  bar.hidden = kinds.length < 2;
  bar.innerHTML = kinds.map((k) => `<button type="button" class="chip" data-chart="${k}" aria-pressed="${on.includes(k)}">
      <span class="msr">${CHARTS[k].icon}</span> ${esc(k === 'cad' ? cadName(tk) : CHARTS[k].name)}</button>`).join('');
  const len = cumulative(trackCoords(tk)).at(-1);
  if (on.length === 1 && on[0] === 'ele') {
    chartScale = heights?.length ? heights.length / len : 1;
    if (hasEle) elevation.show(heights);
    return;
  }
  // Höhe zusammen mit anderen: auf die Kilometer der Strecke umgerechnet (das Höhenprofil misst selbst)
  chartScale = 1;
  const k = heights?.length ? heights.length / len : 1;
  const mean = (pts) => Math.round(pts.reduce((a, [, v]) => a + v, 0) / pts.length * 10) / 10;
  const list = on.map((kind) => {
    if (kind === 'ele') return { name: t('wege.charts.ele'), unit: 'm', icon: 'landscape', color: 'light-dark(hsl(142 62% 36%), hsl(142 55% 52%))', points: heights.elevation.map(([km, h]) => [km / k, h]), smooth: false };
    const c = CHARTS[kind];
    return { ...c, name: kind === 'cad' ? cadName(tk) : c.name, points: m[kind], mean: mean(m[kind]) };
  });
  if (list.length === 1) {
    const [one] = list, vals = one.points.map(([, v]) => v);
    elevation.showMetric({ ...one, length: len, chips: [['functions', one.mean, t('wege.charts.mean')], ['vertical_align_top', Math.max(...vals), t('wege.charts.max')]] });
    return;
  }
  elevation.showMany(list, len);
}

/** Runden zu 1, 2 oder 5 km – schnellste grün, langsamste rot; antippen zeigt sie auf der Karte */
function paintLaps(tk) {
  const box = $('.weg-laps', content);
  if (!box) return;
  const size = lapSize(tk);
  const r = laps(tk, size, heights);
  box.hidden = !r || r.list.length < 2;
  if (box.hidden) return;
  const hasHr = r.list.some((l) => l.hr), hasUp = r.list.some((l) => l.up !== null);
  const badge = (l) => (l.n === r.fastest ? `<span class="lap-badge fast"><span class="msr">bolt</span> ${t('wege.laps.fastest')}</span>`
    : l.n === r.slowest ? `<span class="lap-badge slow"><span class="msr">hourglass_bottom</span> ${t('wege.laps.slowest')}</span>` : '');
  box.innerHTML = `<div class="laps-head">
      <h3><span class="msr">flag</span> ${t('wege.laps.title')}</h3>
      <div class="chip-row" role="group" aria-label="${t('wege.laps.size')}">${lapSizes(tk).map((x) => `
        <button type="button" class="chip" data-lap-size="${x}" aria-pressed="${x === size}">${x === 'watch' ? t('wege.laps.watch') : x < 1000 ? t('wege.unit.m', { v: x }) : t('wege.unit.km', { v: x / 1000 })}</button>`).join('')}</div>
    </div>
    <table class="laps-table">
      <thead><tr><th>${t('wege.laps.head.lap')}</th><th>${t('wege.laps.head.time')}</th><th>${t('wege.laps.head.pace')}</th>${hasHr ? `<th>${t('wege.stats.avg_hr')}</th>` : ''}${hasUp ? `<th>${t('wege.stats.up')}</th>` : ''}</tr></thead>
      <tbody>${r.list.map((l) => `
        <tr data-lap="${l.n}" tabindex="0" class="${l.n === r.fastest ? 'fast' : l.n === r.slowest ? 'slow' : ''}">
          <td>${l.n}${size === 'watch' || l.dist < size - 1 ? ` <small>${fmtDistance(l.dist)}</small>` : ''}</td>
          <td>${clock(l.time)}</td>
          <td>${tempo(tk, l.speed)}${badge(l)}</td>
          ${hasHr ? `<td>${l.hr ?? '–'}</td>` : ''}${hasUp ? `<td>${t('wege.unit.m', { v: l.up ?? '–' })}</td>` : ''}
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

/** Reihe im Diagramm zu- oder abschalten (Höhe, Tempo, Puls …) – im Blatt und im Vollbild */
function pickChart(e) {
  const chart = e.target.closest('[data-chart]')?.dataset.chart;
  if (!chart || !selected || !('start' in selected)) return false;
  // Die gezeigten Reihen (nicht die gemerkten, die es bei diesem Weg nicht gibt) – dazu oder weg, eine bleibt
  const shown = [...e.target.closest('.weg-chart-tabs').querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.chart);
  const next = shown.includes(chart) ? shown.filter((k) => k !== chart) : [...shown, chart];
  local.set('wmap.chart', next.length ? next : shown);
  paintCharts(selected);
  return true;
}

content.addEventListener('click', (e) => {
  const tk = selected;
  if (!tk || !('start' in tk)) return;
  // Diagramm ins Vollbild (Knopf der Bibliothek, das Diagramm steckt in ihrem <dialog>): Die Umschalter
  // ziehen mit um und beim Schließen wieder zurück vor das Diagramm
  if (e.target.closest('.dg_fsbtn') && elevation?.fullscreen) {
    const dlg = $('dialog.dg_fs:open'), bar = $('.weg-chart-tabs', content);
    if (dlg && bar) {
      dlg.prepend(bar);
      if (!dlg.dataset.wmap) {
        dlg.dataset.wmap = '1';
        dlg.addEventListener('click', pickChart);
        dlg.addEventListener('close', () => { const b = $('.weg-chart-tabs', dlg); if (b) ($('.elevation', content) ?? content.lastChild)?.before(b); });
      }
    }
    return;
  }
  if (pickChart(e)) return;
  const size = e.target.closest('[data-lap-size]')?.dataset.lapSize;
  if (size) { local.set('wmap.lapsize', size === 'watch' ? size : Number(size)); showLap(null); paintLaps(tk); return; }
  const row = e.target.closest('tr[data-lap]');
  if (row) {
    const on = !row.classList.contains('shown');
    content.querySelectorAll('tr[data-lap].shown').forEach((x) => x.classList.remove('shown'));
    const lap = on && laps(tk, lapSize(tk), heights)?.list.find((l) => l.n === Number(row.dataset.lap));
    row.classList.toggle('shown', !!lap);
    showLap(lap ? lapLine(tk, lap) : null);
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

/** Kopf eines Wegs: Symbol der Art, der Name als Feld zwischen ← und ✕ (geteilte und geöffnete: nur lesen) */
function trackHeader(tk, back = backToList) {
  page.header(tk.name ?? '', back, {
    icon: iconOf(tk), color: colorOf(tk),
    onRename: tk.shared ? null : async (name) => {
      if (!selected || selected.id !== tk.id) return;
      selected.name = name;
      // Selbst benannt: WMap vergibt keinen Namen mehr (data/auto-name.js)
      selected.nameAuto = name;
      selected.updated = Date.now();
      await tracks.put(selected);
      await load();
      document.title = t('wege.window_title', { name: name || t('wege.default_way') });
      toast(t('wege.track.name_saved'));
    },
  });
}

content.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-do]')?.dataset.do;
  const tk = selected;
  if (!act || !tk) return;
  if (act === 'car') { sendToCar({ type: 'tour', id: tk.id }, toast); return; }
  if (act === 'same') { openCompare($('.weg-same', content).dataset.ids.split(','), { push: true, focus: tk.id, same: tk.id }); return; }
  if (act === 'compare') { picking = new Set([tk.id]); showList({ push: true }); toast(t('wege.pick.more')); return; }
  if (tk.stub && act !== 'delete') { toast(t('wege.track.need_folder')); return; }
  if (act === 'plan') {
    // Der Verlauf als neue Planung im Planer – ungespeichert, wie eine geteilte Tour
    try { location.href = `./tour.html#t=${await encodeShare(asTour(tk))}`; } catch (err) { toast(err.message); }
  } else if (act === 'keep') {
    keepShared(tk);
  } else if (act === 'share' && 'start' in tk) {
    shareTrack(tk);
  } else if (act === 'share') {
    share({ title: tk.name, text: tk.name, url: async () => `${pageUrl('tour.html')}#t=${await encodeShare(tk)}` }, toast);
  } else if (act === 'gpx' && 'start' in tk) {
    downloadTrack(tk);
  } else if (act === 'gpx') {
    download(`${(tk.name || t('wege.file_default')).replace(/[^\wäöüß]+/gi, '-')}.gpx`, 'start' in tk ? trackGpx(tk) : toGpx(tk, coordsOf(tk.shape)));
  } else if (act === 'delete') {
    const isTrack = 'start' in tk;
    const v = await ask({ icon: 'delete', title: t('wege.delete.title', { name: tk.name || (isTrack ? t('wege.default_way') : t('wege.default_tour')) }), text: isTrack ? t('wege.delete.track') : t('wege.delete.tour'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
    if (v !== 'yes') return;
    if (isTrack) await tracks.remove(tk.id); else tours.remove(tk.id);
    await load();
    backToList();
    fitView();
  }
});

/**
 * Aufzeichnung teilen: als Link (öffnet sich in WMap mit Diagrammen, der
 * Empfänger kann sie speichern) oder als GPX-Datei. Strecke, Zeiten und Tempo
 * gehen immer mit; Puls, Frequenz und Leistung nur, wenn angehakt.
 */
/**
 * Teilen: ein Dialog für alle Wege, auf denen eine Aufzeichnung das Gerät verlässt. Oben die Haken, was mit soll
 * (Puls, Frequenz, Leistung) – sie gelten für alles darunter:
 *   Als Link teilen      der Link trägt die Daten selbst (ohne Server)
 *   30 Tage online       kurzer Link, die Daten liegen so lange auf dem WMap-Server (data/short-link.js)
 *   Datei senden         GPX oder FIT über das Teilen-Menü des Geräts (wo es das gibt)
 *   Herunterladen        GPX oder FIT als Datei
 */
async function shareTrack(tk) {
  const kinds = [['hr', t('wege.charts.hr')], ['cad', cadName(tk)], ['pow', t('wege.charts.pow')]].filter(([k]) => tk[k]?.some((v) => v > 0));
  const keep = Object.fromEntries(kinds.map(([k]) => [k, true]));
  const how = await ask({
    icon: 'share', title: t('wege.share.title'), className: 'stacked',
    text: t('wege.share.text')
      + (kinds.length ? t('wege.share.choose') : ''),
    html: kinds.length ? `<div class="share-opts">${kinds.map(([k, l]) => `
      <label><input type="checkbox" name="${k}" checked> ${esc(l)}</label>`).join('')}</div>` : '',
    buttons: [
      { value: 'link', label: t('wege.share.link'), icon: 'link', primary: true },
      { value: 'short', label: t('wege.share.short'), icon: 'cloud_upload' },
      ...(canShareFiles() ? [{ value: 'send', label: t('wege.share.send'), icon: 'send' }] : []),
      { value: 'file', label: t('wege.share.file'), icon: 'download' },
      { value: 'no', label: t('common.cancel') },
    ],
    setup: (dlg) => dlg.addEventListener('change', (e) => { if (e.target.name in keep) keep[e.target.name] = e.target.checked; }),
  });
  if (how === 'file' || how === 'send') { await downloadTrack(without(tk, keep), how === 'send'); return; }
  if (how !== 'link' && how !== 'short') return;
  const facts = [fmtDistance(tk.length), fmtTime(moving(tk))].join(' · ');
  const title = tk.name || t('wege.default_tour'), text = t('wege.share.message', { title, facts });
  const code = await encodeTrack(tk, keep);
  if (how === 'short') {
    let url;
    try { url = await shortLink('weg', code); } catch (err) { toast(err.message || t('wege.share.short_failed')); return; }
    share({ title, text, url, note: t('wege.share.short_note') }, toast);
    return;
  }
  share({ title, text, url: `${pageUrl('wege.html')}#weg=${code}`, short: () => shortLink('weg', code) }, toast);
}

/** Als GPX oder FIT: herunterladen – oder (`send`) über das Teilen-Menü des Geräts an jemanden schicken */
async function downloadTrack(tk, send = false) {
  const how = await ask({
    icon: send ? 'send' : 'download', title: send ? t('wege.download.send_title') : t('wege.download.title'), className: 'stacked',
    text: t('wege.download.text'),
    buttons: [
      { value: 'gpx', label: t('wege.download.gpx'), icon: 'draft', primary: true },
      { value: 'fit', label: t('wege.download.fit'), icon: 'watch' },
      { value: 'no', label: t('common.cancel') },
    ],
  });
  if (how !== 'gpx' && how !== 'fit') return;
  const name = `${(tk.name || t('wege.file_default')).replace(/[^\wäöüß]+/gi, '-')}.${how}`;
  const type = how === 'gpx' ? 'application/gpx+xml' : 'application/vnd.ant.fit';
  try {
    const body = how === 'gpx' ? trackGpx(tk) : (await import('../data/fit.js')).trackFit(tk);
    // Senden geht hier nicht (ältere App, Browser am Rechner): dann eben herunterladen
    if (send && await shareFile(name, body, type, tk.name || t('wege.default_tour'))) return;
    if (send) toast(t('wege.download.no_send'));
    await download(name, how === 'gpx' ? body : new Blob([body], { type }), how === 'gpx' ? undefined : type);
  } catch (err) { toast(err.message); }
}

const IMPORTED = 'wmap.import';   // geöffnete Datei als Weg (JSON), nur für diese Sitzung

/** Geteilte Aufzeichnung (wege.html#weg=…) bzw. geöffnete Datei (#datei) zeigen – gespeichert wird erst auf Wunsch */
async function openSharedTrack(code) {
  let tk;
  try {
    // #datei: eine geöffnete Datei (pages/import.js legt sie für diese Sitzung ab) – ansehen, dann entscheiden
    tk = code === null ? { ...JSON.parse(sessionStorage.getItem(IMPORTED)), id: 'geteilt', shared: true, imported: true }
      : { ...await decodeTrack(code), id: 'geteilt', shared: true };
  } catch (err) { toast(code === null ? t('wege.shared.file_gone') : err.message || t('wege.shared.bad_link')); showList(); return; }
  tab = 'wege';
  selected = tk;
  heights = null;
  chartScale = 1;
  document.title = t('wege.window_title', { name: tk.name });
  trackHeader(tk, () => { history.replaceState(null, '', './wege.html'); showList(); fitView(); });
  paintTrack(tk);
  paintCharts(tk);
  paintLaps(tk);
  if (folderPaint?.id === tk.id) {
    devLog('Tour gezeigt:', `${folderPaint.took} · anzeigen ${secs(performance.now() - folderPaint.before)}`);
    folderPaint = null;
  }
  showElevation(trackCoords(tk), tk, (h) => { $('.st-up', content).textContent = h ? t('wege.unit.m', { v: h.ascent }) : '–'; paintCharts(tk); paintLaps(tk); });
}

/** Geteilte Aufzeichnung speichern – gibt es sie schon, dorthin */
async function keepShared(tk) {
  const twin = all.find((x) => sameTrack(x, tk));
  if (twin) {
    // Gibt es schon: zusammenführen – mit Haken, was aus der Datei kommt; Abbrechen ändert nichts
    let full;
    try { full = await tracks.full(twin); } catch (err) { toast(t('wege.shared.twin_folder', { error: err.message })); return; }
    const list = choices(full, tk);
    if (list.length) {
      const picks = await askMerge(full, list, { newName: t('wege.shared.new_name') });
      if (!picks) return;
      const next = combine(full, tk, picks);
      if (next !== full) { await tracks.put({ ...next, updated: Date.now() }); await load(); toast(t('wege.shared.merged', { name: full.name })); }
    } else toast(t('wege.shared.same'));
    sessionStorage.removeItem(IMPORTED);
    history.replaceState(null, '', `./wege.html?id=${encodeURIComponent(twin.id)}`);
    select(twin.id);
    return;
  }
  sessionStorage.removeItem(IMPORTED);
  const { shared: _s, imported: _i, ...rest } = tk;
  const saved = { ...rest, id: `w${tk.start.toString(36)}${Math.random().toString(36).slice(2, 5)}`, updated: Date.now() };
  await tracks.put(saved);
  await load();
  toast(t('wege.shared.saved'));
  history.replaceState(null, '', `./wege.html?id=${encodeURIComponent(saved.id)}`);
  select(saved.id);
}

/** Aus einem Weg eine Tour: fester Verlauf, ein paar Punkte zum Weiterplanen (data/tracks.js) */
const asTour = (tk) => trackAsTour(tk, heights, tours.newId());

/* ── Eine geplante Tour ───────────────────────────────────────────────────── */

function selectTour(id, { push = false } = {}) {
  const tk = planned.find((x) => x.id === id);
  if (!tk) { showList(); return; }
  tab = 'geplant';
  selected = tk;
  heights = null;
  if (push) history.pushState({ wege: 1, tour: id }, '', `./wege.html?tour=${encodeURIComponent(id)}`);
  document.title = t('wege.window_title', { name: tk.name || t('wege.default_tour') });
  page.header(tk.name || t('wege.default_tour'), backToList);
  const p = PROFILES[tk.profile];
  const g = groupOf(tk);
  const st = tk.stats ?? {};
  content.innerHTML = `
    <p class="weg-when"><span class="msr" style="color:${g.color}">${p?.icon ?? g.icon}</span>
      ${esc(p?.label ?? g.label)}${tk.fixed ? ` · ${t('wege.planned.fixed')}` : ''}<br>
      <span class="muted">${t('wege.planned.updated', { date: tk.updated ? LONG.format(tk.updated) : '–' })}</span></p>
    <div class="weg-stats">
      <div><strong>${st.length ? fmtDistance(st.length) : '–'}</strong><small>${t('wege.stats.length')}</small></div>
      ${st.time ? `<div><strong>${fmtDuration(st.time)}</strong><small>${t('wege.stats.time')}</small></div>` : ''}
      <div><strong class="st-up">${st.ascent ? t('wege.unit.m', { v: st.ascent }) : '…'}</strong><small>${t('wege.stats.up')}</small></div>
      <div><strong class="st-down">${st.descent ? t('wege.unit.m', { v: st.descent }) : '…'}</strong><small>${t('wege.stats.down')}</small></div>
    </div>
    ${tk.description ? `<p class="tour-text">${esc(tk.description)}</p>` : ''}
    <div class="elevation"></div>
    <div class="weg-actions">
      <a class="button primary" href="./index.html?tour=${encodeURIComponent(tk.id)}&start"><span class="msr">navigation</span> ${t('wege.planned.start')}</a>
      ${carLink.connected && PROFILES[tk.profile]?.costing === 'auto' ? `<button type="button" class="button" data-do="car" title="${t('wege.planned.car_title')}"><span class="msr">directions_car</span> ${t('wege.planned.car')}</button>` : ''}
      <a class="button" href="./tour.html?id=${encodeURIComponent(tk.id)}"><span class="msr">edit_road</span> ${t('wege.planned.open')}</a>
      <button type="button" class="button" data-do="share"><span class="msr">share</span> ${t('wege.actions.share')}</button>
      <button type="button" class="button" data-do="gpx"><span class="msr">download</span> ${t('wege.planned.gpx')}</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> ${t('common.delete')}</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
  showElevation(coordsOf(tk.shape), tk, (h) => {
    if (!h) return;
    if (!st.ascent) $('.st-up', content).textContent = t('wege.unit.m', { v: h.ascent });
    if (!st.descent) $('.st-down', content).textContent = t('wege.unit.m', { v: h.descent ?? 0 });
  });
}

/* ── Eine gemerkte Verbindung ─────────────────────────────────────────────── */

function selectConn(id, { push = false } = {}) {
  const c = conns.find((x) => x.id === id);
  if (!c) { showList(); return; }
  tab = 'bahn';
  selected = c;
  heights = null;
  if (push) history.pushState({ wege: 1, conn: id }, '', `./wege.html?conn=${encodeURIComponent(id)}`);
  document.title = t('wege.window_title', { name: connName(c) });
  page.header(connName(c), backToList);
  const pt = (x) => (x?.point ? x.point.map((v) => v.toFixed(5)).join(',') : '');
  const again = `./index.html?from=${pt(c.from)}&to=${pt(c.to)}&profile=transit`;
  content.innerHTML = `
    <p class="weg-when"><span class="msr" style="color:#1a73e8">directions_transit</span>
      ${LONG.format(c.dep)}<br><span class="muted">${TIME.format(c.dep)} – ${TIME.format(c.arr)} · ${fmtDuration((c.arr - c.dep) / 1000)} · ${changesText(c)}</span></p>
    ${c.arr < Date.now() ? `<p class="muted">${t('wege.conn.in_past')}</p>` : ''}
    <ol class="step-list conn-legs">${transitLegsHtml(c, null)}</ol>
    <div class="weg-actions">
      <a class="button primary" href="${again}"><span class="msr">search</span> ${t('wege.conn.again')}</a>
      ${c.booking ? `<a class="button" href="${esc(c.booking)}" target="_blank" rel="noopener"><span class="msr">confirmation_number</span> ${t('wege.conn.ticket')}</a>` : ''}
      <button type="button" class="button" data-conn-do="delete"><span class="msr">delete</span> ${t('common.delete')}</button>
    </div>`;
  page.open();
  paintMap();
  fitView();
}

/* ── Karte ────────────────────────────────────────────────────────────────── */

/**
 * Tempo als Farbverlauf entlang des gewählten Wegs (langsam grün, schnell
 * rot) – eingeordnet zwischen dem langsamsten und schnellsten Zehntel.
 */
function speedGradient(tk) {
  const c = trackCoords(tk), ts = tk.times, cum = cumulative(c);
  if (!ts || ts.length !== c.length || c.length < 3) return null;
  const v = [];
  for (let i = 1; i < c.length; i += 1) { const dt = ts[i] - ts[i - 1]; v.push(dt > 0 ? distance(c[i - 1], c[i]) / dt : null); }
  const ok = v.filter((x) => x !== null && x < 70).sort((a, b) => a - b);
  if (ok.length < 3) return null;
  const lo = ok[Math.floor(ok.length * 0.1)], hi = ok[Math.floor(ok.length * 0.9)];
  if (hi - lo < 0.5) return null;
  const total = cum.at(-1);
  const color = (x) => { const k = Math.max(0, Math.min(1, ((x ?? lo) - lo) / (hi - lo))); return `hsl(${Math.round(135 - k * 135)} 80% ${Math.round(40 + k * 8)}%)`; };
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

/** Startpunkte der Linien – für die Punkte weit draußen */
const startsOf = (fc) => ({ type: 'FeatureCollection', features: fc.features.filter((f) => f.geometry.coordinates.length)
  .map((f) => ({ type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: f.geometry.coordinates[0] } })) });

/** Kilometermarken entlang des gewählten Wegs bzw. der Tour */
function kmMarks(item) {
  const empty = { type: 'FeatureCollection', features: [] };
  if (!item || item.legs) return empty;
  const c = 'start' in item ? trackCoords(item) : coordsOf(item.shape);
  const cum = cumulative(c), total = cum.at(-1) ?? 0;
  const step = total > 100000 ? 10000 : total > 30000 ? 5000 : 1000;
  const features = [];
  for (let m = step, n = 0; m < total - step * 0.3; m += step, n += 1) {
    features.push({ type: 'Feature', properties: { km: String(m / 1000), n }, geometry: { type: 'Point', coordinates: pointAt(c, cum, m) } });
  }
  return { type: 'FeatureCollection', features };
}

let markers = [];
async function paintMap() {
  await ready;
  // Nur der aktive Reiter liegt auf der Karte – sonst mischt sich Geplantes mit Gefahrenem
  const fc = tab === 'orte' ? { type: 'FeatureCollection', features: [] } : tab === 'bahn'
    ? { type: 'FeatureCollection', features: visibleConns().map((c) => ({
      type: 'Feature', properties: { id: c.id, color: '#1a73e8' }, geometry: { type: 'LineString', coordinates: connCoords(c) },
    })) }
    : tab === 'geplant'
    ? { type: 'FeatureCollection', features: visiblePlanned().map((tk) => ({
      // Gemeinsam geplant: überall blau wie im Planer – auf jedem Gerät gleich, egal welche Art
      type: 'Feature', properties: { id: tk.id, color: tk.collab ? COLLAB_BLUE : groupOf(tk).color }, geometry: { type: 'LineString', coordinates: coordsOf(tk.shape) },
    })) }
    // Aufgezeichnet: in der Farbe der Art bzw. der eigenen, je älter, desto blasser – nur was eingeblendet ist
    : { type: 'FeatureCollection', features: [...onMap()].sort((a, b) => a.start - b.start).map((tk) => ({
      type: 'Feature', properties: { id: tk.id, color: colorOf(tk), opacity: ageOpacity(tk) }, geometry: { type: 'LineString', coordinates: trackCoords(tk) },
    })) };
  if (!map.getSource('wege')) {
    map.addSource('wege', { type: 'geojson', data: fc });
    map.addSource('weg-sel', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    // Weit draußen: je Tour ein Punkt am Start, nah beieinander zusammengefasst mit Anzahl
    map.addSource('wege-pts', { type: 'geojson', data: startsOf(fc), cluster: true, clusterRadius: 44, clusterMaxZoom: 10 });
    map.addSource('weg-km', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 6, a, 14, b];
    map.addLayer({ id: 'wege-casing', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(3, 7), 'line-opacity': 0.8 } });
    map.addLayer({ id: 'wege-line', type: 'line', source: 'wege', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(1.8, 4), 'line-opacity': 0.9 } });
    map.addLayer({ id: 'wege-hover', type: 'line', source: 'wege', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(4, 8) } });
    map.addLayer({ id: 'weg-sel-casing', type: 'line', source: 'weg-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(6, 12) } });
    map.addLayer({ id: 'weg-sel', type: 'line', source: 'weg-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': w(3.5, 7) } });
    // Linien erst ab Zoom 9 – darunter die Punkte (sonst ein Knäuel, das man nicht auseinanderhält)
    for (const id of ['wege-casing', 'wege-line', 'wege-hover']) map.setLayerZoomRange(id, 9, 24);
    map.addLayer({ id: 'wege-cluster', type: 'circle', source: 'wege-pts', maxzoom: 9, filter: ['has', 'point_count'],
      paint: { 'circle-color': '#1a73e8', 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 22] } });
    map.addLayer({ id: 'wege-cluster-n', type: 'symbol', source: 'wege-pts', maxzoom: 9, filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'wege-dot', type: 'circle', source: 'wege-pts', maxzoom: 9, filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    // Kilometer an der gewählten Tour: 1, 2, 3 … (lange Touren: alle 5 bzw. 10 km)
    map.addLayer({ id: 'weg-km-dot', type: 'circle', source: 'weg-km',
      paint: { 'circle-color': '#fff', 'circle-radius': 9, 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'weg-km', type: 'symbol', source: 'weg-km',
      layout: { 'text-field': ['get', 'km'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-allow-overlap': true, 'symbol-sort-key': ['get', 'n'] },
      paint: { 'text-color': '#1a73e8' } });
    map.on('click', 'wege-cluster', async (e) => {
      const f = e.features[0];
      const z = await map.getSource('wege-pts').getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(z, 9.2) });
    });
    // Antippen mit Spielraum: Linien sind nur 2–4 px dünn – erst genau, dann immer weiter um den Punkt, am Handy
    // bis 24 px um den Finger, mit der Maus bis 8 px
    map.on('click', (e) => {
      if (comparing) return;
      const reach = matchMedia('(pointer: coarse)').matches ? [0, 8, 16, 24] : [0, 4, 8];
      const layers = ['wege-dot', 'wege-line'].filter((id) => map.getLayer(id));
      if (map.queryRenderedFeatures(e.point, { layers: ['wege-cluster'] }).length) return;   // geht auf (oben)
      for (const r of reach) {
        const { x, y } = e.point;
        const f = map.queryRenderedFeatures(r ? [[x - r, y - r], [x + r, y + r]] : e.point, { layers })[0];
        if (!f) continue;
        const id = f.properties.id;
        // Vergleichen: auf der Karte ankreuzen wie in der Liste
        if (picking && tab === 'wege') { content.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.click(); return; }
        if (tab === 'bahn') selectConn(id, { push: true }); else if (tab === 'geplant') selectTour(id, { push: true }); else select(id, { push: true });
        return;
      }
    });
    for (const id of ['wege-cluster', 'wege-dot']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('mousemove', 'wege-line', (e) => { map.getCanvas().style.cursor = 'pointer'; hover(e.features[0].properties.id); });
    map.on('mouseleave', 'wege-line', () => { map.getCanvas().style.cursor = ''; hover(null); });
    map.on('mousemove', 'weg-sel', (e) => {
      if (!selected || !elevation) return;
      const c = 'start' in selected ? trackCoords(selected) : coordsOf(selected.shape), cum = cumulative(c);
      const p = nearestOnLine(c, cum, e.lngLat.toArray());
      showHover(map, p.point);
      elevation.showAt(p.along / 1000 * chartScale);
    });
    map.on('mouseleave', 'weg-sel', () => { showHover(map, null); elevation?.showAt(null); if (comparing) { compareHover(null); compareView?.hover(null); } });
    // Vergleich: Maus über einer Linie hebt sie hervor (auch im Diagramm), Doppelklick macht sie zur aktuellen
    map.on('mousemove', 'weg-sel', (e) => {
      if (!comparing) return;
      const id = e.features[0]?.properties.id ?? null;
      compareHover(id === compareFocus ? null : id);
      compareView?.hover(id);
    });
    map.on('click', 'weg-sel', (e) => {
      if (!comparing || !compareFocus || !matchMedia('(pointer: coarse)').matches) return;
      const id = e.features[0]?.properties.id;
      if (!id || id === compareFocus) return;
      if (compareHot === id) { openCompare(comparing.map((tk) => tk.id), { push: true, focus: id, same: compareSame }); return; }
      compareHover(id);
      compareView?.hover(id);
    });
    map.on('dblclick', 'weg-sel', (e) => {
      const id = e.features[0]?.properties.id;
      if (!comparing || !compareFocus || !id || id === compareFocus) return;
      e.preventDefault();
      openCompare(comparing.map((tk) => tk.id), { push: true, focus: id, same: compareSame });
    });
  } else { map.getSource('wege').setData(fc); map.getSource('wege-pts').setData(startsOf(fc)); }
  // Orte: Punkte mit Namen, in der Farbe ihrer Liste (geteilte rot)
  const orte = { type: 'FeatureCollection', features: tab === 'orte' ? orteFeatures() : [] };
  if (!map.getSource('orte')) {
    map.addSource('orte', { type: 'geojson', data: orte });
    map.addLayer({ id: 'orte-dot', type: 'circle', source: 'orte',
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'orte-name', type: 'symbol', source: 'orte', minzoom: 11,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
    map.on('click', 'orte-dot', (e) => {
      const id = e.features[0].properties.id;
      content.querySelector(`tr[data-place="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  } else map.getSource('orte').setData(orte);
  // Ausgewählt: keine Punkte, nur die eine Linie (die weg-sel zeigt)
  for (const id of ['wege-cluster', 'wege-cluster-n', 'wege-dot']) map.setLayoutProperty(id, 'visibility', selected || comparing ? 'none' : 'visible');
  map.getSource('weg-km').setData(kmMarks(selected));

  // Gewähltes obenauf (Wege nach Tempo gefärbt); der Rest tritt zurück
  // (Wege tragen ihre Deckkraft nach Alter mit, alles andere gilt als 1)
  const age = ['coalesce', ['get', 'opacity'], 1];
  map.setPaintProperty('wege-line', 'line-opacity', ['*', age, selected || comparing ? 0.25 : 0.9]);
  map.setPaintProperty('wege-casing', 'line-opacity', ['*', age, selected || comparing ? 0.3 : 0.8]);
  map.setPaintProperty('wege-dot', 'circle-opacity', age);
  markers.forEach((m) => m.remove());
  markers = [];
  if (!comparing && map.getLayer('weg-sel')) {
    map.setPaintProperty('weg-sel', 'line-width', SEL_WIDTH);
    map.setPaintProperty('weg-sel', 'line-opacity', 1);
    map.setPaintProperty('weg-sel-casing', 'line-width', SEL_CASING);
  }
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
    if (!grad) map.setPaintProperty('weg-sel', 'line-color', isTrack ? colorOf(selected) : groupOf(selected).color);
    $('.track-legend', content)?.toggleAttribute('hidden', !grad);
    for (const [p, cls, icon] of [[c[0], 'start', 'trip_origin'], [c.at(-1), 'dest', 'sports_score']]) {
      if (!p) continue;
      const el = Object.assign(document.createElement('div'), { className: `wp-marker ${cls}`, innerHTML: `<span class="msr">${icon}</span>` });
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map));
    }
  } else if (comparing) {
    map.getSource('weg-sel').setData({ type: 'FeatureCollection', features: comparing.map((tk) => ({
      type: 'Feature', properties: { id: tk.id, color: tk.id === compareFocus ? colorOf(tk) : CMP_GREY }, geometry: { type: 'LineString', coordinates: trackCoords(tk) },
    })) });
    map.setPaintProperty('weg-sel', 'line-gradient', undefined);
    compareHover(null);
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
  folderOn = !!(await folder.info().catch(() => null))?.connected;
}

async function openSharedList(code) {
  try {
    const o = await unpackJson(code);
    sharedList = { name: String(o.n || t('wege.places.shared.default_name')).slice(0, 40), items: (o.p ?? []).filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]))
      .map(([lon, lat, name, label]) => ({ point: [lon, lat], name: String(name || t('wege.places.shared.default_place')).slice(0, 80), label: String(label || '').slice(0, 120) })) };
  } catch { toast(t('wege.places.shared.bad')); }
}

function route() {
  const p = new URLSearchParams(location.search);
  tab = tabOf(p);
  const sharedTrack = location.hash.match(/^#weg=(.+)$/)?.[1];
  if (sharedTrack) openSharedTrack(sharedTrack);
  else if (location.hash === '#datei') openSharedTrack(null);
  else if (p.get('id')) select(p.get('id'));
  else if (p.get('conn')) selectConn(p.get('conn'));
  else if (p.get('tour')) selectTour(p.get('tour'));
  else if (p.get('compare')) openCompare(p.get('compare').split(',').filter(Boolean), { focus: p.get('focus'), same: p.get('same') });
  else showList();
}
addEventListener('popstate', () => { route(); fitView(); });
// Geteilte Aufzeichnung geöffnet, während die Seite schon offen ist
addEventListener('hashchange', async () => {
  if (/^#k=/.test(location.hash)) await openShort();
  if (/^#(weg=|datei$)/.test(location.hash)) { route(); fitView(); }
});
/** Kurzer Link (#k=…): den Inhalt vom Server holen – danach steht der lange in der Adresse */
async function openShort() {
  const r = await resolveShort();
  if (typeof r === 'string') toast(r);
}

/* Aus dem Ordner kam etwas dazu oder ging weg */
addEventListener('wmap:folder', async () => {
  await load();
  const list = tab === 'bahn' ? conns : tab === 'geplant' ? planned : all;
  if (selected) { if (!list.some((tk) => tk.id === selected.id)) showList(); } else showList();
  autoNames();
});

/*
 * Im Hintergrund kamen Touren dazu oder änderten sich – Health Connect, Abgleich im Service Worker, Aufzeichnung,
 * Import, Teilen (wmap:data mit Art „track“/„tour“, wmap:health): Die Übersicht zieht nach, ohne die Ansicht zu
 * wechseln. Gesammelt (viele Meldungen beim Import), offen bleibt ein geöffneter Weg; angekreuzte bleiben angekreuzt.
 */
let freshList = null;
let listStale = false;                            // kam etwas, während ein Weg offen war → beim Zurück nachziehen
function listSoon() {
  clearTimeout(freshList);
  freshList = setTimeout(async () => {
    freshList = null;
    if (selected || comparing) { listStale = true; return; }
    const before = all.length;
    await load();
    if (selected || comparing) { listStale = true; return; }
    const y = content.scrollTop;
    showList();
    content.scrollTop = y;
    if (all.length !== before) autoNames();
  }, 800);
}
addEventListener('wmap:data', (e) => { if (['track', 'tour'].includes(e.detail?.kind)) listSoon(); });
addEventListener('wmap:health', (e) => { if (e.detail?.added) listSoon(); });

/*
 * Namen vergeben (data/auto-name.js): frisch importierte Wege und solche, die nur nach Datei, App oder Datum
 * heißen – im Hintergrund, die Liste zieht alle paar Sekunden nach
 */
let nameRepaint = null;
async function autoNames() {
  const n = await nameAll(all, {
    onEach: (id, name) => {
      all = all.map((x) => (x.id === id ? { ...x, name, nameAuto: name } : x));
      nameRepaint ??= setTimeout(() => { nameRepaint = null; if (!selected && tab === 'wege') paintGroups(); }, 2000);
    },
  }).catch(() => 0);
  if (n) toast(t('wege.auto_names', { n }));
}

await load();
if (params.get('liste')) await openSharedList(params.get('liste'));
await openShort();
route();
fitView();
autoSync();
autoNames();
// Lesezeichen geändert (auch aus dem Ordner): Orte neu
addEventListener('wmap:saved', () => { if (tab === 'orte' && !selected) paintGroups(); });
