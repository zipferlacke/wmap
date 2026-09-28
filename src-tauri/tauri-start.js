/**
 * Nur in der App (Tauri): Die App läuft von der Webversion – so kommen
 * Änderungen an der Oberfläche ohne neue Version im Store an.
 *
 *   mit Netz                 zur Webversion; ihr Service Worker speichert
 *                            Seiten, Skripte und angesehene Karten
 *   ohne Netz, schon mal     trotzdem zur Webversion – der Service Worker
 *   online gewesen           liefert den zuletzt geladenen Stand samt
 *                            Offline-Karten aus seinem Speicher
 *   ohne Netz, noch nie      diese eingepackte Kopie (web-kopieren.sh bindet
 *   online                   das Skript in ihre index.html ein)
 *
 * Geräte-Funktionen (Standort …) kommen weiter aus Tauri: Die Webadresse ist
 * in src-tauri/capabilities freigegeben, js/core/native.js findet window.__TAURI__.
 */
(() => {
  const REMOTE = 'https://app.wuefl.de/wmap/';
  const ONLINE_ONCE = 'wmap.remote';        // Webversion lief hier schon einmal
  const local = !/^https?:$/.test(location.protocol) || location.hostname === 'tauri.localhost';
  if (!local || sessionStorage.getItem('wmap.local')) return;
  // Kurz verbergen, damit nicht erst die eingepackte Seite aufblitzt
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  const remember = (key, store = localStorage) => { try { store.setItem(key, '1'); } catch { /* gesperrt */ } };
  const known = () => { try { return !!localStorage.getItem(ONLINE_ONCE); } catch { return false; } };
  const go = () => location.replace(REMOTE + location.search + location.hash);
  const stay = () => { root.style.visibility = ''; remember('wmap.local', sessionStorage); };
  const offline = () => (known() ? go() : stay());
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  fetch(`${REMOTE}appdata/messages.json`, { cache: 'no-store', signal: ctl.signal })
    .then((r) => {
      clearTimeout(timer);
      if (r.ok) { remember(ONLINE_ONCE); go(); } else offline();
    })
    .catch(offline);
})();
