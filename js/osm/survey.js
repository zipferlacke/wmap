/**
 * Mitmachen bei OpenStreetMap: kurze Fragen zu Orten und Wegen, an denen man
 * gerade war – so wie StreetComplete, nur nebenbei nach einer Fahrt.
 *
 *   „Kostet das Parken hier etwas?“          Parkplatz ohne fee
 *   „Hat die Bäckerei noch diese Zeiten?“    opening_hours älter als ein Jahr
 *   „Wann hat … geöffnet?“                    Laden ohne opening_hours
 *   „Welchen Belag hat die Straße?“           befahrener Weg ohne surface
 *   „Ist der Weg beleuchtet?“                 zu Fuß/Rad, Fuß- oder Radweg ohne lit
 *   „Gibt es hier einen Weg?“                 ≥ 200 m neben allen Wegen → Hinweis
 *   „Warum bist du abgewichen?“               ≥ 100 m neben der Route → ggf. Hinweis
 *   „Gibt es … noch?“                         Laden/Lokal im Vorbeikommen → check_date
 *
 * Unterwegs in der Navigation kommen „Neuer Weg?“, „Gesperrt?“ und „Gibt es
 * … noch?“ gleich als kleine Pille (app/ask-along.js); läuft sie ab, steht
 * die Frage hier am Ende (askLater). ✕ heißt vergessen: Die Frage ist weg,
 * kommt man wieder vorbei, darf sie wiederkommen.
 *
 * Gefragt wird nur, wo die Aufzeichnung zeigt, dass man wirklich dort war:
 * Öffnungszeiten und Parkplätze nur, wo man angehalten hat; Wege, die man
 * befahren hat. Bestätigte Angaben bekommen ein check_date – so sehen
 * andere, dass sie noch stimmen. Fehlende Wege und dauerhafte Sperrungen
 * werden nicht selbst eingezeichnet, sondern als OSM-Hinweis gemeldet: Einen
 * Weg allein aus einer GPS-Spur zu zeichnen, wäre zu ungenau.
 */
import { API } from '../core/config.js';
import { local } from '../data/store.js';
import { run as overpass } from '../services/overpass.js';
import { matchTrace } from '../services/routing.js';
import { trace, trips } from '../data/trace.js';
import { distance, simplifyTo, cumulative, nearestOnLine } from '../core/geo.js';
import { parseWeek } from '../ui/poi-info.js';
import { locale, t, tBase } from '../core/i18n.js';
import { used } from '../services/usage.js';

const QUESTIONS = 'wmap.survey.questions';
const DONE = 'wmap.survey.done';
const QUEUE = 'wmap.survey.queue';
const SCANNED = 'wmap.survey.scanned';
const KEEP_MS = 14 * 24 * 3600 * 1000;
const MAX_PER_SCAN = 12;
/** Nicht zwölfmal dasselbe: höchstens so viele je Art und Durchgang. */
const PER_QUEST = {
  detour: 3, missing_way: 3, exists: 4, parking_fee: 2, parking_surface: 2, hours_check: 4, hours_missing: 2, road_surface: 3, way_lit: 2,
};
const ORDER = Object.keys(PER_QUEST);

const today = () => new Date().toISOString().slice(0, 10);
const YEAR_MS = 365 * 24 * 3600 * 1000;
const MODE = { foot: t('osm.survey.mode.foot'), bike: t('osm.survey.mode.bike'), car: t('osm.survey.mode.car') };

/* ── Fragen ───────────────────────────────────────────────────────────────── */

const SURFACES = [
  ['asphalt', t('osm.survey.surface.asphalt')], ['paving_stones', t('osm.survey.surface.paving_stones')], ['sett', t('osm.survey.surface.sett')], ['concrete', t('osm.survey.surface.concrete')],
  ['compacted', t('osm.survey.surface.compacted')], ['gravel', t('osm.survey.surface.gravel')], ['ground', t('osm.survey.surface.ground')], ['grass', t('osm.survey.surface.grass')],
];
const ROADS = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'service', 'track', 'living_street',
  'pedestrian', 'footway', 'cycleway', 'path', 'bridleway']);
const LIT_WAYS = new Set(['footway', 'cycleway', 'path', 'pedestrian']);
const HOUR_AMENITIES = /^(cafe|restaurant|fast_food|pharmacy|ice_cream|post_office|bank|library|bar|pub|biergarten)$/;
const WAY_NAMES = {
  residential: t('osm.survey.way.residential'), unclassified: t('osm.survey.way.road'), tertiary: t('osm.survey.way.road'), secondary: t('osm.survey.way.road'), service: t('osm.survey.way.service'),
  track: t('osm.survey.way.track'), living_street: t('osm.survey.way.living_street'), pedestrian: t('osm.survey.way.pedestrian'), footway: t('osm.survey.way.footway'),
  cycleway: t('osm.survey.way.cycleway'), path: t('osm.survey.way.path'), bridleway: t('osm.survey.way.bridleway'),
};

/**
 * Jede Frage: wofür sie gilt, wie nah man gewesen sein muss, was gefragt
 * wird und was eine Antwort in OSM ändert.
 * near: 'pass' = vorbeigekommen (zu Fuß/Rad), 'stop' = dort angehalten
 */
export const QUESTS = {
  parking_fee: {
    icon: 'local_parking', near: 'stop', summary: t('osm.survey.quests.parking_fee.summary'),
    applies: (tags) => tags.amenity === 'parking' && !tags.fee && !['private', 'no', 'customers'].includes(tags.access),
    title: () => t('osm.survey.quests.parking_fee.title'),
    options: [
      { value: 'no', label: t('osm.survey.quests.parking_fee.free'), icon: 'money_off', set: { fee: 'no' } },
      { value: 'yes', label: t('osm.survey.quests.parking_fee.paid'), icon: 'payments', set: { fee: 'yes' } },
    ],
  },
  parking_surface: {
    icon: 'local_parking', near: 'stop', summary: t('osm.survey.quests.surface_summary'),
    applies: (tags) => tags.amenity === 'parking' && !tags.surface && (!tags.parking || tags.parking === 'surface'),
    title: () => t('osm.survey.quests.parking_surface.title'),
    options: [...SURFACES.slice(0, 6), ['grass_paver', t('osm.survey.surface.grass_paver')]].map(([v, l]) => ({ value: v, label: l, set: { surface: v } })),
  },
  hours_check: {
    icon: 'schedule', near: 'visit', summary: t('osm.survey.quests.hours_summary'),
    applies: (tags, el) => !!tags.opening_hours && !!tags.name && (tags.shop || HOUR_AMENITIES.test(tags.amenity ?? ''))
      && !!parseWeek(tags.opening_hours) && checkedAt(tags, el) < Date.now() - YEAR_MS,
    title: (q) => t('osm.survey.quests.hours_check.title', { name: q.name }),
    kind: 'hours',
  },
  hours_missing: {
    icon: 'schedule', near: 'visit', summary: t('osm.survey.quests.hours_summary'),
    applies: (tags) => !tags.opening_hours && !!tags.name && ((tags.shop && tags.shop !== 'vacant') || HOUR_AMENITIES.test(tags.amenity ?? '')),
    title: (q) => t('osm.survey.quests.hours_missing.title', { name: q.name }),
    kind: 'hours-new',
  },
  road_surface: {
    icon: 'add_road', near: 'driven', summary: t('osm.survey.quests.surface_summary'),
    applies: (tags) => ROADS.has(tags.highway) && !tags.surface && tags.area !== 'yes',
    title: (q) => t('osm.survey.quests.road_surface.title', { name: q.name }),
    options: SURFACES.map(([v, l]) => ({ value: v, label: l, set: { surface: v } })),
  },
  way_lit: {
    icon: 'light', near: 'driven', modes: ['foot', 'bike'], summary: t('osm.survey.quests.way_lit.summary'),
    applies: (tags) => LIT_WAYS.has(tags.highway) && !tags.lit,
    title: (q) => t('osm.survey.quests.way_lit.title', { name: q.name }),
    options: [
      { value: 'yes', label: t('osm.survey.quests.way_lit.yes'), icon: 'light', set: { lit: 'yes' } },
      { value: 'no', label: t('osm.survey.quests.way_lit.no'), icon: 'dark_mode', set: { lit: 'no' } },
    ],
  },
  missing_way: {
    icon: 'add_road', summary: t('osm.survey.quests.missing_way.summary'), note: true,
    title: () => t('osm.survey.quests.missing_way.title'),
    options: [
      { value: 'road', label: t('osm.survey.way.road') }, { value: 'track', label: t('osm.survey.way.track') },
      { value: 'footway', label: t('osm.survey.way.footway') }, { value: 'cycleway', label: t('osm.survey.way.cycleway') },
      { value: 'none', label: t('osm.survey.quests.missing_way.none'), icon: 'gps_off' },
    ],
  },
  exists: {
    icon: 'storefront', along: true, summary: t('osm.survey.quests.exists.summary'),
    title: (q) => t('osm.survey.quests.exists.title', { name: q.name }),
    options: [
      { value: 'yes', label: t('osm.survey.quests.exists.yes'), icon: 'check' },
      { value: 'gone', label: t('osm.survey.quests.exists.gone'), icon: 'block' },
    ],
  },
  detour: {
    icon: 'alt_route', summary: t('osm.survey.quests.detour.summary'), note: true,
    title: () => t('osm.survey.quests.detour.title'),
    options: [
      { value: 'choice', label: t('osm.survey.quests.detour.choice') },
      { value: 'temporary', label: t('osm.survey.quests.detour.temporary') },
      { value: 'gone', label: t('osm.survey.quests.detour.gone'), icon: 'block' },
    ],
  },
};

/** Wann zuletzt geprüft: check_date:opening_hours, check_date, sonst letzte Bearbeitung */
function checkedAt(tags, el) {
  const d = tags['check_date:opening_hours'] ?? tags.check_date ?? el?.timestamp;
  const ms = d ? Date.parse(d) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/* ── Gespeichertes ────────────────────────────────────────────────────────── */

const SNOOZE_MS = 24 * 3600 * 1000;

export const questions = {
  /** Alle gespeicherten (14 Tage), auch die für „später“ zurückgestellten */
  all: () => (local.get(QUESTIONS, []) ?? []).filter((q) => Date.now() - q.created < KEEP_MS),
  /** Was jetzt dran ist – ohne die zurückgestellten */
  list() { return this.all().filter((q) => !(q.snooze > Date.now())); },
  save: (list) => local.set(QUESTIONS, list),
  remove(key) { this.save(this.all().filter((q) => q.key !== key)); },
};

/** Beantwortet – ein Jahr Ruhe. */
const done = {
  all: () => local.get(DONE, {}) ?? {},
  has(key) { const at = this.all()[key]; return !!at && Date.now() - at < YEAR_MS; },
  add(key) { const all = this.all(); all[key] = Date.now(); local.set(DONE, all); },
};

export const queue = {
  get: () => local.get(QUEUE, { edits: [], notes: [] }) ?? { edits: [], notes: [] },
  set: (q) => local.set(QUEUE, q),
  size() { const q = this.get(); return q.edits.length + q.notes.length; },
  clear() { this.set({ edits: [], notes: [] }); },
};

/* ── Antworten ────────────────────────────────────────────────────────────── */

/**
 * Antwort in die Warteschlange. value je nach Frage; bei Öffnungszeiten
 * 'yes' | { hours: 'Mo-Fr …' } | 'gone'.
 */
export function answer(q, value) {
  const def = QUESTS[q.quest];
  const qu = queue.get();
  if (q.quest === 'hours_check' || q.quest === 'hours_missing') {
    if (value === 'yes') {
      qu.edits.push(edit(q, { 'check_date:opening_hours': today() }, { opening_hours: q.tags.opening_hours ?? null }, def.summary));
    } else if (value === 'gone') {
      qu.notes.push({ point: q.point, text: noteText(q, tBase('osm.survey.note.gone', { name: q.name })), summary: tBase('osm.survey.note.summary') });
    } else if (value?.hours) {
      qu.edits.push(edit(q, { opening_hours: value.hours, 'check_date:opening_hours': today() },
        { opening_hours: q.tags.opening_hours ?? null }, def.summary));
    }
  } else if (q.quest === 'missing_way') {
    if (value !== 'none') {
      const kind = def.options.find((o) => o.value === value)?.label ?? t('osm.survey.way.fallback');
      const line = q.line.map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`).join(' ');
      qu.notes.push({
        point: q.point, summary: tBase('osm.survey.note.summary'),
        text: noteText(q, tBase('osm.survey.note.missing_way', { kind, mode: MODE[q.mode] ?? '', line })),
      });
    }
  } else if (q.quest === 'detour') {
    const why = {
      gone: tBase('osm.survey.note.why.gone'),
      temporary: tBase('osm.survey.note.why.temporary'),
      blocked: tBase('osm.survey.note.why.blocked'),
    }[value];
    if (why) {
      qu.notes.push({
        point: q.point, summary: tBase('osm.survey.note.summary'),
        text: noteText(q, tBase('osm.survey.note.detour', { why, mode: MODE[q.mode] ?? tBase('osm.survey.note.underway') })),
      });
    }
  } else if (q.quest === 'exists') {
    if (value === 'yes') qu.edits.push(edit(q, { check_date: today() }, { check_date: q.tags.check_date ?? null }, def.summary));
    else if (value === 'gone') qu.notes.push({ point: q.point, summary: tBase('osm.survey.note.summary'), text: noteText(q, tBase('osm.survey.note.gone', { name: q.name })) });
  } else {
    const opt = def.options.find((o) => o.value === value);
    if (opt?.set) qu.edits.push(edit(q, opt.set, Object.fromEntries(Object.keys(opt.set).map((k) => [k, q.tags[k] ?? null])), def.summary));
  }
  queue.set(qu);
  done.add(q.key);
  questions.remove(q.key);
}

/**
 * Unterwegs nicht beantwortet (Pille abgelaufen): steht am Ende in der Liste.
 * @param q  { key, quest, name, point, … } wie beim Suchen
 */
export function askLater(q) {
  if (done.has(q.key) || questions.all().some((x) => x.key === q.key)) return;
  questions.save([...questions.all(), { ...q, created: Date.now() }].sort((a, b) => ORDER.indexOf(a.quest) - ORDER.indexOf(b.quest)));
}

/** ✕ (Pille oder Liste): vergessen – ohne Sperre, beim nächsten Vorbeikommen darf sie wiederkommen */
export const forget = (q) => questions.remove(q.key);

/** Kurze Fragen unterwegs in der Navigation – je Fortbewegung an/aus (Einstellungen → Unterwegs) */
export const alongSetting = {
  get: (mode) => (local.get('wmap.survey.along', {}) ?? {})[mode] !== false,
  set(mode, on) { local.set('wmap.survey.along', { ...(local.get('wmap.survey.along', {}) ?? {}), [mode]: !!on }); },
};

/**
 * „Gibt es … noch?“ zu einem Ort, an dem man gerade vorbeikam (app/ask-along.js;
 * der Ort kommt aus den Kartenkacheln, `el` frisch von der OSM-API) – nur
 * Läden und Lokale mit Namen, die seit über zwei Jahren niemand angefasst hat.
 * → Frage oder null
 */
export function existsQuestion(el, point) {
  const tags = el?.tags ?? {};
  if (!tags.name || !((tags.shop && tags.shop !== 'vacant') || HOUR_AMENITIES.test(tags.amenity ?? ''))) return null;
  if (checkedAt(tags, el) >= Date.now() - 2 * YEAR_MS) return null;
  const key = `exists:${el.type}/${el.id}`;
  if (done.has(key)) return null;
  return { key, quest: 'exists', osm: { type: el.type, id: el.id }, name: tags.name, point, tags: pick(tags) };
}

/** „Weiß nicht / später“: einen Tag aus der Liste, dann wieder dran (hinten). */
export function skip(q) {
  const list = questions.all();
  const i = list.findIndex((x) => x.key === q.key);
  if (i >= 0) list.push({ ...list.splice(i, 1)[0], snooze: Date.now() + SNOOZE_MS });
  questions.save(list);
}

function edit(q, set, expect, summary) {
  return { osm: q.osm, set, expect, summary, name: q.name, point: q.point, at: Date.now() };
}

/**
 * Parkplatz, frisch erlebt (kurze Frage am Ziel): kostenlos? wie teuer?
 * für alle? – nur was in OSM noch fehlt, wird eine Änderung. Ein Vermerk
 * geht als Hinweis für andere Mapper mit.
 * @param p  { osm: { type, id }, name, point, tags }
 */
export function answerParking(p, { fee, charge, access, remark } = {}) {
  const qu = queue.get();
  const set = {}, expect = {};
  const put = (k, v) => { if (v && !p.tags[k]) { set[k] = v; expect[k] = null; } };
  put('fee', fee);
  put('charge', charge);
  put('access', access);
  // Der Vermerk reist mit der Änderung – ohne Konto landet alles in einem Hinweis
  if (Object.keys(set).length) qu.edits.push({ ...edit(p, set, expect, t('osm.survey.parking')), remark: remark || undefined });
  else if (remark) qu.notes.push({ point: p.point, summary: tBase('osm.survey.note.summary'), text: noteText({ at: Date.now() }, tBase('osm.survey.note.remark_place', { name: p.name, text: remark })) });
  queue.set(qu);
  for (const quest of ['parking_fee', 'parking_surface']) done.add(`${quest}:${p.osm.type}/${p.osm.id}`);
}

/** Ohne OSM-Konto als anonymen Hinweis senden? Standard: ja. */
export const anonNotes = {
  get: () => local.get('wmap.osm.anon', true) !== false,
  set: (on) => local.set('wmap.osm.anon', !!on),
};

const SAY = {
  fee: { no: t('osm.survey.say.fee.no'), yes: t('osm.survey.say.fee.yes') },
  access: { yes: t('osm.survey.say.access.yes'), customers: t('osm.survey.say.access.customers'), private: t('osm.survey.say.access.private') },
  lit: { yes: t('osm.survey.say.lit.yes'), no: t('osm.survey.say.lit.no') },
};

/**
 * Ohne Konto dürfen wir die Karte nicht ändern – dann werden Änderungen zu
 * Hinweisen, die Mapper eintragen: lesbar und mit dem fertigen Tag-Vorschlag.
 * Reine Bestätigungen (nur check_date) fallen weg, die helfen als Hinweis nicht.
 */
export function editsAsNotes(edits) {
  const byObj = new Map();
  for (const e of edits) {
    const set = Object.fromEntries(Object.entries(e.set).filter(([k]) => !k.startsWith('check_date')));
    if (!Object.keys(set).length || !e.point) continue;
    const key = `${e.osm.type}/${e.osm.id}`;
    const g = byObj.get(key) ?? { e, set: {}, remarks: [] };
    Object.assign(g.set, set);
    if (e.remark) g.remarks.push(e.remark);
    byObj.set(key, g);
  }
  return [...byObj.entries()].map(([key, { e, set, remarks }]) => {
    const euro = (v) => v.replace(/^(\d+)\.(\d+)/, '$1,$2').replace(' EUR/hour', t('osm.survey.say.per_hour')).replace(' EUR/day', t('osm.survey.say.per_day'));
    const words = Object.entries(set).map(([k, v]) => SAY[k]?.[v] ?? (k === 'charge' ? t('osm.survey.say.charge', { v: euro(v) })
      : k === 'opening_hours' ? t('osm.survey.say.hours', { v }) : k === 'surface' ? t('osm.survey.say.surface', { v }) : `${k}=${v}`));
    return {
      point: e.point,
      summary: tBase('osm.survey.note.summary'),
      text: noteText({ at: e.at }, `${tBase('osm.survey.note.place', { name: e.name ?? tBase('osm.survey.note.place_default'), key, words: words.join(', ') })}\n`
        + `${remarks.length ? `${tBase('osm.survey.note.remark', { text: remarks.join(' · ') })}\n` : ''}`
        + tBase('osm.survey.note.suggestion', { tags: Object.entries(set).map(([k, v]) => `${k}=${v}`).join('; ') })),
    };
  });
}

function noteText(q, text) {
  const d = new Date(q.at ?? Date.now()).toLocaleDateString(locale);
  return tBase('osm.survey.note.footer', { text, date: d });
}

/** Changeset-Kommentar aus dem, was drin ist. */
export function commentFor(edits) {
  const parts = [...new Set(edits.map((e) => e.summary))];
  return tBase('osm.survey.comment', { parts: parts.join(', ') });
}

/* ── Fragen finden ────────────────────────────────────────────────────────── */

/** Stillstand ≥ 3 min innerhalb von 50 m – dort war man wirklich. */
function stopsOf(pts) {
  const stops = [];
  for (let i = 0; i < pts.length;) {
    let j = i + 1;
    while (j < pts.length && distance(pts[i], pts[j]) < 50) j += 1;
    if (pts[j - 1][2] - pts[i][2] >= 180) stops.push(pts[i]);
    i = j;
  }
  if (pts.length) stops.push(pts.at(-1));          // Ende der Fahrt: angekommen
  return stops;
}

/** Zu Fuß, Rad oder Auto – aus dem mittleren Tempo. */
function guessMode(pts) {
  const v = [];
  for (let i = 1; i < pts.length; i += 1) {
    const dt = pts[i][2] - pts[i - 1][2];
    if (dt > 0 && dt < 60) v.push(distance(pts[i - 1], pts[i]) / dt);
  }
  if (!v.length) return 'foot';
  v.sort((a, b) => a - b);
  const m = v[Math.floor(v.length / 2)];
  return m < 2.3 ? 'foot' : m < 7 ? 'bike' : 'car';
}

/** Aufzeichnung an langen Pausen (App zu) in Abschnitte teilen. */
function segments(pts) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (cur.length && p[2] - cur.at(-1)[2] > 900) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.filter((s) => s.length >= 5);
}

/** Wege, auf denen man ≥ 60 m unterwegs war, und Stücke abseits aller Wege. */
async function matchSegment(pts, mode, signal) {
  const ways = new Map();
  const offMap = [];
  // Valhalla nimmt nicht beliebig lange Spuren – in Stücken abgleichen
  for (let i = 0; i < pts.length; i += 1500) {
    const part = pts.slice(i, i + 1501);
    let res;
    try { res = await matchTrace(part, mode, { signal }); } catch (err) {
      if (err.name === 'AbortError') throw err;
      continue;
    }
    // Zu jeder Kante ein Punkt der Spur – damit „auf der Karte zeigen“ weiß, wohin
    const pointOfEdge = new Map();
    res.matched.forEach((m, k) => { if (m.edge_index !== undefined && !pointOfEdge.has(m.edge_index)) pointOfEdge.set(m.edge_index, [part[k][0], part[k][1]]); });
    res.edges.forEach((e, k) => {
      if (!e.way_id) return;
      const w = ways.get(e.way_id) ?? { m: 0, point: null };
      w.m += (e.length ?? 0) * 1000;
      w.point ??= pointOfEdge.get(k) ?? null;
      ways.set(e.way_id, w);
    });
    // Abseits: wirklich ein Stück (≥ 200 m) ohne Weg in der Nähe – GPS-Rauschen
    // im Stand oder an einer Kreuzung reicht dafür nicht
    let run = [];
    const close = () => {
      if (run.length >= 8) {
        const c = cumulative(run);
        if (c[c.length - 1] >= 200) offMap.push(run);
      }
      run = [];
    };
    res.matched.forEach((m, k) => {
      const off = m.type === 'unmatched' || (m.distance_from_trace_point ?? 0) > 30;
      if (off) run.push(part[k]); else close();
    });
    close();
  }
  return { ways: [...ways.entries()].filter(([, w]) => w.m >= 60), offMap };
}

const around = (pts, r) => `around:${r},${pts.map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`).join(',')}`;

/** Befahrene Wege direkt von der OSM-API – schnell, die IDs kennt man ja schon. */
async function waysById(ids, signal) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    used('osm');
    const res = await fetch(`${API.osm}/ways.json?ways=${ids.slice(i, i + 100).join(',')}`, { signal });
    if (!res.ok) throw new Error(`OSM-API: ${res.status}`);
    out.push(...(await res.json()).elements.filter((e) => e.tags?.highway));
  }
  return out;
}

/** Läden, Lokale und Parkplätze in der Nähe – über Overpass, das dauert. */
async function poisNear({ line, stops, mode }, signal) {
  const parts = [];
  // Zu Fuß und mit dem Rad sieht man im Vorbeigehen, was an Läden steht;
  // mit dem Auto nur, wo man angehalten hat
  const poiArea = mode === 'car' ? (stops.length ? around(stops, 120) : null) : around(line, 35);
  if (poiArea) {
    parts.push(`nwr(${poiArea})[shop][name];`, `nwr(${poiArea})[amenity~"${HOUR_AMENITIES.source}"][name];`);
  }
  const parkArea = mode === 'car' ? (stops.length ? around(stops, 150) : null) : around(line, 30);
  if (parkArea) parts.push(`nwr(${parkArea})[amenity=parking];`);
  if (!parts.length) return [];
  return overpass(`[out:json][timeout:25];(${parts.join('')});out tags center meta 300;`, signal);
}

const pointOf = (el) => (el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null);

function wayName(tags) {
  if (tags.name) return tags.name;
  if (tags.ref) return tags.ref;
  return t('osm.survey.way.here', { way: WAY_NAMES[tags.highway] ?? t('osm.survey.way.fallback') });
}

/**
 * Aufzeichnung seit dem letzten Mal durchgehen und neue Fragen anlegen.
 * Erst die schnellen (Wege, Abweichungen), dann die über Overpass (Läden,
 * Parkplätze) – onUpdate meldet sich nach jedem Schritt.
 * → Anzahl offener Fragen
 */
export async function scan({ signal, onUpdate } = {}) {
  const since = local.get(SCANNED, 0);
  const until = Math.round(Date.now() / 1000) - 30;
  const pts = trace.between(since + 1, until);
  const tripList = trips.open();
  const found = [];
  const seen = new Set();
  const add = (q) => { if (!seen.has(q.key)) { seen.add(q.key); found.push(q); } };

  /** Gefundenes nach Wichtigkeit einsortieren, je Art begrenzt. */
  const commit = () => {
    const open = questions.all();
    const known = new Set(open.map((q) => q.key));
    const per = {};
    for (const q of open) per[q.quest] = (per[q.quest] ?? 0) + 1;
    const fresh = found
      .filter((q) => !known.has(q.key) && !done.has(q.key))
      .sort((a, b) => ORDER.indexOf(a.quest) - ORDER.indexOf(b.quest) || (a.age ?? 0) - (b.age ?? 0))
      .filter((q) => (per[q.quest] = (per[q.quest] ?? 0) + 1) <= PER_QUEST[q.quest])
      .slice(0, MAX_PER_SCAN)
      .map(({ age, ...q }) => ({ ...q, created: Date.now() }));
    found.length = 0;
    questions.save([...open, ...fresh].sort((a, b) => ORDER.indexOf(a.quest) - ORDER.indexOf(b.quest)));
    onUpdate?.();
  };

  const toAsk = (el, { mode, seg, nearLine, nearStop, driven }) => {
    const tags = el.tags ?? {};
    const p = pointOf(el);
    for (const [quest, def] of Object.entries(QUESTS)) {
      if (def.note || def.along || !def.applies(tags, el)) continue;
      if (def.modes && !def.modes.includes(mode)) continue;
      // Warst du wirklich dort?
      if (def.near === 'driven') { if (!(el.type === 'way' && driven.has(el.id))) continue; }
      else if (!p) continue;
      else if (def.near === 'stop' && !(nearStop(p) <= 150 || (mode !== 'car' && nearLine(p) <= 30))) continue;
      // Öffnungszeiten nur, wo man angehalten hat – im Vorbeigehen sieht man sie nicht
      else if (def.near === 'visit' && !(nearStop(p) <= (mode === 'car' ? 100 : 60))) continue;
      const name = def.near === 'driven' ? wayName(tags) : tags.name ?? (tags.amenity === 'parking' ? t('osm.survey.parking') : t('osm.survey.this_place'));
      add({
        key: `${quest}:${el.type}/${el.id}`, quest, osm: { type: el.type, id: el.id },
        name, point: p ?? driven.get(el.id), tags: pick(tags), mode, at: seg[0][2] * 1000, age: checkedAt(tags, el),
      });
    }
  };

  // 1. Abweichungen von der Route – stehen schon fest
  for (const trip of tripList) {
    for (const r of trip.reroutes ?? []) {
      const p = r.planned[Math.min(3, r.planned.length - 1)] ?? r.point;
      add({
        key: `detour:${p[0].toFixed(4)},${p[1].toFixed(4)}`, quest: 'detour', name: t('osm.survey.name.detour'),
        point: p, line: r.planned, mode: trip.profile, at: r.t * 1000,
      });
    }
  }

  const later = [];
  for (const seg of segments(pts)) {
    const trip = tripList.find((x) => seg[0][2] <= (x.end ?? until) && seg.at(-1)[2] >= x.start);
    const mode = trip?.profile && MODE[trip.profile] ? trip.profile : guessMode(seg);
    const stops = stopsOf(seg);
    const cum = cumulative(seg);
    const ctx = {
      mode, seg,
      nearLine: (p) => nearestOnLine(seg, cum, p).offset,
      nearStop: (p) => Math.min(...stops.map((s) => distance(s, p))),
      driven: new Map(),
    };

    // 2. Befahrene Wege (Map-Matching + OSM-API) und Stücke abseits der Karte
    const { ways, offMap } = await matchSegment(seg, mode, signal);
    for (const [id, w] of ways) ctx.driven.set(id, w.point);
    try {
      for (const el of await waysById(ways.map(([id]) => id).slice(0, 300), signal)) toAsk(el, ctx);
    } catch (err) { if (err.name === 'AbortError') throw err; }
    // In der Navigation fragt das schon unterwegs (app/ask-along.js)
    const navigated = (at) => tripList.some((x) => x.profile && at >= x.start && at <= (x.end ?? until));
    for (const run of offMap.filter((r) => !navigated(r[0][2])).slice(0, 3)) {
      const mid = run[Math.floor(run.length / 2)];
      add({
        key: `missing_way:${mid[0].toFixed(4)},${mid[1].toFixed(4)}`, quest: 'missing_way', name: t('osm.survey.name.missing_way'),
        point: [mid[0], mid[1]], line: simplifyTo(run, 12).map(([x, y]) => [x, y]), mode, at: run[0][2] * 1000,
      });
    }
    later.push({ ctx, line: simplifyTo(seg, 120), stops });
  }
  for (const x of tripList) trips.markAsked(x.id);
  if (pts.length) local.set(SCANNED, pts.at(-1)[2]);
  commit();

  // 3. Läden, Lokale, Parkplätze – Overpass kann dauern
  let failed = null;
  for (const { ctx, line, stops } of later) {
    try {
      for (const el of await poisNear({ line, stops, mode: ctx.mode }, signal)) toAsk(el, ctx);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed = err;
    }
    commit();
  }
  if (failed) throw new Error(t('osm.survey.overpass_failed'));
  return questions.list().length;
}

/** Nur was die Fragen brauchen – nicht alle Tags im Speicher. */
function pick(tags) {
  const keys = ['name', 'opening_hours', 'check_date', 'fee', 'surface', 'lit', 'highway', 'amenity', 'shop', 'access', 'parking', 'ref', 'check_date:opening_hours'];
  return Object.fromEntries(keys.filter((k) => tags[k] !== undefined).map((k) => [k, tags[k]]));
}

/** Mit Konto: Vermerke zu Änderungen gehen als eigene Hinweise für Mapper mit. */
export function remarkNotes(edits) {
  return edits.filter((e) => e.remark && e.point).map((e) => ({
    point: e.point, summary: tBase('osm.survey.note.summary'), text: noteText({ at: e.at }, tBase('osm.survey.note.remark_place', { name: e.name ?? tBase('osm.survey.note.place_default'), text: e.remark })),
  }));
}
