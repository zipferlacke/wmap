/**
 * Gemerktes, das kein GPX ist:
 *
 *   Verbindungen   Bus & Bahn von A nach B zu einer Zeit, mit allen
 *                  Abschnitten – unter Meine Touren → Verbindungen
 *   Orte           Zuhause, Arbeit und Lesezeichen (Haltestellen, Orte, mit
 *                  eigenem Namen) in Listen („Allgemein“, „Hannover Urlaub“ …)
 *                  – Zuhause/Arbeit in Suche und Routenplanung immer oben,
 *                  Lesezeichen dort, wenn sie zur Eingabe passen
 *
 * Liegt im Browser (wmap.saved). Mit verbundenem Ordner gleicht data/folder.js
 * ab: jede Verbindung als eigene Datei unter „Bus & Bahn/“ (wie ein Weg),
 * die Orte in „Lesezeichen.json“ – je Eintrag gewinnt das Neuere, Gelöschtes
 * merkt sich eine Liste (`deleted`), damit es nicht wiederkommt.
 */
import { local } from './store.js';

const KEY = 'wmap.saved';
export const PLACE_KINDS = {
  home: { label: 'Zuhause', icon: 'home' },
  work: { label: 'Arbeit', icon: 'work' },
  stop: { label: 'Haltestelle', icon: 'directions_bus' },
  fav: { label: 'Gemerkt', icon: 'star' },
};

const read = () => {
  const d = local.get(KEY, null) ?? {};
  return { connections: d.connections ?? [], places: d.places ?? [], deleted: d.deleted ?? {} };
};
/** Speichern; `sync`: danach mit dem Ordner abgleichen (data/folder.js hört auf „wmap:data“) */
const write = (d, { sync = true } = {}) => {
  local.set(KEY, d);
  dispatchEvent(new CustomEvent('wmap:saved'));
  if (sync) dispatchEvent(new CustomEvent('wmap:data', { detail: { kind: 'saved' } }));
};
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function remove(listKey, id) {
  const d = read();
  d[listKey] = d[listKey].filter((x) => x.id !== id);
  d.deleted[id] = Date.now();
  local.set(KEY, d);
  dispatchEvent(new CustomEvent('wmap:saved'));
  // Verbindungen sind im Ordner eigene Dateien – der Abgleich muss wissen, welche
  dispatchEvent(new CustomEvent('wmap:data', { detail: { kind: listKey === 'connections' ? 'conn' : 'saved', id, removed: listKey === 'connections' } }));
}

export const connections = {
  all: () => read().connections.sort((a, b) => a.dep - b.dep),
  get: (id) => read().connections.find((c) => c.id === id) ?? null,
  /** Aus einer Route von journeys() + Start/Ziel ({ label, point }) */
  save(route, from, to) {
    const t = route.transit;
    const d = read();
    const same = d.connections.find((c) => c.key === t.key);
    if (same) return same;
    const c = {
      id: newId(), key: t.key, updated: Date.now(),
      from, to, dep: +t.dep, arr: +t.arr, changes: t.changes, booking: t.booking,
      legs: t.legs.map(({ coords, ...l }) => ({
        ...l, dep: +l.dep, arr: +l.arr, planned: +l.planned, plannedArr: +l.plannedArr,
        stopList: l.stopList.map((s) => ({ ...s, time: s.time ? +s.time : null })),
        // Verlauf grob genug für die Karte, klein genug für den Speicher
        coords: thin(coords, 120),
      })),
    };
    d.connections.push(c);
    write(d);
    return c;
  },
  remove: (id) => remove('connections', id),
  /** Aus dem Ordner (data/folder.js) – ohne erneuten Abgleich */
  putQuiet(c) {
    const d = read();
    d.connections = [...d.connections.filter((x) => x.id !== c.id), c];
    write(d, { sync: false });
  },
  removeQuiet(id) {
    const d = read();
    d.connections = d.connections.filter((x) => x.id !== id);
    write(d, { sync: false });
  },
};

export const DEFAULT_LIST = 'Allgemein';
const fixed = (kind) => kind === 'home' || kind === 'work';

export const places = {
  all: () => read().places,
  byKind: (kind) => read().places.filter((p) => p.kind === kind),
  /** Namen aller Listen – „Allgemein“ zuerst */
  lists() {
    const names = new Set(read().places.filter((p) => !fixed(p.kind)).map((p) => p.list || DEFAULT_LIST));
    return [DEFAULT_LIST, ...[...names].filter((n) => n !== DEFAULT_LIST).sort((a, b) => a.localeCompare(b, 'de'))];
  },
  /** Orte einer Liste (ohne Zuhause/Arbeit) */
  inList: (list) => read().places.filter((p) => !fixed(p.kind) && (p.list || DEFAULT_LIST) === list),
  /** Zuhause/Arbeit gibt es nur einmal – neu setzen ersetzt. `name` darf frei sein („Oma“, „Verein“ …) */
  save({ kind = 'fav', name, label = '', point, ifopt = '', list = DEFAULT_LIST }) {
    const d = read();
    const at = (p) => Math.abs(p.point[0] - point[0]) < 1e-5 && Math.abs(p.point[1] - point[1]) < 1e-5;
    const old = d.places.find((p) => (fixed(kind) ? p.kind === kind : at(p) && p.kind === kind));
    const p = { id: old?.id ?? newId(), kind, name, label, point, ifopt, ...(fixed(kind) ? {} : { list: list || DEFAULT_LIST }), updated: Date.now() };
    d.places = [...d.places.filter((x) => x !== old), p];
    write(d);
    return p;
  },
  find: (point, kind = null) => read().places.find((p) => (!kind || p.kind === kind)
    && Math.abs(p.point[0] - point[0]) < 1e-4 && Math.abs(p.point[1] - point[1]) < 1e-4) ?? null,
  remove: (id) => remove('places', id),
  rename(id, name, label = null) {
    return this.update(id, { name, ...(label !== null ? { label } : {}) });
  },
  /** Name, Liste … ändern */
  update(id, changes) {
    const d = read();
    const p = d.places.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, changes, { updated: Date.now() });
    write(d);
    return p;
  },
  /** Eine ganze (geteilte) Liste übernehmen – was schon da ist, bleibt einmal → Anzahl neu */
  addList(list, items) {
    let n = 0;
    for (const x of items) {
      if (this.find(x.point)) continue;
      this.save({ kind: 'fav', name: x.name, label: x.label ?? '', point: x.point, list });
      n += 1;
    }
    return n;
  },
};

function thin(coords, max) {
  if (coords.length <= max) return coords.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
}

/* ── Abgleich mit dem Ordner (data/folder.js) ─────────────────────────────────── */

const mergeBy = (deleted) => (a, b) => {
  const by = new Map();
  for (const x of [...a, ...b]) if (!deleted[x.id] && (!by.has(x.id) || (x.updated ?? 0) > (by.get(x.id).updated ?? 0))) by.set(x.id, x);
  return [...by.values()];
};

/**
 * Lesezeichen.json (JSON-Text oder null) mit den eigenen Orten zusammenführen
 * → { text, changed (Datei neu schreiben) }
 */
export function mergePlaces(text) {
  const mine = read();
  let theirs = { places: [], deleted: {} };
  try { if (text) theirs = { ...theirs, ...JSON.parse(text) }; } catch { /* kaputte Datei: neu schreiben */ }
  const deleted = { ...theirs.deleted, ...mine.deleted };
  for (const [id, at] of Object.entries(deleted)) if (Date.now() - at > 365 * 864e5) delete deleted[id];
  const places = mergeBy(deleted)(mine.places, theirs.places ?? []);
  // Gelöschtes bleibt ein Jahr stehen – auch wenn es gerade niemand mehr hat: Ein Gerät, das
  // erst später abgleicht (oder die Karte im Auto, data/car-share.js), hat den Ort sonst noch
  // und brächte ihn zurück
  const next = JSON.stringify({ app: 'WMap', places, deleted }, null, 1);
  if (JSON.stringify(places) !== JSON.stringify(mine.places) || JSON.stringify(deleted) !== JSON.stringify(mine.deleted)) {
    write({ ...mine, places, deleted }, { sync: false });
  }
  return { text: next, changed: next !== text };
}

/** Alte „Gemerkt.json“ (bis 1.0: Verbindungen und Orte in einer Datei) übernehmen */
export function mergeSaved(text) {
  const mine = read();
  let theirs = { connections: [], places: [], deleted: {} };
  try { if (text) theirs = { ...theirs, ...JSON.parse(text) }; } catch { /* kaputte Datei: neu schreiben */ }
  const deleted = { ...theirs.deleted, ...mine.deleted };
  // Löschungen älter als ein Jahr vergessen
  for (const [id, at] of Object.entries(deleted)) if (Date.now() - at > 365 * 864e5) delete deleted[id];
  const merge = (a, b) => {
    const by = new Map();
    for (const x of [...a, ...b]) if (!deleted[x.id] && (!by.has(x.id) || (x.updated ?? 0) > (by.get(x.id).updated ?? 0))) by.set(x.id, x);
    return [...by.values()];
  };
  const out = { connections: merge(mine.connections, theirs.connections ?? []), places: merge(mine.places, theirs.places ?? []), deleted };
  const next = JSON.stringify({ app: 'WMap', ...out }, null, 1);
  const changedHere = JSON.stringify(out) !== JSON.stringify(mine);
  if (changedHere) write(out, { sync: false });
  return { text: next, changed: next !== text, changedHere };
}
