/**
 * Linie aus der Suche: „Bus 11“, „Göttingen Linie 9“, „Darmstadt Bus L“. Der Vorschlag kommt sofort und ohne Anfrage –
 * erst das Antippen fragt OpenStreetMap (services/transit.js findLines) und zeigt die erste Richtung auf der Karte.
 */
import * as geocode from '../services/geocode.js';
import { findLines, lineStopsHtml, parseLineQuery, transitHtml } from '../services/transit.js';
import { toast } from '../ui/dialogs.js';
import { $, afterLayout, fitTo } from './core.js';
import { clearCategory } from './category.js';
import { clearPlace } from './place.js';
import { clearReach } from './reach.js';
import { leaveRouteMode } from './route-plan.js';
import { transitLine } from './stops.js';
import { openSheet, remember } from './views.js';
import { t } from '../core/i18n.js';

let shown = null;                 // { title, where, list, active, line }

function paint() {
  const view = $('[data-view="lines"]');
  $('.lines-title', view).textContent = shown.title;
  $('.lines-sub', view).textContent = shown.where;
  const box = $('.lines-list', view);
  box.innerHTML = shown.list
    ? transitHtml(shown.list, { active: shown.active, all: true, title: t('lines.directions') })
    : `<p class="muted"><span class="msr spin">progress_activity</span> ${t('lines.searching')}</p>`;
  if (shown.line) box.querySelector(`[data-line="${shown.active}"]`)?.insertAdjacentHTML('afterend', lineStopsHtml(shown.line));
}

async function showDirection(id, s = shown) {
  try {
    const line = await transitLine.show(id);
    if (shown !== s) return;
    s.active = id;
    s.line = line;
    paint();
    if (line.bounds) afterLayout(() => fitTo(line.bounds.flat(), 16));
  } catch (err) {
    if (err.name !== 'AbortError') toast(t('lines.toast.unavailable', { error: err.message }));
  }
}

async function showLines(query, center) {
  leaveRouteMode();
  clearPlace();
  clearCategory();
  clearReach();
  const s = { title: query.label, where: query.place ? t('map.in_place', { place: query.place }) : t('map.around_here'), list: null, active: null, line: null };
  shown = s;
  remember('lines', () => { shown = s; openSheet('lines'); paint(); if (s.active) showDirection(s.active, s); });
  openSheet('lines');
  paint();
  try {
    let at = center();
    if (query.place) {
      const [f] = await geocode.search(query.place, { center: at, limit: 1 });
      if (!f) { s.list = []; toast(t('search.toast.not_found', { text: query.place })); paint(); return; }
      at = f.geometry.coordinates;
    }
    const list = await findLines(query, at);
    if (shown !== s) return;
    s.list = list;
    paint();
    if (!list.length) {
      $('[data-view="lines"] .lines-list').innerHTML = `<p class="muted">${t('lines.none', { ref: query.ref, where: query.place ? t('map.in_place', { place: query.place }) : t('map.around_here') })}</p>`;
      return;
    }
    await showDirection(list[0].id, s);
  } catch (err) {
    if (err.name === 'AbortError' || shown !== s) return;
    s.list = [];
    paint();
    $('[data-view="lines"] .lines-list').innerHTML = `<p class="muted">${t('lines.unavailable', { error: err.message })}</p>`;
  }
}

$('[data-view="lines"] .lines-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-line]');
  if (!b || !shown) return;
  const id = Number(b.dataset.line);
  if (shown.active === id) return;
  const icon = $('.msr', b);
  if (icon) { icon.textContent = 'progress_activity'; icon.classList.add('spin'); }
  showDirection(id);
});

/** Vorschlag für die Suche – oder null, wenn der Text keine Linie meint */
export function lineItem(text, center) {
  const query = parseLineQuery(text);
  if (!query) return null;
  return {
    icon: 'directions_bus', color: '#e03131', title: query.label, type: t('lines.item.type'),
    subtitle: query.place ? t('lines.item.in_place', { place: query.place }) : t('lines.item.around_here'),
    run: () => showLines(query, center),
  };
}
