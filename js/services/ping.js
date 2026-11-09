/**
 * Einmal am Tag „WMap war heute offen“ an den WMap-Server (bEnd/api_stats.php, ping) – für die Zahl der aktiven und
 * neuen Geräte in stats.php. Ohne Kennung, ohne Ort: nur ob das Gerät neu ist bzw. sich diese Woche / diesen Monat
 * zum ersten Mal meldet, ob es schon in der Vorwoche / im Vormonat da war (daraus die verlorenen Geräte), dazu was die
 * App seit dem letzten Mal wie oft gefragt hat (services/usage.js), und ob das Gerät WMap als App nutzt (isApp).
 * Scheitert es (offline), versucht es der nächste Start. Nur wenn die Nutzungsstatistik an ist (statsSetting).
 */
import { api } from './api.js';
import { giveBack, statsSetting, takeUsage } from './usage.js';

const LAST = 'wmap.ping';     // Tag (JJJJ-MM-TT, UTC) des letzten Pings
const INSTALLED = 'wmap.installed';   // '1': lief schon einmal als App

const day = (d) => d.toISOString().slice(0, 10);
/** Montag der Woche als Tag – gleiche Woche, gleicher Wert */
const week = (d) => day(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))));
const lastWeek = (d) => week(new Date(+d - 7 * 86_400_000));
const lastMonth = (d) => day(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))).slice(0, 7);

/**
 * Nutzt das Gerät WMap als App? Ja, wenn WMap hier einmal als eigenes Programm lief: Android-App (Tauri) oder
 * installierte Web-App im eigenen Fenster (display-mode standalone, fullscreen, minimal-ui, iOS navigator.standalone).
 * Das Gerät merkt es sich; danach zählt es als App, auch wenn es WMap im Browser öffnet. Sonst: Website.
 */
export function isApp() {
  const own = !!globalThis.window?.__TAURI__ || navigator.standalone === true
    || ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => globalThis.matchMedia?.(`(display-mode: ${m})`).matches);
  try {
    if (own) localStorage.setItem(INSTALLED, '1');
    return own || localStorage.getItem(INSTALLED) === '1';
  } catch { return own; }
}

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
      back_week: !!before && week(before) === lastWeek(now),
      back_month: !!last && last.slice(0, 7) === lastMonth(now),
      app: isApp(),
      services,
    });
    localStorage.setItem(LAST, day(now));
  } catch {
    giveBack(services);
  }
}
