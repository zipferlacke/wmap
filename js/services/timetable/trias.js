/**
 * Fahrplan über TRIAS (VDV 431, Version 1.2) der EFA-BW: Abfahrten an einer
 * Haltestelle, Verlauf einer Fahrt und Verbindungen von A nach B mit Bus und
 * Bahn. Die Fahrpläne gelten für ganz Deutschland (DELFI), mit Echtzeit, wo
 * die Verkehrsbetriebe sie liefern. Die App fragt nie direkt: die Anfragen
 * gehen über die Weiterleitung des WMap-Servers (Dienst „trias“), der den
 * Schlüssel in RequestorRef einsetzt.
 *
 *   LocationInformationRequest  Haltestelle in 300 m um einen Punkt, Name zu einer Kennung, Lage einer Haltestelle
 *   StopEventRequest            Abfahrten (mit Echtzeit)
 *   TripInfoRequest             alle Halte einer Fahrt (JourneyRef + OperatingDayRef)
 *   TripRequest                 Verbindungen mit Linienverlauf; für den Verlauf einer Fahrt von ihrem Steig bis zum Ziel
 *
 * Schnittstelle wie die der EFA: departures(), tripCourse(), trips().
 */
import { askServer } from '../servers.js';

export const id = 'trias';

const NS = 'http://www.vdv.de/trias';

/* ── XML ────────────────────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** Untergeordnete Elemente mit diesem Namen */
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
/** Element am Pfad „A/B/C“ (jeweils das erste) */
const at = (el, path) => path.split('/').reduce((e, n) => (e ? kids(e, n)[0] ?? null : null), el);
/** Text am Pfad; Text-Elemente in TRIAS enthalten oft noch ein Text-Element */
const text = (el, path) => {
  let e = at(el, path);
  while (e && kids(e, 'Text').length) e = kids(e, 'Text')[0];
  return e?.textContent?.trim() ?? '';
};
/** Alle Nachkommen mit diesem Namen */
const all = (el, name) => [...(el?.getElementsByTagNameNS(NS, name) ?? [])];

/** Lage unter diesem Element (GeoPosition oder Position) → [lon, lat] | null */
function pos(el) {
  if (!el) return null;
  const lon = parseFloat(text(el, 'Longitude')), lat = parseFloat(text(el, 'Latitude'));
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/** ISO-8601-Dauer (PT1H12M30S) → Sekunden */
function seconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d ?? '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + Math.round(+m[4] || 0) : 0;
}

const date = (s) => (s ? new Date(s) : null);

/** Anfrage an die Weiterleitung → Wurzelelement der Antwort */
async function ask(payload, signal, feature) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Trias version="1.2" xmlns="${NS}" xmlns:siri="http://www.siri.org.uk/siri"><ServiceRequest>`
    + `<siri:RequestTimestamp>${iso(new Date())}</siri:RequestTimestamp><siri:RequestorRef>WMAP</siri:RequestorRef>`
    + `<RequestPayload>${payload}</RequestPayload></ServiceRequest></Trias>`;
  const res = await askServer('trias', '', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xml, signal }, { timeout: 20000, feature });
  if (!res.ok) throw new Error(`Der Fahrplan-Server antwortet mit Fehler ${res.status}.`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Antwort des Fahrplan-Servers ist unlesbar.');
  return doc.documentElement;
}

/** Fehlermeldung in der Antwort (ErrorMessage) → Text | '' */
const failure = (root) => {
  const e = all(root, 'ErrorMessage')[0];
  return e ? (text(e, 'Text') || text(e, 'Code') || 'Fehler') : '';
};

/* ── Verkehrsmittel ─────────────────────────────────────────────────────── */

const PRODUCT = {
  0: 'Zug', 1: 'S-Bahn', 2: 'U-Bahn', 3: 'Stadtbahn', 4: 'Straßenbahn', 5: 'Stadtbus', 6: 'Regionalbus', 7: 'Schnellbus',
  8: 'Seilbahn', 9: 'Schiff', 10: 'Anruf-Sammel-Taxi', 13: 'Regionalzug', 14: 'Nationaler Zug', 15: 'Internationaler Zug',
  16: 'Hochgeschwindigkeitszug', 17: 'Schienenersatzverkehr', 18: 'Zug-Shuttle', 19: 'Bürgerbus',
};

/** Produktklassen der EFA → TRIAS-Verkehrsmittel (PtMode) */
const MODES = {
  0: ['rail'], 1: ['rail', 'urbanRail'], 2: ['metro', 'urbanRail'], 3: ['tram', 'urbanRail', 'metro'], 4: ['tram'],
  5: ['bus', 'trolleyBus'], 6: ['bus', 'coach'], 7: ['bus', 'coach'], 8: ['cableway', 'funicular', 'lift'], 9: ['water'],
  10: ['taxi', 'bus'], 13: ['rail'], 14: ['rail', 'intercityRail'], 15: ['rail', 'intercityRail'], 16: ['rail', 'intercityRail'],
  17: ['bus', 'rail', 'replacementService'], 18: ['rail'], 19: ['bus'],
};

/** Verkehrsmittel (Mode) → Produktklasse der EFA */
function modeClass(mode, name) {
  const pt = text(mode, 'PtMode');
  const sub = text(mode, 'BusSubmode') || text(mode, 'RailSubmode') || text(mode, 'TramSubmode') || text(mode, 'MetroSubmode')
    || text(mode, 'UrbanRailSubmode') || text(mode, 'WaterSubmode') || text(mode, 'TelecabinSubmode') || text(mode, 'FunicularSubmode');
  switch (pt) {
    case 'bus': case 'trolleyBus':
      return { railReplacementBus: 17, demandAndResponseBus: 10, communityBus: 19, regionalBus: 6, expressBus: 7, nightBus: 5 }[sub] ?? 5;
    case 'coach': return 7;
    case 'tram': return 4;
    case 'metro': return 2;
    case 'urbanRail': return sub === 'metro' ? 2 : sub === 'tram' ? 4 : sub === 'urbanRailway' || sub === 'suburbanRailway' ? 1 : 3;
    case 'intercityRail': return /^ICE\b/.test(name) ? 16 : 14;
    case 'rail':
      if (/^ICE\b/.test(name)) return 16;
      return {
        suburbanRailway: 1, local: 13, regionalRail: 13, interRegionalRail: 13, highSpeedRail: 16, longDistance: 14, international: 15,
        railShuttle: 18, replacementRailService: 17, touristRailway: 0, nightTrain: 14, sleeperRailService: 14, carTransportRailService: 14,
      }[sub] ?? 0;
    case 'water': return 9;
    case 'cableway': case 'telecabin': case 'funicular': case 'lift': return 8;
    case 'taxi': return 10;
    default: return 0;
  }
}

/**
 * Linie aus dem Dienst (Service) → { line, product, cls }.
 * Fernzüge heißen „ICE 790“, Regionalzüge „RE 19127“ in der Bezeichnung des Verkehrsmittels, die Linie „MEX16“ in
 * der veröffentlichten Linie: bei Zügen steht die Zugart mit Nummer, sonst die Linie.
 */
function lineOf(service) {
  const section = at(service, 'ServiceSection');
  const mode = at(section, 'Mode');
  const published = text(section, 'PublishedLineName');
  const modeName = text(mode, 'Name');
  const train = /^([A-Za-zÄÖÜ]{1,4})\s?(\d{1,5})\b/.exec(modeName);
  const cls = modeClass(mode, train ? `${train[1]} ${train[2]}` : published);
  const trainLike = [14, 15, 16].includes(cls);
  const line = trainLike && train ? `${train[1]} ${train[2]}` : published || (train ? `${train[1]} ${train[2]}` : modeName);
  return { line, product: PRODUCT[cls] ?? modeName, cls };
}

/* ── Haltestellen ───────────────────────────────────────────────────────── */

/** Gleicher Steig? Die Kennungen unterscheiden sich manchmal im Kreis („de:03159:…“ statt „de:03152:…“) */
const samePlatform = (a, b) => !!a && !!b && a.split(':').slice(2).join(':') === b.split(':').slice(2).join(':');
/** Haltestelle („de:03152:33853“) aus einer Kennung des Steigs („de:03152:33853::B“) */
const placeOf = (ref) => ref.split(':').slice(0, 3).join(':');
const isPoint = (ref) => ref.split(':').length > 3;

/** Name einer Haltestelle: Ort und Name, wenn der Name den Ort nicht schon enthält */
function locationName(loc) {
  const stop = at(loc, 'StopPlace') ?? at(loc, 'StopPoint');
  const name = text(stop, 'StopPlaceName') || text(stop, 'StopPointName');
  const place = text(loc, 'LocationName');
  return place && name && !name.toLowerCase().includes(place.toLowerCase()) ? `${place}, ${name}` : (name || place);
}

/** Haltestellen in 300 m um den Punkt → [{ ref, name, point }]; Doppelte (gleiche Haltestelle) nur einmal */
async function stopsNear([lon, lat], signal, feature) {
  const root = await ask(`<LocationInformationRequest><InitialInput><GeoRestriction><Circle><Center><Longitude>${lon.toFixed(5)}</Longitude>`
    + `<Latitude>${lat.toFixed(5)}</Latitude></Center><Radius>300</Radius></Circle></GeoRestriction></InitialInput>`
    + '<Restrictions><Type>stop</Type><NumberOfResults>8</NumberOfResults></Restrictions></LocationInformationRequest>', signal, feature);
  const out = [];
  for (const r of all(root, 'LocationResult')) {
    const loc = at(r, 'Location');
    const stop = at(loc, 'StopPlace') ?? at(loc, 'StopPoint');
    const ref = text(stop, 'StopPlaceRef') || text(stop, 'StopPointRef');
    if (!ref || out.some((o) => placeOf(o.ref) === placeOf(ref))) continue;
    out.push({ ref: placeOf(ref), name: locationName(loc), point: pos(at(loc, 'GeoPosition')) });
  }
  return out;
}

/** Name und Lage einer Haltestelle (Cache für Lagen) */
const places = new Map();
async function placeInfo(ref, signal, feature) {
  const key = placeOf(ref);
  if (places.has(key)) return places.get(key);
  const root = await ask(`<LocationInformationRequest><LocationRef><${isPoint(ref) ? 'StopPointRef' : 'StopPlaceRef'}>${esc(ref)}</${isPoint(ref) ? 'StopPointRef' : 'StopPlaceRef'}></LocationRef></LocationInformationRequest>`, signal, feature);
  const loc = at(all(root, 'LocationResult')[0], 'Location');
  const info = loc ? { name: locationName(loc), point: pos(at(loc, 'GeoPosition')) } : null;
  if (info?.point) places.set(key, info);
  return info;
}

/* ── Abfahrten ──────────────────────────────────────────────────────────── */

/** Zeitpunkt eines Halts: Plan und Echtzeit */
function callTime(call, kind) {
  const t = at(call, kind);
  return { planned: date(text(t, 'TimetabledTime')), estimated: date(text(t, 'EstimatedTime')) };
}
const bay = (call) => text(call, 'EstimatedBay') || text(call, 'PlannedBay');
const delayOf = ({ planned, estimated }) => (planned && estimated ? Math.round((estimated - planned) / 60000) : null);

/** Kennzeichen der Fahrt aus dem Dienst (Service) */
function courseOf(service, extra = {}) {
  return {
    journeyRef: text(service, 'JourneyRef'), operatingDayRef: text(service, 'OperatingDayRef'),
    destRef: text(service, 'DestinationStopPointRef'), ...extra,
  };
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
  const near = async () => {
    const list = await stopsNear(point, signal, feature);
    const low = (name ?? '').toLowerCase();
    return (low && list.find((l) => l.name.toLowerCase().includes(low))) || list[0] || null;
  };
  const events = (ref) => ask(`<StopEventRequest><Location><LocationRef><${isPoint(ref) ? 'StopPointRef' : 'StopPlaceRef'}>${esc(ref)}</${isPoint(ref) ? 'StopPointRef' : 'StopPlaceRef'}></LocationRef>`
    + `<DepArrTime>${iso(when ?? new Date())}</DepArrTime></Location><Params><NumberOfResults>${limit}</NumberOfResults><StopEventType>departure</StopEventType>`
    + '<IncludePreviousCalls>false</IncludePreviousCalls><IncludeOnwardCalls>false</IncludeOnwardCalls><IncludeRealtimeData>true</IncludeRealtimeData></Params></StopEventRequest>', signal, feature);
  let stop = stopId ?? fromIfopt, label = null;
  if (!stop) {
    const n = await near();
    if (!n) return { stop: null, stopId: null, list: [] };
    stop = n.ref; label = n.name;
  }
  let root = await events(stop);
  // Der IFOPT aus OSM passt nicht immer zur EFA (anderer Kreis) – dann über die Lage
  if (!all(root, 'StopEventResult').length && fromIfopt && stop === fromIfopt) {
    const n = await near();
    if (n) { stop = n.ref; label = n.name; root = await events(stop); }
  }
  const results = all(root, 'StopEventResult');
  if (!results.length) {
    const err = failure(root);
    if (err && !/INTERNAL|NOTFOUND|NO_|UNKNOWN/i.test(err) && !label) throw new Error(`Keine Abfahrten: ${err}`);
    return { stop: label ?? stop, stopId: stop, list: [] };
  }
  const list = results.map((r) => {
    const call = at(r, 'StopEvent/ThisCall/CallAtStop');
    const service = at(r, 'StopEvent/Service');
    const dep = callTime(call, 'ServiceDeparture');
    if (!dep.planned || !service) return null;
    const { line, product, cls } = lineOf(service);
    const platformId = text(call, 'StopPointRef');
    return {
      time: dep.planned, delay: delayOf(dep), line, product, cls,
      to: text(service, 'DestinationText'),
      platform: bay(call), platformId, platformPoint: null,
      cancelled: text(service, 'Cancelled') === 'true' || text(call, 'NotServicedStop') === 'true',
      course: courseOf(service, { boardRef: platformId, seq: parseInt(text(call, 'StopSeqNumber'), 10) || null, time: +dep.planned }),
    };
  }).filter((x) => x && !Number.isNaN(+x.time)).sort((a, b) => a.time - b.time);
  if (!label) label = (await placeInfo(stop, signal, feature).catch(() => null))?.name ?? text(at(results[0], 'StopEvent/ThisCall/CallAtStop'), 'StopPointName');
  return { stop: label, stopId: stop, list };
}

/* ── Verlauf einer Fahrt ────────────────────────────────────────────────── */

/** Halte eines Fahrtverlaufs (TripInfo) → [{ id, name, point, time, platform, seq }] */
function infoStops(root) {
  const result = all(root, 'TripInfoResult')[0];
  const out = [];
  for (const c of [...(result?.children ?? [])].filter((e) => /^(Previous|This|Onward)Call$/.test(e.localName))) {
    const call = at(c, 'CallAtStop') ?? c;
    const dep = callTime(call, 'ServiceDeparture'), arr = callTime(call, 'ServiceArrival');
    const tm = dep.estimated ?? dep.planned ?? arr.estimated ?? arr.planned;
    out.push({
      id: text(call, 'StopPointRef'), name: text(call, 'StopPointName'), point: null, time: tm, planned: dep.planned ?? arr.planned, platform: bay(call),
      seq: parseInt(text(call, 'StopSeqNumber'), 10) || null,
    });
  }
  return out;
}

/** Lagen aller Stopps/Haltestellen einer Antwort (TripResponseContext) → Map Kennung → [lon, lat] */
function locationsOf(root) {
  const map = new Map();
  for (const loc of all(root, 'Location')) {
    if (loc.parentElement?.localName !== 'Locations') continue;
    const p = pos(at(loc, 'GeoPosition'));
    const stop = at(loc, 'StopPoint') ?? at(loc, 'StopPlace');
    const ref = text(stop, 'StopPointRef') || text(stop, 'StopPlaceRef');
    if (ref && p) map.set(ref, p);
  }
  return map;
}

/** Linienverlauf eines Abschnitts (LegTrack) → [[lon, lat]] */
const projection = (leg) => all(at(leg, 'LegTrack') ?? leg, 'Position').map(pos).filter(Boolean);

/** Zeit-Abschnitt (TimedLeg) einer Verbindung → Daten für Anzeige und Verlauf */
function timedLeg(tl, locs) {
  const board = at(tl, 'LegBoard'), alight = at(tl, 'LegAlight');
  const service = at(tl, 'Service');
  const stopsAt = [board, ...kids(tl, 'LegIntermediates'), alight];
  const dep = callTime(board, 'ServiceDeparture'), arr = callTime(alight, 'ServiceArrival');
  const stopList = stopsAt.map((c, i) => {
    const d = callTime(c, 'ServiceDeparture'), a = callTime(c, 'ServiceArrival');
    const tm = i === stopsAt.length - 1 ? (a.estimated ?? a.planned) : (d.estimated ?? d.planned ?? a.planned);
    const ref = text(c, 'StopPointRef');
    return { name: text(c, 'StopPointName'), time: tm, platform: bay(c), point: locs.get(ref) ?? locs.get(placeOf(ref)) ?? null };
  });
  let coords = projection(tl);
  const pts = stopList.map((s) => s.point).filter(Boolean);
  if (coords.length < 3 && pts.length > coords.length) coords = pts;
  const { line, product, cls } = lineOf(service);
  const boardRef = text(board, 'StopPointRef');
  return {
    walk: false, cls, line, product, to_: text(service, 'DestinationText'),
    from: stopList[0].name, to: stopList.at(-1).name,
    dep: dep.estimated ?? dep.planned, arr: arr.estimated ?? arr.planned, planned: dep.planned, plannedArr: arr.planned,
    delay: delayOf(dep), platform: bay(board), platformTo: bay(alight),
    stops: stopList.length - 1, stopList, steps: [], distance: 0, duration: Math.round(((arr.estimated ?? arr.planned) - (dep.estimated ?? dep.planned)) / 1000),
    coords, course: courseOf(service, { boardRef, time: +dep.planned }),
  };
}

/** Fußweg (ContinuousLeg oder InterchangeLeg) einer Verbindung */
function walkLeg(el, locs) {
  const start = at(el, 'LegStart'), end = at(el, 'LegEnd');
  const ends = (e) => pos(at(e, 'GeoPosition')) ?? locs.get(text(e, 'StopPointRef')) ?? locs.get(placeOf(text(e, 'StopPointRef') || ':::')) ?? null;
  const [a, b] = [ends(start), ends(end)];
  let coords = projection(el);
  if (coords.length < 2) coords = [a, b].filter(Boolean);
  const dep = date(text(el, 'TimeWindowStart')), arr = date(text(el, 'TimeWindowEnd'));
  return {
    walk: true, cls: null, line: '', product: '', to_: '',
    from: text(start, 'LocationName'), to: text(end, 'LocationName'),
    dep, arr, planned: dep, plannedArr: arr, delay: null, platform: '', platformTo: '',
    stops: 0, stopList: [], steps: [], distance: parseInt(text(el, 'Length'), 10) || 0,
    duration: seconds(text(el, 'Duration')) || Math.round((arr - dep) / 1000) || 0,
    coords, course: null,
  };
}

/** Aufeinanderfolgende Fußwege (Weg zur Haltestelle, Umstieg im Bahnhof) zu einem */
function mergeWalks(legs) {
  const out = [];
  for (const l of legs) {
    const last = out.at(-1);
    if (last?.walk && l.walk) {
      last.to = l.to; last.arr = l.arr; last.plannedArr = l.plannedArr;
      last.distance += l.distance; last.duration += l.duration;
      last.coords = [...last.coords, ...l.coords];
    } else out.push(l);
  }
  return out;
}

/** Verbindungen (TripResult) einer Antwort → Listen von Abschnitten */
function parseTrips(root) {
  const locs = locationsOf(root);
  return all(root, 'TripResult').map((r) => {
    const legs = kids(at(r, 'Trip'), 'TripLeg').map((l) => {
      const timed = at(l, 'TimedLeg');
      if (timed) return timedLeg(timed, locs);
      const w = at(l, 'ContinuousLeg') ?? at(l, 'InterchangeLeg');
      return w ? walkLeg(w, locs) : null;
    }).filter(Boolean);
    return mergeWalks(legs);
  }).filter((legs) => legs.length);
}

/** Lage der Halte nachtragen, die in der Antwort fehlten (eine Anfrage je Haltestelle, höchstens 8) */
async function fillPoints(stops, signal, feature) {
  const missing = [...new Set(stops.filter((s) => !s.point && s.id).map((s) => placeOf(s.id)))].slice(0, 8);
  const got = new Map(await Promise.all(missing.map(async (ref) => [ref, (await placeInfo(ref, signal, feature).catch(() => null))?.point ?? null])));
  for (const s of stops) if (!s.point && s.id) s.point = got.get(placeOf(s.id)) ?? null;
}

/**
 * Verlauf einer Fahrt: Linie auf der Karte und alle Halte mit Zeiten.
 * Die Halte kommen aus TripInfo, der Verlauf samt Lage der Halte aus einer Verbindung vom ersten bis zum letzten Halt
 * (dieselbe Fahrt als Abschnitt). Fehlt TripInfo, gilt die Verbindung vom Steig bis zum Ziel der Fahrt; fehlt auch sie
 * oder der Verlauf, verbindet die Linie die Halte.
 * → { coords: [[lon, lat]], stops: [{ id, name, point, time, platform }], index }
 *   index: dieser Halt in der Folge (−1, wenn nicht gefunden)
 */
export async function tripCourse(dep, { signal, feature = null } = {}) {
  const c = dep.course;
  if (!c?.journeyRef || !c.operatingDayRef) throw new Error('Für diese Fahrt gibt es keinen Verlauf.');
  const boardRef = dep.platformId || c.boardRef;
  const tolerant = (e) => { if (e.name === 'AbortError') throw e; return null; };
  const info = await ask(`<TripInfoRequest><JourneyRef>${esc(c.journeyRef)}</JourneyRef><OperatingDayRef>${esc(c.operatingDayRef)}</OperatingDayRef>`
    + '<Params><IncludeCalls>true</IncludeCalls><IncludeEstimatedTimes>true</IncludeEstimatedTimes></Params></TripInfoRequest>', signal, feature)
    .then((r) => infoStops(r), tolerant) ?? [];
  const [from, to] = info.length ? [info[0], info.at(-1)] : [{ id: boardRef, planned: new Date(c.time ?? dep.time) }, { id: c.destRef }];
  const trip = from.id && to.id && from.planned ? await ask(`<TripRequest><Origin><LocationRef><StopPointRef>${esc(from.id)}</StopPointRef></LocationRef>`
    + `<DepArrTime>${iso(from.planned)}</DepArrTime></Origin><Destination><LocationRef><StopPointRef>${esc(to.id)}</StopPointRef></LocationRef></Destination>`
    + '<Params><NumberOfResults>2</NumberOfResults><IncludeTrackSections>true</IncludeTrackSections><IncludeLegProjection>true</IncludeLegProjection>'
    + '<IncludeIntermediateStops>true</IncludeIntermediateStops></Params></TripRequest>', signal, feature)
    .then((r) => ({ locs: locationsOf(r), legs: all(r, 'TimedLeg').filter((l) => text(l, 'Service/JourneyRef') === c.journeyRef) }), tolerant) : null;
  const locs = trip?.locs ?? new Map();
  const leg = trip?.legs[0] ?? null;
  let stops = info;
  if (!stops.length && leg) {
    stops = [at(leg, 'LegBoard'), ...kids(leg, 'LegIntermediates'), at(leg, 'LegAlight')].map((x, i, a) => {
      const d = callTime(x, 'ServiceDeparture'), ar = callTime(x, 'ServiceArrival');
      const tm = i === a.length - 1 ? (ar.estimated ?? ar.planned) : (d.estimated ?? d.planned ?? ar.planned);
      return { id: text(x, 'StopPointRef'), name: text(x, 'StopPointName'), point: null, time: tm, platform: bay(x), seq: null };
    });
  }
  if (!stops.length) throw new Error('Für diese Fahrt gibt es keinen Verlauf.');
  for (const s of stops) s.point = locs.get(s.id) ?? locs.get(placeOf(s.id)) ?? null;
  await fillPoints(stops, signal, feature);
  let index = c.seq ? stops.findIndex((s) => s.seq === c.seq) : -1;
  if (index < 0) index = stops.findIndex((s) => samePlatform(s.id, boardRef));
  if (index < 0) index = stops.findIndex((s) => placeOf(s.id) === placeOf(boardRef ?? ''));
  const line = leg ? projection(leg) : [];
  const pts = stops.map((s) => s.point).filter(Boolean);
  return {
    coords: line.length >= 3 ? line : pts,
    stops: stops.map(({ id: sid, name, point, time, platform }) => ({ id: sid, name, point, time, platform })),
    index,
  };
}

/* ── Verbindungen von A nach B ──────────────────────────────────────────── */

const posXml = (p) => `<LocationRef><GeoPosition><Longitude>${p[0].toFixed(5)}</Longitude><Latitude>${p[1].toFixed(5)}</Latitude></GeoPosition></LocationRef>`;

/**
 * Verbindungen → Liste von Verbindungen, jede eine Liste von Abschnitten (legs).
 * @param o.when     Abfahrt ab bzw. Ankunft bis (Date)
 * @param o.arrive   true: `when` ist die Ankunft bis
 * @param o.classes  erlaubte Produktklassen der EFA (Array) oder null = alle
 * @param o.slow     mehr Zeit zum Umsteigen
 */
export async function trips(from, to, { when = new Date(), arrive = false, classes = null, slow = false, signal, feature = null } = {}) {
  const modes = classes ? [...new Set(classes.flatMap((c) => MODES[c] ?? []))] : [];
  const filter = modes.length ? `<PtModeFilter><Exclude>false</Exclude>${modes.map((m) => `<PtMode>${m}</PtMode>`).join('')}</PtModeFilter>` : '';
  const time = `<DepArrTime>${iso(when)}</DepArrTime>`;
  const root = await ask(`<TripRequest><Origin>${posXml(from)}${arrive ? '' : time}</Origin><Destination>${posXml(to)}${arrive ? time : ''}</Destination>`
    + `<Params>${filter}<NumberOfResults>5</NumberOfResults>${slow ? '<AdditionalTransferTime>PT5M</AdditionalTransferTime>' : ''}`
    + '<IncludeTrackSections>true</IncludeTrackSections><IncludeLegProjection>true</IncludeLegProjection>'
    + '<IncludeIntermediateStops>true</IncludeIntermediateStops><IncludeRealtimeData>true</IncludeRealtimeData></Params></TripRequest>', signal, feature);
  const list = parseTrips(root).filter((legs) => legs.length && legs.every((l) => l.coords.length || !l.walk));
  if (!list.length) {
    const err = failure(root);
    throw new Error(err && !/NOTFOUND|NO_|TRIP/i.test(err) ? `Keine Verbindung gefunden (${err}).` : 'Keine Verbindung gefunden.');
  }
  return list;
}
