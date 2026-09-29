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
 *                                 wieder). Ausgelassene Versionen: es geht
 *                                 gleich zur neuesten, danach die Hinweise
 *                                 aller Versionen seit der zuletzt gesehenen
 *   minVersion                    ist die Oberfläche älter: dasselbe zwingend –
 *                                 nur „Aktualisieren“ (z. B. Server-API geändert)
 *   minAppVersion                 ist die App selbst älter (Tauri-Teil, native.js
 *                                 appVersion): gesperrt – sichern (Ordner bzw.
 *                                 ZIP), dann Play Store bzw. wuefl.de; der
 *                                 Service Worker hilft da nicht
 *
 * Aktualisieren: der neue Service Worker (lädt beim Installieren alles) wird
 * aktiv, die Seite lädt neu.
 *
 * In der Android-App folgt auf das Willkommen der Dialog zu den
 * Berechtigungen (ui/permissions.js).
 *
 * Gemerkt wird in localStorage „wmap.seen“: { version, messages: [ids] }.
 * Die Dialoge kommen nur auf der Karte beim normalen Start – öffnet ein Link
 * etwas (geteilter Ort, Route …), erst beim nächsten Mal. So bleiben auch
 * die Screenshots (takeshots, alle mit Link) frei davon.
 */
import { APP_VERSION } from '../core/config.js';
import { appVersion } from '../core/native.js';
import { local } from '../data/store.js';
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';

const SEEN = 'wmap.seen';
const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

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
export async function appNews({ dialogs = false } = {}) {
  const m = await load();
  if (!m) return;
  if (!m.offline && navigator.onLine) await checkUpdates(m);
  // Gerade aktualisiert: gleich zeigen, was neu ist – auf jeder Seite
  if (session.get(UPDATED)) { session.set(UPDATED, null); dialogs = true; }
  if (!dialogs) return;

  const seen = local.get(SEEN) ?? null;
  const save = (s) => local.set(SEEN, s);
  if (!seen) {
    save({ version: APP_VERSION, messages: [] });
    if (m.welcome?.length) await welcome(m);
    const { permissionsHere, showPermissions } = await import('./permissions.js');
    if (permissionsHere) await showPermissions();
  } else if (compareVersions(seen.version, APP_VERSION) < 0) {
    save({ ...seen, version: APP_VERSION });
    await showChangelog(m, { since: seen.version });
  }

  const today = new Date().toISOString().slice(0, 10);
  const shown = new Set(local.get(SEEN)?.messages ?? []);
  for (const msg of m.messages ?? []) {
    if (!msg?.id || shown.has(msg.id)) continue;
    if ((msg.from && today < msg.from) || (msg.until && today > msg.until)) continue;
    await ask({
      icon: msg.icon ?? 'campaign', title: msg.title ?? 'Neuigkeit', className: 'news',
      html: paragraphs(msg.text),
      buttons: [{ value: 'ok', label: 'OK', primary: true }],
    });
    shown.add(msg.id);
    // Nur Nachrichten merken, die es noch gibt – die Liste wächst sonst ewig
    const ids = new Set((m.messages ?? []).map((x) => x.id));
    save({ ...local.get(SEEN), messages: [...shown].filter((id) => ids.has(id)) });
  }
}

const paragraphs = (text) => [].concat(text ?? []).map((p) => `<p>${p}</p>`).join('');

function welcome(m) {
  return ask({
    icon: 'waving_hand', title: 'Willkommen bei WMap', className: 'news',
    html: `${paragraphs(m.welcome)}<p class="news-version">Version ${esc(APP_VERSION)}</p>`,
    buttons: [{ value: 'ok', label: 'Los geht’s', icon: 'map', primary: true }],
  });
}

/**
 * Was neu ist. `since`: nur Versionen danach bis zu dieser App (nach einem
 * Update), sonst alle (z. B. aus der Übersicht).
 */
export async function showChangelog(m = null, { since = null } = {}) {
  m ??= await load();
  const list = (m?.changelog ?? []).filter((v) => compareVersions(v.version, APP_VERSION) <= 0
    && (since === null || compareVersions(v.version, since) > 0));
  if (!list.length) return;
  const title = since === null ? 'Was es in WMap gibt'
    : list.length === 1 ? `Neu in WMap ${list[0].version}` : `Neu seit Version ${since}`;
  await ask({
    icon: 'new_releases', title, className: 'news',
    html: list.map((v) => `<section class="news-release">
        <h3>Version ${esc(v.version)}${v.date ? ` <small>${DATE.format(new Date(v.date))}</small>` : ''}</h3>
        <ul>${v.changes.map((c) => `<li>${c}</li>`).join('')}</ul>
      </section>`).join(''),
    buttons: [{ value: 'ok', label: 'OK', primary: true }],
  });
}

/* ── Updates ──────────────────────────────────────────────────────────────── */

/** Neue Version? Zwingend bei minVersion bzw. minAppVersion (die Popups gehen dann nicht zu). */
export async function checkUpdates(m) {
  const latest = m.changelog?.[0]?.version ?? null;
  const app = await appVersion();
  if (app && m.minAppVersion && compareVersions(app, m.minAppVersion) < 0) return appRequired(m.minAppVersion);
  if (m.minVersion && compareVersions(APP_VERSION, m.minVersion) < 0) return uiUpdate(latest, { forced: true });
  if (latest && compareVersions(APP_VERSION, latest) < 0 && session.get(LATER) !== latest) {
    // Schon im Hintergrund laden – „Aktualisieren“ geht dann schneller
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    return uiUpdate(latest, { forced: false });
  }
  return null;
}

/**
 * Popup, das man nicht wegklicken kann (zwingend) bzw. mit „Später“.
 * `buttons`: [{ value, label, icon?, primary? }], `onPick(value, dlg)` – gibt
 * sie true zurück, schließt das Popup.
 */
function updateDialog({ icon, title, html, buttons, closable, onPick }) {
  return new Promise((resolve) => {
    document.getElementById('update-dialog')?.remove();
    const dlg = document.createElement('dialog');
    dlg.id = 'update-dialog';
    dlg.className = 'dialog confirm news';
    dlg.innerHTML = `<h2><span class="msr">${esc(icon)}</span> ${esc(title)}</h2>${html}
      <p class="update-status" hidden></p>
      <div class="confirm-actions">${buttons.map((b) => `
        <button type="button" class="button${b.primary ? ' primary' : ''}" value="${esc(b.value)}">
          ${b.icon ? `<span class="msr">${esc(b.icon)}</span> ` : ''}${esc(b.label)}</button>`).join('')}</div>`;
    document.body.append(dlg);
    // Escape schließt nur, wenn es nicht zwingend ist
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (closable) { dlg.close(); dlg.remove(); resolve(null); } });
    dlg.addEventListener('click', async (e) => {
      const b = e.target.closest('.confirm-actions button[value]');
      if (!b) return;
      if (await onPick(b.value, dlg)) { dlg.close(); dlg.remove(); resolve(b.value); }
    });
    dlg.showModal();
  });
}

const status = (dlg, text) => { const p = dlg.querySelector('.update-status'); p.hidden = !text; p.textContent = text ?? ''; };
const busy = (dlg, on) => dlg.querySelectorAll('button').forEach((b) => { b.disabled = on; });

/** Neue Oberfläche: „Neue Version verfügbar“ (mit Später) bzw. zwingend */
function uiUpdate(latest, { forced }) {
  const buttons = forced ? [{ value: 'update', label: 'Aktualisieren', icon: 'system_update', primary: true }]
    : [{ value: 'later', label: 'Später' }, { value: 'update', label: 'Aktualisieren', icon: 'system_update', primary: true }];
  return updateDialog({
    icon: 'system_update',
    title: forced ? 'Update nötig' : 'Neue Version verfügbar',
    html: `<p>${forced ? `Diese Version von WMap (${esc(APP_VERSION)}) funktioniert so nicht mehr – bitte aktualisieren, das dauert nur einen Moment.`
      : `WMap ${esc(latest ?? '')} ist da. Jetzt aktualisieren? Danach siehst du, was neu ist.`}</p>`,
    buttons, closable: !forced,
    onPick: async (v, dlg) => {
      if (v === 'later') { session.set(LATER, latest); return true; }
      busy(dlg, true);
      status(dlg, 'Lade die neue Version …');
      await applyUpdate();
      return false;
    },
  });
}

/**
 * Neuen Service Worker aktiv machen und neu laden. Gibt es keinen neuen (sw.js
 * nicht geändert?), die gespeicherte Oberfläche verwerfen – dann kommt sie frisch.
 */
export async function applyUpdate() {
  session.set(UPDATED, '1');
  session.set(LATER, null);
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (reg) {
    try { await reg.update(); } catch { /* ohne Netz: unten */ }
    const worker = reg.waiting ?? await installed(reg.installing, 60000);
    if (worker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage({ type: 'skip-waiting' });
      setTimeout(() => location.reload(), 10000);
      return;
    }
  }
  try { for (const k of await caches.keys()) if (k.startsWith('wmap-app-')) await caches.delete(k); } catch { /* gesperrt */ }
  location.reload();
}

/** Wartet, bis ein Service Worker fertig installiert ist → er oder null */
function installed(worker, ms) {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') { clearTimeout(t); resolve(worker); }
      if (worker.state === 'redundant') { clearTimeout(t); resolve(null); }
    });
  });
}

const STORE = 'https://play.google.com/store/apps/details?id=de.wuefl.wmap';
const SITE = 'https://wuefl.de/wmap/#download';

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
    title: 'WMap-App aktualisieren',
    html: `<p>Diese Version braucht eine neuere WMap-App (mindestens ${esc(min)}). Sichere vorher deine Daten, dann aktualisiere ${android ? 'im Play Store' : 'über wuefl.de'}.</p>`,
    buttons: [
      { value: 'backup', label: inFolder ? `In „${i.name}“ sichern` : 'Als ZIP sichern', icon: 'save' },
      { value: 'open', label: android ? 'Zum Play Store' : 'Zur Download-Seite', icon: 'open_in_new', primary: true },
    ],
    closable: false,
    onPick: async (v, dlg) => {
      if (v === 'backup') {
        busy(dlg, true);
        try {
          if (inFolder) status(dlg, `Gesichert – ${syncSummary(await folder.sync())}`);
          else {
            status(dlg, 'Erstelle die Sicherung …');
            const saved = await download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.zip`, await zipBackup(), 'application/zip');
            status(dlg, saved ? `Gespeichert als „${saved.name ?? 'wmap-sicherung.zip'}“` : null);
          }
        } catch (err) { status(dlg, `Sichern ging nicht: ${err.message}`); }
        busy(dlg, false);
        return false;
      }
      const url = android ? STORE : SITE;
      const core = window.__TAURI__?.core;
      if (core) core.invoke('plugin:browser|open', { url, external: true }).catch(() => window.open(url, '_blank'));
      else window.open(url, '_blank');
      return false;
    },
  });
}
