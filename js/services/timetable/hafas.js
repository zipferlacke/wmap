/**
 * Fahrplan über die HAFAS-ReST-Schnittstelle des RMV (Rhein-Main-Verkehrsverbund,
 * https://www.rmv.de/hapi/): Abfahrten an einer Haltestelle, Verlauf einer
 * Fahrt und Verbindungen von A nach B. Der RMV kennt die Fahrpläne in ganz
 * Deutschland, mit Echtzeit, wo die Verkehrsbetriebe sie liefern.
 *
 * Die Anfragen gehen über die Weiterleitung des WMap-Servers (askServer('rmv')),
 * die den Zugangsschlüssel (accessId) anhängt. Die Antworten kommen als JSON;
 * Datum und Uhrzeit sind Ortszeit.
 *
 *   Haltestelle   location.nearbystops – gleicher Name bzw. gleicher IFOPT
 *                 (Hinweis „IF“, altId) bevorzugt; Kennung ist die extId
 *   Abfahrten     departureBoard
 *   Verlauf       journeyDetail mit der Fahrt-Referenz aus Abfahrt bzw. Abschnitt
 *   Verbindungen  trip mit Koordinaten als Start und Ziel
 *
 * Die Produktklassen des RMV sind Bits (1 ICE, 2 IC/EC, 4 Regional, 8 S-Bahn,
 * 16 U-Bahn, 32 Straßenbahn, 64/128 Bus, 256 Fähre, 512 Rufbus/Seilbahn,
 * 1024 RegioTram); nach außen kommen sie als EFA-Klassen.
 */
import { askServer } from '../servers.js';

export const id = 'rmv';

/* Hessen, grob umrissen: außerhalb kennt der RMV vor allem Züge, kaum Haltestellen des Nahverkehrs */
const HESSEN = [[8.55, 51.45], [8.97, 51.52], [9.45, 51.66], [9.72, 51.48], [9.95, 51.38], [10.08, 51.10], [10.25, 50.90],
  [10.08, 50.55], [9.95, 50.40], [9.55, 50.20], [9.50, 49.80], [9.10, 49.55], [8.95, 49.38], [8.45, 49.43], [8.33, 49.70],
  [8.05, 49.95], [7.76, 50.08], [7.93, 50.40], [7.96, 50.62], [8.13, 50.86], [8.48, 51.06], [8.58, 51.25]];

/** Liegt der Punkt [lon, lat] im Gebiet des RMV (Hessen)? timetable/index.js fragt den RMV nur dann */
export function covers([x, y]) {
  let inside = false;
  for (let i = 0, j = HESSEN.length - 1; i < HESSEN.length; j = i, i += 1) {
    const [xi, yi] = HESSEN[i], [xj, yj] = HESSEN[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// HAFAS-Produktnummer (catCode) → EFA-Klasse
const CLS = { 0: 16, 1: 14, 2: 13, 3: 1, 4: 2, 5: 4, 6: 5, 7: 5, 8: 9, 9: 10, 10: 3 };
// EFA-Klasse → HAFAS-Produktbits
const BITS = {
  0: 1 | 2 | 4, 1: 8, 2: 16, 3: 1024, 4: 32, 5: 64 | 128, 6: 64 | 128, 7: 64 | 128, 8: 512, 9: 256, 10: 512,
  13: 4, 14: 2, 15: 2, 16: 1, 17: 64 | 128, 18: 4, 19: 64 | 128,
};
const NAMES = {
  1: 'S-Bahn', 2: 'U-Bahn', 3: 'Stadtbahn', 4: 'Straßenbahn', 5: 'Bus', 6: 'Regionalbus', 8: 'Seilbahn', 9: 'Schiff',
  10: 'Anruf-Sammeltaxi', 13: 'Regionalzug', 14: 'Zug', 16: 'Hochgeschwindigkeitszug',
};
const WALKING = new Set(['WALK', 'TRSF', 'TRANSFER', 'BIKE', 'KISS', 'PARK', 'TAXI', 'DEVI', 'GIS']);

async function hafas(path, params, signal, feature = null) {
  const query = new URLSearchParams({ format: 'json', ...params });
  const res = await askServer('rmv', `${path}?${query}`, { signal }, { timeout: 20000, feature });
  if (!res.ok) {
    const why = (await res.json().catch(() => null))?.errorText;
    if (/H9220/.test(why ?? '')) throw new Error('Keine Haltestelle in der Nähe von Start oder Ziel gefunden.');
    throw new Error(`Die Fahrplanauskunft des RMV antwortet mit Fehler ${res.status}${why ? `: ${why}` : '.'}`);
  }
  const d = await res.json();
  if (d.errorCode && d.errorCode !== 'SVC_NO_RESULT') throw new Error(`Die Fahrplanauskunft des RMV meldet: ${d.errorText ?? d.errorCode}`);
  return d;
}

const list = (x) => (x == null ? [] : [].concat(x));
const pad = (n) => String(n).padStart(2, '0');

/** Ortszeit aus „2026-11-09“ und „08:02:00“ */
function stamp(date, time) {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, s || 0);
}

/** Plan- und Echtzeit eines Halts; kind: '' (Start/Ziel/Abfahrt), 'dep' oder 'arr' (Halteliste) */
function times(o, kind = '') {
  const k = (name) => (kind ? `${kind}${name}` : name.toLowerCase());
  const r = (name) => (kind ? `rt${kind[0].toUpperCase()}${kind.slice(1)}${name}` : `rt${name}`);
  const plan = stamp(o[k('Date')], o[k('Time')]);
  const real = stamp(o[r('Date')], o[r('Time')]);
  return { plan, real };
}

const minutes = (a, b) => Math.round((b - a) / 60000);

/** Gleis bzw. Steig: Echtzeit vor Plan */
function trackOf(o, kind = '') {
  const real = kind ? `rt${kind[0].toUpperCase()}${kind.slice(1)}Track` : 'rtTrack';
  const plan = kind ? `${kind}Track` : 'track';
  const platform = kind ? `${kind}Platform` : 'platform';
  const rtPlatform = kind ? `rt${kind[0].toUpperCase()}${kind.slice(1)}Platform` : 'rtPlatform';
  return o[real] ?? o[rtPlatform]?.text ?? o[plan] ?? o[platform]?.text ?? '';
}

const point = (o) => (typeof o?.lon === 'number' && typeof o?.lat === 'number' ? [o.lon, o.lat] : null);

/** IFOPT einer Haltestelle: Hinweis „IF“, sonst altId */
function ifoptOf(o) {
  const note = list(o?.Notes?.Note ?? o?.LocationNotes?.LocationNote).find((n) => n.key === 'IF');
  return note?.value ?? list(o?.altId)[0] ?? '';
}

/** EFA-Klasse der Fahrt */
function classOf(p) {
  const code = Number(p?.catCode);
  const out = `${p?.catOut ?? ''} ${p?.catOutL ?? ''}`;
  if (/fähre|schiff/i.test(out)) return 9;
  if (/seilbahn/i.test(out)) return 8;
  if (/\bAST\b|ruf|taxi/i.test(out)) return 10;
  if (/regionalbus|expressbus|schnellbus/i.test(out)) return 6;
  return CLS[code] ?? (Number.isNaN(code) ? null : 5);
}

/** Kurzer Linienname wie bei der EFA („11“, „U6“, „RE1“, „ICE 790“) */
function lineOf(p, cls) {
  if (!p) return '';
  const short = [4, 5, 6, 7, 8, 9, 10].includes(cls) ? (p.displayNumber ?? p.line) : null;
  return String(short || p.name || p.line || '').trim().replace(/^(Bus|Tram|Fähre)\s+/, '');
}

/** Haltestellen um den Punkt → [{ id, name, ifopt }] */
async function stopsNear([lon, lat], signal, feature) {
  const d = await hafas('location.nearbystops', {
    originCoordLat: lat.toFixed(6), originCoordLong: lon.toFixed(6), r: '300', maxNo: '8', type: 'S',
  }, signal, feature);
  return list(d.stopLocationOrCoordLocation).map((x) => x.StopLocation).filter(Boolean)
    .map((s) => ({ id: s.extId, name: s.name, ifopt: ifoptOf(s) }));
}

/** Haltestelle zu Punkt, Namen und IFOPT: gleicher IFOPT, dann gleicher Name, sonst die nächste */
async function stopNear(point_, name, ifopt, signal, feature) {
  const all = await stopsNear(point_, signal, feature);
  const parts = ifopt.split(':');
  const base = parts.length >= 3 ? parts.slice(0, 3).join(':') : '';
  const low = name.toLowerCase();
  return (base && all.find((s) => s.ifopt === base))
    || (low && all.find((s) => s.name.toLowerCase().includes(low)))
    || all[0] || null;
}

/**
 * Abfahrten → { stop, stopId, list: [{ time, delay, line, product, cls, to, platform, platformId, platformPoint, cancelled, course }] }
 * @param o.ifopt   IFOPT des angetippten Steigs (OSM „ref:IFOPT“), wenn bekannt
 * @param o.stopId  Kennung aus einer früheren Antwort – spart das Suchen der Haltestelle
 * @param o.when    ab dieser Zeit (Date), sonst ab jetzt
 */
export async function departures(point_, { name = '', ifopt = '', stopId = null, when = null, limit = 40, signal, feature = null } = {}) {
  let stop = stopId ? { id: stopId, name } : await stopNear(point_, name, ifopt, signal, feature);
  if (!stop) return { stop: null, stopId: null, list: [] };
  const at = when ?? new Date();
  const d = await hafas('departureBoard', {
    id: stop.id, maxJourneys: String(limit), duration: '720',
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  }, signal, feature);
  const out = list(d.Departure).map((e) => {
    const p = e.ProductAtStop ?? list(e.Product)[0];
    const cls = classOf(p);
    const { plan, real } = times(e);
    return {
      time: plan,
      delay: real && plan ? minutes(plan, real) : null,
      line: lineOf(p, cls) || e.name || '',
      product: NAMES[cls] ?? p?.catOutL ?? '',
      cls,
      to: e.direction ?? '',
      platform: trackOf(e),
      platformId: '',
      platformPoint: null,
      cancelled: !!e.cancelled,
      course: e.JourneyDetailRef?.ref ? { ref: e.JourneyDetailRef.ref, stopId: e.stopExtId ?? stop.id, name: e.stop ?? '', time: plan } : null,
    };
  }).filter((x) => x.time);
  stop = { ...stop, name: stop.name || list(d.Departure)[0]?.stop || '' };
  return { stop: stop.name, stopId: stop.id, list: out };
}

/** Linienverlauf aus der Antwort (poly=1, polyEnc=N: lon, lat, lon, lat …) */
function polyline(group) {
  const out = [];
  for (const desc of list(group?.polylineDesc)) {
    const crd = desc.crd ?? [];
    for (let i = 0; i + 1 < crd.length; i += 2) out.push([crd[i], crd[i + 1]]);
  }
  return out;
}

/**
 * Verlauf einer Fahrt: Linie auf der Karte und alle Halte mit Zeiten.
 * → { coords: [[lon, lat]], stops: [{ id, name, point, time, platform }], index }
 *   index: der Halt, an dem `dep` abfährt (−1, wenn nicht gefunden)
 * @param dep  Abfahrt aus departures() bzw. `course` eines Abschnitts aus trips()
 */
export async function tripCourse(dep, { signal, feature = null } = {}) {
  const c = dep.course ?? dep;
  if (!c?.ref) throw new Error('Zu dieser Fahrt gibt es keinen Verlauf.');
  const d = await hafas('journeyDetail', { id: c.ref, poly: '1', polyEnc: 'N' }, signal, feature);
  const raw = list(d.Stops?.Stop);
  if (!raw.length) throw new Error('Zu dieser Fahrt gibt es keinen Verlauf.');
  const all = raw.map((x) => {
    const dep_ = times(x, 'dep'), arr = times(x, 'arr');
    const tm = dep_.real ?? dep_.plan ?? arr.real ?? arr.plan;
    return {
      extId: x.extId, id: ifoptOf(x) || x.extId || '', name: x.name ?? '', point: point(x), time: tm ?? null,
      platform: trackOf(x, 'dep') || trackOf(x, 'arr'), plan: dep_.plan ?? arr.plan,
    };
  });
  let index = all.findIndex((x) => c.stopId && x.extId === c.stopId && (!c.time || !x.plan || Math.abs(x.plan - c.time) < 3600000));
  if (index < 0) index = all.findIndex((x) => c.name && x.name === c.name && (!c.time || !x.plan || Math.abs(x.plan - c.time) < 3600000));
  // Halte ohne Koordinaten bleiben aus Linie und Liste, der Index folgt der Liste
  const kept = all.filter((x) => x.point);
  if (index >= 0) index = kept.indexOf(all[index]);
  const stops = kept.map(({ id: sid, name, point: pt, time, platform }) => ({ id: sid, name, point: pt, time, platform }));
  const line = polyline(d.PolylineGroup);
  return { coords: line.length >= 2 ? line : stops.map((x) => x.point), stops, index };
}

/* ── Verbindungen von A nach B ──────────────────────────────────────────── */

/** ISO-Dauer „PT1H23M“ → Sekunden */
function seconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}

function parseLeg(l) {
  const walk = WALKING.has(l.type) || !l.JourneyDetailRef;
  const o = times(l.Origin), z = times(l.Destination);
  const p = walk ? null : list(l.Product)[0];
  const cls = walk ? null : classOf(p);
  const raw = list(l.Stops?.Stop);
  const stopList = walk ? [] : (raw.length ? raw : [l.Origin, l.Destination]).map((x, i, a) => {
    const last = i === a.length - 1;
    const t = x === l.Origin || x === l.Destination ? times(x) : times(x, last ? 'arr' : 'dep');
    const alt = times(x, last ? 'dep' : 'arr');
    const tm = t.real ?? t.plan ?? alt.real ?? alt.plan;
    return {
      name: x.name ?? '', time: tm ?? null, point: point(x),
      platform: trackOf(x, last ? 'arr' : 'dep') || trackOf(x) || trackOf(x, last ? 'dep' : 'arr') || (i === 0 ? trackOf(l.Origin) : last ? trackOf(l.Destination) : ''),
    };
  });
  const ends = [point(l.Origin), point(l.Destination)].filter(Boolean);
  const pts = stopList.map((s) => s.point).filter(Boolean);
  const dep = o.real ?? o.plan, arr = z.real ?? z.plan;
  return {
    walk, cls,
    line: walk ? '' : lineOf(p, cls) || l.name || '',
    product: walk ? '' : (NAMES[cls] ?? p?.catOutL ?? ''),
    to_: walk ? '' : (l.direction ?? ''),
    from: l.Origin?.name ?? '', to: l.Destination?.name ?? '',
    dep, arr, planned: o.plan, plannedArr: z.plan,
    delay: !walk && o.real && o.plan ? minutes(o.plan, o.real) : null,
    platform: walk ? '' : trackOf(l.Origin), platformTo: walk ? '' : trackOf(l.Destination),
    stops: Math.max(0, (walk ? 0 : stopList.length) - 1),
    stopList, steps: [],
    distance: l.dist ?? 0,
    duration: walk ? seconds(l.duration) : Math.round((arr - dep) / 1000),
    coords: walk || pts.length < 2 ? ends : pts,
    course: walk ? null : { ref: l.JourneyDetailRef.ref, stopId: l.Origin?.extId ?? '', name: l.Origin?.name ?? '', time: o.plan },
  };
}

/** Produktbits zu den erlaubten EFA-Klassen (null: alle) */
function productBits(classes) {
  if (!classes) return null;
  return classes.reduce((bits, c) => bits | (BITS[c] ?? 0), 0) || null;
}

/**
 * Verbindungen → [[leg, …], …]; jede Verbindung ist die Liste ihrer Abschnitte
 * @param o.when     Abfahrt ab bzw. Ankunft bis (Date)
 * @param o.arrive   true: `when` ist die Ankunft bis
 * @param o.classes  erlaubte EFA-Klassen (null: alle)
 * @param o.slow     mehr Zeit zum Umsteigen
 */
export async function trips(from, to, { when = new Date(), arrive = false, classes = null, slow = false, signal, feature = null } = {}) {
  const bits = productBits(classes);
  const d = await hafas('trip', {
    originCoordLat: from[1].toFixed(6), originCoordLong: from[0].toFixed(6),
    destCoordLat: to[1].toFixed(6), destCoordLong: to[0].toFixed(6),
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`, time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
    ...(arrive ? { searchForArrival: '1' } : {}),
    numF: '5', passlist: '1',
    ...(bits ? { products: String(bits) } : {}),
    ...(slow ? { addChangeTime: '5', changeTimePercent: '150' } : {}),
  }, signal, feature);
  const out = list(d.Trip).map((t) => list(t.LegList?.Leg).map(parseLeg)).filter((legs) => legs.length && legs.every((l) => l.dep && l.arr));
  if (!out.length) throw new Error('Keine Verbindung gefunden.');
  return out;
}
