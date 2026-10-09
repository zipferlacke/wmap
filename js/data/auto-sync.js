/**
 * Still abgleichen, was eingeschaltet ist (Seite „Sicherung & Synchronisation“):
 * beim Öffnen einer Seite und – wenn so gewählt – alle 30 Minuten, solange
 * WMap offen ist. Erst Health Connect (neue Wege), dann der verbundene
 * Ordner (nimmt sie gleich mit). Danach die Rückfragen: neue Dateien im
 * Ordner, doppelte Touren.
 */
import { autoFolderSync, folder } from './folder.js';
// Fragt nach, wenn im Ordner neue Dateien liegen (hört auf „wmap:folder-inbox“)
import { offerInbox } from '../ui/folder-inbox.js';
import { offerDuplicates } from '../ui/duplicates-ask.js';
import { autoHealthSync } from '../services/health.js';

let started = false;
export function autoSync() {
  if (started) return;
  started = true;
  const run = async (periodic) => {
    await autoHealthSync({ periodic }).catch(() => null);
    await autoFolderSync({ periodic }).catch(() => null);
    // Lief gerade kein Abgleich (höchstens alle 5 Minuten): an noch offene neue Dateien erinnern
    if (!periodic) await folder.info().then((i) => offerInbox(i.inbox)).catch(() => null);
    // Gibt es dieselbe Tour doppelt: fragen (einmal je Sitzung, ui/duplicates-ask.js)
    if (!periodic) offerDuplicates().catch(() => null);
  };
  // Nach dem ersten Zeichnen – der Start der Seite geht vor
  setTimeout(() => run(false), 1500);
  setInterval(() => run(true), 30 * 60000);
}
