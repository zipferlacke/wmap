/**
 * Die Datenbank im Browser (IndexedDB) – für alles, was für localStorage zu
 * groß ist: aufgezeichnete Wege (data/tracks.js) und eigene Ebenen (map/layers.js).
 *
 *   tracks   { id, start, … }
 *   layers   { id, name, data (GeoJSON), … }
 *   kv       { id, … } – Einzelnes, z. B. der verbundene Ordner (data/folder.js)
 */
const NAME = 'wmap';
const VERSION = 3;

let dbp = null;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' }).createIndex('start', 'start');
      if (!db.objectStoreNames.contains('layers')) db.createObjectStore('layers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Ein anderer Tab mit neuerer Version will umbauen: loslassen, beim nächsten Zugriff neu öffnen
      req.result.onversionchange = () => { req.result.close(); dbp = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

/** Ein Speicher als einfache Sammlung: all, get, put, remove. */
export function store(name) {
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const out = fn(t.objectStore(name));
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Speichern abgebrochen'));
    });
  };
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    get: (id) => tx('readonly', (s) => s.get(id)),
    put: (v) => tx('readwrite', (s) => s.put(v)),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
  };
}
