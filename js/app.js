/**
 * WMap – Einstieg. Verbindet Karte, Suche, Routenplanung, Bottom-Sheet und
 * Navigation. Die Fachlogik steckt in den einzelnen Modulen, hier nur der
 * Ablauf der Oberfläche.
 */
import { PROFILES } from './config.js';
import * as geocode from './geocode.js';
import { CATEGORIES } from './categories.js';
import { local } from './store.js';
import { mountAppNav } from './appnav.js';
import { mountAppBar } from './appbar.js';
import { setupRecording } from './record-ui.js';
import { runExtensions } from './extensions.js';
import { share, placeUrl, readRoute, requestUrl, myName, clock } from './share.js';
import { ask, toast } from './ui.js';
import { $, debounce, freshView, map, myPosition, q, state } from './app/core.js';
import { fly } from './app/map-clicks.js';
import { openSurvey } from './app/mitmachen.js';
import { nav, resumeNav } from './app/nav.js';
import { placeWaypoint, showPlace } from './app/place.js';
import { openReach } from './app/reach.js';
import { enterRoute, setProfile } from './app/route-plan.js';
import { placeSuggestions } from './app/search.js';
import './app/views.js';
import './app/category.js';
import './app/route-results.js';
import './app/traffic-along.js';
import './app/stops.js';
import './app/report.js';

/* ══════════════════════════════════════════════════════════════════════════
   Startansicht, Menü oben rechts, Maße
   ══════════════════════════════════════════════════════════════════════════ */

// Mit Link-Parametern (siehe fromUrl) bestimmt der Link, wohin es geht
if (!freshView && !/[?&](view|q|from|to|reach)=/.test(location.search)) {
  myPosition()
    .then((p) => map.flyTo({ center: p, zoom: 14, pitch: 0, duration: 1800 }))
    .catch(() => { /* ohne Standort bleibt die letzte bzw. die Startansicht */ });
}

map.on('moveend', debounce(() => {
  if (nav.active) return;
  local.set('wmap.view', {
    center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), at: Date.now(),
  });
}, 400));


function keysDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog confirm';
  const rows = [['W / S', 'vor / zurück'], ['A / D', 'nach links / rechts'], ['Q / E', 'drehen'],
    ['R / F', 'nach oben / unten schauen'], ['Leertaste', 'höher'], ['Shift', 'tiefer'],
    ['Esc', 'normale Ansicht – in der Navigation: zum eigenen Standort'],
    ['Fliegen', 'Menü → Fliegen: die Maus schaut, W fliegt zur Bildmitte, Esc beendet']];
  dlg.innerHTML = `<h2><span class="msr">keyboard</span> Tastatur</h2>
    <table class="keys-table">${rows.map(([k, v]) => `<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`).join('')}</table>
    <div class="confirm-actions"><button type="button" class="button primary" value="ok">Verstanden</button></div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target.closest('button')) { dlg.close(); dlg.remove(); } });
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.showModal();
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
const recording = setupRecording({ map, toast });
appNav.addItem('radio_button_checked', 'Aufzeichnen', () => recording.choose());
appNav.addItem('share_location', 'Standort teilen', async () => {
  try {
    const p = await myPosition();
    share({ title: 'Mein Standort', text: `Hier bin ich gerade (${clock(Date.now())} Uhr):`, url: () => placeUrl(p, 'Mein Standort', { at: Date.now() }) }, toast);
  } catch (err) { toast(err.message); }
});
appNav.addItem('person_pin_circle', 'Standort anfragen', async () => {
  const name = await myName();
  if (!name) return;
  share({ title: 'Wo bist du?', text: `${name} möchte wissen, wo du gerade bist. Tippe auf den Link, um deinen Standort zu senden:`, url: () => requestUrl(name) }, toast);
});
appNav.addItem('keyboard', 'Tastatur', keysDialog);
appNav.addItem('settings', 'Einstellungen', () => { location.href = './settings.html'; });
/* Suchleiste: Controls rechts oben rücken darunter (mobil) */
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--panel-h', `${Math.round($('#search').getBoundingClientRect().bottom)}px`);
}).observe($('#search'));

/* Kategorien für die Hilfe im Suchfeld */
q.title = `Auch Kategorien: ${CATEGORIES.slice(0, 12).map((c) => c.one).join(', ')} …`;

/* ══════════════════════════════════════════════════════════════════════════
   Aufruf per Link
   ?view=lon,lat,zoom,neigung,richtung   Kamera
   ?q=Parkplatz                           Suche
   ?from=Göttingen&to=Kassel&profile=bike Route (auch „lon,lat“)
   ?reach=lon,lat                         Erreichbarkeit ab einem Punkt
   ?action=route                          Planung öffnen (App-Verknüpfung)
   ?action=record                         Aufzeichnen (Touren-Seite)
   ?action=fly|reach|survey               Fliegen, Erreichbarkeit, Mitmachen (Übersicht)
   ?ort=lon,lat&name=…&zeit=…             geteilter Ort / Standort (share.js)
   ?route=…                               geteilte Route (gepackt)
   ?anfrage=Name                          Standortanfrage beantworten
   Auch für die Screenshots in appdata/takeshots.json.
   ══════════════════════════════════════════════════════════════════════════ */

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
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(xy[1]), Number(xy[2])] }, properties: { name: 'Punkt auf der Karte' } };
    }
    return (await geocode.search(text, { center: map.getCenter().toArray(), zoom: map.getZoom(), limit: 1 }))[0];
  };
  try {
    if (p.get('from') || p.get('to')) {
      if (PROFILES[p.get('profile')]?.nav) setProfile(p.get('profile'));
      const [a, b] = await Promise.all([p.get('from') ? find(p.get('from')) : null, p.get('to') ? find(p.get('to')) : null]);
      enterRoute({ from: a ? placeWaypoint(a) : null, to: b ? placeWaypoint(b) : null });
    } else if (p.get('reach')) {
      const [lon, lat] = p.get('reach').split(',').map(Number);
      openReach({ origin: [lon, lat], label: 'Punkt auf der Karte' });
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
    } else if (p.get('anfrage')) {
      answerRequest(p.get('anfrage'));
    }
  } catch (err) { toast(err.message); }
}
/** Geteilter Ort oder Standort („?ort=lon,lat&name=…&zeit=…“) */
function openShared(p) {
  const [lon, lat] = p.get('ort').split(',').map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const name = p.get('name') || 'Geteilter Ort';
  const f = { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, _point: true } };
  showPlace(f, { fly: true });
  const mins = Number(p.get('zeit'));
  const sub = $('[data-view="place"] .place-sub');
  if (mins) {
    const ago = Math.round((Date.now() - mins * 60000) / 60000);
    sub.textContent = `Geteilt ${ago < 1 ? 'gerade eben' : ago < 90 ? `vor ${ago} min` : `am ${new Date(mins * 60000).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}`;
  }
  geocode.reverse([lon, lat]).then((r) => {
    if (state.place !== f || !r) return;
    const d = geocode.describe(r);
    sub.textContent = [sub.textContent, `bei ${[d.title, d.subtitle].filter(Boolean).join(', ')}`].filter(Boolean).join(' · ');
  }).catch(() => {});
}

/** „Wo bist du?“ – Standort an den Fragenden zurückschicken. */
async function answerRequest(from) {
  const name = from.slice(0, 40);
  const v = await ask({
    icon: 'person_pin_circle', title: `${name} fragt, wo du bist`,
    text: 'Dein Standort wird einmalig als Link geteilt – du wählst selbst, an wen. Nichts wird gespeichert.',
    buttons: [{ value: 'no', label: 'Nicht jetzt' }, { value: 'yes', label: 'Standort senden', icon: 'send', primary: true }],
  });
  if (v !== 'yes') return;
  try {
    const p = await myPosition();
    const me = local.get('wmap.myname');
    share({ title: 'Mein Standort', text: `Hier bin ich gerade (${clock(Date.now())} Uhr):`, url: () => placeUrl(p, me ? `${me}s Standort` : 'Standort', { at: Date.now() }) }, toast);
  } catch (err) { toast(err.message); }
}

if (map.loaded()) fromUrl(); else map.once('load', fromUrl);
if (map.loaded()) resumeNav(); else map.once('load', resumeNav);
