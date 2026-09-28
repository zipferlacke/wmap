/**
 * Meldungen unterwegs – wie bei Google „Stau“, „Unfall“, „Baustelle“ – und
 * Bestätigungen („Baustelle noch da? Ja/Nein“).
 *
 * Das sind keine Kartendaten für OpenStreetMap, sondern Lagemeldungen, die nach
 * Stunden veralten. Damit andere sie sehen, braucht es einen gemeinsamen
 * Speicher (REPORTS in core/config.js, Tabelle in tools/reports.sql). Ohne ihn
 * bleiben sie auf dem Gerät – dann verhindern sie wenigstens doppelte Fragen.
 */
import { REPORTS } from '../core/config.js';
import { local } from '../data/store.js';

export const REPORT_KINDS = {
  jam: { label: 'Stau', icon: 'traffic', color: '#e8590c' },
  accident: { label: 'Unfall', icon: 'car_crash', color: '#e03131' },
  roadworks: { label: 'Baustelle', icon: 'construction', color: '#f08c00' },
  hazard: { label: 'Gefahr', icon: 'warning', color: '#e8590c' },
  closure: { label: 'Sperrung', icon: 'block', color: '#e03131' },
};

const LOCAL = 'wmap.reports';
const KEEP_MS = 6 * 3600 * 1000;

export const reportsShared = () => !!(REPORTS.url && REPORTS.key);

const headers = () => ({ apikey: REPORTS.key, Authorization: `Bearer ${REPORTS.key}`, 'Content-Type': 'application/json' });

/**
 * Meldung oder Antwort speichern.
 * kind: jam | accident | roadworks | hazard | closure
 * answer: 'new' (selbst gemeldet), 'yes' (noch da), 'no' (nicht mehr da)
 */
export async function report({ kind, point, answer = 'new', ref = null }) {
  const item = { kind, lon: +point[0].toFixed(5), lat: +point[1].toFixed(5), answer, ref, at: Date.now() };
  const list = (local.get(LOCAL, []) ?? []).filter((r) => Date.now() - r.at < KEEP_MS);
  list.push(item);
  local.set(LOCAL, list.slice(-200));
  if (!reportsShared()) return { shared: false };
  try {
    const res = await fetch(`${REPORTS.url}/rest/v1/reports`, {
      method: 'POST', headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ kind, lon: item.lon, lat: item.lat, answer, ref }),
    });
    return { shared: res.ok };
  } catch { return { shared: false }; }
}

/** Schon gefragt bzw. beantwortet (lokal, 6 Stunden)? */
export function answered(ref) {
  return (local.get(LOCAL, []) ?? []).some((r) => r.ref === ref && Date.now() - r.at < KEEP_MS);
}

/**
 * Aktuelle Meldungen anderer in einem Rechteck [w, s, e, n] – nur mit Server.
 * Eine Meldung zählt, solange nicht mehr „nicht mehr da“ als „noch da“ kamen.
 * → [{ kind, point, count, at }]
 */
export async function reportsIn([w, s, e, n], { signal } = {}) {
  if (!reportsShared()) return [];
  const since = new Date(Date.now() - KEEP_MS).toISOString();
  const q = `lon=gte.${w}&lon=lte.${e}&lat=gte.${s}&lat=lte.${n}&created_at=gte.${since}&select=kind,lon,lat,answer,created_at`;
  const res = await fetch(`${REPORTS.url}/rest/v1/reports?${q}`, { headers: headers(), signal });
  if (!res.ok) return [];
  const rows = await res.json();
  // Nah beieinander (≈ 150 m) und gleiche Art zusammenfassen
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.kind}|${Math.round(r.lon * 700)}|${Math.round(r.lat * 700)}`;
    const g = groups.get(key) ?? { kind: r.kind, point: [r.lon, r.lat], yes: 0, no: 0, at: 0 };
    if (r.answer === 'no') g.no += 1; else g.yes += 1;
    g.at = Math.max(g.at, Date.parse(r.created_at));
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.yes > g.no).map((g) => ({ ...g, count: g.yes }));
}
