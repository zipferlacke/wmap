/**
 * Mehrere Dateien übernehmen – dieselbe Rückfrage auf allen drei Wegen:
 *
 *   Dateien wählen     „GPX/FIT öffnen“ (pages/import.js), „GPX/FIT importieren“ (pages/wege.js)
 *   Hineinziehen       auf „Meine Touren“ (pages/wege.js)
 *   Ordner             von Hand in den verbundenen Ordner gelegt – gefragt wird beim Start (ui/folder-inbox.js)
 *
 * Zusammenführen (Dateien zu Touren, die es schon gibt) – erst eine Frage für alle (askAll):
 *   Ja, überall die genaueren Daten   alle übernehmen; gibt es die Tour schon, gilt der Vorschlag
 *                                     (was fehlt, kommt dazu; Abweichendes von der Seite mit mehr Punkten)
 *   Selbst einstellen                 je Datei, die es als Tour schon gibt, die Haken (askOne, ui/merge-ask.js) –
 *                                     vorbelegt mit dem Vorschlag. Darunter „Weiter“, „Für alle Dateien so
 *                                     übernehmen“, „Für alle die genaueren Daten“ und „Später weitermachen“:
 *                                     Was bis dahin gewählt ist, gilt, diese und der Rest bleiben liegen –
 *                                     auch das ✕ heißt das. Neue Touren kommen ohne Frage dazu
 *   Nicht importieren                 (nur Ordner) die Dateien gehen nach „Unbekannte Dateien/“
 *   Abbrechen bzw. Später             (nur bei der ersten Frage) nichts passiert
 *
 * Neue Dateien im Ordner fragt askNewFiles vorher und für sich (ui/folder-inbox.js):
 *   Alle übernehmen                   mit allem, was in der Datei steht
 *   Auswählen                         je Datei, was mitkommt (Puls, Frequenz, Leistung, Runden – die Strecke immer);
 *                                     „Weiter“, „Für alle Dateien so übernehmen“, „Nicht importieren“ (nur diese),
 *                                     „Später weitermachen“ (diese und der Rest bleiben liegen, auch das ✕)
 *   Nicht importieren                 alle nach „Unbekannte Dateien/“ – dort löscht WMap sie nach 30 Tagen
 *   Später                            nichts passiert
 *
 * Doppelte Touren, die schon in der App sind, laufen genauso (ui/duplicates-ask.js).
 */
import { ask } from './dialogs.js';
import { askMerge } from './merge-ask.js';
import { bulk } from '../data/tracks.js';
import { takeFile, prepareMerge } from '../data/import-files.js';

/** Die Frage für alle → 'best' | 'each' | 'skip' (nur mit `skip`: Beschriftung des Knopfs) | null */
export async function askAll({ title, text, later = 'Abbrechen', icon = 'library_add', auto = false, skip = null }) {
  const how = await ask({
    auto, icon, title, className: 'import-ask stacked',
    text: `${text} Überall die genaueren Daten übernehmen?`,
    buttons: [
      { value: 'best', label: 'Ja, überall die genaueren Daten', icon: 'done_all', primary: true },
      { value: 'each', label: 'Selbst einstellen', icon: 'checklist' },
      ...(skip ? [{ value: 'skip', label: skip, icon: 'block' }] : []),
      { value: 'no', label: later },
    ],
  });
  return how === 'best' || how === 'each' || (skip && how === 'skip') ? how : null;
}

/** Ordner: „250 neue Dateien … Übernehmen?“ → 'take' | 'each' | 'skip' | null (später) */
export async function askNew({ title, text, later = 'Später', icon = 'drive_folder_upload', auto = false }) {
  const how = await ask({
    auto, icon, title, className: 'import-ask stacked',
    text: `${text} Übernehmen?`,
    buttons: [
      { value: 'take', label: 'Alle übernehmen', icon: 'done_all', primary: true },
      { value: 'each', label: 'Auswählen', icon: 'checklist' },
      { value: 'skip', label: 'Nicht importieren', icon: 'block' },
      { value: 'no', label: later },
    ],
  });
  return ['take', 'each', 'skip'].includes(how) ? how : null;
}

const day = (t) => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });
const km = (m) => `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',')} km`;

/**
 * Neue Dateien: [{ file, kind: 'new' | 'tour', start, length, has: [{ key, detail, on }], look }] – `has`: was die Datei
 * an Messwerten hat (data/duplicates.js dataOf), `look`: { sport, profile } für die Namen.
 * → null (später) | { rest: 'take' | 'skip' | 'later' | Haken, files: Map(item → 'take' | 'skip' | Haken) } –
 * Haken { hr, cad, pow, marks }: was false ist, bleibt weg
 */
export async function askNewFiles(items, opts = {}) {
  const how = await askNew(opts);
  if (!how) return null;
  const out = { rest: how, files: new Map() };
  if (how !== 'each') return out;
  out.rest = 'take';
  for (const [i, x] of items.entries()) {
    const last = i >= items.length - 1;
    const what = [x.start && day(x.start), x.length > 0 && km(x.length)].filter(Boolean).join(', ');
    const r = await askMerge(x.look ?? {}, x.has ?? [], {
      title: items.length > 1 ? `Neue Datei (${i + 1} von ${items.length})` : 'Neue Datei',
      icon: 'download', cancel: false, go: last ? 'Übernehmen' : 'Weiter',
      from: `„${x.file}“${what ? ` (${what})` : ''}. Was willst du übernehmen?`,
      note: x.kind === 'tour' ? 'Eine geplante Tour – ohne Zeiten.' : x.has?.length ? 'Strecke, Zeit und Kilometer kommen immer mit.' : 'Nur die Strecke – sonst keine Messwerte in der Datei.',
      extra: [
        ...(last ? [] : [{ value: 'same', label: 'Für alle Dateien so übernehmen', icon: 'done_all', picks: true }]),
        { value: 'skip', label: 'Nicht importieren', icon: 'block' },
        { value: 'later', label: 'Später weitermachen', icon: 'schedule' },
      ],
    });
    if (!r || r === 'later') { out.rest = 'later'; return out; }
    if (r === 'skip') { out.files.set(x, 'skip'); continue; }
    if (r.value === 'same') { out.files.set(x, r.picks); out.rest = r.picks; return out; }
    out.files.set(x, Object.values(r).includes(false) ? r : 'take');
  }
  return out;
}

/**
 * Die Haken für eine Datei (Nummer `i` von `n`, ab 0) → Haken | { same: Haken } (für alle so) | 'best' (für
 * diese und den Rest die genaueren) | 'later' (diese und der Rest bleiben – auch beim Schließen mit ✕)
 */
export async function askOne(keep, list, { fileName = '', from = null, newName = null, oldName = null, i = 0, n = 1 } = {}) {
  const last = i >= n - 1;
  const r = await askMerge(keep, list, {
    fileName, from, newName, oldName, cancel: false,
    title: n > 1 ? `Zusammenführen (${i + 1} von ${n})` : 'Zusammenführen',
    go: last ? 'Zusammenführen' : 'Weiter',
    extra: last ? [{ value: 'later', label: 'Später weitermachen', icon: 'schedule' }] : [
      { value: 'same', label: 'Für alle Dateien so übernehmen', icon: 'done_all', picks: true },
      { value: 'best', label: 'Für alle die genaueren Daten', icon: 'auto_awesome' },
      { value: 'later', label: 'Später weitermachen', icon: 'schedule' },
    ],
  });
  return r === null ? 'later' : r?.value === 'same' ? { same: r.picks } : r;
}

/**
 * Über `items` entscheiden: [{ file, kind: 'new' | 'tour' | 'merge', keep, list, prepare }] – `prepare()` holt
 * `keep` und `list` erst, wenn gefragt wird ({ keep, list } oder null: nichts zu fragen).
 * `always`: auch fragen, wenn es nichts zusammenzuführen gibt (Ordner – dort fasst WMap sonst nichts an).
 * `skip`: Knopf „Nicht importieren“ in der ersten Frage (Ordner).
 * → null (abgebrochen) | { rest: 'best' | 'later' | 'skip' | Haken, files: Map(item → 'take' | 'later' | Haken) }
 */
export async function askFiles(items, { title, text, later = 'Abbrechen', icon, auto = false, always = false, skip = null } = {}) {
  const merges = items.filter((x) => x.kind === 'merge');
  const out = { rest: 'best', files: new Map() };
  if (!merges.length && !always) return out;
  // Eine Datei, die es schon gibt: gleich die Haken
  const how = items.length === 1 && merges.length && !always ? 'each' : await askAll({ title, text, later, icon, auto, skip });
  if (!how) return null;
  if (how === 'skip') return { rest: 'skip', files: out.files };
  if (how === 'best') return out;
  for (const x of items) if (x.kind !== 'merge') out.files.set(x, 'take');
  for (const [i, x] of merges.entries()) {
    const got = x.prepare ? await x.prepare() : x;
    if (!got?.list?.length) continue;
    const r = await askOne(got.keep, got.list, { fileName: x.file, i, n: merges.length });
    if (r === 'best') return out;
    if (r === 'later') { out.rest = 'later'; return out; }
    if (r.same) { out.files.set(x, r.same); out.rest = r.same; return out; }
    out.files.set(x, r);
  }
  return out;
}

/**
 * Eingelesene Dateien (data/import-files.js readFiles) übernehmen – mit der Rückfrage oben.
 * → { saved, merged, later } oder null (abgebrochen). `step(i, n)`: Fortschritt
 */
export async function importAsk(entries, { step = null } = {}) {
  const todo = entries.filter((f) => !f.error && f.track && !f.saved && !f.merged && (!f.dup || f.gain?.any));
  const items = todo.map((f) => ({ f, file: f.name, kind: f.dup ? 'merge' : 'new', prepare: () => prepareMerge(f) }));
  const merge = items.filter((x) => x.kind === 'merge').length, fresh = items.length - merge;
  const decided = await askFiles(items, {
    title: `${items.length} Dateien`,
    text: `${[fresh && `${fresh} ${fresh === 1 ? 'neue Tour' : 'neue Touren'}`, merge && `${merge} zu einer Tour, die es schon gibt`].filter(Boolean).join(', ')}.`,
  });
  if (!decided) return null;
  const out = { saved: 0, merged: 0, later: 0 };
  bulk.active += 1;   // der Ordner-Abgleich wartet, bis alle gespeichert sind
  try {
    for (const [i, x] of items.entries()) {
      step?.(i + 1, items.length);
      const choice = decided.files.get(x) ?? decided.rest;
      if (choice === 'later') { out.later += 1; continue; }
      try {
        if (await takeFile(x.f, choice)) out[x.f.saved ? 'saved' : 'merged'] += 1;
      } catch (err) { x.f.note = err.message; }
    }
  } finally { bulk.active -= 1; }
  return out;
}

/** Ergebnis in Worten */
export function importSummary(out) {
  const parts = [
    out.saved && `${out.saved} ${out.saved === 1 ? 'Tour' : 'Touren'} übernommen`,
    out.merged && `${out.merged} zusammengeführt`,
    out.later && `${out.later} ${out.later === 1 ? 'bleibt' : 'bleiben'} für später`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nichts Neues – die Touren gibt es schon';
}
