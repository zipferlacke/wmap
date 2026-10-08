/**
 * Neue Dateien im verbundenen Ordner (von Hand hineingelegt: Export der Uhr,
 * Garmin, Komoot …). Der Abgleich fasst sie nicht an, bevor entschieden ist
 * (data/folder.js take) – er meldet sie mit „wmap:folder-inbox“, hier wird
 * gefragt:
 *
 *   Ja, überall die genaueren    alle übernehmen; gibt es die Tour schon, gilt
 *   Daten                        der Vorschlag (was fehlt, kommt dazu; Abweichendes
 *                                von der Seite mit mehr Punkten)
 *   Selbst einstellen            neue Touren kommen dazu; je Datei, die es als
 *                                Tour schon gibt, die Haken – dieselben Dialoge
 *                                wie beim Wählen und Hineinziehen von Dateien
 *                                (ui/import-ask.js)
 *   Später                       bleibt liegen – gefragt wird beim nächsten Start
 *                                wieder (und jederzeit über „Sicherung &
 *                                Synchronisation“)
 *
 * Andere Dateien (Bilder, PDFs … – keine Touren, „wmap:folder-others“): Einmal
 * je Ordner wird gefragt, ob WMap sie nach „Unbekannte Dateien“ räumen darf
 * (offerOthers); dort gehen sie nach 30 Tagen. Danach gilt die Antwort.
 *
 * Von selbst kommt die Frage einmal je Sitzung; `offerInbox(list, true)` fragt immer.
 */
import { ask, toast } from './dialogs.js';
import { askFiles } from './import-ask.js';
import { folder, syncSummary } from '../data/folder.js';

const LATER = 'wmap.folder.inbox.later';
let asking = false;

export async function offerInbox(list, force = false) {
  if (asking || !list?.length) return;
  if (!force && sessionStorage.getItem(LATER)) return;
  asking = true;
  try {
    const merge = list.filter((x) => x.kind === 'merge').length, fresh = list.length - merge;
    const decided = await askFiles(list, {
      always: true, auto: !force, icon: 'drive_folder_upload', later: 'Später',
      title: list.length === 1 ? 'Neue Datei im Ordner' : `${list.length} neue Dateien im Ordner`,
      text: `Im verbundenen Ordner ${list.length === 1 ? 'liegt eine Datei' : 'liegen Dateien'}, die WMap noch nicht kennt: ${[fresh && `${fresh} neu`, merge && `${merge} zu einer Tour, die es schon gibt`].filter(Boolean).join(', ')}.`,
    });
    if (!decided) { sessionStorage.setItem(LATER, '1'); return; }
    const decide = { rest: decided.rest, files: Object.fromEntries([...decided.files].map(([x, v]) => [x.path, v])) };
    const out = await folder.sync({ interactive: true, decide });
    if (out && !out.needsPermission) toast(`Ordner: ${syncSummary(out)}`);
  } catch (err) {
    toast(err.message || 'Der Abgleich ging nicht');
  } finally { asking = false; }
}

addEventListener('wmap:folder-inbox', (e) => offerInbox(e.detail?.inbox));

const OTHERS_LATER = 'wmap.folder.others.later';

/** Dateien im Ordner, die keine Touren sind (Pfade): aufräumen oder liegen lassen? */
export async function offerOthers(list, force = false) {
  if (asking || !list?.length) return;
  if (!force && sessionStorage.getItem(OTHERS_LATER)) return;
  asking = true;
  try {
    const names = list.map((p) => p.split('/').pop());
    const how = await ask({
      auto: !force, icon: 'folder_delete', className: 'stacked',
      title: list.length === 1 ? 'Eine andere Datei im Ordner' : `${list.length} andere Dateien im Ordner`,
      text: `Im verbundenen Ordner ${list.length === 1 ? 'liegt eine Datei, die keine Tour ist' : 'liegen Dateien, die keine Touren sind'}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''}. WMap hält den Ordner aufgeräumt: Sollen sie nach „Unbekannte Dateien“? Dort löscht WMap sie nach 30 Tagen – das gilt dann auch für alles, was später dazukommt.`,
      buttons: [
        { value: 'move', label: 'Nach „Unbekannte Dateien“', icon: 'drive_file_move', primary: true },
        { value: 'keep', label: 'Liegen lassen', icon: 'block' },
      ],
    });
    if (how !== 'move' && how !== 'keep') { sessionStorage.setItem(OTHERS_LATER, '1'); return; }
    const out = await folder.sync({ interactive: true, decide: { others: how } });
    if (out && !out.needsPermission && how === 'move') toast(`Ordner: ${syncSummary(out)}`);
  } catch (err) {
    toast(err.message || 'Der Abgleich ging nicht');
  } finally { asking = false; }
}

addEventListener('wmap:folder-others', (e) => offerOthers(e.detail?.others));
