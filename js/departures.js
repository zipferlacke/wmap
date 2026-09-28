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
 */
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

/**
 * Nächste Abfahrten → { stop, list: [{ time, delay, line, product, cls, to, platform, platformId, cancelled }] }
 * @param o.ifopt  IFOPT des angetippten Steigs (OSM „ref:IFOPT“), wenn bekannt
 */
export async function departures(point, { name = '', ifopt = '', limit = 40, signal } = {}) {
  const parts = ifopt.split(':');
  const stop = parts.length >= 3 && parts[0] === 'de' ? parts.slice(0, 3).join(':') : await stopNear(point, name, signal);
  if (!stop) return { stop: null, list: [] };
  const d = await efa('XML_DM_REQUEST', {
    name_dm: stop, type_dm: 'any', mode: 'direct', useRealtime: '1', limit: String(limit), depType: 'stopEvents',
  }, signal);
  const list = (d.stopEvents ?? []).map((e) => {
    const t = e.transportation ?? {};
    const planned = new Date(e.departureTimePlanned);
    const est = e.departureTimeEstimated ? new Date(e.departureTimeEstimated) : null;
    return {
      time: planned,
      delay: est ? Math.round((est - planned) / 60000) : null,
      line: t.disassembledName ?? t.number ?? t.name ?? '',
      product: t.product?.name ?? '',
      cls: t.product?.class ?? null,
      to: t.destination?.name ?? '',
      platform: e.location?.properties?.platform ?? e.location?.disassembledName ?? '',
      platformId: e.location?.id ?? '',
      cancelled: !!e.isCancelled,
    };
  }).filter((x) => !Number.isNaN(+x.time));
  return { stop: d.locations?.[0]?.name ?? stop, list };
}

/* ── Verbindungen von A nach B ──────────────────────────────────────────── */

const cum = (c) => { const out = [0]; for (let i = 1; i < c.length; i += 1) { const [a, b] = [c[i - 1], c[i]]; const k = Math.cos((a[1] * Math.PI) / 180); out.push(out[i - 1] + Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320); } return out; };
const bboxOf = (c) => [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
const WALK = /footpath|fußweg|walk/i;

/**
 * Verbindungen mit Bus und Bahn → Routen wie getRoutes, dazu `transit`:
 *   { dep, arr, changes, legs: [{ walk, line, product, cls, from, to, dep, arr, platform, stops }] }
 * @param when  Abfahrt ab (Date), sonst jetzt
 */
export async function journeys(from, to, { when = new Date(), signal } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = await efa('XML_TRIP_REQUEST2', {
    coordOutputFormat: COORD,
    type_origin: 'coord', name_origin: `${from[0].toFixed(5)}:${from[1].toFixed(5)}:${COORD}`,
    type_destination: 'coord', name_destination: `${to[0].toFixed(5)}:${to[1].toFixed(5)}:${COORD}`,
    itdDate: `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`,
    itdTime: `${pad(when.getHours())}${pad(when.getMinutes())}`,
    itdTripDateTimeDepArr: 'dep', calcNumberOfTrips: '4', useRealtime: '1',
  }, signal);
  const list = (d.journeys ?? []).map((j, id) => {
    const legs = (j.legs ?? []).map((l) => {
      const t = l.transportation ?? {};
      const walk = !t.product || WALK.test(t.product?.name ?? '') || t.product?.class === 99 || t.product?.class === 100;
      const time = (x, k) => new Date(x?.[`${k}TimeEstimated`] ?? x?.[`${k}TimePlanned`]);
      return {
        walk,
        line: walk ? '' : (t.disassembledName ?? t.number ?? t.name ?? ''),
        product: walk ? 'Fußweg' : (t.product?.name ?? ''),
        cls: t.product?.class ?? null,
        to_: t.destination?.name ?? '',
        from: l.origin?.name ?? '', to: l.destination?.name ?? '',
        dep: time(l.origin, 'departure'), arr: time(l.destination, 'arrival'),
        planned: new Date(l.origin?.departureTimePlanned),
        platform: l.origin?.properties?.platform ?? '',
        stops: Math.max(0, (l.stopSequence?.length ?? 1) - 1),
        duration: l.duration ?? 0,
        // EFA liefert [lat, lon]
        coords: (l.coords ?? []).map(([lat, lon]) => [lon, lat]),
      };
    });
    const coords = legs.flatMap((l) => l.coords);
    if (coords.length < 2) return null;
    const c = cum(coords);
    const dep = legs[0].dep, arr = legs.at(-1).arr;
    return {
      id, coords, cum: c, length: c.at(-1), time: (arr - dep) / 1000, bounds: bboxOf(coords),
      elevation: [], ascent: 0, descent: 0, maneuvers: [],
      transit: { dep, arr, changes: j.interchanges ?? Math.max(0, legs.filter((l) => !l.walk).length - 1), legs },
    };
  }).filter(Boolean);
  if (!list.length) throw new Error('Keine Verbindung mit Bus und Bahn gefunden');
  return list;
}
