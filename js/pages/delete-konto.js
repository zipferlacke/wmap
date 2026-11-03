/**
 * Konto löschen (deleteKonto.html): zeigt, was zum angemeldeten Konto gehört,
 * und löscht es nach Rückfrage (konto.remove). Das Konto ist das
 * OpenStreetMap-Konto – nicht angemeldet: erst mit OSM anmelden, dann löschen.
 */
import { konto, ensureLogin } from '../services/konto.js';
import { ask } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { mountAppBar } from '../ui/appbar.js';
import { t } from '../core/i18n.js';

const status = document.querySelector('.delete-status');
const button = document.querySelector('.delete-button');

const what = (x) => [
  x.tours ? `${t('delete_konto.summary.tours', { n: x.tours })}${x.public_tours ? t('delete_konto.summary.published', { n: x.public_tours }) : ''}` : '',
  x.plugins ? `${t('delete_konto.summary.plugins', { n: x.plugins })}${x.public_plugins ? t('delete_konto.summary.published', { n: x.public_plugins }) : ''}` : '',
  x.ratings ? t('delete_konto.summary.ratings', { n: x.ratings }) : '',
].filter(Boolean);

const LABEL = {
  login: `<span class="msr">login</span> ${t('delete_konto.now.login')}`,
  delete: `<span class="msr">delete_forever</span> ${t('delete_konto.now.button')}`,
};

async function paint() {
  button.disabled = false;
  if (!konto.loggedIn()) {
    status.innerHTML = `<p><span class="msr">account_circle</span> ${t('delete_konto.status.logged_out')}</p>`;
    button.innerHTML = LABEL.login;
    button.dataset.act = 'login';
    return;
  }
  button.innerHTML = LABEL.delete;
  button.dataset.act = 'delete';
  try {
    const s = await konto.summary();
    const list = what(s);
    status.innerHTML = `<p><span class="msr">account_circle</span> ${t('delete_konto.status.signed_in', { name: esc(s.user.name) })}</p>
      <p>${list.length ? t('delete_konto.status.contains', { list: esc(list.join(', ')) }) : t('delete_konto.status.empty')}</p>`;
  } catch (err) {
    // Abgelaufene Anmeldung: neu anmelden
    await konto.logout();
    status.innerHTML = `<p><span class="msr">info</span> ${t('delete_konto.status.expired', { error: esc(err.message) })}</p>`;
    button.innerHTML = LABEL.login;
    button.dataset.act = 'login';
  }
}

button.addEventListener('click', async () => {
  if (button.dataset.act === 'login') {
    if (await ensureLogin(t('delete_konto.login_reason'))) paint();
    return;
  }
  const v = await ask({
    icon: 'delete_forever', title: t('delete_konto.confirm.title'),
    text: t('delete_konto.confirm.text'),
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('delete_konto.confirm.button'), primary: true }],
  });
  if (v !== 'yes') return;
  button.disabled = true;
  try {
    const gone = await konto.remove();
    const list = what(gone);
    status.innerHTML = `<p><span class="msr">check_circle</span> ${list.length ? t('delete_konto.status.deleted_with', { name: esc(gone.name), list: esc(list.join(', ')) }) : t('delete_konto.status.deleted', { name: esc(gone.name) })}</p>
      <p class="muted">${t('delete_konto.status.revoke')}</p>`;
    button.hidden = true;
  } catch (err) {
    button.disabled = false;
    await ask({ icon: 'error', title: t('delete_konto.error.title'), text: err.message, buttons: [{ value: 'ok', label: t('common.ok'), primary: true }] });
  }
});

// Zurück von der Anmeldung in der App (osm/login-return.js)
addEventListener('wmap:login', paint);

mountAppBar();
paint();
