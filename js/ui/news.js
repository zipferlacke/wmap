/**
 * Was appdata/messages.json der App zu sagen hat:
 *
 *   welcome     beim allerersten Start: Willkommen (Absätze, HTML erlaubt)
 *   changelog   nach einem Update: was neu ist – nach mehreren Sprüngen
 *               alle Versionen dazwischen; oberster Eintrag = neueste Version
 *   messages    Nachrichten an alle: { id, title, text, icon?, from?, until? }
 *               – `text` Absatz oder Liste von Absätzen (HTML erlaubt), jede
 *               Nachricht einmal, nur zwischen `from` und `until` (Datum)
 *
 * Updates (nur mit Netz – messages.json kommt dann frisch vom Server, sw.js):
 *
 *   neuere Version im changelog   Popup „Neue Version verfügbar“: Aktualisieren
 *                                 oder Später (fragt erst beim nächsten Start
 *                                 wieder). Während Navigation oder Aufzeichnung
 *                                 fragt es nicht. Ausgelassene Versionen: es geht
 *                                 gleich zur neuesten, danach die Hinweise aller
 *                                 Versionen seit der zuletzt gesehenen
 *   minVersion                    ist die Oberfläche älter: dasselbe zwingend –
 *                                 nur „Aktualisieren“, auch unterwegs
 *                                 (z. B. Server-API geändert)
 *   appVersion (je Eintrag im     die App (Tauri-Teil), die zu dieser Version
 *   changelog)                    gehört; es gilt die des neuesten Eintrags. Ist
 *                                 die installierte
 *                                 älter: Hinweis „App aktualisieren“ mit Link
 *                                 (Play Store bzw. wuefl.de), „Später“ geht. Die
 *                                 neue Oberfläche kommt so lange nicht – der neue
 *                                 Service Worker installiert sich in einer älteren
 *                                 App nicht (sw.js appCurrent). Die neue App
 *                                 muss also vor der Oberfläche zu haben sein
 *   minAppVersion                 ist die App selbst älter (Tauri-Teil, native.js
 *                                 appVersion): gesperrt – sichern (Ordner bzw.
 *                                 ZIP), dann Play Store bzw. wuefl.de; der
 *                                 Service Worker hilft da nicht
 *
 * Aktualisieren: Die Knöpfe gehen weg, das Popup zeigt den Ladebalken. Der neue Service Worker lädt beim Installieren
 * alles und meldet den Fortschritt (sw.js „update-progress“) – läuft das schon im Hintergrund, steht der Balken gleich
 * dort –, dann wird er aktiv, die Seite lädt neu. Scheitert das Laden, bleibt alles, wie es ist, und die Knöpfe kommen wieder.
 *
 * In anderen Sprachen stehen die Texte unter „news“ in der Sprachdatei: `welcome.text` [Absätze], `changes` { Version: [Punkte] },
 * `messages` { id: { title, text } }. Was dort fehlt, bleibt so, wie es in messages.json steht.
 *
 * In der Android-App folgt auf das Willkommen der Dialog zu den
 * Berechtigungen (ui/permissions.js).
 *
 * Gemerkt wird in localStorage „wmap.seen“: { version, messages: [ids] }.
 * Die Dialoge kommen nur auf der Karte beim normalen Start – öffnet ein Link
 * etwas (geteilter Ort, Route …), erst beim nächsten Mal. So bleiben auch
 * die Screenshots (takeshots, alle mit Link) frei davon. Sie kommen gleich
 * beim Start, nicht erst wenn die Karte fertig geladen ist, und nacheinander
 * (ui/dialogs.js `auto`).
 */
import { APP_VERSION } from '../core/config.js';
import { appVersion } from '../core/native.js';
import { local } from '../data/store.js';
import { ask, whenFree } from './dialogs.js';
import { esc } from '../core/geo.js';
import { theme } from '../core/theme.js';
import { statsSetting } from '../services/usage.js';
import { lang, languageAsked, languageOffer, languages, locale, setLanguage, t, textOf, ownValue } from '../core/i18n.js';

const SEEN = 'wmap.seen';
const DATE = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });

/** „1.2.10“ mit „1.10.0“ vergleichen → -1, 0, 1 */
export function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

let loaded = null;
/** messages.json vom Server – ohne Netz die gespeicherte (dann `offline: true`, sw.js) */
function load() {
  loaded ??= fetch('./appdata/messages.json', { cache: 'no-store' })
    .then(async (r) => (r.ok ? { ...(await r.json()), offline: r.headers.get('X-WMap-Offline') === '1' } : null))
    .catch(() => null);
  return loaded;
}

const LATER_APP = 'wmap.update.app.later'; // sessionStorage: Hinweis auf die neue App erst beim nächsten Start wieder
const LATER = 'wmap.update.later';     // sessionStorage: diese Version erst beim nächsten Start wieder anbieten
const UPDATED = 'wmap.update.done';    // sessionStorage: gerade aktualisiert → gleich zeigen, was neu ist
const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* gesperrt */ } },
};

/**
 * Beim Start einer Seite. `dialogs`: Willkommen, Neuigkeiten und Nachrichten
 * zeigen (nur die Karte beim normalen Start); das Banner kommt immer.
 */
/**
 * Laufende Version: vom Service Worker (sw.js VERSION) – sie gehört zu den Dateien in seinem Speicher, auch wenn ein
 * Update halb kaputt ist. Ohne ihn (erster Besuch, localhost ohne SW): config.js.
 */
export async function runningVersion() {
  const r = await window.wmapUpdater?.version?.().catch(() => null);
  return r?.version ?? APP_VERSION;
}

export async function appNews({ dialogs = false } = {}) {
  const m = await load();
  if (!m) return;
  const current = await runningVersion();
  if (!m.offline && navigator.onLine) await checkUpdates(m);
  // Gerade aktualisiert: gleich zeigen, was neu ist – auf jeder Seite
  if (session.get(UPDATED)) { session.set(UPDATED, null); dialogs = true; }
  if (!dialogs) return;

  const seen = local.get(SEEN) ?? null;
  const save = (s) => local.set(SEEN, s);
  if (!seen) {
    save({ version: current, messages: [] });
    if (m.welcome?.length) await welcome(m);
    const { permissionsHere, showPermissions } = await import('./permissions.js');
    if (permissionsHere) await showPermissions();
  } else if (compareVersions(seen.version, current) < 0) {
    save({ ...seen, version: current });
    await showChangelog(m, { since: seen.version });
  }

  await offerLanguage();
  await askStats();
  import('../services/ping.js').then(({ ping }) => ping()).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  const shown = new Set(local.get(SEEN)?.messages ?? []);
  for (const msg of m.messages ?? []) {
    if (!msg?.id || shown.has(msg.id)) continue;
    if ((msg.from && today < msg.from) || (msg.until && today > msg.until)) continue;
    await ask({
      auto: true, icon: msg.icon ?? 'campaign', title: msg.title ?? t('news.message_title'), className: 'news',
      html: paragraphs(ownValue(`news.messages.${msg.id}.text`) ?? msg.text),
      buttons: [{ value: 'ok', label: t('common.ok'), primary: true }],
    });
    shown.add(msg.id);
    // Nur Nachrichten merken, die es noch gibt – die Liste wächst sonst ewig
    const ids = new Set((m.messages ?? []).map((x) => x.id));
    save({ ...local.get(SEEN), messages: [...shown].filter((id) => ids.has(id)) });
  }
}

/** Gibt es die Sprache des Geräts: einmal anbieten, in dieser Sprache */
async function offerLanguage() {
  const offer = await languageOffer();
  if (!offer) return;
  const say = (key) => textOf(offer.texts, `common.language.${key}`, { name: offer.name });
  languageAsked();
  const pick = await ask({
    auto: true, icon: 'translate', title: say('offer_title'), className: 'news', text: say('offer_text'),
    buttons: [{ value: 'stay', label: say('stay') }, { value: 'switch', label: say('switch'), primary: true }],
  });
  if (pick === 'switch') { setLanguage(offer.code); location.reload(); }
}

/** Wer WMap schon vor der Nutzungsstatistik kannte: einmal fragen (Vorgabe: erlauben) */
async function askStats() {
  if (statsSetting.asked()) return;
  statsSetting.markAsked();
  const pick = await ask({
    auto: true, icon: 'bar_chart', title: t('settings.data.stats.title'), className: 'news',
    html: `<p>${t('news.stats.text')}</p>`,
    buttons: [{ value: 'no', label: t('news.stats.deny') }, { value: 'yes', label: t('news.stats.allow'), primary: true }],
  });
  statsSetting.set(pick !== 'no');
}

const paragraphs = (text) => [].concat(text ?? []).map((p) => `<p>${p}</p>`).join('');

async function welcome(m) {
  // Sprache und Farbschema gleich hier einstellen (wie in den Einstellungen). Neue Sprache: neu laden, dann begrüßt
  // WMap noch einmal in ihr
  const langs = await languages();
  const select = (name, title, options, value) => `<label class="news-choice">
      <span>${title}</span>
      <select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </label>`;
  const choices = `<div class="news-choices">
      ${langs.length > 1 ? select('language', t('settings.look.language.title'), langs.map((l) => [l.code, l.name]), lang) : ''}
      ${select('theme', t('settings.look.theme.title'), ['system', 'light', 'dark'].map((v) => [v, t(`settings.look.theme.options.${v}`)]), theme.get())}
      <label class="news-stats">
        <input type="checkbox" name="stats" ${statsSetting.get() ? 'checked' : ''}>
        <span><strong>${t('settings.data.stats.title')}</strong><small>${t('settings.data.stats.hint')}</small></span>
      </label>
    </div>`;
  // Gefragt ist mit der Begrüßung – vorher zählt und schickt WMap nichts (services/usage.js)
  statsSetting.markAsked();
  return ask({
    auto: true, icon: 'waving_hand', title: t('news.welcome.title'), className: 'news',
    html: `${choices}${paragraphs(ownValue('news.welcome.text') ?? m.welcome)}<p class="news-version">${t('news.version', { version: esc(await runningVersion()) })}</p>`,
    buttons: [{ value: 'ok', label: t('news.welcome.go'), icon: 'map', primary: true }],
    setup: (dlg) => dlg.querySelector('.news-choices').addEventListener('change', (e) => {
      if (e.target.name === 'theme') theme.set(e.target.value);
      if (e.target.name === 'stats') statsSetting.set(e.target.checked);
      if (e.target.name !== 'language') return;
      setLanguage(e.target.value);
      local.set(SEEN, null);
      location.reload();
    }),
  });
}

/**
 * Was neu ist. `since`: nur Versionen danach bis zu dieser App (nach einem
 * Update), sonst alle (z. B. aus der Übersicht).
 */
export async function showChangelog(m = null, { since = null } = {}) {
  m ??= await load();
  const current = await runningVersion();
  const list = (m?.changelog ?? []).filter((v) => compareVersions(v.version, current) <= 0
    && (since === null || compareVersions(v.version, since) > 0));
  if (!list.length) return;
  const title = since === null ? t('news.changelog.all')
    : list.length === 1 ? t('news.changelog.one', { version: list[0].version }) : t('news.changelog.since', { version: since });
  await ask({
    auto: since !== null, icon: 'new_releases', title, className: 'news',
    html: list.map((v) => `<section class="news-release">
        <h3>${t('news.version', { version: esc(v.version) })}${v.date ? ` <small>${DATE.format(new Date(v.date))}</small>` : ''}</h3>
        <ul>${(ownValue('news.changes')?.[v.version] ?? v.changes).map((c) => `<li>${c}</li>`).join('')}</ul>
      </section>`).join(''),
    buttons: [{ value: 'ok', label: t('common.ok'), primary: true }],
  });
}

/* ── Updates ──────────────────────────────────────────────────────────────── */

/** Neue Version? Zwingend bei minVersion bzw. minAppVersion (die Popups gehen dann nicht zu). */
export async function checkUpdates(m) {
  const latest = m.changelog?.[0]?.version ?? null;
  const current = await runningVersion();
  const app = await appVersion();
  if (app && m.minAppVersion && compareVersions(app, m.minAppVersion) < 0) return appRequired(m.minAppVersion);
  // Die App ist nicht die aktuelle: erst sie, dann die Oberfläche – das Web-Update wird nicht angeboten
  // Die App, die zur neuesten Version gehört (steht an jedem Eintrag im changelog)
  const want = m.changelog?.find((e) => e.appVersion)?.appVersion;
  if (app && want && compareVersions(app, want) < 0) {
    // Geht die Oberfläche hier gar nicht mehr (minVersion), führt kein Weg an der neuen App vorbei
    if (m.minVersion && compareVersions(current, m.minVersion) < 0) return appRequired(want);
    return session.get(LATER_APP) === want ? null : appHint(app, want);
  }
  if (m.minVersion && compareVersions(current, m.minVersion) < 0) return uiUpdate(latest, { forced: true, current });
  if (latest && compareVersions(current, latest) < 0 && session.get(LATER) !== latest) return uiUpdate(latest, { forced: false, current });
  return null;
}

/**
 * Popup, das man nicht wegklicken kann (zwingend) bzw. mit „Später“.
 * `buttons`: [{ value, label, icon?, primary? }], `onPick(value, dlg)` – gibt
 * sie true zurück, schließt das Popup.
 */
async function updateDialog({ icon, title, html, buttons, closable, onPick }) {
  await whenFree();
  document.getElementById('update-dialog')?.uDFinish?.('close');
  return ask({
    id: 'update-dialog', className: 'news', icon, title, closable,
    html: `${html}<p class="update-status" hidden></p>`,
    // Jeder Knopf fragt erst onPick – das Popup schließt nur, wenn es true liefert
    buttons: buttons.map((b) => ({ ...b, run: async (dlg, done) => { if (await onPick(b.value, dlg)) done(b.value); } })),
  });
}

const status = (dlg, text) => { const p = dlg.querySelector('.update-status'); p.hidden = !text; p.textContent = text ?? ''; };
const busy = (dlg, on) => dlg.querySelectorAll('button').forEach((b) => { b.disabled = on; });

/* Neu laden unterbräche das – dann beim nächsten Start */
async function underway() {
  if (document.body.classList.contains('navigating')) return true;
  const { recorder } = await import('../data/tracks.js');
  return !!recorder.active;
}

/** Steht eine neuere Nummer an? Die kommt nur über „Aktualisieren“ (data/offline.js freshOnOpen) */
export async function versionOffered() {
  const latest = (await load())?.changelog?.[0]?.version;
  return !!latest && compareVersions(await runningVersion(), latest) < 0;
}

/** Neue Oberfläche: „Neue Version verfügbar“ (mit Später) bzw. zwingend; nach „Aktualisieren“ nur noch der Ladebalken */
async function uiUpdate(latest, { forced, current = APP_VERSION }) {
  await whenFree();
  if (!forced && await underway()) return null;
  const buttons = forced ? [{ value: 'update', label: t('news.update.button'), icon: 'system_update', primary: true }]
    : [{ value: 'later', label: t('common.later') }, { value: 'update', label: t('news.update.button'), icon: 'system_update', primary: true }];
  return updateDialog({
    icon: 'system_update',
    title: forced ? t('news.update.forced_title') : t('news.update.title'),
    html: `<p class="update-text">${forced ? t('news.update.forced_text', { version: esc(current) })
      : t('news.update.text', { version: esc(latest ?? '') })}</p>
      <div class="update-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i></i></div>`,
    buttons, closable: false,
    onPick: async (v, dlg) => {
      if (v === 'later') { session.set(LATER, latest); return true; }
      const actions = dlg.querySelector('.confirm-actions');
      const text = dlg.querySelector('.update-text');
      const before = text.textContent;
      const bar = dlg.querySelector('.update-bar');
      actions.style.display = 'none';
      text.textContent = t('news.update.loading', { version: latest ?? '' });
      bar.hidden = false;
      status(dlg, t('news.update.moment'));
      // Passt auf dem Server nicht alles zur neuen Fassung (Upload unvollständig), installiert sie sich nicht (sw.js)
      let unavailable = false;
      const onProgress = (e) => {
        if (e.data?.type === 'update-unavailable') unavailable = true;
        if (e.data?.type !== 'update-progress' || !e.data.total) return;
        const pct = Math.round((e.data.done / e.data.total) * 100);
        bar.setAttribute('aria-valuenow', pct);
        bar.querySelector('i').style.width = `${pct}%`;
        status(dlg, t('news.update.percent', { pct }));
      };
      navigator.serviceWorker?.addEventListener('message', onProgress);
      if (!await applyUpdate()) {
        navigator.serviceWorker?.removeEventListener('message', onProgress);
        actions.style.display = '';
        text.textContent = before;
        bar.hidden = true;
        status(dlg, t(unavailable ? 'news.update.unavailable' : 'news.update.failed'));
      }
      return false;
    },
  });
}

/**
 * Neuen Service Worker aktiv machen und neu laden → true, wenn neu geladen wird. Gibt es keinen neuen (sw.js nicht
 * geändert?), die gespeicherte Oberfläche verwerfen – dann kommt sie frisch. Scheitert das Laden (kein Netz,
 * Abbruch): false – die gespeicherte Oberfläche bleibt, ohne sie ginge offline nichts mehr.
 */
export async function applyUpdate() {
  session.set(UPDATED, '1');
  const failed = () => { session.set(UPDATED, null); return false; };
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (reg) {
    // Ohne Netz: Was schon fertig geladen wartet, geht trotzdem
    try { await reg.update(); } catch { if (!reg.waiting && !reg.installing) return failed(); }
    const loading = reg.installing;
    const worker = reg.waiting ?? await installed(loading, 120000);
    if (worker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage({ type: 'skip-waiting' });
      setTimeout(() => location.reload(), 10000);
      return true;
    }
    if (loading) return failed();
  }
  try { for (const k of await caches.keys()) if (k.startsWith('wmap-app-')) await caches.delete(k); } catch { /* gesperrt */ }
  location.reload();
  return true;
}

/** Wartet, bis ein Service Worker fertig installiert ist → er oder null */
function installed(worker, ms) {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') { clearTimeout(timer); resolve(worker); }
      if (worker.state === 'redundant') { clearTimeout(timer); resolve(null); }
    });
  });
}

const STORE = 'https://play.google.com/store/apps/details?id=de.wuefl.wmap';
const SITE = 'https://wuefl.de/wmap/#download';

const openStore = (android) => {
  const url = android ? STORE : SITE;
  const core = window.__TAURI__?.core;
  if (core) core.invoke('plugin:browser|open', { url, external: true }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
};

/**
 * Es gibt eine neuere App (Tauri-Teil) als die installierte: Hinweis mit Link, „Später“ geht. Die neue
 * Oberfläche kommt erst nach dem Update der App (sw.js appCurrent).
 */
function appHint(app, want) {
  const android = /Android/i.test(navigator.userAgent);
  return updateDialog({
    icon: 'system_update',
    title: t('news.app.title'),
    html: `<p>${t('news.app.text', { want: esc(want), app: esc(app), where: t(android ? 'news.app.via_store' : 'news.app.via_site') })}</p>`,
    buttons: [
      { value: 'later', label: t('common.later') },
      { value: 'open', label: android ? t('news.app.to_store') : t('news.app.to_site'), icon: 'open_in_new', primary: true },
    ],
    closable: true,
    onPick: async (v) => {
      if (v === 'later') { session.set(LATER_APP, want); return true; }
      openStore(android);
      return false;
    },
  });
}

/**
 * Die App selbst ist zu alt (Tauri-Teil): gesperrt. Erst sichern (Ordner bzw.
 * ZIP), dann Play Store bzw. Download-Seite – das Popup bleibt, bis die neue
 * App installiert ist.
 */
async function appRequired(min) {
  const { folder, zipBackup, syncSummary } = await import('../data/folder.js');
  const { download } = await import('../data/store.js');
  const i = await folder.info().catch(() => null);
  const inFolder = !!(i?.connected && i.permission === 'granted');
  const android = /Android/i.test(navigator.userAgent);
  return updateDialog({
    icon: 'system_update',
    title: t('news.app.required_title'),
    html: `<p>${t('news.app.required_text', { min: esc(min), where: t(android ? 'news.app.via_store' : 'news.app.via_site') })}</p>`,
    buttons: [
      { value: 'backup', label: inFolder ? t('backup.to_folder', { name: i.name }) : t('backup.to_zip'), icon: 'save' },
      { value: 'open', label: android ? t('news.app.to_store') : t('news.app.to_site'), icon: 'open_in_new', primary: true },
    ],
    closable: false,
    onPick: async (v, dlg) => {
      if (v === 'backup') {
        busy(dlg, true);
        try {
          if (inFolder) status(dlg, t('backup.done', { summary: syncSummary(await folder.sync()) }));
          else {
            status(dlg, t('backup.creating'));
            const saved = await download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.zip`, await zipBackup(), 'application/zip');
            status(dlg, saved ? t('backup.saved_as', { name: saved.name ?? 'wmap-sicherung.zip' }) : null);
          }
        } catch (err) { status(dlg, t('backup.failed', { reason: err.message })); }
        busy(dlg, false);
        return false;
      }
      openStore(android);
      return false;
    },
  });
}
