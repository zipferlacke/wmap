/**
 * Mitmachen bei OpenStreetMap: kurze Fragen zu Orten und Wegen, an denen man
 * gerade war – so wie StreetComplete, nur nebenbei nach einer Fahrt.
 *
 *   „Kostet das Parken hier etwas?“          Parkplatz ohne fee
 *   „Hat die Bäckerei noch diese Zeiten?“    opening_hours älter als ein Jahr
 *   „Wann hat … geöffnet?“                    Laden ohne opening_hours
 *   „Welchen Belag hat die Straße?“           befahrener Weg ohne surface
 *   „Ist der Weg beleuchtet?“                 zu Fuß/Rad, Fuß- oder Radweg ohne lit
 *   „Gibt es hier einen Weg?“                 Aufzeichnung neben allen Wegen → Hinweis
 *   „Warum bist du abgewichen?“               Neuberechnung unterwegs → ggf. Hinweis
 *
 * Gefragt wird nur, wo die Aufzeichnung zeigt, dass man wirklich dort war:
 * zu Fuß und mit dem Rad im Vorbeigehen (≤ 30 m), mit dem Auto nur dort, wo
 * man angehalten hat. Bestätigte Angaben bekommen ein check_date – so sehen
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

const QUESTIONS = 'wmap.survey.questions';
const DONE = 'wmap.survey.done';
const QUEUE = 'wmap.survey.queue';
const SCANNED = 'wmap.survey.scanned';
const KEEP_MS = 14 * 24 * 3600 * 1000;
const MAX_PER_SCAN = 12;
/** Nicht zwölfmal dasselbe: höchstens so viele je Art und Durchgang. */
const PER_QUEST = {
  detour: 3, missing_way: 3, parking_fee: 2, parking_surface: 2, hours_check: 4, hours_missing: 2, road_surface: 3, way_lit: 2,
};
const ORDER = Object.keys(PER_QUEST);

const today = () => new Date().toISOString().slice(0, 10);
const YEAR_MS = 365 * 24 * 3600 * 1000;
const MODE = { foot: 'zu Fuß', bike: 'mit dem Fahrrad', car: 'mit dem Auto' };

/* ── Fragen ───────────────────────────────────────────────────────────────── */

const SURFACES = [
  ['asphalt', 'Asphalt'], ['paving_stones', 'Pflaster'], ['sett', 'Kopfstein'], ['concrete', 'Beton'],
  ['compacted', 'Wassergebunden'], ['gravel', 'Schotter'], ['ground', 'Erde'], ['grass', 'Gras'],
];
const ROADS = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'service', 'track', 'living_street',
  'pedestrian', 'footway', 'cycleway', 'path', 'bridleway']);
const LIT_WAYS = new Set(['footway', 'cycleway', 'path', 'pedestrian']);
const HOUR_AMENITIES = /^(cafe|restaurant|fast_food|pharmacy|ice_cream|post_office|bank|library|bar|pub|biergarten)$/;
const WAY_NAMES = {
  residential: 'Wohnstraße', unclassified: 'Straße', tertiary: 'Straße', secondary: 'Straße', service: 'Zufahrt',
  track: 'Feldweg', living_street: 'Spielstraße', pedestrian: 'Fußgängerzone', footway: 'Fußweg',
  cycleway: 'Radweg', path: 'Pfad', bridleway: 'Reitweg',
};

/**
 * Jede Frage: wofür sie gilt, wie nah man gewesen sein muss, was gefragt
 * wird und was eine Antwort in OSM ändert.
 * near: 'pass' = vorbeigekommen (zu Fuß/Rad), 'stop' = dort angehalten
 */
export const QUESTS = {
  parking_fee: {
    icon: 'local_parking', near: 'stop', summary: 'Parkgebühr',
    applies: (t) => t.amenity === 'parking' && !t.fee && !['private', 'no', 'customers'].includes(t.access),
    title: () => 'Kostet das Parken hier etwas?',
    options: [
      { value: 'no', label: 'Kostenlos', icon: 'money_off', set: { fee: 'no' } },
      { value: 'yes', label: 'Kostenpflichtig', icon: 'payments', set: { fee: 'yes' } },
    ],
  },
  parking_surface: {
    icon: 'local_parking', near: 'stop', summary: 'Belag',
    applies: (t) => t.amenity === 'parking' && !t.surface && (!t.parking || t.parking === 'surface'),
    title: () => 'Welchen Belag hat der Parkplatz?',
    options: [...SURFACES.slice(0, 6), ['grass_paver', 'Rasengitter']].map(([v, l]) => ({ value: v, label: l, set: { surface: v } })),
  },
  hours_check: {
    icon: 'schedule', near: 'visit', summary: 'Öffnungszeiten',
    applies: (t, el) => !!t.opening_hours && !!t.name && (t.shop || HOUR_AMENITIES.test(t.amenity ?? ''))
      && !!parseWeek(t.opening_hours) && checkedAt(t, el) < Date.now() - YEAR_MS,
    title: (q) => `Hat ${q.name} noch diese Öffnungszeiten?`,
    kind: 'hours',
  },
  hours_missing: {
    icon: 'schedule', near: 'visit', summary: 'Öffnungszeiten',
    applies: (t) => !t.opening_hours && !!t.name && ((t.shop && t.shop !== 'vacant') || HOUR_AMENITIES.test(t.amenity ?? '')),
    title: (q) => `Wann hat ${q.name} geöffnet?`,
    kind: 'hours-new',
  },
  road_surface: {
    icon: 'add_road', near: 'driven', summary: 'Belag',
    applies: (t) => ROADS.has(t.highway) && !t.surface && t.area !== 'yes',
    title: (q) => `Welchen Belag hat ${q.name}?`,
    options: SURFACES.map(([v, l]) => ({ value: v, label: l, set: { surface: v } })),
  },
  way_lit: {
    icon: 'light', near: 'driven', modes: ['foot', 'bike'], summary: 'Beleuchtung',
    applies: (t) => LIT_WAYS.has(t.highway) && !t.lit,
    title: (q) => `Ist ${q.name} beleuchtet?`,
    options: [
      { value: 'yes', label: 'Ja, Laternen', icon: 'light', set: { lit: 'yes' } },
      { value: 'no', label: 'Nein', icon: 'dark_mode', set: { lit: 'no' } },
    ],
  },
  missing_way: {
    icon: 'add_road', summary: 'fehlender Weg', note: true,
    title: () => 'Hier warst du abseits aller Wege auf der Karte – gibt es dort einen Weg?',
    options: [
      { value: 'road', label: 'Straße' }, { value: 'track', label: 'Feldweg' },
      { value: 'footway', label: 'Fußweg' }, { value: 'cycleway', label: 'Radweg' },
      { value: 'none', label: 'Nein, GPS ungenau', icon: 'gps_off' },
    ],
  },
  detour: {
    icon: 'alt_route', summary: 'Sperrung', note: true,
    title: () => 'Du bist hier von der Route abgewichen – warum?',
    options: [
      { value: 'choice', label: 'Einfach anders gefahren' },
      { value: 'temporary', label: 'Vorübergehend gesperrt' },
      { value: 'gone', label: 'Weg gibt es nicht / dauerhaft gesperrt', icon: 'block' },
    ],
  },
};

/** Wann zuletzt geprüft: check_date:opening_hours, check_date, sonst letzte Bearbeitung */
function checkedAt(t, el) {
  const d = t['check_date:opening_hours'] ?? t.check_date ?? el?.timestamp;
  const ms = d ? Date.parse(d) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/* ── Gespeichertes ────────────────────────────────────────────────────────── */

export const questions = {
  list: () => (local.get(QUESTIONS, []) ?? []).filter((q) => Date.now() - q.created < KEEP_MS),
  save: (list) => local.set(QUESTIONS, list),
  remove(key) { this.save(this.list().filter((q) => q.key !== key)); },
};

/** Beantwortet oder „nicht mehr fragen“ – ein Jahr Ruhe. */
const done = {
  all: () => local.get(DONE, {}) ?? {},
  has(key) { const t = this.all()[key]; return !!t && Date.now() - t < YEAR_MS; },
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
      qu.notes.push({ point: q.point, text: noteText(q, `${q.name} gibt es an dieser Stelle anscheinend nicht mehr (geschlossen oder umgezogen).`), summary: 'Hinweis' });
    } else if (value?.hours) {
      qu.edits.push(edit(q, { opening_hours: value.hours, 'check_date:opening_hours': today() },
        { opening_hours: q.tags.opening_hours ?? null }, def.summary));
    }
  } else if (q.quest === 'missing_way') {
    if (value !== 'none') {
      const kind = def.options.find((o) => o.value === value)?.label ?? 'Weg';
      const line = q.line.map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`).join(' ');
      qu.notes.push({
        point: q.point, summary: 'Hinweis',
        text: noteText(q, `Hier fehlt ein Weg auf der Karte (vor Ort: ${kind}). Ich war hier ${MODE[q.mode] ?? ''} unterwegs.\nUngefährer Verlauf (lat,lon): ${line}`),
      });
    }
  } else if (q.quest === 'detour') {
    if (value === 'gone') {
      qu.notes.push({
        point: q.point, summary: 'Hinweis',
        text: noteText(q, `Der Weg, über den hier geroutet wurde, war vor Ort nicht vorhanden oder dauerhaft gesperrt (${MODE[q.mode] ?? 'unterwegs'}).`),
      });
    }
  } else {
    const opt = def.options.find((o) => o.value === value);
    if (opt?.set) qu.edits.push(edit(q, opt.set, Object.fromEntries(Object.keys(opt.set).map((k) => [k, q.tags[k] ?? null])), def.summary));
  }
  queue.set(qu);
  done.add(q.key);
  questions.remove(q.key);
}

/** Nicht jetzt: bleibt in der Liste, rutscht nach hinten. Nie: ein Jahr Ruhe. */
export function skip(q, { forever = false } = {}) {
  if (forever) { done.add(q.key); questions.remove(q.key); return; }
  const list = questions.list();
  const i = list.findIndex((x) => x.key === q.key);
  if (i >= 0) list.push(...list.splice(i, 1));
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
  if (Object.keys(set).length) qu.edits.push({ ...edit(p, set, expect, 'Parkplatz'), remark: remark || undefined });
  else if (remark) qu.notes.push({ point: p.point, summary: 'Hinweis', text: noteText({ at: Date.now() }, `${p.name}: ${remark}`) });
  queue.set(qu);
  for (const quest of ['parking_fee', 'parking_surface']) done.add(`${quest}:${p.osm.type}/${p.osm.id}`);
}

/** Ohne OSM-Konto als anonymen Hinweis senden? Standard: ja. */
export const anonNotes = {
  get: () => local.get('wmap.osm.anon', true) !== false,
  set: (on) => local.set('wmap.osm.anon', !!on),
};

const SAY = {
  fee: { no: 'kostenlos', yes: 'kostenpflichtig' },
  access: { yes: 'für alle geöffnet', customers: 'nur für Kundschaft', private: 'privat' },
  lit: { yes: 'beleuchtet', no: 'nicht beleuchtet' },
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
    const euro = (v) => v.replace(/^(\d+)\.(\d+)/, '$1,$2').replace(' EUR/hour', ' € pro Stunde').replace(' EUR/day', ' € pro Tag');
    const words = Object.entries(set).map(([k, v]) => SAY[k]?.[v] ?? (k === 'charge' ? `Preis ${euro(v)}`
      : k === 'opening_hours' ? `Öffnungszeiten: ${v}` : k === 'surface' ? `Belag: ${v}` : `${k}=${v}`));
    return {
      point: e.point,
      summary: 'Hinweis',
      text: noteText({ at: e.at }, `${e.name ?? 'Ort'} (https://www.openstreetmap.org/${key}): ${words.join(', ')}.\n`
        + `${remarks.length ? `Vermerk: ${remarks.join(' · ')}\n` : ''}`
        + `Vorschlag: ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join('; ')}`),
    };
  });
}

function noteText(q, text) {
  const d = new Date(q.at ?? Date.now()).toLocaleDateString('de-DE');
  return `${text}\nGesehen am ${d}.\n\n#WMap (Umfrage vor Ort)`;
}

/** Changeset-Kommentar aus dem, was drin ist. */
export function commentFor(edits) {
  const parts = [...new Set(edits.map((e) => e.summary))];
  return `${parts.join(', ')} ergänzt bzw. bestätigt – vor Ort erhoben mit WMap`;
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
    // Abseits: mehrere Punkte hintereinander ohne Weg in der Nähe
    let run = [];
    const close = () => {
      if (run.length >= 4) {
        const c = cumulative(run);
        if (c[c.length - 1] >= 80) offMap.push(run);
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

function wayName(t) {
  if (t.name) return t.name;
  if (t.ref) return t.ref;
  return `den ${WAY_NAMES[t.highway] ?? 'Weg'} hier`;
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
    const open = questions.list();
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
    const t = el.tags ?? {};
    const p = pointOf(el);
    for (const [quest, def] of Object.entries(QUESTS)) {
      if (def.note || !def.applies(t, el)) continue;
      if (def.modes && !def.modes.includes(mode)) continue;
      // Warst du wirklich dort?
      if (def.near === 'driven') { if (!(el.type === 'way' && driven.has(el.id))) continue; }
      else if (!p) continue;
      else if (def.near === 'stop' && !(nearStop(p) <= 150 || (mode !== 'car' && nearLine(p) <= 30))) continue;
      else if (def.near === 'visit' && !(nearStop(p) <= (mode === 'car' ? 100 : 60) || (mode !== 'car' && nearLine(p) <= 30))) continue;
      const name = def.near === 'driven' ? wayName(t) : t.name ?? (t.amenity === 'parking' ? 'Parkplatz' : 'dieser Ort');
      add({
        key: `${quest}:${el.type}/${el.id}`, quest, osm: { type: el.type, id: el.id },
        name, point: p ?? driven.get(el.id), tags: pick(t), mode, at: seg[0][2] * 1000, age: checkedAt(t, el),
      });
    }
  };

  // 1. Abweichungen von der Route – stehen schon fest
  for (const t of tripList) {
    for (const r of t.reroutes ?? []) {
      const p = r.planned[Math.min(3, r.planned.length - 1)] ?? r.point;
      add({
        key: `detour:${p[0].toFixed(4)},${p[1].toFixed(4)}`, quest: 'detour', name: 'Abweichung von der Route',
        point: p, line: r.planned, mode: t.profile, at: r.t * 1000,
      });
    }
  }

  const later = [];
  for (const seg of segments(pts)) {
    const trip = tripList.find((t) => seg[0][2] <= (t.end ?? until) && seg.at(-1)[2] >= t.start);
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
    for (const run of offMap.slice(0, 3)) {
      const mid = run[Math.floor(run.length / 2)];
      add({
        key: `missing_way:${mid[0].toFixed(4)},${mid[1].toFixed(4)}`, quest: 'missing_way', name: 'Weg abseits der Karte',
        point: [mid[0], mid[1]], line: simplifyTo(run, 12).map(([x, y]) => [x, y]), mode, at: run[0][2] * 1000,
      });
    }
    later.push({ ctx, line: simplifyTo(seg, 120), stops });
  }
  for (const t of tripList) trips.markAsked(t.id);
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
  if (failed) throw new Error('Läden und Parkplätze konnten gerade nicht geprüft werden (Overpass ausgelastet)');
  return questions.list().length;
}

/** Nur was die Fragen brauchen – nicht alle Tags im Speicher. */
function pick(t) {
  const keys = ['name', 'opening_hours', 'fee', 'surface', 'lit', 'highway', 'amenity', 'shop', 'access', 'parking', 'ref', 'check_date:opening_hours'];
  return Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
}

/** Mit Konto: Vermerke zu Änderungen gehen als eigene Hinweise für Mapper mit. */
export function remarkNotes(edits) {
  return edits.filter((e) => e.remark && e.point).map((e) => ({
    point: e.point, summary: 'Hinweis', text: noteText({ at: e.at }, `${e.name ?? 'Ort'}: ${e.remark}`),
  }));
}
