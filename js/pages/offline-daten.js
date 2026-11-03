/**
 * Offline (offline-daten.html) – Kachel in der Übersicht: alles, was ohne Netz
 * auf dem Gerät liegt, nach Art. Je Eintrag: öffnen und „nicht mehr offline“.
 *
 *   Karten-Gebiete         selbst geladene Gebiete (data/offline-areas.js) –
 *                          antippen zeigt das Gebiet im Editor (offline.html),
 *                          dort auch neu laden; „Neues Gebiet“ führt hin
 *   Aufgezeichnete Touren  ohne Ordner liegen alle ganz in der App; mit
 *                          verbundenem Ordner die der letzten Zeit und die als
 *                          „offline verfügbar“ markierten (hier aufgelistet,
 *                          antippen öffnet die Tour) – der Rest als Karteikarte
 *   Geplante Touren        immer ganz in der App – antippen öffnet die Tour
 *   Karten der Navigation  beim Navigieren vorgeladen, bleiben 10 Tage
 */
import { mountAppBar } from '../ui/appbar.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc, fmtDistance } from '../core/geo.js';
import { PROFILES } from '../core/config.js';
import { tours } from '../data/store.js';
import { tracks } from '../data/tracks.js';
import { folder } from '../data/folder.js';
import { areas, DETAIL } from '../data/offline-areas.js';
import { navCaches, clearNavCaches, NAV_DAYS, registerOffline } from '../data/offline.js';
import { sportOf, sportIcon, sportName, colorOf } from '../data/track-look.js';
import { locale, t } from '../core/i18n.js';

const root = document.querySelector('.offline-data');
const DATE = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const DAY = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const KEEP = { 30: t('offline_data.tracks.keep.days30'), 90: t('offline_data.tracks.keep.days90'), 365: t('offline_data.tracks.keep.year') };
const PLANNED_MAX = 12;
// Für Einzahl/Mehrzahl: n wählt die Form, count steht im Text
const n = (x) => ({ n: x, count: x.toLocaleString(locale) });
const size = (b) => (b >= 1e9 ? t('offline_data.unit.gb', { v: (b / 1073741824).toLocaleString(locale, { maximumFractionDigits: 1 }) })
  : t('offline_data.unit.mb', { v: (b / 1048576).toLocaleString(locale, { maximumFractionDigits: b >= 1e8 ? 0 : 1 }) }));
const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/** Zeile: links der Eintrag (führt zu seiner Ansicht), rechts „nicht mehr offline“ */
const item = ({ href, icon, color = '', title, sub, off = '' }) => `<li class="off-item">
    <a class="off-main" href="${href}">
      <span class="msr" ${color ? `style="color:${esc(color)}"` : ''}>${icon}</span>
      <span><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
    </a>${off}
  </li>`;
const offButton = (act, id, label = t('offline_data.not_offline')) => `<button type="button" class="link-button off-remove" data-act="${act}" data-id="${esc(id)}">
    <span class="msr">cloud_off</span> ${label}</button>`;

/* ── Karten-Gebiete ───────────────────────────────────────────────────────── */

function areasHtml() {
  const list = areas.all();
  const sub = (a) => (a.status === 'ok'
    ? [size(a.bytes), t('offline_data.tiles', n(a.tiles)), DETAIL[a.detail]?.short, a.terrain ? t('offline_data.areas.terrain') : '', t('offline_data.areas.date', { date: DATE.format(a.at) })]
    : [t('offline_data.areas.partial'), a.bytes ? size(a.bytes) : '', t('offline_data.areas.resume')]).filter(Boolean).join(' · ');
  return `<section id="gebiete">
    <h3><span class="msr">map</span> ${t('offline_data.areas.title')}</h3>
    ${list.length ? status('offline_pin', areas.bytes() ? t('offline_data.areas.state_size', { ...n(list.length), size: size(areas.bytes()) }) : t('offline_data.areas.state', n(list.length)))
      : status('map', t('offline_data.areas.empty'))}
    ${list.length ? `<ul class="off-list">${list.map((a) => item({
      href: `./offline.html?gebiet=${encodeURIComponent(a.id)}`, icon: a.status === 'ok' ? 'offline_pin' : 'downloading',
      title: a.name, sub: sub(a), off: offButton('area', a.id),
    })).join('')}</ul>` : ''}
    <div class="sync-actions">
      <a class="button primary" href="./offline.html?neu"><span class="msr">add_location_alt</span> ${t('offline_data.areas.new')}</a>
      ${list.length ? `<a class="button" href="./offline.html"><span class="msr">edit_location_alt</span> ${t('offline_data.areas.edit')}</a>` : ''}
    </div>
    ${list.length ? `<p class="settings-hint">${t('offline_data.areas.hint')}</p>` : ''}
  </section>`;
}

/* ── Aufgezeichnete Touren ────────────────────────────────────────────────── */

async function tracksHtml() {
  const all = await tracks.all().catch(() => []);
  const on = !!(await folder.info().catch(() => null))?.connected;
  const pinned = all.filter((x) => x.pin);
  const full = all.filter((x) => !x.stub).length;
  const line = !all.length ? status('timeline', t('offline_data.tracks.empty'))
    : !on ? status('offline_pin', t('offline_data.tracks.all_here', n(all.length)))
      : status('offline_pin', `${t('offline_data.tracks.split', { n: full, tours: t('offline_data.tracks.count', n(all.length)), which: folder.keep === 'all' ? t('offline_data.tracks.keep.all') : t('offline_data.tracks.keep.span', { span: KEEP[folder.keep] ?? t('offline_data.tracks.keep.recent') }), pinned: pinned.length ? t('offline_data.tracks.pinned', n(pinned.length)) : '' })}
        ${all.length - full ? t('offline_data.tracks.rest', { n: all.length - full }) : ''}`);
  return `<section id="touren">
    <h3><span class="msr">timeline</span> ${t('offline_data.tracks.title')}</h3>
    ${line}
    ${on && pinned.length ? `<ul class="off-list">${pinned.map((x) => item({
      href: `./wege.html?id=${encodeURIComponent(x.id)}`, icon: sportIcon(sportOf(x)), color: colorOf(x), title: x.name || t('offline_data.default_tour'),
      sub: [DATE.format(x.start), fmtDistance(x.length), sportName(sportOf(x))].join(' · '), off: offButton('track', x.id),
    })).join('')}</ul>` : ''}
    ${on ? `<p class="settings-hint">${t('offline_data.tracks.pin_hint')}</p>` : ''}
    ${all.length ? `<div class="sync-actions"><a class="button" href="./wege.html"><span class="msr">timeline</span> ${t('offline_data.tracks.view')}</a></div>` : ''}
  </section>`;
}

/* ── Geplante Touren ──────────────────────────────────────────────────────── */

function plannedHtml() {
  const all = tours.all();
  return `<section id="geplant">
    <h3><span class="msr">route</span> ${t('offline_data.planned.title')}</h3>
    ${all.length ? status('offline_pin', t('offline_data.planned.state', n(all.length)))
      : status('route', t('offline_data.planned.empty'))}
    ${all.length ? `<ul class="off-list">${all.slice(0, PLANNED_MAX).map((x) => item({
      href: `./wege.html?tour=${encodeURIComponent(x.id)}`, icon: PROFILES[x.profile]?.icon ?? 'route', title: x.name || t('offline_data.default_tour'),
      sub: [x.stats?.length ? fmtDistance(x.stats.length) : '', PROFILES[x.profile]?.label].filter(Boolean).join(' · '),
    })).join('')}</ul>` : ''}
    ${all.length > PLANNED_MAX ? `<div class="sync-actions"><a class="button" href="./wege.html?tab=geplant"><span class="msr">route</span> ${t('offline_data.planned.view_all', { n: all.length })}</a></div>` : ''}
  </section>`;
}

/* ── Karten der Navigation ────────────────────────────────────────────────── */

async function navHtml() {
  const { tiles, navs } = await navCaches();
  return `<section id="navigation">
    <h3><span class="msr">navigation</span> ${t('offline_data.nav.title')}</h3>
    ${navs.length ? status('offline_pin', t('offline_data.nav.state', { ...n(navs.length), days: NAV_DAYS }))
      : status('navigation', t('offline_data.nav.empty'))}
    ${navs.length ? `<ul class="off-list">${navs.map((x) => `<li class="off-item">
      <span class="off-main"><span class="msr">offline_pin</span>
        <span><strong>${t('offline_data.nav.item', { date: esc(DAY.format(x.at)) })}</strong><small>${esc(t('offline_data.nav.item_sub', { tiles: t('offline_data.tiles', n(x.tiles)), days: t('offline_data.nav.days', n(x.daysLeft)) }))}</small></span></span>
      ${offButton('nav', x.name)}</li>`).join('')}</ul>` : ''}
    ${tiles ? `<p class="settings-hint">${t('offline_data.nav.viewed', { tiles: t('offline_data.tiles', n(tiles)) })}</p>` : ''}
    ${navs.length || tiles ? `<div class="sync-actions"><button type="button" class="button" data-act="nav-all"><span class="msr">delete</span> ${t('offline_data.nav.delete_all')}</button></div>` : ''}
  </section>`;
}

let painting = null;
function render() {
  painting ??= (async () => {
    await null;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    root.innerHTML = `${areasHtml()}${await tracksHtml()}${plannedHtml()}${await navHtml()}
      <p class="settings-hint sync-note"><span class="msr">sd_card</span> <span>${est?.usage ? `${est.quota ? t('offline_data.usage_quota', { used: size(est.usage), quota: size(est.quota) }) : t('offline_data.usage', { used: size(est.usage) })} ` : ''}${t('offline_data.app_offline')}</span></p>`;
  })().finally(() => { painting = null; });
  return painting;
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'area') {
    const a = areas.get(id);
    if (!a) return;
    const v = await ask({ icon: 'cloud_off', title: t('offline_data.areas.remove.title', { name: a.name }), text: `${a.bytes ? `${t('offline_data.areas.remove.freed', { size: size(a.bytes) })} ` : ''}${t('offline_data.areas.remove.text')}`,
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('offline_data.areas.remove.button'), primary: true }] });
    if (v !== 'yes') return;
    await areas.remove(id);
    toast(t('offline_data.areas.remove.done', { name: a.name }));
  }
  if (act === 'track') {
    const track = await tracks.get(id);
    if (!track) return;
    // „offline verfügbar“ gilt nur auf diesem Gerät – keine Änderung für den Ordner
    const { pin: _p, ...rest } = track;
    await tracks.putQuiet(rest);
    toast(t('offline_data.tracks.unpinned', { name: track.name || t('offline_data.default_tour') }));
  }
  if (act === 'nav') { await clearNavCaches(id); toast(t('offline_data.nav.deleted_one')); }
  if (act === 'nav-all') {
    const v = await ask({ icon: 'offline_pin', title: t('offline_data.nav.delete.title'), text: t('offline_data.nav.delete.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
    if (v !== 'yes') return;
    await clearNavCaches();
    toast(t('offline_data.nav.delete.done'));
  }
  render();
});

addEventListener('wmap:folder', () => render());
// Aus dem Editor oder einer Tour zurück: Stand neu
addEventListener('pageshow', (e) => { if (e.persisted) render(); });

registerOffline();
mountAppBar();
await render();
