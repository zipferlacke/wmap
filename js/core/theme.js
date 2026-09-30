/**
 * Hell oder dunkel: wie das System (Standard) oder fest gewählt in den
 * Einstellungen → Darstellung. Gilt für die Oberfläche (wuefl-libs rechnet
 * alle Farben mit light-dark() aus `color-scheme`) und für die Karte
 * (map/map.js färbt den Kartenstil um).
 *
 *   <html class="dark">       wenn gerade dunkel – für das, was light-dark()
 *                             nicht kann (z. B. MapLibre-Symbole umkehren)
 *   Ereignis „wmap:theme“     { dark } – bei jedem Wechsel, auch wenn das
 *                             System umschaltet oder ein anderer Tab wählt
 */
// Weblinks in der App über WMap öffnen (jede Seite lädt theme.js)
import './links.js';

// Zurück von der OSM-Anmeldung (ohne Popup): auf dieser Seite einlösen
try { if (localStorage.getItem('wmap.osm.return')) import('../osm/login-return.js'); } catch { /* gesperrt */ }

const KEY = 'wmap.theme';
const system = matchMedia('(prefers-color-scheme: dark)');
let last = null;

export const theme = {
  /** 'system' | 'light' | 'dark' */
  get() {
    try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
  },
  set(value) {
    try {
      if (value === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, value);
    } catch { /* gesperrt – gilt dann nur bis zum Neuladen */ }
    apply(value);
  },
  get dark() { return last ?? isDark(this.get()); },
};

function isDark(choice) {
  return choice === 'dark' || (choice === 'system' && system.matches);
}

function apply(choice = theme.get()) {
  const root = document.documentElement;
  root.style.colorScheme = choice === 'system' ? '' : choice;
  const dark = isDark(choice);
  root.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1e23' : '#1a73e8');
  if (dark === last) return;
  const first = last === null;
  last = dark;
  if (!first) dispatchEvent(new CustomEvent('wmap:theme', { detail: { dark } }));
}

/*
 * Android-App: Das WebView reicht bis unter Status- und Gestenleiste, meldet
 * aber kein env(safe-area-inset-*). Die Maße kommen aus der MainActivity
 * (tools/android/MainActivity.kt) und setzen --safe-top/--safe-bottom –
 * sonst lägen eingeklappte Sheets unter der Gestenleiste.
 */
function applyInsets(i) {
  if (!i) return;
  const root = document.documentElement.style;
  root.setProperty('--safe-top', `max(env(safe-area-inset-top, 0px), ${i.top}px)`);
  root.setProperty('--safe-bottom', `max(env(safe-area-inset-bottom, 0px), ${i.bottom}px)`);
  // Was aus Maßen rechnet (Karte, Kartenknöpfe unter der Suche), soll es mitbekommen
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}
if (window.WMapAndroid?.insets) {
  try { applyInsets(JSON.parse(window.WMapAndroid.insets())); } catch { /* ältere App ohne Ränder */ }
  window.wmapInsets = applyInsets;
}

system.addEventListener('change', () => apply());
addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
apply();

// App: Kam eine GPX-Datei über „Öffnen mit“, „Teilen“ oder Doppelklick? Dann
// zur Seite zum Öffnen (pages/import.js holt sie beim Plugin „folder“ ab).
// Mit einem Shortcut gestartet (lange aufs App-Symbol, Rechtsklick im Menü)?
// Dann zu dessen Seite (`go`, z. B. index.html?action=route).
// Nicht in der eingepackten Kopie, die gleich zur Webversion wechselt (tauri-start.js).
if (window.__TAURI__?.core && !window.__wmapStarting && !/\/import\.html$/.test(location.pathname)) {
  window.__TAURI__.core.invoke('plugin:folder|opened', { peek: true })
    .then((r) => {
      if (r?.count) location.assign('./import.html');
      else if (r?.go) location.assign(new URL(r.go, location.href));
    })
    .catch(() => { /* ältere App ohne „opened“ */ });
}
