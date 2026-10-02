/**
 * Suche oben: Vorschläge, Zuletzt genutzt, Lesezeichen (Zuhause, Arbeit, eigene
 * Namen) – die stehen immer ganz oben, beim Tippen die passenden.
 */
import { PROFILES } from '../core/config.js';
import * as geocode from '../services/geocode.js';
import { byId, matchCategory } from '../core/categories.js';
import { recent } from '../data/store.js';
import { isStop } from '../services/transit.js';
import { places, PLACE_KINDS, DEFAULT_LIST } from '../data/saved.js';
import { ask, toast } from '../ui/dialogs.js';
import { distance, esc, fmtDistance } from '../core/geo.js';
import { fmtAbout, roadDistances, ROAD_FIRST } from '../services/routing.js';
import { runCategory } from './category.js';
import { $, $$, debounce, map, q, state } from './core.js';
import { isPoi } from './drive-target.js';
import { paintPlaceActions, placeWaypoint, showPlace } from './place.js';
import { openReach } from './reach.js';
import { enterRoute, setProfile } from './route-plan.js';
import { closeAll } from './views.js';

/* ══════════════════════════════════════════════════════════════════════════
   Vorschläge unter den Eingabefeldern
   ══════════════════════════════════════════════════════════════════════════ */

export const suggest = {
  el: $('#suggest'),
  items: [],
  active: -1,

  show(items) {
    this.items = items;
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
  hide() { this.el.hidden = true; this.el.replaceChildren(); this.items = []; this.active = -1; },
  move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    $$('li[data-i]', this.el).forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === this.active));
    $(`li[data-i="${this.active}"]`, this.el)?.scrollIntoView({ block: 'nearest' });
  },
  pick(i = this.active) {
    const it = this.items[i < 0 ? 0 : i];
    this.hide();
    // Noch laufende Suchen verwerfen und den Fokus lösen – sonst taucht die
    // Liste mit einer verspäteten Antwort über dem Ergebnis wieder auf
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

export async function placeSuggestions(text, onPick, { withCategory = true, extra = [] } = {}) {
  const seq = ++searchSeq;
  const query = text.trim();
  if (query.length < 2) return extra;
  searchCtl?.abort();
  searchCtl = new AbortController();
  let results = [];
  try {
    results = await geocode.search(query, { center: searchCenter(), zoom: map.getZoom(), signal: searchCtl.signal });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    toast(err.message);
  }
  if (seq !== searchSeq) return null;

  const places = results.map((f) => {
    const d = geocode.describe(f);
    return { icon: d.icon, title: d.title, subtitle: d.subtitle, type: d.type, point: f.geometry.coordinates, run: () => onPick(f) };
  });
  const cat = withCategory ? matchCategory(query, { loose: true }) : null;
  if (!cat) return [...extra, ...places];
  const catItem = {
    icon: cat.category.icon, color: cat.category.color, title: cat.category.label,
    subtitle: cat.place ? `in ${cat.place}` : 'hier in der Gegend', type: 'Kategorie',
    run: () => runCategory(cat.category, cat.place, { rememberAs: query }),
  };
  // „Parkplatz“ oder „Parkplätze in Göttingen“ → Kategorie zuerst;
  // „Park Sanssouci“ → erst der eine Park, die Kategorie danach
  return cat.strong ? [...extra, catItem, ...places] : [...extra, ...places.slice(0, 2), catItem, ...places.slice(2)];
}

/* ── Zuletzt genutzt ──────────────────────────────────────────────────────── */

const RECENT_SECTION = 'Zuletzt genutzt';
const SAVED_SECTION = 'Lesezeichen';

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
  toast(`In „${DEFAULT_LIST}“ gemerkt`, { action: { label: 'Ändern', run: () => editBookmark(point, title) } });
}

/** Lesezeichen bearbeiten: Name, Liste (auch neu), Zuhause/Arbeit, entfernen */
export async function editBookmark(point, title) {
  const mine = places.find(point);
  if (!mine) return;
  const lists = places.lists();
  const fixedKind = mine.kind === 'home' || mine.kind === 'work';
  const v = await ask({
    icon: 'bookmark', title: 'Lesezeichen', className: 'stacked bookmark-edit',
    html: `<label class="bm-field"><span>Name</span><input type="text" name="bm-name" value="${esc(mine.name)}" maxlength="60" placeholder="z. B. Oma, Verein, Lieblingsbäcker"></label>
      ${fixedKind ? '' : `<label class="bm-field"><span>Liste</span><select name="bm-list">
        ${lists.map((l) => `<option ${l === (mine.list || DEFAULT_LIST) ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        <option value="__new">Neue Liste …</option></select></label>
      <label class="bm-field bm-new" hidden><span>Neue Liste</span><input type="text" name="bm-new" maxlength="40" placeholder="z. B. Hannover Urlaub"></label>`}
      <p class="muted">${esc(title)}</p>`,
    buttons: [
      { value: 'save', label: 'Speichern', icon: 'check', primary: true },
      ...(mine.kind !== 'home' ? [{ value: 'home', label: 'Als Zuhause', icon: 'home' }] : []),
      ...(mine.kind !== 'work' ? [{ value: 'work', label: 'Als Arbeit', icon: 'work' }] : []),
      { value: 'remove', label: 'Entfernen', icon: 'bookmark_remove' },
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
    toast('Lesezeichen entfernt');
  } else if (v === 'home' || v === 'work') {
    places.remove(mine.id);
    places.save({ kind: v, name: PLACE_KINDS[v].label, label: title, point });
    toast(`Als „${PLACE_KINDS[v].label}“ gemerkt`);
  } else if (typeof v === 'object') {
    // Der eigene Name steht oben, der eigentliche Ort darunter
    places.update(mine.id, { name: v.name || mine.name, label: mine.label || (v.name && v.name !== title ? title : ''), ...(fixedKind ? {} : { list: v.list }) });
    toast(fixedKind ? `Gemerkt als „${v.name || mine.name}“` : `In „${v.list}“ gemerkt`);
  }
  paintPlaceActions();
}

/** Passende Lesezeichen vor die Suchergebnisse – die bekommen dann eine eigene Überschrift */
export function withSaved(saved, found) {
  if (!found) return saved.length ? saved : found;
  return saved.length ? [...saved, ...found.map((x) => ({ ...x, section: x.section ?? 'Suchergebnisse' }))] : found;
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
        section: RECENT_SECTION, icon: cat.icon, color: cat.color, title: cat.label, subtitle: e.subtitle, type: 'Kategorie',
        run: () => runCategory(cat, e.place, { rememberAs: e.place ? `${cat.label} in ${e.place}` : cat.label }),
      };
    }
    return {
      section: RECENT_SECTION, icon: PROFILES[e.profile]?.icon ?? 'directions', title: e.title, subtitle: 'Route', type: 'Route',
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
    section: 'Entdecken', icon: 'radar', color: '#2f9e44', title: 'Was ist von hier erreichbar?',
    subtitle: 'in Minuten oder Kilometern ab deinem Standort', run: () => openReach(),
  }];
}

const updateSearchSuggestions = debounce(async () => {
  const text = q.value.trim();
  const items = text.length < 2
    ? [...savedItems((f) => showPlace(f)), ...discoverItems(), ...recentItems((f) => showPlace(f))]
    : withSaved(savedItems((f) => showPlace(f), text), await placeSuggestions(q.value, (f) => showPlace(f)));
  if (items && document.activeElement === q) suggest.show(items);
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
  if (!q.value.trim()) return;
  const items = await placeSuggestions(q.value, (f) => showPlace(f));
  suggest.hide();
  q.blur();
  if (items?.length) items[0].run(); else toast('Nichts gefunden');
});

$('#q-clear').addEventListener('click', () => {
  closeAll();
  q.focus();
});

$('#to-route').addEventListener('click', () => {
  enterRoute({ to: state.place ? placeWaypoint(state.place) : null });
});
