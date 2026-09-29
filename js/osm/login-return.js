/**
 * Rückkehr von der OSM-Anmeldung ohne Popup (App, installierte Web-App):
 * oauth.html schickt zurück auf die Seite, von der die Anmeldung kam; hier
 * wird der Code eingelöst. theme.js lädt das nur, wenn etwas wartet.
 * Seiten zeichnen sich über das Ereignis „wmap:login“ neu.
 */
import { finishLogin } from './api.js';
import { toast } from '../ui/dialogs.js';

finishLogin().then((user) => {
  if (!user) return;
  toast(user.wmapError ? `Bei OpenStreetMap angemeldet als ${user.name} – WMap-Konto: ${user.wmapError}` : `Angemeldet als ${user.name}`);
}).catch((err) => toast(err.message));
