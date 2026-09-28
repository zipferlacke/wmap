/**
 * Nur in der App (Tauri): Ist die Webversion erreichbar, läuft die App von
 * dort – so kommen Änderungen an der Oberfläche ohne neue Version im Store
 * an. Ohne Netz bleibt diese eingepackte Kopie (web-kopieren.sh bindet das
 * Skript in ihre index.html ein).
 *
 * Geräte-Funktionen (Standort …) kommen weiter aus Tauri: Die Webadresse ist
 * in src-tauri/capabilities freigegeben, js/native.js findet window.__TAURI__.
 */
(() => {
  const REMOTE = 'https://app.wuefl.de/wmap/';
  const local = !/^https?:$/.test(location.protocol) || location.hostname === 'tauri.localhost';
  if (!local || sessionStorage.getItem('wmap.local')) return;
  // Kurz verbergen, damit nicht erst die eingepackte Seite aufblitzt
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  const stay = () => { root.style.visibility = ''; sessionStorage.setItem('wmap.local', '1'); };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  fetch(`${REMOTE}appdata/messages.json`, { cache: 'no-store', signal: ctl.signal })
    .then((r) => {
      clearTimeout(timer);
      if (r.ok) location.replace(REMOTE + location.search + location.hash);
      else stay();
    })
    .catch(stay);
})();
