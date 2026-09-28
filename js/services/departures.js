/**
 * Fahrplan über die EFA der NVBW (EFA-BW): Abfahrten an einer Haltestelle und
 * Verbindungen von A nach B mit Bus und Bahn. Sie kennt die Fahrpläne in ganz
 * Deutschland (DELFI), mit Echtzeit, wo die Verkehrsbetriebe sie liefern, und
 * darf ohne Schlüssel aus dem Browser gefragt werden.
 *
 *   Haltestelle   aus dem IFOPT-Schlüssel des OSM-Steigs („de:03152:33853::B“
 *                 → Haltestelle „de:03152:33853“), sonst die nächste in
 *                 300 m um den Punkt, gleicher Name bevorzugt
 *   Steig         die EFA nennt ihre Steige mit demselben Schlüssel – so
 *                 lassen sich die Abfahrten dieser Seite herausfiltern
 *
 * Verbindungen kommen erst ohne Verlauf und Fußweg-Texte (genC/genP = 0:
 * rund 3 s statt 9 s, ein Drittel der Daten) – auf der Karte zunächst von
 * Halt zu Halt. Den echten Verlauf lädt refineJourney() nur für die
 * gewählte Verbindung nach: je Fahrt aus dem Fahrplan, Fußwege über das
 * Fußgänger-Routing.
 */
import { segment } from './routing.js';

const EFA = 'https://www.efa-bw.de/nvbw/';
const COORD = 'WGS84[dd.ddddd]';

async function efa(path, params, signal) {
  const res = await fetch(`${EFA}${path}?${new URLSearchParams({ outputFormat: 'rapidJSON', ...params })}`, { signal });
  if (!res.ok) throw new Error(`Fahrplan antwortet mit ${res.status}`);
  return res.json();
}

/** Haltestelle der EFA zum Punkt → Kennung oder null */
async function stopNear([lon, lat], name, signal) {
  const d = await efa('XML_COORD_REQUEST', {
    coord: `${lon.toFixed(5)}:${lat.toFixed(5)}:${COORD}`, coordOutputFormat: COORD,
    inclFilter: '1', type_1: 'STOP', radius_1: '300', max: '8',
  }, signal);
  const list = d.locations ?? [];
  const low = (name ?? '').toLowerCase();
  return (low && list.find((l) => l.name?.toLowerCase().includes(low)))?.id ?? list[0]?.id ?? null;
}

/** Gleicher Steig? Die EFA nennt manche Steige mit anderem Kreis („de:03159:…“ statt „de:03152:…“) */
export const samePlatform = (a, b) => !!a && !!b && a.split(':').slice(2).join(':') === b.split(':').slice(2).join(':');

/**
 * Nächste Abfahrten → { stop, list: [{ time, delay, line, product, cls, to, platform, platformId, platformPoint, cancelled }] }
 * @param o.ifopt  IFOPT des angetippten Steigs (OSM „ref:IFOPT“), wenn bekannt
 */
export async function departures(point, { name = '', ifopt = '', limit = 40, signal } = {}) {
  const parts = ifopt.split(':');
  const fromIfopt = parts.length >= 3 && parts[0] === 'de' ? parts.slice(0, 3).join(':') : null;
  const ask = (stop) => efa('XML_DM_REQUEST', {
    name_dm: stop, type_dm: 'any', mode: 'direct', useRealtime: '1', limit: String(limit), depType: 'stopEvents',
    coordOutputFormat: COORD,
  }, signal);
  let stop = fromIfopt ?? await stopNear(point, name, signal);
  if (!stop) return { stop: null, list: [] };
  let d = await ask(stop);
  // Der IFOPT aus OSM passt nicht immer zur EFA (anderer Kreis) – dann über die Lage
  if (!d.stopEvents?.length && fromIfopt) {
    stop = await stopNear(point, name, signal);
    if (stop) d = await ask(stop);
  }
  const list = (d.stopEvents ?? []).map((e) => {
    const t = e.transportation ?? {};
    const planned = new Date(e.departureTimePlanned);
    const est = e.departureTimeEstimated ? new Date(e.departureTimeEstimated) : null;
    const train = t.properties?.trainType;
    const cls = t.product?.class ?? null;
    return {
      time: planned,
      delay: est ? Math.round((est - planned) / 60000) : null,
      line: t.disassembledName ?? (train ? `${train} ${t.properties?.trainNumber ?? ''}`.trim() : null) ?? t.number ?? t.name ?? '',
      product: t.product?.name ?? '',
      cls, color: modeColor(cls),
      to: t.destination?.name ?? '',
      platform: e.location?.properties?.platformName ?? e.location?.properties?.platform ?? e.location?.disassembledName ?? '',
      platformId: e.location?.id ?? '',
      // Lage des Steigs – daran erkennt WMap die Seite, die angetippt wurde
      platformPoint: e.location?.coord ? [e.location.coord[1], e.location.coord[0]] : null,
      cancelled: !!e.isCancelled,
      // Für den Verlauf dieser Fahrt (tripCourse)
      lineId: t.id ?? '', tripCode: t.properties?.tripCode ?? null,
    };
  }).filter((x) => !Number.isNaN(+x.time));
  return { stop: d.locations?.[0]?.name ?? stop, list };
}

/**
 * Verlauf einer Fahrt aus den Abfahrten: Linie auf der Karte und alle Halte
 * mit Zeiten – eine Anfrage, rund ⅕ s, ohne OpenStreetMap.
 * → { coords: [[lon, lat]], stops: [{ name, point, time, platform, id }], index }
 *   index: dieser Halt in der Folge (−1, wenn nicht gefunden)
 */
export async function tripCourse(dep, { signal } = {}) {
  if (!dep.lineId || dep.tripCode === null) throw new Error('Kein Verlauf bekannt');
  const pad = (n) => String(n).padStart(2, '0');
  const t = dep.time;
  const d = await efa('XML_STOPSEQCOORD_REQUEST', {
    coordOutputFormat: COORD, line: dep.lineId, stop: dep.platformId, tripCode: String(dep.tripCode),
    date: `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`, time: `${pad(t.getHours())}${pad(t.getMinutes())}`,
    tStOTType: 'all', useRealtime: '1',
  }, signal);
  const leg = d.leg;
  if (!leg?.stopSequence?.length) throw new Error('Kein Verlauf bekannt');
  const stops = leg.stopSequence.map((x) => {
    const tm = x.departureTimeEstimated ?? x.departureTimePlanned ?? x.arrivalTimeEstimated ?? x.arrivalTimePlanned;
    return {
      id: x.id ?? '', name: x.parent?.name ?? x.name ?? '', time: tm ? new Date(tm) : null,
      platform: x.properties?.platform ?? '', point: x.coord ? [x.coord[1], x.coord[0]] : null,
    };
  });
  const index = stops.findIndex((x) => samePlatform(x.id, dep.platformId) || samePlatform(x.id.split('::')[0], dep.platformId.split('::')[0]));
  return { coords: (leg.coords ?? []).map(([lat, lon]) => [lon, lat]), stops, index };
}

/* ── Verbindungen von A nach B ──────────────────────────────────────────── */

const cum = (c) => { const out = [0]; for (let i = 1; i < c.length; i += 1) { const [a, b] = [c[i - 1], c[i]]; const k = Math.cos((a[1] * Math.PI) / 180); out.push(out[i - 1] + Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320); } return out; };
const bboxOf = (c) => [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
const WALK = /footpath|fußweg|walk/i;

const TURN = {
  LEFT: 'links', RIGHT: 'rechts', SLIGHT_LEFT: 'halb links', SLIGHT_RIGHT: 'halb rechts',
  SHARP_LEFT: 'scharf links', SHARP_RIGHT: 'scharf rechts', STRAIGHT: 'geradeaus', UTURN: 'wenden',
};
const TRAINS = new Set([0, 1, 13, 14, 15, 16, 18]);

/** Farbe je Verkehrsmittel (EFA-Produktklasse) – Abzeichen und Linie auf der Karte */
function modeColor(cls) {
  if ([14, 15, 16].includes(cls)) return '#e03131';          // Fernzug
  if ([0, 13, 18].includes(cls)) return '#495057';           // Regionalzug
  if (cls === 1) return '#2f9e44';                           // S-Bahn
  if (cls === 2) return '#1971c2';                           // U-Bahn
  if ([3, 4, 8].includes(cls)) return '#9c36b5';             // Stadtbahn, Tram, Seilbahn
  if (cls === 9) return '#1098ad';                           // Schiff
  return '#e8590c';                                          // Bus und Rest
}
const LONG = new Set([14, 15, 16]);

/** Fußweg-Beschreibung der EFA → [{ text, distance }] (gleiche Richtung ohne Namen zusammengefasst) */
function walkSteps(l) {
  const out = [];
  for (const p of l.pathDescriptions ?? []) {
    if (/ORIGIN|DESTINATION/.test(p.manoeuvre ?? '')) continue;
    const turn = p.manoeuvre === 'TURN' || /LEFT|RIGHT|UTURN/.test(p.turnDirection ?? '') ? TURN[p.turnDirection] : null;
    const name = (p.name ?? '').trim();
    const text = turn && name ? `${turn[0].toUpperCase()}${turn.slice(1)} in ${name}` : turn ? `${turn[0].toUpperCase()}${turn.slice(1)} abbiegen` : name || 'Geradeaus';
    const last = out.at(-1);
    if (last && !name && !turn && last.text === 'Geradeaus') { last.distance += p.distance ?? 0; continue; }
    out.push({ text, distance: p.distance ?? 0 });
  }
  return out;
}

/** Halte einer Fahrt → [{ name, time, platform }] */
function stopList(l) {
  return (l.stopSequence ?? []).map((x, i, all) => {
    const t = i === all.length - 1 ? (x.arrivalTimeEstimated ?? x.arrivalTimePlanned) : (x.departureTimeEstimated ?? x.departureTimePlanned ?? x.arrivalTimePlanned);
    return {
      name: x.parent?.name ?? x.name ?? '', time: t ? new Date(t) : null, platform: x.properties?.platform ?? x.disassembledName ?? '',
      point: x.coord ? [x.coord[1], x.coord[0]] : null,
    };
  });
}

/**
 * Verlauf eines Abschnitts. Manche Fahrten liefert die EFA nur mit Start und
 * Ziel – eine Luftlinie. Dann lieber von Halt zu Halt.
 */
function legCoords(l, stops) {
  const line = (l.coords ?? []).map(([lat, lon]) => [lon, lat]);
  const pts = stops.map((s) => s.point).filter(Boolean);
  if (line.length < 3 && pts.length > line.length) return pts;
  // Ohne Verlauf und ohne Halte (Fußweg): Anfang und Ende des Abschnitts
  if (line.length < 2) {
    const p = (x) => (x?.coord ? [x.coord[1], x.coord[0]] : null);
    const ends = [p(l.origin), p(l.destination)].filter(Boolean);
    return ends.length === 2 ? ends : line;
  }
  // Kaputter Verlauf (bei FlixBus z. B. 870 km für 56 km Fahrt): viel länger
  // als die Fahrt selbst → dann von Halt zu Halt
  const len = cum(line).at(-1) ?? 0;
  const direct = pts.length > 1 ? cum(pts).at(-1) : line.length > 1 ? cum([line[0], line.at(-1)]).at(-1) : 0;
  const expect = Math.max(l.distance || 0, direct, 2000);
  if (len > 2.5 * expect) return pts.length > 1 ? pts : [line[0], line.at(-1)];
  return line;
}

const near = (a, b, m) => !!a && !!b && cum([a, b]).at(-1) < m;

/**
 * Schleifen herausnehmen: Die EFA füllt Wartezeit manchmal mit einer Runde
 * (Bus zum Bahnhof, dann Bus 220 und RB85 über Lenglern zurück zum selben
 * Bahnhof). Kommt die Verbindung dorthin zurück, wo man schon war (≤ 300 m),
 * fällt alles dazwischen weg – man wartet dort. Ein kurzer Fußweg bleibt,
 * wenn die Stellen nicht genau gleich sind.
 */
function dropLoops(legs) {
  const start = (l) => l.coords[0], end = (l) => l.coords.at(-1);
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = legs.length - 1; j > i + 1; j -= 1) {
      if (legs[j].walk || !legs.slice(i + 1, j).some((l) => !l.walk)) continue;
      if (!near(end(legs[i]), start(legs[j]), 300)) continue;
      const gap = cum([end(legs[i]), start(legs[j])]).at(-1);
      const walk = gap > 30 ? [{
        walk: true, cls: null, color: null, line: '', product: 'Fußweg', long: false, to_: '',
        from: legs[i].to, to: legs[j].from, dep: legs[i].arr, arr: new Date(+legs[i].arr + Math.max(60, gap / 1.2) * 1000),
        planned: legs[i].arr, plannedArr: legs[j].dep, delay: null, platform: '', platformTo: legs[j].platform,
        stops: 0, stopList: [], steps: [], distance: Math.round(gap), duration: Math.round(Math.max(60, gap / 1.2)),
        coords: [end(legs[i]), start(legs[j])],
      }] : [];
      return dropLoops([...legs.slice(0, i + 1), ...walk, ...legs.slice(j)]);
    }
  }
  return legs;
}

function parseJourney(j) {
  const legs = dropLoops((j.legs ?? []).map((l) => {
    const t = l.transportation ?? {};
    const cls = t.product?.class ?? null;
    const walk = !t.product || WALK.test(t.product?.name ?? '') || cls === 99 || cls === 100;
    const time = (x, k) => new Date(x?.[`${k}TimeEstimated`] ?? x?.[`${k}TimePlanned`]);
    const train = t.properties?.trainType;
    const stops = walk ? [] : stopList(l);
    return {
      walk, cls, color: modeColor(cls),
      // Fernzüge heißen „ICE 783“, die EFA hat dafür keine Kurzform
      line: walk ? '' : (t.disassembledName ?? (train ? `${train} ${t.properties?.trainNumber ?? ''}`.trim() : null) ?? t.number ?? t.name ?? ''),
      product: walk ? 'Fußweg' : (t.product?.name ?? ''),
      long: LONG.has(cls),
      to_: t.destination?.name ?? '',
      from: l.origin?.parent?.name && l.origin.type === 'platform' ? l.origin.parent.name : (l.origin?.name ?? ''),
      to: l.destination?.parent?.name && l.destination.type === 'platform' ? l.destination.parent.name : (l.destination?.name ?? ''),
      dep: time(l.origin, 'departure'), arr: time(l.destination, 'arrival'),
      planned: new Date(l.origin?.departureTimePlanned),
      plannedArr: new Date(l.destination?.arrivalTimePlanned),
      delay: l.origin?.departureTimeEstimated ? Math.round((new Date(l.origin.departureTimeEstimated) - new Date(l.origin.departureTimePlanned)) / 60000) : null,
      platform: l.origin?.properties?.platformName ?? l.origin?.properties?.platform ?? '',
      platformTo: l.destination?.properties?.platformName ?? l.destination?.properties?.platform ?? '',
      stops: Math.max(0, (l.stopSequence?.length ?? 1) - 1),
      stopList: stops,
      steps: walk ? walkSteps(l) : [],
      distance: l.distance ?? 0,
      duration: l.duration ?? 0,
      // EFA liefert [lat, lon]
      coords: legCoords(l, stops),
      // Für refineJourney: welche Fahrt, ab welchem Steig
      lineId: t.id ?? '', tripCode: t.properties?.tripCode ?? null, stopId: l.origin?.id ?? '',
    };
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
      dep, arr, legs, buffer,
      // Selbst gezählt – nach dropLoops stimmt die Zahl der EFA nicht mehr
      changes: Math.max(0, rides.length - 1),
      key: legs.map((l) => `${l.line}@${+l.dep}`).join('|'),
      booking: bookingLink(rides),
    },
  };
}

/**
 * Buchen bei der Bahn, wenn Züge dabei sind: Suche auf bahn.de mit erstem
 * und letztem Bahnhof und der Abfahrt. Reine Bus- und Tramfahrten brauchen
 * kein eigenes Ticket (Verbund, Deutschlandticket) – dann kein Link.
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
 * Verbindungen mit Bus und Bahn → Routen wie getRoutes, dazu `transit`:
 *   { dep, arr, changes, buffer, booking, fastest, relaxed,
 *     legs: [{ walk, line, product, cls, from, to, dep, arr, platform, stops, stopList, steps }] }
 *
 * Zwei Anfragen zugleich – normal und mit „langsamem Umsteigen“ –, damit
 * auch Verbindungen mit mehr Luft dabei sind. Dann:
 *   fastest   die früheste Ankunft, egal wie knapp (nur mit o.fastest)
 *   relaxed   alle, deren Umstiege mindestens o.change Minuten haben
 * @param o.when     Abfahrt ab bzw. Ankunft bis (Date), sonst jetzt
 * @param o.arrive   true: `when` ist die Ankunft bis
 * @param o.params   zusätzliche EFA-Parameter (Verkehrsmittel)
 * @param o.change   Umsteigezeit mindestens, Minuten
 * @param o.fastest  schnellste Verbindung zusätzlich zeigen
 */
export async function journeys(from, to, { when = new Date(), arrive = false, params = {}, change = 0, fastest = true, signal } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const ask = (extra) => efa('XML_TRIP_REQUEST2', {
    coordOutputFormat: COORD,
    type_origin: 'coord', name_origin: `${from[0].toFixed(5)}:${from[1].toFixed(5)}:${COORD}`,
    type_destination: 'coord', name_destination: `${to[0].toFixed(5)}:${to[1].toFixed(5)}:${COORD}`,
    itdDate: `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`,
    itdTime: `${pad(when.getHours())}${pad(when.getMinutes())}`,
    itdTripDateTimeDepArr: arrive ? 'arr' : 'dep', calcNumberOfTrips: '5', useRealtime: '1',
    // Ohne Verläufe und Fußweg-Texte – die kommen per refineJourney()
    genC: '0', genP: '0',
    ...params, ...extra,
  }, signal);
  const answers = await Promise.allSettled([ask({}), change > 5 ? ask({ changeSpeed: 'slow' }) : Promise.resolve({})]);
  if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  if (answers[0].status === 'rejected') throw answers[0].reason;
  const all = [];
  for (const a of answers) {
    for (const j of a.value?.journeys ?? []) {
      const r = parseJourney(j);
      if (r && !all.some((x) => x.transit.key === r.transit.key)) all.push(r);
    }
  }
  if (!all.length) throw new Error('Keine Verbindung mit Bus und Bahn gefunden');
  // Die EFA liefert auch Fahrten vor der gewünschten Zeit bzw. mit späterer
  // Ankunft – die gehören nicht dazu (außer es gibt sonst keine)
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
  // Ankunft bis: die letzten sechs vor der Zeit, sonst die ersten sechs ab der Zeit
  const list = arrive ? byDep.slice(-6) : byDep.slice(0, 6);
  list.forEach((r, id) => { r.id = id; });
  return list;
}

/* ── Verlauf der gewählten Verbindung nachladen ─────────────────────────── */

/** Stück einer Linie zwischen den Stellen, die a und b am nächsten liegen */
function sliceBetween(line, a, b) {
  if (line.length < 2) return null;
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  let ia = 0;
  for (let i = 1; i < line.length; i += 1) if (d2(line[i], a) < d2(line[ia], a)) ia = i;
  let ib = ia;
  for (let i = ia; i < line.length; i += 1) if (d2(line[i], b) < d2(line[ib], b)) ib = i;
  if (ib <= ia) return null;
  return [a, ...line.slice(ia, ib + 1), b];
}

/**
 * Echten Verlauf der Abschnitte nachladen – nur für die gewählte Verbindung:
 *   Fahrt    Verlauf der ganzen Fahrt aus dem Fahrplan (tripCourse, ⅕ s),
 *            davon das Stück zwischen Ein- und Ausstieg
 *   Fußweg   über das Fußgänger-Routing, samt Wegbeschreibung
 * Scheitert etwas, bleibt der Abschnitt von Halt zu Halt.
 * → true, wenn sich etwas geändert hat
 */
export async function refineJourney(route, { signal } = {}) {
  if (route.refined) return false;
  route.refined = true;
  let changed = false;
  await Promise.all(route.transit.legs.map(async (l) => {
    if (l.coords.length < 2) return;
    const a = l.coords[0], b = l.coords.at(-1);
    try {
      if (l.walk) {
        if (cum([a, b]).at(-1) < 30) return;
        const w = await segment(a, b, 'foot', { signal });
        l.coords = w.coords;
        l.steps = w.maneuvers.filter((m) => ![1, 2, 3, 4, 5, 6].includes(m.type))
          .map((m) => ({ text: m.instruction, distance: Math.round((m.length ?? 0) * 1000) }));
        l.distance = Math.round(w.length);
        changed = true;
      } else if (l.lineId && l.tripCode !== null) {
        const c = await tripCourse({ lineId: l.lineId, tripCode: l.tripCode, platformId: l.stopId, time: l.planned }, { signal });
        const part = sliceBetween(c.coords, a, b);
        // Nur nehmen, wenn es plausibel ist (nicht viel länger als von Halt zu Halt)
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
