/**
 * Routenplanung: Wegpunkte, Profil, Bus & Bahn „Abfahrt ab / Ankunft bis“.
 */
import { PROFILES } from '../core/config.js';
import { ROUTE_COLOR } from '../map/map.js';
import * as geocode from '../services/geocode.js';
import { local } from '../data/store.js';
import { mountRoutePrefs } from '../ui/route-prefs.js';
import { toast } from '../ui/dialogs.js';
import { nearestOnLine, esc } from '../core/geo.js';
import { clearCategory } from './category.js';
import { $, $$, afterLayout, current, debounce, map, markerEl, state } from './core.js';
import { placeWaypoint, removePlaceMarker } from './place.js';
import { clearReach } from './reach.js';
import { clearRoutes, computeRoutes, fitRoute, routeCtl } from './route-results.js';
import { cancelSuggestions, keyNav, placeSuggestions, recentItems, savedItems, suggest, withSaved } from './search.js';
import { back, closeAll, closeSheet, openSheet, remember, stack } from './views.js';

/* ══════════════════════════════════════════════════════════════════════════
   Routenplanung
   ══════════════════════════════════════════════════════════════════════════ */

const me = () => ({ label: 'Mein Standort', point: null, me: true });
const empty = () => ({ label: '', point: null, me: false });
export const isSet = (w) => w.me || !!w.point;

export function enterRoute({ to = null, from = null, waypoints = null, push = true } = {}) {
  const wasRoute = state.mode === 'route';
  state.mode = 'route';
  $('#search-form').hidden = true;
  $('#route-form').hidden = false;
  suggest.hide();
  removePlaceMarker();
  clearCategory();
  clearReach();
  if (waypoints) state.waypoints = waypoints;
  if (!state.waypoints.length) state.waypoints = [me(), empty()];
  if (from) state.waypoints[0] = from;
  if (to) state.waypoints[state.waypoints.length - 1] = to;
  for (const wp of [from, to]) if (wp?.label === 'Punkt auf der Karte') nameLater(wp);
  if (push && !wasRoute) {
    remember('route', () => {
      if (state.mode !== 'route') enterRoute({ waypoints: state.waypoints.map((w) => ({ ...w })), push: false });
      else if (state.routes.length) openSheet('route');
      else closeSheet();
    });
  }
  renderWaypoints();
  if (state.waypoints.every(isSet)) computeRoutes();
  else {
    closeSheet();
    $$('#waypoints input')[state.waypoints.findIndex((w) => !isSet(w))]?.focus();
  }
}

/** Planung verlassen, ohne das Sheet anzufassen (für Zurück und andere Ansichten). */
export function leaveRouteMode() {
  if (state.mode !== 'route') return;
  state.mode = 'search';
  routeCtl?.abort();
  state.waypoints = [];
  state.avoid = [];
  renderWaypoints();
  clearRoutes({ keepSheet: true });
  $('#route-form').hidden = true;
  $('#route-form').classList.remove('compact');
  $('#search-form').hidden = false;
  suggest.hide();
}

/**
 * Nach der Berechnung klappt die Planung zu einer Zeile „Start → Ziel“
 * zusammen – auf dem Handy bleibt mehr Karte. Antippen klappt sie wieder auf.
 */
export function compactRoute(on) {
  const form = $('#route-form');
  // Wer gerade tippt, soll nicht plötzlich vor einer Zeile stehen
  if (on && form.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  form.classList.toggle('compact', on);
  if (!on) return;
  const first = state.waypoints[0];
  const last = state.waypoints.at(-1);
  $('.route-line-from').textContent = first?.me ? 'Mein Standort' : first?.label ?? '';
  $('.route-line-to').textContent = `${last?.label ?? ''}${state.waypoints.length > 2 ? ` (+${state.waypoints.length - 2})` : ''}`;
  $('.route-line-profile').textContent = PROFILES[state.profile]?.icon ?? 'directions';
}
$('.route-line-text').addEventListener('click', () => {
  compactRoute(false);
  afterLayout(() => { if (current()) fitRoute(); });
});
$('.route-line-back').addEventListener('click', () => $('#route-close').click());

$('#route-close').addEventListener('click', () => {
  // Kam man von einem Ort, geht es dorthin zurück; sonst alles zu
  if (stack.length > 1) back();
  else closeAll();
});

$('#swap').addEventListener('click', () => {
  state.waypoints.reverse();
  renderWaypoints();
  computeRoutes();
});

$('#add-via').addEventListener('click', () => {
  state.waypoints.splice(state.waypoints.length - 1, 0, empty());
  renderWaypoints();
  $$('#waypoints input')[state.waypoints.length - 2]?.focus();
});

/* Profil (group-radio aus wuefl-libs); Autobahn, Fähren, Verkehrsmittel … hinter dem Filter-Knopf */
const routePrefs = mountRoutePrefs($$('.route-prefs-open'), $('#route-prefs'), {
  profile: () => state.profile,
  onChange: () => computeRoutes(),
});

export function setProfile(p) {
  state.profile = p;
  local.set('wmap.profile', p);
  $$('input[name="profile"]').forEach((r) => { r.checked = r.value === p; });
  $('#add-via').hidden = !!PROFILES[p].transit;
  $('.transit-when').hidden = !PROFILES[p].transit;
  routePrefs.mark();
}

/*
 * Bus & Bahn: Abfahrt ab / Ankunft bis. Leeres Feld heißt „jetzt“; beim
 * ersten Antippen steht die aktuelle Zeit darin. „Jetzt“ leert es wieder.
 */
const whenInput = $('#when-time');
const localIso = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function whenChanged() {
  $('#when-now').hidden = !whenInput.value;
  if (PROFILES[state.profile].transit) computeRoutes();
}
whenInput.addEventListener('focus', () => { if (!whenInput.value) whenInput.value = localIso(new Date()); });
whenInput.addEventListener('change', whenChanged);
$('#when-mode').addEventListener('change', () => {
  if (!whenInput.value) whenInput.value = localIso(new Date());
  whenChanged();
});
$('#when-now').addEventListener('click', () => {
  whenInput.value = '';
  $('#when-mode').value = 'dep';
  whenChanged();
});
$('#when-now').hidden = true;
/** → { when: Date, arrive } für journeys() */
export const transitWhen = () => ({ when: whenInput.value ? new Date(whenInput.value) : new Date(), arrive: $('#when-mode').value === 'arr' && !!whenInput.value });
$$('input[name="profile"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  setProfile(r.value);
  state.along = null;
  computeRoutes();
}));
setProfile(state.profile);



/* Wegpunkte als Eingabefelder und Marker */
let wpMarkers = [];

function wpKind(i) {
  if (i === 0) return { kind: 'start', icon: 'trip_origin', placeholder: 'Start wählen' };
  if (i === state.waypoints.length - 1) return { kind: 'dest', icon: 'location_on', placeholder: 'Ziel wählen' };
  return { kind: 'via', icon: 'radio_button_checked', placeholder: 'Zwischenziel wählen' };
}

function renderWaypoints() {
  const ol = $('#waypoints');
  ol.innerHTML = state.waypoints.map((w, i) => {
    const k = wpKind(i);
    return `<li class="wp ${k.kind}" data-i="${i}">
      <span class="msr wp-icon">${w.me ? 'my_location' : k.icon}</span>
      <input type="text" value="${esc(w.label)}" placeholder="${k.placeholder}" aria-label="${k.placeholder}"
        class="${w.me ? 'is-me' : ''}" enterkeyhint="search">
      ${k.kind === 'via' ? '<button type="button" class="button wp-remove" data-shape="round no-background" title="Entfernen"><span class="msr">close</span></button>' : ''}
    </li>`;
  }).join('');
  $('#add-via').hidden = state.waypoints.length >= 7;

  wpMarkers.forEach((m) => m.remove());
  wpMarkers = state.waypoints.map((w, i) => {
    if (!w.point) return null;
    const k = wpKind(i);
    const m = new maplibregl.Marker({
      element: markerEl(k.kind, k.icon, k.kind === 'via' ? String(i) : ''),
      anchor: k.kind === 'dest' ? 'bottom' : 'center',
      draggable: true,
    }).setLngLat(w.point).addTo(map);
    m.on('dragend', () => {
      setWaypoint(i, { label: 'Punkt auf der Karte', point: m.getLngLat().toArray(), me: false }, { reverse: true });
    });
    return m;
  }).filter(Boolean);
}


/** Wegpunkt setzen, optional den Namen per Rückwärtssuche nachreichen. */
export function setWaypoint(i, wp, { reverse = false } = {}) {
  state.waypoints[i] = wp;
  renderWaypoints();
  computeRoutes();
  const nextEmpty = state.waypoints.findIndex((w) => !isSet(w));
  if (nextEmpty >= 0) $$('#waypoints input')[nextEmpty]?.focus();
  if (reverse) nameLater(wp);
}

/** Für Punkte aus der Karte den Namen per Rückwärtssuche nachreichen. */
function nameLater(wp) {
  if (!wp?.point) return;
  geocode.reverse(wp.point).then((f) => {
    const i = state.waypoints.indexOf(wp);
    if (!f || i < 0) return;
    wp.label = geocode.describe(f).title;
    const input = $$('#waypoints input')[i];
    if (input && document.activeElement !== input) input.value = wp.label;
  }).catch(() => {});
}

const updateRouteSuggestions = debounce(async (input, i) => {
  const extra = [{
    icon: 'my_location', color: ROUTE_COLOR, title: 'Mein Standort', subtitle: 'aktueller GPS-Standort',
    run: () => setWaypoint(i, me()),
  }];
  const onPlace = (f) => setWaypoint(i, placeWaypoint(f));
  const items = input.value.trim().length < 2
    ? [...extra, ...savedItems(onPlace), ...recentItems(onPlace, ['place'])]
    : withSaved(savedItems(onPlace, input.value), await placeSuggestions(input.value, onPlace, { withCategory: false, extra }));
  if (items && document.activeElement === input) suggest.show(items);
}, 160);

const wpList = $('#waypoints');
wpList.addEventListener('input', (e) => {
  const li = e.target.closest('li');
  if (li) updateRouteSuggestions(e.target, Number(li.dataset.i));
});
wpList.addEventListener('focusin', (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName !== 'INPUT') return;
  e.target.select();
  updateRouteSuggestions(e.target, Number(li.dataset.i));
});
wpList.addEventListener('focusout', () => setTimeout(() => {
  if (!wpList.contains(document.activeElement)) suggest.hide();
}, 150));

/*
 * Enter in Start/Ziel: genau nach dem Text im Feld suchen und den ersten
 * Treffer nehmen – nicht den ersten Vorschlag („Mein Standort“ steht dort oben).
 */
wpList.addEventListener('keydown', async (e) => {
  if (keyNav(e)) return;
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (suggest.active >= 0) { suggest.pick(); return; }
  const input = e.target;
  const i = Number(input.closest('li')?.dataset.i);
  const text = input.value.trim();
  if (!text || Number.isNaN(i)) return;
  cancelSuggestions();                 // offene Vorschläge verwerfen
  suggest.hide();
  if (/^mein standort$/i.test(text)) { setWaypoint(i, me()); return; }
  try {
    const [f] = await geocode.search(text, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 });
    if (f) setWaypoint(i, placeWaypoint(f)); else toast(`„${text}“ nicht gefunden`);
  } catch (err) { toast(err.message); }
});
wpList.addEventListener('click', (e) => {
  const rm = e.target.closest('.wp-remove');
  if (!rm) return;
  state.waypoints.splice(Number(rm.closest('li').dataset.i), 1);
  renderWaypoints();
  computeRoutes();
});

/** Zwischenziel an der passenden Stelle entlang der Route einfügen. */
export function addVia(point, label) {
  const r = current();
  const at = (p) => (r && p ? nearestOnLine(r.coords, r.cum, p).along : Infinity);
  const target = at(point);
  let pos = state.waypoints.length - 1;
  for (let i = 1; i < state.waypoints.length - 1; i += 1) {
    if (at(state.waypoints[i].point) > target) { pos = i; break; }
  }
  state.waypoints.splice(pos, 0, { label, point, me: false });
  renderWaypoints();
  computeRoutes();
}
