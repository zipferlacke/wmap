/**
 * Was zu einem Ort angezeigt wird – im Popup kurz, im Sheet ausführlich.
 *
 * Je Art gibt es feste Felder. Pflichtfelder erscheinen immer, notfalls mit
 * „unbekannt“ – so sieht man auch, was OSM (noch) nicht weiß.
 */
import { CATEGORIES, searchFilters } from '../core/categories.js';
import { esc } from '../core/geo.js';

/* ── Welche Kategorie passt zu den Tags? ──────────────────────────────────── */

/** '["amenity"="parking"]["sport"~"soccer"]' → [{ key, op, value }] */
function parseFilter(f) {
  return [...f.matchAll(/\["([^"]+)"(=|~|!=)"([^"]*)"\]/g)].map(([, key, op, value]) => ({ key, op, value }));
}
const PARSED = CATEGORIES.map((c) => ({ c, filters: c.filters.map(parseFilter), all: searchFilters(c).map(parseFilter) }));

const fits = (filters, tags) => filters.some((conds) => conds.every(({ key, op, value }) => {
  const v = tags[key];
  if (op === '=') return v === value;
  if (op === '!=') return v !== value;
  return v !== undefined && new RegExp(value).test(v);
}));

export function categoryFor(tags = {}) {
  return PARSED.find(({ filters }) => fits(filters, tags))?.c ?? null;
}

/** Findet eine Suche nach `cat` diesen Ort? (auch über `extra`) */
export function inCategory(cat, tags = {}) {
  const p = PARSED.find((x) => x.c.id === cat.id);
  return !!p && fits(p.all, tags);
}

/* ── Werte übersetzen ─────────────────────────────────────────────────────── */

const YES_NO = { yes: 'ja', no: 'nein', limited: 'eingeschränkt', designated: 'ja', only: 'ausschließlich' };
const SURFACE = {
  asphalt: 'Asphalt', paved: 'befestigt', concrete: 'Beton', 'concrete:plates': 'Betonplatten',
  paving_stones: 'Pflastersteine', sett: 'Kopfsteinpflaster', cobblestone: 'Kopfsteinpflaster',
  unhewn_cobblestone: 'Feldsteinpflaster', compacted: 'verdichtet', fine_gravel: 'Feinschotter',
  gravel: 'Schotter', pebblestone: 'Kies', unpaved: 'unbefestigt', dirt: 'Erde', earth: 'Erde',
  ground: 'Naturboden', grass: 'Rasen', grass_paver: 'Rasengitter', sand: 'Sand', wood: 'Holz',
  metal: 'Metall', mud: 'Schlamm', rock: 'Fels', artificial_turf: 'Kunstrasen', tartan: 'Tartan',
};
const PARKING = {
  surface: 'Parkplatz', 'multi-storey': 'Parkhaus', underground: 'Tiefgarage', street_side: 'Straßenrand',
  lane: 'Parkstreifen', rooftop: 'Parkdeck', carports: 'Carports', garage_boxes: 'Garagen',
};
const ACCESS = {
  yes: 'öffentlich', public: 'öffentlich', customers: 'nur Kunden', private: 'privat',
  permissive: 'geduldet', permit: 'mit Genehmigung', destination: 'nur Anlieger', residents: 'nur Anwohner',
  no: 'kein Zugang',
};
const SOCKETS = {
  type2: 'Typ 2', type2_combo: 'CCS', chademo: 'CHAdeMO', schuko: 'Schuko', tesla_supercharger: 'Tesla',
  type2_cable: 'Typ 2 (Kabel)', cee_blue: 'CEE blau',
};
const FUELS = {
  diesel: 'Diesel', octane_95: 'Super', e10: 'E10', octane_98: 'Super Plus', lpg: 'Autogas',
  cng: 'Erdgas', adblue: 'AdBlue', hydrogen: 'Wasserstoff', HGV_diesel: 'LKW-Diesel',
};

const tr = (map, v) => (v ? v.split(';').map((x) => map[x.trim()] ?? x.trim()).join(', ') : null);

function fee(t) {
  if (!t.fee) return null;
  const base = t.fee === 'no' ? 'kostenlos' : t.fee === 'yes' ? 'kostenpflichtig' : tr(YES_NO, t.fee);
  return t.charge && t.fee !== 'no' ? `${base} (${t.charge})` : base;
}

function payment(t) {
  const names = { cash: 'bar', debit_cards: 'EC-Karte', credit_cards: 'Kreditkarte', contactless: 'kontaktlos', app: 'App' };
  const list = Object.keys(names).filter((k) => t[`payment:${k}`] === 'yes').map((k) => names[k]);
  return list.length ? list.join(', ') : null;
}

function sockets(t) {
  const out = [];
  for (const [k, name] of Object.entries(SOCKETS)) {
    const n = t[`socket:${k}`];
    if (!n || n === 'no') continue;
    const kw = t[`socket:${k}:output`];
    out.push(`${n !== 'yes' ? `${n}× ` : ''}${name}${kw ? ` (${kw})` : ''}`);
  }
  return out.length ? out.join(', ') : null;
}

function fuels(t) {
  const list = Object.keys(FUELS).filter((k) => t[`fuel:${k}`] === 'yes').map((k) => FUELS[k]);
  return list.length ? list.join(', ') : null;
}

/* ── Öffnungszeiten ───────────────────────────────────────────────────────── */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAY_LIST = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)\\s*(.*)$`);

function expandDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((d) => DAYS.indexOf(d));
    if (b === undefined) { out.add(a); continue; }
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return [...out];
}

const toMin = (h, m) => Number(h) * 60 + Number(m);
const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Häufige Formen von opening_hours auswerten („Mo-Fr 08:00-18:00; Sa 09:00-13:00“).
 * Feiertage werden übergangen, alles Exotischere ergibt null (= unbekannt).
 * → { open, until?, next? } oder null
 */
/** Woche aus opening_hours: je Tag eine Liste [von, bis] in Minuten, null = unbekannt. */
export function parseWeek(oh) {
  const s = oh.trim();
  if (s === '24/7') return new Array(7).fill([[0, 1440]]);
  const week = new Array(7).fill(null);
  for (const raw of s.split(';')) {
    const rule = raw.trim();
    if (!rule || /^(PH|SH)\b/.test(rule)) continue;
    const m = rule.match(DAY_LIST);
    const days = m ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    const rest = (m ? m[2] : rule).trim();
    let spans = [];
    if (!/^(off|closed)$/i.test(rest)) {
      for (const part of rest.split(',')) {
        const t = part.trim().match(/^(\d{1,2}):(\d\d)-(\d{1,2}):(\d\d)\+?$/);
        if (!t) return null;
        const a = toMin(t[1], t[2]);
        let b = toMin(t[3], t[4]);
        if (b <= a) b += 1440;                 // über Mitternacht
        spans.push([a, b]);
      }
    }
    for (const d of days) week[d] = spans;
  }
  return week.every((x) => x === null) ? null : week;
}

function openState(oh, now = new Date()) {
  if (!oh) return null;
  if (oh.trim() === '24/7') return { open: true, always: true };
  const week = parseWeek(oh);
  if (!week) return null;
  const today = (now.getDay() + 6) % 7;
  const mins = now.getHours() * 60 + now.getMinutes();
  const yesterday = (week[(today + 6) % 7] ?? []).find(([a, b]) => mins + 1440 >= a && mins + 1440 < b);
  if (yesterday) return { open: true, until: fmtMin(yesterday[1] - 1440) };
  const now_ = (week[today] ?? []).find(([a, b]) => mins >= a && mins < b);
  if (now_) return { open: true, until: fmtMin(now_[1]) };
  const next = (week[today] ?? []).find(([a]) => a > mins);
  return { open: false, next: next ? fmtMin(next[0]) : null };
}

function statusText(state) {
  if (!state) return null;
  if (state.always) return 'Rund um die Uhr geöffnet';
  if (state.open) return `Jetzt geöffnet · bis ${state.until}`;
  return state.next ? `Geschlossen · öffnet um ${state.next}` : 'Heute geschlossen';
}

/**
 * Umgekehrt: Woche → opening_hours. Gleiche Tage hintereinander werden
 * zusammengefasst („Mo-Fr 07:00-18:00; Sa 07:00-12:00“); Tage ohne Zeiten
 * sind geschlossen und fallen weg. Eine Feiertagsregel aus dem alten Wert
 * (`keep`) bleibt erhalten.
 */
export function buildHours(week, keep = '') {
  const spec = week.map((spans) => (spans?.length ? spans.map(([a, b]) => `${fmtMin(a)}-${b === 1440 ? '24:00' : fmtMin(b)}`).join(',') : ''));
  if (spec.every((x) => x === '00:00-24:00')) return '24/7';
  const rules = [];
  for (let i = 0; i < 7;) {
    let j = i;
    while (j + 1 < 7 && spec[j + 1] === spec[i]) j += 1;
    if (spec[i]) rules.push(`${DAYS[i]}${j > i ? (j === i + 1 ? `,${DAYS[j]}` : `-${DAYS[j]}`) : ''} ${spec[i]}`);
    i = j + 1;
  }
  const ph = keep.split(';').map((r) => r.trim()).find((r) => /^PH\b/.test(r));
  if (ph) rules.push(ph);
  return rules.join('; ');
}

export { DAYS_DE };

/** Wochentabelle Mo–So, heute hervorgehoben. null, wenn das Format zu exotisch ist. */
export function hoursTable(oh, now = new Date()) {
  if (!oh) return null;
  const week = parseWeek(oh);
  if (!week) return null;
  const today = (now.getDay() + 6) % 7;
  const rows = DAYS_DE.map((d, i) => {
    const spans = week[i];
    const text = spans === null ? '–' : !spans.length ? 'geschlossen'
      : spans.map(([a, b]) => (a === 0 && b === 1440 ? 'ganztägig' : `${fmtMin(a)}–${fmtMin(b)}`)).join(', ');
    return `<tr class="${i === today ? 'today' : ''}${spans && !spans.length ? ' closed' : ''}"><th>${d}</th><td>${text}</td></tr>`;
  }).join('');
  const note = /\bPH\b/.test(oh) ? `<caption>Feiertage: ${esc(formatHours(oh.split(';').find((r) => /\bPH\b/.test(r)) ?? '').replace(/^Feiertag\s*/, ''))}</caption>` : '';
  return `<table class="poi-hours">${note}<tbody>${rows}</tbody></table>`;
}

/** Links, die es zu einem Ort gibt – Website, Speisekarte, Programm, soziale Netze. */
function links(t) {
  const out = [];
  const add = (url, label, icon) => { if (url && /^https?:\/\//.test(url) && !out.some((l) => l.url === url)) out.push({ url, label, icon }); };
  add(t.website ?? t['contact:website'] ?? t.url, 'Website', 'language');
  add(t['website:menu'] ?? t.menu, 'Speisekarte', 'menu_book');
  // Kulturvereine, Kinos, Theater: manche verlinken ihr Programm eigens
  add(t['website:events'] ?? t['contact:events'] ?? t['event:website'], 'Programm', 'event');
  add(t['contact:instagram'] && !t['contact:instagram'].startsWith('http') ? `https://instagram.com/${t['contact:instagram'].replace(/^@/, '')}` : t['contact:instagram'], 'Instagram', 'photo_camera');
  add(t['contact:facebook'] && !t['contact:facebook'].startsWith('http') ? `https://facebook.com/${t['contact:facebook']}` : t['contact:facebook'], 'Facebook', 'group');
  return out;
}

/** Lesbar auf Deutsch, eine Regel je Zeile. */
export function formatHours(oh) {
  if (!oh) return null;
  if (oh.trim() === '24/7') return 'rund um die Uhr';
  return oh.split(';').map((r) => r.trim()).filter(Boolean).map((r) => r
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAYS_DE[DAYS.indexOf(d)])
    .replace(/\bPH\b/g, 'Feiertag').replace(/\bSH\b/g, 'Schulferien')
    .replace(/\b(off|closed)\b/gi, 'geschlossen')
    .replace(/,(?=\d)/g, ', ')).join('\n');
}

/* ── Felder je Art ────────────────────────────────────────────────────────── */

// [Beschriftung, Icon, Wert aus Tags, Pflicht?]
const F = {
  hours: ['Öffnungszeiten', 'schedule', (t) => formatHours(t.opening_hours)],
  hoursReq: ['Öffnungszeiten', 'schedule', (t) => formatHours(t.opening_hours), true],
  fee: ['Gebühr', 'payments', fee, true],
  surface: ['Belag', 'texture', (t) => tr(SURFACE, t.surface), true],
  access: ['Zugang', 'lock_open', (t) => tr(ACCESS, t.access)],
  operator: ['Betreiber', 'business', (t) => t.operator ?? t.brand],
  wheelchair: ['Rollstuhl', 'accessible', (t) => tr(YES_NO, t.wheelchair)],
  phone: ['Telefon', 'call', (t) => t.phone ?? t['contact:phone']],
  cuisine: ['Küche', 'restaurant_menu', (t) => t.cuisine?.replaceAll(';', ', ').replaceAll('_', ' ')],
  outdoor: ['Außenplätze', 'deck', (t) => tr(YES_NO, t.outdoor_seating)],
  payment: ['Bezahlung', 'credit_card', payment],
  ele: ['Höhe', 'landscape', (t) => (t.ele ? `${Math.round(Number(t.ele))} m` : null)],
};

const SCHEMA = {
  parking: [
    // capacity = alle Stellplätze, nicht die gerade freien
    ['Stellplätze (gesamt)', 'local_parking', (t) => t.capacity, true],
    F.fee,
    F.hours,
    F.surface,
    ['Art', 'garage', (t) => tr(PARKING, t.parking)],
    ['Höchstparkdauer', 'timer', (t) => t.maxstay],
    ['Behindertenparkplätze', 'accessible', (t) => t['capacity:disabled']],
    ['Ladeplätze', 'ev_station', (t) => t['capacity:charging']],
    F.access,
  ],
  fuel: [F.operator, F.hoursReq, ['Kraftstoffe', 'local_gas_station', fuels], F.payment, ['Shop', 'storefront', (t) => tr(YES_NO, t.shop)]],
  charging: [
    ['Ladepunkte', 'ev_station', (t) => t.capacity, true],
    ['Stecker', 'electrical_services', sockets, true],
    F.fee, F.operator, F.hours, F.access,
  ],
  toilets: [F.fee, F.wheelchair, ['Wickeltisch', 'baby_changing_station', (t) => tr(YES_NO, t.changing_table)], F.hours],
  water: [['Trinkwasser', 'water_drop', (t) => tr(YES_NO, t.drinking_water ?? 'yes')], ['Saisonal', 'event', (t) => tr(YES_NO, t.seasonal)]],
  bikeparking: [['Stellplätze (gesamt)', 'pedal_bike', (t) => t.capacity, true], ['Überdacht', 'roofing', (t) => tr(YES_NO, t.covered)], F.fee],
  peak: [F.ele],
  viewpoint: [F.ele],
  soccer: [F.surface, F.access],
  playground: [F.surface, ['Mindestalter', 'child_care', (t) => t.min_age]],
};
for (const id of ['bakery', 'cafe', 'restaurant', 'fastfood', 'icecream', 'pub']) {
  SCHEMA[id] = [F.hoursReq, F.cuisine, F.outdoor, F.wheelchair, F.phone];
}
SCHEMA.supermarket = [F.hoursReq, F.operator, F.wheelchair, F.payment];
const DEFAULT = [F.hours, F.operator, F.wheelchair, F.phone, F.ele];

/**
 * Alle Angaben zu einem Ort.
 * → { category, name, type, status, facts: [{ label, icon, value, unknown }], website }
 */
export function describePoi(tags = {}, { name, fallbackType } = {}) {
  const category = categoryFor(tags);
  const schema = SCHEMA[category?.id] ?? DEFAULT;
  const facts = [];
  for (const [label, icon, get, required] of schema) {
    const value = get(tags);
    if (value || required) facts.push({ label, icon, value: value ?? 'unbekannt', unknown: !value });
  }
  const web = tags.website ?? tags['contact:website'] ?? tags.url;
  return {
    hours: tags.opening_hours ?? null,
    links: links(tags),
    category,
    name: name || tags.name || tags.brand || category?.one || fallbackType || 'Ort',
    type: category?.one ?? fallbackType ?? null,
    status: statusText(openState(tags.opening_hours)),
    open: openState(tags.opening_hours)?.open ?? null,
    facts,
    website: web && /^https?:\/\//.test(web) ? web : null,
  };
}

/** Karte fürs Popup und fürs Sheet. `compact` zeigt nur das Wichtigste. */
export function poiCard(info, { compact = false } = {}) {
  const c = info.category;
  const table = compact ? null : hoursTable(info.hours);
  const facts = (compact ? info.facts.slice(0, 5) : info.facts).filter((f) => !(table && f.label === 'Öffnungszeiten'));
  return `
    <div class="poi-card${compact ? ' compact' : ''}">
      <header>
        <span class="poi-ico msr" style="--c:${c?.color ?? '#e8590c'}">${c?.icon ?? 'location_on'}</span>
        <div><strong>${esc(info.name)}</strong>${info.type && info.type !== info.name ? `<small>${esc(info.type)}</small>` : ''}</div>
      </header>
      ${info.status ? `<p class="poi-status ${info.open ? 'open' : 'closed'}">${esc(info.status)}</p>` : ''}
      ${facts.length ? `<dl class="poi-facts">${facts.map((f) => `
        <div class="${f.unknown ? 'unknown' : ''}"><dt><span class="msr">${f.icon}</span>${esc(f.label)}</dt>
        <dd>${esc(f.value).replaceAll('\n', '<br>')}</dd></div>`).join('')}</dl>` : ''}
      ${table ? `<div class="poi-hours-wrap"><h4><span class="msr">schedule</span> Öffnungszeiten</h4>${table}</div>` : ''}
      ${!compact && info.links.length ? `<div class="poi-links">${info.links.map((l) => `
        <a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="msr">${l.icon}</span>${esc(l.label)}</a>`).join('')}</div>` : ''}
    </div>`;
}
