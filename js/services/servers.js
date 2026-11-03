/**
 * Anfrage an einen Dienst: askServer('photon', '/api?q=…'). Die Server stehen als Liste in core/config.js (API) –
 * ein weiterer Server desselben Dienstes ist nur eine Zeile dort, er muss dieselbe Schnittstelle sprechen und den Abruf
 * aus dem Browser erlauben (CORS).
 *
 *   Reihenfolge   je Seitenaufruf einmal gemischt, dann bleibt es beim selben Server, bis er ausfällt
 *   Ausfall       Netzfehler, Zeitlimit, 429 und 5xx: einmal wiederholen, dann der nächste; der Server hat 10 Minuten
 *                 Pause (localStorage „wmap.servers.next“, gilt über Seitenwechsel)
 *   alle in Pause der mit der frühesten Zeit
 *
 * Abbrechen (neuer Buchstabe beim Tippen) ist kein Ausfall, andere Antworten (404 …) kommen unverändert zurück. Ohne
 * Netz bekommt kein Server eine Pause. Scheitert alles: die letzte Antwort, sonst der letzte Fehler.
 */
import { API } from '../core/config.js';

const NEXT = 'wmap.servers.next';
const PAUSE_MS = 10 * 60 * 1000;
const RETRY_MS = 800;
const TIMEOUT_MS = 10000;

const pauses = {
  read() { try { return JSON.parse(localStorage.getItem(NEXT)) ?? {}; } catch { return {}; } },
  set(base) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try { localStorage.setItem(NEXT, JSON.stringify({ ...this.read(), [base]: Date.now() + PAUSE_MS })); } catch { /* gesperrt */ }
  },
};

const mixed = new Map();             // Dienst → gemischte Liste für diesen Seitenaufruf
function shuffled(name) {
  if (!mixed.has(name)) {
    const list = [].concat(API[name]);
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    mixed.set(name, list);
  }
  return mixed.get(name);
}

function candidates(name) {
  const list = shuffled(name);
  const next = pauses.read();
  const now = Date.now();
  const free = list.filter((b) => !(next[b] > now));
  return free.length ? free : [list.reduce((a, b) => (next[a] <= next[b] ? a : b))];
}

function withTimeout(signal, ms) {
  if (!AbortSignal.any || !AbortSignal.timeout) return signal;
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** `init` wie bei fetch, `timeout` je Versuch → Response; wirft nur, wenn kein Server geantwortet hat */
export async function askServer(name, path, init = {}, { timeout = TIMEOUT_MS } = {}) {
  const { signal } = init;
  let lastRes = null, lastErr = null;
  for (const base of candidates(name)) {
    for (let again = true; ; again = false) {
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, { ...init, signal: withTimeout(signal, timeout) });
        if (res.status !== 429 && res.status < 500) return res;
        lastRes = res;
      } catch (err) {
        if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
        lastErr = err;
      }
      if (!again) break;
      await new Promise((ok) => { setTimeout(ok, RETRY_MS); });
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    }
    pauses.set(base);
  }
  if (lastRes) return lastRes;
  throw lastErr;
}
