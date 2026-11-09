/**
 * Fahrplan für Bus & Bahn aus drei Quellen: EFA der NVBW (efa.js, offen), RMV (hafas.js) und TRIAS der EFA-BW
 * (trias.js, beide über den WMap-Server mit Schlüssel). Alle kennen ganz Deutschland und liefern dasselbe Format.
 *
 *   Auswahl     je Anfrage ein Anbieter per Zufall unter denen, die das Gebiet kennen (covers(point), der RMV nur in
 *               Hessen); scheitert er (Fehler, keine Haltestelle, keine Verbindung), der nächste; ein gescheiterter hat
 *               PAUSE_MS Pause (alle in Pause: alle in Zufallsfolge)
 *   Zuordnung   Abfahrten und Verbindungen tragen `src`; Verlauf einer Fahrt und frühere Abfahrten fragen denselben
 *               Anbieter (dessen Kennungen gelten nur dort), stopId lautet „<anbieter>|<kennung>“
 *
 *   departures(point, o)      → { stop, stopId, src, list: [{ time, delay, line, product, cls, color, to, platform,
 *                                 platformId, platformPoint, cancelled, course, src, key }] }
 *   tripCourse(dep)           → { coords, stops, index } – Verlauf der Fahrt einer Abfahrt
 *   journeys(from, to, o)     → Routen wie getRoutes mit `transit` (timetable/common.js buildRoute, pickJourneys)
 *   refineJourney(route)      echten Verlauf der gewählten Verbindung nachladen
 */
import * as efa from './efa.js';
import * as rmv from './hafas.js';
import * as trias from './trias.js';
import { buildRoute, cum, bboxOf, modeColor, pickJourneys, sliceBetween } from './common.js';
import { segment } from '../routing.js';
import { served } from '../usage.js';
import { t } from '../../core/i18n.js';

export { samePlatform } from './common.js';

const PROVIDERS = [efa, rmv, trias];
const PAUSE_MS = 10 * 60 * 1000;
const resting = new Map();            // Anbieter → Pause bis (ms)

const byId = (id) => PROVIDERS.find((p) => p.id === id) ?? null;

/** Anbieter für die Punkte in Zufallsfolge, die in Pause hinten; `first` (Kennung) vorn */
function order(points, first = null) {
  const list = PROVIDERS.filter((p) => !p.covers || points.some((x) => p.covers(x)));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const now = Date.now();
  const rank = (p) => (p.id === first ? -1 : resting.get(p.id) > now ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b));
}

const aborted = (err, signal) => err?.name === 'AbortError' || signal?.aborted;

/**
 * fn(anbieter) der Reihe nach, bis einer etwas liefert (nicht null) → { p, r }. Mit `feature` gezählt, wer es
 * geliefert hat und wie schnell bzw. wer scheiterte (services/usage.js served).
 */
async function first(list, fn, signal, feature = null) {
  let last = null;
  for (const p of list) {
    const t0 = performance.now();
    try {
      const r = await fn(p);
      if (r) {
        resting.delete(p.id);
        served(feature, p.id, true, performance.now() - t0);
        return { p, r };
      }
    } catch (err) {
      if (aborted(err, signal)) throw new DOMException('Abgebrochen', 'AbortError');
      last = err;
    }
    served(feature, p.id, false);
    resting.set(p.id, Date.now() + PAUSE_MS);
  }
  if (last) throw last;
  return null;
}

/* ── Abfahrten ─────────────────────────────────────────────────────────── */

const tag = (p, list) => list.map((d) => ({ ...d, src: p.id, color: modeColor(d.cls), key: `${p.id}|${d.line}|${d.to}|${+d.time}` }));

/**
 * Abfahrten an der Haltestelle bei `point` (Optionen wie efa.js departures). Mit stopId aus einer früheren Antwort
 * zuerst derselbe Anbieter.
 */
export async function departures(point, { stopId = null, signal, ...o } = {}) {
  const [src, id] = stopId ? String(stopId).split(/\|(.*)/s) : [null, null];
  const got = await first(order([point], src), async (p) => {
    const r = await p.departures(point, { ...o, signal, stopId: p.id === src ? id : null });
    return r?.stopId ? r : null;
  }, signal, o.feature);
  if (!got) return { stop: null, stopId: null, src: null, list: [] };
  const { p, r } = got;
  return { stop: r.stop, stopId: `${p.id}|${r.stopId}`, src: p.id, list: tag(p, r.list) };
}

/** Verlauf der Fahrt einer Abfahrt bzw. eines Abschnitts – beim Anbieter, von dem sie stammt */
export async function tripCourse(dep, opts = {}) {
  const p = byId(dep.src);
  if (!p || !dep.course) throw new Error(t('services.departures.error.no_course'));
  return p.tripCourse(dep, opts);
}

/* ── Verbindungen ──────────────────────────────────────────────────────── */

/**
 * Verbindungen mit Bus und Bahn → Routen wie getRoutes, dazu `transit`:
 *   { src, dep, arr, changes, buffer, booking, fastest, relaxed,
 *     legs: [{ walk, line, product, cls, color, from, to, dep, arr, platform, stops, stopList, steps, course }] }
 *
 * Zwei Anfragen beim selben Anbieter zugleich – normal und mit mehr Zeit zum Umsteigen –, damit auch Verbindungen
 * mit mehr Luft dabei sind; Auswahl in common.js pickJourneys.
 * @param o.when     Abfahrt ab bzw. Ankunft bis (Date), sonst jetzt
 * @param o.arrive   true: `when` ist die Ankunft bis
 * @param o.classes  erlaubte Produktklassen (ui/route-prefs.js transitClasses), null: alle
 * @param o.change   Umsteigezeit mindestens, Minuten
 * @param o.fastest  schnellste Verbindung zusätzlich zeigen
 * @param o.src      zuerst dieser Anbieter (frühere Verbindungen zur selben Liste)
 */
export async function journeys(from, to, { when = new Date(), arrive = false, classes = null, change = 0, fastest = true, src = null, signal, feature = null } = {}) {
  const got = await first(order([from, to], src), async (p) => {
    const ask = (slow) => p.trips(from, to, { when, arrive, classes, slow, signal, feature });
    const answers = await Promise.allSettled([ask(false), change > 5 ? ask(true) : Promise.resolve([])]);
    if (answers[0].status === 'rejected') throw answers[0].reason;
    const all = [];
    for (const a of answers) {
      for (const legs of a.value ?? []) {
        const r = buildRoute(legs, p.id);
        if (r && !all.some((x) => x.transit.key === r.transit.key)) all.push(r);
      }
    }
    return all.length ? all : null;
  }, signal, feature);
  if (!got) throw new Error(t('services.departures.error.no_connection'));
  return pickJourneys(got.r, { when, arrive, change, fastest });
}

/**
 * Echten Verlauf der Abschnitte nachladen – nur für die gewählte Verbindung:
 *   Fahrt    Verlauf der ganzen Fahrt beim selben Anbieter (tripCourse), davon das Stück zwischen Ein- und Ausstieg
 *   Fußweg   über das Fußgänger-Routing, samt Wegbeschreibung
 * Scheitert etwas, bleibt der Abschnitt von Halt zu Halt.
 * → true, wenn sich etwas geändert hat
 */
export async function refineJourney(route, { signal, feature = null } = {}) {
  if (route.refined) return false;
  route.refined = true;
  const p = byId(route.transit.src);
  let changed = false;
  await Promise.all(route.transit.legs.map(async (l) => {
    if (l.coords.length < 2) return;
    const a = l.coords[0], b = l.coords.at(-1);
    try {
      if (l.walk) {
        if (cum([a, b]).at(-1) < 30) return;
        const w = await segment(a, b, 'foot', { signal, feature });
        l.coords = w.coords;
        l.steps = w.maneuvers.filter((m) => ![1, 2, 3, 4, 5, 6].includes(m.type))
          .map((m) => ({ text: m.instruction, distance: Math.round((m.length ?? 0) * 1000) }));
        l.distance = Math.round(w.length);
        changed = true;
      } else if (p && l.course) {
        const c = await p.tripCourse(l, { signal, feature });
        const part = sliceBetween(c.coords, a, b);
        // Nur, wenn es plausibel ist (nicht viel länger als von Halt zu Halt)
        if (part && cum(part).at(-1) < 2.5 * Math.max(cum(l.coords).at(-1), l.distance || 0, 2000)) {
          l.coords = part;
          changed = true;
        }
      }
    } catch { /* bleibt von Halt zu Halt */ }
  }));
  if (!changed) return false;
  route.coords = route.transit.legs.flatMap((l) => l.coords);
  route.cum = cum(route.coords);
  route.length = route.cum.at(-1);
  route.bounds = bboxOf(route.coords);
  return true;
}
