/**
 * Suche oben: Vorschläge, Zuletzt genutzt, Lesezeichen (Zuhause, Arbeit, eigene
 * Namen) – die stehen immer ganz oben, beim Tippen die passenden. Koordinaten
 * (auch MGRS, UTM, Plus Code) und Links aus anderen Karten oder von WMap gehen
 * ohne Suchdienst (search-direct.js).
 */
import { PROFILES } from '../core/config.js';
import * as geocode from '../services/geocode.js';
import { byId, matchCategory, nameCategory } from '../core/categories.js';
import { recent } from '../data/store.js';
import { isStop } from '../services/transit.js';
import { places, PLACE_KINDS, DEFAULT_LIST } from '../data/saved.js';
import { ask, toast } from '../ui/dialogs.js';
import { distance, esc, fmtDistance } from '../core/geo.js';
import { fmtAbout, roadDistances, ROAD_FIRST } from '../services/routing.js';
import { runCategory } from './category.js';
import { lineItem } from './lines.js';
import { directItems } from './search-direct.js';
import { $, $$, debounce, map, q, state } from './core.js';
import { isPoi } from './drive-target.js';
import { paintPlaceActions, placeWaypoint, showPlace } from './place.js';
import { openReach } from './reach.js';
import { enterRoute, setProfile } from './route-plan.js';
import { closeAll } from './views.js';
import { t } from '../core/i18n.js';

/* ══════════════════════════════════════════════════════════════════════════
   Vorschläge unter den Eingabefeldern
   ══════════════════════════════════════════════════════════════════════════ */

export const suggest = {
  el: $('#suggest'),
  items: [],
  active: -1,

  forText: '',                       // für welchen Suchtext die gezeigten Vorschläge gelten
  show(items, text = '') {
    this.items = items;
    this.forText = text;
    this.active = -1;
    let section = null;
    this.el.innerHTML = items.map((it, i) => {
      const head = it.section && it.section !== section ? `<li class="sg-section" role="presentation">${esc(it.section)}</li>` : '';
      section = it.section ?? section;
      return `${head}
      <li role="option" id="sg-${i}" data-i="${i}">
        <button type="button" data-i="${i}">
          <span class="msr" style="${it.color ? `color:${esc(it.color)}` : ''}">${esc(it.icon)}</span>
          <span class="sg-text"><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</span>
          ${it.type || it.point ? `<span class="sg-type">${it.point ? '<b class="sg-dist"></b>' : ''}${it.type ? `<span>${esc(it.type)}</span>` : ''}</span>` : ''}
        </button>
      </li>`;
    }).join('');
    this.el.hidden = !items.length;
    this.fillRoad(items);
  },
  /*
   * Entfernung vom eigenen Standort: bei den ersten drei Treffern die Strecke auf der Straße – dieselbe Zahl
   * wie danach in der Route –, bei den übrigen „≈“ und die Luftlinie (nicht jeder Treffer soll den Server
   * fragen, services/routing.js roadDistances). Die genauen kommen kurz nach der Liste und erst, wenn man
   * nicht weitertippt; gerechnet mit dem Profil, mit dem zuletzt geplant wurde (sonst Auto).
   */
  roadTimer: null,
  fillRoad(items) {
    clearTimeout(this.roadTimer);
    const from = state.position;
    const at = items.map((it, i) => (it.point ? i : -1)).filter((i) => i >= 0);
    if (!from || !at.length) return;
    const el = (i) => this.el.querySelector(`li[data-i="${i}"] .sg-dist`);
    at.forEach((i) => { const e = el(i); if (e) e.textContent = fmtAbout(distance(from, items[i].point)); });
    const first = at.slice(0, ROAD_FIRST);
    this.roadTimer = setTimeout(async () => {
      const profile = PROFILES[state.profile]?.costing ? state.profile : 'car';
      const road = await roadDistances(from, first.map((i) => items[i].point), profile).catch(() => null);
      if (!road || this.items !== items) return;
      first.forEach((i, k) => { const e = el(i); if (e && road[k]) e.textContent = fmtDistance(road[k].length); });
    }, 350);
  },
  hide() { this.el.hidden = true; this.el.replaceChildren(); this.items = []; this.active = -1; this.forText = ''; },
  move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    $$('li[data-i]', this.el).forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === this.active));
    $(`li[data-i="${this.active}"]`, this.el)?.scrollIntoView({ block: 'nearest' });
  },
  pick(i = this.active) {
    const it = this.items[i < 0 ? 0 : i];
    this.hide();
    // Noch laufende Suchen verwerfen und den Fokus lösen: eine verspätete Antwort
    // soll die Liste nicht über dem Ergebnis wieder öffnen
    searchSeq += 1;
    document.activeElement?.blur?.();
    it?.run();
  },
};
// pointerdown statt click: sonst verliert das Feld vorher den Fokus und die Liste ist weg
suggest.el.addEventListener('pointerdown', (e) => e.preventDefault());
suggest.el.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) suggest.pick(Number(b.dataset.i));
});

export function keyNav(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); suggest.move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); suggest.move(-1); }
  else if (e.key === 'Escape') suggest.hide();
  else return false;
  return true;
}

let searchSeq = 0;
let searchCtl = null;

/** Noch laufende Suchen verwerfen – ihre Vorschläge kommen nicht mehr */
export function cancelSuggestions() { searchSeq += 1; }

/** Photon-Treffer (und in der Suche: eine passende Kategorie) als Vorschläge. */
/**
 * Wo die Suche Nahes zuerst zeigt: am eigenen Standort, solange er im Kartenausschnitt liegt –
 * dazu passt die Entfernung an den Treffern. Zeigt die Karte eine andere Gegend, gilt deren Mitte.
 */
function searchCenter() {
  const p = state.position;
  return p && map.getBounds().contains(p) ? p : map.getCenter().toArray();
}

/* Ebenen der Grundkarte mit Namen – was man auch im Suchfeld meinen könnte */
const NAMED = ['place', 'poi', 'transportation_name', 'water_name', 'aerodrome_label'];

/**
 * Suchdienst nicht erreichbar: was die Karte schon geladen hat, nach Namen → Treffer wie von Photon, das Nächste zuerst.
 * Läuft nur dann – beim normalen Suchen kostet es nichts. Mehr als der geladene Ausschnitt ist es nicht.
 */
export function mapPlaces(text, { limit = 6 } = {}) {
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const source = map.getStyle()?.layers?.find((l) => l['source-layer'] === 'place')?.source;
  if (!source) return [];
  const center = searchCenter();
  const found = new Map();
  for (const sourceLayer of NAMED) {
    for (const f of map.querySourceFeatures(source, { sourceLayer })) {
      const name = f.properties['name:de'] ?? f.properties.name;
      if (!name || found.has(name) || !words.every((w) => fold(name).includes(w))) continue;
      const c = f.geometry.coordinates;
      const point = f.geometry.type === 'Point' ? c : f.geometry.type === 'LineString' ? c[c.length >> 1] : f.geometry.type === 'MultiLineString' ? c[0][0] : null;
      if (point) found.set(name, { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { name, _point: true } });
    }
  }
  return [...found.values()].sort((a, b) => distance(center, a.geometry.coordinates) - distance(center, b.geometry.coordinates)).slice(0, limit);
}

export async function placeSuggestions(text, onPick, { withCategory = true, extra = [] } = {}) {
  const seq = ++searchSeq;
  let query = text.trim();
  if (query.length < 2) return extra;
  searchCtl?.abort();
  searchCtl = new AbortController();
  // Koordinaten und Karten-Links brauchen keinen Suchdienst (app/search-direct.js)
  const direct = await directItems(query, onPick, { main: withCategory, signal: searchCtl.signal }).catch(() => null);
  if (seq !== searchSeq) return null;
  if (Array.isArray(direct)) return [...extra, ...direct];
  if (direct?.query) query = direct.query;
  // „Bus 11“: die Linie zuerst – die Suche nach Orten läuft trotzdem („Linie 3“ kann auch eine Straße sein)
  const line = withCategory && lineItem(query, searchCenter);
  if (line) extra = [...extra, line];
  let results = [];
  try {
    results = await geocode.search(query, { center: searchCenter(), zoom: map.getZoom(), signal: searchCtl.signal });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    if (seq !== searchSeq) return null;
    if (!err.unreachable) { toast(err.message); return extra; }
    // Statt einer Meldung bei jedem Tastendruck: Treffer aus der Karte, darunter ein Hinweis
    const local = mapPlaces(query);
    return [...extra, ...local.map((f) => ({ icon: 'map', title: f.properties.name, subtitle: t('search.local.subtitle'), type: t('search.local.type'), point: f.geometry.coordinates, run: () => onPick(f) })),
      { icon: 'cloud_off', title: t('search.local.unreachable'), subtitle: local.length ? t('search.local.only_names') : err.message, type: '', run: () => {} }];
  }
  if (seq !== searchSeq) return null;

  const places = results.map((f) => {
    const d = geocode.describe(f);
    return { icon: d.icon, title: d.title, subtitle: d.subtitle, type: d.type, point: f.geometry.coordinates, run: () => onPick(f) };
  });
  if (!withCategory) return [...extra, ...places];
  const cat = matchCategory(query, { loose: true });
  const catItem = cat && {
    icon: cat.category.icon, color: cat.category.color, title: cat.category.label,
    subtitle: cat.place ? t('map.in_place', { place: cat.place }) : t('map.around_here'), type: t('search.types.category'),
    run: () => runCategory(cat.category, cat.place, { rememberAs: query }),
  };
  // Mit Hausnummer oder Postleitzahl ist eine Adresse gemeint: die Treffer zuerst
  if (/\d/.test(query)) return catItem && cat.strong ? [...extra, catItem, ...places] : [...extra, ...places, ...(catItem ? [catItem] : [])];
  // Sonst oben „in der Nähe“: die Kategorie („Parkplatz“) bzw. alle mit dem Namen („Rewe“, „Aldi“), darunter die
  // einzelnen Treffer zum direkten Wählen
  const byName = !cat?.strong && query.length >= 3 && {
    icon: 'storefront', color: '#e8590c', title: t('search.by_name.title', { query }), subtitle: t('search.by_name.subtitle'), type: t('search.types.search'),
    run: () => runCategory(nameCategory(query), null, { rememberAs: query }),
  };
  return [...extra, ...(catItem ? [catItem] : []), ...(byName ? [byName] : []), ...places];
}

/* ── Zuletzt genutzt ──────────────────────────────────────────────────────── */

const RECENT_SECTION = t('search.sections.recent');
const SAVED_SECTION = t('search.sections.saved');

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

/**
 * Gemerktes als Vorschläge – ganz oben. Ohne Eingabe nur Zuhause und Arbeit;
 * mit Eingabe dazu die Lesezeichen, deren Name (oder Ort, Liste) passt. Bei
 * Bus & Bahn kommen gemerkte Haltestellen vor die übrigen.
 */
export function savedItems(onPlace, text = '') {
  const order = PROFILES[state.profile]?.transit && state.mode === 'route' ? ['home', 'work', 'stop', 'fav'] : ['home', 'work', 'fav', 'stop'];
  const words = fold(text).split(/\s+/).filter(Boolean);
  const hit = (p) => words.every((w) => fold(`${p.name} ${p.label} ${p.list ?? ''} ${PLACE_KINDS[p.kind]?.label ?? ''}`).includes(w));
  const fixedKind = (p) => p.kind === 'home' || p.kind === 'work';
  return places.all().filter((p) => (words.length ? hit(p) : fixedKind(p)))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 6).map((p) => ({
    section: SAVED_SECTION, icon: PLACE_KINDS[p.kind]?.icon ?? 'star', title: p.name, point: p.point,
    subtitle: [fixedKind(p) ? '' : p.list && p.list !== DEFAULT_LIST ? p.list : PLACE_KINDS[p.kind]?.label, p.label].filter(Boolean).join(' · '),
    run: () => onPlace({ type: 'Feature', geometry: { type: 'Point', coordinates: p.point }, properties: { name: p.name, _poi: !!p.poi } }),
  }));
}

/**
 * Merken: ein Tipp legt ein Lesezeichen in „Allgemein“ an – die Meldung
 * bietet „Ändern“ (Name, Liste, Zuhause/Arbeit). Schon gemerkt: derselbe
 * Dialog, dazu „Entfernen“.
 */
export function togglePlace(f, point, title, subtitle) {
  const had = places.find(point);
  if (had) { editBookmark(point, title); return; }
  const tags = f.properties._tags;
  places.save({ kind: tags && isStop(tags) ? 'stop' : 'fav', name: title, label: subtitle, point, ifopt: tags?.['ref:IFOPT'] ?? '', poi: isPoi(f) });
  paintPlaceActions();
  toast(t('search.bookmark.toast.saved_in', { list: t('places.default_list') }), { action: { label: t('search.bookmark.toast.change'), run: () => editBookmark(point, title) } });
}

/** Lesezeichen bearbeiten: Name, Liste (auch neu), Zuhause/Arbeit, entfernen */
export async function editBookmark(point, title) {
  const mine = places.find(point);
  if (!mine) return;
  const lists = places.lists();
  const fixedKind = mine.kind === 'home' || mine.kind === 'work';
  const v = await ask({
    icon: 'bookmark', title: t('search.bookmark.title'), className: 'stacked bookmark-edit',
    html: `<label class="bm-field"><span>${t('search.bookmark.name.title')}</span><input type="text" name="bm-name" value="${esc(mine.name)}" maxlength="60" placeholder="${t('search.bookmark.name.placeholder')}"></label>
      ${fixedKind ? '' : `<label class="bm-field"><span>${t('search.bookmark.list.title')}</span><select name="bm-list">
        ${lists.map((l) => `<option value="${esc(l)}" ${l === (mine.list || DEFAULT_LIST) ? 'selected' : ''}>${esc(l === DEFAULT_LIST ? t('places.default_list') : l)}</option>`).join('')}
        <option value="__new">${t('search.bookmark.list.new_option')}</option></select></label>
      <label class="bm-field bm-new" hidden><span>${t('search.bookmark.list.new.title')}</span><input type="text" name="bm-new" maxlength="40" placeholder="${t('search.bookmark.list.new.placeholder')}"></label>`}
      <p class="muted">${esc(title)}</p>`,
    buttons: [
      { value: 'save', label: t('common.save'), icon: 'check', primary: true },
      ...(mine.kind !== 'home' ? [{ value: 'home', label: t('search.bookmark.as_home'), icon: 'home' }] : []),
      ...(mine.kind !== 'work' ? [{ value: 'work', label: t('search.bookmark.as_work'), icon: 'work' }] : []),
      { value: 'remove', label: t('search.bookmark.remove'), icon: 'bookmark_remove' },
    ],
    read: (dlg) => {
      const sel = dlg.querySelector('[name="bm-list"]');
      const list = sel?.value === '__new' ? dlg.querySelector('[name="bm-new"]').value.trim() : sel?.value;
      return { name: dlg.querySelector('[name="bm-name"]').value.trim(), list: list || DEFAULT_LIST };
    },
    setup(dlg) {
      const sel = dlg.querySelector('[name="bm-list"]');
      sel?.addEventListener('change', () => {
        dlg.querySelector('.bm-new').hidden = sel.value !== '__new';
        if (sel.value === '__new') dlg.querySelector('[name="bm-new"]').focus();
      });
    },
  });
  if (!v) return;
  if (v === 'remove') {
    places.remove(mine.id);
    toast(t('search.bookmark.toast.removed'));
  } else if (v === 'home' || v === 'work') {
    places.remove(mine.id);
    places.save({ kind: v, name: PLACE_KINDS[v].label, label: title, point });
    toast(t('search.bookmark.toast.saved_as', { name: PLACE_KINDS[v].label }));
  } else if (typeof v === 'object') {
    // Der eigene Name steht oben, der eigentliche Ort darunter
    places.update(mine.id, { name: v.name || mine.name, label: mine.label || (v.name && v.name !== title ? title : ''), ...(fixedKind ? {} : { list: v.list }) });
    toast(fixedKind ? t('search.bookmark.toast.saved_name', { name: v.name || mine.name }) : t('search.bookmark.toast.saved_in', { list: v.list }));
  }
  paintPlaceActions();
}

/** Passende Lesezeichen vor die Suchergebnisse – die bekommen dann eine eigene Überschrift */
export function withSaved(saved, found) {
  if (!found) return saved.length ? saved : found;
  return saved.length ? [...saved, ...found.map((x) => ({ ...x, section: x.section ?? t('search.sections.results') }))] : found;
}


/** Einträge aus dem Verlauf als Vorschläge. `onPlace` bekommt das Photon-Feature. */
export function recentItems(onPlace, kinds = ['place', 'category', 'route']) {
  return recent.list(kinds).slice(0, 7).map((e) => {
    if (e.kind === 'place') {
      return { section: RECENT_SECTION, icon: e.icon ?? 'history', title: e.title, subtitle: e.subtitle, point: e.point ?? e.feature?.geometry?.coordinates, run: () => onPlace(e.feature) };
    }
    if (e.kind === 'category') {
      const cat = byId(e.category);
      return cat && {
        section: RECENT_SECTION, icon: cat.icon, color: cat.color, title: cat.label, subtitle: e.subtitle, type: t('search.types.category'),
        run: () => runCategory(cat, e.place, { rememberAs: e.place ? `${cat.label} in ${e.place}` : cat.label }),
      };
    }
    return {
      section: RECENT_SECTION, icon: PROFILES[e.profile]?.icon ?? 'directions', title: e.title, subtitle: t('search.types.route'), type: t('search.types.route'),
      run: () => {
        if (PROFILES[e.profile]?.nav) setProfile(e.profile);
        enterRoute({ waypoints: e.waypoints.map((w) => ({ ...w })) });
      },
    };
  }).filter(Boolean);
}

/** Ort in den Verlauf – nur das Nötige des Photon-Features. */
export function rememberPlace(f) {
  const d = geocode.describe(f);
  recent.add({
    kind: 'place', title: d.title, subtitle: d.subtitle || d.type, icon: d.icon, point: f.geometry.coordinates,
    feature: { type: 'Feature', geometry: f.geometry, properties: { ...f.properties, _tags: undefined } },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Suche
   ══════════════════════════════════════════════════════════════════════════ */


function discoverItems() {
  return [{
    section: t('search.sections.discover'), icon: 'radar', color: '#2f9e44', title: t('search.discover.reach.title'),
    subtitle: t('search.discover.reach.subtitle'), run: () => openReach(),
  }];
}

const updateSearchSuggestions = debounce(async () => {
  const text = q.value.trim();
  const items = text.length < 2
    ? [...savedItems((f) => showPlace(f)), ...discoverItems(), ...recentItems((f) => showPlace(f))]
    : withSaved(savedItems((f) => showPlace(f), text), await placeSuggestions(q.value, (f) => showPlace(f)));
  if (items && document.activeElement === q) suggest.show(items, text);
}, 160);

q.addEventListener('input', () => {
  $('#q-clear').hidden = !q.value;
  updateSearchSuggestions();
});
q.addEventListener('focus', () => updateSearchSuggestions());
q.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== q) suggest.hide(); }, 150));
q.addEventListener('keydown', keyNav);

/* Enter: mit den Pfeiltasten Gewähltes nehmen, sonst frisch nach genau dem Text suchen */
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (suggest.active >= 0) { suggest.pick(); return; }
  const text = q.value.trim();
  if (!text) return;
  // Die Vorschläge zu genau diesem Text stehen schon da: den obersten nehmen
  if (suggest.items.length && suggest.forText === text) { suggest.pick(0); return; }
  // Sonst frisch suchen und die verzögerte Vorschlagssuche verwerfen: sie würde diese
  // Suche sonst ungültig machen („Nichts gefunden“ trotz Treffern)
  updateSearchSuggestions.cancel();
  const items = await placeSuggestions(q.value, (f) => showPlace(f));
  suggest.hide();
  q.blur();
  if (items?.length) items[0].run(); else toast(t('search.toast.nothing_found'));
});

$('#q-clear').addEventListener('click', () => {
  closeAll();
  q.focus();
});

$('#to-route').addEventListener('click', () => {
  enterRoute({ to: state.place ? placeWaypoint(state.place) : null });
});
