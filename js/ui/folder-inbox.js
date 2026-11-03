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
import { t } from '../core/i18n.js';

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
        title: t('sync.inbox.fresh.title', { n: fresh.length }),
        text: t('sync.inbox.fresh.text', { n: fresh.length, also: merges.length ? t('sync.inbox.fresh.also', { n: merges.length }) : '' }),
      });
      if (!decided) { sessionStorage.setItem(LATER, '1'); return; }
      const out = await folder.sync({ interactive: true, decide: { fresh: decided.rest, news: byPath(decided.files) } });
      if (!out || out.needsPermission) return;
      done.push(syncSummary(out));
      if (decided.rest === 'later') { sessionStorage.setItem(LATER, '1'); toast(t('sync.inbox.toast', { summary: done.join(' · ') })); return; }
      // Was jetzt noch wartet: die zu vorhandenen Touren – auch die, deren Tour eben erst dazukam
      merges = out.inbox.filter((x) => x.kind === 'merge');
    }
    if (merges.length) {
      const decided = await askFiles(merges, {
        always: true, auto: !force && !done.length, icon: 'merge', later: t('common.later'), skip: t('import.ask.skip'),
        title: t('sync.inbox.merges.title', { n: merges.length }),
        text: t('sync.inbox.merges.text', { n: merges.length }),
      });
      if (!decided) { sessionStorage.setItem(LATER, '1'); if (done.length) toast(t('sync.inbox.toast', { summary: done.join(' · ') })); return; }
      const out = await folder.sync({ interactive: true, decide: { merge: decided.rest, merges: byPath(decided.files) } });
      if (out && !out.needsPermission) done.push(syncSummary(out));
    }
    if (done.length) toast(t('sync.inbox.toast', { summary: done.join(' · ') }));
    // Zuletzt: doppelte Touren in der App (etwa dieselbe Tour aus zwei Dateien, die eben zusammen kamen)
    await offerDuplicates();
  } catch (err) {
    toast(err.message || t('sync.inbox.failed'));
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
      title: t('sync.inbox.others.title', { n: list.length }),
      text: t('sync.inbox.others.text', { n: list.length, names: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''}` }),
      buttons: [
        { value: 'move', label: t('sync.inbox.others.move'), icon: 'drive_file_move', primary: true },
        { value: 'keep', label: t('sync.inbox.others.keep'), icon: 'block' },
      ],
    });
    if (how !== 'move' && how !== 'keep') { sessionStorage.setItem(OTHERS_LATER, '1'); return; }
    const out = await folder.sync({ interactive: true, decide: { others: how } });
    if (out && !out.needsPermission && how === 'move') toast(t('sync.inbox.toast', { summary: syncSummary(out) }));
  } catch (err) {
    toast(err.message || t('sync.inbox.failed'));
  } finally { asking = false; }
}

addEventListener('wmap:folder-others', (e) => offerOthers(e.detail?.others));
