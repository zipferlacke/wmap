/**
 * Neue Dateien im verbundenen Ordner (von Hand hineingelegt: Export der Uhr,
 * Garmin, Komoot …). Der Abgleich fasst sie nicht an, bevor entschieden ist
 * (data/folder.js take) – er meldet sie mit „wmap:folder-inbox“, hier wird
 * gefragt, in dieser Reihenfolge:
 *
 * 1. Die neuen (askNewFiles, ui/import-ask.js):
 *   Alle übernehmen              mit allem, was in der Datei steht
 *   Auswählen                    je Datei, was mitkommt (Puls, Frequenz, Leistung,
 *                                Runden), „Für alle Dateien so übernehmen“ oder
 *                                „Nicht importieren“ für diese eine
 *   Nicht importieren            alle nach „Unbekannte Dateien/“ (30 Tage)
 *   Später                       bleibt liegen – gefragt wird beim nächsten Start
 *                                wieder (und jederzeit über „Sicherung &
 *                                Synchronisation“)
 *   Dann werden sie übernommen. Die Antwort merkt sich der Ordner, bis alles
 *   durch ist – bricht der Abgleich ab (Seite gewechselt), macht der nächste
 *   damit weiter, ohne noch einmal zu fragen.
 * 2. Die zu Touren, die es schon gibt – auch zwei Dateien derselben Tour, die
 *   eben erst zusammen kamen: dieselben Dialoge wie beim Zusammenführen
 *   (überall die genaueren / selbst einstellen / nicht importieren / später).
 * 3. Doppelte Touren in der App (ui/duplicates-ask.js).
 *
 * Andere Dateien (Bilder, PDFs … – keine Touren, „wmap:folder-others“): Einmal
 * je Ordner wird gefragt, ob WMap sie nach „Unbekannte Dateien“ räumen darf
 * (offerOthers); dort gehen sie nach 30 Tagen. Danach gilt die Antwort.
 *
 * Von selbst kommt die Frage einmal je Sitzung; `offerInbox(list, true)` fragt immer.
 */
import { ask, toast } from './dialogs.js';
import { askFiles, askNewFiles } from './import-ask.js';
import { offerDuplicates } from './duplicates-ask.js';
import { folder, syncSummary } from '../data/folder.js';

const LATER = 'wmap.folder.inbox.later';
let asking = false;

const byPath = (files) => Object.fromEntries([...files].map(([x, v]) => [x.path, v]));

export async function offerInbox(list, force = false) {
  if (asking || !list?.length) return;
  if (!force && sessionStorage.getItem(LATER)) return;
  asking = true;
  try {
    let merges = list.filter((x) => x.kind === 'merge');
    const fresh = list.filter((x) => x.kind !== 'merge');
    const done = [];
    if (fresh.length) {
      const decided = await askNewFiles(fresh, {
        auto: !force,
        title: fresh.length === 1 ? 'Neue Datei im Ordner' : `${fresh.length} neue Dateien im Ordner`,
        text: `Im verbundenen Ordner ${fresh.length === 1 ? 'liegt eine Datei' : 'liegen Dateien'}, die WMap noch nicht kennt${merges.length ? ` – dazu ${merges.length === 1 ? 'eine' : merges.length} zu einer Tour, die es schon gibt (danach)` : ''}.`,
      });
      if (!decided) { sessionStorage.setItem(LATER, '1'); return; }
      const out = await folder.sync({ interactive: true, decide: { fresh: decided.rest, news: byPath(decided.files) } });
      if (!out || out.needsPermission) return;
      done.push(syncSummary(out));
      if (decided.rest === 'later') { sessionStorage.setItem(LATER, '1'); toast(`Ordner: ${done.join(' · ')}`); return; }
      // Was jetzt noch wartet: die zu vorhandenen Touren – auch die, deren Tour eben erst dazukam
      merges = out.inbox.filter((x) => x.kind === 'merge');
    }
    if (merges.length) {
      const decided = await askFiles(merges, {
        always: true, auto: !force && !done.length, icon: 'merge', later: 'Später', skip: 'Nicht importieren',
        title: merges.length === 1 ? 'Datei zu einer Tour, die es schon gibt' : `${merges.length} Dateien zu Touren, die es schon gibt`,
        text: `Im verbundenen Ordner ${merges.length === 1 ? 'liegt eine Datei zu einer Tour' : 'liegen Dateien zu Touren'}, die es in WMap schon gibt.`,
      });
      if (!decided) { sessionStorage.setItem(LATER, '1'); if (done.length) toast(`Ordner: ${done.join(' · ')}`); return; }
      const out = await folder.sync({ interactive: true, decide: { merge: decided.rest, merges: byPath(decided.files) } });
      if (out && !out.needsPermission) done.push(syncSummary(out));
    }
    if (done.length) toast(`Ordner: ${done.join(' · ')}`);
    // Zuletzt: doppelte Touren in der App (etwa dieselbe Tour aus zwei Dateien, die eben zusammen kamen)
    await offerDuplicates();
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
