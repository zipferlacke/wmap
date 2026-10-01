/**
 * Doppelte Touren finden und zusammenführen – Abschnitt auf „Sicherung &
 * Synchronisation“ (pages/sync.js), nur wenn es welche gibt. Doppelt heißt:
 *
 *   Aufgezeichnete Touren  dieselbe Aktivität (sameActivity): dieselbe Datei
 *                          zweimal – oder aus zwei Quellen, etwa mit der Uhr
 *                          (Health Connect) und dem Handy aufgezeichnet oder
 *                          als GPX in den Ordner gelegt
 *   Geplante Touren        gleicher Verlauf und gleicher Name
 *
 * Je Gruppe bleibt eine Aufzeichnung – vorgeschlagen die mit den meisten
 * Angaben (Kennung aus Health Connect, Puls & Co., Beschreibung), wählen
 * kann man jede. Was nur die anderen haben, kommt dazu (merge): Kennung,
 * Beschreibung und Puls, Frequenz, Leistung – nach der Uhrzeit auf die
 * Punkte der bleibenden übertragen. Die anderen werden normal gelöscht – der
 * Ordner-Abgleich trägt sie in Gelöscht.json ein, andere Geräte löschen sie
 * dann auch.
 */
import { tracks, sameActivity, trackEnd } from './tracks.js';
import { tours } from './store.js';

const VALUES = ['hr', 'cad', 'pow'];
const hasValues = (t, k) => Array.isArray(t[k]) && t[k].some((v) => v > 0);

/** Wie viel steckt drin? – der Reichste wird vorgeschlagen */
function weight(t) {
  return (t.source?.health ? 8 : 0) + (hasValues(t, 'hr') ? 4 : 0) + (hasValues(t, 'cad') || hasValues(t, 'pow') ? 2 : 0) + (t.description ? 1 : 0);
}

/** Messwerte von `from` an den Zeitpunkten von `to` – der nächste Wert, höchstens 60 s entfernt */
function valuesAt(from, k, to) {
  const src = (from.times ?? []).map((s, i) => [from.start + s * 1000, from[k][i]]).filter(([, v]) => v > 0);
  if (!src.length) return null;
  let j = 0;
  const out = (to.times ?? []).map((s) => {
    const ms = to.start + s * 1000;
    while (j + 1 < src.length && Math.abs(src[j + 1][0] - ms) <= Math.abs(src[j][0] - ms)) j += 1;
    return Math.abs(src[j][0] - ms) <= 60000 ? src[j][1] : null;
  });
  return out.some((v) => v !== null) ? out : null;
}

/** `keep` um das ergänzen, was nur `other` hat → neuer Weg (oder `keep` selbst, wenn nichts fehlte) */
export function merge(keep, other) {
  let out = keep;
  if (other.source && Object.keys(other.source).some((k) => out.source?.[k] === undefined)) out = { ...out, source: { ...other.source, ...out.source } };
  if (!out.description && other.description) out = { ...out, description: other.description };
  for (const k of VALUES) {
    if (hasValues(out, k) || !hasValues(other, k)) continue;
    const v = valuesAt(other, k, out);
    if (v) out = { ...out, [k]: v };
  }
  return out;
}

/** → { tracks: [[vorgeschlagen, …doppelt]], tours: [[behalten, …doppelt]], count } */
export async function findDuplicates() {
  const list = (await tracks.all()).sort((a, b) => a.start - b.start);
  // Nach Start sortiert: in Frage kommen nur Gruppen, die noch nicht zu Ende
  // sind – ein anderer Weg dazwischen trennt ein Paar nicht
  const groups = [];
  for (const t of list) {
    let found = null;
    for (let i = groups.length - 1; i >= 0 && !found; i -= 1) {
      if (groups[i].until < t.start - 5000) continue;
      if (groups[i].items.some((x) => sameActivity(x, t))) found = groups[i];
    }
    if (found) { found.items.push(t); found.until = Math.max(found.until, trackEnd(t)); }
    else groups.push({ items: [t], until: trackEnd(t) });
  }
  const trackGroups = groups.filter((g) => g.items.length > 1).map((g) => g.items);

  const byTour = new Map();
  for (const t of tours.all()) {
    if (!t.shape) continue;
    const key = `${t.shape}|${t.name ?? ''}`;
    byTour.set(key, [...(byTour.get(key) ?? []), t]);
  }
  const tourGroups = [...byTour.values()].filter((g) => g.length > 1);

  const sorted = (g, score) => [...g].sort((a, b) => score(b) - score(a));
  const out = {
    tracks: trackGroups.map((g) => sorted(g, weight)),
    // Geplante: die zuletzt bearbeitete bleibt
    tours: tourGroups.map((g) => sorted(g, (t) => t.updated ?? t.created ?? 0)),
  };
  out.count = [...out.tracks, ...out.tours].reduce((n, g) => n + g.length - 1, 0);
  return out;
}

/**
 * Zusammenführen. `keepIds`: welche Aufzeichnung je Gruppe bleibt (IDs) –
 * ohne Wahl die vorgeschlagene. → Anzahl entfernt
 */
export async function removeDuplicates(keepIds = []) {
  const chosen = new Set(keepIds);
  const found = await findDuplicates();
  let n = 0;
  for (const group of found.tracks) {
    const keep = group.find((t) => chosen.has(t.id)) ?? group[0];
    const rest = group.filter((t) => t !== keep);
    const merged = rest.reduce(merge, keep);
    if (merged !== keep) await tracks.put({ ...merged, updated: Date.now() });
    for (const other of rest) { await tracks.remove(other.id); n += 1; }
  }
  for (const [, ...rest] of found.tours) {
    for (const other of rest) { tours.remove(other.id); n += 1; }
  }
  return n;
}
