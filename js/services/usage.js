/**
 * Was die App wie oft fragt – je Dienst ein Zähler auf dem Gerät (localStorage „wmap.usage“), ohne Inhalt der
 * Anfrage. services/ping.js schickt die Summen einmal am Tag an den WMap-Server (stats.php zeigt sie).
 *
 *   used('photon')       eine Anfrage an Photon
 *   feature('lines')     eine Nutzung des Features „Linie suchen“ (Zähler feat:lines)
 *   used('efa', 'lines') eine Anfrage an EFA, dazu unter dem Feature (feat:lines:efa) – so zeigt stats.php, wie viele
 *                        Anfragen eine Nutzung braucht
 *   served('departures', 'rmv', ok, ms)   welcher Anbieter die Nutzung bedient hat, wie schnell bzw. dass er scheiterte
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

function bump(...names) {
  if (!statsSetting.active()) return;
  const u = read();
  for (const n of names) {
    const [k, by = 1] = Array.isArray(n) ? n : [n];
    u[k] = (u[k] ?? 0) + by;
  }
  store.set(KEY, JSON.stringify(u));
}

export const used = (name, feat = null) => bump(name, ...(feat ? [`feat:${feat}:${name}`] : []));
export const feature = (name) => bump(`feat:${name}`);
/**
 * Welcher Anbieter eine Nutzung bedient hat (Fahrplan: efa, rmv, trias): ok → src:<feature>:<anbieter> und die
 * Antwortzeit in srcms:…, gescheitert → srcfail:… – stats.php vergleicht damit dieselbe Anfrage je Anbieter
 */
export const served = (feat, provider, ok, ms) => {
  if (!feat) return;
  bump(ok ? [`src:${feat}:${provider}`] : [`srcfail:${feat}:${provider}`], ...(ok ? [[`srcms:${feat}:${provider}`, Math.round(ms)]] : []));
};

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
