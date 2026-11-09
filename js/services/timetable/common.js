/**
 * Gemeinsame Teile der Fahrplan-Anbieter (efa.js, hafas.js, trias.js): Verkehrsmittel als Produktklasse im Schema der
 * EFA (cls), Farben, Strecken und aus den Abschnitten (legs) einer Verbindung die Route, wie sie die App zeigt.
 */
import { t } from '../../core/i18n.js';

/** Züge (Buchungslink), Fernverkehr */
export const TRAINS = new Set([0, 1, 13, 14, 15, 16, 18]);
export const LONG = new Set([14, 15, 16]);

/** Farbe je Verkehrsmittel (Produktklasse) – Abzeichen und Linie auf der Karte */
export function modeColor(cls) {
  if ([14, 15, 16].includes(cls)) return '#e03131';          // Fernzug
  if ([0, 13, 18].includes(cls)) return '#495057';           // Regionalzug
  if (cls === 1) return '#2f9e44';                           // S-Bahn
  if (cls === 2) return '#1971c2';                           // U-Bahn
  if ([3, 4, 8].includes(cls)) return '#9c36b5';             // Stadtbahn, Tram, Seilbahn
  if (cls === 9) return '#1098ad';                           // Schiff
  return '#e8590c';                                          // Bus und Rest
}

export const cum = (c) => { const out = [0]; for (let i = 1; i < c.length; i += 1) { const [a, b] = [c[i - 1], c[i]]; const k = Math.cos((a[1] * Math.PI) / 180); out.push(out[i - 1] + Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320); } return out; };
export const bboxOf = (c) => [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
const near = (a, b, m) => !!a && !!b && cum([a, b]).at(-1) < m;

/** Gleicher Steig? Manche Kennungen nennen einen anderen Kreis („de:03159:…“ statt „de:03152:…“) */
export const samePlatform = (a, b) => !!a && !!b && a.split(':').slice(2).join(':') === b.split(':').slice(2).join(':');

/**
 * Schleifen herausnehmen: Wartezeit füllen die Fahrplanauskünfte manchmal mit einer Runde (Bus zum Bahnhof, dann Bus
 * und Zug zurück zum selben Bahnhof). Kommt die Verbindung dorthin zurück, wo man schon war (≤ 300 m), fällt alles
 * dazwischen weg – man wartet dort. Ein kurzer Fußweg bleibt, wenn die Stellen nicht genau gleich sind.
 */
function dropLoops(legs) {
  const start = (l) => l.coords[0], end = (l) => l.coords.at(-1);
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = legs.length - 1; j > i + 1; j -= 1) {
      if (legs[j].walk || !legs.slice(i + 1, j).some((l) => !l.walk)) continue;
      if (!near(end(legs[i]), start(legs[j]), 300)) continue;
      const gap = cum([end(legs[i]), start(legs[j])]).at(-1);
      const walk = gap > 30 ? [{
        walk: true, cls: null, line: '', product: '', to_: '',
        from: legs[i].to, to: legs[j].from, dep: legs[i].arr, arr: new Date(+legs[i].arr + Math.max(60, gap / 1.2) * 1000),
        planned: legs[i].arr, plannedArr: legs[j].dep, delay: null, platform: '', platformTo: legs[j].platform,
        stops: 0, stopList: [], steps: [], distance: Math.round(gap), duration: Math.round(Math.max(60, gap / 1.2)),
        coords: [end(legs[i]), start(legs[j])], course: null,
      }] : [];
      return dropLoops([...legs.slice(0, i + 1), ...walk, ...legs.slice(j)]);
    }
  }
  return legs;
}

/**
 * Buchen bei der Bahn, wenn Züge dabei sind: Suche auf bahn.de mit erstem und letztem Bahnhof und der Abfahrt. Reine
 * Bus- und Tramfahrten brauchen kein eigenes Ticket (Verbund, Deutschlandticket) – dann kein Link.
 */
function bookingLink(rides) {
  const trains = rides.filter((l) => TRAINS.has(l.cls));
  if (!trains.length) return null;
  const a = trains[0], b = trains.at(-1);
  const d = a.planned, pad = (n) => String(n).padStart(2, '0');
  const hd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  return `https://www.bahn.de/buchung/fahrplan/suche#sts=true&so=${encodeURIComponent(a.from)}&zo=${encodeURIComponent(b.to)}&kl=2&r=13:16:KLASSENLOS:1&hd=${hd}&hza=D&ar=false&s=true&d=false&fm=false&bp=false`;
}

/**
 * Abschnitte eines Anbieters → Route wie getRoutes, dazu `transit` { src, dep, arr, legs, buffer, changes, key,
 * booking }; null ohne Strecke. Fußwege heißen „Fußweg“, jeder Abschnitt bekommt Farbe und `long` (Fernverkehr).
 */
export function buildRoute(raw, src) {
  const legs = dropLoops(raw.filter((l) => l.coords?.length)).map((l) => ({
    ...l, color: l.walk ? null : modeColor(l.cls), long: LONG.has(l.cls),
    product: l.walk ? t('services.departures.walk.title') : l.product,
  }));
  const coords = legs.flatMap((l) => l.coords);
  if (coords.length < 2) return null;
  const rides = legs.filter((l) => !l.walk);
  // Knappste Umsteigezeit: Ankunft der einen bis Abfahrt der nächsten Fahrt
  let buffer = Infinity;
  for (let i = 1; i < rides.length; i += 1) buffer = Math.min(buffer, (rides[i].dep - rides[i - 1].arr) / 60000);
  const c = cum(coords);
  const dep = legs[0].dep, arr = legs.at(-1).arr;
  return {
    coords, cum: c, length: c.at(-1), time: (arr - dep) / 1000, bounds: bboxOf(coords),
    elevation: [], ascent: 0, descent: 0, maneuvers: [],
    transit: {
      src, dep, arr, legs, buffer,
      changes: Math.max(0, rides.length - 1),
      key: legs.map((l) => `${l.line}@${+l.dep}`).join('|'),
      booking: bookingLink(rides),
    },
  };
}

/**
 * Aus allen Verbindungen die gezeigten: nur passende Zeiten (sonst alle), die beste (fastest) und alle mit genug
 * Umsteigezeit (relaxed), nach Abfahrt; bei „Ankunft bis“ die letzten sechs, sonst die ersten sechs.
 */
export function pickJourneys(all, { when, arrive, change, fastest }) {
  const fits = all.filter((r) => (arrive ? r.transit.arr <= +when + 60000 : r.transit.dep >= +when - 60000));
  const pool = fits.length ? fits : all;
  // Beste: bei „Abfahrt ab“ die früheste Ankunft, bei „Ankunft bis“ die späteste Abfahrt
  pool.sort((a, b) => (arrive ? b.transit.dep - a.transit.dep : a.transit.arr - b.transit.arr) || a.transit.changes - b.transit.changes);
  const best = pool[0];
  best.transit.fastest = true;
  const relaxed = pool.filter((r) => r.transit.buffer >= change);
  relaxed.forEach((r) => { r.transit.relaxed = true; });
  const byDep = [...(fastest || !relaxed.length ? [best] : []), ...relaxed.filter((r) => r !== best)]
    .sort((a, b) => a.transit.dep - b.transit.dep);
  const list = arrive ? byDep.slice(-6) : byDep.slice(0, 6);
  list.forEach((r, id) => { r.id = id; });
  return list;
}

/** Stück einer Linie zwischen den Stellen, die a und b am nächsten liegen */
export function sliceBetween(line, a, b) {
  if (line.length < 2) return null;
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  let ia = 0;
  for (let i = 1; i < line.length; i += 1) if (d2(line[i], a) < d2(line[ia], a)) ia = i;
  let ib = ia;
  for (let i = ia; i < line.length; i += 1) if (d2(line[i], b) < d2(line[ib], b)) ib = i;
  if (ib <= ia) return null;
  return [a, ...line.slice(ia, ib + 1), b];
}
