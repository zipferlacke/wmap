/**
 * Ansagen und Hinweise ohne Straßennamen: „Rechts abbiegen Richtung Kassel“,
 * auf Autobahn und Bundesstraße mit Nummer („Auf die A 7 Richtung Hannover“).
 * Straßennamen sind vorgelesen schwer zu verstehen und am Schild selten zu
 * sehen – Richtung und Nummer stehen auf den Wegweisern.
 *
 * Grundlage sind Valhallas Manöver (type, sign, roundabout_exit_count) und
 * die Zusatzdaten aus nav-extras.js (Spuren, Ampeln, Wegweiser).
 */
import { lanesAt, destAt, signalBefore } from './nav-extras.js';

const ORDINAL = ['', 'erste', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste', 'siebte', 'achte'];
const BIG_ROAD = /^[AB]\s?\d+[a-z]?$/i;          // A 7, B 3, B27

const texts = (els) => (els ?? []).map((e) => e.text).filter(Boolean);
const tidyRef = (r) => r.replace(/^([AB])\s?(\d)/i, (_, a, d) => `${a.toUpperCase()} ${d}`);

/** Autobahn- und Bundesstraßennummer, auf die es geht. */
function bigRef(m) {
  const refs = [...texts(m.sign?.exit_branch_elements), ...(m.street_names ?? []), ...(m.begin_street_names ?? [])]
    .flatMap((t) => String(t).split(/[;/,]/)).map((t) => t.trim()).filter((t) => BIG_ROAD.test(t));
  return refs.length ? tidyRef(refs[0]) : null;
}

/**
 * Orte auf dem Wegweiser – aus Valhalla oder aus OSM destination. Nummern
 * („B 65“) und „B 217: Nienburg“ werden zu Orten: Die Nummer sagt bigRef.
 */
function toward(m, extras) {
  let list = texts(m.sign?.exit_toward_elements);
  if (!list.length) list = [destAt(extras, m.at ?? -1e9) ?? ''];
  const places = list
    .flatMap((t) => (t.includes(':') ? t.slice(t.indexOf(':') + 1) : t).split(/[,;]/))
    .map((t) => t.replace(/^[ABEKL]\s?\d+[a-z]?\s*/, '').trim())
    .filter(Boolean);
  return [...new Set(places)].slice(0, 2);
}

/** Welche Seite ist gefragt? Nur wenn eindeutig: alle nutzbaren Spuren links bzw. rechts. */
export function laneHint(lanes) {
  if (!lanes || lanes.length < 2) return null;
  const use = lanes.map((l) => l.use);
  if (!use.some(Boolean) || use.every(Boolean)) return null;
  const first = use.indexOf(true), last = use.lastIndexOf(true);
  if (last < lanes.length / 2) return 'links';
  if (first >= lanes.length / 2) return 'rechts';
  return null;
}

/** Kern der Anweisung: „rechts abbiegen“, „die zweite Ausfahrt nehmen“ … */
function action(m) {
  const t = m.type;
  if (t === 26) return `im Kreisverkehr die ${ORDINAL[m.roundabout_exit_count] ?? `${m.roundabout_exit_count}.`} Ausfahrt nehmen`;
  if (t === 20 || t === 21) {
    const nr = texts(m.sign?.exit_number_elements)[0];
    return `${t === 20 ? 'rechts' : 'links'} ${nr ? `die Ausfahrt ${nr}` : 'die Ausfahrt'} nehmen`;
  }
  return {
    1: 'losfahren', 2: 'losfahren', 3: 'losfahren',
    7: 'geradeaus weiterfahren', 8: 'geradeaus weiterfahren', 22: 'geradeaus halten',
    9: 'leicht rechts abbiegen', 10: 'rechts abbiegen', 11: 'scharf rechts abbiegen',
    16: 'leicht links abbiegen', 15: 'links abbiegen', 14: 'scharf links abbiegen',
    12: 'wenden', 13: 'wenden',
    17: 'geradeaus auf die Auffahrt', 18: 'rechts auf die Auffahrt', 19: 'links auf die Auffahrt',
    23: 'rechts halten', 24: 'links halten',
    25: 'einfädeln', 37: 'rechts einfädeln', 38: 'links einfädeln',
    28: 'auf die Fähre fahren', 29: 'die Fähre verlassen',
  }[t] ?? null;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Sätze zu einem Manöver.
 * → { now, soon(dist), then } – `now` kurz davor, `soon` für die frühe Ansage
 *   („In 500 Metern …“), `then` als Anhängsel für ein direkt folgendes Manöver
 * @param place  Ort ohne Wegweiser (von der Navigation nachgeschlagen)
 */
export function phrases(m, { extras = null, next = null, place = null } = {}) {
  if ([4, 5, 6].includes(m.type)) {
    const side = m.type === 5 ? ' Es liegt rechts.' : m.type === 6 ? ' Es liegt links.' : '';
    return { now: `Sie haben Ihr Ziel erreicht.${side}`, soon: (d) => `In ${d} erreichen Sie Ihr Ziel.`, then: 'dann erreichen Sie Ihr Ziel' };
  }
  if (m.type === 27) return { now: null, soon: () => null, then: null };   // Ausfahrt aus dem Kreisel: schon angesagt
  const act = action(m);
  if (!act) return { now: m.verbal_pre_transition_instruction ?? null, soon: () => null, then: null };

  const ref = [17, 18, 19, 20, 21, 23, 24, 25, 37, 38, 9, 10, 11, 14, 15, 16, 26].includes(m.type) ? bigRef(m) : null;
  const dirs = toward(m, extras);
  // Kein Wegweiser und keine Nummer: der Ort, zu dem die Route führt
  if (!dirs.length && !ref && place) dirs.push(place);
  let what = act;
  if (ref && [17, 18, 19].includes(m.type)) what = `${act.replace(' auf die Auffahrt', '')} auf die ${ref} auffahren`.replace(/^geradeaus /, '');
  else if (ref && m.type !== 26 && m.type !== 20 && m.type !== 21) what = `${act} auf die ${ref}`;
  if (dirs.length) what += ` Richtung ${dirs.join(' und ')}`;
  // An der Ampel? Erleichtert das Finden der richtigen Kreuzung
  const atSignal = [9, 10, 11, 14, 15, 16].includes(m.type) && signalBefore(extras, m.at ?? -1e9);
  const now = cap(`${atSignal ? 'an der Ampel ' : ''}${what}`) + '.';
  const hint = laneHint(lanesAt(extras, m.at ?? -1e9));

  // Direkt danach noch etwas? („…, dann links abbiegen“)
  let then = '';
  if (next && next.at - m.at < 120 && ![4, 5, 6, 27].includes(next.type)) {
    const a = action(next);
    if (a) then = `, dann ${a}`;
  }
  return {
    now: now.replace(/\.$/, `${then}.`),
    soon: (d) => `In ${d} ${what}.${hint ? ` Bitte ${hint} einordnen.` : ''}`,
    then: what,
    hint,
    toward: dirs,
    ref,
  };
}
