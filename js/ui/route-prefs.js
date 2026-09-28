/**
 * Routen-Einstellungen hinter dem Filter-Knopf der Routenplanung.
 *
 *   Auto          Autobahnen, Mautstraßen, Fähren vermeiden
 *   Fahrrad       unbefestigte Wege und Fähren vermeiden
 *   Zu Fuß        Fähren vermeiden
 *   Bus & Bahn    Verkehrsmittel (Fernzüge, Regional/S-Bahn, U-Bahn/Tram,
 *                 Bus), Umsteigezeit mindestens, schnellste Verbindung
 *                 zusätzlich zeigen
 *
 * Alles bleibt im Browser gespeichert (wmap.routePrefs). Die Navigation
 * rechnet unterwegs mit denselben Einstellungen neu.
 */
import { local } from '../data/store.js';

const KEY = 'wmap.routePrefs';

/** Verkehrsmittel-Gruppen → Produktklassen der EFA */
const MODES = {
  long: { label: 'Fernzüge (ICE, IC)', icon: 'train', classes: [14, 15, 16] },
  regional: { label: 'Regionalzug, S-Bahn', icon: 'directions_railway', classes: [0, 1, 13, 18] },
  urban: { label: 'U-Bahn, Tram', icon: 'tram', classes: [2, 3, 4, 8] },
  bus: { label: 'Bus', icon: 'directions_bus', classes: [5, 6, 7, 10, 17, 19] },
};
const ALWAYS = [9, 11];                 // Schiff, Sonstige
const CHANGE_TIMES = [2, 5, 10, 15, 20];

const DEFAULTS = {
  highways: true, tolls: true, ferries: true, unpaved: true,
  modes: { long: true, regional: true, urban: true, bus: true },
  change: 5, fastest: true,
};

const saved = local.get(KEY, {}) ?? {};
export const prefs = { ...DEFAULTS, ...saved, modes: { ...DEFAULTS.modes, ...(saved.modes ?? {}) } };

const save = () => local.set(KEY, prefs);

/** Zusätzliche Valhalla-Optionen der Routenplanung (nicht des Tourenplaners) */
export function valhallaPrefs(costing) {
  const o = {};
  if (!prefs.ferries) o.use_ferry = 0;
  if (costing === 'auto' && !prefs.tolls) o.use_tolls = 0;
  if (costing === 'bicycle' && !prefs.unpaved) o.avoid_bad_surfaces = 1;
  return o;
}

/** EFA-Parameter für die Verkehrsmittel – leer, wenn alle erlaubt sind */
export function transitParams() {
  const on = Object.entries(MODES).filter(([k]) => prefs.modes[k]);
  if (on.length === Object.keys(MODES).length) return {};
  const p = { ptOptionsActive: '1', includedMeans: 'checkbox' };
  for (const c of [...ALWAYS, ...on.flatMap(([, m]) => m.classes)]) p[`inclMOT_${c}`] = '1';
  return p;
}

/** Weicht etwas von der Voreinstellung ab? (Punkt am Filter-Knopf) */
export function changed(profile) {
  if (profile === 'transit') return Object.values(prefs.modes).some((v) => !v) || prefs.change !== DEFAULTS.change || !prefs.fastest;
  if (profile === 'car') return !prefs.highways || !prefs.tolls || !prefs.ferries;
  if (profile === 'bike') return !prefs.unpaved || !prefs.ferries;
  return !prefs.ferries;
}

const check = (key, label, icon) => `<label class="pref-row"><span class="msr">${icon}</span><span>${label}</span>
  <input type="checkbox" data-shape="toggle" data-avoid="${key}"${prefs[key] ? '' : ' checked'}></label>`;

function html(profile) {
  if (profile === 'transit') {
    return `<h2><span class="msr">tune</span> Verbindungen</h2>
      <div class="pref-group"><h3>Verkehrsmittel</h3><div class="chip-row pref-modes">
        ${Object.entries(MODES).map(([k, m]) => `<button type="button" class="chip" data-mode="${k}" aria-pressed="${prefs.modes[k]}"><span class="msr">${m.icon}</span> ${m.label}</button>`).join('')}
      </div></div>
      <div class="pref-group"><h3>Umsteigezeit mindestens</h3><div class="chip-row pref-change">
        ${CHANGE_TIMES.map((m) => `<button type="button" class="chip" data-change="${m}" aria-pressed="${prefs.change === m}">${m} min</button>`).join('')}
      </div></div>
      <label class="pref-row"><span class="msr">bolt</span><span>Schnellste Verbindung auch zeigen<small>auch wenn das Umsteigen knapp ist</small></span>
        <input type="checkbox" data-shape="toggle" data-flag="fastest"${prefs.fastest ? ' checked' : ''}></label>`;
  }
  const rows = profile === 'car'
    ? [['highways', 'Autobahnen vermeiden', 'add_road'], ['tolls', 'Mautstraßen vermeiden', 'toll'], ['ferries', 'Fähren vermeiden', 'directions_boat']]
    : profile === 'bike'
      ? [['unpaved', 'Unbefestigte Wege vermeiden', 'landscape'], ['ferries', 'Fähren vermeiden', 'directions_boat']]
      : [['ferries', 'Fähren vermeiden', 'directions_boat']];
  return `<h2><span class="msr">tune</span> Route</h2>${rows.map((r) => check(...r)).join('')}`;
}

/**
 * Knopf und Popover verbinden.
 * @param o.profile   () → aktuelles Profil
 * @param o.onChange  nach jeder Änderung (neu berechnen)
 */
export function mountRoutePrefs(buttons, panel, { profile, onChange }) {
  const mark = () => buttons.forEach((b) => b.classList.toggle('changed', changed(profile())));
  const paint = () => { panel.innerHTML = html(profile()); };
  // Welcher Knopf geöffnet hat (ausführlich oder zusammengeklappt): darunter anzeigen
  let from = buttons[0];
  buttons.forEach((b) => b.addEventListener('click', () => { from = b; }));
  panel.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    paint();
    // Am Rechner unter dem Knopf, am Handy volle Breite
    const b = from.getBoundingClientRect();
    const wide = matchMedia('(min-width: 701px)').matches;
    panel.style.top = `${Math.round(b.bottom + 8)}px`;
    panel.style.left = wide ? `${Math.round(Math.max(12, Math.min(b.left, innerWidth - panel.offsetWidth - 12)))}px` : '';
  });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.avoid) prefs[t.dataset.avoid] = !t.checked;
    if (t.dataset.flag) prefs[t.dataset.flag] = t.checked;
    save(); mark(); onChange();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode], [data-change]');
    if (!b) return;
    if (b.dataset.mode) {
      const k = b.dataset.mode;
      // Mindestens ein Verkehrsmittel bleibt an
      if (prefs.modes[k] && Object.values(prefs.modes).filter(Boolean).length === 1) return;
      prefs.modes[k] = !prefs.modes[k];
    } else prefs.change = Number(b.dataset.change);
    save(); paint(); mark(); onChange();
  });
  return { mark };
}
