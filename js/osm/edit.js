/**
 * Orte in OpenStreetMap eintragen und bearbeiten – direkt aus dem Ort-Sheet.
 *
 *   Bearbeiten     Name, Öffnungszeiten, Telefon, Website eines Orts aus OSM
 *                  (Öffnungszeiten je Tag statt als Text: osm/hours-editor.js;
 *                  „Dauerhaft geschlossen“ geht immer als Hinweis – in OSM
 *                  trägt man einen Ort so nicht über die Zeiten aus)
 *   Hier eintragen ein Unternehmen oder einen Veranstaltungsort an einem
 *                  Punkt der Karte neu anlegen (Art, Name, Adresse …)
 *
 * Geht unter dem eigenen OSM-Konto direkt in die Karte (osm/api.js). Ohne
 * Konto erklärt ein Dialog, wozu es gebraucht wird, und führt in die
 * Einstellungen zum Verbinden – oder schickt die Angaben anonym als Hinweis,
 * den Mapper dann eintragen.
 */
import { ask } from '../ui/dialogs.js';
import { account, upload, changesetUrl, noteUrl } from './api.js';
import { countOsm } from './stats.js';
import { esc } from '../core/geo.js';
import { hoursField, mountHours } from './hours-editor.js';

/** Arten zum Eintragen – Unternehmen und Veranstaltungsorte */
const PLACE_TYPES = [
  ['shop', 'Laden', { shop: 'yes' }],
  ['cafe', 'Café', { amenity: 'cafe' }],
  ['restaurant', 'Restaurant', { amenity: 'restaurant' }],
  ['fast_food', 'Imbiss', { amenity: 'fast_food' }],
  ['bar', 'Bar / Kneipe', { amenity: 'pub' }],
  ['office', 'Firma / Büro', { office: 'company' }],
  ['craft', 'Handwerksbetrieb', { craft: 'yes' }],
  ['doctors', 'Arztpraxis', { amenity: 'doctors' }],
  ['hairdresser', 'Friseur', { shop: 'hairdresser' }],
  ['events_venue', 'Veranstaltungsort', { amenity: 'events_venue' }],
  ['community_centre', 'Gemeindezentrum / Saal', { amenity: 'community_centre' }],
  ['theatre', 'Theater', { amenity: 'theatre' }],
  ['cinema', 'Kino', { amenity: 'cinema' }],
  ['nightclub', 'Club / Disco', { amenity: 'nightclub' }],
];

const FIELDS = [
  ['name', 'Name', 'text', 'z. B. Bäckerei Müller'],
  ['phone', 'Telefon', 'tel', '+49 …'],
  ['website', 'Website', 'url', 'https://…'],
  // Art steuert nur die Tastatur – alle Felder sehen gleich aus
];
const ADDRESS = [
  ['addr:street', 'Straße', 'text', ''], ['addr:housenumber', 'Nr.', 'text', ''],
  ['addr:postcode', 'PLZ', 'text', ''], ['addr:city', 'Ort', 'text', ''],
];

const field = ([k, label, type, ph], v = '') => `<label class="osm-field"><span>${label}</span>
  <input type="text" inputmode="${type}" name="${esc(k)}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"></label>`;

const valuesOf = (dlg) => Object.fromEntries([...dlg.querySelectorAll('input[name], select[name]')].map((i) => [i.name, i.value.trim()]));

/**
 * Ohne Konto: erklären, was es braucht. → 'account' | 'note' | null
 * „account“ führt in die Einstellungen (Abschnitt OpenStreetMap).
 */
async function withoutAccount(what) {
  const v = await ask({
    icon: 'account_circle', title: 'OpenStreetMap-Konto verbinden',
    html: `<p>${esc(what)} landet direkt in OpenStreetMap – der offenen Karte, die WMap nutzt. Dafür brauchst du ein kostenloses OSM-Konto; einmal in den Einstellungen verbunden, geht alles unter deinem Namen in die Karte.</p>
      <p class="muted">Ohne Konto kannst du es auch als anonymen Hinweis schicken – Mapper aus der Gegend tragen es dann ein.</p>`,
    buttons: [{ value: 'note', label: 'Als Hinweis senden' }, { value: 'account', label: 'Konto verbinden', primary: true, icon: 'login' }],
  });
  if (v === 'account') location.href = './settings.html#osm';
  return v;
}

const noteText = (title, vals) => `${title} (über WMap):\n${Object.entries(vals).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('\n')}`;

/** @param kind  'bearbeitet' | 'neu' – für die Zählung (osm/stats.js) */
async function send({ edits = [], creates = [], note = null }, comment, toast, kind) {
  try {
    const r = note ? await upload({ notes: [note] }, { comment }) : await upload({ edits, creates }, { comment });
    if (r.conflicts?.length) { toast('Inzwischen hat jemand anderes das geändert – bitte neu laden'); return false; }
    countOsm(kind, note ? 'hinweis' : 'karte');
    const link = r.changeset ? changesetUrl(r.changeset) : r.notes?.[0]?.id ? noteUrl(r.notes[0].id) : null;
    toast(note ? 'Hinweis gesendet – danke!' : 'In OpenStreetMap eingetragen – danke!', link ? { action: { label: 'Ansehen', run: () => window.open(link, '_blank', 'noopener') } } : undefined);
    return true;
  } catch (err) {
    toast(`Ging nicht: ${err.message}`);
    return false;
  }
}

/**
 * Ort aus OSM bearbeiten.
 * @param osm   { type: 'node'|'way'|'relation', id }
 * @param tags  aktuelle Tags
 */
export async function editPlace({ osm, tags, point, title }, { toast }) {
  const mode = account.loggedIn() ? 'edit' : await withoutAccount('Deine Änderung');
  if (mode !== 'edit' && mode !== 'note') return;
  const vals = await ask({
    icon: 'edit_location_alt', title: `${title || 'Ort'} bearbeiten`, className: 'osm-edit',
    html: `<div class="osm-form">${field(FIELDS[0], tags.name ?? '')}${hoursField(tags.opening_hours ?? '')}${FIELDS.slice(1).map((f) => field(f, tags[f[0]] ?? '')).join('')}</div>
      <p class="muted">Nur eintragen, was du selbst weißt – z. B. vom Schild vor Ort.</p>`,
    buttons: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'ok', label: mode === 'note' ? 'Hinweis senden' : 'Speichern', primary: true }],
    read: valuesOf,
    setup: mountHours,
  });
  if (!vals || typeof vals !== 'object') return;
  const { gone, ...rest } = vals;
  if (gone) {
    await send({ note: { point, text: `„${title || 'Ort'}“ (${osm.type}/${osm.id}) ist dauerhaft geschlossen – gibt es an dieser Stelle nicht mehr (über WMap).` } }, '', toast, 'bearbeitet');
    return;
  }
  const set = Object.fromEntries(Object.entries(rest).filter(([k, v]) => (tags[k] ?? '') !== v && v));
  if (!Object.keys(set).length) { toast('Nichts geändert'); return; }
  if (mode === 'note') {
    await send({ note: { point, text: noteText(`Bitte ändern bei „${title}“ (${osm.type}/${osm.id})`, set) } }, '', toast, 'bearbeitet');
    return;
  }
  const expect = Object.fromEntries(Object.keys(set).map((k) => [k, tags[k] ?? null]));
  const ok = await send({ edits: [{ osm, set, expect }] }, `${title || 'Ort'}: ${Object.keys(set).join(', ')} ergänzt`, toast, 'bearbeitet');
  if (ok) Object.assign(tags, set);
}

/**
 * Unternehmen oder Veranstaltungsort an einem Punkt eintragen.
 * @param address  Vorschlag aus der Rückwärtssuche ({ street, housenumber, postcode, city })
 */
export async function addPlace(point, { address = {}, toast }) {
  const mode = account.loggedIn() ? 'add' : await withoutAccount('Der neue Ort');
  if (mode !== 'add' && mode !== 'note') return;
  const addr = { 'addr:street': address.street ?? '', 'addr:housenumber': address.housenumber ?? '', 'addr:postcode': address.postcode ?? '', 'addr:city': address.city ?? '' };
  const vals = await ask({
    icon: 'add_business', title: 'Ort eintragen', className: 'osm-edit',
    html: `<div class="osm-form">
        <label class="osm-field"><span>Was ist hier?</span><select name="type">${PLACE_TYPES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
        ${field(FIELDS[0])}${hoursField('', { gone: false })}${FIELDS.slice(1).map((f) => field(f)).join('')}
        <div class="osm-addr">${ADDRESS.map((f) => field(f, addr[f[0]])).join('')}</div>
      </div>
      <p class="muted">Der Punkt liegt dort, wo du lange gedrückt hast. Bitte nur, was es wirklich gibt – vor Ort gesehen.</p>`,
    buttons: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'ok', label: mode === 'note' ? 'Hinweis senden' : 'Eintragen', primary: true }],
    read: valuesOf,
    setup: mountHours,
  });
  if (!vals || typeof vals !== 'object') return;
  const { type, gone: _, ...rest } = vals;
  if (!rest.name) { toast('Bitte einen Namen angeben'); return; }
  const kind = PLACE_TYPES.find(([id]) => id === type) ?? PLACE_TYPES[0];
  const tags = { ...kind[2], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v)) };
  if (mode === 'note') {
    await send({ note: { point, text: noteText(`Neuer Ort: ${kind[1]} „${rest.name}“`, tags) } }, '', toast, 'neu');
    return;
  }
  await send({ creates: [{ point, tags }] }, `${kind[1]} „${rest.name}“ eingetragen`, toast, 'neu');
}
