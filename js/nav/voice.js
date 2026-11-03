/**
 * Ansagen und Hinweise ohne Straßennamen: „Rechts abbiegen Richtung Kassel“,
 * auf Autobahn und Bundesstraße mit Nummer („Auf die A 7 Richtung Hannover“).
 * Straßennamen sind vorgelesen schwer zu verstehen und am Schild selten zu
 * sehen – Richtung und Nummer stehen auf den Wegweisern.
 *
 * Grundlage sind Valhallas Manöver (type, sign, roundabout_exit_count) und
 * die Zusatzdaten aus nav/extras.js (Spuren, Ampeln, Wegweiser).
 */
import { lanesAt, destAt, signalBefore } from './extras.js';
import { t } from '../core/i18n.js';

const ORDINAL = ['', t('nav.voice.ordinal.first'), t('nav.voice.ordinal.second'), t('nav.voice.ordinal.third'), t('nav.voice.ordinal.fourth'),
  t('nav.voice.ordinal.fifth'), t('nav.voice.ordinal.sixth'), t('nav.voice.ordinal.seventh'), t('nav.voice.ordinal.eighth')];
const ACTION = {
  1: t('nav.voice.action.depart'), 2: t('nav.voice.action.depart'), 3: t('nav.voice.action.depart'),
  7: t('nav.voice.action.continue'), 8: t('nav.voice.action.continue'), 22: t('nav.voice.action.keep_straight'),
  9: t('nav.voice.action.slight_right'), 10: t('nav.voice.action.right'), 11: t('nav.voice.action.sharp_right'),
  16: t('nav.voice.action.slight_left'), 15: t('nav.voice.action.left'), 14: t('nav.voice.action.sharp_left'),
  12: t('nav.voice.action.u_turn'), 13: t('nav.voice.action.u_turn'),
  17: t('nav.voice.action.ramp.straight'), 18: t('nav.voice.action.ramp.right'), 19: t('nav.voice.action.ramp.left'),
  23: t('nav.voice.action.keep_right'), 24: t('nav.voice.action.keep_left'),
  25: t('nav.voice.action.merge'), 37: t('nav.voice.action.merge_right'), 38: t('nav.voice.action.merge_left'),
  28: t('nav.voice.action.ferry_on'), 29: t('nav.voice.action.ferry_off'),
};
const BIG_ROAD = /^[AB]\s?\d+[a-z]?$/i;          // A 7, B 3, B27

const texts = (els) => (els ?? []).map((e) => e.text).filter(Boolean);
const tidyRef = (r) => r.replace(/^([AB])\s?(\d)/i, (_, a, d) => `${a.toUpperCase()} ${d}`);

/** Autobahn- und Bundesstraßennummer, auf die es geht. */
function bigRef(m) {
  const refs = [...texts(m.sign?.exit_branch_elements), ...(m.street_names ?? []), ...(m.begin_street_names ?? [])]
    .flatMap((s) => String(s).split(/[;/,]/)).map((s) => s.trim()).filter((s) => BIG_ROAD.test(s));
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
    .flatMap((s) => (s.includes(':') ? s.slice(s.indexOf(':') + 1) : s).split(/[,;]/))
    .map((s) => s.replace(/^[ABEKL]\s?\d+[a-z]?\s*/, '').trim())
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
  const type = m.type;
  if (type === 26) return t('nav.voice.action.roundabout', { nth: ORDINAL[m.roundabout_exit_count] ?? `${m.roundabout_exit_count}.` });
  if (type === 20 || type === 21) {
    const nr = texts(m.sign?.exit_number_elements)[0];
    if (type === 20) return nr ? t('nav.voice.action.exit.right_number', { nr }) : t('nav.voice.action.exit.right');
    return nr ? t('nav.voice.action.exit.left_number', { nr }) : t('nav.voice.action.exit.left');
  }
  return ACTION[type] ?? null;
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
    const side = m.type === 5 ? ` ${t('nav.voice.arrive.on_right')}` : m.type === 6 ? ` ${t('nav.voice.arrive.on_left')}` : '';
    return { now: `${t('nav.voice.arrive.now')}${side}`, soon: (d) => t('nav.voice.arrive.soon', { distance: d }), then: t('nav.voice.arrive.then') };
  }
  if (m.type === 27) return { now: null, soon: () => null, then: null };   // Ausfahrt aus dem Kreisel: schon angesagt
  const act = action(m);
  if (!act) return { now: m.verbal_pre_transition_instruction ?? null, soon: () => null, then: null };

  const ref = [17, 18, 19, 20, 21, 23, 24, 25, 37, 38, 9, 10, 11, 14, 15, 16, 26].includes(m.type) ? bigRef(m) : null;
  const dirs = toward(m, extras);
  // Kein Wegweiser und keine Nummer: der Ort, zu dem die Route führt
  if (!dirs.length && !ref && place) dirs.push(place);
  let what = act;
  if (ref && [17, 18, 19].includes(m.type)) what = m.type === 17 ? t('nav.voice.action.ramp_ref.straight', { ref }) : m.type === 18 ? t('nav.voice.action.ramp_ref.right', { ref }) : t('nav.voice.action.ramp_ref.left', { ref });
  else if (ref && m.type !== 26 && m.type !== 20 && m.type !== 21) what = t('nav.voice.onto', { action: act, ref });
  if (dirs.length) what = t('nav.voice.toward', { what, places: dirs.join(` ${t('nav.voice.and')} `) });
  // An der Ampel? Erleichtert das Finden der richtigen Kreuzung
  const atSignal = [9, 10, 11, 14, 15, 16].includes(m.type) && signalBefore(extras, m.at ?? -1e9);
  const now = cap(atSignal ? t('nav.voice.at_signal', { what }) : what) + '.';
  const hint = laneHint(lanesAt(extras, m.at ?? -1e9));

  // Direkt danach noch etwas? („…, dann links abbiegen“)
  let then = '';
  if (next && next.at - m.at < 120 && ![4, 5, 6, 27].includes(next.type)) {
    const a = action(next);
    if (a) then = t('nav.voice.then', { action: a });
  }
  return {
    now: now.replace(/\.$/, `${then}.`),
    soon: (d) => `${t('nav.voice.soon', { distance: d, what })}${hint ? ` ${hint === 'links' ? t('nav.voice.lane_left') : t('nav.voice.lane_right')}` : ''}`,
    then: what,
    hint,
    toward: dirs,
    ref,
  };
}
