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

/**
 * Zusammenführen mit Haken: was die Datei `file` anders hat als derselbe Weg `keep` (ganz, keine Karteikarte) →
 * [{ key: 'shape' | 'hr' | 'cad' | 'pow' | 'marks', detail, on }] – `on`: vorgeschlagen. Es gewinnen erst einmal
 * die genaueren Daten: was hier fehlt, kommt dazu; Abweichendes von der Seite mit mehr Punkten.
 */
export function choices(keep, file) {
  const [here, there] = [pointCount(keep), pointCount(file)];
  const out = [];
  if (here !== there) out.push({ key: 'shape', detail: `${Math.abs(there - here)} Punkte ${there > here ? 'mehr' : 'weniger'} in der Datei (${there} statt ${here})`, on: there > here });
  for (const k of VALUES) {
    if (!hasValues(file, k)) continue;
    const [a, b] = [meanOf(keep, k), meanOf(file, k)];
    if (!hasValues(keep, k)) out.push({ key: k, detail: `fehlt hier – in der Datei Ø ${Math.round(b)}`, on: true });
    else if (Math.abs(a - b) > Math.max(a, b) * 0.03) out.push({ key: k, detail: `Ø ${Math.round(b)} in der Datei, Ø ${Math.round(a)} hier`, on: there > here });
  }
  if (file.marks?.length) {
    if (!keep.marks?.length) out.push({ key: 'marks', detail: `${file.marks.length + 1} Runden in der Datei, hier keine`, on: true });
    else if (JSON.stringify(keep.marks) !== JSON.stringify(file.marks)) out.push({ key: 'marks', detail: `${file.marks.length + 1} Runden in der Datei, ${keep.marks.length + 1} hier`, on: false });
  }
  return out;
}

/** Was es zu fragen gibt: Hat die Datei nur die gröbere Strecke und sonst nichts anderes, nichts */
export function offers(keep, file) {
  const list = choices(keep, file);
  return list.some((x) => x.on || x.key !== 'shape') ? list : [];
}

/** Haken für `list`: was `choice` (Haken aus einer Rückfrage) nennt, sonst der Vorschlag */
export const picksFor = (list, choice = null) => Object.fromEntries(list.map((x) => [x.key, choice && typeof choice === 'object' && x.key in choice ? !!choice[x.key] : x.on]));

/**
 * `keep` mit dem aus `file`, was angehakt ist (`picks`: { shape, hr, cad, pow, marks }). Name, Art, Farbe,
 * Kennung und Herkunft bleiben die von hier. → neuer Weg, oder `keep` selbst, wenn nichts angehakt ist
 */
export function combine(keep, file, picks) {
  if (!['shape', ...VALUES, 'marks'].some((k) => picks[k])) return keep;
  let out = { ...keep };
  if (picks.shape) {
    for (const k of VALUES) delete out[k];
    for (const k of MEASURED) if (file[k] !== undefined) out[k] = file[k];
    for (const k of VALUES) {
      // Angehakt: die Werte der Datei (liegen schon auf ihren Punkten); sonst die von hier, nach der Uhrzeit übertragen
      const v = picks[k] && hasValues(file, k) ? file[k] : hasValues(keep, k) ? valuesAt(keep, k, out) : null;
      if (v) out[k] = v;
    }
  } else {
    for (const k of VALUES) {
      const v = picks[k] && hasValues(file, k) ? valuesAt(file, k, keep) : null;
      if (v) out[k] = v;
    }
  }
  if (picks.marks && file.marks?.length) out.marks = file.marks;
  if (!out.description && file.description) out.description = file.description;
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

/**
 * Doppelte zusammenführen mit Haken – wie beim Import (ui/duplicates-ask.js). Je Gruppe bleibt die vorgeschlagene
 * Aufzeichnung; `pick(keep, other, list)` sagt je doppelter, was von ihr kommt: Haken ({ shape, hr, … }), null
 * (der Vorschlag), 'later' (das Paar bleibt doppelt) oder 'abort' (nichts geschieht – geschrieben wird erst am
 * Ende). Doppelte geplante Touren sind gleich und gehen ohne Frage. → Anzahl entfernt, oder null (abgebrochen)
 */
export async function resolveDuplicates(pick = null) {
  const found = await findDuplicates();
  const plan = [];
  for (const cards of found.tracks) {
    const group = await Promise.all(cards.map((t) => tracks.full(t).catch(() => t)));
    let keep = group[0];
    const drop = [];
    for (const other of group.slice(1)) {
      // Karteikarte, deren Datei gerade nicht zu lesen ist: bleibt für später
      if (keep.stub || other.stub) continue;
      const list = choices(keep, other).map((x) => ({ ...x, detail: x.detail.replace('in der Datei', 'in der doppelten') }));
      const p = pick && offers(keep, other).length ? await pick(keep, other, list) : null;
      if (p === 'abort') return null;
      if (p === 'later') continue;
      let next = combine(keep, other, picksFor(list, p));
      if (other.source && Object.keys(other.source).some((k) => next.source?.[k] === undefined)) next = { ...next, source: { ...other.source, ...next.source } };
      if (!next.description && other.description) next = { ...next, description: other.description };
      keep = next;
      drop.push(other.id);
    }
    if (drop.length) plan.push({ keep: keep === group[0] ? null : keep, drop });
  }
  let n = 0;
  for (const { keep, drop } of plan) {
    if (keep) await tracks.put({ ...keep, updated: Date.now() });
    for (const id of drop) { await tracks.remove(id); n += 1; }
  }
  for (const [, ...rest] of found.tours) {
    for (const other of rest) { tours.remove(other.id); n += 1; }
  }
  return n;
}
