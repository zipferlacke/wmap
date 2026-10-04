/**
 * Neue Dateien im verbundenen Ordner (von Hand hineingelegt: Export der Uhr,
 * Garmin, Komoot …). Der Abgleich fasst sie nicht an, bevor entschieden ist
 * (data/folder.js take) – er meldet sie mit „wmap:folder-inbox“, hier wird
 * gefragt:
 *
 *   Immer die genauesten Daten   alle übernehmen; gibt es die Tour schon, gilt
 *                                der Vorschlag (was fehlt, kommt dazu; Abweichendes
 *                                von der Seite mit mehr Punkten)
 *   Einzeln entscheiden          Datei für Datei: neue übernehmen oder liegen
 *                                lassen; zum Zusammenführen die Haken
 *                                (ui/merge-ask.js). „Rest: immer die genauesten“
 *                                kürzt ab, „Abbrechen“ lässt alles, wie es ist
 *   Später                       bleibt liegen – gefragt wird beim nächsten Start
 *                                wieder (und jederzeit über „Sicherung &
 *                                Synchronisation“)
 *
 * Von selbst kommt die Frage einmal je Sitzung; `offerInbox(list, true)` fragt immer.
 */
import { ask, toast } from './dialogs.js';
import { askMerge } from './merge-ask.js';
import { folder, syncSummary } from '../data/folder.js';
import { fmtDistance } from '../core/geo.js';

const LATER = 'wmap.folder.inbox.later';
const DAY = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const facts = (x) => [x.start ? DAY.format(x.start) : 'ohne Zeiten – als geplante Tour', x.length ? fmtDistance(x.length) : ''].filter(Boolean).join(' · ');
let asking = false;

export async function offerInbox(list, force = false) {
  if (asking || !list?.length) return;
  if (!force && sessionStorage.getItem(LATER)) return;
  asking = true;
  try {
    const fresh = list.filter((x) => x.kind !== 'merge').length, merge = list.length - fresh;
    const how = await ask({
      auto: !force, icon: 'drive_folder_upload', title: list.length === 1 ? 'Neue Datei im Ordner' : `${list.length} neue Dateien im Ordner`, className: 'stacked',
      text: `Im verbundenen Ordner ${list.length === 1 ? 'liegt eine Datei' : 'liegen Dateien'}, die WMap noch nicht kennt: ${[fresh && `${fresh} neu`, merge && `${merge} zu einer Tour, die es schon gibt`].filter(Boolean).join(', ')}. Wie soll WMap damit umgehen?`,
      buttons: [
        { value: 'best', label: 'Immer die genauesten Daten', icon: 'done_all', primary: true },
        { value: 'each', label: 'Einzeln entscheiden', icon: 'checklist' },
        { value: 'later', label: 'Später' },
      ],
    });
    if (how !== 'best' && how !== 'each') { sessionStorage.setItem(LATER, '1'); return; }
    const decide = { rest: how === 'best' ? 'best' : 'later', files: {} };
    if (how === 'each') {
      const rest = { value: 'rest', label: 'Rest: immer die genauesten Daten', icon: 'done_all' };
      const skip = { value: 'later', label: 'Liegen lassen', icon: 'schedule' };
      for (const [i, x] of list.entries()) {
        const count = list.length > 1 ? ` (${i + 1} von ${list.length})` : '';
        const r = x.kind === 'merge'
          ? await askMerge(x.keep, x.list, { fileName: x.file, extra: [skip, ...(i < list.length - 1 ? [rest] : [])] })
          : await ask({
            icon: 'upload_file', title: `Neue Datei${count}`, className: 'stacked',
            text: `„${x.name}“ (${facts(x)}) – Datei ${x.file}`,
            buttons: [{ value: 'take', label: 'Übernehmen', icon: 'add', primary: true }, skip, ...(i < list.length - 1 ? [rest] : []), { value: 'no', label: 'Abbrechen' }],
          });
        // Abbrechen (oder ✕): nichts passiert – auch nicht mit dem, was schon gewählt war
        if (r === null || r === 'no') return;
        if (r === 'rest') { decide.rest = 'best'; break; }
        decide.files[x.path] = r;
      }
    }
    const out = await folder.sync({ interactive: true, decide });
    if (out && !out.needsPermission) toast(`Ordner: ${syncSummary(out)}`);
  } catch (err) {
    toast(err.message || 'Der Abgleich ging nicht');
  } finally { asking = false; }
}

addEventListener('wmap:folder-inbox', (e) => offerInbox(e.detail?.inbox));
