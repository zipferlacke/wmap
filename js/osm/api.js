/**
 * OpenStreetMap-Konto: Anmelden (OAuth 2.0 mit PKCE) und Antworten hochladen.
 *
 * Hochgeladen wird immer im Namen des Nutzers, nur was er selbst beantwortet
 * hat, gebündelt in einem Changeset mit source=survey. Das ist die Art, wie
 * StreetComplete & Co. arbeiten – automatische Änderungen ohne Bestätigung
 * wären in OSM nicht erlaubt.
 *
 * Konflikte: Jede Änderung merkt sich, welchen Wert sie vorgefunden hat. Hat
 * inzwischen jemand anderes denselben Schlüssel geändert, wird sie verworfen.
 */
import { OSM_AUTH, APP_VERSION } from '../core/config.js';
import { local } from '../data/store.js';

const SERVER_KEY = 'wmap.osm.server';
const tokenKey = (s) => `wmap.osm.token.${s}`;
const userKey = (s) => `wmap.osm.user.${s}`;
const clientKey = (s) => `wmap.osm.client.${s}`;
const PENDING = 'wmap.osm.pkce';
const SCOPE = 'read_prefs write_api write_notes';

export const account = {
  server: () => (OSM_AUTH[local.get(SERVER_KEY)] ? local.get(SERVER_KEY) : 'live'),
  setServer(s) { local.set(SERVER_KEY, OSM_AUTH[s] ? s : 'live'); },
  conf() { return OSM_AUTH[this.server()]; },
  clientId() { return local.get(clientKey(this.server()), '') || this.conf().clientId; },
  setClientId(id) { local.set(clientKey(this.server()), (id ?? '').trim()); },
  token() { return local.get(tokenKey(this.server()), null); },
  user() { return local.get(userKey(this.server()), null); },
  loggedIn() { return !!this.token(); },
  logout() { local.set(tokenKey(this.server()), null); local.set(userKey(this.server()), null); },
  redirectUri: () => new URL('oauth.html', location.href.split(/[?#]/)[0]).href,
};

/* ── Anmelden ─────────────────────────────────────────────────────────────── */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * Anmeldefenster öffnen. oauth.html meldet den Code zurück – per
 * postMessage an dieses Fenster oder (ohne Fenster, z. B. installierte App)
 * über den Speicher und ein Neuladen, siehe finishLogin().
 * → Promise<{ name }>
 */
export async function login() {
  const conf = account.conf();
  const clientId = account.clientId();
  if (!clientId) throw new Error('Für diese App ist noch keine OSM-Client-ID eingetragen (Einstellungen)');
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  local.set(PENDING, { verifier, state, server: account.server(), at: Date.now() });

  const url = new URL(`${conf.web}/oauth2/authorize`);
  Object.entries({
    client_id: clientId, redirect_uri: account.redirectUri(), response_type: 'code', scope: SCOPE,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  }).forEach(([k, v]) => url.searchParams.set(k, v));

  const win = window.open(url, 'osm-login', 'width=560,height=720');
  if (!win) { location.assign(url); return new Promise(() => {}); }   // Popup gesperrt: ganze Seite
  return new Promise((resolve, reject) => {
    const onMessage = async (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'osm-oauth') return;
      removeEventListener('message', onMessage);
      try { resolve(await exchange(e.data)); } catch (err) { reject(err); }
    };
    addEventListener('message', onMessage);
  });
}

/** Nach der Rückkehr ohne Popup: Code aus dem Speicher einlösen. */
export async function finishLogin() {
  const back = local.get('wmap.osm.return');
  if (!back) return null;
  local.set('wmap.osm.return', null);
  return exchange(back);
}

async function exchange({ code, state, error }) {
  const pending = local.get(PENDING);
  local.set(PENDING, null);
  if (error) throw new Error(error === 'access_denied' ? 'Anmeldung abgebrochen' : `Anmeldung fehlgeschlagen: ${error}`);
  if (!pending || pending.state !== state) throw new Error('Anmeldung ungültig – bitte noch einmal');
  account.setServer(pending.server);
  const conf = account.conf();
  const res = await fetch(`${conf.web}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: account.redirectUri(),
      client_id: account.clientId(), code_verifier: pending.verifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'Anmeldung fehlgeschlagen');
  local.set(tokenKey(pending.server), data.access_token);
  const me = await api('/user/details.json').then((r) => r.json());
  const user = { name: me.user?.display_name ?? '?', id: me.user?.id };
  local.set(userKey(pending.server), user);
  return user;
}

async function api(path, { method = 'GET', body, type } = {}) {
  const token = account.token();
  const res = await fetch(`${account.conf().api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(type ? { 'Content-Type': type } : {}),
    },
    body,
  });
  if (res.status === 401) { account.logout(); throw new Error('OSM-Anmeldung abgelaufen – bitte neu anmelden'); }
  if (!res.ok) throw new Error(`OSM: ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res;
}

/* ── Hochladen ────────────────────────────────────────────────────────────── */

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function elementXml(el, changeset) {
  const tags = Object.entries(el.tags ?? {}).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('');
  const attrs = `id="${el.id}" version="${el.version}" changeset="${changeset}"`;
  if (el.type === 'node') return `<node ${attrs} lat="${el.lat}" lon="${el.lon}">${tags}</node>`;
  if (el.type === 'way') return `<way ${attrs}>${el.nodes.map((n) => `<nd ref="${n}"/>`).join('')}${tags}</way>`;
  return `<relation ${attrs}>${el.members.map((m) => `<member type="${m.type}" ref="${m.ref}" role="${x(m.role)}"/>`).join('')}${tags}</relation>`;
}

/**
 * Tag-Änderungen anwenden, wo nichts dazwischengekommen ist.
 * edit = { osm: { type, id }, set: { k: v }, expect: { k: alterWert|null } }
 * → { changes: [element], applied: [edit], conflicts: [edit] }
 */
function applyEdits(elements, edits) {
  const byKey = new Map(elements.map((e) => [`${e.type}/${e.id}`, { ...e, tags: { ...(e.tags ?? {}) } }]));
  const touched = new Set();
  const applied = [], conflicts = [];
  for (const ed of edits) {
    const key = `${ed.osm.type}/${ed.osm.id}`;
    const el = byKey.get(key);
    const ok = el && Object.entries(ed.expect ?? {}).every(([k, v]) => (el.tags[k] ?? null) === v || el.tags[k] === ed.set[k]);
    if (!ok) { conflicts.push(ed); continue; }
    let changed = false;
    for (const [k, v] of Object.entries(ed.set)) {
      if (el.tags[k] !== v) { el.tags[k] = v; changed = true; }
    }
    if (changed) touched.add(key);
    applied.push(ed);
  }
  return { changes: [...touched].map((k) => byKey.get(k)), applied, conflicts };
}

/**
 * Warteschlange hochladen: Tag-Änderungen und neue Punkte in einem
 * Changeset, Hinweise einzeln.
 * @param creates  neue Orte: [{ point: [lon, lat], tags }]
 * @param source   Quelle im Changeset („survey“: selbst vor Ort gesehen)
 * → { changeset, applied, conflicts, notes }
 */
export async function upload({ edits = [], notes = [], creates = [] }, { comment, source = 'survey' }) {
  // Hinweise gehen auch ohne Konto (anonym) – Änderungen an der Karte nicht
  if ((edits.length || creates.length) && !account.loggedIn()) throw new Error('Nicht bei OSM angemeldet');
  const out = { changeset: null, applied: [], conflicts: [], notes: [] };

  if (edits.length || creates.length) {
    // Aktuellen Stand holen – die Version muss stimmen, sonst lehnt OSM ab
    const ids = { node: new Set(), way: new Set(), relation: new Set() };
    for (const e of edits) ids[e.osm.type].add(e.osm.id);
    const elements = [];
    for (const [type, set] of Object.entries(ids)) {
      if (!set.size) continue;
      const res = await api(`/${type}s.json?${type}s=${[...set].join(',')}`);
      elements.push(...(await res.json()).elements.filter((e) => e.visible !== false));
    }
    const { changes, applied, conflicts } = applyEdits(elements, edits);
    out.applied = applied;
    out.conflicts = conflicts;

    if (changes.length || creates.length) {
      const tags = { created_by: `WMap ${APP_VERSION}`, comment, source, locale: 'de-DE' };
      const cs = await api('/changeset/create', {
        method: 'PUT', type: 'text/xml',
        body: `<osm><changeset>${Object.entries(tags).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('')}</changeset></osm>`,
      }).then((r) => r.text());
      out.changeset = cs.trim();
      try {
        await api(`/changeset/${out.changeset}/upload`, {
          method: 'POST', type: 'text/xml',
          body: `<osmChange version="0.6" generator="WMap">${creates.length ? `<create>${creates.map((c, i) => `<node id="-${i + 1}" changeset="${out.changeset}" lat="${c.point[1].toFixed(7)}" lon="${c.point[0].toFixed(7)}">${Object.entries(c.tags).map(([k, v]) => `<tag k="${x(k)}" v="${x(v)}"/>`).join('')}</node>`).join('')}</create>` : ''}${changes.length ? `<modify>${changes.map((e) => elementXml(e, out.changeset)).join('')}</modify>` : ''}</osmChange>`,
        });
      } finally {
        await api(`/changeset/${out.changeset}/close`, { method: 'PUT' }).catch(() => {});
      }
    }
  }

  for (const n of notes) {
    const res = await api('/notes.json', {
      method: 'POST', type: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ lat: n.point[1].toFixed(6), lon: n.point[0].toFixed(6), text: n.text }),
    });
    out.notes.push({ ...n, id: (await res.json()).properties?.id });
  }
  return out;
}

/** Link zum Ansehen auf osm.org */
export const changesetUrl = (id) => `${account.conf().web}/changeset/${id}`;
export const noteUrl = (id) => `${account.conf().web}/note/${id}`;
