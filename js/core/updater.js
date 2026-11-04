/**
 * Aktualisieren und Prüfen – gekapselt: ein klassisches Skript ohne Imports, auf jeder Seite vor den Modulen geladen.
 * Es hängt an keiner anderen Datei der App und geht darum auch, wenn ein Update kaputt ist (Datei fehlt, Alt und Neu
 * gemischt). Eigene kurze Texte in allen Sprachen – die Sprachdateien könnten ja das Kaputte sein.
 *
 *   wmapUpdater.version()     → { version, build } vom Service Worker: gehört zu den Dateien in seinem Speicher
 *                               (sw.js VERSION, von appdata/version.py aus messages.json); ohne ihn null
 *   wmapUpdater.check()       Einstellungen → „App prüfen und neu laden“: jede gespeicherte Datei gegen ihren
 *                               Prüfwert, Kaputtes neu vom Server, neuere Fassung holen, neu laden
 *   wmapUpdater.reinstall()   Aktualisieren, wenn die Seite nicht startet: neue Fassung holen, sonst die laufende
 *                               reparieren, sonst ihren Speicher verwerfen – dann neu laden
 *   wmapUpdater.note()        Ergebnis vom letzten check() (einmal, nach dem Neuladen) → { text, ok } oder null
 *
 * Lädt ein Modul der Seite nicht (Fehler am <script type="module">, „does not provide an export named …“, import()
 * gescheitert), kommt ein eigenes Fenster „WMap konnte nicht vollständig laden“ mit „Aktualisieren“ – nur auf Klick.
 */
(() => {
  const NOTE = 'wmap.updater.note';
  const T = {
    de: { title: 'WMap konnte nicht vollständig laden', text: 'Ein Teil der App ist beschädigt oder unvollständig – meist nach einem Update. „Aktualisieren“ holt die aktuelle Version neu vom Server.', update: 'Aktualisieren', close: 'Schließen', busy: 'Wird geladen …', unavailable: 'Update noch nicht verfügbar – bitte später noch einmal versuchen.', offline: 'Kein Netz – bitte später noch einmal versuchen.', ok: '{n} Dateien geprüft – alles in Ordnung.', fixed: '{n} Dateien geprüft, {f} erneuert.', fresh: 'Die Version wurde neu vom Server geladen.', newer: 'Neue Version {v} geladen.' },
    en: { title: 'WMap could not load completely', text: 'Part of the app is damaged or incomplete – usually after an update. “Update” fetches the current version from the server again.', update: 'Update', close: 'Close', busy: 'Loading …', unavailable: 'Update not available yet – please try again later.', offline: 'No connection – please try again later.', ok: '{n} files checked – all fine.', fixed: '{n} files checked, {f} renewed.', fresh: 'The version was loaded from the server again.', newer: 'New version {v} loaded.' },
    fr: { title: 'WMap n’a pas pu se charger entièrement', text: 'Une partie de l’application est endommagée ou incomplète – généralement après une mise à jour. « Mettre à jour » recharge la version actuelle depuis le serveur.', update: 'Mettre à jour', close: 'Fermer', busy: 'Chargement …', unavailable: 'Mise à jour pas encore disponible – veuillez réessayer plus tard.', offline: 'Pas de connexion – veuillez réessayer plus tard.', ok: '{n} fichiers vérifiés – tout est en ordre.', fixed: '{n} fichiers vérifiés, {f} renouvelés.', fresh: 'La version a été rechargée depuis le serveur.', newer: 'Nouvelle version {v} chargée.' },
    pl: { title: 'Nie udało się w pełni załadować WMap', text: 'Część aplikacji jest uszkodzona lub niekompletna – zwykle po aktualizacji. „Aktualizuj” pobiera aktualną wersję ponownie z serwera.', update: 'Aktualizuj', close: 'Zamknij', busy: 'Ładowanie …', unavailable: 'Aktualizacja nie jest jeszcze dostępna – spróbuj ponownie później.', offline: 'Brak połączenia – spróbuj ponownie później.', ok: 'Sprawdzono pliki: {n} – wszystko w porządku.', fixed: 'Sprawdzono pliki: {n}, odnowiono: {f}.', fresh: 'Wersja została ponownie pobrana z serwera.', newer: 'Załadowano nową wersję {v}.' },
    sv: { title: 'WMap kunde inte laddas helt', text: 'En del av appen är skadad eller ofullständig – oftast efter en uppdatering. ”Uppdatera” hämtar den aktuella versionen från servern igen.', update: 'Uppdatera', close: 'Stäng', busy: 'Laddar …', unavailable: 'Uppdateringen är inte tillgänglig än – försök igen senare.', offline: 'Ingen anslutning – försök igen senare.', ok: '{n} filer kontrollerade – allt i ordning.', fixed: '{n} filer kontrollerade, {f} förnyade.', fresh: 'Versionen hämtades från servern igen.', newer: 'Ny version {v} laddad.' },
    nb: { title: 'WMap kunne ikke lastes helt', text: 'En del av appen er skadet eller ufullstendig – som regel etter en oppdatering. «Oppdater» henter den gjeldende versjonen fra serveren på nytt.', update: 'Oppdater', close: 'Lukk', busy: 'Laster …', unavailable: 'Oppdateringen er ikke tilgjengelig ennå – prøv igjen senere.', offline: 'Ingen tilkobling – prøv igjen senere.', ok: '{n} filer kontrollert – alt i orden.', fixed: '{n} filer kontrollert, {f} fornyet.', fresh: 'Versjonen ble hentet fra serveren på nytt.', newer: 'Ny versjon {v} lastet.' },
    da: { title: 'WMap kunne ikke indlæses helt', text: 'En del af appen er beskadiget eller ufuldstændig – som regel efter en opdatering. »Opdater« henter den aktuelle version fra serveren igen.', update: 'Opdater', close: 'Luk', busy: 'Indlæser …', unavailable: 'Opdateringen er ikke tilgængelig endnu – prøv igen senere.', offline: 'Ingen forbindelse – prøv igen senere.', ok: '{n} filer kontrolleret – alt i orden.', fixed: '{n} filer kontrolleret, {f} fornyet.', fresh: 'Versionen blev hentet fra serveren igen.', newer: 'Ny version {v} indlæst.' },
  };
  const store = (s, k, v) => { try { if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { /* gesperrt */ } return null; };
  const code = () => {
    const want = [store(localStorage, 'wmap.lang'), ...(navigator.languages ?? [navigator.language])].filter(Boolean);
    for (const w of want) { const c = String(w).slice(0, 2).toLowerCase(); if (T[c]) return c; }
    return 'en';
  };
  const say = (k, vars = {}) => T[code()][k].replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;

  /** Nachricht an den aktiven Service Worker → Antwort, null ohne ihn / nach `ms` */
  async function ask(type, ms = 3000) {
    const reg = await sw?.getRegistration().catch(() => null);
    const w = reg?.active;
    if (!w) return null;
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), ms);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      try { w.postMessage({ type }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
    });
  }

  /** Neue Fassung installieren lassen → 'new' (wartet, aktiv machen), 'none' (keine neuere), 'unavailable' (Upload unvollständig) */
  async function newer(reg) {
    let unavail = false;
    const listen = (e) => { if (e.data?.type === 'update-unavailable') unavail = true; };
    sw.addEventListener('message', listen);
    try {
      try { await reg.update(); } catch { /* ohne Netz: was schon wartet, geht trotzdem */ }
      const w = reg.waiting ?? reg.installing;
      if (!w) return 'none';
      if (w.state !== 'installed') {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 150000);
          w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); resolve(); } });
        });
      }
      if (reg.waiting) return 'new';
      return unavail ? 'unavailable' : 'none';
    } finally { sw.removeEventListener('message', listen); }
  }

  /** Wartende Fassung aktiv machen, dann neu laden */
  function activate(reg) {
    sw.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting.postMessage({ type: 'skip-waiting' });
    setTimeout(() => location.reload(), 10000);
  }

  async function dropCaches() {
    try { for (const k of await caches.keys()) if (k.startsWith('wmap-app-')) await caches.delete(k); } catch { /* gesperrt */ }
  }

  /** Prüfen, reparieren, neuere Fassung holen, neu laden → { text, ok } (wenn es nicht neu lädt) */
  async function run() {
    if (navigator.onLine === false) return { text: say('offline'), ok: false };
    const reg = await sw?.getRegistration().catch(() => null);
    if (!reg?.active) { location.reload(); return null; }
    const now = await ask('version');
    const state = await newer(reg);
    if (state === 'new') {
      const next = await new Promise((resolve) => {
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(null), 3000);
        ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        try { reg.waiting.postMessage({ type: 'version' }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
      });
      store(sessionStorage, NOTE, JSON.stringify({ text: next?.version && next.version !== now?.version ? say('newer', { v: next.version }) : say('fresh'), ok: true }));
      activate(reg);
      return null;
    }
    // Keine neue Fassung: die laufende prüfen und reparieren
    const r = await ask('repair', 120000);
    if (r && !r.error && !r.dev && r.list && !r.still?.length) {
      store(sessionStorage, NOTE, JSON.stringify({ text: r.fixed ? say('fixed', { n: r.total, f: r.fixed }) : say('ok', { n: r.total }), ok: true }));
      location.reload();
      return null;
    }
    // Auf dem Server liegt ein halber Upload: nichts verwerfen – sonst käme genau der in den Speicher
    if (state === 'unavailable') return { text: say('unavailable'), ok: false };
    if (r?.dev) { location.reload(); return null; }
    // Nicht zu reparieren (Server hat schon eine andere Fassung, Liste fehlt): Speicher verwerfen – die Dateien
    // kommen frisch vom Server, der Service Worker legt sie wieder ab
    await dropCaches();
    store(sessionStorage, NOTE, JSON.stringify({ text: say('fresh'), ok: true }));
    location.reload();
    return null;
  }

  let shown = false;
  function rescue(why) {
    if (shown || !document.body) { if (!document.body) addEventListener('DOMContentLoaded', () => rescue(why), { once: true }); return; }
    shown = true;
    const d = document.createElement('dialog');
    d.className = 'wmap-rescue';
    d.dataset.why = String(why).slice(0, 300);
    d.style.cssText = 'max-width:min(420px,calc(100vw - 32px));border:0;border-radius:16px;padding:20px;font:15px/1.45 system-ui,sans-serif;color:#1b1b1f;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.3)';
    d.innerHTML = `<h2 style="margin:0 0 8px;font-size:18px"></h2><p class="t" style="margin:0 0 12px"></p><p class="s" style="margin:0 0 12px;font-weight:600" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" value="close"></button><button type="button" value="update" style="background:#1a73e8;color:#fff;border:0;border-radius:999px;padding:8px 18px;font:inherit"></button></div>`;
    d.querySelector('h2').textContent = say('title');
    d.querySelector('.t').textContent = say('text');
    const [close, update] = d.querySelectorAll('button');
    close.textContent = say('close');
    close.style.cssText = 'background:none;border:0;padding:8px 14px;font:inherit;color:inherit';
    update.textContent = say('update');
    const status = d.querySelector('.s');
    close.onclick = () => d.close();
    update.onclick = async () => {
      update.disabled = true; close.disabled = true;
      status.hidden = false; status.textContent = say('busy');
      const r = await run().catch(() => null);
      if (r) { status.textContent = r.text; update.disabled = false; close.disabled = false; }
    };
    document.body.append(d);
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }

  const own = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };
  addEventListener('error', (e) => {
    const s = e.target;
    if (s instanceof HTMLScriptElement && s.type === 'module' && own(s.src)) rescue(`Modul ${s.src}`);
    else if (e.error instanceof SyntaxError && own(e.filename) && /export|import/i.test(e.message)) rescue(e.message);
  }, true);
  addEventListener('unhandledrejection', (e) => {
    const m = String(e.reason?.message ?? e.reason ?? '');
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported|does not provide an export|doesn't provide an export/i.test(m)) rescue(m);
  });

  window.wmapUpdater = {
    version: async () => { const r = await ask('version', 1500); return r?.version ? r : null; },
    check: () => run(),
    reinstall: () => run(),
    note: () => { const n = store(sessionStorage, NOTE); store(sessionStorage, NOTE, null); try { return n ? JSON.parse(n) : null; } catch { return null; } },
    rescue,
  };
})();
