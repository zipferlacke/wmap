/**
 * Bekannte Touren: Wander- und Radwege, die in OpenStreetMap als Route
 * erfasst sind – vom örtlichen Rundweg bis zum Fernwanderweg. Suche um einen
 * Ort, Übernahme mit dem Originalverlauf (fester Verlauf, siehe tour.js).
 *
 * Ablauf: Liste mit `out tags center` (schnell), erst beim Antippen die
 * Geometrie der einen Route; deren Wegstücke werden zu einer Linie verbunden.
 */
import { run } from './overpass.js';
import { encodeShare, shapeOf } from './store.js';
import { distance, simplify, simplifyTo } from './geo.js';

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
  const re = name.trim().replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
  const q = `[out:json][timeout:60];area["ISO3166-1"="DE"][admin_level=2]->.de;relation(area.de)["type"="route"]["route"~"^(${KINDS[kind].routes})$"]["name"~"${re}",i];out tags center 60;`;
  const list = toList(await run(q, signal), center);
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
 * → { routes: [… wie toList, dazu parent], parents: [{ id, name, ref, network, rank, length, children }] }
 */
export async function toursInBox([w, s, e, n], kind, { center = null, signal } = {}) {
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
  return { routes: routes.filter((r) => !parentIds.has(r.id)), parents };
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
export async function tourLine(id, { signal } = {}) {
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
  return { line: simplify(joinWays(ways), 3), tags: rel.tags, stages: rel.members.filter((m) => m.type === 'relation').length };
}

/** Route als Tour-Link (öffnet den Planer mit Originalverlauf). */
export async function tourLink(found, kind) {
  const { line, tags } = await tourLine(found.id);
  const shape = shapeOf(line.length > 1500 ? simplifyTo(line, 1500) : line);
  const desc = [found.network, found.ref && `Markierung ${found.ref}`, tags.symbol, found.description,
    `Quelle: OpenStreetMap, Route ${found.id}`].filter(Boolean).join(' · ');
  const code = await encodeShare({
    name: found.name, description: desc, profile: KINDS[kind].profile,
    points: simplifyTo(line, 20), fixed: true, shape,
  });
  return `./tour.html#t=${code}`;
}
