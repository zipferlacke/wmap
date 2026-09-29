/**
 * Mitmachen bei OpenStreetMap: Fragen nach der Fahrt, OSM-Anmeldung.
 */
import { local } from '../data/store.js';
import { ask, toast } from '../ui/dialogs.js';
import { SurveyView } from '../osm/survey-ui.js';
import { contribute, trace } from '../data/trace.js';
import { finishLogin } from '../osm/api.js';
import { clearCategory } from './category.js';
import { $, SIMULATING, geolocate, map } from './core.js';
import { clearPlace } from './place.js';
import { clearReach } from './reach.js';
import { leaveRouteMode } from './route-plan.js';
import { openSheet, remember } from './views.js';

/* ══════════════════════════════════════════════════════════════════════════
   Mitmachen bei OpenStreetMap
   ══════════════════════════════════════════════════════════════════════════ */

// Nicht im Menü: erreichbar über die Übersicht (?action=survey) und den Hinweis nach einer Fahrt
export const survey = new SurveyView($('[data-view="survey"]'), { map, toast });

export function openSurvey({ push = true } = {}) {
  leaveRouteMode();
  clearPlace();
  clearCategory();
  clearReach();
  if (push) remember('survey', () => openSurvey({ push: false }));
  openSheet('survey');
  survey.render();
  survey.refresh();
}

/** Nach einer Fahrt: Fragen suchen und anbieten. */
export async function askAfterTrip() {
  const n = await survey.refresh();
  if (n) toast(`${n} ${n === 1 ? 'kurze Frage' : 'kurze Fragen'} zu deinem Weg`, { action: { label: 'Ansehen', run: () => openSurvey() } });
}

/** Beim ersten Navigieren einmal erklären, dass der Weg aufgezeichnet wird. */
export async function askContributeOnce() {
  // Simulation (Screenshots, Tests): nichts dazwischenschieben
  if (!contribute.get() || local.get('wmap.contribute.seen') || SIMULATING) return;
  local.set('wmap.contribute.seen', true);
  const v = await ask({
    icon: 'volunteer_activism', title: 'Mitmachen bei OpenStreetMap',
    text: 'WMap merkt sich deinen Weg auf diesem Gerät und stellt dir danach kurze Fragen – etwa, ob der '
      + 'Parkplatz etwas kostet oder die Bäckerei noch so geöffnet hat. Deine Antworten verbessern die Karte '
      + 'für alle. Die Aufzeichnung verlässt das Gerät nicht und lässt sich in den Einstellungen abschalten.',
    buttons: [{ value: 'no', label: 'Nicht aufzeichnen' }, { value: 'yes', label: 'Einverstanden', primary: true }],
  });
  if (v === 'no') contribute.set(false);
}

// Standort auch ohne Navigation (Knopf „Mein Standort“, z. B. beim Spaziergang)
geolocate.on('geolocate', (pos) => trace.add({
  point: [pos.coords.longitude, pos.coords.latitude], accuracy: pos.coords.accuracy,
}));

// Rückkehr von der OSM-Anmeldung ohne Popup (Meldung: osm/login-return.js)
finishLogin().then((user) => {
  if (!user) return;
  openSurvey();
  survey.sync({ loud: true });
}).catch(() => { /* gemeldet von login-return.js */ });

// Beim Start: Liegengebliebenes hochladen und nach neuen Fragen sehen
setTimeout(() => { survey.sync(); survey.refresh(); }, 4000);
