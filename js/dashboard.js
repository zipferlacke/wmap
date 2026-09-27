/**
 * Übersicht (Dashboard): Kacheln zu allen Ansichten – mit Zahlen, wo es
 * welche gibt –, darunter was auf dem Gerät liegt und sich löschen lässt,
 * ganz unten der Dank an die Anbieter.
 */
import { mountAppBar } from './appbar.js';
import { extensions } from './extensions.js';
import { tracks } from './tracks.js';
import { tours, recent } from './store.js';
import { layers } from './layers.js';
import { creditList } from './credits.js';
import { mountFolder } from './folder.js';
import { ask } from './ui.js';
import { esc } from './geo.js';

const $ = (s, root = document) => root.querySelector(s);
mountAppBar();

function toast(text) {
  let el = $('#toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

const km = (m) => `${Math.round(m / 1000).toLocaleString('de-DE')} km`;
const n = (x, one, many) => `${x.toLocaleString('de-DE')} ${x === 1 ? one : many}`;

/* ── Kacheln ──────────────────────────────────────────────────────────────── */

async function paintTiles() {
  const [ws, ls, xs] = await Promise.all([tracks.all().catch(() => []), layers.all().catch(() => []), extensions.all()]);
  const ps = tours.all();
  const year = new Date().getFullYear();
  const thisYear = ws.filter((t) => new Date(t.start).getFullYear() === year);
  // Nur Ansichten – Tour planen, Aufzeichnen, Fliegen und Erreichbarkeit gibt es in Karte bzw. Touren
  const active = ls.filter((l) => l.onMain && l.visible).length + xs.filter((x) => x.active).length;
  const tiles = [
    { href: './index.html', icon: 'map', title: 'Karte', text: 'Suchen, Route planen, navigieren, aufzeichnen', main: true },
    { href: './wege.html?tab=geplant', icon: 'route', title: 'Meine Touren', text: 'Geplant – zum Losfahren oder -laufen', count: ps.length ? n(ps.length, 'Tour', 'Touren') : 'noch keine' },
    { href: './wege.html', icon: 'timeline', title: 'Aufgezeichnet', text: 'Was du gefahren und gelaufen bist', count: ws.length ? `${n(ws.length, 'Weg', 'Wege')}${thisYear.length ? ` · ${year}: ${km(thisYear.reduce((a, t) => a + t.length, 0))}` : ''}` : 'noch keine' },
    { href: './entdecken.html', icon: 'explore', title: 'Entdecken', text: 'Wander- und Radwege, Touren von anderen' },
    { href: './plugins.html', icon: 'extension', title: 'Plugins', text: 'Luftbilder, Geologie, eigene Daten, Erweiterungen', count: active ? `${active} aktiv` : '' },
    { href: './index.html?action=survey', icon: 'edit_location_alt', title: 'Mitmachen', text: 'Kurze Fragen, die OpenStreetMap verbessern' },
    { href: './index.html?action=settings', icon: 'settings', title: 'Einstellungen', text: 'Hell/dunkel, Navigation, Offline, Konto' },
  ];

  $('.dash-tiles').innerHTML = tiles.map((t) => `
    <a class="dash-tile${t.main ? ' main' : ''}" href="${t.href}">
      <span class="msr dash-bg" aria-hidden="true">${t.icon}</span>
      <span class="msr dash-icon">${t.icon}</span>
      <strong>${t.title}</strong>
      <small>${t.text}</small>
      ${t.count ? `<em>${esc(t.count)}</em>` : ''}
    </a>`).join('');
}

/* ── Gespeichert: Offline-Karten, letzte Routen, Verlauf, Ordner ──────────── */

const TILES = 'wmap-tiles-v1';          // Name wie in sw.js

async function tileCount() {
  try { return caches && (await caches.has(TILES)) ? (await (await caches.open(TILES)).keys()).length : 0; } catch { return 0; }
}

function mb(bytes) { return `${(bytes / 1048576).toLocaleString('de-DE', { maximumFractionDigits: bytes > 1e8 ? 0 : 1 })} MB`; }

async function paintStore() {
  const routes = recent.list('route');
  const others = recent.list().filter((e) => e.kind !== 'route');
  const tiles = await tileCount();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('.dash-rows').innerHTML = `
    <div class="dash-row">
      <span class="msr">offline_pin</span>
      <div><strong>Karten für die Navigation</strong>
        <small>${tiles ? `${n(tiles, 'Kachel', 'Kacheln')} entlang gefahrener Routen und angesehener Gegenden – damit Funklöcher nicht auffallen` : 'Nichts gespeichert'}</small></div>
      ${tiles ? '<button type="button" class="button" data-do="tiles"><span class="msr">delete</span> Löschen</button>' : ''}
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
    ${est?.usage ? `<p class="muted">Insgesamt belegt WMap ${mb(est.usage)} auf diesem Gerät${est.quota ? ` (erlaubt: ${mb(est.quota)})` : ''}.</p>` : ''}
    <div class="dash-folder"></div>`;
  mountFolder($('.dash-folder'), { toast });
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
    const v = await ask({ icon: 'offline_pin', title: 'Offline-Karten löschen?', text: 'Beim nächsten Navigieren werden die Karten entlang der Route wieder geladen.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    await caches.delete(TILES);
    toast('Offline-Karten gelöscht');
  }
  if (act === 'routes') { for (const r of recent.list('route')) recent.remove(r); toast('Letzte Routen gelöscht'); }
  if (act === 'history') { for (const r of recent.list().filter((x) => x.kind !== 'route')) recent.remove(r); toast('Suchverlauf gelöscht'); }
  if (act) paintStore();
});

$('.dash-credits').innerHTML = creditList();
paintTiles();
paintStore();
addEventListener('wmap:folder', paintTiles);
