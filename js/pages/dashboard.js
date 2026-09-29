/**
 * Übersicht (Dashboard): Kacheln zu allen Ansichten – mit Zahlen, wo es
 * welche gibt, „Sicherung & Abgleich“ mit dem letzten Stand –, darunter was
 * auf dem Gerät liegt und sich löschen lässt,
 * ganz unten der Dank an die Anbieter.
 */
import { mountAppBar } from '../ui/appbar.js';
import { extensions } from '../map/extensions.js';
import { tracks } from '../data/tracks.js';
import { tours, recent } from '../data/store.js';
import { layers } from '../map/layers.js';
import { areas } from '../data/offline-areas.js';
import { creditList } from '../core/credits.js';
import { folder } from '../data/folder.js';
import { healthAvailable, healthSync } from '../services/health.js';
import { autoSync } from '../data/auto-sync.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { APP_VERSION } from '../core/config.js';
import { showChangelog } from '../ui/news.js';

const $ = (s, root = document) => root.querySelector(s);
mountAppBar();

const km = (m) => `${Math.round(m / 1000).toLocaleString('de-DE')} km`;
const n = (x, one, many) => `${x.toLocaleString('de-DE')} ${x === 1 ? one : many}`;

/* ── Kacheln ──────────────────────────────────────────────────────────────── */

/** Kurzer Stand für die Kachel „Sicherung & Abgleich“ */
async function syncCount() {
  const i = await folder.info().catch(() => null);
  if (i?.error) return 'Fehler beim Abgleich';
  if (i?.connected) return `Ordner ${i.name}${i.last ? ` · ${DAY.format(i.last)}` : ''}`;
  const h = healthAvailable ? healthSync.last() : null;
  if (h?.error) return 'Fehler bei Health Connect';
  return h?.at ? `Health Connect · ${DAY.format(h.at)}` : '';
}

async function paintTiles() {
  const [ws, ls, xs, sc] = await Promise.all([tracks.all().catch(() => []), layers.all().catch(() => []), extensions.all(), syncCount()]);
  const ps = tours.all();
  const year = new Date().getFullYear();
  const thisYear = ws.filter((t) => new Date(t.start).getFullYear() === year);
  // Nur Ansichten – Tour planen, Aufzeichnen, Fliegen und Erreichbarkeit gibt es in Karte bzw. Touren
  const active = ls.filter((l) => l.onMain && l.visible).length + xs.filter((x) => x.active).length;
  const as = areas.all();
  const tiles = [
    { href: './index.html', icon: 'map', title: 'Karte', text: 'Suchen, Route planen, navigieren, aufzeichnen', main: true },
    { href: './wege.html?tab=geplant', icon: 'route', title: 'Geplante Touren', text: 'Zum Losfahren oder -laufen', count: ps.length ? n(ps.length, 'Tour', 'Touren') : 'noch keine' },
    { href: './wege.html', icon: 'timeline', title: 'Aufgezeichnete Touren', text: 'Was du gefahren und gelaufen bist', count: ws.length ? `${n(ws.length, 'Weg', 'Wege')}${thisYear.length ? ` · ${year}: ${km(thisYear.reduce((a, t) => a + t.length, 0))}` : ''}` : 'noch keine' },
    { href: './entdecken.html', icon: 'explore', title: 'Entdecken', text: 'Wander- und Radwege, Touren von anderen' },
    { href: './plugins.html', icon: 'extension', title: 'Plugins', text: 'Luftbilder, Geologie, eigene Daten, Erweiterungen', count: active ? `${active} aktiv` : '' },
    { href: './offline.html', icon: 'download_for_offline', title: 'Offline-Karten', text: 'Gebiete aufs Gerät laden – für unterwegs ohne Netz', count: as.length ? `${n(as.length, 'Gebiet', 'Gebiete')} · ${mb(areas.bytes())}` : '' },
    { href: './index.html?action=survey', icon: 'edit_location_alt', title: 'Mitmachen', text: 'Kurze Fragen, die OpenStreetMap verbessern' },
    { href: './sync.html', icon: 'sync', title: 'Sicherung & Abgleich', text: 'Ordner (Nextcloud, Drive …), Health Connect, Sicherung', count: sc, warn: /Fehler/.test(sc) },
    { href: './settings.html', icon: 'settings', title: 'Einstellungen', text: 'Hell/dunkel, Navigation, Offline, Konto' },
  ];

  $('.dash-tiles').innerHTML = tiles.map((t) => `
    <a class="dash-tile${t.main ? ' main' : ''}${t.warn ? ' warn' : ''}" href="${t.href}">
      <span class="msr dash-bg" aria-hidden="true">${t.icon}</span>
      <span class="msr dash-icon">${t.icon}</span>
      <strong>${esc(t.title)}</strong>
      <small>${t.text}</small>
      ${t.count ? `<em>${esc(t.count)}</em>` : ''}
    </a>`).join('');
}

/* ── Gespeichert: Offline-Karten, letzte Routen, Verlauf, Ordner ──────────── */

const TILES = 'wmap-tiles-v1';          // Namen wie in sw.js
const NAV = 'wmap-nav-';
const NAV_DAYS = 10;

/** Kacheln angesehener Gegenden und die vorgeladenen Navigationen */
async function offlineInfo() {
  try {
    if (!self.caches) return { tiles: 0, navs: [] };
    const keys = await caches.keys();
    const count = async (name) => (await (await caches.open(name)).keys()).length;
    const tiles = keys.includes(TILES) ? await count(TILES) : 0;
    const navs = await Promise.all(keys.filter((k) => k.startsWith(NAV))
      .map(async (name) => ({ name, at: +name.slice(NAV.length) || 0, tiles: await count(name) })));
    return { tiles, navs: navs.sort((a, b) => b.at - a.at) };
  } catch { return { tiles: 0, navs: [] }; }
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
/** Noch so viele Tage, dann löscht der Service Worker die Navigation */
const daysLeft = (at) => Math.max(0, Math.ceil(NAV_DAYS - (Date.now() - at) / 864e5));

function mb(bytes) { return `${(bytes / 1048576).toLocaleString('de-DE', { maximumFractionDigits: bytes > 1e8 ? 0 : 1 })} MB`; }

async function paintStore() {
  const routes = recent.list('route');
  const others = recent.list().filter((e) => e.kind !== 'route');
  const { tiles, navs } = await offlineInfo();
  const any = tiles || navs.length;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('.dash-rows').innerHTML = `
    <div class="dash-row">
      <span class="msr">offline_pin</span>
      <div><strong>Karten für die Navigation</strong>
        <small>${navs.length ? `${n(navs.length, 'Navigation', 'Navigationen')} vorgeladen – damit Funklöcher nicht auffallen. Jede bleibt ${NAV_DAYS} Tage; wird der Platz knapp, weicht die älteste.` : 'Keine Navigation vorgeladen'}</small>
        ${navs.length ? `<ul>${navs.map((x) => `<li>${DAY.format(x.at)} · ${n(x.tiles, 'Kachel', 'Kacheln')} · noch ${n(daysLeft(x.at), 'Tag', 'Tage')}</li>`).join('')}</ul>` : ''}
        ${tiles ? `<small>Dazu ${n(tiles, 'Kachel', 'Kacheln')} angesehener Gegenden.</small>` : ''}
        <small>Gebiete, die du selbst geladen hast, bleiben – die stehen unter <a href="./offline.html">Offline-Karten</a>.</small></div>
      ${any ? '<button type="button" class="button" data-do="tiles"><span class="msr">delete</span> Löschen</button>' : ''}
    </div>
    <div class="dash-row dash-routes">
      <span class="msr">directions</span>
      <div><strong>Letzte Routen</strong>
        ${routes.length ? `<ul>${routes.map((r, i) => `<li>
            <a href="${routeHref(r)}">${esc(r.title ?? 'Route')}</a>
            <button type="button" class="button" data-shape="round no-background" data-route="${i}" title="Diese Route vergessen"><span class="msr">close</span></button></li>`).join('')}</ul>`
        : '<small>Keine</small>'}</div>
      ${routes.length ? '<button type="button" class="button" data-do="routes"><span class="msr">delete</span> Alle</button>' : ''}
    </div>
    <div class="dash-row">
      <span class="msr">history</span>
      <div><strong>Suchverlauf</strong><small>${others.length ? n(others.length, 'Eintrag', 'Einträge') : 'Leer'}</small></div>
      ${others.length ? '<button type="button" class="button" data-do="history"><span class="msr">delete</span> Löschen</button>' : ''}
    </div>
    ${est?.usage ? `<p class="muted">Insgesamt belegt WMap ${mb(est.usage)} auf diesem Gerät${est.quota ? ` (erlaubt: ${mb(est.quota)})` : ''}.</p>` : ''}`;
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
    const v = await ask({ icon: 'offline_pin', title: 'Karten der Navigationen löschen?', text: 'Beim nächsten Navigieren werden die Karten entlang der Route wieder geladen. Deine Offline-Gebiete bleiben.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    await caches.delete(TILES);
    for (const k of await caches.keys()) if (k.startsWith(NAV)) await caches.delete(k);
    toast('Karten der Navigationen gelöscht');
  }
  if (act === 'routes') { for (const r of recent.list('route')) recent.remove(r); toast('Letzte Routen gelöscht'); }
  if (act === 'history') { for (const r of recent.list().filter((x) => x.kind !== 'route')) recent.remove(r); toast('Suchverlauf gelöscht'); }
  if (act) paintStore();
});

$('.dash-credits').innerHTML = creditList();
$('.dash-version').textContent = APP_VERSION;
$('.dash-version').addEventListener('click', () => showChangelog());
paintTiles();
paintStore();
addEventListener('wmap:folder', paintTiles);
autoSync();
