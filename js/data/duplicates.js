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
 * kann man jede: ihre Strecke (GPS), Zeit und Kilometer gelten. Haben
 * mehrere Aufzeichnungen Gesundheitsdaten (zwei Uhren, Uhr und Brustgurt),
 * wählt man auch, von welcher Puls, Frequenz und Leistung kommen
 * (withValuesFrom). Was sonst nur die anderen haben, kommt dazu (merge):
 * Kennung, Beschreibung und fehlende Messwerte – nach der Uhrzeit auf die
 * Punkte der bleibenden übertragen. Die anderen werden normal gelöscht – der
 * Ordner-Abgleich trägt sie in Gelöscht.json ein, andere Geräte löschen sie
 * dann auch.
 */
import { tracks, sameActivity, trackEnd } from './tracks.js';
import { tours } from './store.js';

const VALUES = ['hr', 'cad', 'pow'];
// Karteikarte (Weg liegt nur im Ordner): sie weiß, welche Messwerte die Datei hat
const hasValues = (t, k) => (t.stub ? !!t.has?.includes(k) : Array.isArray(t[k]) && t[k].some((v) => v > 0));

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
    if (hasValues(out, k) || !hasValues(other, k) || out.stub || other.stub) continue;
    const v = valuesAt(other, k, out);
    if (v) out = { ...out, [k]: v };
  }
  return out;
}

/** Hat die Aufzeichnung Gesundheitsdaten (Puls, Frequenz, Leistung)? – auch für Karteikarten */
export const valueKinds = (t) => VALUES.filter((k) => hasValues(t, k));

/**
 * Die Gesundheitsdaten von `src` gelten: Puls, Frequenz und Leistung, die
 * `src` hat, ersetzen die von `keep` (nach der Uhrzeit auf dessen Punkte
 * übertragen). Passt die Zeit nicht (kein Wert in 60 s Nähe), bleibt, was
 * `keep` hatte.
 */
export function withValuesFrom(keep, src) {
  if (!src || src === keep || keep.stub || src.stub) return keep;
  let out = keep;
  for (const k of VALUES) {
    if (!hasValues(src, k)) continue;
    const v = valuesAt(src, k, keep);
    if (v) out = { ...out, [k]: v };
  }
  return out;
}

/* ── Import: Datei zu einem Weg, den es schon gibt (pages/import.js) ───────── */

/** Punkte eines Wegs – die Karteikarte kennt die Zahl ihrer Datei */
const pointCount = (t) => (t.stub ? t.n ?? 0 : t.times?.length ?? 0);
const meanOf = (t, k) => { const v = (t[k] ?? []).filter((x) => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

/**
 * Was die Datei `file` mehr oder anders hat als derselbe Weg `keep` hier →
 *   add     Messwerte, die hier fehlen (kommen ohne Rückfrage dazu)
 *   differ  Messwerte, die beide haben und die sich unterscheiden (Schnitt über 3 %) – Rückfrage
 *   shape   die Datei hat die genauere Strecke (mindestens anderthalbmal so viele Punkte) – Rückfrage
 *   marks   die Datei hat Runden der Uhr, die hier fehlen (kommen dazu)
 *   points  [hier, Datei]
 */
export function gain(keep, file) {
  const add = VALUES.filter((k) => hasValues(file, k) && !hasValues(keep, k));
  const differ = keep.stub ? [] : VALUES.filter((k) => {
    if (!hasValues(file, k) || !hasValues(keep, k)) return false;
    const [a, b] = [meanOf(keep, k), meanOf(file, k)];
    return Math.abs(a - b) > Math.max(a, b) * 0.03;
  });
  const points = [pointCount(keep), pointCount(file)];
  const shape = points[1] >= points[0] * 1.5 && points[1] - points[0] >= 20;
  // Runden der Uhr, die hier fehlen
  const marks = !keep.marks?.length && file.marks?.length > 0;
  return { add, differ, shape, marks, points, any: add.length > 0 || differ.length > 0 || shape || marks };
}

const MEASURED = ['start', 'end', 'length', 'moving', 'top', 'shape', 'times', 'bbox'];

/**
 * Den Weg `keep` (ganz, keine Karteikarte) um die Datei `file` ergänzen. Name, Art, Farbe, Kennung und
 * Herkunft bleiben die von hier. Fehlende Messwerte kommen immer dazu;
 *   shape   Strecke, Zeiten und Kilometer der Datei gelten
 *   values  bei abweichenden Messwerten gelten die der Datei (sonst die von hier)
 * → neuer Weg, oder `keep` selbst, wenn nichts dazukam
 */
export function enrich(keep, file, { shape = false, values = false } = {}) {
  const g = gain(keep, file);
  if (!shape || !g.shape) {
    let out = merge(keep, file);
    if (g.marks) out = { ...out, marks: file.marks };
    return values && g.differ.length ? withValuesFrom(out, file) : out;
  }
  let out = { ...keep };
  for (const k of VALUES) delete out[k];
  for (const k of MEASURED) if (file[k] !== undefined) out[k] = file[k];
  for (const k of VALUES) {
    // Die eigenen Werte der Datei liegen schon auf ihren Punkten; die von hier werden nach der Uhrzeit übertragen
    const own = hasValues(file, k) && (values || !g.differ.includes(k));
    const v = own ? file[k] : hasValues(keep, k) ? valuesAt(keep, k, out) : hasValues(file, k) ? file[k] : null;
    if (v) out[k] = v;
  }
  if (!out.description && file.description) out = { ...out, description: file.description };
  // Runden der Datei gelten mit ihrer Zeit; hat sie keine, bleiben die von hier (gleicher Start)
  if (file.marks?.length) out.marks = file.marks;
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
 * Zusammenführen. `keepIds`: welche Aufzeichnung je Gruppe bleibt (IDs, ihre
 * Strecke gilt) – ohne Wahl die vorgeschlagene. `valueIds`: von welcher die
 * Gesundheitsdaten kommen – ohne Wahl die der bleibenden, sonst was die
 * anderen haben. → Anzahl entfernt
 */
export async function removeDuplicates(keepIds = [], valueIds = []) {
  const chosen = new Set(keepIds);
  const values = new Set(valueIds);
  const found = await findDuplicates();
  let n = 0;
  for (const cards of found.tracks) {
    // Ganz holen, was nur im Ordner liegt – sonst käme sein Puls nicht mit
    const group = await Promise.all(cards.map((t) => tracks.full(t).catch(() => t)));
    const keep = group.find((t) => chosen.has(t.id)) ?? group[0];
    const rest = group.filter((t) => t !== keep);
    const merged = rest.reduce(merge, withValuesFrom(keep, group.find((t) => values.has(t.id))));
    if (merged !== keep) await tracks.put({ ...merged, updated: Date.now() });
    for (const other of rest) { await tracks.remove(other.id); n += 1; }
  }
  for (const [, ...rest] of found.tours) {
    for (const other of rest) { tours.remove(other.id); n += 1; }
  }
  return n;
}
