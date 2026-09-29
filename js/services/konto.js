/**
 * WMap-Konto = dein OpenStreetMap-Konto. Angemeldet wird bei OSM
 * (osm/api.js, mit dem Recht „openid“); der WMap-Server prüft das id_token
 * und gibt ein eigenes Token fürs Veröffentlichen, Bewerten und private
 * Plugins. Bei WMap gibt es kein Passwort. Eine Anmeldung gilt für beides:
 * Karte bearbeiten und WMap-Konto; Abmelden ebenso.
 */
import { api, token } from './api.js';
import { local } from '../data/store.js';
import { ask } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { account, login } from '../osm/api.js';

const USER = 'wmap.user';

export const konto = {
  user: () => local.get(USER),
  loggedIn: () => !!token.get() && !!local.get(USER),

  /** id_token von OSM beim WMap-Server einlösen (osm/api.js nach der Anmeldung). */
  async connect(idToken, name) {
    return done(await api(['auth', 'osm'], { id_token: idToken, name }));
  },

  /** Was zum angemeldeten Konto gehört → { user, tours, public_tours, plugins, public_plugins, ratings } */
  summary: () => api(['auth', 'summary']),

  /** Konto mit allen Touren, Plugins und Bewertungen löschen → was gelöscht wurde (wie summary, dazu name) */
  async remove() {
    const gone = await api(['auth', 'delete']);
    forget();
    account.logout();
    return gone;
  },

  async logout() {
    try { await api(['auth', 'logout']); } catch { /* egal */ }
    forget();
    account.logout();
  },
};

function done({ token: t, user }) {
  token.set(t);
  local.set(USER, user);
  return user;
}

function forget() {
  token.set(null);
  local.set(USER, null);
}

/**
 * Sicherstellen, dass man angemeldet ist – sonst fragen. → Nutzer oder null.
 * In der App verlässt die Anmeldung die Seite; zurück kommt man auf dieselbe
 * Seite (osm/login-return.js), der Aufruf hier endet dann nicht.
 * @param why  wofür, z. B. „Zum Bewerten“
 */
export async function ensureLogin(why = 'Dafür') {
  if (konto.loggedIn() && account.loggedIn()) return konto.user();
  if (!account.clientId()) {
    await ask({ icon: 'info', title: 'Anmeldung nicht eingerichtet', text: 'Für diese WMap fehlt noch die OpenStreetMap-Client-ID (Einstellungen → Konto → Für Entwickler).', buttons: [{ value: 'ok', label: 'OK', primary: true }] });
    return null;
  }
  const v = await ask({
    icon: 'account_circle', title: 'Mit OpenStreetMap anmelden',
    html: `<p>${esc(why)} brauchst du ein Konto. WMap nimmt dafür dein OpenStreetMap-Konto – bei WMap gibt es kein eigenes Passwort.</p>
      <p class="muted">Noch keins? Das legst du bei der Anmeldung auf openstreetmap.org an. Damit kannst du auch Orte in der Karte eintragen und verbessern.</p>`,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Anmelden', primary: true }],
  });
  if (v !== 'yes') return null;
  try {
    const user = await login();
    if (!konto.loggedIn()) throw new Error(user.wmapError ?? 'Der WMap-Server hat die Anmeldung nicht angenommen');
    return konto.user();
  } catch (err) {
    await ask({ icon: 'error', title: 'Anmelden ging nicht', text: err.message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
  }
  return null;
}
