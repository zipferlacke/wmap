/**
 * Konto löschen (deleteKonto.html): zeigt, was zum angemeldeten Konto gehört,
 * und löscht es nach Rückfrage – bestätigt mit dem Passkey (konto.remove).
 * Geht auch ohne Anmeldung: das Gerät fragt nach dem Passkey, und dessen
 * Konto wird gelöscht.
 */
import { konto } from './konto.js';
import { ask } from './ui.js';
import { esc } from './geo.js';
import { mountAppBar } from './appbar.js';

const status = document.querySelector('.delete-status');
const button = document.querySelector('.delete-button');

const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const what = (x) => [
  x.tours ? `${n(x.tours, 'Tour', 'Touren')}${x.public_tours ? ` (${x.public_tours} veröffentlicht)` : ''}` : '',
  x.plugins ? `${n(x.plugins, 'Plugin', 'Plugins')}${x.public_plugins ? ` (${x.public_plugins} veröffentlicht)` : ''}` : '',
  x.ratings ? n(x.ratings, 'Bewertung', 'Bewertungen') : '',
].filter(Boolean);

async function paint() {
  if (!konto.supported()) {
    status.innerHTML = '<p><span class="msr">key_off</span> Dieser Browser kann keine Passkeys. Öffne die Seite mit einem aktuellen Browser auf dem Gerät mit deinem Passkey – oder schreib uns (unten).</p>';
    button.disabled = true;
    return;
  }
  if (!konto.loggedIn()) {
    status.innerHTML = '<p><span class="msr">passkey</span> Du bist hier nicht angemeldet. Das macht nichts: Beim Löschen fragt dein Gerät nach dem Passkey.</p>';
    return;
  }
  try {
    const s = await konto.summary();
    const list = what(s);
    status.innerHTML = `<p><span class="msr">account_circle</span> Angemeldet als <strong>${esc(s.user.name)}</strong>.</p>
      <p>${list.length ? `Dazu gehören ${esc(list.join(', '))}.` : 'Zu diesem Konto gehören keine Touren, Plugins oder Bewertungen.'}</p>`;
  } catch (err) {
    // Abgelaufene Anmeldung: Löschen geht trotzdem, per Passkey
    status.innerHTML = `<p><span class="msr">info</span> ${esc(err.message)} – Löschen geht trotzdem, dein Gerät fragt nach dem Passkey.</p>`;
  }
}

button.addEventListener('click', async () => {
  const v = await ask({
    icon: 'delete_forever', title: 'Konto wirklich löschen?',
    text: 'Dein Konto, alle deine Touren, Plugins und Bewertungen werden sofort und endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Endgültig löschen', primary: true }],
  });
  if (v !== 'yes') return;
  button.disabled = true;
  try {
    const gone = await konto.remove();
    const list = what(gone);
    status.innerHTML = `<p><span class="msr">check_circle</span> Das Konto <strong>${esc(gone.name)}</strong> ist gelöscht${list.length ? ` – mit ${esc(list.join(', '))}` : ''}.</p>
      <p class="muted">Den Passkey kannst du jetzt in der Passkey-Verwaltung deines Geräts entfernen.</p>`;
    button.hidden = true;
  } catch (err) {
    button.disabled = false;
    if (err.name === 'NotAllowedError') return;                // selbst abgebrochen
    await ask({ icon: 'error', title: 'Löschen ging nicht', text: err.message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
  }
});

mountAppBar();
paint();
