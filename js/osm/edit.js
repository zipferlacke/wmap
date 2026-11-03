/**
 * Orte in OpenStreetMap eintragen und bearbeiten – direkt aus dem Ort-Sheet.
 *
 *   Bearbeiten     einen Ort aus OSM, von oben nach unten:
 *                    Name
 *                    Angaben     was die Ortskarte zeigt (ui/poi-info.js
 *                                editFields: Stellplätze, Stecker, Gebühr …)
 *                    Grundlegendes  Beschreibung, Öffnungszeiten, Telefon,
 *                                Website – soweit nicht schon bei den Angaben
 *                    Ausgefülltes  weitere Felder mit Wert (Adresse, Bild,
 *                                Programm, Merkmale wie Lieferdienst, Bio …)
 *                    Weiteres    zugeklappt: die leeren weiteren Felder, am
 *                                Ende „Alle Tags“ zum direkten Ändern
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
import { TRAITS, EQUIPMENT, editFields, EDIT_SOCKETS } from '../ui/poi-info.js';
import { t, tBase } from '../core/i18n.js';
// Auswahl mit Suche für <select data-sp-picker> (legt sich selbst an)
import '../../libs/wuefl-libs/selectpicker/selectpicker.js';

/** Arten zum Eintragen – gruppiert; die Auswahl hat eine Suche (wuefl-libs selectpicker) */
const PLACE_TYPES = [
  [t('osm.edit.types.groups.shopping'), [
    ['shop', t('osm.edit.types.items.shop'), { shop: 'yes' }],
    ['supermarket', t('osm.edit.types.items.supermarket'), { shop: 'supermarket' }],
    ['bakery', t('osm.edit.types.items.bakery'), { shop: 'bakery' }],
    ['butcher', t('osm.edit.types.items.butcher'), { shop: 'butcher' }],
    ['beverages', t('osm.edit.types.items.beverages'), { shop: 'beverages' }],
    ['kiosk', t('osm.edit.types.items.kiosk'), { shop: 'kiosk' }],
    ['chemist', t('osm.edit.types.items.chemist'), { shop: 'chemist' }],
    ['pharmacy', t('osm.edit.types.items.pharmacy'), { amenity: 'pharmacy', healthcare: 'pharmacy' }],
    ['farm', t('osm.edit.types.items.farm'), { shop: 'farm' }],
    ['florist', t('osm.edit.types.items.florist'), { shop: 'florist' }],
    ['books', t('osm.edit.types.items.books'), { shop: 'books' }],
    ['clothes', t('osm.edit.types.items.clothes'), { shop: 'clothes' }],
    ['shoes', t('osm.edit.types.items.shoes'), { shop: 'shoes' }],
    ['electronics', t('osm.edit.types.items.electronics'), { shop: 'electronics' }],
    ['doityourself', t('osm.edit.types.items.doityourself'), { shop: 'doityourself' }],
    ['bicycle', t('osm.edit.types.items.bicycle'), { shop: 'bicycle' }],
    ['optician', t('osm.edit.types.items.optician'), { shop: 'optician' }],
    ['hairdresser', t('osm.edit.types.items.hairdresser'), { shop: 'hairdresser' }],
    ['fuel', t('osm.edit.types.items.fuel'), { amenity: 'fuel' }],
  ]],
  [t('osm.edit.types.groups.food'), [
    ['cafe', t('osm.edit.types.items.cafe'), { amenity: 'cafe' }],
    ['restaurant', t('osm.edit.types.items.restaurant'), { amenity: 'restaurant' }],
    ['fast_food', t('osm.edit.types.items.fast_food'), { amenity: 'fast_food' }],
    ['ice_cream', t('osm.edit.types.items.ice_cream'), { amenity: 'ice_cream' }],
    ['bar', t('osm.edit.types.items.bar'), { amenity: 'pub' }],
    ['biergarten', t('osm.edit.types.items.biergarten'), { amenity: 'biergarten' }],
  ]],
  [t('osm.edit.types.groups.services'), [
    ['office', t('osm.edit.types.items.office'), { office: 'company' }],
    ['craft', t('osm.edit.types.items.craft'), { craft: 'yes' }],
    ['car_repair', t('osm.edit.types.items.car_repair'), { shop: 'car_repair' }],
    ['doctors', t('osm.edit.types.items.doctors'), { amenity: 'doctors' }],
    ['dentist', t('osm.edit.types.items.dentist'), { amenity: 'dentist' }],
    ['bank', t('osm.edit.types.items.bank'), { amenity: 'bank' }],
    ['post_office', t('osm.edit.types.items.post_office'), { amenity: 'post_office' }],
    ['hotel', t('osm.edit.types.items.hotel'), { tourism: 'hotel' }],
    ['apartment', t('osm.edit.types.items.apartment'), { tourism: 'apartment' }],
  ]],
  [t('osm.edit.types.groups.culture'), [
    ['events_venue', t('osm.edit.types.items.events_venue'), { amenity: 'events_venue' }],
    ['community_centre', t('osm.edit.types.items.community_centre'), { amenity: 'community_centre' }],
    ['theatre', t('osm.edit.types.items.theatre'), { amenity: 'theatre' }],
    ['cinema', t('osm.edit.types.items.cinema'), { amenity: 'cinema' }],
    ['nightclub', t('osm.edit.types.items.nightclub'), { amenity: 'nightclub' }],
    ['museum', t('osm.edit.types.items.museum'), { tourism: 'museum' }],
    ['sports_centre', t('osm.edit.types.items.sports_centre'), { leisure: 'sports_centre' }],
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
  ['name', t('osm.edit.fields.name.title'), 'text', t('osm.edit.fields.name.placeholder')],
  ['phone', t('osm.edit.fields.phone.title'), 'tel', t('osm.edit.fields.phone.placeholder')],
  ['website', t('osm.edit.fields.website.title'), 'url', t('osm.edit.fields.website.placeholder')],
  ['website:events', t('osm.edit.fields.events.title'), 'url', t('osm.edit.fields.events.placeholder')],
  ['image', t('osm.edit.fields.image.title'), 'url', t('osm.edit.fields.image.placeholder')],
  // Art steuert nur die Tastatur – alle Felder sehen gleich aus
];
const ADDRESS = [
  ['addr:street', t('osm.edit.fields.address.street'), 'text', ''], ['addr:housenumber', t('osm.edit.fields.address.housenumber'), 'text', ''],
  ['addr:postcode', t('osm.edit.fields.address.postcode'), 'text', ''], ['addr:city', t('osm.edit.fields.address.city'), 'text', ''],
];

const DESCRIPTION = ['description', t('osm.edit.fields.description.title'), 'textarea', t('osm.edit.fields.description.placeholder')];

/** Feld mit dem OSM-Schlüssel klein daneben – damit klar ist, was wo landet */
const field = ([k, label, type, ph], v = '', { tag = true } = {}) => `<label class="osm-field"><span>${label}${tag ? ` <code class="osm-tag">${esc(k)}</code>` : ''}</span>
  ${type === 'textarea'
    ? `<textarea name="${esc(k)}" rows="2" maxlength="255" placeholder="${esc(ph)}">${esc(v)}</textarea>`
    : `<input type="text" inputmode="${type}" name="${esc(k)}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off">`}</label>`;

/* ── Merkmale und alle Tags ───────────────────────────────────────────────── */

// Wie in der Ortskarte (ui/poi-info.js), dazu Rollstuhl; je Wert ein Wort
const EDIT_TRAITS = [
  ...TRAITS.map(([k, label, txt]) => [k, label, k === 'internet_access' ? ['wlan'] : Object.keys(txt)]),
  ...EQUIPMENT.filter(([k]) => k !== 'wheelchair').map(([k, label]) => [k, label, k === 'internet_access' ? ['wlan'] : ['yes']]),
  ['toilets:access', t('osm.edit.traits.toilets'), ['yes', 'customers']],
  ['wheelchair', t('osm.edit.traits.wheelchair'), ['yes', 'limited']],
];
const WORD = { yes: t('osm.edit.traits.values.yes'), only: t('osm.edit.traits.values.only'), limited: t('osm.edit.traits.values.limited'), wlan: t('osm.edit.traits.values.wlan'), no: t('osm.edit.traits.values.no'), customers: t('osm.edit.traits.values.customers') };

/** Merkmale als Zeilen mit Auswahl (leer, wenn keine) */
const traitsBlock = (list, tags = {}) => (list.length ? `<div class="osm-traits"><h4 class="osm-sub"><span class="msr">checklist</span> ${t('osm.edit.traits.title')}</h4>${list.map(([k, label, vals]) => {
  const cur = tags[k] ?? '';
  const opts = [['', '–'], ...[...vals, 'no'].map((v) => [v, WORD[v]])];
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur]);
  return `<label class="osm-trait"><span>${esc(label)} <code class="osm-tag">${esc(k)}</code></span>
      <select name="${esc(k)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}).join('')}</div>` : '');

/* ── Angaben je Art (wie in der Ortskarte) ─────────────────────────────────── */

// Eintragen: Öffnungszeiten und Telefon haben eigene Felder, Rollstuhl und Außenplätze stehen bei den Merkmalen
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
    return `<label class="osm-field"><span>${esc(label)} ${tag(e.key)}</span>${choice(e.key, e.options, tags[e.key] ?? '')}</label>`;
  }
  if (e.kind === 'flags') {
    // Häkchen = …=yes; ein vorher gesetztes „yes“ abhaken entfernt den Tag
    return `<fieldset class="osm-flags"><legend>${esc(label)} ${tag(`${e.key}…`)}</legend>${e.options.map(([v, l]) => {
      const k = `${e.key}${v}`;
      return `<label><input type="checkbox" name="${esc(k)}" data-orig="${esc(tags[k] ?? '')}"${tags[k] === 'yes' ? ' checked' : ''}> ${esc(l)}</label>`;
    }).join('')}</fieldset>`;
  }
  if (e.kind === 'sockets') {
    return `<fieldset class="osm-sockets"><legend>${esc(label)} ${tag('socket:…')}</legend>
      <span></span><small>${t('osm.edit.sockets.count')}</small><small>${t('osm.edit.sockets.power')}</small>
      ${Object.entries(EDIT_SOCKETS).map(([k, name]) => `<span>${esc(name)}</span>
        <input type="text" inputmode="numeric" name="socket:${esc(k)}" value="${esc(tags[`socket:${k}`] ?? '')}" placeholder="–" autocomplete="off">
        <input type="text" name="socket:${esc(k)}:output" value="${esc(tags[`socket:${k}:output`] ?? '')}" placeholder="${t('osm.edit.sockets.power_placeholder')}" autocomplete="off">`).join('')}
    </fieldset>`;
  }
  return '';
}

/** Block „Angaben“ – wie in der Ortskarte (leer, wenn es keine gibt); `html` baut ein Feld */
const factsBlock = (list, html) => (list.length
  ? `<fieldset class="osm-facts"><legend><span class="msr">tune</span> ${t('osm.edit.facts.title')} <small>${t('osm.edit.facts.hint')}</small></legend>${list.map(html).join('')}</fieldset>`
  : '');

/** Zugeklappt: was selten gebraucht wird, am Ende immer alle Tags */
const moreBlock = (inner, what) => `<details class="osm-more">
  <summary><span class="msr">unfold_more</span> ${t('osm.edit.more.title')} <small>${esc(what.join(', '))}</small></summary>
  <div class="osm-more-body">${inner}</div>
</details>`;

/** Rohdaten: eine Zeile je Tag. Neu anlegen: leer, für weitere Tags. */
const RAW = '_raw';
const rawBlock = (tags, hint) => `<div class="osm-raw-block">
  <h4 class="osm-sub"><span class="msr">data_object</span> ${tags ? t('osm.edit.raw.all') : t('osm.edit.raw.more')} <small>${t('osm.edit.raw.hint')}</small></h4>
  <textarea name="${RAW}" class="osm-raw" rows="${tags ? 8 : 3}" spellcheck="false" autocapitalize="off" placeholder="${t('osm.edit.raw.placeholder')}">${esc(Object.entries(tags ?? {}).map(([k, v]) => `${k}=${v}`).sort().join('\n'))}</textarea>
  <p class="muted">${hint}</p>
</div>`;

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
    icon: 'account_circle', title: t('osm.edit.no_account.title'),
    html: `<p>${t('osm.edit.no_account.text', { what: esc(what) })}</p>
      <p class="muted">${t('osm.edit.no_account.anon')}</p>`,
    buttons: [{ value: 'note', label: t('osm.edit.no_account.note') }, { value: 'account', label: t('osm.edit.no_account.connect'), primary: true, icon: 'login' }],
  });
  if (v === 'account') location.href = './settings.html#osm';
  return v;
}

const noteText = (title, vals) => tBase('osm.edit.note.text', { title, lines: Object.entries(vals).map(([k, v]) => (v ? `${k}=${v}` : tBase('osm.edit.note.remove', { k }))).join('\n') });

/** @param kind  'bearbeitet' | 'neu' – für die Zählung (osm/stats.js) */
async function send({ edits = [], creates = [], note = null }, comment, toast, kind) {
  try {
    const r = note ? await upload({ notes: [note] }, { comment }) : await upload({ edits, creates }, { comment });
    if (r.conflicts?.length) { toast(t('osm.edit.toast.conflict')); return false; }
    countOsm(kind, note ? 'hinweis' : 'karte');
    const link = r.changeset ? changesetUrl(r.changeset) : r.notes?.[0]?.id ? noteUrl(r.notes[0].id) : null;
    toast(note ? t('osm.edit.toast.note_sent') : t('osm.edit.toast.saved'), link ? { action: { label: t('osm.edit.toast.view'), run: () => openLink(link) } } : undefined);
    return true;
  } catch (err) {
    toast(t('osm.edit.toast.failed', { error: err.message }));
    return false;
  }
}

/**
 * Ort aus OSM bearbeiten.
 * @param osm   { type: 'node'|'way'|'relation', id }
 * @param tags  aktuelle Tags
 */
export async function editPlace({ osm, tags, point, title }, { toast }) {
  const mode = account.loggedIn() ? 'edit' : await withoutAccount(t('osm.edit.what_change'));
  if (mode !== 'edit' && mode !== 'note') return;
  // Bild von Commons: als Link zeigen – geändert gilt nur, was davon abweicht
  const shown = { ...tags, image: tags.image ?? (tags.wikimedia_commons ? `https://commons.wikimedia.org/wiki/${tags.wikimedia_commons.replace(/ /g, '_')}` : '') };
  // Telefon, Website: den Tag ändern, den es schon gibt (contact:website statt eines zweiten website)
  const alias = (k) => ((k === 'phone' || k === 'website') && !tags[k] && tags[`contact:${k}`] ? `contact:${k}` : k);
  const text = ([k, ...rest]) => field([alias(k), ...rest], shown[alias(k)] ?? '');
  const hours = () => hoursField(tags.opening_hours ?? '');
  const [, phone, website, events, image] = FIELDS;

  // Angaben wie in der Ortskarte – was dort steht, kommt unten nicht noch einmal
  const card = editFields(tags);
  const inCard = new Set(card.map((f) => f.edit.key));
  const cardField = (f) => (f.edit.kind === 'hours' ? hours()
    : f.edit.key === 'phone' || f.edit.key === 'website' ? text([f.edit.key, f.label, f.edit.key === 'phone' ? 'tel' : 'url', f.edit.ph ?? ''])
      : factField(f, tags));
  // Grundlegendes: [Schlüssel, HTML]
  const basic = [
    ['description', () => field(DESCRIPTION, tags.description ?? '')],
    ['opening_hours', hours],
    ['phone', () => text(phone)],
    ['website', () => text(website)],
  ].filter(([k]) => !inCard.has(k));
  // Weitere: ausgefüllte über „Weiteres“, leere darin – [Name, ausgefüllt?, HTML]
  const extra = [
    [t('osm.edit.more.address'), ADDRESS.some(([k]) => tags[k]), () => `<div class="osm-addr">${ADDRESS.map((f) => field(f, tags[f[0]] ?? '')).join('')}</div>`],
    [t('osm.edit.more.events'), !!tags[events[0]], () => text(events)],
    [t('osm.edit.more.image'), !!shown.image, () => text(image)],
  ];
  const traits = EDIT_TRAITS.filter(([k]) => !inCard.has(k));
  const filled = traits.filter(([k]) => tags[k]);
  const vals = await ask({
    icon: 'edit_location_alt', title: t('osm.edit.edit.title', { name: title || t('osm.edit.place') }), className: 'osm-edit',
    html: `<div class="osm-form">${field(FIELDS[0], tags.name ?? '')}
        ${factsBlock(card, cardField)}
        ${basic.map(([, html]) => html()).join('')}
        ${extra.filter(([, full]) => full).map(([, , html]) => html()).join('')}${traitsBlock(filled, tags)}
        ${moreBlock(`${extra.filter(([, full]) => !full).map(([, , html]) => html()).join('')}${traitsBlock(traits.filter((x) => !filled.includes(x)), tags)}
          ${rawBlock(tags, t('osm.edit.raw.edit_hint'))}`,
        [...extra.filter(([, full]) => !full).map(([name]) => name), ...(filled.length < traits.length ? [t('osm.edit.more.traits')] : []), t('osm.edit.more.all_tags')])}</div>
      <p class="muted">${t('osm.edit.edit.hint')}</p>`,
    buttons: [{ value: 'cancel', label: t('common.cancel') }, { value: 'ok', label: mode === 'note' ? t('osm.edit.send_note') : t('common.save'), primary: true }],
    read: valuesOf,
    setup(dlg) { mountHours(dlg); syncRaw(dlg); },
  });
  if (!vals || typeof vals !== 'object') return;
  const { gone, [RAW]: raw, ...form } = vals;
  if (gone) {
    await send({ note: { point, text: tBase('osm.edit.note.gone', { name: title || t('osm.edit.place'), type: osm.type, id: osm.id }) } }, '', toast, 'bearbeitet');
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
  if (!Object.keys(set).length) { toast(t('osm.edit.toast.unchanged')); return; }
  if (mode === 'note') {
    await send({ note: { point, text: noteText(tBase('osm.edit.note.change', { name: title, type: osm.type, id: osm.id }), set) } }, '', toast, 'bearbeitet');
    return;
  }
  const expect = Object.fromEntries(Object.keys(set).map((k) => [k, tags[k] ?? null]));
  const ok = await send({ edits: [{ osm, set, expect }] }, tBase('osm.edit.comment.changed', { name: title || t('osm.edit.place'), keys: Object.keys(set).join(', ') }), toast, 'bearbeitet');
  if (ok) for (const [k, v] of Object.entries(set)) { if (v) tags[k] = v; else delete tags[k]; }
}

/**
 * Unternehmen oder Veranstaltungsort an einem Punkt eintragen.
 * @param address  Vorschlag aus der Rückwärtssuche ({ street, housenumber, postcode, city })
 */
export async function addPlace(point, { address = {}, toast }) {
  const mode = account.loggedIn() ? 'add' : await withoutAccount(t('osm.edit.what_new'));
  if (mode !== 'add' && mode !== 'note') return;
  const addr = { 'addr:street': address.street ?? '', 'addr:housenumber': address.housenumber ?? '', 'addr:postcode': address.postcode ?? '', 'addr:city': address.city ?? '' };
  const vals = await ask({
    icon: 'add_business', title: t('osm.edit.add.title'), className: 'osm-edit',
    html: `<div class="osm-form">
        <label class="osm-field"><span>${t('osm.edit.add.what')}</span><select name="type" data-sp-picker="${t('osm.edit.add.what')}">${PLACE_TYPES.map(([group, list]) => `<optgroup label="${esc(group)}">${list.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label class="osm-field osm-brand" hidden><span>${t('osm.edit.add.brand.title')} <code class="osm-tag">brand</code></span>
          <input type="text" name="brand" list="osm-brands" placeholder="${t('osm.edit.add.brand.placeholder')}" autocomplete="off"><datalist id="osm-brands"></datalist></label>
        ${field(FIELDS[0])}
        <div class="osm-facts-slot"></div>
        ${field(DESCRIPTION)}${hoursField('', { gone: false })}
        ${FIELDS.slice(1, 3).map((f) => field(f)).join('')}
        <div class="osm-addr">${ADDRESS.map((f) => field(f, addr[f[0]])).join('')}</div>
        ${moreBlock(`${FIELDS.slice(3).map((f) => field(f)).join('')}${traitsBlock(EDIT_TRAITS)}${rawBlock(null, t('osm.edit.raw.add_hint'))}`, [t('osm.edit.more.events'), t('osm.edit.more.image'), t('osm.edit.more.traits'), t('osm.edit.more.more_tags')])}
      </div>
      <p class="muted">${t('osm.edit.add.hint')}</p>`,
    buttons: [{ value: 'cancel', label: t('common.cancel') }, { value: 'ok', label: mode === 'note' ? t('osm.edit.send_note') : t('osm.edit.add.button'), primary: true }],
    read: valuesOf,
    setup(dlg) {
      mountHours(dlg);
      // Marken passend zur Art vorschlagen
      const sel = dlg.querySelector('select[name="type"]');
      const brand = dlg.querySelector('.osm-brand');
      const slot = dlg.querySelector('.osm-facts-slot');
      const pick = () => {
        // Angaben passend zur Art (Tankstelle: Kraftstoffe, Bezahlung …)
        slot.innerHTML = factsBlock(editFields(TYPE_LIST.find(([id]) => id === sel.value)?.[2] ?? {}).filter((f) => !OWN.has(f.edit.key)), (f) => factField(f, {}));
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
  if (!rest.name) { toast(t('osm.edit.toast.need_name')); return; }
  const kind = TYPE_LIST.find(([id]) => id === type) ?? TYPE_LIST[0];
  const tags = { ...parseRaw(raw), ...kind[2], ...imageTags(Object.fromEntries(Object.entries(rest).filter(([, v]) => v))) };
  if (mode === 'note') {
    await send({ note: { point, text: noteText(tBase('osm.edit.note.new', { kind: kind[1], name: rest.name }), tags) } }, '', toast, 'neu');
    return;
  }
  await send({ creates: [{ point, tags }] }, tBase('osm.edit.comment.added', { kind: kind[1], name: rest.name }), toast, 'neu');
}
