/**
 * Kurzer Link beim Teilen (bEnd/api_share.php). Sonst steckt alles im Link selbst – bei einer langen
 * Aufzeichnung wird er für manches Chatfeld zu lang. Auf Wunsch liegt der gepackte Inhalt dann 30 Tage auf dem
 * WMap-Server, der Link trägt nur die Kennung – und den Schlüssel: Der Inhalt wird hier verschlüsselt (AES-GCM),
 * der Schlüssel steht nur im Link hinter #, der Server bekommt ihn nie zu sehen.
 *
 *   wege.html#k=<Kennung>.<Schlüssel>            geteilte Aufzeichnung (sonst #weg=…)
 *   tour.html#k=<Kennung>.<Schlüssel>            geteilte Tour (sonst #t=…)
 *   tour.html#k=<Kennung>.<Schlüssel>.<Recht>    gemeinsam planen: wer den Link hat, darf die Tour ändern
 * Ältere Links (#k=<Kennung>, unverschlüsselt) gehen weiter.
 *
 * Wer so einen Link öffnet, bekommt den Inhalt vom Server und sieht danach dasselbe wie mit dem langen Link
 * (resolveShort setzt ihn in die Adresse). Gemeinsam planen (pages/tour.js): `collabLink` legt an, `collabGet`
 * holt den neuesten Stand, `collabPut` schreibt die eigene Änderung zurück.
 */
import { api } from '../services/api.js';
import { pageUrl } from '../ui/share.js';
import { t } from '../core/i18n.js';

const PAGE = { weg: ['wege.html', 'weg'], tour: ['tour.html', 't'] };
export const COLLAB_OPEN = 'wmap.collabOpen';     // sessionStorage: gerade geöffneter Link zum Mitplanen

/* ── Verschlüsseln ────────────────────────────────────────────────────────── */

const b64u = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const canSeal = () => !!globalThis.crypto?.subtle;
const keyOf = (raw, use) => crypto.subtle.importKey('raw', unb64u(raw), 'AES-GCM', false, [use]);

async function seal(text, raw) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(raw, 'encrypt'), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64u(out);
}
async function unseal(code, raw) {
  const all = unb64u(code);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await keyOf(raw, 'decrypt'), all.subarray(12));
  return new TextDecoder().decode(pt);
}
const newKey = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

/* ── Kurzer Link ──────────────────────────────────────────────────────────── */

/** Inhalt hochladen → kurzer Link (wirft mit lesbarer Meldung). Ohne Verschlüsselung im Browser (http): wie früher */
export async function shortLink(kind, code) {
  const key = canSeal() ? newKey() : null;
  const { id } = await api(['share', 'put'], { kind, code: key ? await seal(code, key) : code });
  return `${pageUrl(PAGE[kind][0])}#k=${id}${key ? `.${key}` : ''}`;
}

/** Steht ein kurzer Link in der Adresse (#k=…): Inhalt holen und als langen einsetzen → true | Fehlermeldung | null (kein kurzer Link) */
export async function resolveShort() {
  const m = location.hash.match(/^#k=([A-Za-z0-9]+)(?:\.([\w-]+))?(?:\.([\w-]+))?$/);
  if (!m) return null;
  const [, id, key, token] = m;
  try {
    const got = await api(['share', 'get'], { id });
    const code = key ? await unseal(got.code, key) : got.code;
    // Gemeinsam planen: Kennung, Schlüssel und Recht für den Planer merken (nur diese Sitzung)
    if (token && got.kind === 'tour') sessionStorage.setItem(COLLAB_OPEN, JSON.stringify({ id, key, token, rev: got.rev, editor: got.editor ?? null, expires: got.expires ?? null, code }));
    history.replaceState(null, '', `${location.pathname}${location.search}#${PAGE[got.kind][1]}=${code}`);
    return true;
  } catch (err) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return err?.name === 'OperationError' ? t('share.link.error.key') : err.message || t('share.link.error.open');
  }
}

/* ── Gemeinsam planen ─────────────────────────────────────────────────────── */

/** Tour zum Mitplanen hochladen → { url, collab: { id, key, token, rev } } */
export async function collabLink(code, editor = null) {
  if (!canSeal()) throw new Error(t('share.collab.error.https'));
  const key = newKey();
  const { id, token } = await api(['share', 'put'], { kind: 'tour', code: await seal(code, key), edit: true });
  if (editor) await api(['share', 'update'], { id, token, code: await seal(code, key), rev: 1, editor }).catch(() => null);
  // own: selbst geteilt (sonst eingeladen, `by`: von wem); expires: Unix-Zeit – 30 Tage ab der letzten Änderung
  const collab = { id, key, token, rev: editor ? 2 : 1, own: true, expires: Math.round(Date.now() / 1000) + 30 * 86400 };
  return { url: collabUrl(collab), collab };
}
export const collabUrl = (c) => `${pageUrl('tour.html')}#k=${c.id}.${c.key}.${c.token}`;

/** Neuester Stand → { code, rev, editor, changed, expires } */
export async function collabGet(c) {
  const got = await api(['share', 'get'], { id: c.id });
  return { code: await unseal(got.code, c.key), rev: got.rev, editor: got.editor ?? null, changed: got.changed ?? 0, expires: got.expires ?? null };
}

/** Chip: geteilt bzw. eingeladen, wie lange noch → { icon, text, gone } (Listen in pages/wege.js, Planer) */
export function collabState(c) {
  const days = c.expires ? Math.ceil((c.expires * 1000 - Date.now()) / 864e5) : null;
  const left = days == null ? '' : days > 0 ? ` · ${t('share.collab.days_left', { n: days })}` : '';
  if (c.gone || (days != null && days <= 0)) return { icon: 'link_off', text: t('share.collab.expired'), gone: true };
  return c.own ? { icon: 'group', text: `${t('share.collab.shared')}${left}` } : { icon: 'group_add', text: `${c.by ? t('share.collab.invited_by', { by: c.by }) : t('share.collab.invited')}${left}` };
}

/** Eigene Änderung zurückschreiben (auf Stand c.rev) → { ok: true, rev } | { ok: false, rev, code, editor } */
export async function collabPut(c, code, editor) {
  const r = await api(['share', 'update'], { id: c.id, token: c.token, code: await seal(code, c.key), rev: c.rev, editor });
  return r.ok ? r : { ...r, code: await unseal(r.code, c.key) };
}
