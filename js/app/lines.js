/**
 * Linie aus der Suche: „Bus 11“, „Göttingen Linie 9“, „Darmstadt Bus L“. Der Vorschlag kommt sofort und ohne Anfrage.
 * Das Antippen sucht die Linien dieses Namens in OpenStreetMap (services/transit.js findLines, eine Abfrage mit den
 * Halten, ohne Wege) und zeigt die erste Richtung auf der Karte: Verlauf und Halte mit Zeiten der nächsten Fahrt ab dem
 * ersten Halt (services/timetable departures, tripCourse – einer der drei Fahrplan-Anbieter), sonst der Verlauf aus
 * OpenStreetMap.
 */
import * as geocode from '../services/geocode.js';
import { colorOf, findLines, lineStopsHtml, parseLineQuery, transitHtml } from '../services/transit.js';
import { departures, tripCourse } from '../services/timetable/index.js';
import { toast } from '../ui/dialogs.js';
import { $, afterLayout, fitTo } from './core.js';
import { feature } from '../services/usage.js';
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

const plain = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

/** Abfahrt dieser Linie in Richtung der Relation: gleiche Nummer, Ziel passt (sonst die erste mit der Nummer) */
function matching(list, rel) {
  const same = list.filter((d) => plain(d.line) === plain(rel.ref) && d.course);
  const to = plain(rel.to);
  return same.find((d) => to && (plain(d.to).includes(to) || to.includes(plain(d.to)))) ?? same[0] ?? null;
}

/** Verlauf aus dem Fahrplan: nächste Fahrt der Linie ab ihrem ersten Halt (rel.stop) → wie transitLine.show, oder null */
async function fromTimetable(rel) {
  const { stop } = rel;
  if (!stop) return null;
  const { list } = await departures(stop.point, { name: stop.name, limit: 60, feature: 'lines' });
  const dep = matching(list, rel);
  if (!dep) return null;
  const course = await tripCourse(dep, { feature: 'lines' });
  if (course.coords.length < 2 && course.stops.filter((x) => x.point).length < 2) return null;
  return transitLine.showCourse(`line:${rel.id}`, { ...course, color: colorOf(rel) });
}

async function showDirection(id, s = shown) {
  try {
    const rel = s.list?.find((r) => r.id === id);
    const line = (rel && await fromTimetable(rel).catch((err) => { if (err.name === 'AbortError') throw err; return null; }))
      ?? await transitLine.show(id, { feature: 'lines' });
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
  feature('lines');
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
    const list = await findLines(query, at, { feature: 'lines' });
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
