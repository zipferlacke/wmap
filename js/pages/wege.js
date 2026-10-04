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
 *                  erneut. GPX-Dateien lassen sich auf die Seite ziehen.
 *   Bus & Bahn     gemerkte Verbindungen (data/saved.js): kommende oben,
 *                  vergangene zugeklappt darunter; im Detail alle Abschnitte
 *
 * Das Panel (Rechner links, Handy unten) zeigt die Liste – Suche oben,
 * Tabelle je Gruppe – oder eine Tour/einen Weg im Detail. Kopfzeile siehe
 * ui/map-page.js: ← Übersicht bzw. Liste, ✕ zur Karte, Griff zum Einklappen.
 *
 * Aufruf: wege.html · ?tab=geplant · ?tab=bahn · ?tour=… (geplante Tour) · ?id=… (Weg) · ?conn=… (Verbindung)
 *         · #weg=… (geteilte Aufzeichnung, data/track-share.js)
 */
import { createMap, showHover } from '../map/map.js';
import { heightsAlong } from '../services/routing.js';
import { ElevationProfile } from '../ui/elevation.js';
import { tracks, trackCoords, trackGpx, parseGpx, sameTrack, trackAsTour, hasValues, PROFILE_GROUP } from '../data/tracks.js';
import { sportOf, sportName, sportIcon, sportColor, colorOf, ageOpacity, shownOnMap, trackShow, paceOf, cadName, lapSizes, SPORTS, COLORS } from '../data/track-look.js';
import { findDuplicates } from '../data/duplicates.js';
import { devLog } from '../core/devlog.js';
import { encodeTrack, decodeTrack, without } from '../data/track-share.js';
import { tours, shapeOf, coordsOf, encodeShare, toGpx, download, local } from '../data/store.js';
import { metrics, laps, lapLine } from '../data/track-stats.js';
import { PROFILES } from '../core/config.js';
import { ask, toast } from '../ui/dialogs.js';
import { share, pageUrl } from '../ui/share.js';
import { tourFromGpx, folder } from '../data/folder.js';
import { autoSync } from '../data/auto-sync.js';
import { mapPage } from '../ui/map-page.js';
import { carLink, sendToCar } from '../data/car-link.js';
import { cumulative, pointAt, nearestOnLine, simplifyTo, distance, fmtDistance, fmtDuration, esc, bbox } from '../core/geo.js';
import { connections, places, DEFAULT_LIST, PLACE_KINDS } from '../data/saved.js';
import { packJson, unpackJson } from '../data/store.js';
import { legBadge, changesText, transitLegsHtml } from '../ui/transit-legs.js';
import { healthAvailable, refreshHealthValues, appName } from '../services/health.js';

const $ = (s, root = document) => root.querySelector(s);

const GROUP = {
  foot: { label: 'Zu Fuß', icon: 'directions_walk', color: '#e8590c' },
  bike: { label: 'Rad', icon: 'directions_bike', color: '#2f9e44' },
  car: { label: 'Auto', icon: 'directions_car', color: '#1a73e8' },
};
const groupKey = (t) => PROFILE_GROUP[t.profile] ?? 'foot';
const groupOf = (t) => GROUP[groupKey(t)];
/** Symbol eines Wegs: seine Art (Rudern, Rad …) – ohne Art ein neutrales */
const iconOf = (t) => sportIcon(sportOf(t));
/** Art und Herkunft in der Liste: „Rudern · Zepp“, „Autofahrt · Navigation“, ohne Art nur „GPX“ */
const originOf = (t) => [sportName(sportOf(t)), t.kind === 'health' ? appName(t.source?.app) : t.kind === 'nav' ? 'Navigation' : ''].filter(Boolean).join(' · ');
const yearOf = (t) => new Date(t.start).getFullYear();

const DATE = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const SHORT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const LONG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const km = (m) => (m >= 100000 ? `${Math.round(m / 1000).toLocaleString('de-DE')} km` : fmtDistance(m));
const moving = (t) => t.moving || (t.end - t.start) / 1000;

/* ── Zustand ──────────────────────────────────────────────────────────────── */

const params = new URLSearchParams(location.search);
const tabOf = (p) => (p.get('tab') === 'bahn' || p.has('conn') ? 'bahn' : p.get('tab') === 'geplant' || p.has('tour') ? 'geplant'
  : p.get('tab') === 'orte' || p.has('liste') ? 'orte' : 'wege');
let tab = tabOf(params);
let all = [];                      // aufgezeichnete Wege
let planned = [];                  // geplante Touren
let conns = [];                    // gemerkte Verbindungen mit Bus & Bahn
const query = { wege: '', geplant: '', bahn: '', orte: '' };
let sharedList = null;             // geöffneter Link „?liste=“: { name, items: [{ name, label, point }] }
let selected = null;               // gewählter Weg oder Tour
let folderOn = false;              // Ordner verbunden: „offline verfügbar“ anbieten
let lookOpen = false;              // Tour: Block „Art, Farbe und Anzeige“ aufgeklappt (bleibt es beim Neuzeichnen)

const content = $('.wege-content');

const { map } = createMap('map', { auto3d: false, zoom: 5 });
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
const page = mapPage($('.wege-src'), { map, title: 'Meine Touren', onFit: () => fitView() });
const { panel } = page;

function fitView() {
  if (tab === 'orte' && !selected) {
    const pts = orteFeatures().map((f) => f.geometry.coordinates);
    if (!pts.length) return;
    const b = bbox(pts);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: page.padding(), maxZoom: 15, duration: 600 });
    return;
  }
  const list = selected ? [selected] : tab === 'geplant' ? visiblePlanned() : tab === 'bahn' ? visibleConns() : onMap();
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
/** Was davon auf der Karte liegt (Zeitraum, Auge am Jahr und am Weg); mit Suche: alle Treffer */
const onMap = () => (norm(query.wege).trim() ? visible() : visible().filter((t) => shownOnMap(t)));
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
  const isPlan = tab === 'geplant', isBahn = tab === 'bahn', isOrte = tab === 'orte';
  const ownPlaces = places.all().filter((p) => p.kind !== 'home' && p.kind !== 'work');
  const empty = isOrte
    ? `<div class="tour-empty"><span class="msr">bookmarks</span><p>Noch keine Orte gemerkt.</p>
        <p class="muted">Tippe auf der Karte einen Ort an und dann auf „Merken“ – in „Allgemein“ oder eine eigene Liste wie „Hannover Urlaub“.</p>
        <a class="button primary" href="./index.html"><span class="msr">map</span> Zur Karte</a></div>`
    : isBahn
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
      <a role="tab" href="?tab=orte" data-tab="orte" aria-selected="${isOrte}"><span class="msr">bookmarks</span> Orte <small>${ownPlaces.length}</small></a>
    </nav>
    <p class="muted tab-hint">${isOrte ? 'Orte: deine Lesezeichen in Listen – je Liste teilbar, alles auf der Karte.'
      : isBahn ? 'Bus & Bahn: gemerkte Verbindungen – kommende oben, vergangene zugeklappt darunter.'
      : isPlan ? 'Geplant: Touren, die du noch fahren oder laufen willst – aus dem Planer, übernommen oder importiert.'
        : 'Aufgezeichnet: Wege, die du wirklich gefahren oder gelaufen bist – mit Zeit, Tempo und Puls.'}</p>
    ${isBahn || isOrte ? '' : `<div class="wege-tools">${isPlan ? `
      <a class="button" href="./tour.html"><span class="msr">add_road</span> Tour planen</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx-tour"></label>` : `
      <a class="button" href="./index.html?action=record"><span class="msr">radio_button_checked</span> Aufzeichnen</a>
      <label class="button"><span class="msr">upload_file</span> GPX importieren<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx"></label>`}
    </div>`}
    <form class="wege-search tour-search" role="search" onsubmit="return false">
      <span class="msr">search</span>
      <input type="search" placeholder="${isOrte ? 'Suchen – Name, Liste, Ort …' : isBahn ? 'Suchen – Ort, Linie, Datum …' : isPlan ? 'Suchen – Name, Beschreibung, Rad, Wandern …' : 'Suchen – Name, Ort, Jahr, Monat …'}" value="${esc(query[tab])}" aria-label="Suchen">
    </form>
    ${(isOrte ? (ownPlaces.length || sharedList ? [1] : []) : isBahn ? conns : isPlan ? planned : all).length ? '' : empty}
    ${isBahn || isOrte ? '' : `<a class="wege-sync-hint wege-dup-hint" href="./sync.html#doppelt" hidden>
      <span class="msr">content_copy</span><span></span><span class="msr">chevron_right</span>
    </a>`}
    ${tab === 'wege' && all.length ? `<p class="muted wege-period"><span class="msr">visibility</span>
      <span>Auf der Karte: <strong>${esc(trackShow.label())}</strong>${trackShow.get() === 'all' ? '' : ' – Älteres ist ausgeblendet'}. Das Auge am Jahr blendet ein und aus.
      <a href="./settings.html">Ändern</a></span></p>` : ''}
    <div class="wege-groups"></div>
    <a class="wege-sync-hint" href="./sync.html">
      <span class="msr">sync</span>
      <span>Alles bleibt auf diesem Gerät. Auf andere Geräte über einen Ordner (Nextcloud, Drive …), Health Connect
        oder eine Sicherung: <strong>Sicherung &amp; Synchronisation</strong></span>
      <span class="msr">chevron_right</span>
    </a>`;
  paintGroups();
  // Dieselbe Tour aus zwei Quellen (Uhr und Handy, Health Connect und Ordner): hier Bescheid sagen
  const dup = content.querySelector('.wege-dup-hint');
  if (dup) {
    findDuplicates().then((d) => {
      const n = (isPlan ? d.tours : d.tracks).reduce((sum, g) => sum + g.length - 1, 0);
      if (!n || !dup.isConnected) return;
      dup.children[1].innerHTML = `<strong>${n} ${n === 1 ? 'Tour gibt' : 'Touren gibt'} es doppelt</strong> – zusammenführen und wählen, wessen Strecke und Gesundheitsdaten bleiben`;
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
      <td class="w-num"><button type="button" class="button" data-shape="round no-background" data-place-route="${esc(p.id)}" title="Route dorthin"><span class="msr">directions</span></button></td>
    </tr>`;
  const shared = sharedList ? `<section class="orte-shared">
      <p><span class="msr">share</span> Geteilte Liste <strong>„${esc(sharedList.name)}“</strong> – ${sharedList.items.length} Orte (rot auf der Karte)</p>
      <div class="orte-shared-actions">
        <button type="button" class="button primary" data-list-take><span class="msr">bookmark_add</span> Als Liste übernehmen</button>
        <button type="button" class="button" data-list-drop>Verwerfen</button>
      </div>
      <table class="wege-table"><tbody>${sharedList.items.map((p) => `<tr><td class="w-icon"><span class="msr" style="color:#e03131">place</span></td>
        <td class="w-name"><strong>${esc(p.name)}</strong><small>${esc(p.label ?? '')}</small></td><td></td></tr>`).join('')}</tbody></table>
    </section>` : '';
  box.innerHTML = shared
    + (fixedPl.length ? `<details class="wege-year" open><summary><span class="msr" style="color:#1a73e8">home</span><strong>Zuhause &amp; Arbeit</strong><small>${fixedPl.length}</small></summary>
        <table class="wege-table"><tbody>${fixedPl.map(row).join('')}</tbody></table></details>` : '')
    + groups.map(([name, l]) => `<details class="wege-year" open>
        <summary><i style="background:${listColor(name)}"></i><strong>${esc(name)}</strong><small>${l.length} ${l.length === 1 ? 'Ort' : 'Orte'}</small></summary>
        <div class="orte-list-actions">
          <button type="button" class="link-button" data-list-share="${esc(name)}"><span class="msr">share</span> Liste teilen</button>
          <button type="button" class="link-button" data-list-show="${esc(name)}"><span class="msr">zoom_out_map</span> Auf der Karte</button>
        </div>
        <table class="wege-table"><tbody>${l.map(row).join('')}</tbody></table>
      </details>`).join('')
    + (query.orte && !fixedPl.length && !groups.length ? `<p class="muted">Nichts gefunden für „${esc(query.orte)}“.</p>` : '');
  paintMap();
}

/** Liste als Link: alle Orte stecken gepackt in der Adresse – ohne Server */
async function shareList(name) {
  const items = places.inList(name).map((p) => [+p.point[0].toFixed(5), +p.point[1].toFixed(5), p.name, p.label ?? '']);
  share({ title: `Liste „${name}“`, text: `${name} – ${items.length} Orte in WMap`, url: async () => `${pageUrl('wege.html')}?liste=${await packJson({ n: name, p: items })}` }, toast);
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
    if (places.lists().includes(name) && places.inList(name).length) name = `${name} (geteilt)`;
    const n = places.addList(name, sharedList.items);
    toast(`${n} ${n === 1 ? 'Ort' : 'Orte'} in „${name}“ übernommen`);
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
    const searching = !!norm(query.wege).trim();
    const byYear = new Map();
    for (const t of list) { const y = yearOf(t); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(t); }
    const mark = (icon, title) => `<span class="msr w-mark" title="${title}">${icon}</span>`;
    box.innerHTML = [...byYear].map(([y, ts]) => {
      const sum = ts.reduce((a, t) => a + t.length, 0), time = ts.reduce((a, t) => a + moving(t), 0);
      const shown = ts.filter((t) => shownOnMap(t)).length;
      return `<details class="wege-year${shown ? '' : ' off-map'}" ${shown || searching ? 'open' : ''}>
        <summary><button type="button" class="year-eye" data-year="${y}" aria-pressed="${shown > 0}"
            title="${shown ? `${y} auf der Karte ausblenden` : `${y} auf der Karte zeigen`}"><span class="msr">${shown ? 'visibility' : 'visibility_off'}</span></button>
          <strong>${y}</strong>
          <small>${ts.length} ${ts.length === 1 ? 'Weg' : 'Wege'} · ${km(sum)} · ${fmtDuration(time)}${shown && shown < ts.length ? ` · ${shown} auf der Karte` : ''}</small></summary>
        <table class="wege-table"><tbody>${ts.map((t) => `
          <tr data-id="${esc(t.id)}" tabindex="0" class="${shownOnMap(t) ? '' : 'off-map'}">
            <td class="w-icon"><span class="msr" style="color:${colorOf(t)}">${iconOf(t)}</span></td>
            <td class="w-name"><strong>${esc(t.name || 'Weg')}</strong><small>${esc([DATE.format(t.start), originOf(t)].filter(Boolean).join(' · '))}${
              hasValues(t) ? mark('monitor_heart', 'Mit Gesundheitsdaten (Puls, Frequenz, Leistung)') : ''}${t.pin ? mark('offline_pin', 'Offline verfügbar') : ''}${
              t.stub ? mark('folder', 'Liegt im Ordner – wird beim Öffnen geholt') : ''}</small></td>
            <td class="w-num">${fmtDistance(t.length)}<small>${fmtDuration(moving(t))}</small></td>
            <td class="w-eye"><button type="button" class="row-eye" data-eye="${esc(t.id)}" aria-pressed="${shownOnMap(t)}"
              title="${shownOnMap(t) ? 'Auf der Karte ausblenden' : 'Auf der Karte zeigen'}"><span class="msr">${shownOnMap(t) ? 'visibility' : 'visibility_off'}</span></button></td>
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
/** GPX-Dateien übernehmen – als aufgezeichnete Wege (`gpx`) oder geplante Touren (`gpx-tour`) */
async function importFiles(files, kind) {
  try {
    let n = 0;
    if (kind === 'gpx') {
      let twice = 0;
      for (const f of files) {
        for (const t of parseGpx(await f.text())) {
          if (all.some((x) => sameTrack(x, t))) { twice += 1; continue; }
          await tracks.put(t);
          all.push(t);
          n += 1;
        }
      }
      toast(n ? `${n} ${n === 1 ? 'Weg' : 'Wege'} importiert${twice ? ` (${twice} gab es schon)` : ''}` : twice ? 'Die Wege gibt es schon' : 'In der Datei war kein Weg');
    } else {
      for (const f of files) {
        const t = tourFromGpx(await f.text(), f.name);
        if (!t) continue;
        tours.save({ ...t, id: tours.newId(), description: t.description || `Aus ${f.name} importiert` });
        n += 1;
      }
      toast(n ? `${n} ${n === 1 ? 'Tour' : 'Touren'} importiert – mit Originalverlauf` : 'In der Datei war keine Tour');
    }
  } catch (err) { toast(err.message); }
  await load();
  showList();
  fitView();
}
content.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-file]');
  if (!inp?.files?.length) return;
  await importFiles([...inp.files], inp.dataset.file);
  inp.value = '';
});

/*
 * GPX-Dateien auf die Seite ziehen: unter „Geplant“ werden es Touren, sonst
 * aufgezeichnete Wege (wie „GPX importieren“).
 */
const dropHint = Object.assign(document.createElement('div'), { className: 'wege-drop', hidden: true });
document.body.append(dropHint);
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth += 1;
  dropHint.innerHTML = `<div><span class="msr">upload_file</span><strong>GPX hier ablegen</strong>
    <small>${tab === 'geplant' ? 'wird als geplante Tour übernommen' : 'wird als aufgezeichnete Tour übernommen'}</small></div>`;
  dropHint.hidden = false;
});
addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && (dragDepth -= 1) <= 0) { dragDepth = 0; dropHint.hidden = true; } });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => /\.gpx$/i.test(f.name) || /gpx/.test(f.type));
  if (!files.length) { toast('Das sind keine GPX-Dateien'); return; }
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
  ele: { name: 'Höhe', icon: 'landscape' },
  speed: { name: 'Tempo', unit: 'km/h', icon: 'speed', color: 'light-dark(#1a73e8, #74a7f5)', decimals: 1 },
  hr: { name: 'Puls', unit: 'bpm', icon: 'favorite', color: 'light-dark(#e03131, #ff8787)' },
  cad: { name: 'Frequenz', unit: '/min', icon: 'autorenew', color: 'light-dark(#ae3ec9, #e599f7)' },
  pow: { name: 'Leistung', unit: 'W', icon: 'bolt', color: 'light-dark(#e8590c, #ffa94d)' },
};
const avg = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.round(v.reduce((x, y) => x + y) / v.length) : null; };
const top = (a) => { const v = (a ?? []).filter((x) => x > 0); return v.length ? Math.max(...v) : null; };

/** Rundenlänge: gewählt (gemerkt), wenn es sie für die Art gibt – sonst 5 km fürs Rad, 1 km zu Fuß, 500 m auf dem Wasser */
const lapSize = (t) => {
  const all = lapSizes(t), want = local.get('wmap.lapsize');
  if (all.includes(want)) return want;
  const sizes = all.filter((x) => x !== 'watch');
  return sizes[0] === 1000 && groupKey(t) !== 'foot' && !paceOf(t) ? 5000 : sizes[sizes.length > 2 && sizes[0] < 500 ? 1 : 0];
};
/** „5:12“ bzw. „1:02:03“ */
const clock = (sec) => {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
/** Zu Fuß als Zeit je km, Rudern je 500 m, Schwimmen je 100 m – sonst km/h (track-look.js paceOf) */
const tempo = (t, mps) => {
  if (!mps) return '–';
  const pace = paceOf(t);
  return pace ? `${clock(pace.per / mps)} ${pace.unit}` : `${(mps * 3.6).toFixed(1).replace('.', ',')} km/h`;
};

async function select(id, { push = false } = {}) {
  const card = all.find((x) => x.id === id);
  if (!card) { showList(); return; }
  tab = 'wege';
  selected = card;
  heights = null;
  chartScale = 1;
  showLap(null);
  if (push) history.pushState({ id }, '', `./wege.html?id=${encodeURIComponent(id)}`);
  document.title = `${card.name || 'Weg'} – WMap`;
  page.header(card.name || 'Weg', () => showList({ push: true }));
  // Liegt der Weg nur im Ordner (Karteikarte): erst zeigen, was die App weiß, dann alle Punkte holen
  let t = card, missing = '';
  devLog('Tour geöffnet:', card.name || card.id, card.stub ? '(liegt nur im Ordner)' : '(ganz in der App)');
  if (card.stub) {
    paintTrack(card, 'Hole die Tour aus dem Ordner …');
    const watch = folderWatch();
    try { t = await tracks.full(card, watch.step); } catch (err) { missing = `Punkte und Messwerte liegen im Ordner – ${err.message.replace(/^Der Ordner/, 'der')}.`; }
    const took = watch.done(!missing);
    devLog(missing || 'Tour geholt.', took, selected !== card ? '– inzwischen etwas anderes gewählt, nicht gezeigt' : '');
    if (selected !== card) return;
    selected = t;
    const before = performance.now();
    paintTrack(t, missing ? `${missing} ${took}` : took);
    folderPaint = { id: t.id, before };
  } else paintTrack(t, missing);
  if (t.stub) return;
  paintCharts(t);
  paintLaps(t);
  if (folderPaint?.id === t.id) {
    const el = $('.weg-folder span:last-child', content);
    if (el) el.textContent += ` · anzeigen ${secs(performance.now() - folderPaint.before)}`;
    devLog('Tour gezeigt:', el?.textContent ?? '');
    folderPaint = null;
  }
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

/* Zeitmessung beim Holen aus dem Ordner: Der Hinweis nennt, solange gewartet wird, den laufenden Schritt und
   danach, wie lange jeder gedauert hat – so ist am Gerät zu sehen, wo es hängt. */
let folderPaint = null;
const secs = (ms) => `${(ms / 1000).toFixed(ms < 9950 ? 1 : 0).replace('.', ',')} s`;
function folderWatch() {
  const steps = [], t0 = performance.now();
  let sync = false, file = '';
  const show = () => {
    const el = $('.weg-folder span:last-child', content), now = steps.at(-1);
    if (el && now) el.textContent = `Hole die Tour aus dem Ordner … ${now.name}, ${Math.round((performance.now() - t0) / 1000)} s${sync ? ' (der Abgleich läuft gerade)' : ''}`;
  };
  const timer = setInterval(show, 500);
  return {
    step(name, info = {}) {
      devLog(`Tour aus dem Ordner: ${name} beginnt`, info.path ?? '', info.sync ? '(Abgleich läuft)' : '');
      steps.push({ name, at: performance.now() });
      if (info.sync) sync = true;
      if (info.kb != null) file = `, ${info.kb} kB`;
    },
    done(ok) {
      clearInterval(timer);
      const end = performance.now();
      const parts = steps.map((s, i) => `${s.name} ${secs((steps[i + 1]?.at ?? end) - s.at)}`);
      return `${ok ? 'Aus dem Ordner in' : 'Versucht'} ${secs(end - t0)}${file}${sync ? ', während der Abgleich lief' : ''}: ${parts.join(' · ')}`;
    },
  };
}

/** Kopf, Zahlen, Aussehen und Knöpfe eines Wegs; `note`: Hinweis, solange bzw. weil die Punkte fehlen */
function paintTrack(t, note = '') {
  const mv = moving(t);
  const hr = (t.hr ?? []).filter((x) => x > 0);
  const pace = paceOf(t);
  const sport = sportOf(t);
  // Art, die ohne eigene Wahl gälte (Health Connect bzw. Profil) – „Standard“ in der Auswahl
  const { sport: _own, ...plain } = t;
  const natural = sportOf(plain);
  const color = colorOf(t);
  const shown = shownOnMap(t);
  content.innerHTML = `
    <label class="weg-name"><span class="msr">edit</span><input type="text" value="${esc(t.name ?? '')}" placeholder="Name" aria-label="Name des Wegs" ${t.shared ? 'readonly' : ''}></label>
    <p class="weg-when"><span class="msr" style="color:${color}">${iconOf(t)}</span>
      ${LONG.format(t.start)}, ${TIME.format(t.start)}–${TIME.format(t.end)} Uhr
      <br><span class="muted">${esc(originOf(t))}${t.kind === 'health' ? ' · aus Health Connect' : ''}</span>
      ${t.from || t.to ? `<br><span class="muted">${esc([t.from, t.to].filter(Boolean).map((x) => x.split(',')[0]).join(' → '))}</span>` : ''}</p>
    ${t.shared ? '<p class="muted weg-note"><span class="msr">share</span> Geteilte Aufzeichnung – noch nicht gespeichert.</p>' : ''}
    ${note ? `<p class="muted weg-note weg-folder"><span class="msr">folder</span><span>${esc(note)}</span></p>` : ''}
    <div class="weg-stats">
      <div><strong>${fmtDistance(t.length)}</strong><small>Strecke</small></div>
      <div><strong>${fmtDuration(mv)}</strong><small>in Bewegung</small></div>
      ${pace ? `<div><strong>${mv ? clock(pace.per / (t.length / mv)) : '–'}</strong><small>Ø ${esc(pace.unit)}</small></div>` : ''}
      <div><strong>${mv ? (t.length / mv * 3.6).toFixed(1).replace('.', ',') : '–'}</strong><small>Ø km/h</small></div>
      <div><strong>${t.top ? Math.round(t.top * 3.6) : '–'}</strong><small>max. km/h</small></div>
      ${t.stub ? '' : '<div><strong class="st-up">…</strong><small>Anstieg</small></div>'}
      ${hr.length ? `<div><strong>${avg(hr)}</strong><small>Ø Puls</small></div>
        <div><strong>${top(hr)}</strong><small>max. Puls</small></div>` : ''}
      ${avg(t.cad) ? `<div><strong>${avg(t.cad)}</strong><small>Ø ${esc(cadName(t))}</small></div>` : ''}
      ${avg(t.pow) ? `<div><strong>${avg(t.pow)} W</strong><small>Ø Leistung</small></div>` : ''}
    </div>
    <div class="track-legend" hidden><span>langsam</span><i></i><span>schnell</span></div>
    <div class="chip-row weg-chart-tabs" role="group" aria-label="Diagramm" hidden></div>
    <div class="elevation"></div>
    <section class="weg-laps" hidden></section>
    <details class="weg-look" ${lookOpen ? 'open' : ''} ${t.shared ? 'hidden' : ''}>
      <summary><span class="msr">palette</span><span class="weg-look-title">Art, Farbe und Anzeige</span>
        <small><i class="weg-look-dot" style="--c:${esc(color)}"></i>${esc([sportName(sport), shown ? '' : 'ausgeblendet', t.pin ? 'offline verfügbar' : ''].filter(Boolean).join(' · '))}</small>
        <span class="msr weg-look-arrow">expand_more</span></summary>
      <label class="weg-sport"><span>Art</span>
        <select name="sport" aria-label="Art der Tour">
          <option value="">${natural ? `${esc(sportName(natural))} (Standard)` : 'Keine – nur GPX'}</option>
          ${SPORTS.filter((k) => k !== natural).map((k) => `<option value="${k}" ${t.sport === k ? 'selected' : ''}>${esc(sportName(k))}</option>`).join('')}
        </select>
      </label>
      <div class="weg-colors" role="group" aria-label="Farbe auf der Karte">
        <span>Farbe</span>
        <button type="button" class="swatch auto" data-color="" aria-pressed="${!t.color}" title="Farbe der Art (${esc(sportName(sport))})" style="--c:${sportColor(sport)}"><span class="msr">auto_awesome</span></button>
        ${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" aria-pressed="${t.color === c}" title="${c}" style="--c:${c}"></button>`).join('')}
        <label class="swatch pick" title="Eigene Farbe" style="--c:${t.color && !COLORS.includes(t.color) ? t.color : 'transparent'}" aria-pressed="${!!t.color && !COLORS.includes(t.color)}">
          <span class="msr">colorize</span><input type="color" name="color" value="${color}" aria-label="Eigene Farbe"></label>
      </div>
      <div class="chip-row weg-flags">
        <button type="button" class="chip" data-flag="map" aria-pressed="${shown}"><span class="msr">${shown ? 'visibility' : 'visibility_off'}</span> Auf der Karte</button>
        ${folderOn ? `<button type="button" class="chip" data-flag="pin" aria-pressed="${!!t.pin}" title="Bleibt ganz in der App – auch ohne den Ordner"><span class="msr">offline_pin</span> Offline verfügbar</button>` : ''}
      </div>
    </details>
    <div class="weg-actions">${t.shared ? `
      <button type="button" class="button primary" data-do="keep"><span class="msr">bookmark_add</span> Bei mir speichern</button>
      <button type="button" class="button" data-do="gpx" title="Als GPX- oder FIT-Datei"><span class="msr">download</span> Herunterladen</button>` : `
      <a class="button primary" href="./index.html?track=${encodeURIComponent(t.id)}&start"><span class="msr">navigation</span> Navigieren</a>
      <button type="button" class="button" data-do="plan" title="Im Planer als neue Tour öffnen – gespeichert wird erst dort"><span class="msr">edit_road</span> Als Planung öffnen</button>
      <button type="button" class="button" data-do="share" title="Die Aufzeichnung als Link teilen – mit Zeiten, Tempo und auf Wunsch Puls &amp; Co."><span class="msr">share</span> Teilen</button>
      <button type="button" class="button" data-do="gpx" title="Als GPX- oder FIT-Datei"><span class="msr">download</span> Herunterladen</button>
      <button type="button" class="button" data-do="delete"><span class="msr">delete</span> Löschen</button>`}
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
function withShown(t, want) {
  const { hidden: _h, ...plain } = t;
  return shownOnMap(plain) === want ? plain : { ...plain, hidden: !want };
}

/** Art, Farbe, Sichtbarkeit, „offline verfügbar“ speichern und neu zeichnen */
async function saveLook(changes, { quiet = false } = {}) {
  const t = { ...selected, ...changes };
  for (const k of Object.keys(changes)) if (changes[k] === undefined) delete t[k];
  // „offline verfügbar“ gilt nur hier – das ist keine Änderung für den Ordner
  if (quiet) await tracks.putQuiet(t); else await tracks.put({ ...t, updated: Date.now() });
  if (!quiet) t.updated = Date.now();
  selected = t;
  await load();
  // Die Ansicht wird neu gezeichnet – an derselben Stelle bleiben
  const keep = content.scrollTop;
  paintTrack(t, $('.weg-folder span:last-child', content)?.textContent ?? '');
  if (!t.stub) {
    metricCache = { id: null, m: {} };
    paintCharts(t);
    paintLaps(t);
    showElevation(trackCoords(t), t, (h) => { $('.st-up', content).textContent = h ? `${h.ascent} m` : '–'; paintCharts(t); paintLaps(t); });
  }
  if (keep) content.scrollTop = keep;
}

content.addEventListener('click', (e) => {
  const t = selected;
  if (!t || !('start' in t)) return;
  const sw = e.target.closest('.swatch[data-color]');
  if (sw) { saveLook({ color: sw.dataset.color || undefined }); return; }
  const flag = e.target.closest('[data-flag]')?.dataset.flag;
  if (flag === 'map') {
    saveLook({ hidden: withShown(t, !shownOnMap(t)).hidden });
  } else if (flag === 'pin') {
    saveLook({ pin: !t.pin || undefined }, { quiet: true }).then(() => {
      toast(selected.pin ? 'Bleibt ganz in der App' : 'Liegt nach dem nächsten Abgleich nur noch im Ordner');
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

/** Umschalter über dem Diagramm: Höhe, Tempo, Puls … – nur, was es gibt */
let metricCache = { id: null, m: {} };
function paintCharts(t) {
  const bar = $('.weg-chart-tabs', content) ?? $('dialog.dg_fs .weg-chart-tabs');
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
      <div class="chip-row" role="group" aria-label="Länge einer Runde">${lapSizes(t).map((x) => `
        <button type="button" class="chip" data-lap-size="${x}" aria-pressed="${x === size}">${x === 'watch' ? 'Uhr' : x < 1000 ? `${x} m` : `${x / 1000} km`}</button>`).join('')}</div>
    </div>
    <table class="laps-table">
      <thead><tr><th>Runde</th><th>Zeit</th><th>Tempo</th>${hasHr ? '<th>Ø Puls</th>' : ''}${hasUp ? '<th>Anstieg</th>' : ''}</tr></thead>
      <tbody>${r.list.map((l) => `
        <tr data-lap="${l.n}" tabindex="0" class="${l.n === r.fastest ? 'fast' : l.n === r.slowest ? 'slow' : ''}">
          <td>${l.n}${size === 'watch' || l.dist < size - 1 ? ` <small>${fmtDistance(l.dist)}</small>` : ''}</td>
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

/** Diagramm wählen (Höhe, Tempo, Puls …) – im Blatt und im Vollbild */
function pickChart(e) {
  const chart = e.target.closest('[data-chart]')?.dataset.chart;
  if (!chart || !selected || !('start' in selected)) return false;
  local.set('wmap.chart', chart);
  paintCharts(selected);
  return true;
}

content.addEventListener('click', (e) => {
  const t = selected;
  if (!t || !('start' in t)) return;
  // Diagramm ins Vollbild (Knopf der Bibliothek, das Diagramm steckt jetzt in ihrem <dialog>): Die Umschalter
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
  if (size) { local.set('wmap.lapsize', size === 'watch' ? size : Number(size)); showLap(null); paintLaps(t); return; }
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
  await load();
  page.header(selected.name || 'Weg', () => showList({ push: true }));
  toast('Name gespeichert');
});

content.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-do]')?.dataset.do;
  const t = selected;
  if (!act || !t) return;
  if (act === 'car') { sendToCar({ type: 'tour', id: t.id }, toast); return; }
  if (t.stub && act !== 'delete') { toast('Dafür braucht es die Tour aus dem Ordner – der ist gerade nicht erreichbar'); return; }
  if (act === 'plan') {
    // Der Verlauf als neue Planung im Planer – ungespeichert, wie eine geteilte Tour
    try { location.href = `./tour.html#t=${await encodeShare(asTour(t))}`; } catch (err) { toast(err.message); }
  } else if (act === 'keep') {
    keepShared(t);
  } else if (act === 'share' && 'start' in t) {
    shareTrack(t);
  } else if (act === 'share') {
    share({ title: t.name, text: t.name, url: async () => `${pageUrl('tour.html')}#t=${await encodeShare(t)}` }, toast);
  } else if (act === 'gpx' && 'start' in t) {
    downloadTrack(t);
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

/**
 * Aufzeichnung teilen: als Link (öffnet sich in WMap mit Diagrammen, der
 * Empfänger kann sie speichern) oder als GPX-Datei. Strecke, Zeiten und Tempo
 * gehen immer mit; Puls, Frequenz und Leistung nur, wenn angehakt.
 */
async function shareTrack(t) {
  const kinds = [['hr', 'Puls'], ['cad', cadName(t)], ['pow', 'Leistung']].filter(([k]) => t[k]?.some((v) => v > 0));
  const keep = Object.fromEntries(kinds.map(([k]) => [k, true]));
  // Geteilt wird immer ein Link, der die Daten trägt – nie eine Datei. Wer ihn öffnet, sieht die Tour und kann
  // sie bei sich speichern oder als GPX bzw. FIT herunterladen (downloadTrack)
  const how = await ask({
    icon: 'share', title: 'Aufzeichnung teilen', className: 'stacked',
    text: 'Geteilt wird die Tour, wie du sie aufgezeichnet hast: Strecke, Zeiten und Tempo.'
      + (kinds.length ? ' Wähle, was noch mit soll:' : ''),
    html: kinds.length ? `<div class="share-opts">${kinds.map(([k, l]) => `
      <label><input type="checkbox" name="${k}" checked> ${esc(l)}</label>`).join('')}</div>` : '',
    buttons: [
      { value: 'link', label: 'Als Link teilen', icon: 'link', primary: true },
      { value: 'no', label: 'Abbrechen' },
    ],
    setup: (dlg) => dlg.addEventListener('change', (e) => { if (e.target.name in keep) keep[e.target.name] = e.target.checked; }),
  });
  if (how !== 'link') return;
  const facts = [fmtDistance(t.length), fmtDuration(moving(t))].join(' · ');
  share({ title: t.name || 'Tour', text: `${t.name || 'Tour'} – ${facts}`, url: async () => `${pageUrl('wege.html')}#weg=${await encodeTrack(t, keep)}` }, toast);
}

/** Aufzeichnung herunterladen: als GPX (alles, was WMap zur Tour weiß) oder als FIT (für Garmin, Strava, Zepp & Co.) */
async function downloadTrack(t) {
  const how = await ask({
    icon: 'download', title: 'Herunterladen als', className: 'stacked',
    text: 'GPX enthält alles, was WMap zur Tour weiß – auch Art, Farbe und die Runden der Uhr. FIT ist das Format der Sportuhren: Punkte, Puls, Frequenz, Leistung, Runden und Sportart.',
    buttons: [
      { value: 'gpx', label: 'GPX-Datei', icon: 'draft', primary: true },
      { value: 'fit', label: 'FIT-Datei', icon: 'watch' },
      { value: 'no', label: 'Abbrechen' },
    ],
  });
  if (how !== 'gpx' && how !== 'fit') return;
  const name = `${(t.name || 'weg').replace(/[^\wäöüß]+/gi, '-')}.${how}`;
  try {
    if (how === 'gpx') await download(name, trackGpx(t));
    else await download(name, new Blob([(await import('../data/fit.js')).trackFit(t)], { type: 'application/vnd.ant.fit' }), 'application/vnd.ant.fit');
  } catch (err) { toast(err.message); }
}

/** Geteilte Aufzeichnung (wege.html#weg=…) zeigen – gespeichert wird erst auf Wunsch */
async function openSharedTrack(code) {
  let t;
  try { t = { ...await decodeTrack(code), id: 'geteilt', shared: true }; } catch (err) { toast(err.message || 'Der Link ließ sich nicht lesen'); showList(); return; }
  tab = 'wege';
  selected = t;
  heights = null;
  chartScale = 1;
  document.title = `${t.name} – WMap`;
  page.header(t.name, () => { history.replaceState(null, '', './wege.html'); showList(); fitView(); });
  paintTrack(t);
  paintCharts(t);
  paintLaps(t);
  if (folderPaint?.id === t.id) {
    const el = $('.weg-folder span:last-child', content);
    if (el) el.textContent += ` · anzeigen ${secs(performance.now() - folderPaint.before)}`;
    devLog('Tour gezeigt:', el?.textContent ?? '');
    folderPaint = null;
  }
  showElevation(trackCoords(t), t, (h) => { $('.st-up', content).textContent = h ? `${h.ascent} m` : '–'; paintCharts(t); paintLaps(t); });
}

/** Geteilte Aufzeichnung speichern – gibt es sie schon, dorthin */
async function keepShared(t) {
  const twin = all.find((x) => sameTrack(x, t));
  if (twin) { toast('Die Tour gibt es bei dir schon'); history.replaceState(null, '', `./wege.html?id=${encodeURIComponent(twin.id)}`); select(twin.id); return; }
  const { shared: _s, ...rest } = t;
  const saved = { ...rest, id: `w${t.start.toString(36)}${Math.random().toString(36).slice(2, 5)}`, updated: Date.now() };
  await tracks.put(saved);
  await load();
  toast('Gespeichert unter Aufgezeichnete Touren');
  history.replaceState(null, '', `./wege.html?id=${encodeURIComponent(saved.id)}`);
  select(saved.id);
}

/** Aus einem Weg eine Tour: fester Verlauf, ein paar Punkte zum Weiterplanen (data/tracks.js) */
const asTour = (t) => trackAsTour(t, heights, tours.newId());

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
      <a class="button primary" href="./index.html?tour=${encodeURIComponent(t.id)}&start"><span class="msr">navigation</span> Tour starten</a>
      ${carLink.connected && PROFILES[t.profile]?.costing === 'auto' ? '<button type="button" class="button" data-do="car" title="An WMap in Android Auto senden – dort die Übersicht mit „Los“"><span class="msr">directions_car</span> Ans Auto</button>' : ''}
      <a class="button" href="./tour.html?id=${encodeURIComponent(t.id)}"><span class="msr">edit_road</span> Im Planer öffnen</a>
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
    ? { type: 'FeatureCollection', features: visiblePlanned().map((t) => ({
      type: 'Feature', properties: { id: t.id, color: groupOf(t).color }, geometry: { type: 'LineString', coordinates: coordsOf(t.shape) },
    })) }
    // Aufgezeichnet: in der Farbe der Art bzw. der eigenen, je älter, desto blasser – nur was eingeblendet ist
    : { type: 'FeatureCollection', features: [...onMap()].sort((a, b) => a.start - b.start).map((t) => ({
      type: 'Feature', properties: { id: t.id, color: colorOf(t), opacity: ageOpacity(t) }, geometry: { type: 'LineString', coordinates: trackCoords(t) },
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
    map.on('click', 'wege-dot', (e) => {
      const id = e.features[0].properties.id;
      if (tab === 'bahn') selectConn(id, { push: true }); else if (tab === 'geplant') selectTour(id, { push: true }); else select(id, { push: true });
    });
    for (const id of ['wege-cluster', 'wege-dot']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
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
  for (const id of ['wege-cluster', 'wege-cluster-n', 'wege-dot']) map.setLayoutProperty(id, 'visibility', selected ? 'none' : 'visible');
  map.getSource('weg-km').setData(kmMarks(selected));

  // Gewähltes obenauf (Wege nach Tempo gefärbt); der Rest tritt zurück
  // (Wege tragen ihre Deckkraft nach Alter mit, alles andere gilt als 1)
  const age = ['coalesce', ['get', 'opacity'], 1];
  map.setPaintProperty('wege-line', 'line-opacity', ['*', age, selected ? 0.25 : 0.9]);
  map.setPaintProperty('wege-casing', 'line-opacity', ['*', age, selected ? 0.3 : 0.8]);
  map.setPaintProperty('wege-dot', 'circle-opacity', age);
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
    if (!grad) map.setPaintProperty('weg-sel', 'line-color', isTrack ? colorOf(selected) : groupOf(selected).color);
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
  folderOn = !!(await folder.info().catch(() => null))?.connected;
}

async function openSharedList(code) {
  try {
    const o = await unpackJson(code);
    sharedList = { name: String(o.n || 'Geteilte Liste').slice(0, 40), items: (o.p ?? []).filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]))
      .map(([lon, lat, name, label]) => ({ point: [lon, lat], name: String(name || 'Ort').slice(0, 80), label: String(label || '').slice(0, 120) })) };
  } catch { toast('Die geteilte Liste ließ sich nicht lesen'); }
}

function route() {
  const p = new URLSearchParams(location.search);
  tab = tabOf(p);
  const sharedTrack = location.hash.match(/^#weg=(.+)$/)?.[1];
  if (sharedTrack) openSharedTrack(sharedTrack);
  else if (p.get('id')) select(p.get('id'));
  else if (p.get('conn')) selectConn(p.get('conn'));
  else if (p.get('tour')) selectTour(p.get('tour'));
  else showList();
}
addEventListener('popstate', () => { route(); fitView(); });
// Geteilte Aufzeichnung geöffnet, während die Seite schon offen ist
addEventListener('hashchange', () => { if (/^#weg=/.test(location.hash)) { route(); fitView(); } });

/* Aus dem Ordner kam etwas dazu oder ging weg */
addEventListener('wmap:folder', async () => {
  await load();
  const list = tab === 'bahn' ? conns : tab === 'geplant' ? planned : all;
  if (selected) { if (!list.some((t) => t.id === selected.id)) showList(); } else showList();
});

await load();
if (params.get('liste')) await openSharedList(params.get('liste'));
route();
fitView();
autoSync();
// Lesezeichen geändert (auch aus dem Ordner): Orte neu
addEventListener('wmap:saved', () => { if (tab === 'orte' && !selected) paintGroups(); });
