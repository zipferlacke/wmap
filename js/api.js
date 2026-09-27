/**
 * Verbindung zur WMap-API (bEnd/api.php) – Aufbau wie bei wuecash:
 * POST mit `request` (Pfad) und `data` (JSON), Antwort [0, Wert] | [1, Meldung].
 * Im Browser liegt die API neben der Seite; in der App (Tauri) unter PUBLIC_URL.
 */
import { PUBLIC_URL } from './config.js';
import { local } from './store.js';

const web = /^https?:$/.test(location.protocol) && location.hostname !== 'tauri.localhost';
const BASE = web ? new URL('bEnd/api.php', location.href.replace(/[^/]*$/, '')).href : `${PUBLIC_URL}bEnd/api.php`;
const TOKEN = 'wmap.token';

export const token = {
  get: () => local.get(TOKEN),
  set: (t) => local.set(TOKEN, t),
};

/** → Ergebnis; wirft mit lesbarer Meldung */
export async function api(path, data = {}, { signal } = {}) {
  const body = new FormData();
  body.set('request', JSON.stringify(path));
  body.set('data', JSON.stringify(data));
  const t = token.get();
  let res;
  try {
    res = await fetch(BASE, { method: 'POST', body, signal, headers: t ? { Authorization: `Bearer ${t}` } : {} });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Der WMap-Server ist gerade nicht erreichbar');
  }
  let out;
  try { out = await res.json(); } catch { throw new Error('Der WMap-Server antwortet nicht richtig'); }
  if (!Array.isArray(out)) throw new Error('Der WMap-Server antwortet nicht richtig');
  if (out[0] !== 0) throw new Error(typeof out[1] === 'string' ? out[1] : 'Fehler auf dem Server');
  return out[1];
}
