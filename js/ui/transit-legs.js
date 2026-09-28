/**
 * Abschnitte einer Verbindung mit Bus & Bahn als Liste – direkt unter der
 * gewählten Verbindung (app.js) und bei gemerkten Verbindungen (Meine Touren).
 *
 *   Fußweg   „Zu Fuß nach …“, Zeit, Strecke, Tempo; aufgeklappt der Weg
 *   Fahrt    „Bus 91 nehmen → Roringen“, von → bis mit Steigen und Zeiten,
 *            Halte · Fahrzeit · km; aufgeklappt die Halte dazwischen
 *   Umstieg  zwischen zwei Fahrten: wie viel Zeit bleibt (knapp: orange)
 *
 * Zeiten dürfen Date oder Millisekunden sein (gemerkte Verbindungen).
 */
import { clock } from './share.js';
import { fmtDistance, esc, cumulative } from '../core/geo.js';

export const legBadge = (l) => (l.walk ? '<span class="msr leg-walk" title="Fußweg">directions_walk</span>'
  : `<span class="transit-badge" style="--c:${l.color ?? '#e8590c'}">${esc(l.line || l.product)}</span>`);
export const changesText = (x) => (x.changes ? `${x.changes} × umsteigen` : 'ohne Umsteigen');
const lateText = (min) => (min > 0 ? ` <span class="late">+${min}</span>` : '');
const minutes = (s) => `${Math.max(1, Math.round(s / 60))} min`;

/** Wie heißt das Verkehrsmittel im Satz: „Bus 91 nehmen“, „ICE 783 nehmen“ */
function vehicle(l) {
  const kind = { 5: 'Bus', 6: 'Bus', 7: 'Schnellbus', 4: 'Tram', 3: 'Stadtbahn', 2: 'U-Bahn', 1: 'S-Bahn', 9: 'Fähre', 19: 'Bürgerbus', 10: 'Rufbus', 17: 'Ersatzverkehr' }[l.cls];
  const line = l.line || l.product;
  // Züge tragen die Art schon im Namen (ICE 783, RE 2, RB 83)
  return kind && !/^[A-Za-z]{1,4}\s?\d/.test(line) ? `${kind} ${line}` : line;
}

const legMeters = (l) => l.distance || (l.coords?.length > 1 ? cumulative(l.coords).at(-1) : 0);

function walkDetail(l) {
  const steps = l.steps?.length ? l.steps : [{ text: `Zu Fuß nach ${l.to}`, distance: l.distance }];
  return `<ol class="leg-steps">${steps.map((x) => `<li>${esc(x.text)}${x.distance ? ` <small>${fmtDistance(x.distance)}</small>` : ''}</li>`).join('')}</ol>`;
}

function rideDetail(l) {
  const n = l.stopList?.length ?? 0;
  return `<ol class="leg-stops">${(l.stopList ?? []).map((x, i) => `<li class="${i === 0 || i === n - 1 ? 'end' : ''}">
    <time>${x.time ? clock(x.time) : ''}</time><span>${esc(x.name)}</span>${x.platform && (i === 0 || i === n - 1) ? `<small>Steig ${esc(x.platform)}</small>` : ''}</li>`).join('')}</ol>`;
}

/**
 * @param t       transit-Teil der Route bzw. gemerkte Verbindung ({ legs })
 * @param open    Nummer des aufgeklappten Abschnitts oder null
 * @param change  gewünschte Umsteigezeit (min) – darunter gilt es als knapp
 */
export function transitLegsHtml(t, open = null, change = 5) {
  let prev = null;
  return t.legs.map((l, i) => {
    const gap = !l.walk && prev ? Math.round((l.dep - prev.arr) / 60000) : null;
    const at = prev?.to;
    if (!l.walk) prev = l;
    const secs = (l.arr - l.dep) / 1000 || l.duration;
    const m = legMeters(l);
    let title, sub;
    if (l.walk) {
      const speed = m && secs > 60 ? ` · ${(m / secs * 3.6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km/h` : '';
      title = `Zu Fuß nach ${l.to}`;
      sub = `${minutes(secs)}${m ? ` · ${fmtDistance(m)}` : ''}${speed}`;
    } else {
      title = `${vehicle(l)} nehmen${l.to_ ? ` → ${l.to_}` : ''}`;
      sub = `${l.from}${l.platform ? ` (Steig ${l.platform})` : ''} → ${l.to}${l.platformTo ? ` (Steig ${l.platformTo})` : ''}, an ${clock(l.arr)}`;
    }
    const facts = l.walk ? '' : `<small class="leg-facts">${l.stops} ${l.stops === 1 ? 'Halt' : 'Halte'} · ${minutes(secs)}${m ? ` · ${fmtDistance(m)}` : ''}</small>`;
    return `${gap !== null ? `<li class="leg-change${gap < change ? ' tight' : ''}"><span class="msr">transfer_within_a_station</span> ${gap} min zum Umsteigen${at ? ` in ${esc(at)}` : ''}</li>` : ''}
    <li class="leg${l.walk ? ' walk' : ''}${open === i ? ' open' : ''}" data-leg="${i}" style="--c:${l.walk ? 'var(--muted)' : (l.color ?? '#e8590c')}">
      <button type="button" class="leg-head" aria-expanded="${open === i}">
        <time>${clock(l.dep)}${lateText(l.delay)}</time>${legBadge(l)}
        <span class="sg-text"><strong>${esc(title)}</strong><small>${esc(sub)}</small>${facts}</span>
        <span class="msr leg-more">expand_more</span>
      </button>
      <div class="leg-detail"${open === i ? '' : ' hidden'}>${l.walk ? walkDetail(l) : rideDetail(l)}</div>
    </li>`;
  }).join('');
}
