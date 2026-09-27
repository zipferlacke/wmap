/**
 * Ordner verbinden: Wege und Touren liegen als GPX-Dateien in einem Ordner,
 * den ein Sync-Programm mit der Cloud abgleicht – Nextcloud, Proton Drive,
 * Google Drive, Syncthing … WMap braucht dafür kein Konto und keinen Server,
 * es liest und schreibt nur Dateien.
 *
 *   WMap/Geplant/Harzer Hexenstieg.gpx                                  geplant
 *   WMap/Abgeschlossen/2026/2026-09-27 Radtour am Samstagnachmittag.gpx  gefahren/gelaufen
 *
 * Heißt der verbundene Ordner selbst „WMap“, entfällt die Ebene. Dateien der
 * früheren Ordnung (Touren/, Wege/<Jahr>/) zieht der nächste Abgleich um.
 * Dieselbe Ordnung hat die Sicherung als ZIP (zipBackup).
 *
 * GPX-Dateien von woanders (Garmin, Komoot-Export …) dürfen irgendwo im
 * Ordner liegen: mit Zeiten werden sie ein Weg, sonst eine Tour.
 *
 * Abgleich (je Datei, erkannt am Stichwort „wmap:ID“ oder am Pfad):
 *   nur im Ordner       → übernehmen
 *   nur in WMap         → Datei schreiben – oder, wenn die Datei schon mal da
 *                         war und im Ordner gelöscht wurde, auch hier löschen
 *   beides geändert     → das Neuere gewinnt
 *   in WMap gelöscht    → Datei löschen
 *
 * Braucht die File System Access API (Chrome und Edge, am Rechner und unter
 * Android). Ohne sie bleiben GPX-Import und Teilen (siehe wege-page.js).
 */
import { store } from './db.js';
import { tracks, trackGpx, parseGpx, sameTrack, backup, restore } from './tracks.js';
import { makeZip, readZip } from './zip.js';
import { tours, toGpx, coordsOf, shapeOf, local } from './store.js';
import { simplifyTo, distance } from './geo.js';

const kv = store('kv');
const KEY = 'folder';
const DELETED = 'wmap.folder.deleted';   // in WMap gelöscht, Datei noch löschen

export const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let conf = null;          // { id, handle, name, index: { pfad: { id, at } }, last, result }
let syncing = null;
let testHandle = null;    // nur für Tests: ein Ordner im Speicher
let autoSynced = false;   // beim Öffnen einer Seite einmal still abgleichen

async function load() {
  if (testHandle) return conf;
  conf = (await kv.get(KEY).catch(() => null)) ?? null;
  return conf;
}
const persist = () => (testHandle ? null : kv.put(conf));

/* ── Verbinden, Rechte ────────────────────────────────────────────────────── */

export const folder = {
  supported: folderSupported,

  /** Stand für die Anzeige: { connected, name, permission, last, result } */
  async info() {
    const c = await load();
    if (!c) return { connected: false };
    return { connected: true, name: c.name, permission: await permission(c.handle, false), last: c.last ?? null, result: c.result ?? null };
  },

  /** Ordner auswählen (braucht einen Klick) und gleich abgleichen. */
  async connect() {
    const handle = await window.showDirectoryPicker({ id: 'wmap', mode: 'readwrite', startIn: 'documents' });
    conf = { id: KEY, handle, name: handle.name, index: {}, last: null, result: null };
    await persist();
    local.set(DELETED, []);
    return this.sync({ interactive: true });
  },

  async disconnect() {
    conf = null;
    await kv.remove(KEY);
    local.set(DELETED, []);
  },

  /**
   * Abgleichen. Ohne `interactive` nur, wenn das Recht noch gilt – sonst
   * { needsPermission: true } (der Browser fragt nur nach einem Klick).
   * → { imported, written, removed } oder null (nicht verbunden)
   */
  async sync({ interactive = false } = {}) {
    if (syncing) return syncing;
    syncing = run(interactive).finally(() => { syncing = null; });
    return syncing;
  },

  /** Tests: Ordner im Speicher statt echtem Ordner */
  _useHandle(handle) {
    testHandle = handle;
    conf = { id: KEY, handle, name: handle.name, index: {}, last: null, result: null };
  },
};

async function permission(handle, ask) {
  if (!handle?.queryPermission) return 'granted';
  const opts = { mode: 'readwrite' };
  let p = await handle.queryPermission(opts);
  if (p === 'prompt' && ask) p = await handle.requestPermission(opts);
  return p;
}

/* ── Abgleich ─────────────────────────────────────────────────────────────── */

async function run(interactive) {
  const c = await load();
  if (!c) return null;
  if (await permission(c.handle, interactive) !== 'granted') return { needsPermission: true };

  const files = await listGpx(c.handle);
  const base = baseOf(c.handle);
  const locals = new Map();
  for (const t of await tracks.all()) locals.set(t.id, { kind: 'track', item: t });
  for (const t of tours.all()) locals.set(t.id, { kind: 'tour', item: t });
  const deleted = new Set(local.get(DELETED, []));
  const index = c.index ?? {};
  const next = {};
  const seen = new Set();
  const out = { imported: 0, written: 0, removed: 0 };

  for (const f of files) {
    const id = f.wmapId ?? (index[f.path]?.id || null);
    if (id && deleted.has(id)) {
      await removeFile(c.handle, f.path);
      out.removed += 1;
      continue;
    }
    if (id && seen.has(id)) continue;                 // Kopie derselben Datei
    const mine = id ? locals.get(id) : null;
    if (!mine) {
      const got = await importFile(f, id);
      if (got) {
        next[f.path] = { id: got.id, at: f.lastModified, rev: got.rev };
        seen.add(got.id);
        if (!locals.has(got.id)) out.imported += 1;
      }
      continue;
    }
    seen.add(id);
    // Frühere Ordnung (Touren/, Wege/<Jahr>/): an den neuen Platz umziehen
    if (OLD_LAYOUT.test(f.path)) {
      const path = freePath(pathOf(mine.kind, mine.item, base), new Set(Object.keys(next)), files);
      next[path] = { id, at: await writeFile(c.handle, path, gpxOf(mine)), rev: rev(mine.item) };
      await removeFile(c.handle, f.path);
      out.moved = (out.moved ?? 0) + 1;
      continue;
    }
    // Geändert heißt: seit dem letzten Abgleich – Datei an ihrer Zeit, WMap an „updated“.
    // So stören abweichende Uhren (Handy ↔ Rechner) nicht; nur wenn beide geändert sind, zählt die Zeit.
    const known = index[f.path]?.id === id ? index[f.path] : null;
    const r = rev(mine.item);
    const fileNew = known ? f.lastModified !== known.at : f.lastModified > r + 60000;
    const localNew = known ? r !== known.rev : r > f.lastModified + 60000;
    if (localNew && (!fileNew || r > f.lastModified)) {
      next[f.path] = { id, at: await writeFile(c.handle, f.path, gpxOf(mine)), rev: r };
      out.written += 1;
    } else if (fileNew) {
      // Auf einem anderen Gerät geändert
      const got = await importFile(f, id, mine.item);
      next[f.path] = { id, at: f.lastModified, rev: got?.rev ?? r };
      out.imported += 1;
    } else next[f.path] = { id, at: f.lastModified, rev: r };
  }

  const used = new Set(Object.keys(next));
  for (const [id, { kind, item }] of locals) {
    if (seen.has(id)) continue;
    const before = Object.entries(index).find(([, v]) => v.id === id);
    if (before) {
      // War schon im Ordner und ist dort weg: dort gelöscht
      if (kind === 'track') await trackStore.remove(id); else tourRemoveQuiet(id);
      out.removed += 1;
      continue;
    }
    const path = freePath(pathOf(kind, item, base), used, files);
    used.add(path);
    next[path] = { id, at: await writeFile(c.handle, path, gpxOf({ kind, item })), rev: rev(item) };
    out.written += 1;
  }

  if (out.moved) await dropEmptyOld(c.handle);
  c.index = next;
  c.last = Date.now();
  c.result = out;
  local.set(DELETED, []);
  await persist();
  if (out.imported || out.removed) dispatchEvent(new CustomEvent('wmap:folder', { detail: out }));
  return out;
}

const rev = (item) => item.updated ?? item.created ?? 0;

/* Löschen ohne Meldung (sonst merkt sich der Abgleich es als „in WMap gelöscht“) */
const trackStore = store('tracks');
function tourRemoveQuiet(id) {
  const list = local.get('wmap.tours', []).filter((t) => t.id !== id);
  local.set('wmap.tours', list);
}

/* ── Dateien ──────────────────────────────────────────────────────────────── */

/** Alle .gpx im Ordner (bis 4 Ebenen tief) → [{ path, handle, text, lastModified, wmapId }] */
async function listGpx(dir, prefix = '', depth = 0, out = []) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    const path = prefix + name;
    if (h.kind === 'directory') {
      if (depth < 4) await listGpx(h, `${path}/`, depth + 1, out);
    } else if (/\.gpx$/i.test(name)) {
      const file = await h.getFile();
      const text = await file.text();
      out.push({ path, text, lastModified: file.lastModified, wmapId: text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? null });
    }
  }
  return out;
}

async function dirOf(root, path, create) {
  const parts = path.split('/');
  const name = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return [dir, name];
}

/** Schreiben → Änderungszeit der Datei */
async function writeFile(root, path, text) {
  const [dir, name] = await dirOf(root, path, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return (await fh.getFile()).lastModified;
}

/** Leere Ordner der früheren Ordnung wegräumen (volle bleiben – removeEntry scheitert dann) */
async function dropEmptyOld(root) {
  for (const top of ['Wege', 'Touren']) {
    try {
      const dir = await root.getDirectoryHandle(top);
      for await (const [name, h] of dir.entries()) if (h.kind === 'directory') await dir.removeEntry(name).catch(() => {});
      await root.removeEntry(top);
    } catch { /* nicht da oder nicht leer */ }
  }
}

async function removeFile(root, path) {
  try {
    const [dir, name] = await dirOf(root, path, false);
    await dir.removeEntry(name);
  } catch { /* schon weg */ }
}

/* ── Pfade ────────────────────────────────────────────────────────────────── */

const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ohne Namen';
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const OLD_LAYOUT = /^(Wege|Touren)\//;
const TOUR_DIR = /(^|\/)(Geplant|Touren)\//;
const TRACK_DIR = /(^|\/)(Abgeschlossen|Wege)\//;

/** Ordner „WMap“ im verbundenen Ordner – außer er heißt schon so */
const baseOf = (handle) => (/^wmap$/i.test(handle?.name ?? '') ? '' : 'WMap/');

function pathOf(kind, item, base = 'WMap/') {
  if (kind === 'track') return `${base}Abgeschlossen/${new Date(item.start).getFullYear()}/${day(item.start)} ${clean(item.name || 'Weg')}.gpx`;
  return `${base}Geplant/${clean(item.name || 'Tour')}.gpx`;
}

/** Gleicher Name schon vergeben? → „… (2).gpx“ */
function freePath(path, used, files) {
  const taken = (p) => used.has(p) || files.some((f) => f.path.toLowerCase() === p.toLowerCase());
  if (!taken(path)) return path;
  for (let n = 2; ; n += 1) {
    const p = path.replace(/\.gpx$/, ` (${n}).gpx`);
    if (!taken(p)) return p;
  }
}

/* ── GPX hin und her ──────────────────────────────────────────────────────── */

function gpxOf({ kind, item }) {
  return kind === 'track' ? trackGpx(item) : toGpx(item, coordsOf(item.shape), () => null);
}

/**
 * Datei → Weg oder Tour. Unter Wege/ immer ein Weg, unter Touren/ eine Tour,
 * sonst: mit Zeitstempeln ein Weg. → { id, rev } oder null
 */
async function importFile(f, id, before = null) {
  const isTour = before ? !('start' in before) : TOUR_DIR.test(f.path) ? true : TRACK_DIR.test(f.path) ? false : !/<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/.test(f.text);
  try {
    if (isTour) {
      const t = tourFromGpx(f.text, f.path);
      if (!t) return null;
      // Ordner neu verbunden: dieselbe Tour nicht doppelt
      const twin = !before && !id && tours.all().find((x) => x.shape === t.shape);
      if (twin) return { id: twin.id, rev: rev(twin) };
      const tour = { ...t, id: id ?? before?.id ?? tours.newId(), created: before?.created ?? f.lastModified, updated: f.lastModified, preview: before?.shape === t.shape ? before.preview : null };
      tours.put(tour);
      return { id: tour.id, rev: tour.updated };
    }
    const [t] = parseGpx(f.text);
    if (!t) return null;
    const twin = !before && !id && (await tracks.all()).find((x) => sameTrack(x, t));
    if (twin) return { id: twin.id, rev: rev(twin) };
    const track = { ...before, ...t, id: id ?? before?.id ?? t.id, updated: f.lastModified };
    await tracks.putQuiet(track);
    return { id: track.id, rev: track.updated };
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
  if (e.detail?.removed) local.set(DELETED, [...new Set([...local.get(DELETED, []), e.detail.id])]);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await syncing?.catch(() => {});
    if (!await load()) { local.set(DELETED, []); return; }
    folder.sync().catch(() => { /* beim nächsten Mal */ });
  }, 2500);
});

/* ── Ohne Ordner-Zugriff (Firefox, Safari, App): Dateien laden und teilen ── */

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

/* ── Sicherung als ZIP: dieselbe Ordnung wie im verbundenen Ordner ────────── */

/**
 * WMap/Geplant/*.gpx, WMap/Abgeschlossen/<Jahr>/*.gpx und die vollständige
 * Sicherung (WMap/wmap-sicherung.json – mit allem, was GPX nicht fasst).
 * → Blob
 */
export async function zipBackup() {
  const used = new Set();
  const entry = (kind, item) => {
    const path = freePath(pathOf(kind, item), used, []);
    used.add(path);
    return { path, data: gpxOf({ kind, item }), date: new Date(item.updated ?? item.created ?? item.start ?? Date.now()) };
  };
  const files = [
    ...tours.all().map((t) => entry('tour', t)),
    ...(await tracks.all()).map((t) => entry('track', t)),
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

/** Alle Wege und Touren als GPX-Dateien teilen – am Handy z. B. „In Proton Drive speichern“. */
export async function shareAll() {
  const files = [
    ...(await tracks.all()).map((t) => new File([trackGpx(t)], pathOf('track', t).split('/').pop(), { type: 'application/gpx+xml' })),
    ...tours.all().map((t) => new File([gpxOf({ kind: 'tour', item: t })], pathOf('tour', t).split('/').pop(), { type: 'application/gpx+xml' })),
  ];
  if (!files.length) throw new Error('Noch keine Wege oder Touren');
  if (!navigator.canShare?.({ files })) throw new Error('Teilen von Dateien geht in diesem Browser nicht – bitte „Sicherung speichern“ nehmen');
  await navigator.share({ files, title: 'WMap – Wege und Touren' });
  return files.length;
}

export const canShareFiles = () => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File([''], 'a.gpx', { type: 'application/gpx+xml' })] });

/* ── Baustein für Einstellungen, Meine Wege, Touren ───────────────────────── */

const TIME = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function summary(r) {
  if (!r) return '';
  const parts = [r.imported && `${r.imported} übernommen`, r.written && `${r.written} gespeichert`, r.moved && `${r.moved} in den Ordner „WMap“ umgezogen`, r.removed && `${r.removed} gelöscht`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'alles aktuell';
}

/**
 * Ordner-Zeile: verbinden, abgleichen, trennen – oder, ohne Ordner-Zugriff,
 * GPX-Ordner einlesen und alles teilen. `compact`: nur Status + Knopf.
 */
export function mountFolder(el, { toast: outer = null, compact = false } = {}) {
  el.classList.add('folder-box');
  let busy = false;
  let note = '';
  // Ohne Toast (z. B. im Dialog, der ihn verdecken würde) steht die Meldung im Baustein
  const toast = (t) => { if (outer) outer(t); else { note = t; paint(); } };
  const noteHtml = () => (note && !outer ? `<p class="folder-note">${esc(note)}</p>` : '');

  async function paint() {
    if (!folderSupported) {
      el.innerHTML = `
        <p class="folder-line"><span class="msr">folder_off</span><span>Ordner verbinden geht in Chrome und Edge. Hier kannst du einen Ordner mit GPX-Dateien einlesen${canShareFiles() ? ' und alles als Dateien teilen – z. B. in Proton Drive oder Nextcloud' : ''}.</span></p>
        <div class="folder-actions">
          <label class="button"><span class="msr">drive_folder_upload</span> Ordner einlesen<input type="file" webkitdirectory multiple hidden data-folder="read"></label>
          ${canShareFiles() ? '<button type="button" class="button" data-folder="share"><span class="msr">ios_share</span> Alles teilen</button>' : ''}
        </div>${noteHtml()}`;
      return;
    }
    const i = await folder.info();
    if (!i.connected) {
      el.innerHTML = `
        <p class="folder-line"><span class="msr">folder</span><span>${compact ? 'Wege und Touren in einem Ordner sichern' : 'Wege und Touren als GPX in einem Ordner – den gleicht dein Sync-Programm ab (Nextcloud, Proton Drive, Google Drive …). Am Handy wählst du den Ordner in der Drive-App aus.'}</span></p>
        <div class="folder-actions"><button type="button" class="button${compact ? '' : ' primary'}" data-folder="connect"><span class="msr">create_new_folder</span> Ordner verbinden</button></div>${noteHtml()}`;
      return;
    }
    const ask = i.permission !== 'granted';
    el.innerHTML = `
      <p class="folder-line"><span class="msr">${busy ? 'sync' : ask ? 'folder_managed' : 'folder_open'}</span><span>
        Ordner <strong>${esc(i.name)}</strong>${busy ? ' – gleiche ab …' : ask ? ' – Zugriff erneut erlauben' : i.last ? ` · ${TIME.format(i.last)}: ${summary(i.result)}` : ''}</span></p>
      <div class="folder-actions">
        <button type="button" class="button${ask ? ' primary' : ''}" data-folder="sync" ${busy ? 'disabled' : ''}><span class="msr">sync</span> ${ask ? 'Erlauben und abgleichen' : 'Abgleichen'}</button>
        ${compact ? '' : '<button type="button" class="button" data-folder="disconnect"><span class="msr">link_off</span> Trennen</button>'}
      </div>${noteHtml()}`;
  }

  async function sync(interactive) {
    busy = true; paint();
    try {
      const r = await folder.sync({ interactive });
      if (r?.needsPermission) { if (interactive) toast('Ohne Zugriff kein Abgleich'); } else if (r && interactive) toast(`Abgeglichen – ${summary(r)}`);
    } catch (err) { toast(`Abgleich ging nicht: ${err.message}`); }
    busy = false; paint();
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-folder]')?.dataset.folder;
    if (act) note = '';
    if (act === 'connect') {
      try { busy = true; paint(); const r = await folder.connect(); toast(`Ordner verbunden – ${summary(r)}`); } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
      busy = false; paint();
    }
    if (act === 'sync') sync(true);
    if (act === 'disconnect') { await folder.disconnect(); toast('Ordner getrennt – die Dateien bleiben, wo sie sind'); paint(); }
    if (act === 'share') { try { await shareAll(); } catch (err) { if (err.name !== 'AbortError') toast(err.message); } }
  });
  el.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-folder="read"]');
    if (!inp?.files?.length) return;
    try {
      const r = await importLoose(inp.files);
      toast(r.imported ? `${r.imported} übernommen${r.skipped ? `, ${r.skipped} gab es schon` : ''}` : r.skipped ? 'Alles schon da' : 'Keine GPX-Dateien gefunden');
    } catch (err) { toast(err.message); }
    inp.value = '';
  });

  paint();
  // Beim Öffnen still abgleichen, wenn das Recht noch gilt
  if (folderSupported && !autoSynced) {
    autoSynced = true;
    folder.info().then((i) => { if (i.connected && i.permission === 'granted') sync(false); });
  }
  addEventListener('wmap:folder', () => { if (el.isConnected) paint(); });
  return { paint };
}
