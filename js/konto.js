/**
 * WMap-Konto per Passkey – kein Passwort, keine E-Mail. Man legt einmal einen
 * Passkey an (Fingerabdruck, Gesicht, Geräte-PIN oder Sicherheitsschlüssel);
 * danach reicht „Anmelden“. Gebraucht wird das Konto nur zum Veröffentlichen,
 * Bewerten und für private Plugins – alles andere geht ohne.
 */
import { api, token } from './api.js';
import { local } from './store.js';
import { ask } from './ui.js';
import { esc } from './geo.js';

const USER = 'wmap.user';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const konto = {
  user: () => local.get(USER),
  loggedIn: () => !!token.get() && !!local.get(USER),
  supported: () => !!window.PublicKeyCredential && !!navigator.credentials,

  /** Neuen Passkey anlegen. */
  async register(name) {
    const o = await api(['auth', 'register_options'], { name });
    const cred = await navigator.credentials.create({ publicKey: {
      ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) },
    } });
    return done(await api(['auth', 'register'], {
      challenge: o.challenge, id: cred.id,
      clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject),
    }));
  },

  /** Mit vorhandenem Passkey anmelden – das Gerät fragt, welcher. */
  async login() {
    const o = await api(['auth', 'login_options']);
    const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: unb64(o.challenge) } });
    return done(await api(['auth', 'login'], {
      challenge: o.challenge, id: cred.id,
      clientDataJSON: b64(cred.response.clientDataJSON), authenticatorData: b64(cred.response.authenticatorData),
      signature: b64(cred.response.signature),
    }));
  },

  async logout() {
    try { await api(['auth', 'logout']); } catch { /* egal */ }
    token.set(null);
    local.set(USER, null);
  },
};

function done({ token: t, user }) {
  token.set(t);
  local.set(USER, user);
  return user;
}

/**
 * Sicherstellen, dass man angemeldet ist – sonst fragen. → Nutzer oder null.
 * @param why  wofür, z. B. „Zum Bewerten“
 */
export async function ensureLogin(why = 'Dafür') {
  if (konto.loggedIn()) return konto.user();
  if (!konto.supported()) {
    await ask({ icon: 'key_off', title: 'Passkeys gehen hier nicht', text: 'Dieser Browser kann keine Passkeys. Mit einem aktuellen Browser klappt es.', buttons: [{ value: 'ok', label: 'OK', primary: true }] });
    return null;
  }
  const v = await ask({
    icon: 'passkey', title: 'Mit Passkey anmelden',
    html: `<p>${esc(why)} brauchst du ein WMap-Konto. Das geht ohne Passwort und ohne E-Mail – mit Fingerabdruck, Gesicht oder der PIN deines Geräts.</p>
      <p class="muted">Neu hier? Gib einen Namen an, er steht bei deinen Touren und Bewertungen.</p>
      <input type="text" class="konto-name" maxlength="40" placeholder="Name (nur beim ersten Mal)" autocomplete="nickname">`,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'login', label: 'Ich habe schon einen' }, { value: 'new', label: 'Passkey anlegen', primary: true }],
    read: (dlg) => ({ name: dlg.querySelector('.konto-name').value.trim() }),
  });
  try {
    if (v === 'login') return await konto.login();
    if (v?.name !== undefined) {
      if (!v.name) { await ask({ icon: 'badge', title: 'Name fehlt', text: 'Für einen neuen Passkey braucht es einen Namen.', buttons: [{ value: 'ok', label: 'OK', primary: true }] }); return null; }
      return await konto.register(v.name);
    }
  } catch (err) {
    if (err.name === 'NotAllowedError') return null;           // selbst abgebrochen
    await ask({ icon: 'error', title: 'Anmelden ging nicht', text: err.message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
  }
  return null;
}
