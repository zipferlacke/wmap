/**
 * Mitmachen bei OpenStreetMap: Fragen nach der Fahrt, OSM-Anmeldung.
 */
import { local } from '../data/store.js';
import { ask, toast } from '../ui/dialogs.js';
import { SurveyView } from '../osm/survey-ui.js';
import { contribute, trace } from '../data/trace.js';
import { alongMap } from './ask-along.js';
import { finishLogin } from '../osm/api.js';
import { clearCategory } from './category.js';
import { $, CAR, SIMULATING, geolocate, map } from './core.js';
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

const FROM_CAR = 'wmap.survey.fromCar';
const offer = (n) => toast(`${n} ${n === 1 ? 'kurze Frage' : 'kurze Fragen'} zu deinem Weg`, { action: { label: 'Ansehen', run: () => openSurvey() } });

/**
 * Nach einer Fahrt: Fragen suchen und anbieten. Im Auto nicht – dort lassen sie sich nicht beantworten
 * (das Auto zeigt nur seine Vorlagen); gemerkt wird, dass es welche gibt, und die App bietet sie beim
 * nächsten Start an (App und Auto teilen sich in der fertigen App den Speicher).
 */
export async function askAfterTrip() {
  const n = await survey.refresh();
  if (!n) return;
  if (CAR) local.set(FROM_CAR, Date.now()); else offer(n);
}

/** Beim ersten Navigieren einmal erklären, dass der Weg aufgezeichnet wird. */
export async function askContributeOnce() {
  // Simulation (Screenshots, Tests): nichts dazwischenschieben
  if (!contribute.get() || local.get('wmap.contribute.seen') || SIMULATING || CAR) return;
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

// Standort auch ohne Navigation (Knopf „Mein Standort“, z. B. beim Spaziergang) –
// unterwegs kommen dann auch kurze Fragen als Pille (ask-along.js)
geolocate.on('geolocate', (pos) => {
  trace.add({ point: [pos.coords.longitude, pos.coords.latitude], accuracy: pos.coords.accuracy });
  if (!SIMULATING) alongMap(pos);
});

// Rückkehr von der OSM-Anmeldung ohne Popup (Meldung: osm/login-return.js)
finishLogin().then((user) => {
  if (!user) return;
  openSurvey();
  survey.sync({ loud: true });
}).catch(() => { /* gemeldet von login-return.js */ });

// Beim Start: Liegengebliebenes hochladen und nach neuen Fragen sehen – nach einer Fahrt mit Android Auto anbieten
setTimeout(async () => {
  survey.sync();
  const n = await survey.refresh();
  if (CAR || !local.get(FROM_CAR)) return;
  local.set(FROM_CAR, null);
  if (n && !SIMULATING && !/[?&](view|q|from|to|reach|geo|ort|tour|track|action)=/.test(location.search)) offer(n);
}, 4000);
