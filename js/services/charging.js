/**
 * Ladesäulen mit Steckern und Belegung aus der Ladesäulen-Datenbank von MobiData BW (OCPDB, OCPI-Format):
 * ganz Deutschland aus dem Ladesäulenregister der Bundesnetzagentur, dazu Echtzeit-Belegung der Betreiber, die sie
 * melden (EnBW, chargecloud, ecomovement …). Offen, ohne Schlüssel, Abruf aus dem Browser erlaubt.
 *
 *   chargersNear(point, radius)      → Standorte im Umkreis, nach Entfernung, je Ort einer (siehe merge)
 *   chargerAt(point)                 → der Standort zu einer Ladesäule auf der Karte (bis 80 m), sonst null
 *   freeChargers(point, plugs, n)    → die n nächsten Standorte mit mindestens einem freien Ladepunkt mit einem der
 *                                      Stecker `plugs` (leer: jeder Stecker); sucht in Stufen bis 25 km, höchstens
 *                                      LIMIT Standorte je Stufe; `open`: nur, was gerade offen hat
 *
 * Ein Standort: { id, name, operator, address, point, dist, live, total, free, busy, broken, plugs, open, updated }
 *   plugs: [{ type, kw, total, free, busy, broken }] je Steckerart, die stärkste Leistung zuerst
 *   live:  ob der Betreiber die Belegung meldet; sonst zählen die Ladepunkte nur in `total`
 *   open:  nach den Öffnungszeiten gerade offen (true/false), null ohne Angabe
 */
import { distance } from '../core/geo.js';
import { feature, used } from './usage.js';

export const OCPDB = 'https://api.mobidata-bw.de/ocpdb/api/public/v1/locations';

/** Steckerarten in der Reihenfolge der Auswahl; `other` fasst den Rest zusammen */
export const PLUGS = ['ccs', 'type2', 'chademo', 'tesla', 'schuko', 'other'];
const STANDARD = {
  IEC_62196_T2_COMBO: 'ccs', IEC_62196_T1_COMBO: 'ccs', IEC_62196_T2: 'type2', CHADEMO: 'chademo',
  TESLA_S: 'tesla', TESLA_R: 'tesla', DOMESTIC_F: 'schuko', DOMESTIC_E: 'schuko',
};
const FREE = new Set(['AVAILABLE']);
const BUSY = new Set(['CHARGING', 'BLOCKED', 'RESERVED']);
const BROKEN = new Set(['OUTOFORDER', 'INOPERATIVE']);
const GONE = new Set(['REMOVED', 'PLANNED']);
const SAME_PLACE = 30;          // m – zwei Einträge so nah beieinander sind ein Standort

const LIMIT = 1000;              // Standorte je Abfrage (etwa 5 KB je Standort)

/** → { items, full } – full: es gab mehr als LIMIT, `items` ist dann ein Ausschnitt (nicht nach Entfernung) */
async function fetchArea(point, radius, signal, feat) {
  used('ocpdb', feat);
  const [lon, lat] = point;
  const res = await fetch(`${OCPDB}?${new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: Math.round(radius), limit: LIMIT })}`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  const d = await res.json();
  return { items: d.items ?? [], full: d.next_offset != null };
}

/**
 * OCPI-Öffnungszeiten → offen zur Zeit `now` (Uhrzeit des Geräts), null ohne Angabe. regular_hours: weekday 1 = Montag,
 * ein Ende vor dem Beginn reicht über Mitternacht; exceptional_closings (ISO-Zeiten) schließen.
 */
export function openNow(ot, now = new Date()) {
  if (!ot) return null;
  if ((ot.exceptional_closings ?? []).some((c) => Date.parse(c.period_begin) <= now && now < Date.parse(c.period_end))) return false;
  if (ot.twentyfourseven) return true;
  const hours = ot.regular_hours ?? [];
  if (!hours.length) return null;
  const min = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
  const day = ((now.getDay() + 6) % 7) + 1, prev = ((day + 5) % 7) + 1;
  const t = now.getHours() * 60 + now.getMinutes();
  return hours.some((r) => {
    const a = min(r.period_begin), b = min(r.period_end);
    if (a < b) return r.weekday === day && a <= t && t < b;
    return (r.weekday === day && t >= a) || (r.weekday === prev && t < b);
  });
}

/** OCPI-Standort → kurzer Standort (siehe oben) */
export function summarize(l, from = null) {
  const c = l.coordinates ?? {};
  const point = [Number(c.lon ?? c.longitude), Number(c.lat ?? c.latitude)];
  const plugs = new Map();
  let total = 0, free = 0, busy = 0, broken = 0, live = false;
  for (const e of l.evses ?? []) {
    if (GONE.has(e.status) || e.presence === 'ABSENT') continue;
    total += 1;
    const isFree = FREE.has(e.status), isBusy = BUSY.has(e.status), isBroken = BROKEN.has(e.status);
    if (isFree || isBusy || isBroken) live = true;
    free += isFree; busy += isBusy; broken += isBroken;
    // Ein Ladepunkt mit zwei Steckerarten zählt bei beiden
    const types = new Map();
    for (const c of e.connectors ?? []) {
      const type = STANDARD[c.standard] ?? 'other';
      types.set(type, Math.max(types.get(type) ?? 0, (c.max_electric_power ?? 0) / 1000));
    }
    for (const [type, kw] of types) {
      const p = plugs.get(type) ?? { type, kw: 0, total: 0, free: 0, busy: 0, broken: 0 };
      p.kw = Math.max(p.kw, kw);
      p.total += 1; p.free += isFree; p.busy += isBusy; p.broken += isBroken;
      plugs.set(type, p);
    }
  }
  return {
    id: String(l.id), name: l.name || '', operator: l.operator?.name || '',
    address: [l.address, [l.postal_code, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    point, dist: from ? distance(from, point) : null, live, total, free, busy, broken,
    plugs: [...plugs.values()].sort((a, b) => b.kw - a.kw), open: openNow(l.opening_times),
    updated: l.last_updated ? Date.parse(l.last_updated) : null,
  };
}

/**
 * Doppelte Einträge zusammenlegen: Dieselbe Säule steht oft im Register der Bundesnetzagentur und noch einmal beim
 * Betreiber mit Belegung. Von Einträgen näher als SAME_PLACE bleibt der mit Belegung (sonst der mit mehr Ladepunkten).
 */
function merge(list) {
  const better = (a, b) => (a.live !== b.live ? a.live : a.total >= b.total);
  const out = [];
  for (const s of [...list].sort((a, b) => Number(b.live) - Number(a.live) || b.total - a.total)) {
    const twin = out.findIndex((o) => distance(o.point, s.point) < SAME_PLACE);
    if (twin < 0) out.push(s);
    else if (better(s, out[twin])) out[twin] = s;
  }
  return out;
}

/** → Standorte nach Entfernung; `.full`: mehr als LIMIT im Umkreis, die Liste ist ein Ausschnitt */
export async function chargersNear(point, radius, { signal, feature: feat = null } = {}) {
  const { items, full } = await fetchArea(point, radius, signal, feat);
  const list = merge(items.map((l) => summarize(l, point)).filter((s) => s.total)).sort((a, b) => a.dist - b.dist);
  list.full = full;
  return list;
}

export async function chargerAt(point, { signal } = {}) {
  feature('charger_card');
  const [best] = (await chargersNear(point, 80, { signal, feature: 'charger_card' })).filter((s) => s.dist <= 80);
  return best ?? null;
}

/** Freie Ladepunkte mit einem der Stecker (leer: jeder) */
export const freeFor = (s, plugs = []) => (plugs.length ? s.plugs.filter((p) => plugs.includes(p.type)).reduce((n, p) => n + p.free, 0) : s.free);
/** Hat der Standort einen der Stecker (leer: ja) */
export const hasPlug = (s, plugs = []) => !plugs.length || s.plugs.some((p) => plugs.includes(p.type));

export const STEPS = [1000, 3000, 8000, 25000];

export async function freeChargers(point, plugs = [], n = 5, { signal, steps = STEPS, open = false } = {}) {
  feature('chargers_free');
  let found = [];
  for (const radius of steps) {
    const all = await chargersNear(point, radius, { signal, feature: 'chargers_free' });
    found = all.filter((s) => freeFor(s, plugs) > 0 && !(open && s.open === false));
    // Genug gefunden – oder schon so viele Standorte, dass ein größerer Umkreis nur mehr Daten brächte
    if (found.length >= n || all.full) break;
  }
  return found.slice(0, n);
}
