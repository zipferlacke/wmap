/**
 * Nur in der App (Tauri): Die App läuft von der Webversion – so kommen
 * Änderungen an der Oberfläche ohne neue Version im Store an. Einen neuen
 * Build braucht es nur, wenn sich der Tauri-Teil ändert (dann minVersion in
 * appdata/messages.json – js/ui/news.js).
 *
 *   mit Netz                 zur Webversion; ihr Service Worker speichert
 *                            Seiten, Skripte und angesehene Karten
 *   ohne Netz, schon mal     trotzdem zur Webversion – der Service Worker
 *   online gewesen           liefert den zuletzt geladenen Stand samt
 *                            Offline-Karten aus seinem Speicher
 *   ohne Netz, noch nie      diese eingepackte Kopie (web-kopieren.sh bindet
 *   online                   das Skript in ihre index.html ein)
 *
 * Erreichbar heißt: Der Server antwortet. Abgefragt wird mit `no-cors` –
 * app.wuefl.de schickt keine CORS-Header, eine normale Abfrage scheiterte
 * daran immer, und die App blieb bei ihrer eingepackten Kopie (bis 2.0.1).
 *
 * Umzug: Die Webversion hat ihren eigenen Speicher (app.wuefl.de statt
 * tauri://localhost). Hat diese eingepackte Version noch eigene Daten, fragt
 * sie einmal vor dem Wechsel: in den verbundenen Ordner sichern (die
 * Webversion findet den Ordner im Plugin und holt alles von dort) oder als
 * ZIP speichern (dort unter Sicherung & Synchronisation einspielen).
 *
 * Geräte-Funktionen (Standort …) kommen weiter aus Tauri: Die Webadresse ist
 * in src-tauri/capabilities freigegeben, js/core/native.js findet window.__TAURI__.
 */
(() => {
  const REMOTE = 'https://app.wuefl.de/wmap/';
  const ONLINE_ONCE = 'wmap.remote';        // Webversion lief hier schon einmal
  const MOVED = 'wmap.umzug';               // Daten dieser Kopie gesichert bzw. gefragt
  const local = !/^https?:$/.test(location.protocol) || location.hostname === 'tauri.localhost';
  if (!local || sessionStorage.getItem('wmap.local')) return;
  // Kurz verbergen, damit nicht erst die eingepackte Seite aufblitzt
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  window.__wmapStarting = true;             // core/theme.js: geöffnete Datei erst auf der Webversion abholen
  const get = (key, store = localStorage) => { try { return store.getItem(key); } catch { return null; } };
  const remember = (key, store = localStorage) => { try { store.setItem(key, '1'); } catch { /* gesperrt */ } };
  const go = () => location.replace(REMOTE + location.search + location.hash);
  const stay = () => {
    root.style.visibility = '';
    remember('wmap.local', sessionStorage);
    window.__wmapStarting = false;
    // Ohne Netz bleibt es bei dieser Kopie – eine geöffnete Datei dann hier abholen
    window.__TAURI__?.core?.invoke('plugin:folder|opened', { peek: true })
      .then((r) => {
        if (r?.count) location.assign('./import.html');
        else if (r?.go) location.assign(new URL(r.go, location.href));
      }).catch(() => {});
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  fetch(`${REMOTE}appdata/messages.json`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    .then(() => true, () => false)
    .then(async (online) => {
      clearTimeout(timer);
      if (online) remember(ONLINE_ONCE);
      else if (!get(ONLINE_ONCE)) { stay(); return; }
      if (!get(MOVED)) {
        try { await moveOut(); } catch { /* dann eben ohne */ }
        remember(MOVED);
      }
      go();
    });

  /** Eigene Daten dieser Kopie? Dann einmal fragen, wohin damit. */
  async function moveOut() {
    const [{ tracks }, { tours, download }, { places }] = await Promise.all([
      import('./js/data/tracks.js'), import('./js/data/store.js'), import('./js/data/saved.js'),
    ]);
    const n = (await tracks.all()).length + tours.all().length + places.all().length;
    if (!n) return;
    const { folder, zipBackup, syncSummary } = await import('./js/data/folder.js');
    const i = await folder.info().catch(() => null);
    const inFolder = !!(i?.connected && i.permission === 'granted');

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;visibility:visible;display:grid;place-items:center;padding:16px;'
      + 'background:rgb(0 0 0 / .45);font:16px/1.45 system-ui,sans-serif;color-scheme:light dark';
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const button = (act, label, primary) => `<button type="button" data-act="${act}" style="font:inherit;padding:.6rem 1rem;border-radius:999px;cursor:pointer;`
      + `${primary ? 'border:0;background:#1c7ed6;color:#fff' : 'border:1px solid GrayText;background:Canvas;color:CanvasText'}">${label}</button>`;
    const paint = (text, buttons, note = '') => {
      box.innerHTML = `<div style="max-width:28rem;background:Canvas;color:CanvasText;border-radius:14px;padding:20px;box-shadow:0 8px 30px rgb(0 0 0 / .3)">
        <h2 style="margin:0 0 .6rem;font-size:1.2rem">WMap holt die Oberfläche jetzt aus dem Netz</h2>
        <p style="margin:0 0 .6rem">${text}</p>
        ${note ? `<p style="margin:0 0 .6rem;opacity:.8">${note}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end">${buttons}</div></div>`;
    };
    const intro = `Neues kommt so sofort an, ohne neue App. Deine ${n} Touren, Wege und Lesezeichen aus dieser App ziehen dabei nicht von selbst mit.`;
    const first = () => (inFolder
      ? paint(`${intro} Sichere sie in deinen Ordner „${esc(i.name)}“ – die neue Oberfläche holt sie von dort.`,
        button('skip', 'Ohne Sicherung weiter') + button('folder', 'In Ordner sichern', true))
      : paint(`${intro} Speichere sie einmal als ZIP und spiele sie danach unter Übersicht → Sicherung &amp; Synchronisation → „ZIP wählen“ wieder ein.`,
        button('skip', 'Ohne Sicherung weiter') + button('zip', 'ZIP speichern', true)));
    first();
    root.append(box);

    return new Promise((resolve) => {
      box.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'skip' || act === 'next') { resolve(); return; }
        if (act === 'retry') { first(); return; }
        box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          if (act === 'folder') {
            const r = await folder.sync();
            paint(`Gesichert – ${esc(syncSummary(r))}. Die neue Oberfläche holt alles aus „${esc(i.name)}“.`, button('next', 'Weiter', true));
          } else {
            const saved = await download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.zip`, await zipBackup(), 'application/zip');
            if (!saved) { first(); return; }
            paint(`Gespeichert als „${esc(saved.name ?? 'wmap-sicherung.zip')}“.`, button('next', 'Weiter', true),
              'In der neuen Oberfläche: Übersicht → Sicherung &amp; Synchronisation → „ZIP wählen“.');
          }
        } catch (err) {
          paint(`Sichern ging nicht: ${esc(err?.message ?? err)}`, button('skip', 'Ohne Sicherung weiter') + button('retry', 'Nochmal', true));
        }
      });
    });
  }
})();
