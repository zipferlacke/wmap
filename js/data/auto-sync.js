/**
 * Beim Öffnen einer Seite: still abgleichen, was eingeschaltet ist
 * (Seite „Sicherung & Abgleich“) – erst Health Connect (neue Wege), dann
 * der verbundene Ordner (nimmt sie gleich mit).
 */
import { autoFolderSync } from './folder.js';
import { autoHealthSync } from '../services/health.js';

let started = false;
export function autoSync() {
  if (started) return;
  started = true;
  // Nach dem ersten Zeichnen – der Start der Seite geht vor
  setTimeout(async () => {
    await autoHealthSync().catch(() => null);
    await autoFolderSync().catch(() => null);
  }, 1500);
}
