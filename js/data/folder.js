/**
 * Ordner verbinden: alles, was du in WMap anlegst, liegt als Datei in einem
 * Ordner, den ein Sync-Programm abgleicht – Nextcloud, Proton Drive, Google
 * Drive, Syncthing … Jede WMap, die denselben Ordner verbindet, liest ihn
 * ein und gleicht mit ab: dieselben Daten auf mehreren Geräten, ohne Konto
 * und ohne Server.
 *
 *   WMap/settings.json                     Einstellungen (Hell/dunkel, Navigation …)
 *   WMap/Geplante Touren/Harzer Hexenstieg.gpx
 *   WMap/Aufgezeichnete Touren/2026/09 September/2026-09-27 Radtour am Samstag….gpx
 *   WMap/Bus & Bahn/2026-09-30 08.15 Göttingen → Kassel.json   je gemerkte Verbindung
 *   WMap/Lesezeichen.json                  Zuhause, Arbeit, Lesezeichen
 *   WMap/Gelöscht.json                     was auf einem Gerät gelöscht wurde (ein Jahr)
 *   WMap/Kartenausschnitt.json             wo die Karte zuletzt stand (readView/writeView)
 *
 * Heißt der verbundene Ordner selbst „WMap“, entfällt die Ebene. Dateien aus
 * der alten Ordnung (Geplant/, Abgeschlossen/, Gemerkt.json) ziehen beim
 * Abgleich um. Dieselbe Ordnung hat der Export als ZIP (zipBackup).
 *
 * GPX-Dateien von woanders (Garmin, Komoot-Export …) dürfen irgendwo im
 * Ordner liegen: mit Zeiten werden sie ein Weg, sonst eine Tour.
 *
 * Abgleich (je Datei, erkannt am Stichwort „wmap:ID“, an der ID im JSON
 * oder am Pfad):
 *   nur im Ordner       → übernehmen
 *   nur in WMap         → Datei schreiben – oder, wenn die Datei schon mal da
 *                         war und im Ordner gelöscht wurde, auch hier löschen
 *   beides geändert     → das Neuere gewinnt
 *   in WMap gelöscht    → Datei löschen und in Gelöscht.json eintragen
 *   in Gelöscht.json    → auch hier löschen, nie wieder schreiben – so weiß
 *                         es jedes Gerät, auch eins, das noch nie oder lange
 *                         nicht abgeglichen hat (sonst schriebe es die Datei
 *                         mit seinem alten Stand zurück)
 * Derselbe Weg zweimal (in einer neuen App schon aus Health Connect geholt,
 * im Ordner noch mit der ID der alten App): bleibt einmal, mit der ID aus dem
 * Ordner.
 * Geändert heißt: andere Änderungszeit und anderer Inhalt als beim letzten
 * Abgleich (manche Cloud-Ordner unter Android melden keine Zeit).
 *
 * Zugang zum Ordner:
 *   Browser   File System Access API (Chrome und Edge, Rechner und Android)
 *   App       Tauri-Plugin „folder“ (src-tauri/plugins/folder): Android über
 *             den Speicherzugriff des Systems, am Rechner ein Ordnerdialog –
 *             das WebView der App kennt die API von Chrome nicht
 * Ohne beides bleiben Einlesen, Teilen und die ZIP-Sicherung (pages/sync.js).
 */
import { store } from './db.js';
import { tracks, trackGpx, parseGpx, sameTrack, backup, restore } from './tracks.js';
import { makeZip, readZip } from './zip.js';
import { tours, toGpx, coordsOf, shapeOf, local } from './store.js';
import { simplifyTo, distance } from '../core/geo.js';
import { connections, mergePlaces, mergeSaved } from './saved.js';

const kv = store('kv');
const KEY = 'folder';
const DELETED = 'wmap.folder.deleted';   // in WMap gelöscht, Datei noch löschen
const GONE_KEEP_MS = 365 * 24 * 3600 * 1000;   // so lange steht Gelöschtes in Gelöscht.json
const REVIVED = 'wmap.folder.revived';   // gelöscht, dann hier wieder angelegt (ZIP, Import) – gilt wieder
const AUTO = 'wmap.sync.auto';            // 'off' | 'start' (beim Öffnen und nach Änderungen) | 'every30' (dazu alle 30 min)

const core = typeof window !== 'undefined' ? window.__TAURI__?.core : null;
const nativeHere = !!core;
const browserHere = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let conf = null;          // { id, native?, handle?, name, index: { pfad: { id, kind, at, hash, rev } }, last, result, error, pending }
let syncing = null;
let progress = null;      // { i, n, since } während des Abgleichs
let syncTracks = null;    // alle Wege, einmal je Abgleich geladen (Doppelte erkennen)
let testBackend = null;   // nur für Tests: ein Ordner im Speicher
const VIEW_FILE = 'Kartenausschnitt.json';
const VIEW_EVERY_MS = 2 * 60 * 1000;
let viewWritten = 0, viewText = null;

async function load() {
  if (testBackend) return conf;
  conf = (await kv.get(KEY).catch(() => null)) ?? null;
  // App: Ordner im Plugin gewählt, aber hier nie angekommen (die Antwort des
  // Ordnerdialogs ging unterwegs verloren) – dann jetzt übernehmen
  if (!conf && nativeHere) {
    const i = await core.invoke('plugin:folder|info').catch(() => null);
    if (i?.connected) {
      conf = { id: KEY, native: true, name: i.name ?? 'Ordner', index: {}, last: null, result: null, error: null };
      await kv.put(conf).catch(() => {});
    }
  }
  // Eintrag ohne Ordner-Zugriff (z. B. aus einer Android-Sicherung wiederhergestellt –
  // den Zugriff selbst stellt niemand wieder her): gilt als nicht verbunden
  if (conf && !conf.native && typeof conf.handle?.entries !== 'function') {
    conf = null;
    await kv.remove(KEY).catch(() => {});
  }
  return conf;
}
const persist = () => (testBackend ? null : kv.put(conf));

/* ── Zugang: Browser-API oder App-Plugin ──────────────────────────────────── */

const call = (cmd, args = {}) => core.invoke(`plugin:folder|${cmd}`, args);

/** In der App: das Plugin „folder“ */
const nativeBackend = {
  permission: async () => ((await call('info')).connected ? 'granted' : 'gone'),
  list: async () => (await call('list')).files.map((f) => ({ path: f.path, lastModified: f.modified || 0 })),
  read: async (path) => (await call('read', { path })).text,
  write: async (path, text) => (await call('write', { path, text })).modified || 0,
  remove: (path) => call('remove', { path }).catch(() => {}),
};

/** Im Browser: ein Ordner-Handle (File System Access API) */
function handleBackend(root) {
  const dirOf = async (path, create) => {
    const parts = path.split('/');
    const name = parts.pop();
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return [dir, name];
  };
  return {
    async permission(ask) {
      if (!root?.queryPermission) return 'granted';
      const opts = { mode: 'readwrite' };
      let p = await root.queryPermission(opts);
      if (p === 'prompt' && ask) p = await root.requestPermission(opts);
      return p;
    },
    async list() {
      const out = [];
      const walk = async (dir, prefix, depth) => {
        for await (const [name, h] of dir.entries()) {
          if (name.startsWith('.')) continue;
          const path = prefix + name;
          if (h.kind === 'directory') { if (depth < 5) await walk(h, `${path}/`, depth + 1); }
          else if (/\.(gpx|json)$/i.test(name)) out.push({ path, lastModified: (await h.getFile()).lastModified });
        }
      };
      await walk(root, '', 0);
      return out;
    },
    async read(path) {
      const [dir, name] = await dirOf(path, false);
      return (await (await dir.getFileHandle(name)).getFile()).text();
    },
    async write(path, text) {
      const [dir, name] = await dirOf(path, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return (await fh.getFile()).lastModified;
    },
    async remove(path) {
      try { const [dir, name] = await dirOf(path, false); await dir.removeEntry(name); } catch { /* schon weg */ }
    },
  };
}

const backendOf = (c) => testBackend ?? (c.native ? nativeBackend : handleBackend(c.handle));

/* ── Verbinden, Stand ─────────────────────────────────────────────────────── */

export const folder = {
  /** Geht hier ein Ordner? (App immer, Browser nur Chrome/Edge) */
  supported: nativeHere || browserHere,

  /** Selbst abgleichen: 'off', 'start' (beim Öffnen und nach Änderungen, Standard), 'every30' (dazu alle 30 min) */
  get auto() { const v = local.get(AUTO, 'start'); return v === true ? 'start' : v === false ? 'off' : v; },
  set auto(v) { local.set(AUTO, v); },

  /** Läuft gerade ein Abgleich? */
  get busy() { return !!syncing; },

  /** Wie weit? { i, n, since } – Dateien bzw. Einträge, seit wann (ms) – oder null */
  get progress() { return progress; },

  /** Stand für die Anzeige: { connected, name, permission, last, result, error, pending } */
  async info() {
    const c = await load();
    if (!c) return { connected: false };
    const permission = await backendOf(c).permission(false).catch(() => 'gone');
    if (permission === 'gone') { await this.disconnect(); return { connected: false }; }
    return { connected: true, name: c.name, permission, last: c.last ?? null, result: c.result ?? null, error: c.error ?? null, pending: !!c.pending };
  },

  /** Ordner auswählen (braucht einen Klick) und gleich abgleichen. */
  async connect() {
    if (nativeHere) {
      let r;
      try { r = await call('pick'); } catch (err) {
        if (/abgebrochen|cancel/i.test(String(err))) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
        throw new Error(String(err?.message ?? err));
      }
      conf = { id: KEY, native: true, name: r.name ?? 'Ordner', index: {}, last: null, result: null, error: null };
    } else {
      const handle = await window.showDirectoryPicker({ id: 'wmap', mode: 'readwrite', startIn: 'documents' });
      conf = { id: KEY, handle, name: handle.name, index: {}, last: null, result: null, error: null };
    }
    await persist();
    local.set(DELETED, []);
    return this.sync({ interactive: true });
  },

  async disconnect() {
    if (conf?.native || nativeHere) await call('disconnect').catch(() => {});
    conf = null;
    await kv.remove(KEY);
    local.set(DELETED, []);
    dispatchEvent(new CustomEvent('wmap:folder', { detail: { disconnected: true } }));
  },

  /**
   * Abgleichen. Ohne `interactive` nur, wenn das Recht noch gilt – sonst
   * { needsPermission: true } (der Browser fragt nur nach einem Klick).
   * → { imported, written, removed, moved } oder null (nicht verbunden)
   */
  async sync({ interactive = false } = {}) {
    if (syncing) return syncing;
    syncing = run(interactive).finally(() => { syncing = null; });
    dispatchEvent(new CustomEvent('wmap:folder-progress', { detail: { busy: true } }));
    return syncing;
  },

  /**
   * Letzter Kartenausschnitt über den Ordner (WMap/Kartenausschnitt.json) –
   * beim Start der Karte gleich gelesen, ohne den ganzen Abgleich; nur ohne
   * Rückfrage (im Browser also nur, wenn das Recht noch gilt). → { center, zoom, pitch, bearing, at } | null
   */
  async readView() {
    const c = await load();
    if (!c) return null;
    const be = backendOf(c);
    if (await be.permission(false).catch(() => 'gone') !== 'granted') return null;
    try {
      const v = JSON.parse(await be.read(`${baseOf(c.name)}${VIEW_FILE}`));
      return Array.isArray(v?.center) && Number.isFinite(v.zoom) && Number.isFinite(v.at) ? v : null;
    } catch { return null; }
  },

  /**
   * Ausschnitt in den Ordner – beim Verlassen der Karte (`now`) bzw. höchstens
   * alle 2 Minuten, damit der Cloud-Ordner nicht bei jeder Bewegung hochlädt.
   */
  async writeView(view, { now = false } = {}) {
    if (!view || (!now && Date.now() - viewWritten < VIEW_EVERY_MS)) return false;
    const text = JSON.stringify({ app: 'WMap', ...view }, null, 1);
    if (text === viewText) return false;
    const c = await load();
    if (!c) return false;
    const be = backendOf(c);
    if (await be.permission(false).catch(() => 'gone') !== 'granted') return false;
    viewWritten = Date.now();
    viewText = text;
    await be.write(`${baseOf(c.name)}${VIEW_FILE}`, text).catch(() => { viewText = null; });
    return true;
  },

  /** Tests: Ordner im Speicher statt echtem Ordner ({ list, read, write, remove }) */
  _useBackend(backend, name = 'Test') {
    testBackend = backend;
    conf = { id: KEY, name, index: {}, last: null, result: null, error: null };
  },
};

/* ── Abgleich ─────────────────────────────────────────────────────────────── */

async function run(interactive) {
  const c = await load();
  if (!c) return null;
  const be = backendOf(c);
  if (await be.permission(interactive) !== 'granted') return { needsPermission: true };
  try {
    // Bis zum Ende „angefangen“: bricht er ab, macht die nächste Seite weiter
    if (!c.pending && !testBackend) { c.pending = true; await persist(); }
    const out = await syncAll(c, be);
    c.last = Date.now();
    c.result = out;
    c.error = null;
    c.pending = false;
    await persist();
    if (out.imported || out.removed || out.settings === 'imported') dispatchEvent(new CustomEvent('wmap:folder', { detail: out }));
    dispatchEvent(new CustomEvent('wmap:folder-progress', { detail: { done: true } }));
    return out;
  } catch (err) {
    c.error = { at: Date.now(), message: String(err?.message ?? err) };
    await persist();
    dispatchEvent(new CustomEvent('wmap:folder', { detail: { error: c.error } }));
    dispatchEvent(new CustomEvent('wmap:folder-progress', { detail: { done: true } }));
    throw err;
  } finally {
    progress = null;
    syncTracks = null;
  }
}

const rev = (item) => item.updated ?? item.created ?? 0;

/** Kurzer Fingerabdruck des Inhalts (FNV-1a) */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

async function syncAll(c, be) {
  const base = baseOf(c.name);
  const listed = await be.list();
  const at = (path) => listed.find((f) => f.path === path) ?? null;

  // Alte Ordnung: Gemerkt.json → Bus & Bahn/ und Lesezeichen.json
  const legacy = at(`${base}Gemerkt.json`);
  if (legacy) mergeSaved(await be.read(legacy.path).catch(() => null));

  const files = listed.filter((f) => /\.gpx$/i.test(f.path) || CONN_DIR.test(f.path));
  const locals = new Map();
  for (const t of await tracks.all()) locals.set(t.id, { kind: 'track', item: t });
  for (const t of tours.all()) locals.set(t.id, { kind: 'tour', item: t });
  for (const x of connections.all()) locals.set(x.id, { kind: 'conn', item: x });
  // Gelöscht: hier seit dem letzten Abgleich und auf allen Geräten (Gelöscht.json)
  const gonePath = `${base}Gelöscht.json`;
  const goneFile = at(gonePath);
  let goneThere = {};
  if (goneFile) { try { goneThere = JSON.parse(await be.read(gonePath)).deleted ?? {}; } catch { /* kaputt: neu schreiben */ } }
  const gone = { ...goneThere };
  for (const id of local.get(DELETED, []) ?? []) gone[id] ??= Date.now();
  for (const id of local.get(REVIVED, []) ?? []) delete gone[id];
  for (const [id, when] of Object.entries(gone)) if (Date.now() - when > GONE_KEEP_MS) delete gone[id];
  const deleted = new Set(Object.keys(gone));
  const index = c.index ?? {};
  const next = {};
  const seen = new Set();
  const used = new Set(files.map((f) => f.path.toLowerCase()));
  const out = { imported: 0, written: 0, removed: 0, moved: 0 };
  syncTracks = [...locals.values()].filter((e) => e.kind === 'track').map((e) => e.item);

  /*
   * Fortschritt melden und unterwegs speichern: Wer die Seite wechselt,
   * bricht den Abgleich ab – die nächste Seite macht dort weiter, statt
   * alle Dateien noch einmal zu lesen (Dateien im Index gelten als bekannt).
   */
  // Erst die Dateien; was danach noch zu schreiben ist, kommt am Ende dazu
  progress = { i: 0, n: files.length, since: Date.now() };
  let told = 0, saved = Date.now(), shown = 0;
  const step = async () => {
    progress.i += 1;
    const now = Date.now();
    if (now - told > 250 || progress.i === progress.n) {
      told = now;
      dispatchEvent(new CustomEvent('wmap:folder-progress', { detail: { ...progress } }));
    }
    if (now - saved > 2000) {
      saved = now;
      c.index = { ...index, ...next };
      c.pending = true;
      await persist();
      // Schon Übernommenes zeigen (Meine Touren), nicht erst am Ende
      if (out.imported > shown) {
        shown = out.imported;
        dispatchEvent(new CustomEvent('wmap:folder', { detail: { partial: true, imported: out.imported } }));
      }
    }
  };

  /**
   * Schreiben und merken. Liegt eine WMap-Datei (`move`) nicht, wo sie
   * hingehört, zieht sie um – fremde Dateien (Garmin-Export …) bleiben, wo sie sind.
   */
  const put = async (path, entry, text, move = true) => {
    const want = pathOf(entry.kind, entry.item, base);
    let target = path;
    if (!path || (move && dirname(path) !== dirname(want))) {
      target = freePath(want, used);
      used.add(target.toLowerCase());
    }
    const modified = await be.write(target, text);
    if (path && target !== path) { await be.remove(path); out.moved += 1; }
    next[target] = { id: entry.item.id, kind: entry.kind, at: modified, hash: hash(text), rev: rev(entry.item), ours: true };
    return target;
  };

  for (const f of files) {
    await step();
    const known = index[f.path] ?? null;
    const sameTime = known && f.lastModified && f.lastModified === known.at;
    let text = null;
    if (!sameTime) text = await be.read(f.path).catch(() => null);
    // Nicht lesbar (Cloud-Ordner hakt): bekannt bleibt bekannt – sonst hielte
    // das Gerät die Datei später für neu und schriebe sie nach dem Löschen zurück
    if (!sameTime && text === null) { if (known) next[f.path] = known; continue; }
    const id = (text !== null ? idIn(f.path, text) : null) ?? known?.id ?? null;
    // Von WMap geschrieben (mit ID) – nur solche Dateien ziehen um
    const ours = text !== null ? !!idIn(f.path, text) : !!known?.ours;
    if (id && deleted.has(id)) {
      await be.remove(f.path);
      out.removed += 1;
      continue;
    }
    if (id && seen.has(id)) continue;                 // Kopie derselben Datei
    const mine = id ? locals.get(id) : null;

    if (!mine) {
      const got = await importFile({ ...f, text }, id, null, index);
      if (got) {
        // Derselbe Weg war hier schon unter anderer ID (Health Connect): die aus dem Ordner gilt
        if (got.replaced) locals.delete(got.replaced);
        seen.add(got.id);
        if (!locals.has(got.id)) out.imported += 1;
        const entry = await entryOf(got.id);
        // Eigene Dateien (mit WMap-ID) ziehen in die neue Ordnung um; zusammengelegt
        // (Health Connect): neu schreiben, damit die Kennung auch im Ordner steht
        if (entry && ours && (got.replaced || dirname(f.path) !== dirname(pathOf(entry.kind, entry.item, base)))) {
          await put(f.path, entry, serialize(entry));
        } else next[f.path] = { id: got.id, kind: got.kind, at: f.lastModified, hash: hash(text), rev: got.rev, ours };
      }
      continue;
    }
    seen.add(id);
    const r = rev(mine.item);
    const h = text === null ? known.hash : hash(text);
    const mineText = serialize(mine);
    let fileNew, localNew;
    if (known) {
      fileNew = h !== known.hash;
      localNew = r !== known.rev;
    } else {
      // Noch nie abgeglichen (z. B. neues Gerät): gleich? Sonst zählt die Zeit
      const same = h === hash(mineText);
      fileNew = !same && f.lastModified > r + 60000;
      localNew = !same && !fileNew;
    }
    if (localNew && (!fileNew || r > f.lastModified)) {
      await put(f.path, mine, mineText, ours);
      out.written += 1;
    } else if (fileNew) {
      // Auf einem anderen Gerät geändert
      const got = await importFile({ ...f, text }, id, mine.item);
      const entry = await entryOf(id);
      if (entry && ours && dirname(f.path) !== dirname(pathOf(entry.kind, entry.item, base))) await put(f.path, entry, serialize(entry));
      else next[f.path] = { id, kind: mine.kind, at: f.lastModified, hash: h, rev: got?.rev ?? r, ours };
      out.imported += 1;
    } else if (ours && dirname(f.path) !== dirname(pathOf(mine.kind, mine.item, base))) {
      await put(f.path, mine, mineText);               // alte Ordnung → neue
    } else next[f.path] = { id, kind: mine.kind, at: f.lastModified, hash: h, rev: r, ours };
  }

  progress.n += [...locals.keys()].filter((id) => !seen.has(id)).length;
  for (const [id, entry] of locals) {
    if (seen.has(id)) continue;
    await step();
    if (deleted.has(id) || Object.values(index).some((v) => v.id === id)) {
      // Auf einem Gerät gelöscht bzw. war schon im Ordner und ist dort weg
      if (entry.kind === 'track') await tracks.removeQuiet(id);
      else if (entry.kind === 'conn') connections.removeQuiet(id);
      else tourRemoveQuiet(id);
      out.removed += 1;
      continue;
    }
    await put(null, entry, serialize(entry));
    out.written += 1;
  }

  // Lesezeichen: eine Datei, je Eintrag gewinnt das Neuere
  const bmPath = `${base}Lesezeichen.json`;
  const bm = at(bmPath);
  const merged = mergePlaces(bm ? await be.read(bmPath).catch(() => null) : null);
  if (merged.changed) await be.write(bmPath, merged.text);

  out.settings = await syncSettings(c, be, at(`${base}settings.json`), `${base}settings.json`);
  if (JSON.stringify(gone) !== JSON.stringify(goneThere)) {
    await be.write(gonePath, JSON.stringify({ app: 'WMap', note: 'Auf einem Gerät gelöscht – nicht wieder anlegen', deleted: gone }, null, 1));
  }
  if (legacy) await be.remove(legacy.path);

  c.index = next;
  local.set(DELETED, []);
  local.set(REVIVED, []);
  return out;
}

/** Dateiinhalt → WMap-ID (GPX: Stichwort wmap:ID, Verbindung: id im JSON) */
function idIn(path, text) {
  if (!text) return null;
  if (/\.json$/i.test(path)) { try { return JSON.parse(text).id ?? null; } catch { return null; } }
  return text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? null;
}

async function entryOf(id) {
  const t = await tracks.get(id).catch(() => null);
  if (t) return { kind: 'track', item: t };
  const tour = tours.all().find((x) => x.id === id);
  if (tour) return { kind: 'tour', item: tour };
  const conn = connections.get(id);
  return conn ? { kind: 'conn', item: conn } : null;
}

/* Löschen ohne Meldung (sonst merkt sich der Abgleich es als „in WMap gelöscht“) */
const trackStore = store('tracks');
function tourRemoveQuiet(id) {
  const list = local.get('wmap.tours', []).filter((t) => t.id !== id);
  local.set('wmap.tours', list);
}

/* ── Einstellungen: settings.json ─────────────────────────────────────────── */

/** Was auf allen Geräten gleich sein soll – nicht: Konten, Verlauf, Kartenausschnitt */
const SETTINGS = [
  'wmap.theme', 'wmap.nav.zoom', 'wmap.nav.3d', 'wmap.voice', 'wmap.muted', 'wmap.offline', 'wmap.datasaver',
  'wmap.contribute', 'wmap.osm.anon', 'wmap.history', 'wmap.routePrefs', 'wmap.profile', 'wmap.myname',
  'wmap.lapsize', 'wmap.chart', 'wmap.tankerkoenig',
];

function snapshot() {
  const v = {};
  for (const k of SETTINGS) {
    try { const raw = localStorage.getItem(k); if (raw !== null) v[k] = raw; } catch { /* gesperrt */ }
  }
  return v;
}

/**
 * Hier geändert (seit dem letzten Abgleich) → Datei schreiben; nur dort
 * geändert → übernehmen. Beim ersten Abgleich eines Geräts gilt die Datei.
 * → 'imported' | 'written' | null
 */
async function syncSettings(c, be, file, path) {
  const mine = snapshot();
  const mineJson = JSON.stringify(mine);
  let theirs = null;
  if (file) { try { theirs = JSON.parse(await be.read(path)); } catch { /* kaputt: neu schreiben */ } }
  const localChanged = c.settingsSnap !== undefined && mineJson !== c.settingsSnap;
  if (theirs?.values && theirs.updated !== c.settingsAt && !localChanged) {
    for (const [k, v] of Object.entries(theirs.values)) {
      if (SETTINGS.includes(k) && typeof v === 'string') { try { localStorage.setItem(k, v); } catch { /* gesperrt */ } }
    }
    c.settingsSnap = JSON.stringify(snapshot());
    c.settingsAt = theirs.updated;
    return 'imported';
  }
  if (!theirs?.values || localChanged) {
    const updated = Date.now();
    await be.write(path, JSON.stringify({ app: 'WMap', updated, values: mine }, null, 1));
    c.settingsAt = updated;
    c.settingsSnap = mineJson;
    return 'written';
  }
  c.settingsSnap = mineJson;
  return null;
}

/* ── Pfade ────────────────────────────────────────────────────────────────── */

const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ohne Namen';
const pad = (x) => String(x).padStart(2, '0');
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const dirname = (p) => p.slice(0, p.lastIndexOf('/') + 1);

// Neue und alte Ordnung (bis 1.0: Geplant/, Abgeschlossen/<Jahr>/)
const TOUR_DIR = /(^|\/)(Geplante Touren|Geplant)\//;
const TRACK_DIR = /(^|\/)(Aufgezeichnete Touren|Abgeschlossen)\//;
const CONN_DIR = /(^|\/)Bus & Bahn\/[^/]+\.json$/i;

/** Ordner „WMap“ im verbundenen Ordner – außer er heißt schon so */
const baseOf = (name) => (/^wmap$/i.test(name ?? '') ? '' : 'WMap/');

function pathOf(kind, item, base = 'WMap/') {
  if (kind === 'track') {
    const d = new Date(item.start);
    return `${base}Aufgezeichnete Touren/${d.getFullYear()}/${pad(d.getMonth() + 1)} ${MONTHS[d.getMonth()]}/${day(item.start)} ${clean(item.name || 'Weg')}.gpx`;
  }
  if (kind === 'conn') {
    const d = new Date(item.dep);
    const name = [item.from?.label, item.to?.label].map((x) => String(x ?? '').split(',')[0]).join(' → ');
    return `${base}Bus & Bahn/${day(item.dep)} ${pad(d.getHours())}.${pad(d.getMinutes())} ${clean(name)}.json`;
  }
  return `${base}Geplante Touren/${clean(item.name || 'Tour')}.gpx`;
}

/** Gleicher Name schon vergeben? → „… (2).gpx“ */
function freePath(path, used) {
  if (!used.has(path.toLowerCase())) return path;
  for (let n = 2; ; n += 1) {
    const p = path.replace(/(\.\w+)$/, ` (${n})$1`);
    if (!used.has(p.toLowerCase())) return p;
  }
}

/* ── Dateien hin und her ──────────────────────────────────────────────────── */

function serialize({ kind, item }) {
  if (kind === 'track') return trackGpx(item);
  if (kind === 'conn') return JSON.stringify({ app: 'WMap', kind: 'connection', ...item }, null, 1);
  return toGpx(item, coordsOf(item.shape), () => null);
}

/**
 * Datei → Weg, Tour oder Verbindung. Unter „Aufgezeichnete Touren/“ immer ein
 * Weg, unter „Geplante Touren/“ eine Tour, unter „Bus & Bahn/“ eine
 * Verbindung, sonst: mit Zeitstempeln ein Weg. → { id, kind, rev } oder null
 */
async function importFile(f, id, before = null, index = {}) {
  try {
    if (CONN_DIR.test(f.path)) {
      const c = JSON.parse(f.text);
      if (!c?.id || !Array.isArray(c.legs)) return null;
      const { app: _a, kind: _k, ...conn } = c;
      const item = { ...conn, updated: conn.updated ?? f.lastModified };
      connections.putQuiet(item);
      return { id: item.id, kind: 'conn', rev: item.updated };
    }
    const isTour = before ? !('start' in before) : TOUR_DIR.test(f.path) ? true : TRACK_DIR.test(f.path) ? false : !/<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/.test(f.text);
    if (isTour) {
      const t = tourFromGpx(f.text, f.path);
      if (!t) return null;
      // Ordner neu verbunden: dieselbe Tour nicht doppelt
      // gleicher Verlauf und gleicher Name – nur der Verlauf wäre zu grob (dieselbe Runde zweimal geplant)
      const twin = !before && !id && tours.all().find((x) => x.shape === t.shape && x.name === t.name);
      if (twin) return { id: twin.id, kind: 'tour', rev: rev(twin) };
      const tour = { ...t, id: id ?? before?.id ?? tours.newId(), created: before?.created ?? f.lastModified, updated: f.lastModified || Date.now(), preview: before?.shape === t.shape ? before.preview : null };
      tours.put(tour);
      return { id: tour.id, kind: 'tour', rev: tour.updated };
    }
    const [t] = parseGpx(f.text);
    if (!t) return null;
    const all = syncTracks ?? await tracks.all();
    const twin = !before && all.find((x) => x.id !== id && sameTrack(x, t));
    // Ohne ID (fremde Datei) bzw. der Zwilling liegt selbst schon im Ordner: bleibt der Zwilling
    if (twin && (!id || Object.values(index).some((v) => v.id === twin.id))) return { id: twin.id, kind: 'track', rev: rev(twin) };
    if (twin) {
      // Hier neu (z. B. aus Health Connect), im Ordner mit ID von woanders: dieselbe
      // Aufzeichnung – sie übernimmt die ID aus dem Ordner, Name und Messwerte von hier bleiben
      const track = { ...t, ...twin, id, source: { ...t.source, ...twin.source }, updated: f.lastModified || Date.now() };
      await trackStore.remove(twin.id);
      await tracks.putQuiet(track);
      if (syncTracks) syncTracks.splice(syncTracks.indexOf(twin), 1, track);
      return { id, kind: 'track', rev: track.updated, replaced: twin.id };
    }
    const source = before?.source || t.source ? { ...before?.source, ...t.source } : undefined;
    const track = { ...before, ...t, id: id ?? before?.id ?? t.id, ...(source ? { source } : {}), updated: f.lastModified || Date.now() };
    await tracks.putQuiet(track);
    syncTracks?.push(track);
    return { id: track.id, kind: 'track', rev: track.updated };
  } catch { return null; }
}

/** GPX → Tour: Verlauf aus dem Track, die gesetzten Punkte aus den Wegpunkten */
export function tourFromGpx(text, path = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const pts = [...doc.querySelectorAll('trkpt, rtept')];
  if (pts.length < 2) return null;
  const coords = pts.map((p) => [+p.getAttribute('lon'), +p.getAttribute('lat')]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const ele = pts.map((p) => parseFloat(p.querySelector('ele')?.textContent ?? ''));
  let length = 0, ascent = 0, descent = 0, last = null;
  for (let i = 1; i < coords.length; i += 1) length += distance(coords[i - 1], coords[i]);
  for (const e of ele) {
    if (!Number.isFinite(e)) continue;
    // Kleine Schwankungen (Messrauschen) nicht mitzählen
    if (last === null) last = e;
    else if (e - last > 3) { ascent += e - last; last = e; } else if (last - e > 3) { descent += last - e; last = e; }
  }
  const keywords = doc.querySelector('metadata > keywords')?.textContent ?? '';
  const wpts = [...doc.querySelectorAll('gpx > wpt')].map((p) => [+p.getAttribute('lon'), +p.getAttribute('lat')]);
  const ours = /\bwmap:/.test(keywords);
  const fixed = !ours || /\bwmap-fixed\b/.test(keywords) || wpts.length < 2;
  const trk = doc.querySelector('trk, rte');
  const name = doc.querySelector('metadata > name')?.textContent?.trim() || trk?.querySelector(':scope > name')?.textContent?.trim()
    || path.split('/').pop().replace(/\.gpx$/i, '');
  const type = trk?.querySelector(':scope > type')?.textContent?.trim();
  return {
    name, description: doc.querySelector('metadata > desc')?.textContent?.trim() ?? '',
    profile: ['hike', 'walk', 'road', 'tour', 'gravel', 'mtb', 'drive'].includes(type) ? type : 'hike',
    points: fixed ? simplifyTo(coords, 20) : wpts, shape: shapeOf(coords), fixed,
    stats: { length: Math.round(length), time: null, ascent: Math.round(ascent), descent: Math.round(descent) },
  };
}

/* ── Automatisch: nach Änderungen kurz warten, dann abgleichen ────────────── */

let timer = null;
addEventListener('wmap:data', (e) => {
  const id = e.detail?.id;
  if (id && e.detail.removed) local.set(DELETED, [...new Set([...local.get(DELETED, []), id])]);
  // Wieder angelegt (ZIP einspielen, Import, Bearbeiten): nicht mehr als gelöscht führen
  else if (id) {
    local.set(DELETED, (local.get(DELETED, []) ?? []).filter((x) => x !== id));
    local.set(REVIVED, [...new Set([...(local.get(REVIVED, []) ?? []), id])].slice(-500));
  }
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await syncing?.catch(() => {});
    if (!await load()) { local.set(DELETED, []); return; }
    if (folder.auto !== 'off') folder.sync().catch(() => { /* steht als Fehler auf der Seite „Sicherung & Synchronisation“ */ });
  }, 2500);
});

/* ── Ohne Ordner-Zugriff (Firefox, Safari): Dateien laden und teilen ──────── */

/**
 * GPX-Dateien einlesen – einzeln oder ein ganzer Ordner (<input webkitdirectory>).
 * Was es schon gibt (gleiche WMap-ID oder gleicher Weg), bleibt einmal.
 * → { imported, skipped }
 */
export async function importLoose(fileList) {
  const known = new Set([...(await tracks.all()).map((t) => t.id), ...tours.all().map((t) => t.id)]);
  const all = await tracks.all();
  const out = { imported: 0, skipped: 0 };
  for (const file of fileList) {
    if (!/\.gpx$/i.test(file.name)) continue;
    const text = await file.text();
    const wmapId = text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? null;
    if (wmapId && known.has(wmapId)) { out.skipped += 1; continue; }
    const path = (file.webkitRelativePath || file.name).split('/').slice(file.webkitRelativePath ? 1 : 0).join('/');
    const probe = /<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/.test(text) && !TOUR_DIR.test(path) ? parseGpx(text)[0] : null;
    if (probe && all.some((t) => sameTrack(t, probe))) { out.skipped += 1; continue; }
    const got = await importFile({ path, text, lastModified: file.lastModified }, wmapId);
    if (got) { known.add(got.id); out.imported += 1; if (probe) all.push(probe); }
  }
  if (out.imported) dispatchEvent(new CustomEvent('wmap:folder', { detail: out }));
  return out;
}

/**
 * Einmal aus einem Ordner importieren, ohne ihn zu verbinden. Browser: die
 * Dateien aus <input webkitdirectory>; App (ohne `fileList`): Ordnerdialog
 * über das Plugin, eigener Platz „import“, danach wieder freigegeben.
 * Liegt eine wmap-sicherung.json darin (ausgepackter Export), kommt alles
 * daraus, sonst die GPX-Dateien. → { imported, skipped }
 */
export async function importFolder(fileList = null) {
  if (fileList) return importFrom([...fileList]);
  let picked;
  try { picked = await call('pick', { slot: 'import' }); } catch (err) {
    if (/abgebrochen|cancel/i.test(String(err))) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
    throw new Error(String(err?.message ?? err));
  }
  try {
    const { files } = await call('list', { slot: 'import' });
    return await importFrom(files.map((f) => ({
      name: f.path.split('/').pop(),
      webkitRelativePath: `${picked.name ?? 'Ordner'}/${f.path}`,
      lastModified: f.modified || Date.now(),
      text: async () => (await call('read', { slot: 'import', path: f.path })).text,
    })));
  } finally {
    await call('disconnect', { slot: 'import' }).catch(() => {});
  }
}

async function importFrom(files) {
  const full = files.find((f) => /^wmap-sicherung[^/]*\.json$/i.test(f.name));
  if (full) {
    const n = await restore(await full.text());
    dispatchEvent(new CustomEvent('wmap:folder', { detail: { imported: n } }));
    return { imported: n, skipped: 0 };
  }
  return importLoose(files);
}

/* ── Export als ZIP: dieselbe Ordnung wie im verbundenen Ordner ───────────── */

/**
 * Geplante und aufgezeichnete Touren als GPX, Bus & Bahn und Lesezeichen als
 * JSON, dazu die vollständige Sicherung (WMap/wmap-sicherung.json – mit allem,
 * was die Dateien nicht fassen). → Blob
 */
export async function zipBackup() {
  const used = new Set();
  const entry = (kind, item) => {
    const path = freePath(pathOf(kind, item), used);
    used.add(path.toLowerCase());
    return { path, data: serialize({ kind, item }), date: new Date(item.updated ?? item.created ?? item.start ?? Date.now()) };
  };
  const files = [
    ...tours.all().map((t) => entry('tour', t)),
    ...(await tracks.all()).map((t) => entry('track', t)),
    ...connections.all().map((x) => entry('conn', x)),
    { path: 'WMap/Lesezeichen.json', data: mergePlaces(null).text, date: new Date() },
    { path: 'WMap/wmap-sicherung.json', data: await backup(), date: new Date() },
  ];
  return makeZip(files);
}

/**
 * ZIP einspielen: mit wmap-sicherung.json alles daraus, sonst die GPX-Dateien
 * (auch ein gezippter Ordner von woanders). → Anzahl übernommen
 */
export async function restoreZip(file) {
  const entries = await readZip(file);
  const json = entries.find((e) => /(^|\/)wmap-sicherung[^/]*\.json$/i.test(e.path));
  if (json) return restore(await json.text());
  const gpx = await Promise.all(entries.filter((e) => /\.gpx$/i.test(e.path)).map(async (e) => {
    const text = await e.text();
    return { name: e.path.split('/').pop(), webkitRelativePath: e.path.includes('/') ? e.path : '', lastModified: Date.now(), text: async () => text };
  }));
  return (await importLoose(gpx)).imported;
}

/** „3 übernommen, 2 gespeichert“ */
export function syncSummary(r) {
  if (!r) return '';
  const parts = [r.imported && `${r.imported} übernommen`, r.written && `${r.written} gespeichert`, r.removed && `${r.removed} gelöscht`,
    r.moved && `${r.moved} umgezogen`, r.settings === 'imported' && 'Einstellungen übernommen'].filter(Boolean);
  return parts.length ? parts.join(', ') : 'alles aktuell';
}

/** Still abgleichen – wenn verbunden, erlaubt und je nach Einstellung (`periodic`: der 30-Minuten-Takt) */
export async function autoFolderSync({ periodic = false } = {}) {
  const mode = folder.auto;
  if (!folder.supported || (periodic && mode !== 'every30')) return null;
  const i = await folder.info().catch(() => null);
  if (!i?.connected || i.permission !== 'granted') return null;
  // Abgebrochen (Seite gewechselt): immer fertig machen, auch wenn „Aus“ gewählt ist
  if (mode === 'off' && !i.pending) return null;
  return folder.sync().catch(() => null);
}
