/**
 * Was die App wie oft fragt – je Dienst ein Zähler auf dem Gerät (localStorage „wmap.usage“), ohne Inhalt der
 * Anfrage. services/ping.js schickt die Summen einmal am Tag an den WMap-Server (stats.php zeigt sie).
 *
 *   used('photon')       eine Anfrage an Photon
 *   takeUsage()          → { photon: 12, … } und wieder bei null anfangen
 *   statsSetting         Nutzungsstatistik an (Vorgabe) oder aus – gefragt wird in der Begrüßung bzw. einmal danach
 *                        (ui/news.js), ändern lässt sie sich in den Einstellungen. Vor der Frage wird nichts gezählt
 *                        und nichts geschickt.
 */
const KEY = 'wmap.usage';
const SETTING = 'wmap.stats';          // '0': aus
const ASKED = 'wmap.stats.asked';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* gesperrt */ } },
};

export const statsSetting = {
  get: () => store.get(SETTING) !== '0',
  set(on) {
    store.set(SETTING, on ? '1' : '0');
    if (!on) store.set(KEY, null);
  },
  asked: () => store.get(ASKED) === '1',
  markAsked: () => store.set(ASKED, '1'),
  /** Zählen und schicken: erst nach der Frage und nur, wenn an */
  active() { return this.asked() && this.get(); },
};

const read = () => { try { return JSON.parse(store.get(KEY)) ?? {}; } catch { return {}; } };

export function used(name) {
  if (!statsSetting.active()) return;
  const u = read();
  u[name] = (u[name] ?? 0) + 1;
  store.set(KEY, JSON.stringify(u));
}

export function takeUsage() {
  const u = read();
  store.set(KEY, null);
  return u;
}

/** Nicht angekommen: Zähler wieder dazulegen */
export function giveBack(taken) {
  const u = read();
  for (const [k, n] of Object.entries(taken)) u[k] = (u[k] ?? 0) + n;
  store.set(KEY, JSON.stringify(u));
}
