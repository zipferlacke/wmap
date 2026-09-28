/**
 * Verkehrslage auf Autobahnen – offene Daten der Autobahn GmbH des Bundes
 * (verkehr.autobahn.de): Sperrungen, Baustellen, Verkehrsmeldungen.
 *
 * Für Bundes-, Landes- und Kreisstraßen gibt es keine vergleichbare offene
 * Schnittstelle ohne Anmeldung; die Daten der Länder liegen verstreut und
 * meist als DATEX II im Mobilithek-Portal (Registrierung nötig).
 */
import { API } from '../core/config.js';
import { nearestOnLine } from '../core/geo.js';

const SERVICES = ['closure', 'roadworks', 'warning'];
const CACHE_MS = 5 * 60 * 1000;
const NEAR_M = 120;
const cache = new Map();

async function service(road, svc, signal) {
  const key = `${road}|${svc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const res = await fetch(`${API.autobahn}/${road}/services/${svc}`, { signal });
  if (!res.ok) throw new Error(`Autobahn-API: ${res.status}`);
  const data = await res.json();
  const items = data[svc] ?? data[Object.keys(data)[0]] ?? [];
  cache.set(key, { at: Date.now(), items });
  return items;
}

/** Welche Autobahnen befährt die Route? „A 7“, „A7“ → „A7“ */
function autobahnenOf(route) {
  const roads = new Set();
  for (const m of route.maneuvers ?? []) {
    for (const n of [...(m.street_names ?? []), ...(m.begin_street_names ?? [])]) {
      const hit = String(n).match(/^A\s?(\d{1,3})\b/);
      if (hit) roads.add(`A${hit[1]}`);
    }
  }
  return [...roads];
}

const truthy = (v) => v === true || v === 'true' || v === 'True';

/**
 * Meldungen auf der Route, in Fahrtrichtung, nach Entfernung sortiert.
 * → [{ kind, blocked, title, subtitle, lines, along, point, line }]
 */
export async function trafficAlong(route, { signal } = {}) {
  const roads = autobahnenOf(route);
  if (!roads.length) return [];
  const jobs = roads.flatMap((road) => SERVICES.map((svc) =>
    service(road, svc, signal).then((items) => items.map((it) => ({ it, svc })))));
  const results = await Promise.allSettled(jobs);
  if (signal?.aborted) return [];

  const out = [];
  const seen = new Set();
  for (const { it, svc } of results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))) {
    // Dieselbe Meldung kommt mitunter mehrfach mit eigener Kennung
    const same = `${it.title}|${it.subtitle}|${(it.description ?? []).slice(0, 3).join('|')}`;
    if (truthy(it.future) || seen.has(it.identifier) || seen.has(same)) continue;
    const p = [Number(it.coordinate?.long), Number(it.coordinate?.lat)];
    if (!p.every(Number.isFinite)) continue;
    const at = nearestOnLine(route.coords, route.cum, p);
    if (at.offset > NEAR_M) continue;

    // Richtung prüfen: Die Gegenfahrbahn liegt nur wenige Meter daneben. Hat
    // die Meldung eine Linie, muss sie entlang der Route vorwärts laufen.
    // Ohne Linie hilft `extent` („lat,lon,lat,lon“): Anfang und Ende der
    // Meldung, ebenfalls in Fahrtrichtung.
    const line = it.geometry?.type === 'LineString' ? it.geometry.coordinates : null;
    const ext = String(it.extent ?? '').split(',').map(Number);
    // Verglichen wird nur das Stück, das wirklich auf der Route liegt – eine
    // Baustelle kann weiter reichen, als man auf der Autobahn mitfährt.
    const pts = line?.length > 1 ? line
      : ext.length === 4 && ext.every(Number.isFinite) ? [[ext[1], ext[0]], [ext[3], ext[2]]] : [];
    const step = Math.max(1, Math.floor(pts.length / 30));
    const onRoute = [];
    for (let i = 0; i < pts.length; i += step) {
      const q = nearestOnLine(route.coords, route.cum, pts[i]);
      if (q.offset < NEAR_M) onRoute.push(q.along);
    }
    const last = pts.length ? nearestOnLine(route.coords, route.cum, pts[pts.length - 1]) : null;
    if (last && last.offset < NEAR_M) onRoute.push(last.along);
    if (onRoute.length >= 2 && onRoute[onRoute.length - 1] < onRoute[0] - 20) continue;
    seen.add(it.identifier);
    seen.add(same);
    out.push({
      kind: svc,
      blocked: truthy(it.isBlocked),
      title: String(it.title ?? '').replace(/^\s*A\d+\s*\|\s*/, ''),
      road: String(it.title ?? '').match(/^\s*(A\d+)/)?.[1] ?? '',
      subtitle: String(it.subtitle ?? '').trim(),
      lines: (it.description ?? []).map((l) => String(l).trim()).filter(Boolean),
      along: at.along,
      point: p,
      line,
    });
  }
  return out.sort((x, y) => x.along - y.along);
}

/** Kleine Sperrfläche um einen Punkt – für Valhallas exclude_polygons. */
export function avoidRing([lon, lat], meters = 60) {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]];
}
