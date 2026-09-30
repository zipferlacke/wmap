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

const root = document.querySelector('.offline-data');
const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const KEEP = { 30: 'der letzten 30 Tage', 90: 'der letzten 90 Tage', 365: 'des letzten Jahres' };
const PLANNED_MAX = 12;
const n = (count, one, many) => `${count.toLocaleString('de-DE')} ${count === 1 ? one : many}`;
const size = (b) => (b >= 1e9 ? `${(b / 1073741824).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
  : `${(b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: b >= 1e8 ? 0 : 1 })} MB`);
const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/** Zeile: links der Eintrag (führt zu seiner Ansicht), rechts „nicht mehr offline“ */
const item = ({ href, icon, color = '', title, sub, off = '' }) => `<li class="off-item">
    <a class="off-main" href="${href}">
      <span class="msr" ${color ? `style="color:${esc(color)}"` : ''}>${icon}</span>
      <span><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
    </a>${off}
  </li>`;
const offButton = (act, id, label = 'Nicht mehr offline') => `<button type="button" class="link-button off-remove" data-act="${act}" data-id="${esc(id)}">
    <span class="msr">cloud_off</span> ${label}</button>`;

/* ── Karten-Gebiete ───────────────────────────────────────────────────────── */

function areasHtml() {
  const list = areas.all();
  const sub = (a) => (a.status === 'ok'
    ? [size(a.bytes), n(a.tiles, 'Kachel', 'Kacheln'), DETAIL[a.detail]?.label.split(' – ')[0], a.terrain ? 'mit Gelände' : '', `Stand ${DATE.format(a.at)}`]
    : ['Unvollständig', a.bytes ? size(a.bytes) : '', 'im Editor „Weiter laden“']).filter(Boolean).join(' · ');
  return `<section id="gebiete">
    <h3><span class="msr">map</span> Karten-Gebiete</h3>
    ${list.length ? status('offline_pin', `${n(list.length, 'Gebiet liegt', 'Gebiete liegen')} ganz auf dem Gerät${areas.bytes() ? ` – zusammen ${size(areas.bytes())}` : ''}. Sie bleiben, bis du sie entfernst.`)
      : status('map', 'Noch kein Gebiet geladen. Ein Gebiet ist ein Stück Karte, das ganz auf dem Gerät liegt – für unterwegs ohne Netz.')}
    ${list.length ? `<ul class="off-list">${list.map((a) => item({
      href: `./offline.html?gebiet=${encodeURIComponent(a.id)}`, icon: a.status === 'ok' ? 'offline_pin' : 'downloading',
      title: a.name, sub: sub(a), off: offButton('area', a.id),
    })).join('')}</ul>` : ''}
    <div class="sync-actions">
      <a class="button primary" href="./offline.html?neu"><span class="msr">add_location_alt</span> Neues Gebiet</a>
      ${list.length ? '<a class="button" href="./offline.html"><span class="msr">edit_location_alt</span> Gebiete bearbeiten</a>' : ''}
    </div>
    ${list.length ? '<p class="settings-hint">Die Karte eines Gebiets bleibt auf dem Stand vom Laden. Aktualisieren: Gebiet antippen und dort „Neu laden“.</p>' : ''}
  </section>`;
}

/* ── Aufgezeichnete Touren ────────────────────────────────────────────────── */

async function tracksHtml() {
  const all = await tracks.all().catch(() => []);
  const on = !!(await folder.info().catch(() => null))?.connected;
  const pinned = all.filter((t) => t.pin);
  const full = all.filter((t) => !t.stub).length;
  const line = !all.length ? status('timeline', 'Noch keine aufgezeichneten Touren.')
    : !on ? status('offline_pin', `Alle ${n(all.length, 'Tour liegt', 'Touren liegen')} ganz auf diesem Gerät. Ohne verbundenen Ordner wird nichts ausgelagert und nichts nach Zeit gelöscht.`)
      : status('offline_pin', `${full} von ${n(all.length, 'Tour', 'Touren')} ${full === 1 ? 'liegt' : 'liegen'} ganz in der App: ${folder.keep === 'all' ? 'alle' : `die ${KEEP[folder.keep] ?? 'der letzten Zeit'}`}${pinned.length ? ` und ${n(pinned.length, 'als „offline verfügbar“ markierte', 'als „offline verfügbar“ markierte')}` : ''}.
        ${all.length - full ? `${all.length - full === 1 ? 'Die übrige liegt' : `Die übrigen ${all.length - full} liegen`} im Ordner – in der App steht die Karteikarte (Name, Strecke, Zeit, grober Verlauf).` : ''}`);
  return `<section id="touren">
    <h3><span class="msr">timeline</span> Aufgezeichnete Touren</h3>
    ${line}
    ${on && pinned.length ? `<ul class="off-list">${pinned.map((t) => item({
      href: `./wege.html?id=${encodeURIComponent(t.id)}`, icon: sportIcon(sportOf(t)), color: colorOf(t), title: t.name || 'Tour',
      sub: [DATE.format(t.start), fmtDistance(t.length), sportName(sportOf(t))].join(' · '), off: offButton('track', t.id),
    })).join('')}</ul>` : ''}
    ${on ? `<p class="settings-hint">Offline verfügbar machen: die Tour öffnen und „Offline verfügbar“ antippen. Wie lange Touren von selbst ganz in der App bleiben, stellst du unter
      <a href="./sync.html">Sicherung &amp; Synchronisation</a> ein („In der App behalten“).</p>` : ''}
    ${all.length ? '<div class="sync-actions"><a class="button" href="./wege.html"><span class="msr">timeline</span> Aufgezeichnete Touren ansehen</a></div>' : ''}
  </section>`;
}

/* ── Geplante Touren ──────────────────────────────────────────────────────── */

function plannedHtml() {
  const all = tours.all();
  return `<section id="geplant">
    <h3><span class="msr">route</span> Geplante Touren</h3>
    ${all.length ? status('offline_pin', `${n(all.length, 'geplante Tour liegt', 'geplante Touren liegen')} ganz in der App – zum Losfahren auch ohne Netz. Für die Karte unterwegs ein Gebiet laden; beim Navigieren lädt WMap die Karte entlang der Route von selbst vor.`)
      : status('route', 'Noch keine geplanten Touren.')}
    ${all.length ? `<ul class="off-list">${all.slice(0, PLANNED_MAX).map((t) => item({
      href: `./wege.html?tour=${encodeURIComponent(t.id)}`, icon: PROFILES[t.profile]?.icon ?? 'route', title: t.name || 'Tour',
      sub: [t.stats?.length ? fmtDistance(t.stats.length) : '', PROFILES[t.profile]?.label].filter(Boolean).join(' · '),
    })).join('')}</ul>` : ''}
    ${all.length > PLANNED_MAX ? `<div class="sync-actions"><a class="button" href="./wege.html?tab=geplant"><span class="msr">route</span> Alle ${all.length} ansehen</a></div>` : ''}
  </section>`;
}

/* ── Karten der Navigation ────────────────────────────────────────────────── */

async function navHtml() {
  const { tiles, navs } = await navCaches();
  return `<section id="navigation">
    <h3><span class="msr">navigation</span> Karten der Navigation</h3>
    ${navs.length ? status('offline_pin', `${n(navs.length, 'Navigation', 'Navigationen')} vorgeladen – damit Funklöcher unterwegs nicht auffallen. Jede bleibt ${NAV_DAYS} Tage; wird der Platz knapp, weicht die älteste.`)
      : status('navigation', 'Keine Navigation vorgeladen. Beim Start einer Navigation lädt WMap die Karte entlang der Route von selbst.')}
    ${navs.length ? `<ul class="off-list">${navs.map((x) => `<li class="off-item">
      <span class="off-main"><span class="msr">offline_pin</span>
        <span><strong>Navigation vom ${esc(DAY.format(x.at))}</strong><small>${esc(`${n(x.tiles, 'Kachel', 'Kacheln')} · noch ${n(x.daysLeft, 'Tag', 'Tage')}`)}</small></span></span>
      ${offButton('nav', x.name)}</li>`).join('')}</ul>` : ''}
    ${tiles ? `<p class="settings-hint">Dazu ${n(tiles, 'Kachel', 'Kacheln')} angesehener Gegenden – sie bleiben, solange Platz ist.</p>` : ''}
    ${navs.length || tiles ? '<div class="sync-actions"><button type="button" class="button" data-act="nav-all"><span class="msr">delete</span> Alle löschen</button></div>' : ''}
  </section>`;
}

let painting = null;
function render() {
  painting ??= (async () => {
    await null;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    root.innerHTML = `${areasHtml()}${await tracksHtml()}${plannedHtml()}${await navHtml()}
      <p class="settings-hint sync-note"><span class="msr">sd_card</span> <span>${est?.usage ? `Insgesamt belegt WMap ${size(est.usage)} auf diesem Gerät${est.quota ? ` (erlaubt: ${size(est.quota)})` : ''}. ` : ''}Die App selbst läuft auch ohne Netz; Suchen und Routen berechnen brauchen es.</span></p>`;
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
    const v = await ask({ icon: 'cloud_off', title: `„${a.name}“ nicht mehr offline?`, text: `${a.bytes ? `${size(a.bytes)} werden frei. ` : ''}Das Gebiet wird vom Gerät gelöscht – ohne Netz ist die Karte dort dann nicht mehr da.`,
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Entfernen', primary: true }] });
    if (v !== 'yes') return;
    await areas.remove(id);
    toast(`„${a.name}“ entfernt`);
  }
  if (act === 'track') {
    const t = await tracks.get(id);
    if (!t) return;
    // „offline verfügbar“ gilt nur auf diesem Gerät – keine Änderung für den Ordner
    const { pin: _p, ...rest } = t;
    await tracks.putQuiet(rest);
    toast(`„${t.name || 'Tour'}“ liegt nach dem nächsten Abgleich nur noch im Ordner`);
  }
  if (act === 'nav') { await clearNavCaches(id); toast('Karte der Navigation gelöscht'); }
  if (act === 'nav-all') {
    const v = await ask({ icon: 'offline_pin', title: 'Karten der Navigationen löschen?', text: 'Beim nächsten Navigieren werden die Karten entlang der Route wieder geladen. Deine Gebiete bleiben.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
    if (v !== 'yes') return;
    await clearNavCaches();
    toast('Karten der Navigationen gelöscht');
  }
  render();
});

addEventListener('wmap:folder', () => render());
// Aus dem Editor oder einer Tour zurück: Stand neu
addEventListener('pageshow', (e) => { if (e.persisted) render(); });

registerOffline();
mountAppBar();
await render();
