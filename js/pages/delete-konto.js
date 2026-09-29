/**
 * Konto löschen (deleteKonto.html): zeigt, was zum angemeldeten Konto gehört,
 * und löscht es nach Rückfrage (konto.remove). Das Konto ist das
 * OpenStreetMap-Konto – nicht angemeldet: erst mit OSM anmelden, dann löschen.
 */
import { konto, ensureLogin } from '../services/konto.js';
import { ask } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { mountAppBar } from '../ui/appbar.js';

const status = document.querySelector('.delete-status');
const button = document.querySelector('.delete-button');

const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const what = (x) => [
  x.tours ? `${n(x.tours, 'Tour', 'Touren')}${x.public_tours ? ` (${x.public_tours} veröffentlicht)` : ''}` : '',
  x.plugins ? `${n(x.plugins, 'Plugin', 'Plugins')}${x.public_plugins ? ` (${x.public_plugins} veröffentlicht)` : ''}` : '',
  x.ratings ? n(x.ratings, 'Bewertung', 'Bewertungen') : '',
].filter(Boolean);

const LABEL = {
  login: '<span class="msr">login</span> Mit OpenStreetMap anmelden',
  delete: '<span class="msr">delete_forever</span> Konto endgültig löschen',
};

async function paint() {
  button.disabled = false;
  if (!konto.loggedIn()) {
    status.innerHTML = '<p><span class="msr">account_circle</span> Du bist hier nicht angemeldet. Melde dich mit dem OpenStreetMap-Konto an, zu dem dein WMap-Konto gehört – danach kannst du es löschen.</p>';
    button.innerHTML = LABEL.login;
    button.dataset.act = 'login';
    return;
  }
  button.innerHTML = LABEL.delete;
  button.dataset.act = 'delete';
  try {
    const s = await konto.summary();
    const list = what(s);
    status.innerHTML = `<p><span class="msr">account_circle</span> Angemeldet als <strong>${esc(s.user.name)}</strong>.</p>
      <p>${list.length ? `Dazu gehören ${esc(list.join(', '))}.` : 'Zu diesem Konto gehören keine Touren, Plugins oder Bewertungen.'}</p>`;
  } catch (err) {
    // Abgelaufene Anmeldung: neu anmelden
    await konto.logout();
    status.innerHTML = `<p><span class="msr">info</span> ${esc(err.message)} – bitte neu anmelden.</p>`;
    button.innerHTML = LABEL.login;
    button.dataset.act = 'login';
  }
}

button.addEventListener('click', async () => {
  if (button.dataset.act === 'login') {
    if (await ensureLogin('Zum Löschen')) paint();
    return;
  }
  const v = await ask({
    icon: 'delete_forever', title: 'Konto wirklich löschen?',
    text: 'Dein WMap-Konto, alle deine Touren, Plugins und Bewertungen werden sofort und endgültig gelöscht. Das lässt sich nicht rückgängig machen. Dein OpenStreetMap-Konto bleibt, wie es ist.',
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Endgültig löschen', primary: true }],
  });
  if (v !== 'yes') return;
  button.disabled = true;
  try {
    const gone = await konto.remove();
    const list = what(gone);
    status.innerHTML = `<p><span class="msr">check_circle</span> Das Konto <strong>${esc(gone.name)}</strong> ist gelöscht${list.length ? ` – mit ${esc(list.join(', '))}` : ''}.</p>
      <p class="muted">Die Freigabe für WMap kannst du auf openstreetmap.org unter Einstellungen → OAuth 2-Anwendungen → Autorisierte Anwendungen widerrufen.</p>`;
    button.hidden = true;
  } catch (err) {
    button.disabled = false;
    await ask({ icon: 'error', title: 'Löschen ging nicht', text: err.message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
  }
});

// Zurück von der Anmeldung in der App (osm/login-return.js)
addEventListener('wmap:login', paint);

mountAppBar();
paint();
