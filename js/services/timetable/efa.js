/**
 * Fahrplan-Anbieter EFA der NVBW (EFA-BW, offen, ohne Schlüssel, direkt aus dem Browser): Abfahrten an einer
 * Haltestelle, Verlauf einer Fahrt und Verbindungen von A nach B. Fahrpläne in ganz Deutschland (DELFI), mit Echtzeit,
 * wo die Verkehrsbetriebe sie liefern. Schnittstelle wie hafas.js und trias.js, ausgewählt in timetable/index.js.
 *
 *   Haltestelle   aus dem IFOPT-Schlüssel des OSM-Steigs („de:03152:33853::B“
 *                 → Haltestelle „de:03152:33853“), sonst die nächste in
 *                 300 m um den Punkt, gleicher Name bevorzugt
 *   Steig         die EFA nennt ihre Steige mit demselben Schlüssel – so
 *                 lassen sich die Abfahrten dieser Seite herausfiltern
 *
 * Verbindungen kommen ohne Verlauf und Fußweg-Texte (genC/genP = 0: rund 3 s statt 9 s, ein Drittel der Daten) –
 * von Halt zu Halt. Den echten Verlauf lädt timetable/index.js refineJourney() nur für die gewählte Verbindung nach.
 */
import { askServer } from '../servers.js';
import { cum, samePlatform } from './common.js';
import { t, lang, FALLBACK } from '../../core/i18n.js';

export const id = 'efa';
const COORD = 'WGS84[dd.ddddd]';

async function efa(path, params, signal, feature = null) {
  const res = await askServer('efa', `${path}?${new URLSearchParams({ outputFormat: 'rapidJSON', ...(lang === FALLBACK ? {} : { language: lang.split('_')[0] }), ...params })}`, { signal }, { timeout: 20000, feature });
  if (!res.ok) throw new Error(t('services.departures.error.status', { status: res.status }));
  return res.json();
}

/** Date → Datum und Uhrzeit für die EFA (Ortszeit) */
function efaTime(when) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    itdDate: `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`,
    itdTime: `${pad(when.getHours())}${pad(when.getMinutes())}`,
  };
}

/** Haltestelle der EFA zum Punkt → Kennung oder null */
async function stopNear([lon, lat], name, signal, feature) {
  const d = await efa('XML_COORD_REQUEST', {
    coord: `${lon.toFixed(5)}:${lat.toFixed(5)}:${COORD}`, coordOutputFormat: COORD,
    inclFilter: '1', type_1: 'STOP', radius_1: '300', max: '8',
  }, signal, feature);
  const list = d.locations ?? [];
  const low = (name ?? '').toLowerCase();
  return (low && list.find((l) => l.name?.toLowerCase().includes(low)))?.id ?? list[0]?.id ?? null;
}


/**
 * Abfahrten → { stop, stopId, list: [{ time, delay, line, product, cls, to, platform, platformId, platformPoint, cancelled, course }] }
 * @param o.ifopt   IFOPT des angetippten Steigs (OSM „ref:IFOPT“), wenn bekannt
 * @param o.stopId  Kennung aus einer früheren Antwort – spart das Suchen der Haltestelle
 * @param o.when    ab dieser Zeit (Date), sonst ab jetzt
 */
export async function departures(point, { name = '', ifopt = '', stopId = null, when = null, limit = 40, signal, feature = null } = {}) {
  const parts = ifopt.split(':');
  const fromIfopt = parts.length >= 3 && parts[0] === 'de' ? parts.slice(0, 3).join(':') : null;
  const ask = (stop) => efa('XML_DM_REQUEST', {
    name_dm: stop, type_dm: 'any', mode: 'direct', useRealtime: '1', limit: String(limit), depType: 'stopEvents',
    coordOutputFormat: COORD, ...(when ? { ...efaTime(when), itdDateTimeDepArr: 'dep' } : {}),
  }, signal, feature);
  let stop = stopId ?? fromIfopt ?? await stopNear(point, name, signal, feature);
  if (!stop) return { stop: null, stopId: null, list: [] };
  let d = await ask(stop);
  // Der IFOPT aus OSM passt nicht immer zur EFA (anderer Kreis) – dann über die Lage
  if (!d.stopEvents?.length && fromIfopt) {
    stop = await stopNear(point, name, signal, feature);
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
      cls,
      to: t.destination?.name ?? '',
      platform: e.location?.properties?.platformName ?? e.location?.properties?.platform ?? e.location?.disassembledName ?? '',
      platformId: e.location?.id ?? '',
      // Lage des Steigs – daran erkennt WMap die Seite, die angetippt wurde
      platformPoint: e.location?.coord ? [e.location.coord[1], e.location.coord[0]] : null,
      cancelled: !!e.isCancelled,
      course: t.id && t.properties?.tripCode != null
        ? { lineId: t.id, tripCode: t.properties.tripCode, platformId: e.location?.id ?? '', time: planned } : null,
    };
  }).filter((x) => !Number.isNaN(+x.time));
  return { stop: d.locations?.[0]?.name ?? stop, stopId: stop, list };
}

/**
 * Verlauf einer Fahrt (dep.course aus departures() oder einem Abschnitt von trips()): Linie auf der Karte und alle Halte
 * mit Zeiten – eine Anfrage, rund ⅕ s, ohne OpenStreetMap.
 * → { coords: [[lon, lat]], stops: [{ name, point, time, platform, id }], index }
 *   index: dieser Halt in der Folge (−1, wenn nicht gefunden)
 */
export async function tripCourse(dep, { signal, feature = null } = {}) {
  const c = dep.course;
  if (!c) throw new Error(t('services.departures.error.no_course'));
  const pad = (n) => String(n).padStart(2, '0');
  const when = c.time;
  const d = await efa('XML_STOPSEQCOORD_REQUEST', {
    coordOutputFormat: COORD, line: c.lineId, stop: c.platformId, tripCode: String(c.tripCode),
    date: `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`, time: `${pad(when.getHours())}${pad(when.getMinutes())}`,
    tStOTType: 'all', useRealtime: '1',
  }, signal, feature);
  const leg = d.leg;
  if (!leg?.stopSequence?.length) throw new Error(t('services.departures.error.no_course'));
  const stops = leg.stopSequence.map((x) => {
    const tm = x.departureTimeEstimated ?? x.departureTimePlanned ?? x.arrivalTimeEstimated ?? x.arrivalTimePlanned;
    return {
      id: x.id ?? '', name: x.parent?.name ?? x.name ?? '', time: tm ? new Date(tm) : null,
      platform: x.properties?.platform ?? '', point: x.coord ? [x.coord[1], x.coord[0]] : null,
    };
  });
  const index = stops.findIndex((x) => samePlatform(x.id, c.platformId) || samePlatform(x.id.split('::')[0], c.platformId.split('::')[0]));
  return { coords: (leg.coords ?? []).map(([lat, lon]) => [lon, lat]), stops, index };
}

/* ── Verbindungen von A nach B ──────────────────────────────────────────── */

const TURN = {
  LEFT: 'left', RIGHT: 'right', SLIGHT_LEFT: 'slight_left', SLIGHT_RIGHT: 'slight_right',
  SHARP_LEFT: 'sharp_left', SHARP_RIGHT: 'sharp_right', STRAIGHT: 'straight', UTURN: 'uturn',
};

/** Fußweg-Beschreibung der EFA → [{ text, distance }] (gleiche Richtung ohne Namen zusammengefasst) */
function walkSteps(l) {
  const out = [];
  const straight = t('services.departures.walk.straight_on');
  for (const p of l.pathDescriptions ?? []) {
    if (/ORIGIN|DESTINATION/.test(p.manoeuvre ?? '')) continue;
    const turn = p.manoeuvre === 'TURN' || /LEFT|RIGHT|UTURN/.test(p.turnDirection ?? '') ? TURN[p.turnDirection] : null;
    const name = (p.name ?? '').trim();
    const text = turn && name ? t(`services.departures.walk.${turn}.into`, { name }) : turn ? t(`services.departures.walk.${turn}.turn`) : name || straight;
    const last = out.at(-1);
    if (last && !name && !turn && last.text === straight) { last.distance += p.distance ?? 0; continue; }
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
 * Ziel – eine Luftlinie. Dann von Halt zu Halt.
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

const WALK = /footpath|fußweg|walk/i;

/** Abschnitte einer Verbindung der EFA → legs im gemeinsamen Format (timetable/common.js buildRoute) */
function parseLegs(j) {
  return (j.legs ?? []).map((l) => {
    const tr = l.transportation ?? {};
    const cls = tr.product?.class ?? null;
    const walk = !tr.product || WALK.test(tr.product?.name ?? '') || cls === 99 || cls === 100;
    const time = (x, k) => new Date(x?.[`${k}TimeEstimated`] ?? x?.[`${k}TimePlanned`]);
    const train = tr.properties?.trainType;
    const stops = walk ? [] : stopList(l);
    const planned = new Date(l.origin?.departureTimePlanned);
    return {
      walk, cls,
      // Fernzüge heißen „ICE 783“, die EFA hat dafür keine Kurzform
      line: walk ? '' : (tr.disassembledName ?? (train ? `${train} ${tr.properties?.trainNumber ?? ''}`.trim() : null) ?? tr.number ?? tr.name ?? ''),
      product: walk ? '' : (tr.product?.name ?? ''),
      to_: tr.destination?.name ?? '',
      from: l.origin?.parent?.name && l.origin.type === 'platform' ? l.origin.parent.name : (l.origin?.name ?? ''),
      to: l.destination?.parent?.name && l.destination.type === 'platform' ? l.destination.parent.name : (l.destination?.name ?? ''),
      dep: time(l.origin, 'departure'), arr: time(l.destination, 'arrival'),
      planned, plannedArr: new Date(l.destination?.arrivalTimePlanned),
      delay: l.origin?.departureTimeEstimated ? Math.round((new Date(l.origin.departureTimeEstimated) - planned) / 60000) : null,
      platform: l.origin?.properties?.platformName ?? l.origin?.properties?.platform ?? '',
      platformTo: l.destination?.properties?.platformName ?? l.destination?.properties?.platform ?? '',
      stops: Math.max(0, (l.stopSequence?.length ?? 1) - 1),
      stopList: stops,
      steps: walk ? walkSteps(l) : [],
      distance: l.distance ?? 0,
      duration: l.duration ?? 0,
      coords: legCoords(l, stops),
      course: !walk && tr.id && tr.properties?.tripCode != null
        ? { lineId: tr.id, tripCode: tr.properties.tripCode, platformId: l.origin?.id ?? '', time: planned } : null,
    };
  });
}

/**
 * Verbindungen → [[leg, …], …] (Rohdaten, Auswahl und Route in timetable/index.js)
 * @param o.classes  erlaubte Produktklassen, null: alle
 * @param o.slow     mehr Zeit zum Umsteigen
 */
export async function trips(from, to, { when = new Date(), arrive = false, classes = null, slow = false, signal, feature = null } = {}) {
  const modes = classes ? { ptOptionsActive: '1', includedMeans: 'checkbox', ...Object.fromEntries(classes.map((c) => [`inclMOT_${c}`, '1'])) } : {};
  const d = await efa('XML_TRIP_REQUEST2', {
    coordOutputFormat: COORD,
    type_origin: 'coord', name_origin: `${from[0].toFixed(5)}:${from[1].toFixed(5)}:${COORD}`,
    type_destination: 'coord', name_destination: `${to[0].toFixed(5)}:${to[1].toFixed(5)}:${COORD}`,
    ...efaTime(when),
    itdTripDateTimeDepArr: arrive ? 'arr' : 'dep', calcNumberOfTrips: '5', useRealtime: '1',
    // Ohne Verläufe und Fußweg-Texte – die kommen per refineJourney()
    genC: '0', genP: '0',
    ...modes, ...(slow ? { changeSpeed: 'slow' } : {}),
  }, signal, feature);
  return (d.journeys ?? []).map(parseLegs);
}
