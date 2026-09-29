/**
 * Orte in OpenStreetMap eintragen und bearbeiten – direkt aus dem Ort-Sheet.
 *
 *   Bearbeiten     Name, Beschreibung, Öffnungszeiten, Telefon, Website, Bild,
 *                  dazu je Art die Angaben aus der Ortskarte (ui/poi-info.js
 *                  editFields: Stellplätze, Stecker, Gebühr, Belag …) und
 *                  Merkmale (Lieferdienst, Bio …) eines Orts aus OSM; unter
 *                  „Alle Tags“ die Rohdaten zum direkten Ändern. Ein Tipp auf
 *                  ein Feld der Ortskarte öffnet den Dialog dort (`focus`)
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
import { TRAITS, editFields, EDIT_SOCKETS } from '../ui/poi-info.js';
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

const DESCRIPTION = ['description', 'Beschreibung – kurz und sachlich, keine Werbung', 'textarea', 'z. B. Bio-Bäckerei mit Café, Brot aus eigenem Sauerteig'];

/** Feld mit dem OSM-Schlüssel klein daneben – damit klar ist, was wo landet */
const field = ([k, label, type, ph], v = '', { tag = true } = {}) => `<label class="osm-field" data-edit="${esc(k)}"><span>${label}${tag ? ` <code class="osm-tag">${esc(k)}</code>` : ''}</span>
  ${type === 'textarea'
    ? `<textarea name="${esc(k)}" rows="2" maxlength="255" placeholder="${esc(ph)}">${esc(v)}</textarea>`
    : `<input type="text" inputmode="${type}" name="${esc(k)}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off">`}</label>`;

/* ── Merkmale und alle Tags ───────────────────────────────────────────────── */

// Wie in der Ortskarte (ui/poi-info.js), dazu Rollstuhl; je Wert ein Wort
const EDIT_TRAITS = [
  ...TRAITS.map(([k, label, txt]) => [k, label, k === 'internet_access' ? ['wlan'] : Object.keys(txt)]),
  ['wheelchair', 'Rollstuhlgerecht', ['yes', 'limited']],
];
const WORD = { yes: 'Ja', only: 'Nur', limited: 'Teilweise', wlan: 'Ja', no: 'Nein' };

const traitsBlock = (tags = {}) => `<details class="osm-more"${EDIT_TRAITS.some(([k]) => tags[k]) ? ' open' : ''}>
  <summary><span class="msr">checklist</span> Merkmale <small>Lieferdienst, Bio, Vegan, WLAN …</small></summary>
  <div class="osm-traits">${EDIT_TRAITS.map(([k, label, vals]) => {
    const cur = tags[k] ?? '';
    const opts = [['', '–'], ...[...vals, 'no'].map((v) => [v, WORD[v]])];
    if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur]);
    return `<label class="osm-trait" data-edit="${esc(k)}"><span>${esc(label)} <code class="osm-tag">${esc(k)}</code></span>
      <select name="${esc(k)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }).join('')}</div>
</details>`;

/* ── Angaben je Art (wie in der Ortskarte) ─────────────────────────────────── */

// Öffnungszeiten und Telefon haben eigene Felder, Rollstuhl und Außenplätze stehen bei den Merkmalen
const OWN = new Set(['opening_hours', 'phone', ...EDIT_TRAITS.map(([k]) => k)]);

/** Auswahl: gleiche Beschriftungen nur einmal (z. B. yes/public = öffentlich), der jetzige Wert immer */
function choice(key, options, cur) {
  const seen = new Set();
  const opts = [['', '–'], ...options.filter(([v, l]) => (v === cur || !seen.has(l)) && seen.add(l))];
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur]);
  return `<select name="${esc(key)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function factField({ label, edit: e }, tags) {
  const tag = (k) => `<code class="osm-tag">${esc(k)}</code>`;
  if (e.kind === 'number' || e.kind === 'text') return field([e.key, label, e.kind === 'number' ? 'numeric' : 'text', e.ph ?? ''], tags[e.key] ?? '');
  if (e.kind === 'choice') {
    return `<label class="osm-field" data-edit="${esc(e.key)}"><span>${esc(label)} ${tag(e.key)}</span>${choice(e.key, e.options, tags[e.key] ?? '')}</label>`;
  }
  if (e.kind === 'flags') {
    // Häkchen = …=yes; ein vorher gesetztes „yes“ abhaken entfernt den Tag
    return `<fieldset class="osm-flags" data-edit="${esc(e.key)}"><legend>${esc(label)} ${tag(`${e.key}…`)}</legend>${e.options.map(([v, l]) => {
      const k = `${e.key}${v}`;
      return `<label><input type="checkbox" name="${esc(k)}" data-orig="${esc(tags[k] ?? '')}"${tags[k] === 'yes' ? ' checked' : ''}> ${esc(l)}</label>`;
    }).join('')}</fieldset>`;
  }
  if (e.kind === 'sockets') {
    return `<fieldset class="osm-sockets" data-edit="socket:"><legend>${esc(label)} ${tag('socket:…')}</legend>
      <span></span><small>Anzahl</small><small>Leistung</small>
      ${Object.entries(EDIT_SOCKETS).map(([k, name]) => `<span>${esc(name)}</span>
        <input type="text" inputmode="numeric" name="socket:${esc(k)}" value="${esc(tags[`socket:${k}`] ?? '')}" placeholder="–" autocomplete="off">
        <input type="text" name="socket:${esc(k)}:output" value="${esc(tags[`socket:${k}:output`] ?? '')}" placeholder="z. B. 22 kW" autocomplete="off">`).join('')}
    </fieldset>`;
  }
  return '';
}

/** Block „Angaben“ – die Felder dieser Art (leer, wenn es keine gibt) */
function factsBlock(tags, fields = editFields(tags)) {
  const list = fields.filter((f) => !OWN.has(f.edit.key));
  if (!list.length) return '';
  return `<fieldset class="osm-facts"><legend><span class="msr">tune</span> Angaben</legend>${list.map((f) => factField(f, tags)).join('')}</fieldset>`;
}

/** Dialog an einem Feld öffnen: aufklappen, hinscrollen, markieren */
function focusField(dlg, key) {
  if (!key) return;
  const el = key === 'opening_hours' ? dlg.querySelector('.oh-block')
    : dlg.querySelector(`[data-edit="${CSS.escape(key)}"]`) ?? dlg.querySelector(`[data-edit="${CSS.escape(`contact:${key}`)}"]`);
  if (!el) return;
  el.closest('details')?.setAttribute('open', '');
  if (el.tagName === 'DETAILS') el.open = true;
  el.classList.add('osm-focus');
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'center' });
    el.querySelector('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
  });
}

/** Rohdaten: eine Zeile je Tag. Neu anlegen: leer, für weitere Tags. */
const RAW = '_raw';
const rawBlock = (tags, hint) => `<details class="osm-more">
  <summary><span class="msr">data_object</span> ${tags ? 'Alle Tags' : 'Weitere Tags'} <small>für Kenner – Schlüssel=Wert, eine Zeile je Tag</small></summary>
  <textarea name="${RAW}" class="osm-raw" rows="${tags ? 8 : 3}" spellcheck="false" autocapitalize="off" placeholder="z. B. payment:cash=yes">${esc(Object.entries(tags ?? {}).map(([k, v]) => `${k}=${v}`).sort().join('\n'))}</textarea>
  <p class="muted">${hint}</p>
</details>`;

/** Felder oben ändern → die Zeile unter „Alle Tags“ gleich mit (Bild nicht:
 *  ein Commons-Link wird erst beim Speichern zu wikimedia_commons) */
function syncRaw(dlg) {
  const raw = dlg.querySelector(`textarea[name="${RAW}"]`);
  const update = (e) => {
    const el = e.target;
    if (!raw || !el.name || [RAW, 'gone', 'image'].includes(el.name)) return;
    const value = inputValue(el);
    const lines = raw.value.split('\n').filter((l) => l.trim() && !l.startsWith(`${el.name}=`));
    if (value) lines.push(`${el.name}=${value}`);
    raw.value = lines.sort().join('\n');
  };
  dlg.addEventListener('input', update);
  dlg.addEventListener('change', update);
}

function parseRaw(text = '') {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([^=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) out[m[1].slice(0, 255)] = m[2].slice(0, 255);
  }
  return out;
}

/** Bild: ein Link auf Wikimedia Commons wird zu wikimedia_commons=File:…, sonst image=Link */
function imageTags(set) {
  const url = set.image;
  if (!url) return set;
  const m = url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i);
  if (!m) return set;
  const { image: _, ...rest } = set;
  return { ...rest, wikimedia_commons: decodeURIComponent(m[1]).replace(/_/g, ' ') };
}

/** Häkchen: gesetzt = yes; ein abgehaktes „yes“ = entfernen, sonst bleibt der alte Wert (z. B. no) */
const inputValue = (i) => (i.type === 'checkbox' ? (i.checked ? 'yes' : (i.dataset.orig === 'yes' ? '' : i.dataset.orig ?? '')) : i.value.trim());
const valuesOf = (dlg) => Object.fromEntries([...dlg.querySelectorAll('input[name], select[name], textarea[name]')].map((i) => [i.name, inputValue(i)]));

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

const noteText = (title, vals) => `${title} (über WMap):\n${Object.entries(vals).map(([k, v]) => (v ? `${k}=${v}` : `${k} entfernen`)).join('\n')}`;

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
export async function editPlace({ osm, tags, point, title, focus = null }, { toast }) {
  const mode = account.loggedIn() ? 'edit' : await withoutAccount('Deine Änderung');
  if (mode !== 'edit' && mode !== 'note') return;
  // Bild von Commons: als Link zeigen – geändert gilt nur, was davon abweicht
  const shown = { ...tags, image: tags.image ?? (tags.wikimedia_commons ? `https://commons.wikimedia.org/wiki/${tags.wikimedia_commons.replace(/ /g, '_')}` : '') };
  // Telefon, Website: den Tag ändern, den es schon gibt (contact:website statt eines zweiten website)
  const alias = (k) => ((k === 'phone' || k === 'website') && !tags[k] && tags[`contact:${k}`] ? `contact:${k}` : k);
  const vals = await ask({
    icon: 'edit_location_alt', title: `${title || 'Ort'} bearbeiten`, className: 'osm-edit',
    html: `<div class="osm-form">${field(FIELDS[0], tags.name ?? '')}${field(DESCRIPTION, tags.description ?? '')}${hoursField(tags.opening_hours ?? '')}
        ${factsBlock(tags)}
        ${FIELDS.slice(1).map(([k, ...rest]) => field([alias(k), ...rest], shown[alias(k)] ?? '')).join('')}
        ${traitsBlock(tags)}${rawBlock(tags, 'Was du oben in den Feldern änderst, gilt vor dem, was hier steht. Zeile löschen = Tag entfernen.')}</div>
      <p class="muted">Nur eintragen, was du selbst weißt – z. B. vom Schild vor Ort.</p>`,
    buttons: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'ok', label: mode === 'note' ? 'Hinweis senden' : 'Speichern', primary: true }],
    read: valuesOf,
    setup(dlg) { mountHours(dlg); syncRaw(dlg); focusField(dlg, focus); },
  });
  if (!vals || typeof vals !== 'object') return;
  const { gone, [RAW]: raw, ...form } = vals;
  if (gone) {
    await send({ note: { point, text: `„${title || 'Ort'}“ (${osm.type}/${osm.id}) ist dauerhaft geschlossen – gibt es an dieser Stelle nicht mehr (über WMap).` } }, '', toast, 'bearbeitet');
    return;
  }
  // Ausgang: alle Tags (so wie unter „Alle Tags“ stehen gelassen), darüber
  // die geänderten Felder; leer gemachtes Feld = Tag entfernen
  const next = raw === undefined ? { ...tags } : parseRaw(raw);
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => (shown[k] ?? '') !== v));
  // Bild geleert, das von Commons kam: dann dort weg
  if ('image' in changed && !changed.image && !tags.image && tags.wikimedia_commons) changed.wikimedia_commons = '';
  for (const [k, v] of Object.entries(imageTags(changed))) { if (v) next[k] = v; else delete next[k]; }
  const set = {};
  for (const [k, v] of Object.entries(next)) if (tags[k] !== v) set[k] = v;
  for (const k of Object.keys(tags)) if (!(k in next)) set[k] = '';
  if (!Object.keys(set).length) { toast('Nichts geändert'); return; }
  if (mode === 'note') {
    await send({ note: { point, text: noteText(`Bitte ändern bei „${title}“ (${osm.type}/${osm.id})`, set) } }, '', toast, 'bearbeitet');
    return;
  }
  const expect = Object.fromEntries(Object.keys(set).map((k) => [k, tags[k] ?? null]));
  const ok = await send({ edits: [{ osm, set, expect }] }, `${title || 'Ort'}: ${Object.keys(set).join(', ')} geändert`, toast, 'bearbeitet');
  if (ok) for (const [k, v] of Object.entries(set)) { if (v) tags[k] = v; else delete tags[k]; }
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
        ${field(FIELDS[0])}${field(DESCRIPTION)}${hoursField('', { gone: false })}
        <div class="osm-facts-slot"></div>
        ${FIELDS.slice(1).map((f) => field(f)).join('')}
        <div class="osm-addr">${ADDRESS.map((f) => field(f, addr[f[0]])).join('')}</div>
        ${traitsBlock()}${rawBlock(null, 'Kommt zu den Angaben oben dazu.')}
      </div>
      <p class="muted">Der Punkt liegt dort, wo du lange gedrückt hast. Bitte nur, was es wirklich gibt – vor Ort gesehen.</p>`,
    buttons: [{ value: 'cancel', label: 'Abbrechen' }, { value: 'ok', label: mode === 'note' ? 'Hinweis senden' : 'Eintragen', primary: true }],
    read: valuesOf,
    setup(dlg) {
      mountHours(dlg);
      // Marken passend zur Art vorschlagen
      const sel = dlg.querySelector('select[name="type"]');
      const brand = dlg.querySelector('.osm-brand');
      const slot = dlg.querySelector('.osm-facts-slot');
      const pick = () => {
        // Angaben passend zur Art (Tankstelle: Kraftstoffe, Bezahlung …)
        slot.innerHTML = factsBlock({}, editFields(TYPE_LIST.find(([id]) => id === sel.value)?.[2] ?? {}));
        const list = BRANDS[sel.value] ?? [];
        brand.hidden = !list.length && !/^(shop|craft)$/.test(sel.value) && !TYPE_LIST.find(([id]) => id === sel.value)?.[2].shop;
        dlg.querySelector('#osm-brands').innerHTML = list.map((b) => `<option value="${esc(b)}"></option>`).join('');
      };
      sel.addEventListener('change', pick);
      pick();
    },
  });
  if (!vals || typeof vals !== 'object') return;
  const { type, gone: _, [RAW]: raw, ...rest } = vals;
  if (!rest.name) { toast('Bitte einen Namen angeben'); return; }
  const kind = TYPE_LIST.find(([id]) => id === type) ?? TYPE_LIST[0];
  const tags = { ...parseRaw(raw), ...kind[2], ...imageTags(Object.fromEntries(Object.entries(rest).filter(([, v]) => v))) };
  if (mode === 'note') {
    await send({ note: { point, text: noteText(`Neuer Ort: ${kind[1]} „${rest.name}“`, tags) } }, '', toast, 'neu');
    return;
  }
  await send({ creates: [{ point, tags }] }, `${kind[1]} „${rest.name}“ eingetragen`, toast, 'neu');
}
