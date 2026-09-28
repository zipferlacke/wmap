/**
 * Suche oben: Vorschläge, Zuletzt genutzt, Gemerkt (Lesezeichen, Zuhause/Arbeit).
 */
import { PROFILES } from '../core/config.js';
import * as geocode from '../services/geocode.js';
import { byId, matchCategory } from '../core/categories.js';
import { recent } from '../data/store.js';
import { isStop } from '../services/transit.js';
import { places, PLACE_KINDS } from '../data/saved.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { runCategory } from './category.js';
import { $, $$, debounce, map, q, state } from './core.js';
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
          ${it.type ? `<span class="sg-type">${esc(it.type)}</span>` : ''}
        </button>
      </li>`;
    }).join('');
    this.el.hidden = !items.length;
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
export async function placeSuggestions(text, onPick, { withCategory = true, extra = [] } = {}) {
  const seq = ++searchSeq;
  const query = text.trim();
  if (query.length < 2) return extra;
  searchCtl?.abort();
  searchCtl = new AbortController();
  let results = [];
  try {
    results = await geocode.search(query, { center: map.getCenter().toArray(), zoom: map.getZoom(), signal: searchCtl.signal });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    toast(err.message);
  }
  if (seq !== searchSeq) return null;

  const places = results.map((f) => {
    const d = geocode.describe(f);
    return { icon: d.icon, title: d.title, subtitle: d.subtitle, type: d.type, run: () => onPick(f) };
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
const SAVED_SECTION = 'Gemerkt';

/**
 * Zuhause, Arbeit und Lesezeichen als Vorschläge – ganz oben. Bei Bus & Bahn
 * kommen die gemerkten Haltestellen vor die übrigen Lesezeichen.
 */
function savedItems(onPlace) {
  const order = PROFILES[state.profile]?.transit && state.mode === 'route' ? ['home', 'work', 'stop', 'fav'] : ['home', 'work', 'fav', 'stop'];
  return places.all().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 8).map((p) => ({
    section: SAVED_SECTION, icon: PLACE_KINDS[p.kind]?.icon ?? 'star', title: p.name,
    subtitle: [p.kind === 'home' || p.kind === 'work' ? '' : PLACE_KINDS[p.kind]?.label, p.label].filter(Boolean).join(' · '),
    run: () => onPlace({ type: 'Feature', geometry: { type: 'Point', coordinates: p.point }, properties: { name: p.name } }),
  }));
}

/**
 * Merken: ein Tipp legt ein Lesezeichen an, noch einer nimmt es weg – für
 * Orte und Haltestellen gleich. Haltestellen stehen bei Bus & Bahn zuerst.
 * Die Meldung bietet an, das Lesezeichen als Zuhause oder Arbeit zu nehmen.
 */
export function togglePlace(f, point, title, subtitle) {
  const had = places.find(point);
  if (had) { places.remove(had.id); toast('Lesezeichen entfernt'); paintPlaceActions(); return; }
  const tags = f.properties._tags;
  places.save({ kind: tags && isStop(tags) ? 'stop' : 'fav', name: title, label: subtitle, point, ifopt: tags?.['ref:IFOPT'] ?? '' });
  paintPlaceActions();
  toast('Als Lesezeichen gemerkt – steht in Suche und Routenplanung ganz oben', {
    action: {
      label: 'Zuhause / Arbeit',
      run: async () => {
        const v = await ask({
          icon: 'bookmark', title: 'Lesezeichen als …', text: title,
          buttons: [{ value: 'home', label: 'Zuhause', icon: 'home' }, { value: 'work', label: 'Arbeit', icon: 'work', primary: true }],
        });
        if (!v) return;
        const mine = places.find(point);
        if (mine) places.remove(mine.id);
        places.save({ kind: v, name: PLACE_KINDS[v].label, label: title, point });
        toast(`Als „${PLACE_KINDS[v].label}“ gemerkt`);
        paintPlaceActions();
      },
    },
  });
}

/** Einträge aus dem Verlauf als Vorschläge. `onPlace` bekommt das Photon-Feature. */
function recentItems(onPlace, kinds = ['place', 'category', 'route']) {
  return recent.list(kinds).slice(0, 7).map((e) => {
    if (e.kind === 'place') {
      return { section: RECENT_SECTION, icon: e.icon ?? 'history', title: e.title, subtitle: e.subtitle, run: () => onPlace(e.feature) };
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
    : await placeSuggestions(q.value, (f) => showPlace(f));
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
