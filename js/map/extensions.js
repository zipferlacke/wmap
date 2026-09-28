/**
 * Erweiterungen: JavaScript-Plugins, die auf der Karte wirklich etwas tun –
 * eigene Ebenen zeichnen, Menüpunkte anbieten, auf Klicks reagieren.
 *
 * Eine Erweiterung ist ein ES-Modul unter einer https-Adresse:
 *
 *   export function activate(wmap) {
 *     wmap.onMapReady((map) => map.addLayer({ … }));
 *     wmap.addMenuItem('bolt', 'Meine Funktion', () => wmap.toast('Hallo'));
 *   }
 *
 *   wmap = { version, map, maplibregl, onMapReady(fn), toast(text),
 *            addMenuItem(icon, label, fn), storage: { get(k), set(k, v) } }
 *
 * Sie laufen nur, wenn man sie auf der Plugin-Seite ausdrücklich aktiviert –
 * mit dem Hinweis, dass sie alles dürfen, was WMap darf. Gespeichert wird die
 * Liste im Browser (IndexedDB „kv“, Eintrag „extensions“).
 */
import { store } from '../data/db.js';
import { APP_VERSION } from '../core/config.js';

const kv = store('kv');
const KEY = 'extensions';

export const extensions = {
  /** → [{ id, name, url, operator, pluginId, active }] */
  async all() { return (await kv.get(KEY).catch(() => null))?.list ?? []; },
  async save(list) { await kv.put({ id: KEY, list }); },
  async set(ext) {
    const list = (await this.all()).filter((x) => x.id !== ext.id);
    list.push(ext);
    await this.save(list);
  },
  async remove(id) { await this.save((await this.all()).filter((x) => x.id !== id)); },
};

/** Beim Start der Karte: alle aktiven Erweiterungen laden (app.js). */
export async function runExtensions({ map, toast, appNav }) {
  const list = (await extensions.all()).filter((x) => x.active);
  for (const x of list) {
    const api = Object.freeze({
      version: APP_VERSION,
      map,
      maplibregl: window.maplibregl,
      onMapReady: (fn) => (map.loaded() ? fn(map) : map.once('load', () => fn(map))),
      toast,
      addMenuItem: (icon, label, fn) => appNav?.addItem(icon, label, fn),
      storage: {
        get: (k) => { try { return JSON.parse(localStorage.getItem(`wmap.ext.${x.id}.${k}`)); } catch { return null; } },
        set: (k, v) => { try { localStorage.setItem(`wmap.ext.${x.id}.${k}`, JSON.stringify(v)); } catch { /* voll */ } },
      },
    });
    try {
      const mod = await import(/* @vite-ignore */ x.url);
      await mod.activate?.(api);
    } catch (err) {
      toast(`Erweiterung „${x.name}“ ließ sich nicht starten: ${err.message}`);
    }
  }
}
