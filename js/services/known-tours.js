/**
 * Bekannte Touren: Wander- und Radwege, die in OpenStreetMap als Route
 * erfasst sind – vom örtlichen Rundweg bis zum Fernwanderweg. Suche um einen
 * Ort, Übernahme mit dem Originalverlauf (fester Verlauf, siehe pages/tour.js).
 *
 * Ablauf: Liste mit `out tags center` (schnell), erst beim Antippen die
 * Geometrie der einen Route; deren Wegstücke werden zu einer Linie verbunden.
 *
 * Antippen der farbigen Linien und der Verlauf eines Wegs kommen zuerst von
 * Waymarked Trails (eigene Schnittstelle, ~0,1–0,3 s) – Overpass bleibt als
 * Rückfall, falls die nicht antwortet.
 */
import { run } from './overpass.js';
import { encodeShare } from '../data/store.js';
import { distance, simplify } from '../core/geo.js';
import { segment } from './routing.js';

export const KINDS = {
  hike: { label: 'Wandern', icon: 'hiking', routes: 'hiking|foot', profile: 'hike' },
  bike: { label: 'Rad', icon: 'directions_bike', routes: 'bicycle', profile: 'tour' },
  mtb: { label: 'Mountainbike', icon: 'landscape', routes: 'mtb', profile: 'mtb' },
};

/* Netz → Bedeutung: große Wege zuerst */
const NETWORK = {
  iwn: ['Europäischer Fernwanderweg', 0], nwn: ['Fernwanderweg', 1], rwn: ['Regionaler Wanderweg', 2], lwn: ['Örtlicher Wanderweg', 4],
  icn: ['Europäischer Radweg', 0], ncn: ['Radfernweg', 1], rcn: ['Regionaler Radweg', 2], lcn: ['Örtlicher Radweg', 4],
  rhn: ['Regionaler Wanderweg', 2], nhn: ['Fernwanderweg', 1], lhn: ['Örtlicher Wanderweg', 4],
};

/* ── Waymarked Trails ──────────────────────────────────────────────────────
 *
 * Dieselben Daten wie die farbigen Linien auf der Karte. Ausschnitte und
 * Verläufe in Web-Mercator-Metern (EPSG:3857).
 */
const WMT_HOST = { hike: 'hiking', bike: 'cycling', mtb: 'mtb' };
const WMT_RANK = { INT: 0, NAT: 1, REG: 2, LOC: 4 };
const WMT_LABEL = {
  hike: { INT: 'Europäischer Fernwanderweg', NAT: 'Fernwanderweg', REG: 'Regionaler Wanderweg', LOC: 'Örtlicher Wanderweg' },
  bike: { INT: 'Europäischer Radweg', NAT: 'Radfernweg', REG: 'Regionaler Radweg', LOC: 'Örtlicher Radweg' },
  mtb: { INT: 'Internationale MTB-Strecke', NAT: 'Nationale MTB-Strecke', REG: 'Regionale MTB-Strecke', LOC: 'Örtliche MTB-Strecke' },
};
const R = 6378137;
const toMerc = ([lon, lat]) => [(lon * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
const fromMerc = ([x, y]) => [(x / R) * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

async function wmt(kind, path, signal) {
  const r = await fetch(`https://${WMT_HOST[kind]}.waymarkedtrails.org/api/v1/${path}`, { signal });
  if (!r.ok) throw new Error(r.status === 404 ? 'Route nicht gefunden' : `Waymarked Trails antwortet mit ${r.status}`);
  return r.json();
}

/** Bild des Wegzeichens (SVG von Waymarked Trails) */
const wmtSymbol = (kind, symbolId) => `https://${WMT_HOST[kind]}.waymarkedtrails.org/api/v1/symbols/id/${encodeURIComponent(symbolId)}.svg`;

/**
 * Wege genau an einer Stelle – für das Antippen der farbigen Linien.
 * @param meters  Spielraum um den Punkt (ein paar Pixel, je nach Zoom)
 * → [{ id, name, ref, network, rank, symbol, symbolText, … wie toList }]
 */
export async function toursAt(point, kind, { meters = 30, signal } = {}) {
  const [x, y] = toMerc(point);
  // In Mercator-Metern ist die Welt bei uns um 1/cos(Breite) gestreckt
  const r = meters / Math.cos((point[1] * Math.PI) / 180);
  const { results } = await wmt(kind, `list/by_area?bbox=${[x - r, y - r, x + r, y + r].map((v) => v.toFixed(0)).join(',')}&limit=20`, signal);
  return fromWmt(kind, results).sort((a, b) => a.rank - b.rank);
}

/** Trefferliste von Waymarked Trails → Einträge wie toList */
function fromWmt(kind, results) {
  return results.filter((t) => t.type === 'relation').map((t) => ({
    id: t.id, name: t.name || t.ref || 'Weg ohne Namen', ref: t.ref ?? '',
    network: WMT_LABEL[kind][t.group] ?? 'Weg', rank: WMT_RANK[t.group] ?? 3,
    length: null, round: false, description: '', dist: null, center: null,
    symbol: t.symbol_id ? wmtSymbol(kind, t.symbol_id) : null, symbolText: t.symbol_description ?? '',
  }));
}

/** Verlauf von Waymarked Trails: Abschnitte der Reihe nach, auch bei Gesamtwegen */
async function wmtLine(id, kind, signal) {
  const d = await wmt(kind, `details/relation/${id}`, signal);
  const sections = [];
  const walk = (node) => {
    const ways = (node.ways ?? []).filter((w) => w.geometry?.type === 'LineString' && w.geometry.coordinates.length > 1)
      .map((w) => w.geometry.coordinates.map(fromMerc));
    if (ways.length) sections.push(joinWays(ways));
    for (const c of [...(node.main ?? [])].sort((a, b) => (+a.start || 0) - (+b.start || 0))) walk(c);
  };
  walk(d.route ?? {});
  if (!sections.length) throw new Error('Diese Route hat keinen Verlauf');
  return {
    line: simplify(joinWays(sections), 3),
    sections: sections.map((sec) => simplify(sec, 3)),
    tags: { ...d.tags, symbol: d.symbol_description ?? d.tags?.symbol },
    stages: Object.keys(d.subroutes ?? {}).length,
    info: {
      from: d.itinerary?.[0] ?? null, to: d.itinerary?.at(-1) ?? null, via: d.itinerary ?? [],
      length: d.official_length ?? d.route?.length ?? null, mapped: d.route?.length ?? null,
      description: d.description ?? '', url: d.url ?? d.tags?.website ?? '', wikipedia: d.wikipedia ?? null,
      symbol: d.symbol_id ? wmtSymbol(kind, d.symbol_id) : null, network: WMT_LABEL[kind][d.group] ?? null,
      round: d.tags?.roundtrip === 'yes',
    },
  };
}

/** Routen um einen Punkt. → [{ id, name, ref, kind, network, rank, length, dist }] */
export async function findTours(center, kind, { radius = 20000, signal } = {}) {
  const [lon, lat] = center;
  const q = `[out:json][timeout:25];relation["type"="route"]["route"~"^(${KINDS[kind].routes})$"]["name"](around:${radius},${lat.toFixed(5)},${lon.toFixed(5)});out tags center 150;`;
  return toList(await run(q, signal), center);
}

/**
 * Routen nach Namen in ganz Deutschland – „Karstwanderweg“, „Malerweg“ …
 * Dauert ein paar Sekunden (Overpass durchsucht alle Routen).
 */
export async function searchTours(name, kind, { center = null, signal } = {}) {
  let list;
  try {
    // Waymarked Trails hat einen eigenen Suchindex – rund eine Sekunde
    const { results } = await wmt(kind, `list/search?query=${encodeURIComponent(name.trim())}&limit=60`, signal);
    list = fromWmt(kind, results);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Sonst Overpass über ganz Deutschland – das dauert
    const re = name.trim().replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
    const q = `[out:json][timeout:60];area["ISO3166-1"="DE"][admin_level=2]->.de;relation(area.de)["type"="route"]["route"~"^(${KINDS[kind].routes})$"]["name"~"${re}",i];out tags center 60;`;
    list = toList(await run(q, signal), center);
  }
  // Treffer am Wortanfang zuerst
  const low = name.trim().toLowerCase();
  return list.sort((a, b) => (b.name.toLowerCase().startsWith(low) - a.name.toLowerCase().startsWith(low)) || (a.rank - b.rank));
}

function toList(els, center) {
  return els
    .filter((e) => !/-old$/.test(e.tags.network ?? '') && !/netz|network/i.test(e.tags.name))
    .map((e) => {
      const t = e.tags;
      const [label, rank] = NETWORK[t.network] ?? ['Weg', 3];
      const km = parseFloat(String(t.distance ?? '').replace(',', '.'));
      return {
        id: e.id, name: t.name, ref: t.ref ?? '', network: label, rank,
        length: Number.isFinite(km) ? km * 1000 : null,
        round: t.roundtrip === 'yes' || /rundweg|rundwanderweg|rundtour/i.test(t.name),
        description: t.description ?? t['description:de'] ?? '',
        dist: e.center && center ? distance(center, [e.center.lon, e.center.lat]) : null,
        center: e.center ? [e.center.lon, e.center.lat] : null,
      };
    })
    .sort((a, b) => (a.rank - b.rank) || ((a.dist ?? 1e9) - (b.dist ?? 1e9)));
}

/**
 * Routen im Kartenausschnitt – und der Gesamtweg, zu dem sie gehören (eine
 * Etappe des Harzer Hexenstiegs gehört zur Superroute „Harzer Hexenstieg“).
 *
 * Große Ausschnitte (Rechner, Zoom 10) werden auf MAX_BOX um die Mitte
 * begrenzt: Für jeden Weg den Mittelpunkt zu berechnen, dauerte sonst so lange,
 * dass alle Overpass-Server mit 504 abbrachen.
 * → { routes: [… wie toList, dazu parent], parents: [{ id, name, ref, network, rank, length, children }], clipped }
 */
const MAX_BOX = [0.9, 0.6];                     // Grad Länge × Breite

export async function toursInBox([w, s, e, n], kind, { center = null, signal } = {}) {
  const [cx, cy] = center ?? [(w + e) / 2, (s + n) / 2];
  const clipped = e - w > MAX_BOX[0] || n - s > MAX_BOX[1];
  if (e - w > MAX_BOX[0]) [w, e] = [cx - MAX_BOX[0] / 2, cx + MAX_BOX[0] / 2];
  if (n - s > MAX_BOX[1]) [s, n] = [cy - MAX_BOX[1] / 2, cy + MAX_BOX[1] / 2];
  const bb = [s, w, n, e].map((v) => v.toFixed(4)).join(',');
  const q = `[out:json][timeout:25];relation["type"="route"]["route"~"^(${KINDS[kind].routes})$"]["name"](${bb})->.r;.r out tags center 400;`
    + 'rel(br.r)["name"]["type"~"^(superroute|route)$"]->.p;.p out body;';
  const els = await run(q, signal);
  const withMembers = els.filter((x) => x.members);
  const routes = toList(els.filter((x) => !x.members && x.center), center);
  const inBox = new Set(routes.map((r) => r.id));
  const parents = toList(withMembers.map((x) => ({ ...x, center: null })), null)
    .map((p) => ({ ...p, children: withMembers.find((x) => x.id === p.id).members.filter((m) => m.type === 'relation').map((m) => m.ref) }))
    .filter((p) => p.children.some((c) => inBox.has(c)));
  for (const r of routes) {
    // Gehört eine Etappe zu mehreren (Europäischer Fernweg und nationaler Weg): der bedeutendere zählt
    const ps = parents.filter((p) => p.children.includes(r.id) && p.id !== r.id).sort((a, b) => a.rank - b.rank);
    r.parent = ps[0]?.id ?? null;
  }
  // Ein Gesamtweg, der selbst im Ausschnitt liegt, steht nicht noch einmal als Etappe da
  const parentIds = new Set(parents.map((p) => p.id));
  return { routes: routes.filter((r) => !parentIds.has(r.id)), parents, clipped };
}

/** Wegstücke in Reihenfolge zu einer Linie, jedes passend gedreht */
function joinWays(ways) {
  let line = ways[0].slice();
  for (let i = 1; i < ways.length; i += 1) {
    let w = ways[i];
    const end = line.at(-1);
    // Anfang: vielleicht muss schon das erste Stück andersherum
    if (i === 1 && Math.min(distance(line[0], w[0]), distance(line[0], w.at(-1))) < Math.min(distance(end, w[0]), distance(end, w.at(-1)))) line.reverse();
    const e = line.at(-1);
    if (distance(e, w.at(-1)) < distance(e, w[0])) w = w.slice().reverse();
    line = line.concat(distance(e, w[0]) < 1 ? w.slice(1) : w);
  }
  return line;
}

const waysOf = (rel) => rel.members.filter((m) => m.type === 'way' && m.geometry?.length > 1)
  .map((m) => m.geometry.map((p) => [p.lon, p.lat]));

/**
 * Verlauf einer Route. Ein Gesamtweg (Superroute) besteht aus Etappen – dann
 * werden deren Verläufe der Reihe nach aneinandergehängt (bis 60 Etappen).
 */
const lineCache = new Map();

export async function tourLine(id, { signal, kind = null } = {}) {
  if (kind) {
    // Einmal geladen reicht – „Im Planer öffnen“ braucht denselben Verlauf gleich wieder
    const key = `${kind}:${id}`;
    if (!lineCache.has(key)) lineCache.set(key, wmtLine(id, kind, signal));
    try { return await lineCache.get(key); } catch (err) {
      lineCache.delete(key);
      if (err.name === 'AbortError') throw err;
      // sonst weiter mit Overpass
    }
  }
  const [rel] = await run(`[out:json][timeout:60];relation(${id});out geom;`, signal);
  if (!rel) throw new Error('Route nicht gefunden');
  let ways = waysOf(rel);
  if (!ways.length) {
    const order = rel.members.filter((m) => m.type === 'relation').map((m) => m.ref);
    if (!order.length) throw new Error('Diese Route hat keinen Verlauf');
    if (order.length > 60) throw new Error('Dieser Weg ist zu lang für einmal – bitte eine Etappe wählen');
    const kids = await run(`[out:json][timeout:90];relation(${id});rel(r);out geom;`, signal);
    const lines = order.map((ref) => kids.find((k) => k.id === ref)).filter(Boolean).map(waysOf).filter((w) => w.length).map(joinWays);
    if (!lines.length) throw new Error('Diese Route hat keinen Verlauf');
    ways = lines;
  }
  const line = simplify(joinWays(ways), 3);
  return { line, sections: [line], tags: rel.tags, stages: rel.members.filter((m) => m.type === 'relation').length, info: null };
}

const lengthOf = (c) => c.reduce((s, p, i) => (i ? s + distance(c[i - 1], p) : 0), 0);
const ends = (c) => [c[0], c.at(-1)];
const gapBetween = (a, b) => Math.min(...ends(a).flatMap((p) => ends(b).map((q) => distance(p, q))));

/**
 * Ein lückenhaft erfasster Weg (Karstwanderweg: sieben Stücke, bis zu 87 km
 * dazwischen) als eine durchgehende Linie: winzige Bruchstücke weit abseits
 * fallen weg, die Stücke werden passend gedreht, und jede Lücke über 150 m
 * wird über echte Wege geroutet statt als gerade Linie gezogen.
 * → { line, bridged }  bridged = Anzahl geschlossener Lücken
 */
async function connected(sections, kind, signal) {
  const secs = sections.filter((c, i) => sections.length === 1 || lengthOf(c) >= 1500
    || sections.some((o, j) => j !== i && gapBetween(c, o) < 3000));
  const pieces = chain(secs);
  let line = pieces[0];
  let bridged = 0;
  for (const piece of pieces.slice(1)) {
    const a = line.at(-1), b = piece[0];
    if (distance(a, b) > 150) {
      try {
        const r = await segment(a, b, KINDS[kind].profile, { signal });
        line = line.concat(r.coords);
        bridged += 1;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        // Routing geht nicht: dann eben gerade
      }
    }
    line = line.concat(piece);
  }
  return { line, bridged };
}

/**
 * Stücke der Lage nach aneinanderreihen – die Reihenfolge in OSM stimmt bei
 * lückenhaften Wegen oft nicht. Beginn am Ende, das von allen anderen Stücken
 * am weitesten weg liegt, dann jeweils das nächstgelegene Stück, passend
 * gedreht. Zum Schluss die Richtung wie in OSM (Anfang des ersten Stücks).
 */
function chain(secs) {
  const rest = secs.map((c) => c.slice());
  let start = null;
  rest.forEach((c, i) => ends(c).forEach((p, end) => {
    const near = Math.min(Infinity, ...rest.filter((_, j) => j !== i).flatMap((o) => ends(o).map((q) => distance(p, q))));
    if (!start || near > start.near) start = { i, end, near };
  }));
  const first = rest.splice(start.i, 1)[0];
  if (start.end === 1) first.reverse();
  const pieces = [first];
  while (rest.length) {
    const e = pieces.at(-1).at(-1);
    let best = null;
    rest.forEach((c, j) => ends(c).forEach((q, end) => {
      const d = distance(e, q);
      if (!best || d < best.d) best = { j, end, d };
    }));
    const w = rest.splice(best.j, 1)[0];
    if (best.end === 1) w.reverse();
    pieces.push(w);
  }
  const s0 = secs[0][0];
  if (distance(pieces.at(-1).at(-1), s0) < distance(pieces[0][0], s0)) {
    pieces.reverse();
    pieces.forEach((c) => c.reverse());
  }
  return pieces;
}

/** Der ganze Weg als eine Linie (Lücken geroutet) – für den Planer → { line, bridged, tags } */
export async function originalRoute(id, kind, { signal } = {}) {
  const { sections, tags } = await tourLine(id, { kind, signal });
  const { line, bridged } = await connected(sections, kind, signal);
  return { line: simplify(line, 3), bridged, tags };
}

/**
 * Route als Tour-Link: öffnet den Planer mit dem Weg als Vorlage im
 * Hintergrund – noch ohne eigene Strecke. Dort plant man selbst (Punkte auf
 * der Vorlage folgen ihr genau) oder übernimmt mit einem Klick den Verlauf.
 */
export async function tourLink(found, kind) {
  const { tags } = await tourLine(found.id, { kind });
  const desc = [found.network, found.ref && `Markierung ${found.ref}`, tags.symbol, found.description,
    `Quelle: OpenStreetMap, Route ${found.id}`].filter(Boolean).join(' · ');
  const code = await encodeShare({
    name: found.name, description: desc, profile: KINDS[kind].profile, points: [],
    backgrounds: [{ type: 'way', id: found.id, kind, name: found.name }],
  });
  return `./tour.html#t=${code}`;
}
