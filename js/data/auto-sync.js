/**
 * Still abgleichen, was eingeschaltet ist (Seite „Sicherung & Synchronisation“):
 * beim Öffnen einer Seite und – wenn so gewählt – alle 30 Minuten, solange
 * WMap offen ist. Erst Health Connect (neue Wege), dann der verbundene
 * Ordner (nimmt sie gleich mit).
 */
import { autoFolderSync } from './folder.js';
import { autoHealthSync } from '../services/health.js';

let started = false;
export function autoSync() {
  if (started) return;
  started = true;
  const run = async (periodic) => {
    await autoHealthSync({ periodic }).catch(() => null);
    await autoFolderSync({ periodic }).catch(() => null);
  };
  // Nach dem ersten Zeichnen – der Start der Seite geht vor
  setTimeout(() => run(false), 1500);
  setInterval(() => run(true), 30 * 60000);
}
