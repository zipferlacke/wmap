/**
 * Mehrere Dateien übernehmen – dieselbe Rückfrage auf allen drei Wegen:
 *
 *   Dateien wählen     „GPX/FIT öffnen“ (pages/import.js), „GPX/FIT importieren“ (pages/wege.js)
 *   Hineinziehen       auf „Meine Touren“ (pages/wege.js)
 *   Ordner             von Hand in den verbundenen Ordner gelegt – gefragt wird beim Start (ui/folder-inbox.js)
 *
 * Erst eine Frage für alle (askAll):
 *   Ja, überall die genaueren Daten   alle übernehmen; gibt es die Tour schon, gilt der Vorschlag
 *                                     (was fehlt, kommt dazu; Abweichendes von der Seite mit mehr Punkten)
 *   Selbst einstellen                 je Datei, die es als Tour schon gibt, die Haken (askOne, ui/merge-ask.js) –
 *                                     vorbelegt mit dem Vorschlag. Darunter „Weiter“, „Für alle so übernehmen“,
 *                                     „Für alle die genaueren Daten“, „Später weitermachen“ (der Rest bleibt
 *                                     liegen). Neue Touren kommen ohne Frage dazu
 *   Abbrechen bzw. Später             nichts passiert – auch nicht mit dem, was schon gewählt war
 *
 * Doppelte Touren, die schon in der App sind, laufen genauso (ui/duplicates-ask.js).
 */
import { ask } from './dialogs.js';
import { askMerge } from './merge-ask.js';
import { bulk } from '../data/tracks.js';
import { takeFile, prepareMerge } from '../data/import-files.js';

/** Die Frage für alle → 'best' | 'each' | null */
export async function askAll({ title, text, later = 'Abbrechen', icon = 'library_add', auto = false }) {
  const how = await ask({
    auto, icon, title, className: 'import-ask stacked',
    text: `${text} Überall die genaueren Daten übernehmen?`,
    buttons: [
      { value: 'best', label: 'Ja, überall die genaueren Daten', icon: 'done_all', primary: true },
      { value: 'each', label: 'Selbst einstellen', icon: 'checklist' },
      { value: 'no', label: later },
    ],
  });
  return how === 'best' || how === 'each' ? how : null;
}

/**
 * Die Haken für eine Datei (Nummer `i` von `n`, ab 0) → Haken | { same: Haken } (für alle so) | 'best' (für
 * diese und den Rest die genaueren) | 'later' (diese und der Rest bleiben) | null (abbrechen)
 */
export async function askOne(keep, list, { fileName = '', from = null, i = 0, n = 1 } = {}) {
  const last = i >= n - 1;
  const r = await askMerge(keep, list, {
    fileName, from,
    title: n > 1 ? `Zusammenführen (${i + 1} von ${n})` : 'Zusammenführen',
    go: last ? 'Zusammenführen' : 'Weiter',
    extra: last ? [{ value: 'later', label: 'Später', icon: 'schedule' }] : [
      { value: 'same', label: 'Für alle so übernehmen', icon: 'done_all', picks: true },
      { value: 'best', label: 'Für alle die genaueren Daten', icon: 'auto_awesome' },
      { value: 'later', label: 'Später weitermachen', icon: 'schedule' },
    ],
  });
  return r?.value === 'same' ? { same: r.picks } : r;
}

/**
 * Über `items` entscheiden: [{ file, kind: 'new' | 'tour' | 'merge', keep, list, prepare }] – `prepare()` holt
 * `keep` und `list` erst, wenn gefragt wird ({ keep, list } oder null: nichts zu fragen).
 * `always`: auch fragen, wenn es nichts zusammenzuführen gibt (Ordner – dort fasst WMap sonst nichts an).
 * → null (abgebrochen) | { rest: 'best' | 'later' | Haken, files: Map(item → 'take' | 'later' | Haken) }
 */
export async function askFiles(items, { title, text, later = 'Abbrechen', icon, auto = false, always = false } = {}) {
  const merges = items.filter((x) => x.kind === 'merge');
  const out = { rest: 'best', files: new Map() };
  if (!merges.length && !always) return out;
  // Eine Datei, die es schon gibt: gleich die Haken
  const how = items.length === 1 && merges.length && !always ? 'each' : await askAll({ title, text, later, icon, auto });
  if (!how) return null;
  if (how === 'best') return out;
  for (const x of items) if (x.kind !== 'merge') out.files.set(x, 'take');
  for (const [i, x] of merges.entries()) {
    const got = x.prepare ? await x.prepare() : x;
    if (!got?.list?.length) continue;
    const r = await askOne(got.keep, got.list, { fileName: x.file, i, n: merges.length });
    if (r === null) return null;
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
