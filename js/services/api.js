/**
 * Verbindung zur WMap-API (bEnd/api.php) – Aufbau wie bei wuecash:
 * POST mit `request` (Pfad) und `data` (JSON), Antwort [0, Wert] | [1, Meldung].
 * Im Browser liegt die API neben der Seite; in der App (Tauri) unter PUBLIC_URL.
 */
import { PUBLIC_URL } from '../core/config.js';
import { local } from '../data/store.js';
import { t, baseValue } from '../core/i18n.js';

const web = /^https?:$/.test(location.protocol) && location.hostname !== 'tauri.localhost';
const BASE = web ? new URL('bEnd/api.php', location.href.replace(/[^/]*$/, '')).href : `${PUBLIC_URL}bEnd/api.php`;
const TOKEN = 'wmap.token';

export const token = {
  get: () => local.get(TOKEN),
  set: (t) => local.set(TOKEN, t),
};

/*
 * Der Server antwortet auf Deutsch. Unter „server“ in der Sprachdatei steht jede Meldung im Wortlaut: So wird sie
 * übersetzt und bekommt mit `key` einen festen Namen, an dem der Code sie erkennt, statt am Text.
 */
function serverEntries(node = baseValue('server'), path = 'server') {
  return Object.entries(node ?? {}).flatMap(([k, v]) => (typeof v === 'string' ? [[`${path}.${k}`, v]] : serverEntries(v, `${path}.${k}`)));
}
function serverError(message) {
  for (const [key, text] of serverEntries()) {
    const re = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{days\\}', '(\\d+)')}$`);
    const m = message.match(re);
    if (m) return Object.assign(new Error(t(key, { days: m[1] })), { key });
  }
  return new Error(message);
}

/** → Ergebnis; wirft mit lesbarer Meldung */
export async function api(path, data = {}, { signal } = {}) {
  const body = new FormData();
  body.set('request', JSON.stringify(path));
  body.set('data', JSON.stringify(data));
  const bearer = token.get();
  let res;
  try {
    res = await fetch(BASE, { method: 'POST', body, signal, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(t('services.api.error.unreachable'));
  }
  let out;
  try { out = await res.json(); } catch { throw new Error(t('services.api.error.bad_answer')); }
  if (!Array.isArray(out)) throw new Error(t('services.api.error.bad_answer'));
  if (out[0] !== 0) throw typeof out[1] === 'string' ? serverError(out[1]) : new Error(t('services.api.error.server'));
  return out[1];
}
