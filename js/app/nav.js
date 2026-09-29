/**
 * Navigation: Start, Bild in Bild, Offline-Karten, Suche unterwegs, Fortsetzen.
 */
import { PROFILES } from '../core/config.js';
import { showPois, dataSaver } from '../map/map.js';
import * as overpass from '../services/overpass.js';
import { byId, routeCategories } from '../core/categories.js';
import { Navigation } from '../nav/navigation.js';
import { recorder, historySetting } from '../data/tracks.js';
import { NavPip, pipSupported, autoPip } from '../nav/pip.js';
import { prefs } from '../ui/route-prefs.js';
import { share, placeUrl, clock } from '../ui/share.js';
import { ask, toast } from '../ui/dialogs.js';
import { trace, trips } from '../data/trace.js';
import { registerOffline, saveRouteOffline, offlineSetting, rememberNav, forgetNav, savedNav } from '../data/offline.js';
import { nearestOnLine, pointAt, simplifyTo, fmtDistance, esc, cumulative } from '../core/geo.js';
import { renderResultList, tilePointsAlong } from './category.js';
import { $, $$, SIMULATING, chipHtml, current, map, state } from './core.js';
import { askAfterTrip, askContributeOnce } from './mitmachen.js';
import { askParking, checkTrafficPassed, reportHere } from './report.js';
import { leaveRouteMode } from './route-plan.js';
import { clearRoutes } from './route-results.js';
import { suggest } from './search.js';
import { loadSharedReports } from './traffic-along.js';
import { closeSheet, openSheet, remember, stack } from './views.js';

/* ══════════════════════════════════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════════════════════════════════ */

export const nav = new Navigation(map, $('#nav'), {
  onExit({ arrived }) {
    forgetNav();
    pip.close();
    // Fahrt in „Meine Wege“ merken
    if (recorder.kind === 'nav') {
      recorder.stop().then((t) => {
        if (t) toast(`Fahrt gespeichert (${fmtDistance(t.length)})`, { action: { label: 'Ansehen', run: () => { location.href = `./wege.html?id=${encodeURIComponent(t.id)}`; } } });
      }).catch(() => {});
    }
    // Mitmachen: Fahrt abschließen und schauen, ob es Fragen gibt
    if (trips.end({ arrived })) askAfterTrip();
    // Fertig ist fertig: Route, Planung und Blatt weg – zurück zur Karte
    leaveRouteMode();
    clearRoutes();
    closeSheet();
  },
  onRoute(route, { again, ...opts }) {
    rememberNav({ route, ...opts, destination: navDestination });
    if (!again) loadSharedReports(route);
    // again: nur Spuren/Tempolimits nachgeladen – Karte ist schon gespeichert
    if (!again) keepOffline(route);
  },
  onSearch: () => openNavSearch(),
  // Simulierte Fahrten (?sim) nicht aufzeichnen – dort war niemand
  onFix: (fix) => {
    if (!SIMULATING) trace.add(fix);
    if (!SIMULATING && recorder.kind === 'nav') recorder.add(fix);
    checkTrafficPassed(fix.point);
  },
  onArrive: (point, profile) => { if (profile === 'car') askParking(point); },
  onReport: (point) => reportHere(point),
  // Ankunft teilen: wohin, wann – und wo man gerade ist
  onShare: ({ point, to, eta }) => {
    const where = navDestination ? navDestination.split(',')[0] : 'mein Ziel';
    share({
      title: 'Ich bin unterwegs',
      text: `Ich bin unterwegs nach ${where} – Ankunft ca. ${clock(eta)} Uhr. Hier bin ich gerade:`,
      url: () => placeUrl(point ?? to, 'Unterwegs', { at: Date.now() }),
    }, toast);
  },
  onReroute: (ev) => trips.reroute(ev),
});
window.__wmap.nav = nav;

/* Bild in Bild: Karte und nächste Anweisung über anderen Apps (Android-App, Chrome/Edge, Safari) */
const pip = new NavPip($('#nav'), { map });
autoPip();
if (pipSupported()) {
  $('.nav-pip').hidden = false;
  $('.nav-pip').addEventListener('click', () => pip.toggle().catch((err) => toast(`Bild in Bild ging nicht: ${err.message}`)));
  // Wo der Browser es kann: beim Wechsel in eine andere App von selbst
  try { navigator.mediaSession?.setActionHandler('enterpictureinpicture', () => { if (nav.active) pip.toggle().catch(() => {}); }); } catch { /* nicht unterstützt */ }
}

let navDestination = '';
/** Gerade navigierte geplante Tour (app.js, „?tour=“) – wird immer aufgezeichnet */
let tourNavigated = null;
export const navTour = { set: (t) => { tourNavigated = t; } };
$('.start-nav').addEventListener('click', async () => {
  const r = current();
  if (!r) return;
  await askContributeOnce();
  navDestination = state.waypoints.at(-1)?.label ?? '';
  suggest.hide();
  closeSheet();
  if (!SIMULATING) trips.start({ profile: state.profile, destination: navDestination });
  // Fahrten merken (Einstellung, Standard aus) – eine geplante Tour immer
  if (!SIMULATING && (historySetting.get() || tourNavigated) && !recorder.active) {
    recorder.start({
      kind: 'nav', profile: state.profile,
      name: tourNavigated?.name ?? (navDestination ? `Nach ${navDestination.split(',')[0]}` : ''),
      from: state.waypoints[0]?.label ?? '', to: navDestination, keep: !!tourNavigated,
    });
  }
  nav.start(r, { profile: state.profile, highways: prefs.highways, targets: state.points.slice(1) });
});

/*
 * Offline: Karte entlang der Route vorladen, damit Funklöcher unterwegs
 * nicht auffallen. Nicht im Datensparmodus und nicht, wenn abgeschaltet.
 */
let offlineJob = null;
const offlineBadge = $('#nav .nav-offline');
function paintOffline(state, text = '') {
  const [icon, title] = {
    loading: ['download', 'Karte für die Strecke wird gespeichert'],
    ok: ['offline_pin', 'Karte für die Strecke ist offline gespeichert'],
    off: ['cloud_off', 'Offline – neu berechnen geht erst wieder mit Netz'],
  }[state] ?? [];
  offlineBadge.hidden = !icon;
  offlineBadge.className = `nav-offline ${state ?? ''}`;
  offlineBadge.title = title ?? '';
  if (icon) offlineBadge.innerHTML = `<span class="msr">${icon}</span>${esc(text)}`;
}
async function keepOffline(route) {
  if (!offlineSetting.get() || dataSaver() || !navigator.onLine) return;
  const job = offlineJob = {};
  paintOffline('loading', '0 %');
  try {
    const res = await saveRouteOffline(map, route, {
      onProgress: (done, total) => { if (offlineJob === job) paintOffline('loading', `${Math.round((done / total) * 100)} %`); },
    });
    if (offlineJob !== job) return;
    paintOffline(res.failed ? null : 'ok');
  } catch { if (offlineJob === job) paintOffline(null); }
}
window.addEventListener('offline', () => { if (nav.active) paintOffline('off'); });
window.addEventListener('online', () => { if (nav.active) paintOffline(null); });


/* Unterwegs: was liegt vor mir an der Strecke? */
let navSearchCtl = null;
function openNavSearch() {
  if (!nav.active) return;
  stack.length = 0;
  remember('navsearch', () => openSheet('navsearch'));
  const view = $('[data-view="navsearch"]');
  $('.navsearch-cats', view).innerHTML = routeCategories(nav.profile).map((c) => chipHtml(c)).join('');
  $('.navsearch-list', view).innerHTML = '';
  openSheet('navsearch');
}
$('.navsearch-cats').addEventListener('click', async (e) => {
  const cat = byId(e.target.closest('[data-cat]')?.dataset.cat);
  const r = nav.route;
  if (!cat || !r) return;
  $$('.navsearch-cats .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === cat.id)));
  const list = $('.navsearch-list');
  list.innerHTML = `<li class="muted">Suche ${esc(cat.label)} vor dir …</li>`;
  navSearchCtl?.abort();
  navSearchCtl = new AbortController();
  // Nur, was noch vor einem liegt (höchstens 150 km)
  const from = nav.along;
  const startI = nearestOnLine(r.coords, r.cum, pointAt(r.coords, r.cum, from)).index;
  let endI = r.cum.findIndex((m) => m > from + 150000);
  if (endI < 0) endI = r.coords.length;
  const rest = r.coords.slice(startI, endI);
  const { signal } = navSearchCtl;
  const radius = PROFILES[nav.profile]?.radius ?? 400;
  const render = (points, final) => {
    const ahead = points.filter((p) => p.properties.along > 0).sort((a, b) => a.properties.along - b.properties.along);
    showPois(map, ahead);
    if (!ahead.length) {
      list.innerHTML = `<li class="muted">${final ? `Keine ${esc(cat.label)} vor dir an der Strecke` : `Suche ${esc(cat.label)} vor dir …`}</li>`;
      return;
    }
    renderResultList(list, ahead.slice(0, 60), cat, (p) => `in ${fmtDistance(p.properties.along)} · ${fmtDistance(p.properties.offset)} abseits`);
  };
  // Sofort aus den Kacheln (meist schon offline gespeichert), Overpass ergänzt
  let fromTiles = [];
  const instant = tilePointsAlong(cat, r, radius, signal, { from, to: from + 150000 }).then((pts) => {
    fromTiles = pts.map((p) => ({ ...p, properties: { ...p.properties, along: p.properties.along - from } }));
    if (!signal.aborted && fromTiles.length) render(fromTiles, false);
  }).catch(() => {});
  try {
    const { points } = await overpass.alongLine(cat, simplifyTo(rest, 150), radius, { signal });
    await instant;
    if (signal.aborted) return;
    const near = points.map((p) => {
      const s = nearestOnLine(r.coords, r.cum, p.geometry.coordinates, startI, endI);
      Object.assign(p.properties, { along: s.along - from, offset: s.offset });
      return p;
    }).filter((p) => p.properties.offset <= radius * 1.3);
    const ids = new Set(near.map((p) => p.properties.id));
    render([...near, ...fromTiles.filter((p) => p.properties.id && !ids.has(p.properties.id))], true);
  } catch (err) {
    if (err.name === 'AbortError') return;
    await instant;
    if (fromTiles.length) render(fromTiles, true);
    else list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
});

/* Nach einem Neuladen mitten in der Fahrt (auch offline): weiter navigieren? */
export async function resumeNav() {
  const saved = savedNav();
  // Ein Link mit eigenem Ziel (auch die Screenshots) geht vor
  if (!saved || nav.active || /[?&](view|q|from|to|reach)=/.test(location.search)) return;
  const answer = await ask({
    icon: 'navigation', title: 'Navigation fortsetzen?',
    text: saved.destination ? `Weiter nach ${saved.destination}.` : 'Die letzte Fahrt wurde nicht beendet.',
    buttons: [{ value: 'no', label: 'Beenden' }, { value: 'yes', label: 'Fortsetzen', icon: 'navigation', primary: true }],
  });
  if (answer !== 'yes') { forgetNav(); return; }
  const route = { ...saved.route, cum: cumulative(saved.route.coords) };
  navDestination = saved.destination ?? '';
  if (!SIMULATING) trips.start({ profile: saved.profile, destination: navDestination });
  nav.start(route, { profile: saved.profile, highways: saved.highways, targets: saved.targets });
}
registerOffline();
