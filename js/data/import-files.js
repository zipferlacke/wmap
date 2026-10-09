/**
 * GPX- und FIT-Dateien einlesen und übernehmen – für „GPX/FIT öffnen“ (pages/import.js) und für Dateien, die man
 * auf „Meine Touren“ wählt oder zieht (pages/wege.js). Gefragt wird in ui/import-ask.js.
 *
 *   readFiles   Dateien lesen und prüfen: Strecke, mit Zeiten auch die Aufzeichnung; gibt es die Tour schon
 *               (WMap-ID bzw. gleicher Weg), was die Datei mehr hat (data/duplicates.js gain)
 *   takeFile    neu speichern – oder die vorhandene Tour ergänzen: mit den Haken aus der Rückfrage, sonst mit
 *               dem Vorschlag (was fehlt, kommt dazu; Abweichendes von der Seite mit mehr Punkten)
 */
import { tracks, parseGpx, sameTrack, trackGpx } from './tracks.js';
import { parseFit } from './fit.js';
import { gain, offers, picksFor, combine } from './duplicates.js';
import { tourFromGpx } from './folder.js';
import { devLog } from '../core/devlog.js';

const TIMED = /<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/;

/** Datei bzw. Antwort → { name, text } oder, bei FIT, { name, bytes } */
export async function fileOf(x, name = x.name) {
  return /\.fit$/i.test(name) ? { name, bytes: await x.arrayBuffer() } : { name, text: await x.text() };
}

/** [{ name, text } | { name, bytes }] → [{ name, text, tour, track, id, dup, gain, error }] */
export async function readFiles(list) {
  const t0 = performance.now();
  devLog(`GPX öffnen: ${list.length} Datei(en)`);
  const all = await tracks.all();
  const out = [];
  for (const { name, text: given, bytes } of list) {
    let text = given;
    const f = { name: name || 'Datei.gpx', text };
    try {
      // FIT: einlesen und als GPX weiterreichen – danach gilt für beide dasselbe
      if (bytes) {
        const [t] = parseFit(bytes, f.name);
        if (!t) throw new Error('Keine Strecke in der Datei');
        f.text = text = trackGpx(t);
      }
      f.tour = tourFromGpx(text, f.name);
      if (!f.tour) throw new Error('Keine Strecke in der Datei');
      if (TIMED.test(text)) {
        f.track = parseGpx(text)[0] ?? null;
        // Aus WMap exportiert: die ID steht im Stichwort wmap:…
        f.id = text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? f.track?.id;
        // Auch gegen die Dateien davor: dieselbe Tour zweimal gewählt
        f.dup = f.track ? all.find((t) => t.id === f.id || sameTrack(t, f.track)) ?? null : null;
        if (f.dup) f.gain = gainOf(f.dup, f.track);
      }
    } catch (err) { f.error = err.message; }
    devLog('  ', f.name, f.error ? `nicht lesbar: ${f.error}` : !f.track ? 'ohne Zeiten' : !f.dup ? 'neu' : f.gain.any ? `ergänzt „${f.dup.name}“` : `gibt es schon („${f.dup.name}“), nichts Neues`,
      f.dup ? `· hier ${f.dup.stub ? 'Karteikarte' : 'ganz'}, Punkte ${f.gain.points.join(' / ')}` : '');
    out.push(f);
  }
  devLog(`GPX öffnen: geprüft in ${Math.round(performance.now() - t0)} ms`);
  return out;
}

/** Wie gain – „etwas zu holen“ heißt aber: Es gibt etwas zu fragen (offers). Die Karteikarte kennt nur gain */
function gainOf(keep, file) {
  const g = gain(keep, file);
  return keep.stub ? g : { ...g, any: offers(keep, file).length > 0 };
}

/** Die vorhandene Tour ganz holen und sagen, was es zu fragen gibt → { keep, list } oder null (f.note sagt, warum) */
export async function prepareMerge(f) {
  try { f.full = await tracks.full(f.dup); } catch (err) { f.note = `Die vorhandene Tour liegt im Ordner – ${err.message}`; return null; }
  const list = offers(f.full, f.track);
  if (!list.length) { f.gain = { ...f.gain, any: false }; return null; }
  return { keep: f.full, list };
}

/**
 * Eine Datei übernehmen: neu speichern oder die vorhandene Tour ergänzen – `choice`: Haken aus der Rückfrage
 * ({ shape, hr, cad, pow, marks }), sonst gilt der Vorschlag. → hat sich etwas getan? (f.saved bzw. f.merged)
 */
export async function takeFile(f, choice = null) {
  if (f.error || !f.track || f.saved || f.merged) return false;
  // Kurz vorher noch einmal: vielleicht kam der Weg inzwischen über den Ordner oder mit einer Datei davor
  const dup = (await tracks.all()).find((t) => t.id === f.id || sameTrack(t, f.track)) ?? null;
  if (!dup) {
    const t = { ...f.track, id: f.id ?? f.track.id, updated: Date.now() };
    await tracks.put(t);
    f.saved = t.id;
    return true;
  }
  f.dup = dup;
  f.gain = gainOf(dup, f.track);
  if (!f.gain.any) return false;
  const got = await prepareMerge(f);
  if (!got) return false;
  const picks = picksFor(got.list, choice);
  const next = combine(got.keep, f.track, picks);
  devLog('Übernehmen:', f.name, '→', `„${got.keep.name}“`, next === got.keep ? 'nichts geändert' : 'ergänzt', picks);
  // Nichts übernommen (z. B. weicht nur der Puls ab und der vorhandene soll bleiben)
  if (next === got.keep) { f.gain = { ...f.gain, any: false }; f.kept = true; return false; }
  await tracks.put({ ...next, updated: Date.now() });
  f.merged = true;
  return true;
}
