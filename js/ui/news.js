/**
 * Was appdata/messages.json der App zu sagen hat:
 *
 *   welcome     beim allerersten Start: Willkommen (Absätze, HTML erlaubt)
 *   changelog   nach einem Update: was neu ist – nach mehreren Sprüngen
 *               alle Versionen dazwischen; oberster Eintrag = neueste Version
 *   messages    Nachrichten an alle: { id, title, text, icon?, from?, until? }
 *               – `text` Absatz oder Liste von Absätzen (HTML erlaubt), jede
 *               Nachricht einmal, nur zwischen `from` und `until` (Datum)
 *   minVersion  ist diese App älter: Banner „Aktualisieren“ auf jeder Seite –
 *               lädt die neue Version über den Service Worker
 *
 * Gemerkt wird in localStorage „wmap.seen“: { version, messages: [ids] }.
 * Die Dialoge kommen nur auf der Karte beim normalen Start – öffnet ein Link
 * etwas (geteilter Ort, Route …), erst beim nächsten Mal. So bleiben auch
 * die Screenshots (takeshots, alle mit Link) frei davon.
 */
import { APP_VERSION } from '../core/config.js';
import { local } from '../data/store.js';
import { ask, toast } from './dialogs.js';
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
/** messages.json vom Server – ohne Netz die gespeicherte (Service Worker) */
function load() {
  loaded ??= fetch('./appdata/messages.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return loaded;
}

/**
 * Beim Start einer Seite. `dialogs`: Willkommen, Neuigkeiten und Nachrichten
 * zeigen (nur die Karte beim normalen Start); das Banner kommt immer.
 */
export async function appNews({ dialogs = false } = {}) {
  const m = await load();
  if (!m) return;
  if (m.minVersion && compareVersions(APP_VERSION, m.minVersion) < 0) updateBanner(m.changelog?.[0]?.version);
  if (!dialogs) return;

  const seen = local.get(SEEN) ?? null;
  const save = (s) => local.set(SEEN, s);
  if (!seen) {
    save({ version: APP_VERSION, messages: [] });
    if (m.welcome?.length) await welcome(m);
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

/* ── Zu alte Version: Banner „Aktualisieren“ ──────────────────────────────── */

function updateBanner(latest) {
  if (document.getElementById('update-banner')) return;
  const el = document.createElement('div');
  el.id = 'update-banner';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<span class="msr">system_update</span>
    <span>Es gibt eine neue Version${latest ? ` (${esc(latest)})` : ''} – diese hier wird nicht mehr unterstützt.</span>
    <button type="button" class="button primary">Aktualisieren</button>`;
  el.querySelector('button').addEventListener('click', updateNow);
  document.body.append(el);
}

/**
 * Neue Version laden: Service Worker nachsehen lassen, die gespeicherten
 * App-Dateien verwerfen und neu laden – Karten und Daten bleiben.
 * In der App (Tauri) geht es dabei wieder zur Webversion (tauri-start.js).
 */
export async function updateNow() {
  if (!navigator.onLine) { toast('Zum Aktualisieren braucht es Netz'); return; }
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* dann eben ohne */ }
  try { for (const k of await caches.keys()) if (k.startsWith('wmap-app-')) await caches.delete(k); } catch { /* ebenso */ }
  try { sessionStorage.removeItem('wmap.local'); } catch { /* gesperrt */ }
  location.reload();
}
