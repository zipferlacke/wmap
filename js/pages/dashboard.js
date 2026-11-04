/**
 * Übersicht (Dashboard): Kacheln zu allen Ansichten – mit Zahlen, wo es
 * welche gibt, „Sicherung & Synchronisation“ mit dem letzten Stand –, darunter was
 * auf dem Gerät liegt und sich löschen lässt,
 * ganz unten der Dank an die Anbieter.
 */
import { mountAppBar } from '../ui/appbar.js';
import { extensions } from '../map/extensions.js';
import { tracks } from '../data/tracks.js';
import { tours, recent } from '../data/store.js';
import { layers } from '../map/layers.js';
import { areas } from '../data/offline-areas.js';
import { navCaches, clearNavCaches, NAV_DAYS } from '../data/offline.js';
import { creditList } from '../core/credits.js';
import { folder } from '../data/folder.js';
import { healthAvailable, healthSync } from '../services/health.js';
import { autoSync } from '../data/auto-sync.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { APP_VERSION } from '../core/config.js';
import { appVersion } from '../core/native.js';
import { runningVersion, showChangelog } from '../ui/news.js';
import { questions } from '../osm/survey.js';
import { contribute } from '../data/trace.js';
import { locale, t } from '../core/i18n.js';

const $ = (s, root = document) => root.querySelector(s);
mountAppBar();

const km = (m) => t('dashboard.unit.km', { v: Math.round(m / 1000).toLocaleString(locale) });
// Für Einzahl/Mehrzahl: n wählt die Form, count steht im Text
const n = (x) => ({ n: x, count: x.toLocaleString(locale) });

/* ── Kacheln ──────────────────────────────────────────────────────────────── */

/** Kurzer Stand für die Kachel „Sicherung & Synchronisation“ */
async function syncCount() {
  const i = await folder.info().catch(() => null);
  if (i?.connected && folder.busy) return { text: t('dashboard.tiles.sync.state.busy') };
  if (i?.error) return { text: t('dashboard.tiles.sync.state.error'), warn: true };
  if (i?.connected) return { text: i.last ? t('dashboard.tiles.sync.state.folder_at', { name: i.name, date: DAY.format(i.last) }) : t('dashboard.tiles.sync.state.folder', { name: i.name }) };
  const h = healthAvailable ? healthSync.last() : null;
  if (h?.error) return { text: t('dashboard.tiles.sync.state.health_error'), warn: true };
  return { text: h?.at ? t('dashboard.tiles.sync.state.health_at', { date: DAY.format(h.at) }) : '' };
}

async function paintTiles() {
  const [ws, ls, xs, sc] = await Promise.all([tracks.all().catch(() => []), layers.all().catch(() => []), extensions.all(), syncCount()]);
  const ps = tours.all();
  const year = new Date().getFullYear();
  const thisYear = ws.filter((w) => new Date(w.start).getFullYear() === year);
  // Nur Ansichten – Tour planen, Aufzeichnen, Fliegen und Erreichbarkeit gibt es in Karte bzw. Touren
  const active = ls.filter((l) => l.onMain && l.visible).length + xs.filter((x) => x.active).length;
  const as = areas.all();
  const qs = contribute.get() ? questions.list().length : 0;
  const tiles = [
    { href: './index.html', icon: 'map', title: t('dashboard.tiles.map.title'), text: t('dashboard.tiles.map.text'), main: true },
    { href: './wege.html?tab=geplant', icon: 'route', title: t('dashboard.tiles.planned.title'), text: t('dashboard.tiles.planned.text'), count: ps.length ? t('dashboard.tiles.planned.count', n(ps.length)) : t('dashboard.tiles.planned.none') },
    { href: './wege.html', icon: 'timeline', title: t('dashboard.tiles.recorded.title'), text: t('dashboard.tiles.recorded.text'), count: ws.length ? `${t('dashboard.tiles.recorded.count', n(ws.length))}${thisYear.length ? t('dashboard.tiles.recorded.this_year', { year, km: km(thisYear.reduce((a, w) => a + w.length, 0)) }) : ''}` : t('dashboard.tiles.recorded.none') },
    { href: './entdecken.html', icon: 'explore', title: t('dashboard.tiles.discover.title'), text: t('dashboard.tiles.discover.text') },
    { href: './plugins.html', icon: 'extension', title: t('dashboard.tiles.plugins.title'), text: t('dashboard.tiles.plugins.text'), count: active ? t('dashboard.tiles.plugins.active', { n: active }) : '' },
    { href: './offline-daten.html', icon: 'download_for_offline', title: t('dashboard.tiles.offline.title'), text: t('dashboard.tiles.offline.text'), count: as.length ? t('dashboard.tiles.offline.count', { ...n(as.length), size: mb(areas.bytes()) }) : '' },
    { href: './index.html?action=survey', icon: 'edit_location_alt', title: t('dashboard.tiles.survey.title'), text: t('dashboard.tiles.survey.text'), count: qs ? t('dashboard.tiles.survey.count', n(qs)) : '', hot: qs > 0 },
    { href: './sync.html', icon: 'sync', title: t('dashboard.tiles.sync.title'), text: t('dashboard.tiles.sync.text'), count: sc.text, warn: sc.warn },
    { href: './settings.html', icon: 'settings', title: t('dashboard.tiles.settings.title'), text: t('dashboard.tiles.settings.text') },
  ];

  $('.dash-tiles').innerHTML = tiles.map((x) => `
    <a class="dash-tile${x.main ? ' main' : ''}${x.warn ? ' warn' : ''}${x.hot ? ' hot' : ''}" href="${x.href}">
      <span class="msr dash-bg" aria-hidden="true">${x.icon}</span>
      <span class="msr dash-icon">${x.icon}</span>
      <strong>${esc(x.title)}</strong>
      <small>${x.text}</small>
      ${x.count ? `<em>${esc(x.count)}</em>` : ''}
    </a>`).join('');
}

/* ── Gespeichert: Offline-Karten, letzte Routen, Verlauf, Ordner ──────────── */

const DAY = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
function mb(bytes) { return t('dashboard.unit.mb', { v: (bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: bytes > 1e8 ? 0 : 1 }) }); }

async function paintStore() {
  const routes = recent.list('route');
  const others = recent.list().filter((e) => e.kind !== 'route');
  const { tiles, navs } = await navCaches();
  const any = tiles || navs.length;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('.dash-rows').innerHTML = `
    <div class="dash-row">
      <span class="msr">offline_pin</span>
      <div><strong>${t('dashboard.store.nav.title')}</strong>
        <small>${navs.length ? t('dashboard.store.nav.loaded', { ...n(navs.length), days: NAV_DAYS }) : t('dashboard.store.nav.none')}</small>
        ${navs.length ? `<ul>${navs.map((x) => `<li>${t('dashboard.store.nav.item', { date: DAY.format(x.at), tiles: t('dashboard.store.nav.tiles', n(x.tiles)), days: t('dashboard.store.nav.days', n(x.daysLeft)) })}</li>`).join('')}</ul>` : ''}
        ${tiles ? `<small>${t('dashboard.store.nav.viewed', { tiles: t('dashboard.store.nav.tiles', n(tiles)) })}</small>` : ''}
        <small>${t('dashboard.store.nav.areas')}</small></div>
      ${any ? `<button type="button" class="button" data-do="tiles"><span class="msr">delete</span> ${t('common.delete')}</button>` : ''}
    </div>
    <div class="dash-row dash-routes">
      <span class="msr">directions</span>
      <div><strong>${t('dashboard.store.routes.title')}</strong>
        ${routes.length ? `<ul>${routes.map((r, i) => `<li>
            <a href="${routeHref(r)}">${esc(r.title ?? t('dashboard.store.routes.unnamed'))}</a>
            <button type="button" class="button" data-shape="round no-background" data-route="${i}" title="${t('dashboard.store.routes.forget')}"><span class="msr">close</span></button></li>`).join('')}</ul>`
        : `<small>${t('dashboard.store.routes.none')}</small>`}</div>
      ${routes.length ? `<button type="button" class="button" data-do="routes"><span class="msr">delete</span> ${t('dashboard.store.routes.delete_all')}</button>` : ''}
    </div>
    <div class="dash-row">
      <span class="msr">history</span>
      <div><strong>${t('dashboard.store.history.title')}</strong><small>${others.length ? t('dashboard.store.history.count', n(others.length)) : t('dashboard.store.history.empty')}</small></div>
      ${others.length ? `<button type="button" class="button" data-do="history"><span class="msr">delete</span> ${t('common.delete')}</button>` : ''}
    </div>
    ${est?.usage ? `<p class="muted">${est.quota ? t('dashboard.store.usage_quota', { used: mb(est.usage), quota: mb(est.quota) }) : t('dashboard.store.usage', { used: mb(est.usage) })}</p>` : ''}`;
}

/** Letzte Route auf der Karte wieder öffnen – mit Punkten, „Mein Standort“ bleibt offen */
function routeHref(r) {
  const at = (w) => (w?.point ? w.point.map((v) => v.toFixed(5)).join(',') : '');
  const p = new URLSearchParams();
  if (at(r.from)) p.set('from', at(r.from));
  if (at(r.to)) p.set('to', at(r.to));
  if (r.profile) p.set('profile', r.profile);
  return `./index.html?${p}`;
}

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-do]')?.dataset.do;
  const one = e.target.closest('[data-route]');
  if (one) {
    const r = recent.list('route')[+one.dataset.route];
    recent.remove(r);
    paintStore();
    return;
  }
  if (act === 'tiles') {
    const v = await ask({ icon: 'offline_pin', title: t('dashboard.store.nav.delete.title'), text: t('dashboard.store.nav.delete.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
    if (v !== 'yes') return;
    await clearNavCaches();
    toast(t('dashboard.store.nav.delete.done'));
  }
  if (act === 'routes') { for (const r of recent.list('route')) recent.remove(r); toast(t('dashboard.store.routes.deleted')); }
  if (act === 'history') { for (const r of recent.list().filter((x) => x.kind !== 'route')) recent.remove(r); toast(t('dashboard.store.history.deleted')); }
  if (act) paintStore();
});

$('.dash-credits').innerHTML = creditList();
$('.dash-version').textContent = APP_VERSION;
// Die Version kommt vom Service Worker (gehört zu seinen Dateien); in der App dazu die Version der App selbst – die
// Oberfläche kommt von app.wuefl.de und kann neuer sein
Promise.all([runningVersion(), appVersion()]).then(([ui, v]) => {
  $('.dash-version').textContent = v ? t('dashboard.about.version_app', { version: ui, app: v }) : ui;
});
$('.dash-version').addEventListener('click', () => showChangelog());
paintTiles();
paintStore();
addEventListener('wmap:folder', paintTiles);
addEventListener('wmap:folder-progress', (e) => { if (e.detail.busy || e.detail.done) paintTiles(); });
autoSync();
