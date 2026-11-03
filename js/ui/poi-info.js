/**
 * Was zu einem Ort angezeigt wird – im Popup kurz, im Sheet ausführlich.
 *
 * Je Art gibt es feste Felder. Pflichtfelder erscheinen immer, notfalls mit
 * „unbekannt“ – so sieht man auch, was OSM (noch) nicht weiß.
 *
 * Jedes Feld sagt auch, wie man es bearbeitet (Zahl, Auswahl, Häkchen,
 * Stecker …): osm/edit.js zeigt dieselben Felder oben im Dialog je Art.
 */
import { CATEGORIES, searchFilters } from '../core/categories.js';
import { esc } from '../core/geo.js';
import { iconForTags } from '../map/poi-icons.js';
import { t } from '../core/i18n.js';

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

const YES_NO = { yes: t('poi.values.yes_no.yes'), no: t('poi.values.yes_no.no'), limited: t('poi.values.yes_no.limited'), designated: t('poi.values.yes_no.designated'), only: t('poi.values.yes_no.only') };
const SURFACE = {
  asphalt: t('poi.values.surface.asphalt'), paved: t('poi.values.surface.paved'), concrete: t('poi.values.surface.concrete'), 'concrete:plates': t('poi.values.surface.concrete_plates'),
  paving_stones: t('poi.values.surface.paving_stones'), sett: t('poi.values.surface.sett'), cobblestone: t('poi.values.surface.cobblestone'),
  unhewn_cobblestone: t('poi.values.surface.unhewn_cobblestone'), compacted: t('poi.values.surface.compacted'), fine_gravel: t('poi.values.surface.fine_gravel'),
  gravel: t('poi.values.surface.gravel'), pebblestone: t('poi.values.surface.pebblestone'), unpaved: t('poi.values.surface.unpaved'), dirt: t('poi.values.surface.dirt'), earth: t('poi.values.surface.earth'),
  ground: t('poi.values.surface.ground'), grass: t('poi.values.surface.grass'), grass_paver: t('poi.values.surface.grass_paver'), sand: t('poi.values.surface.sand'), wood: t('poi.values.surface.wood'),
  metal: t('poi.values.surface.metal'), mud: t('poi.values.surface.mud'), rock: t('poi.values.surface.rock'), artificial_turf: t('poi.values.surface.artificial_turf'), tartan: t('poi.values.surface.tartan'),
};
const PARKING = {
  surface: t('poi.values.parking.surface'), 'multi-storey': t('poi.values.parking.multi_storey'), underground: t('poi.values.parking.underground'), street_side: t('poi.values.parking.street_side'),
  lane: t('poi.values.parking.lane'), rooftop: t('poi.values.parking.rooftop'), carports: t('poi.values.parking.carports'), garage_boxes: t('poi.values.parking.garage_boxes'),
};
const ACCESS = {
  yes: t('poi.values.access.yes'), public: t('poi.values.access.public'), customers: t('poi.values.access.customers'), private: t('poi.values.access.private'),
  permissive: t('poi.values.access.permissive'), permit: t('poi.values.access.permit'), destination: t('poi.values.access.destination'), residents: t('poi.values.access.residents'),
  no: t('poi.values.access.no'),
};
const SOCKETS = {
  type2: t('poi.values.sockets.type2'), type2_combo: t('poi.values.sockets.type2_combo'), chademo: t('poi.values.sockets.chademo'), schuko: t('poi.values.sockets.schuko'), tesla_supercharger: t('poi.values.sockets.tesla_supercharger'),
  type2_cable: t('poi.values.sockets.type2_cable'), cee_blue: t('poi.values.sockets.cee_blue'),
};
const FUELS = {
  diesel: t('poi.values.fuels.diesel'), octane_95: t('poi.values.fuels.octane_95'), e10: t('poi.values.fuels.e10'), octane_98: t('poi.values.fuels.octane_98'), lpg: t('poi.values.fuels.lpg'),
  cng: t('poi.values.fuels.cng'), adblue: t('poi.values.fuels.adblue'), hydrogen: t('poi.values.fuels.hydrogen'), HGV_diesel: t('poi.values.fuels.HGV_diesel'),
};

const tr = (map, v) => (v ? v.split(';').map((x) => map[x.trim()] ?? x.trim()).join(', ') : null);

function fee(tg) {
  if (!tg.fee) return null;
  const base = tg.fee === 'no' ? t('poi.values.fee.no') : tg.fee === 'yes' ? t('poi.values.fee.yes') : tr(YES_NO, tg.fee);
  return tg.charge && tg.fee !== 'no' ? `${base} (${tg.charge})` : base;
}

const PAYMENT = { cash: t('poi.values.payment.cash'), debit_cards: t('poi.values.payment.debit_cards'), credit_cards: t('poi.values.payment.credit_cards'), contactless: t('poi.values.payment.contactless'), app: t('poi.values.payment.app') };

function payment(tg) {
  const list = Object.keys(PAYMENT).filter((k) => tg[`payment:${k}`] === 'yes').map((k) => PAYMENT[k]);
  return list.length ? list.join(', ') : null;
}

function sockets(tg) {
  const out = [];
  for (const [k, name] of Object.entries(SOCKETS)) {
    const n = tg[`socket:${k}`];
    if (!n || n === 'no') continue;
    const kw = tg[`socket:${k}:output`];
    out.push(`${n !== 'yes' ? `${n}× ` : ''}${name}${kw ? ` (${kw})` : ''}`);
  }
  return out.length ? out.join(', ') : null;
}

function fuels(tg) {
  const list = Object.keys(FUELS).filter((k) => tg[`fuel:${k}`] === 'yes').map((k) => FUELS[k]);
  return list.length ? list.join(', ') : null;
}

/* ── Öffnungszeiten ───────────────────────────────────────────────────────── */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAYS_DE = [t('common.weekdays.short.mo'), t('common.weekdays.short.tu'), t('common.weekdays.short.we'), t('common.weekdays.short.th'), t('common.weekdays.short.fr'), t('common.weekdays.short.sa'), t('common.weekdays.short.su')];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAY_LIST = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)\\s*(.*)$`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_DE = [t('common.months.short.jan'), t('common.months.short.feb'), t('common.months.short.mar'), t('common.months.short.apr'), t('common.months.short.may'), t('common.months.short.jun'), t('common.months.short.jul'), t('common.months.short.aug'), t('common.months.short.sep'), t('common.months.short.oct'), t('common.months.short.nov'), t('common.months.short.dec')];
const MONTHS_LONG = [t('common.months.long.jan'), t('common.months.long.feb'), t('common.months.long.mar'), t('common.months.long.apr'), t('common.months.long.may'), t('common.months.long.jun'), t('common.months.long.jul'), t('common.months.long.aug'), t('common.months.long.sep'), t('common.months.long.oct'), t('common.months.long.nov'), t('common.months.long.dec')];
const MON = `(?:${MONTHS.join('|')})`;
const SEASON = new RegExp(`^(${MON}(?:-${MON})?(?:,${MON}(?:-${MON})?)*):?\\s+`);

/** 'Feb-Oct' → [1 … 9], auch über den Jahreswechsel ('Nov-Feb') */
function expandMonths(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((m) => MONTHS.indexOf(m));
    if (b === undefined) { out.add(a); continue; }
    for (let i = a; ; i = (i + 1) % 12) { out.add(i); if (i === b) break; }
  }
  return out;
}

/**
 * Für Tabelle und „Jetzt geöffnet“: Monate, die vor allen Regeln gleich stehen
 * („Feb-Oct: Mo-Sa 09:00-21:00; Feb-Oct: Su,PH 12:00-20:00“), abtrennen und
 * Feiertage aus Tageslisten lösen („Su,PH 12:00-20:00“ → „Su 12:00-20:00; PH 12:00-20:00“).
 * → { oh, months: { set, text } | null } – bei unterschiedlichen Monaten unverändert.
 */
function season(oh) {
  let spec = null;
  const rules = [];
  for (const raw of oh.split(';')) {
    let r = raw.trim();
    if (!r) continue;
    const m = r.match(SEASON);
    const s = m ? m[1] : '';
    if (spec === null) spec = s;
    else if (spec !== s) return { oh, months: null };
    if (m) r = r.slice(m[0].length);
    const d = r.match(/^([A-Za-z]{2}(?:[,-][A-Za-z]{2})*)\s+(.*)$/);
    const parts = d ? d[1].split(',') : [];
    if (parts.length > 1 && parts.includes('PH')) {
      rules.push(`${parts.filter((x) => x !== 'PH').join(',')} ${d[2]}`, `PH ${d[2]}`);
    } else rules.push(r);
  }
  const months = spec ? {
    set: expandMonths(spec),
    text: spec.split(',').map((p) => p.split('-').map((x) => MONTHS_LONG[MONTHS.indexOf(x)]).join(` ${t('poi.hours.until')} `)).join(', '),
  } : null;
  return { oh: rules.join('; '), months };
}

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
        const tg = part.trim().match(/^(\d{1,2}):(\d\d)-(\d{1,2}):(\d\d)\+?$/);
        if (!tg) return null;
        const a = toMin(tg[1], tg[2]);
        let b = toMin(tg[3], tg[4]);
        if (b <= a) b += 1440;                 // über Mitternacht
        spans.push([a, b]);
      }
    }
    for (const d of days) week[d] = spans;
  }
  return week.every((x) => x === null) ? null : week;
}

export function openState(oh, now = new Date()) {
  if (!oh) return null;
  if (oh.trim() === '24/7') return { open: true, always: true };
  const s = season(oh);
  const week = parseWeek(s.oh);
  if (!week) return null;
  if (s.months && !s.months.set.has(now.getMonth())) return { open: false, offSeason: s.months.text };
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
  if (state.always) return t('poi.hours.status.always');
  if (state.open) return t('poi.hours.status.open', { until: state.until });
  if (state.offSeason) return t('poi.hours.status.off_season', { when: state.offSeason });
  return state.next ? t('poi.hours.status.next', { next: state.next }) : t('poi.hours.status.today_closed');
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
  const s = season(oh);
  const week = parseWeek(s.oh);
  if (!week) return null;
  const today = (now.getDay() + 6) % 7;
  const rows = DAYS_DE.map((d, i) => {
    const spans = week[i];
    const text = spans === null ? '–' : !spans.length ? t('poi.hours.closed')
      : spans.map(([a, b]) => (a === 0 && b === 1440 ? t('poi.hours.all_day') : `${fmtMin(a)}–${b === 1440 ? '24:00' : fmtMin(b)}`)).join(', ');
    return `<tr class="${i === today ? 'today' : ''}${spans && !spans.length ? ' closed' : ''}"><th>${d}</th><td>${text}</td></tr>`;
  }).join('');
  const ph = s.oh.split(';').map((r) => r.trim()).find((r) => /^PH\b/.test(r));
  const notes = [
    s.months ? t('poi.hours.open_months', { months: s.months.text }) : null,
    ph ? t('poi.hours.holidays', { hours: formatHours(ph).replace(new RegExp(`^${t('poi.hours.holiday')}\\s*`), '') }) : null,
  ].filter(Boolean);
  const note = notes.length ? `<caption>${notes.map(esc).join('<br>')}</caption>` : '';
  return `<table class="poi-hours">${note}<tbody>${rows}</tbody></table>`;
}

/** Links, die es zu einem Ort gibt – Website, Speisekarte, Programm, soziale Netze. */
function links(tg) {
  const out = [];
  const add = (url, label, icon) => { if (url && /^https?:\/\//.test(url) && !out.some((l) => l.url === url)) out.push({ url, label, icon }); };
  add(tg.website ?? tg['contact:website'] ?? tg.url, t('poi.links.website'), 'language');
  const phone = (tg.phone ?? tg['contact:phone'])?.split(';')[0].trim();
  if (phone) out.push({ url: `tel:${phone.replace(/[^+\d]/g, '')}`, label: phone, icon: 'call' });
  add(tg['website:menu'] ?? tg.menu, t('poi.links.menu'), 'menu_book');
  // Kulturvereine, Kinos, Theater: manche verlinken ihr Programm eigens
  add(tg['website:events'] ?? tg['contact:events'] ?? tg['event:website'], t('poi.links.events'), 'event');
  add(tg['contact:instagram'] && !tg['contact:instagram'].startsWith('http') ? `https://instagram.com/${tg['contact:instagram'].replace(/^@/, '')}` : tg['contact:instagram'], t('poi.links.instagram'), 'photo_camera');
  add(tg['contact:facebook'] && !tg['contact:facebook'].startsWith('http') ? `https://facebook.com/${tg['contact:facebook']}` : tg['contact:facebook'], t('poi.links.facebook'), 'group');
  return out;
}

/** Lesbar auf Deutsch, eine Regel je Zeile. */
export function formatHours(oh) {
  if (!oh) return null;
  if (oh.trim() === '24/7') return t('poi.hours.always');
  return oh.split(';').map((r) => r.trim()).filter(Boolean).map((r) => r
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAYS_DE[DAYS.indexOf(d)])
    .replace(/\bPH\b/g, t('poi.hours.holiday')).replace(/\bSH\b/g, t('poi.hours.school_holidays'))
    .replace(new RegExp(`\\b${MON}\\b`, 'g'), (m) => MONTHS_DE[MONTHS.indexOf(m)])
    .replace(/\b(off|closed)\b/gi, t('poi.hours.closed'))
    .replace(/-/g, '–')
    .replace(/,(?=\S)/g, ', ')).join('\n');
}

/* ── Felder je Art ────────────────────────────────────────────────────────── */

/*
 * Wie ein Feld bearbeitet wird (osm/edit.js):
 *   { key, kind: 'number' | 'text' | 'choice' | 'hours', options?, ph? }
 *   { key: 'payment:', kind: 'flags', options }   je Wert ein Häkchen (…=yes)
 *   { key: 'socket:', kind: 'sockets' }           je Stecker Anzahl und Leistung
 */
const JA_NEIN = { yes: t('poi.values.yes_no.yes'), no: t('poi.values.yes_no.no') };
const E = {
  num: (key, ph = '') => ({ key, kind: 'number', ph }),
  text: (key, ph = '') => ({ key, kind: 'text', ph }),
  pick: (key, map) => ({ key, kind: 'choice', options: Object.entries(map) }),
  flags: (prefix, map) => ({ key: prefix, kind: 'flags', options: Object.entries(map) }),
};
export const EDIT_SOCKETS = SOCKETS;

// [Beschriftung, Icon, Wert aus Tags, Pflicht?, Bearbeiten]
const F = {
  hours: [t('poi.facts.hours'), 'schedule', (tg) => formatHours(tg.opening_hours), false, { key: 'opening_hours', kind: 'hours' }],
  hoursReq: [t('poi.facts.hours'), 'schedule', (tg) => formatHours(tg.opening_hours), true, { key: 'opening_hours', kind: 'hours' }],
  fee: [t('poi.facts.fee'), 'payments', fee, true, E.pick('fee', { no: t('poi.values.fee.no'), yes: t('poi.values.fee.yes') })],
  surface: [t('poi.facts.surface'), 'texture', (tg) => tr(SURFACE, tg.surface), true, E.pick('surface', SURFACE)],
  access: [t('poi.facts.access'), 'lock_open', (tg) => tr(ACCESS, tg.access), false, E.pick('access', ACCESS)],
  operator: [t('poi.facts.operator'), 'business', (tg) => tg.operator ?? tg.brand, false, E.text('operator', t('poi.edit_hint.operator'))],
  phone: [t('poi.facts.phone'), 'call', (tg) => tg.phone ?? tg['contact:phone'], false, { key: 'phone', kind: 'text' }],
  cuisine: [t('poi.facts.cuisine'), 'restaurant_menu', (tg) => tg.cuisine?.replaceAll(';', ', ').replaceAll('_', ' '), false, E.text('cuisine', t('poi.edit_hint.cuisine'))],
  payment: [t('poi.facts.payment'), 'credit_card', payment, false, E.flags('payment:', PAYMENT)],
  ele: [t('poi.facts.ele'), 'landscape', (tg) => (tg.ele ? `${Math.round(Number(tg.ele))} ${t('common.units.m')}` : null), false, E.num('ele', t('poi.edit_hint.ele'))],
};

const SCHEMA = {
  parking: [
    // capacity = alle Stellplätze, nicht die gerade freien
    [t('poi.facts.capacity'), 'local_parking', (tg) => tg.capacity, true, E.num('capacity', t('poi.edit_hint.capacity'))],
    F.fee,
    F.hours,
    F.surface,
    [t('poi.facts.kind'), 'garage', (tg) => tr(PARKING, tg.parking), false, E.pick('parking', PARKING)],
    [t('poi.facts.maxstay'), 'timer', (tg) => tg.maxstay, false, E.text('maxstay', t('poi.edit_hint.maxstay'))],
    [t('poi.facts.disabled'), 'accessible', (tg) => tg['capacity:disabled'], false, E.num('capacity:disabled')],
    [t('poi.facts.charging'), 'ev_station', (tg) => tg['capacity:charging'], false, E.num('capacity:charging')],
    F.access,
  ],
  fuel: [F.operator, F.hoursReq, [t('poi.facts.fuels'), 'local_gas_station', fuels, false, E.flags('fuel:', FUELS)], F.payment,
    [t('poi.facts.shop'), 'storefront', (tg) => tr(YES_NO, tg.shop), false, E.pick('shop', JA_NEIN)]],
  charging: [
    [t('poi.facts.charge_points'), 'ev_station', (tg) => tg.capacity, true, E.num('capacity', t('poi.edit_hint.charge_points'))],
    [t('poi.facts.sockets'), 'electrical_services', sockets, true, { key: 'socket:', kind: 'sockets' }],
    F.fee, F.operator, F.hours, F.access, F.payment,
  ],
  toilets: [F.fee, F.hours],          // Rollstuhl, Wickeltisch: bei der Ausstattung
  water: [[t('poi.facts.water'), 'water_drop', (tg) => tr(YES_NO, tg.drinking_water ?? 'yes'), false, E.pick('drinking_water', JA_NEIN)],
    [t('poi.facts.seasonal'), 'event', (tg) => tr(YES_NO, tg.seasonal), false, E.pick('seasonal', JA_NEIN)]],
  bikeparking: [[t('poi.facts.capacity'), 'pedal_bike', (tg) => tg.capacity, true, E.num('capacity')],
    [t('poi.facts.covered'), 'roofing', (tg) => tr(YES_NO, tg.covered), false, E.pick('covered', JA_NEIN)], F.fee],
  peak: [F.ele],
  viewpoint: [F.ele],
  soccer: [F.surface, F.access],
  playground: [F.surface, [t('poi.facts.min_age'), 'child_care', (tg) => tg.min_age, false, E.num('min_age', t('poi.edit_hint.min_age'))]],
};
for (const id of ['bakery', 'cafe', 'restaurant', 'fastfood', 'icecream', 'pub']) {
  SCHEMA[id] = [F.hoursReq, F.cuisine, F.phone];
}
SCHEMA.supermarket = [F.hoursReq, F.operator, F.payment];
const DEFAULT = [F.hours, F.operator, F.phone, F.ele];

/**
 * Was sich an einem Ort dieser Art bearbeiten lässt – dieselben Felder wie in
 * der Karte. → [{ label, icon, edit, required }]
 */
export function editFields(tags = {}) {
  const schema = SCHEMA[categoryFor(tags)?.id] ?? DEFAULT;
  return schema.filter((f) => f[4]).map(([label, icon, , required, edit]) => ({ label, icon, edit, required: !!required }));
}

/**
 * Merkmale wie bei Google unter dem Namen („Bäckerei · Lieferdienst · Bio“).
 * [Schlüssel, Name im Bearbeiten, { Wert: Text in der Karte }] – osm/edit.js
 * bietet dieselben zum Setzen an (dazu „no“ = Nein).
 */
export const TRAITS = [
  ['delivery', t('poi.traits.delivery.name'), { yes: t('poi.traits.delivery.name'), only: t('poi.traits.delivery.only') }],
  ['takeaway', t('poi.traits.takeaway.name'), { yes: t('poi.traits.takeaway.name'), only: t('poi.traits.takeaway.only') }],
  ['organic', t('poi.traits.organic.name'), { yes: t('poi.traits.organic.name'), only: t('poi.traits.organic.only') }],
  ['diet:vegan', t('poi.traits.vegan.name'), { yes: t('poi.traits.vegan.yes'), only: t('poi.traits.vegan.name') }],
  ['diet:vegetarian', t('poi.traits.vegetarian.name'), { yes: t('poi.traits.vegetarian.yes'), only: t('poi.traits.vegetarian.name') }],
  ['drive_through', t('poi.traits.drive_through.name'), { yes: t('poi.traits.drive_through.name') }],
];
const traitsOf = (tg) => TRAITS.map(([k, , txt]) => txt[tg[k]]).filter(Boolean);

/**
 * Ausstattung – als Chips unter den Angaben. [Schlüssel, Name im Bearbeiten, Icon, Tags → Text | null]
 * Außenplätze zählen bei jedem Wert außer „no“ (terrace, pedestrian_zone … sagt nur, wo sie sind).
 */
export const EQUIPMENT = [
  ['wheelchair', t('poi.equipment.wheelchair.yes'), 'accessible', (tg) => ({ yes: t('poi.equipment.wheelchair.yes'), designated: t('poi.equipment.wheelchair.yes'), limited: t('poi.equipment.wheelchair.limited'), no: t('poi.equipment.wheelchair.no') })[tg.wheelchair] ?? null],
  ['outdoor_seating', t('poi.equipment.outdoor'), 'deck', (tg) => (tg.outdoor_seating && tg.outdoor_seating !== 'no' ? t('poi.equipment.outdoor') : null)],
  ['toilets', t('poi.equipment.toilets.name'), 'wc', (tg) => (tg.toilets !== 'yes' ? null
    : ['customers', 'permissive'].includes(tg['toilets:access']) ? t('poi.equipment.toilets.guests')
      : ['yes', 'public'].includes(tg['toilets:access']) ? t('poi.equipment.toilets.public') : t('poi.equipment.toilets.name'))],
  ['changing_table', t('poi.equipment.changing'), 'baby_changing_station', (tg) => (tg.changing_table === 'yes' ? t('poi.equipment.changing') : null)],
  ['internet_access', t('poi.equipment.wlan'), 'wifi', (tg) => (['wlan', 'yes'].includes(tg.internet_access) ? t('poi.equipment.wlan') : null)],
  ['air_conditioning', t('poi.equipment.air'), 'ac_unit', (tg) => (tg.air_conditioning === 'yes' ? t('poi.equipment.air') : null)],
  ['dog', t('poi.equipment.dog'), 'pets', (tg) => (['yes', 'leashed'].includes(tg.dog) ? t('poi.equipment.dog') : null)],
];
const equipmentOf = (tg) => EQUIPMENT.map(([k, , icon, get]) => ({ icon: k === 'wheelchair' && tg.wheelchair === 'no' ? 'not_accessible' : icon, text: get(tg) })).filter((e) => e.text);

/**
 * Wer darf hin (access)? → { kind: 'public' | 'limited' | 'private', text } – privat heißt: für einen selbst nicht
 * nutzbar (privat, kein Zugang, nur Anwohner, mit Genehmigung); eingeschränkt: Kunden, Anlieger. Die
 * Trefferlisten blenden private aus (app/category.js filterHits), eingeschränkte stehen mit Hinweis da.
 */
const ACCESS_NOTE = {
  customers: ['limited', t('poi.access_note.customers')], destination: ['limited', t('poi.access_note.destination')], delivery: ['limited', t('poi.access_note.delivery')],
  private: ['private', t('poi.access_note.private')], no: ['private', t('poi.access_note.no')], residents: ['private', t('poi.access_note.residents')],
  permit: ['private', t('poi.access_note.permit')],
};
export function accessOf(tags = {}) {
  const [kind, text] = ACCESS_NOTE[tags.access] ?? ['public', null];
  return { kind, text };
}

/**
 * Alle Angaben zu einem Ort.
 * → { category, look: { icon, color } (wie auf der Karte), name, type, traits, equipment: [{ icon, text }], description, status, access: { kind, text }, facts: [{ label, icon, value, unknown }], website }
 */
export function describePoi(tags = {}, { name, fallbackType } = {}) {
  const category = categoryFor(tags);
  const schema = SCHEMA[category?.id] ?? DEFAULT;
  const facts = [];
  for (const [label, icon, get, required, edit] of schema) {
    const value = get(tags);
    if (value || required) facts.push({ label, icon, value: value ?? t('poi.card.unknown'), unknown: !value });
  }
  const web = tags.website ?? tags['contact:website'] ?? tags.url;
  return {
    look: iconForTags(tags) ?? (category ? { icon: category.icon, color: category.color } : null),
    hours: tags.opening_hours ?? null,
    links: links(tags),
    category,
    name: name || tags.name || tags.brand || category?.one || fallbackType || t('poi.card.place'),
    type: category?.one ?? fallbackType ?? null,
    traits: traitsOf(tags),
    equipment: equipmentOf(tags),
    description: tags['description:de'] ?? tags.description ?? null,
    status: statusText(openState(tags.opening_hours)),
    open: openState(tags.opening_hours)?.open ?? null,
    access: accessOf(tags),
    facts,
    website: web && /^https?:\/\//.test(web) ? web : null,
  };
}

/** Unter dem Namen: Art und Merkmale */
const subline = (info) => [info.type !== info.name ? info.type : null, ...(info.traits ?? [])].filter(Boolean).join(' · ');

/** Karte fürs Popup und fürs Sheet. `compact` zeigt nur das Wichtigste. */
export function poiCard(info, { compact = false } = {}) {
  const c = info.category;
  const table = compact ? null : hoursTable(info.hours);
  // Telefon steht oben bei den Links (antippen ruft an)
  // Nichts doppelt: Zugang steht schon als Badge, eine Art gleich der unter dem Namen („Parkplatz“) fällt weg
  const dup = (f) => (info.access?.text && f.label === t('poi.facts.access')) || (!f.unknown && info.type && f.value.toLowerCase() === info.type.toLowerCase());
  const facts = (compact ? info.facts.slice(0, 5) : info.facts)
    .filter((f) => !dup(f) && !(table && f.label === t('poi.facts.hours')) && !(!compact && f.label === t('poi.facts.phone') && !f.unknown));
  // Im Sheet: Bekanntes als Badges, Unbekanntes in einer Zeile – keine grauen Kacheln mit „unbekannt“
  const known = facts.filter((f) => !f.unknown), unknown = facts.filter((f) => f.unknown);
  const badges = known.length ? `<ul class="poi-badges">${known.map((f) => `
        <li class="${f.value.includes('\n') ? 'multi' : ''}"><span class="msr">${f.icon}</span><span class="b-label">${esc(f.label)}</span>
        <b>${esc(f.value).replaceAll('\n', '<br>')}</b></li>`).join('')}</ul>` : '';
  const missing = unknown.length ? `<p class="poi-unknown"><span class="msr">help</span>${t('poi.card.still_unknown')} ${unknown.map((f) => esc(f.label)).join(' · ')}</p>` : '';
  return `
    <div class="poi-card${compact ? ' compact' : ''}">
      <header>
        <span class="poi-ico msr" style="--c:${info.look?.color ?? c?.color ?? '#e8590c'}">${info.look?.icon ?? c?.icon ?? 'location_on'}</span>
        <div><strong>${esc(info.name)}</strong>${subline(info) ? `<small>${esc(subline(info))}</small>` : ''}</div>
      </header>
      ${info.status ? `<p class="poi-status ${info.open ? 'open' : 'closed'}">${esc(info.status)}</p>` : ''}
      ${info.access?.text ? `<p class="poi-access ${info.access.kind}"><span class="msr">${info.access.kind === 'private' ? 'lock' : 'storefront'}</span>${esc(info.access.text)}</p>` : ''}
      ${!compact && info.links.length ? `<div class="poi-links">${info.links.map((l) => `
        <a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="msr">${l.icon}</span>${esc(l.label)}</a>`).join('')}</div>` : ''}
      ${!compact && info.description ? `<p class="poi-desc">${esc(info.description)}</p>` : ''}
      ${compact && facts.length ? `<dl class="poi-facts">${facts.map((f) => `
        <div class="${f.unknown ? 'unknown' : ''}"><dt><span class="msr">${f.icon}</span>${esc(f.label)}</dt>
        <dd>${esc(f.value).replaceAll('\n', '<br>')}</dd></div>`).join('')}</dl>` : ''}
      ${compact ? '' : badges + missing}
      ${!compact && info.equipment?.length ? `<div class="poi-equip"><h4><span class="msr">checklist</span> ${t('poi.card.equipment')}</h4><div>${info.equipment.map((e) => `
        <span class="chip"><span class="msr">${e.icon}</span>${esc(e.text)}</span>`).join('')}</div></div>` : ''}
      ${table ? `<div class="poi-hours-wrap"><h4><span class="msr">schedule</span> ${t('poi.facts.hours')}</h4>${table}</div>` : ''}
    </div>`;
}
