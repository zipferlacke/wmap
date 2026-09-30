/**
 * Doppelte Touren finden und entfernen – Knopf auf „Sicherung & Synchronisation“
 * (pages/sync.js), nur wenn es welche gibt. Doppelt heißt:
 *
 *   Aufgezeichnete Touren  gleicher Start (± 5 s) und fast gleiche Länge
 *                          (sameTrack) – z. B. aus Health Connect und aus dem
 *                          Ordner der alten App
 *   Geplante Touren        gleicher Verlauf und gleicher Name
 *
 * Je Gruppe bleibt der Eintrag mit den meisten Angaben (Kennung aus Health
 * Connect, Puls & Co., Beschreibung); was nur die anderen haben (Kennung,
 * Messwerte bei gleicher Punktzahl), kommt dazu. Die anderen werden normal
 * gelöscht – der Ordner-Abgleich trägt sie in Gelöscht.json ein, andere
 * Geräte löschen sie dann auch.
 */
import { tracks, sameTrack } from './tracks.js';
import { tours } from './store.js';

const hasValues = (t, k) => Array.isArray(t[k]) && t[k].some((v) => v > 0);

/** Wie viel steckt drin? – der Reichste bleibt */
function weight(t) {
  return (t.source?.health ? 8 : 0) + (hasValues(t, 'hr') ? 4 : 0) + (hasValues(t, 'cad') || hasValues(t, 'pow') ? 2 : 0) + (t.description ? 1 : 0);
}

/** → { tracks: [[behalten, …doppelt]], tours: [[behalten, …doppelt]], count } */
export async function findDuplicates() {
  const list = (await tracks.all()).sort((a, b) => a.start - b.start);
  const trackGroups = [];
  let group = null;
  for (const t of list) {
    if (group && group.some((x) => sameTrack(x, t))) group.push(t);
    else {
      if (group?.length > 1) trackGroups.push(group);
      group = [t];
    }
  }
  if (group?.length > 1) trackGroups.push(group);

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

/** → Anzahl entfernt */
export async function removeDuplicates() {
  const found = await findDuplicates();
  let n = 0;
  for (const [keep, ...rest] of found.tracks) {
    let merged = keep;
    for (const other of rest) {
      if (!merged.source?.health && other.source?.health) merged = { ...merged, source: { ...other.source, ...merged.source } };
      for (const k of ['hr', 'cad', 'pow']) {
        if (!hasValues(merged, k) && hasValues(other, k) && other[k].length === (merged.times?.length ?? -1)) merged = { ...merged, [k]: other[k] };
      }
    }
    if (merged !== keep) await tracks.put({ ...merged, updated: Date.now() });
    for (const other of rest) { await tracks.remove(other.id); n += 1; }
  }
  for (const [, ...rest] of found.tours) {
    for (const other of rest) { tours.remove(other.id); n += 1; }
  }
  return n;
}
