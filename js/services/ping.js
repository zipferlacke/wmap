/**
 * Einmal am Tag „WMap war heute offen“ an den WMap-Server (bEnd/api_stats.php, ping) – für die Zahl der aktiven und
 * neuen Geräte in stats.php. Ohne Kennung, ohne Ort: nur ob das Gerät neu ist bzw. sich diese Woche / diesen Monat
 * zum ersten Mal meldet, dazu was die App seit dem letzten Mal wie oft gefragt hat (services/usage.js).
 * Scheitert es (offline), versucht es der nächste Start. Nur wenn die Nutzungsstatistik an ist (statsSetting).
 */
import { api } from './api.js';
import { giveBack, statsSetting, takeUsage } from './usage.js';

const LAST = 'wmap.ping';     // Tag (JJJJ-MM-TT, UTC) des letzten Pings

const day = (d) => d.toISOString().slice(0, 10);
/** Montag der Woche als Tag – gleiche Woche, gleicher Wert */
const week = (d) => day(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))));

export async function ping() {
  if (!statsSetting.active()) return;
  let last = null;
  try { last = localStorage.getItem(LAST); } catch { return; }
  const now = new Date();
  if (last === day(now) || !navigator.onLine) return;
  const before = last ? new Date(`${last}T00:00:00Z`) : null;
  const services = takeUsage();
  try {
    await api(['stats', 'ping'], {
      new: !last,
      week: !before || week(before) !== week(now),
      month: !last || last.slice(0, 7) !== day(now).slice(0, 7),
      services,
    });
    localStorage.setItem(LAST, day(now));
  } catch {
    giveBack(services);
  }
}
