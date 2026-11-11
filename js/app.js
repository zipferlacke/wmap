/**
 * WMap – Einstieg. Verbindet Karte, Suche, Routenplanung, Bottom-Sheet und
 * Navigation. Die Fachlogik steckt in den einzelnen Modulen, hier nur der
 * Ablauf der Oberfläche.
 */
import { PROFILES } from './core/config.js';
import * as geocode from './services/geocode.js';
import { CATEGORIES } from './core/categories.js';
import { local, tours } from './data/store.js';
import { tracks, trackAsTour } from './data/tracks.js';
import { mountAppNav } from './ui/appnav.js';
import { mountAppBar } from './ui/appbar.js';
import { setupRecording } from './ui/record.js';
import { runExtensions } from './map/extensions.js';
import { share, placeUrl, readRoute, requestUrl, myName, clock } from './ui/share.js';
import { ask, toast } from './ui/dialogs.js';
import { parseGeoUri } from './core/geo-uri.js';
import { appNews } from './ui/news.js';
import { autoSync } from './data/auto-sync.js';
import { folder } from './data/folder.js';
import { savedNav } from './data/offline.js';
import { $, CAR, debounce, map, myPosition, q, state } from './app/core.js';
import { fly } from './app/map-clicks.js';
import { openSurvey } from './app/mitmachen.js';
import { nav, navTour, resumeNav } from './app/nav.js';
import { placeWaypoint, showPlace, showPoint } from './app/place.js';
import { openReach } from './app/reach.js';
import { enterRoute, setProfile } from './app/route-plan.js';
import { placeSuggestions } from './app/search.js';
import './app/views.js';
import './app/category.js';
import './app/route-results.js';
import './app/traffic-along.js';
import './app/stops.js';
import './app/report.js';
import { locale, t } from './core/i18n.js';

/* ══════════════════════════════════════════════════════════════════════════
   Startansicht, Menü oben rechts, Maße
   ══════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Startansicht: sofort der Ausschnitt, den diese App gespeichert hat (core.js).
 * Gleich danach der aus dem verbundenen Ordner (Kartenausschnitt.json) – ist
 * der neuer (anderes Gerät, oder hier noch keiner, etwa nach dem Wechsel zur
 * Webversion), springt die Karte dorthin, solange man sie noch nicht selbst
 * bewegt hat. Ist beides älter als ein Tag: zum eigenen Standort.
 * Mit Link-Parametern (siehe fromUrl) bestimmt der Link, wohin es geht.
 */
if (!CAR && !/[?&](view|q|from|to|reach|geo|ort|tour|track)=/.test(location.search)) {
  let touched = false;
  map.on('movestart', (e) => { if (e.originalEvent) touched = true; });
  const flyHome = () => myPosition({ ask: false })
    .then((p) => { if (!touched) map.flyTo({ center: p, zoom: 14, pitch: 0, duration: 1800 }); })
    .catch(() => { /* ohne Standort bleibt die letzte bzw. die Startansicht */ });
  const own = local.get('wmap.view');
  folder.readView().catch(() => null).then((v) => {
    const newer = v && v.at > (own?.at ?? 0) + 1000;
    if (newer && !touched) {
      map.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch ?? 0, bearing: v.bearing ?? 0 });
      // Der Ausschnitt des anderen Geräts gilt hier weiter mit dessen Zeit
      local.set('wmap.view', { center: v.center, zoom: v.zoom, pitch: v.pitch ?? 0, bearing: v.bearing ?? 0, at: v.at });
      savedKey = viewKey();
    }
    if (Date.now() - Math.max(own?.at ?? 0, v?.at ?? 0) < DAY_MS) return;
    flyHome();
    // Gerade im Dialog zu den Berechtigungen erlaubt (erster Start): jetzt hin
    addEventListener('wmap:location', flyHome, { once: true });
  });
}

/** Der Ausschnitt als Text, gerundet auf rund einen Meter – zum Vergleich mit dem zuletzt gespeicherten */
const viewKey = () => [...map.getCenter().toArray().map((x) => x.toFixed(5)), map.getZoom().toFixed(2),
  map.getPitch().toFixed(0), map.getBearing().toFixed(0)].join(' ');
// Stand beim Laden: der gespeicherte Ausschnitt bzw. die Startansicht – beides wird nicht neu gespeichert
let savedKey = viewKey();
let unsent = null;   // gespeichert, aber noch nicht im Ordner

const saveView = ({ now = false } = {}) => {
  // Im Auto nicht: der Ausschnitt dort ist ein anderer als am Handy. In Street View auch nicht – Neigung bis 150°
  // und Zoom 21 sind keine Kartenansicht (beim Beenden wird die vorherige Ansicht ohnehin wieder gespeichert)
  if (nav.active || CAR || document.body.classList.contains('street-view')) return;
  // Nur ein geänderter Ausschnitt bekommt eine neue Zeit: Laden, Wechsel des Tabs und Verlassen ohne Bewegung
  // lassen den gespeicherten stehen – über den Ordner gilt auf allen Geräten der, der zuletzt bewegt wurde
  const key = viewKey();
  if (key !== savedKey) {
    savedKey = key;
    unsent = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), at: Date.now() };
    local.set('wmap.view', unsent);
  }
  if (!unsent) return;
  // In den Ordner: beim Verlassen, sonst höchstens alle 2 Minuten (data/folder.js)
  const view = unsent;
  folder.writeView(view, { now }).then((ok) => { if (ok && unsent === view) unsent = null; }).catch(() => {});
};
map.on('moveend', debounce(() => saveView(), 400));
// Auch beim Verlassen sofort – wer gleich danach die Seite wechselt oder die
// App schließt, verlöre sonst die letzte Bewegung
addEventListener('pagehide', () => saveView({ now: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveView({ now: true }); });


function keysDialog() {
  const rows = [['W / S', t('map.keys.rows.move')], ['A / D', t('map.keys.rows.side')], ['Q / E', t('map.keys.rows.turn')],
    ['R / F', t('map.keys.rows.look')], [t('map.keys.rows.space'), t('map.keys.rows.up')], ['Shift', t('map.keys.rows.down')],
    ['Esc', t('map.keys.rows.esc')],
    [t('map.keys.rows.fly_key'), t('map.keys.rows.fly')]];
  ask({
    icon: 'keyboard', title: t('map.keys.title'),
    html: `<table class="keys-table">${rows.map(([k, v]) => `<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`).join('')}</table>`,
    buttons: [{ value: 'ok', label: t('map.keys.ok'), primary: true }],
  });
}

const appNav = mountAppNav();
// Hauptnavigation wie auf den anderen Seiten: Rechner links, Handy unten
document.body.classList.add('map-page');
mountAppBar();
map.resize();
// Erweiterungen (JavaScript-Plugins), die man auf der Plugin-Seite aktiviert hat
runExtensions({ map, toast, appNav }).catch(() => {});
// „Fliegen“ im Menü: hier auf der Karte ohne Neuladen starten
appNav.el.querySelector('a[href*="action=fly"]')?.addEventListener('click', (e) => { e.preventDefault(); fly.start(); });
const recording = setupRecording({ map, toast,
  // „Zurück zum Start“ beim Aufzeichnen: Route vom Standort dorthin
  onRouteTo: (point, name) => enterRoute({ to: placeWaypoint({ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { name } }) }) });
appNav.addItem('radio_button_checked', t('map.menu.record'), () => recording.choose());
appNav.addItem('streetview', t('map.menu.street_view'), () => dispatchEvent(new CustomEvent('wmap:street')));
appNav.addItem('share_location', t('map.menu.share_location'), async () => {
  try {
    const p = await myPosition();
    share({ title: t('map.my_location'), text: t('map.share_location.text', { time: clock(Date.now()) }), url: () => placeUrl(p, t('map.my_location'), { at: Date.now() }), geo: { point: p, name: t('map.my_location') } }, toast);
  } catch (err) { toast(err.message); }
});
appNav.addItem('person_pin_circle', t('map.menu.request_location'), async () => {
  const name = await myName();
  if (!name) return;
  share({ title: t('map.request.title'), text: t('map.request.text', { name }), url: () => requestUrl(name) }, toast);
});
appNav.addItem('keyboard', t('map.keys.title'), keysDialog);
appNav.addItem('settings', t('map.menu.settings'), () => { location.href = './settings.html'; });
/* Suchleiste: Controls rechts oben rücken darunter (mobil) – auch wenn sie
   nur ihre Lage ändert (Ränder der Android-App, core/theme.js) */
const panelHeight = () => {
  document.documentElement.style.setProperty('--panel-h', `${Math.round($('#search').getBoundingClientRect().bottom)}px`);
};
new ResizeObserver(panelHeight).observe($('#search'));
addEventListener('resize', panelHeight);

/* Kategorien für die Hilfe im Suchfeld */
q.title = t('search.input.categories', { list: CATEGORIES.slice(0, 12).map((c) => c.one).join(', ') });

/* ══════════════════════════════════════════════════════════════════════════
   Aufruf per Link
   ?view=lon,lat,zoom,neigung,richtung   Kamera
   ?q=Parkplatz                           Suche
   ?from=Göttingen&to=Kassel&profile=bike Route (auch „lon,lat“)
   ?reach=lon,lat                         Erreichbarkeit ab einem Punkt
   ?action=route                          Planung öffnen (App-Verknüpfung)
   ?action=record                         Aufzeichnen (Touren-Seite)
   ?action=fly|street|reach|survey        Fliegen, Street View, Erreichbarkeit, Mitmachen (Übersicht)
   ?ort=lon,lat&name=…&zeit=…             geteilter Ort / Standort (ui/share.js)
   ?street=lon,lat,richtung,blick         geteilte Street-View-Ansicht
   ?route=…                               geteilte Route (gepackt)
   ?anfrage=Name                          Standortanfrage beantworten
   ?geo=geo:51.5,9.9?q=…                  Karten-Link einer anderen App (core/geo-uri.js)
   Auch für die Screenshots in appdata/takeshots.json.
   ══════════════════════════════════════════════════════════════════════════ */

/** Street View starten, sobald die Karte steht – ist sie schon fertig, kommt kein 'idle' mehr */
function streetWhenReady(detail) {
  const go = () => dispatchEvent(new CustomEvent('wmap:street', { detail }));
  if (map.loaded()) go(); else map.once('idle', go);
}

async function fromUrl() {
  const p = new URLSearchParams(location.search);
  const view = p.get('view')?.split(',').map(Number);
  if (view?.length >= 3 && view.every(Number.isFinite)) {
    map.jumpTo({ center: [view[0], view[1]], zoom: view[2], pitch: view[3] ?? 0, bearing: view[4] ?? 0 });
  }
  const find = async (text) => {
    // Auch Koordinaten „lon,lat“ – praktisch für Tests und geteilte Links
    const xy = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (xy) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(xy[1]), Number(xy[2])] }, properties: { name: t('map.point_on_map') } };
    }
    return (await geocode.search(text, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 }))[0];
  };
  try {
    if (p.get('from') || p.get('to')) {
      if (PROFILES[p.get('profile')]?.nav) setProfile(p.get('profile'));
      const [a, b] = await Promise.all([p.get('from') ? find(p.get('from')) : null, p.get('to') ? find(p.get('to')) : null]);
      enterRoute({ from: a ? placeWaypoint(a) : null, to: b ? placeWaypoint(b) : null });
    } else if (p.get('street')) {
      const [lon, lat, bearing = 0, look = 82] = p.get('street').split(',').map(Number);
      if ([lon, lat, bearing, look].every(Number.isFinite)) {
        map.jumpTo({ center: [lon, lat], zoom: 18, pitch: 60, bearing });
        streetWhenReady({ point: [lon, lat], bearing, look });
      }
    } else if (p.get('reach')) {
      const [lon, lat] = p.get('reach').split(',').map(Number);
      openReach({ origin: [lon, lat], label: t('map.point_on_map') });
    } else if (p.get('q')) {
      q.value = p.get('q');
      const items = await placeSuggestions(q.value, (f) => showPlace(f));
      items?.[0]?.run();
    } else if (p.get('action') === 'route') {
      enterRoute();
    } else if (p.get('action') === 'record') {
      recording.choose();
    } else if (p.get('action') === 'fly') {
      map.once('idle', () => fly.start());
    } else if (p.get('action') === 'street') {
      streetWhenReady(null);
    } else if (p.get('action') === 'reach') {
      openReach();
    } else if (p.get('action') === 'survey') {
      openSurvey();
    } else if (p.get('ort')) {
      openShared(p);
    } else if (p.get('route')) {
      const r = await readRoute(p.get('route'));
      if (PROFILES[r.profile]?.nav) setProfile(r.profile);
      enterRoute({ waypoints: r.waypoints });
    } else if (p.get('tour')) {
      await startTour(p.get('tour'), p.has('start'));
    } else if (p.get('track')) {
      await startTrack(p.get('track'), p.has('start'));
    } else if (p.get('anfrage')) {
      answerRequest(p.get('anfrage'));
    } else if (p.get('geo')) {
      await openGeo(p.get('geo'));
    }
  } catch (err) { toast(err.message); }
}
/**
 * Geplante Tour navigieren („?tour=ID&start“ aus Meine Touren): ihre Punkte
 * als Route, Profil passend (Wandern → zu Fuß, Rennrad → Rad …); mit
 * `start` geht die Navigation los, sobald die Route steht. Aufgezeichnet
 * wird sie immer (app/nav.js) – auch wenn „Fahrten merken“ aus ist.
 */
async function startTour(id, go) {
  const tour = tours.all().find((x) => x.id === id);
  if (!tour?.points?.length) { toast(t('map.link.tour_missing')); return; }
  return navigateTour(tour, go);
}

/**
 * Aufgezeichnete Tour noch einmal navigieren („?track=ID&start“ aus Meine
 * Touren → Aufgezeichnet): ihr Verlauf als ein paar Punkte, dazwischen wird
 * neu gerechnet – wie bei einer geplanten Tour mit festem Verlauf. Liegt sie
 * nur im verbundenen Ordner, kommt sie von dort.
 */
async function startTrack(id, go) {
  let tour = null;
  try { tour = await tracks.full(id); } catch (err) { toast(err.message); return; }
  if (!tour?.shape) { toast(t('map.link.tour_missing')); return; }
  return navigateTour(trackAsTour(tour), go);
}

async function navigateTour(tour, go) {
  const costing = PROFILES[tour.profile]?.costing;
  setProfile(costing === 'bicycle' ? 'bike' : costing === 'auto' ? 'car' : 'foot');
  const n = tour.points.length;
  navTour.set(tour);
  enterRoute({ waypoints: tour.points.map((point, i) => ({ label: i === 0 ? t('route.waypoint.tour_start', { name: tour.name }) : i === n - 1 ? tour.name : `${tour.name} · ${i}`, point, me: false })) });
  if (!go) return;
  // Warten, bis die Route berechnet ist – dann los
  for (let i = 0; i < 120 && !state.routes.length; i += 1) await new Promise((r) => setTimeout(r, 250));
  if (state.routes.length) document.querySelector('.start-nav')?.click();
  else toast(t('map.link.tour_no_route'));
}

/** Geteilter Ort oder Standort („?ort=lon,lat&name=…&zeit=…“) */
function openShared(p) {
  const [lon, lat] = p.get('ort').split(',').map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const name = p.get('name') || t('map.link.shared.place');
  const f = { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, _point: true } };
  showPlace(f, { fly: true });
  const mins = Number(p.get('zeit'));
  const sub = $('[data-view="place"] .place-sub');
  if (mins) {
    const ago = Math.round((Date.now() - mins * 60000) / 60000);
    sub.textContent = ago < 1 ? t('map.link.shared.now') : ago < 90 ? t('map.link.shared.minutes', { n: ago })
      : t('map.link.shared.date', { date: new Date(mins * 60000).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
  }
  geocode.reverse([lon, lat]).then((r) => {
    if (state.place !== f || !r) return;
    const d = geocode.describe(r);
    sub.textContent = [sub.textContent, t('map.near_place', { place: [d.title, d.subtitle].filter(Boolean).join(', ') })].filter(Boolean).join(' · ');
  }).catch(() => {});
}

/**
 * Karten-Link aus einer anderen App: Punkt (mit Namen) oder Suche. Kommt aus
 * der App (Android, Rechner: src-tauri/src/lib.rs), vom Browser (Manifest
 * „protocol_handlers“) oder aus den Einstellungen („geo:-Links öffnen“).
 */
async function openGeo(link) {
  const g = parseGeoUri(link);
  if (!g) { toast(t('map.link.geo_unreadable')); return; }
  if (g.point) map.jumpTo({ center: g.point, zoom: g.zoom ?? (g.query ? 14 : 16) });
  if (g.query && g.point) {
    // Suche in der Nähe des Punkts – auch Kategorien („Bäckerei“)
    q.value = g.query;
    const items = await placeSuggestions(g.query, (f) => showPlace(f));
    if (items?.[0]) items[0].run(); else toast(t('map.link.nothing_found', { query: g.query }));
  } else if (g.query) {
    // Nur eine Adresse: ohne Bezug zum letzten Kartenausschnitt suchen
    q.value = g.query;
    const [f] = await geocode.search(g.query, { limit: 1 });
    if (f) showPlace(f, { fly: true }); else toast(t('map.link.nothing_found', { query: g.query }));
  } else if (g.label) {
    showPlace({ type: 'Feature', geometry: { type: 'Point', coordinates: g.point }, properties: { name: g.label, _point: true } }, { fly: false });
  } else {
    showPoint(g.point);
  }
}

/** „Wo bist du?“ – Standort an den Fragenden zurückschicken. */
async function answerRequest(from) {
  const name = from.slice(0, 40);
  const v = await ask({
    icon: 'person_pin_circle', title: t('map.request.answer.title', { name }),
    text: t('map.request.answer.text'),
    buttons: [{ value: 'no', label: t('common.not_now') }, { value: 'yes', label: t('map.request.answer.send'), icon: 'send', primary: true }],
  });
  if (v !== 'yes') return;
  try {
    const p = await myPosition();
    const me = local.get('wmap.myname');
    const here = me ? t('map.share_location.of_person', { name: me }) : t('map.share_location.plain');
    share({ title: t('map.my_location'), text: t('map.share_location.text', { time: clock(Date.now()) }), url: () => placeUrl(p, here, { at: Date.now() }), geo: { point: p, name: here } }, toast);
  } catch (err) { toast(err.message); }
}

// Autobildschirm (Android Auto): Vorlagen des Autos statt Oberfläche, keine Dialoge
if (CAR) import('./car/car.js');
if (map.loaded()) fromUrl(); else map.once('load', fromUrl);
if (!CAR) { if (map.loaded()) resumeNav(); else map.once('load', resumeNav); }
// Willkommen, Neues nach einem Update, Nachrichten – nur beim normalen Start,
// nicht wenn ein Link etwas öffnet und nicht vor einer unterbrochenen
// Navigation („Navigation fortsetzen?“). Gleich jetzt, nicht erst wenn die
// Karte fertig geladen ist (bei schwachem Netz käme es sonst mitten in der Bedienung)
if (!CAR) {
  const linked = /[?&](view|q|from|to|reach|action|ort|route|anfrage|geo|sim|tour|track)\b/.test(location.search);
  appNews({ dialogs: !linked && !nav.active && !savedNav() });
}
map.once('idle', () => {
  // Ordner und Health Connect still abgleichen (wenn eingeschaltet) – nicht während einer Navigation
  if (!CAR && !nav.active) autoSync();
});
