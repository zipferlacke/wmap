/**
 * Ladesäulen mit Belegung (services/charging.js) in der Oberfläche:
 *   chargerHtml(s)      Ladepunkte je Stecker mit frei/belegt für die Ortskarte
 *   runChargers(…)      Liste „Ladesäulen in der Nähe“ bei „Nur freie“: die 5 nächsten Standorte mit mindestens einem
 *                       freien Ladepunkt der gewählten Stecker, aus der Ladesäulen-Datenbank statt aus der Karte
 *   freeChip()          Chip „Nur freie“ für die Liste aus der Karte
 *   chargerFeature(s)   Standort als Ort für showPlace (ohne OSM-ID, die Belegung steht in `_charger`)
 */
import { PLUGS, freeChargers, freeFor, hasPlug, STEPS } from '../services/charging.js';
import { local } from '../data/store.js';
import { esc, fmtDistance, clockFormat } from '../core/geo.js';
import { afterLayout, fitTo, map, showHl, viewPadding } from './core.js';
import { hitFilter } from './category.js';
import { t, locale } from '../core/i18n.js';

const FILTER = 'wmap.chargeFilter';
/** { free: nur freie (Vorgabe an), plugs: gewählte Stecker (leer: alle) } – auf dem Gerät gemerkt */
export const chargeFilter = { free: true, plugs: [], ...local.get(FILTER, {}) };
export const saveFilter = () => local.set(FILTER, { free: chargeFilter.free, plugs: chargeFilter.plugs });

const plugName = (type) => t(`place.charging.plugs.${type}`);
const kw = (v) => (v ? `${Math.round(v)} kW` : '');

/** Ladepunkte je Stecker – mit Belegung, falls der Betreiber sie meldet */
export function chargerHtml(s) {
  const rows = s.plugs.map((p) => {
    const state = !s.live ? `<span class="muted">${t('place.charging.points', { n: p.total })}</span>`
      : `<strong class="${p.free ? 'free' : 'none'}">${t('place.charging.free', { free: p.free, total: p.total })}</strong>${
        p.broken ? ` <small>${t('place.charging.broken', { n: p.broken })}</small>` : ''}`;
    return `<li><span class="plug">${esc(plugName(p.type))}</span><span class="kw">${kw(p.kw)}</span><span class="state">${state}</span></li>`;
  }).join('');
  const time = s.updated ? new Date(s.updated).toLocaleString(locale, { day: '2-digit', month: '2-digit', ...clockFormat() }) : '';
  return `<div class="charger">
      <h4><span class="msr">ev_station</span> ${t('place.charging.title')}${s.operator ? ` <small>${esc(s.operator)}</small>` : ''}</h4>
      <ul>${rows}</ul>
      <p>${[s.live ? '' : t('place.charging.no_live'), s.live && time ? t('place.charging.updated', { time }) : '', t('place.charging.source')].filter(Boolean).join(' · ')}</p>
    </div>`;
}

export function chargerFeature(s, cat) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: s.point },
    properties: {
      name: s.name || s.operator || cat?.one || '', street: s.address,
      _tags: { amenity: 'charging_station', ...(s.name ? { name: s.name } : {}), ...(s.operator ? { operator: s.operator } : {}) },
      _charger: s,
    },
  };
}

/** Standort als Treffer für Karte und Liste (wie die Kategorie-Treffer aus Overpass) */
function hit(s, cat) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: s.point },
    properties: {
      id: `ocpdb/${s.id}`, name: s.name || s.operator || cat.one, category: cat.id, dist: s.dist,
      color: cat.color, tags: JSON.stringify(chargerFeature(s, cat).properties._tags),
    },
  };
}

export const freeChip = () => `<button type="button" class="chip" data-free aria-pressed="${chargeFilter.free}"><span class="msr">bolt</span> ${t('category.charging.only_free')}</button>`;

function chips() {
  const plug = (type) => `<button type="button" class="chip" data-plug="${type}" aria-pressed="${chargeFilter.plugs.includes(type)}">${esc(plugName(type))}</button>`;
  return `<li class="hit-filters chip-row" role="group" aria-label="${t('category.charging.plugs')}">
      ${freeChip()}
      <button type="button" class="chip" data-hf="open" aria-pressed="${hitFilter.open}"><span class="msr">schedule</span> ${t('category.filter.only_open')}</button>
      ${PLUGS.filter((p) => p !== 'other').map(plug).join('')}
    </li>`;
}

function line(s) {
  const p = s.plugs.find((x) => hasPlug({ plugs: [x] }, chargeFilter.plugs)) ?? s.plugs[0];
  const free = freeFor(s, chargeFilter.plugs);
  const total = chargeFilter.plugs.length ? s.plugs.filter((x) => chargeFilter.plugs.includes(x.type)).reduce((n, x) => n + x.total, 0) : s.total;
  return [
    t('category.distance', { distance: fmtDistance(s.dist) }),
    t('place.charging.free', { free, total }),
    p && [plugName(p.type), kw(p.kw)].filter(Boolean).join(' '),
    s.operator,
  ].filter(Boolean).join(' · ');
}

/**
 * Liste der freien Ladesäulen in `view` (.cat-sub, .cat-list), von `ref` aus gesucht. `redo()`: die Kategorie neu
 * suchen (nach „Nur freie“ aus: die Liste aus der Karte). → false, wenn die Datenbank nicht antwortet.
 */
export async function runChargers({ cat, ref, view, signal, current, onPick, redo }) {
  const sub = view.querySelector('.cat-sub');
  const ul = view.querySelector('.cat-list');
  sub.textContent = t('category.charging.searching');
  let list;
  try {
    list = await freeChargers(ref, chargeFilter.plugs, 5, { signal, open: hitFilter.open });
  } catch (err) {
    return err.name === 'AbortError';
  }
  if (!current()) return true;

  const points = list.map((s) => hit(s, cat));
  points.forEach((p, i) => { p.properties.nr = i + 1; });
  showHl({ points });
  sub.textContent = list.length ? t('category.charging.found_free', { n: list.length }) : t('category.charging.none_free', { km: STEPS.at(-1) / 1000 });
  if (list.length) {
    const xs = [ref[0], ...list.map((s) => s.point[0])], ys = [ref[1], ...list.map((s) => s.point[1])];
    afterLayout(() => fitTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 16));
  }

  ul.innerHTML = chips() + list.map((s, i) => `<li><button type="button" data-i="${i}">
      <span class="dot msr" style="--c:${cat.color}">${cat.icon}</span>
      <span class="sg-text"><strong>${esc(points[i].properties.name)}, (${i + 1})</strong><small>${esc(line(s))}</small></span>
    </button></li>`).join('');
  ul.onclick = (e) => {
    const plug = e.target.closest('[data-plug]')?.dataset.plug;
    if (plug) {
      chargeFilter.plugs = chargeFilter.plugs.includes(plug) ? chargeFilter.plugs.filter((x) => x !== plug) : [...chargeFilter.plugs, plug];
      saveFilter();
      redo();
      return;
    }
    const hf = e.target.closest('[data-hf]')?.dataset.hf;
    if (hf) { hitFilter[hf] = !hitFilter[hf]; redo(); return; }
    if (e.target.closest('[data-free]')) { chargeFilter.free = !chargeFilter.free; saveFilter(); redo(); return; }
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const s = list[Number(b.dataset.i)];
    onPick(chargerFeature(s, cat));
    afterLayout(() => map.flyTo({ center: s.point, zoom: Math.max(map.getZoom(), 16), padding: viewPadding(), duration: 900 }));
  };
  return true;
}
