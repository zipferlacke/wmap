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
import { openLink } from '../core/links.js';
// Auswahl mit Suche für <select data-sp-picker> (legt sich selbst an)
import '../../libs/wuefl-libs/selectpicker/selectpicker.js';

/** Arten zum Eintragen – gruppiert; die Auswahl hat eine Suche (wuefl-libs selectpicker) */
const PLACE_TYPES = [
  ['Einkaufen', [
    ['shop', 'Laden (sonstiger)', { shop: 'yes' }],
    ['supermarket', 'Supermarkt', { shop: 'supermarket' }],
    ['bakery', 'Bäckerei', { shop: 'bakery' }],
    ['butcher', 'Metzgerei', { shop: 'butcher' }],
    ['beverages', 'Getränkemarkt', { shop: 'beverages' }],
    ['kiosk', 'Kiosk', { shop: 'kiosk' }],
    ['chemist', 'Drogerie', { shop: 'chemist' }],
    ['pharmacy', 'Apotheke', { amenity: 'pharmacy', healthcare: 'pharmacy' }],
    ['farm', 'Hofladen', { shop: 'farm' }],
    ['florist', 'Blumen', { shop: 'florist' }],
    ['books', 'Buchhandlung', { shop: 'books' }],
    ['clothes', 'Bekleidung', { shop: 'clothes' }],
    ['shoes', 'Schuhe', { shop: 'shoes' }],
    ['electronics', 'Elektronik', { shop: 'electronics' }],
    ['doityourself', 'Baumarkt', { shop: 'doityourself' }],
    ['bicycle', 'Fahrradladen', { shop: 'bicycle' }],
    ['optician', 'Optiker', { shop: 'optician' }],
    ['hairdresser', 'Friseur', { shop: 'hairdresser' }],
    ['fuel', 'Tankstelle', { amenity: 'fuel' }],
  ]],
  ['Essen & Trinken', [
    ['cafe', 'Café', { amenity: 'cafe' }],
    ['restaurant', 'Restaurant', { amenity: 'restaurant' }],
    ['fast_food', 'Imbiss', { amenity: 'fast_food' }],
    ['ice_cream', 'Eisdiele', { amenity: 'ice_cream' }],
    ['bar', 'Bar / Kneipe', { amenity: 'pub' }],
    ['biergarten', 'Biergarten', { amenity: 'biergarten' }],
  ]],
  ['Dienstleistung', [
    ['office', 'Firma / Büro', { office: 'company' }],
    ['craft', 'Handwerksbetrieb', { craft: 'yes' }],
    ['car_repair', 'Autowerkstatt', { shop: 'car_repair' }],
    ['doctors', 'Arztpraxis', { amenity: 'doctors' }],
    ['dentist', 'Zahnarzt', { amenity: 'dentist' }],
    ['bank', 'Bank', { amenity: 'bank' }],
    ['post_office', 'Post', { amenity: 'post_office' }],
    ['hotel', 'Hotel / Pension', { tourism: 'hotel' }],
    ['apartment', 'Ferienwohnung', { tourism: 'apartment' }],
  ]],
  ['Kultur & Freizeit', [
    ['events_venue', 'Veranstaltungsort', { amenity: 'events_venue' }],
    ['community_centre', 'Gemeindezentrum / Saal', { amenity: 'community_centre' }],
    ['theatre', 'Theater', { amenity: 'theatre' }],
    ['cinema', 'Kino', { amenity: 'cinema' }],
    ['nightclub', 'Club / Disco', { amenity: 'nightclub' }],
    ['museum', 'Museum', { tourism: 'museum' }],
    ['sports_centre', 'Sporthalle / -anlage', { leisure: 'sports_centre' }],
  ]],
];
const TYPE_LIST = PLACE_TYPES.flatMap(([, list]) => list);

/** Häufige Marken je Art – als Vorschläge; eigene gehen auch (Tag brand) */
const BRANDS = {
  supermarket: ['EDEKA', 'REWE', 'Lidl', 'ALDI Nord', 'ALDI SÜD', 'Netto Marken-Discount', 'Netto', 'Penny', 'Kaufland', 'Norma', 'tegut', 'nahkauf', 'Globus'],
  beverages: ['Getränke Hoffmann', 'trinkgut', 'Fristo', 'Orterer', 'Getränkeland', 'REWE Getränkemarkt', 'EDEKA Getränkemarkt'],
  bakery: ['Kamps', 'Ditsch', 'BackWerk', 'Lila Bäcker', 'Junge', 'Steinecke', 'Wiener Feinbäcker'],
  butcher: ['Vinzenzmurr'],
  chemist: ['dm', 'Rossmann', 'Müller', 'Budni'],
  fuel: ['Aral', 'Shell', 'Esso', 'TotalEnergies', 'JET', 'Avia', 'Star', 'Agip', 'bft', 'Raiffeisen'],
  doityourself: ['OBI', 'Hornbach', 'Bauhaus', 'toom', 'hagebaumarkt', 'Hellweg', 'Globus Baumarkt'],
  fast_food: ["McDonald's", 'Burger King', 'KFC', 'Subway', 'Nordsee', "Domino's"],
  cafe: ['Starbucks', 'Tchibo', 'Coffee Fellows', 'Balzac Coffee'],
  bank: ['Sparkasse', 'Volksbank', 'Deutsche Bank', 'Commerzbank', 'Postbank', 'Targobank'],
  optician: ['Fielmann', 'Apollo-Optik', 'Pro Optik'],
  electronics: ['MediaMarkt', 'Saturn', 'expert', 'EURONICS'],
  clothes: ['H&M', 'C&A', 'KiK', 'Takko', 'NKD', 'Ernsting\'s family', 'Primark', 'TK Maxx'],
  shoes: ['Deichmann', 'Siemes Schuhcenter', 'Görtz'],
  post_office: ['Deutsche Post', 'DHL'],
  kiosk: ['Presse & Buch'],
};

const FIELDS = [
  ['name', 'Name', 'text', 'z. B. Bäckerei Müller'],
  ['phone', 'Telefon', 'tel', '+49 …'],
  ['website', 'Website', 'url', 'https://…'],
  ['website:events', 'Veranstaltungen – Seite mit den Terminen', 'url', 'https://…/programm'],
  ['image', 'Bild – Link zu einem freien Foto', 'url', 'z. B. commons.wikimedia.org/wiki/File:…'],
  // Art steuert nur die Tastatur – alle Felder sehen gleich aus
];
const ADDRESS = [
  ['addr:street', 'Straße', 'text', ''], ['addr:housenumber', 'Nr.', 'text', ''],
  ['addr:postcode', 'PLZ', 'text', ''], ['addr:city', 'Ort', 'text', ''],
];

/** Feld mit dem OSM-Schlüssel klein daneben – damit klar ist, was wo landet */
const field = ([k, label, type, ph], v = '', { tag = true } = {}) => `<label class="osm-field"><span>${label}${tag ? ` <code class="osm-tag">${esc(k)}</code>` : ''}</span>
  <input type="text" inputmode="${type}" name="${esc(k)}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"></label>`;

/** Bild: ein Link auf Wikimedia Commons wird zu wikimedia_commons=File:…, sonst image=Link */
function imageTags(set) {
  const url = set.image;
  if (!url) return set;
  const m = url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i);
  if (!m) return set;
  const { image: _, ...rest } = set;
  return { ...rest, wikimedia_commons: decodeURIComponent(m[1]).replace(/_/g, ' ') };
}

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
    toast(note ? 'Hinweis gesendet – danke!' : 'In OpenStreetMap eingetragen – danke!', link ? { action: { label: 'Ansehen', run: () => openLink(link) } } : undefined);
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
  // Bild von Commons: als Link zeigen – geändert gilt nur, was davon abweicht
  const shown = { ...tags, image: tags.image ?? (tags.wikimedia_commons ? `https://commons.wikimedia.org/wiki/${tags.wikimedia_commons.replace(/ /g, '_')}` : '') };
  const vals = await ask({
    icon: 'edit_location_alt', title: `${title || 'Ort'} bearbeiten`, className: 'osm-edit',
    html: `<div class="osm-form">${field(FIELDS[0], tags.name ?? '')}${hoursField(tags.opening_hours ?? '')}${FIELDS.slice(1).map((f) => field(f, shown[f[0]] ?? '')).join('')}</div>
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
  const set = imageTags(Object.fromEntries(Object.entries(rest).filter(([k, v]) => (shown[k] ?? '') !== v && v)));
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
        <label class="osm-field"><span>Was ist hier?</span><select name="type" data-sp-picker="Was ist hier?">${PLACE_TYPES.map(([group, list]) => `<optgroup label="${esc(group)}">${list.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label class="osm-field osm-brand" hidden><span>Marke / Kette <code class="osm-tag">brand</code></span>
          <input type="text" name="brand" list="osm-brands" placeholder="z. B. EDEKA – leer lassen, wenn es keine Kette ist" autocomplete="off"><datalist id="osm-brands"></datalist></label>
        ${field(FIELDS[0])}${hoursField('', { gone: false })}${FIELDS.slice(1).map((f) => field(f)).join('')}
        <div class="osm-addr">${ADDRESS.map((f) => field(f, addr[f[0]])).join('')}</div>
      </div>
      <p class="muted">Der Punkt liegt dort, wo du lange gedrückt hast. Bitte nur, was es wirklich gibt – vor Ort gesehen.</p>`,
    buttons: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'ok', label: mode === 'note' ? 'Hinweis senden' : 'Eintragen', primary: true }],
    read: valuesOf,
    setup(dlg) {
      mountHours(dlg);
      // Marken passend zur Art vorschlagen
      const sel = dlg.querySelector('select[name="type"]');
      const brand = dlg.querySelector('.osm-brand');
      const pick = () => {
        const list = BRANDS[sel.value] ?? [];
        brand.hidden = !list.length && !/^(shop|craft)$/.test(sel.value) && !TYPE_LIST.find(([id]) => id === sel.value)?.[2].shop;
        dlg.querySelector('#osm-brands').innerHTML = list.map((b) => `<option value="${esc(b)}"></option>`).join('');
      };
      sel.addEventListener('change', pick);
      pick();
    },
  });
  if (!vals || typeof vals !== 'object') return;
  const { type, gone: _, ...rest } = vals;
  if (!rest.name) { toast('Bitte einen Namen angeben'); return; }
  const kind = TYPE_LIST.find(([id]) => id === type) ?? TYPE_LIST[0];
  const tags = { ...kind[2], ...imageTags(Object.fromEntries(Object.entries(rest).filter(([, v]) => v))) };
  if (mode === 'note') {
    await send({ note: { point, text: noteText(`Neuer Ort: ${kind[1]} „${rest.name}“`, tags) } }, '', toast, 'neu');
    return;
  }
  await send({ creates: [{ point, tags }] }, `${kind[1]} „${rest.name}“ eingetragen`, toast, 'neu');
}
