/**
 * App und Android Auto teilen ihre Daten. Die Karte im Auto ist ein eigenes
 * WebView (tools/android/car/CarWeb.kt). Lädt es von derselben Adresse wie
 * die App – in der fertigen App beide von app.wuefl.de –, ist der
 * Browser-Speicher derselbe und es gibt nichts zu tun. Sonst nicht: Die
 * Debug-Fassung läuft unter tauri.localhost, die Karte im Auto vom Rechner;
 * auch eine App, die (ohne Netz) bei ihrer eingepackten Kopie bleibt, hat
 * einen anderen Speicher als das Auto. Geplante Touren, Lesezeichen und
 * zuletzt gefahrene Ziele der App gäbe es im Auto dann nicht.
 *
 * Beide Seiten legen darum in einen gemeinsamen Speicher von Android
 * (window.WMapAndroid.shareGet/shareSet – MainActivity.kt und CarWeb.kt,
 * SharedPreferences „wmap_shared“):
 *
 *   app      { origin, tours (ohne Vorschaubild), settings }   App → Auto
 *   car      { origin }                                         Auto → App
 *   places   Zuhause, Arbeit, Lesezeichen    beide Richtungen, je Eintrag das Neuere
 *   recent   zuletzt gesucht und gefahren    beide Richtungen
 *
 * Übernommen wird nur, wenn die andere Seite unter einer anderen Adresse
 * läuft (origin) – bei gemeinsamem Speicher überschriebe das Auto sonst die
 * Touren der App mit einer Kopie von eben. Die eingepackte Kopie, die gleich
 * zur Webversion wechselt (tauri-start.js), legt nichts ab.
 *
 * Geladen von core/theme.js auf jeder Seite, wenn es die Schnittstelle gibt
 * (nur in der Android-App). Abgeglichen wird beim Start, nach jeder Änderung
 * und wenn die Seite wieder sichtbar wird; im Auto zusätzlich, bevor es
 * Touren oder Ziele auflistet (js/car/car.js → shareSync).
 */
import { local, tours, recent } from './store.js';
import { mergePlaces } from './saved.js';

// Bei jedem Aufruf nachsehen – Tests setzen die Schnittstelle erst nach dem Laden
const here = () => (typeof window.WMapAndroid?.shareGet === 'function' ? window.WMapAndroid : null);
const CAR = new URLSearchParams(location.search).has('car');
// Was im Auto wie in der App gelten soll
const SETTINGS = ['wmap.routePrefs', 'wmap.voice', 'wmap.tankerkoenig', 'wmap.datasaver', 'wmap.contribute', 'wmap.osm.anon', 'wmap.myname'];

const get = (key) => { try { return here().shareGet(key) || null; } catch { return null; } };
const put = (key, text) => { try { if (get(key) !== text) here().shareSet(key, text); } catch { /* ältere App */ } };
const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };

/** Mit dem gemeinsamen Speicher abgleichen → true, wenn sich hier etwas geändert hat */
export function shareSync() {
  // Die eingepackte Kopie wechselt gleich zur Webversion – ihr Stand ist nicht der der App
  if (!here() || window.__wmapStarting) return false;
  const other = parse(get(CAR ? 'app' : 'car'), null);
  // Läuft die andere Seite unter einer anderen Adresse? Nur dann sind die Speicher getrennt
  const separate = !!other?.origin && other.origin !== location.origin;
  let changed = false;
  if (CAR) {
    put('car', JSON.stringify({ origin: location.origin }));
    if (!separate) return false;
    // Touren und Einstellungen gelten, wie die App sie hingelegt hat
    if (Array.isArray(other.tours) && JSON.stringify(other.tours) !== JSON.stringify(local.get('wmap.tours', []))) {
      local.set('wmap.tours', other.tours);
      changed = true;
    }
    for (const [k, v] of Object.entries(other.settings ?? {})) {
      try { if (typeof v === 'string' && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); changed = true; } } catch { /* gesperrt */ }
    }
  } else {
    const settings = {};
    for (const k of SETTINGS) { try { const v = localStorage.getItem(k); if (v !== null) settings[k] = v; } catch { /* gesperrt */ } }
    put('app', JSON.stringify({ origin: location.origin, tours: tours.all().map(({ preview: _p, ...t }) => t), settings }));
  }
  // Lesezeichen: je Eintrag das Neuere, Gelöschtes bleibt gelöscht (wie Lesezeichen.json im Ordner).
  // Die App legt ihren Stand immer ab; hereingeholt wird nur aus einem getrennten Speicher
  const before = JSON.stringify(local.get('wmap.saved', null));
  const merged = mergePlaces(separate ? get('places') : null);
  put('places', merged.text);
  if (JSON.stringify(local.get('wmap.saved', null)) !== before) changed = true;
  // Zuletzt: beide Listen zusammen, neueste zuerst
  const theirs = separate ? parse(get('recent'), []) : [];
  const all = recent.merge(Array.isArray(theirs) ? theirs : []);
  if (all.changed) changed = true;
  put('recent', JSON.stringify(all.list));
  return changed;
}

if (here()) {
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(shareSync, 800); };
  shareSync();
  addEventListener('wmap:data', soon);
  addEventListener('wmap:saved', soon);
  addEventListener('visibilitychange', () => { clearTimeout(timer); shareSync(); });
  addEventListener('pagehide', () => shareSync());
}
