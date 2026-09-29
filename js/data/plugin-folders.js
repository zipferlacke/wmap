/**
 * Plugin-Ordner: lokale Ordner, aus denen WMap Kartenebenen und
 * Erweiterungen liest – mehrere, gemerkt, jederzeit neu einlesbar. Wie ein
 * Ordner aufgebaut ist, steht in plugin-anleitung.html:
 *
 *   irgendwas.geojson            einfache Ebene (Name = Dateiname)
 *   Unterordner/wmap-plugin.json Plugin mit Name, Beschreibung, Farbe –
 *                                als GeoJSON-Ebene („data“), Kartenkacheln
 *                                („tiles“) oder Erweiterung („script“)
 *   irgendwas.js                 Erweiterung (ES-Modul mit activate(wmap))
 *
 * Wo das geht:
 *   App (Tauri)     Plugin „folder“, je Ordner ein eigener Platz (slot
 *                   „layers“, „layers2“ …) – das WebView kann keine Ordner
 *   Chrome/Edge     File System Access API, der Ordner-Zugriff liegt in IndexedDB
 *   Firefox/Safari  <input webkitdirectory>: nur einmal einlesen, nicht merken
 *                   (die Browser bieten die Ordner-Schnittstelle nicht an)
 *
 * Neu einlesen ersetzt, was vorher aus dem Ordner kam; ob eine Ebene auf der
 * Karte lag bzw. eine Erweiterung an war, bleibt.
 */
import { store } from './db.js';
import { layers, newLayer, rasterLayer } from '../map/layers.js';
import { extensions } from '../map/extensions.js';

const kv = store('kv');
const KEY = 'plugin-folders';               // { id, list: [{ id, name, slot? , handle? }] }
export const MANIFEST = 'wmap-plugin.json';
const MAX_DEPTH = 5;

const core = typeof window !== 'undefined' ? window.__TAURI__?.core : null;
const fsa = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
/** 'app' | 'browser' (gemerkt) | 'once' (nur einmal einlesen) */
export const folderMode = core ? 'app' : fsa ? 'browser' : 'once';

const call = (cmd, args) => core.invoke(`plugin:folder|${cmd}`, args);
const abort = () => Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
const base = (p) => p.split('/').pop();
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const wanted = (p) => /\.(geo)?json$|\.m?js$/i.test(p);

async function saved() {
  const list = (await kv.get(KEY).catch(() => null))?.list ?? [];
  // In der App gab es kurz einen einzelnen Ebenen-Ordner (slot „layers“) – übernehmen
  if (!list.length && core) {
    const i = await call('info', { slot: 'layers' }).catch(() => null);
    if (i?.connected) {
      list.push({ id: 'layers', slot: 'layers', name: i.name ?? 'Ordner' });
      await kv.put({ id: KEY, list });
    }
  }
  return list;
}
const save = (list) => kv.put({ id: KEY, list });

/* ── Dateien lesen: App, Browser-Ordner, einmalige Auswahl ────────────────── */

/** → [{ path, text() }] – Pfade relativ zum Ordner */
async function filesOf(folder) {
  if (folder.slot) {
    const { files } = await call('list', { slot: folder.slot });
    return files.filter((f) => wanted(f.path))
      .map((f) => ({ path: f.path, text: async () => (await call('read', { slot: folder.slot, path: f.path })).text }));
  }
  const out = [];
  const walk = async (dir, prefix, depth) => {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') { if (depth < MAX_DEPTH) await walk(h, `${prefix}${name}/`, depth + 1); } else if (wanted(name)) out.push({ path: prefix + name, text: async () => (await h.getFile()).text() });
    }
  };
  await walk(folder.handle, '', 0);
  return out;
}

/** Browser-Ordner: Lesezugriff gilt nach einem Neustart erst nach Rückfrage (braucht einen Klick) */
async function allowed(handle) {
  const opts = { mode: 'read' };
  if (!handle.queryPermission) return true;
  let p = await handle.queryPermission(opts);
  if (p === 'prompt') p = await handle.requestPermission(opts);
  return p === 'granted';
}

/* ── Einlesen ─────────────────────────────────────────────────────────────── */

/**
 * Dateien eines Ordners zu Ebenen und Erweiterungen machen und das, was
 * vorher aus diesem Ordner kam, ersetzen.
 * → { layers: n, extensions: n, failed: [Pfad] }
 */
async function importFiles(folderId, files, { index = 0 } = {}) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const manifests = files.filter((f) => base(f.path).toLowerCase() === MANIFEST);
  const pluginDirs = manifests.map((m) => dirOf(m.path));
  // Welcher Plugin-Unterordner eine Datei enthält (der tiefste) – oder keiner
  const ownerOf = (p) => pluginDirs.filter((d) => d === '' || p.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0];
  const newLayers = [], newExts = [], failed = [];
  const source = (path, extra = {}) => ({ kind: 'file', path, folder: folderId, ...extra });
  const ext = (path, code, meta = {}) => newExts.push({
    id: `f-${folderId}-${path}`, name: meta.name || base(path).replace(/\.m?js$/i, ''), operator: meta.operator || 'aus deinem Ordner',
    description: meta.description ?? '', code, folder: folderId, path, active: false,
  });

  for (const m of manifests) {
    const dir = dirOf(m.path);
    const inDir = (p) => (dir ? `${dir}/${p}` : p);
    let conf;
    try { conf = JSON.parse(await m.text()); } catch { failed.push(m.path); continue; }
    const meta = { name: conf.name || base(dir) || 'Plugin', description: conf.description ?? '', operator: conf.operator ?? '', attribution: conf.attribution ?? '' };
    try {
      if (conf.type === 'extension' || conf.script) {
        const f = byPath.get(inDir(conf.script ?? 'main.js'));
        if (!f) throw new Error('script fehlt');
        ext(f.path, await f.text(), meta);
      } else if (conf.tiles) {
        const l = rasterLayer({ name: meta.name, tiles: conf.tiles, attribution: meta.attribution, minzoom: conf.minzoom ?? null, maxzoom: conf.maxzoom ?? null, source: source(m.path, { plugin: dir }) });
        newLayers.push({ ...l, description: meta.description, operator: meta.operator, ...(conf.opacity != null ? { opacity: +conf.opacity } : {}) });
      } else {
        // Daten: angegeben, sonst alle GeoJSON-Dateien im Plugin-Ordner
        const data = [conf.data ?? []].flat().map(inDir);
        const list = data.length ? data.map((p) => byPath.get(p)).filter(Boolean)
          : files.filter((f) => ownerOf(f.path) === dir && /\.(geo)?json$/i.test(f.path) && base(f.path).toLowerCase() !== MANIFEST);
        if (!list.length) throw new Error('keine Daten');
        for (const f of list) {
          const name = list.length > 1 ? `${meta.name} – ${base(f.path).replace(/\.(geo)?json$/i, '')}` : meta.name;
          const l = newLayer(await f.text(), { name, source: source(f.path, { plugin: dir }), index: index + newLayers.length });
          newLayers.push({ ...l, description: meta.description, operator: meta.operator, attribution: meta.attribution,
            ...(conf.color ? { color: conf.color } : {}), ...(conf.colorBy ? { colorBy: conf.colorBy } : {}) });
        }
      }
    } catch { failed.push(m.path); }
  }

  // Lose Dateien: GeoJSON → Ebene, JavaScript → Erweiterung
  for (const f of files) {
    if (ownerOf(f.path) !== undefined) continue;
    try {
      if (/\.m?js$/i.test(f.path)) { ext(f.path, await f.text()); continue; }
      const l = newLayer(await f.text(), { name: base(f.path).replace(/\.(geo)?json$/i, ''), source: source(f.path), index: index + newLayers.length });
      newLayers.push(l);
    } catch { failed.push(f.path); }
  }

  // Ersetzen, was vorher aus dem Ordner kam – Schalter bleiben
  const oldLayers = (await layers.all()).filter((l) => l.source?.folder === folderId);
  const oldExts = (await extensions.all()).filter((x) => x.folder === folderId);
  for (const l of newLayers) {
    const was = oldLayers.find((o) => o.source?.path === l.source.path);
    await layers.put({ ...l, onMain: was ? !!was.onMain : true, ...(was ? { visible: was.visible, color: l.color ?? was.color } : {}) });
  }
  for (const l of oldLayers) await layers.remove(l.id);
  const keep = (await extensions.all()).filter((x) => x.folder !== folderId);
  await extensions.save([...keep, ...newExts.map((x) => ({ ...x, active: !!oldExts.find((o) => o.path === x.path)?.active }))]);
  return { layers: newLayers.length, extensions: newExts.length, failed };
}

/* ── Ordner verwalten ─────────────────────────────────────────────────────── */

export const pluginFolders = {
  /** → [{ id, name }] */
  async list() { return (await saved()).map(({ id, name }) => ({ id, name })); },

  /** Ordner wählen, merken und einlesen. → { folder, ...Ergebnis }; Abbruch: AbortError */
  async add({ index = 0 } = {}) {
    const list = await saved();
    let folder;
    if (core) {
      let n = 1;
      while (list.some((f) => f.slot === `layers${n > 1 ? n : ''}`)) n += 1;
      const slot = `layers${n > 1 ? n : ''}`;
      try {
        const i = await call('pick', { slot });
        folder = { id: slot, slot, name: i.name ?? 'Ordner' };
      } catch (err) {
        const msg = String(err?.message ?? err);
        throw /abgebrochen|cancel/i.test(msg) ? abort() : new Error(msg);
      }
    } else if (fsa) {
      let handle;
      try { handle = await window.showDirectoryPicker({ id: 'wmap-plugins', mode: 'read' }); } catch (err) {
        throw err.name === 'AbortError' ? abort() : err;
      }
      // Denselben Ordner nicht doppelt
      for (const f of list) if (f.handle && await f.handle.isSameEntry?.(handle)) return { folder: f, ...(await this.reload(f.id, { index })) };
      folder = { id: `b${Date.now().toString(36)}`, handle, name: handle.name };
    } else {
      throw new Error('Dieser Browser kann Ordner nur einmal einlesen');
    }
    list.push(folder);
    await save(list);
    return { folder: { id: folder.id, name: folder.name }, ...(await importFiles(folder.id, await filesOf(folder), { index })) };
  },

  /** Gemerkten Ordner neu einlesen (braucht im Browser einen Klick). */
  async reload(id, { index = 0 } = {}) {
    const folder = (await saved()).find((f) => f.id === id);
    if (!folder) throw new Error('Ordner nicht mehr bekannt');
    if (folder.handle && !await allowed(folder.handle)) throw new Error('Kein Zugriff auf den Ordner – bitte erlauben');
    return importFiles(id, await filesOf(folder), { index });
  },

  /** Ordner vergessen – mit allem, was daraus geladen wurde. */
  async remove(id) {
    const list = await saved();
    const folder = list.find((f) => f.id === id);
    if (folder?.slot) await call('disconnect', { slot: folder.slot }).catch(() => {});
    await save(list.filter((f) => f.id !== id));
    for (const l of (await layers.all()).filter((x) => x.source?.folder === id)) await layers.remove(l.id);
    await extensions.save((await extensions.all()).filter((x) => x.folder !== id));
  },

  /** Firefox/Safari: Auswahl aus <input webkitdirectory> einmal einlesen (nicht gemerkt). */
  async readOnce(fileList, { index = 0 } = {}) {
    const files = [...fileList].map((f) => ({ path: f.webkitRelativePath.split('/').slice(1).join('/') || f.name, text: () => f.text() }))
      .filter((f) => wanted(f.path) && !f.path.split('/').some((p) => p.startsWith('.')));
    const name = fileList[0]?.webkitRelativePath?.split('/')[0] || 'Ordner';
    // Je Ordnername eine Kennung – erneutes Einlesen ersetzt statt verdoppelt
    return { name, ...(await importFiles(`once-${name}`, files, { index })) };
  },
};

/** Für Tests: Dateien wie aus einem Ordner einlesen. */
export const _importFiles = importFiles;
