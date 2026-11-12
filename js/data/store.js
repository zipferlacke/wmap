/**
 * Alles, was im Browser bleibt: zuletzt Genutztes und Touren.
 *
 * localStorage kann fehlen oder werfen (privates Fenster, gesperrte Daten) –
 * dann läuft alles weiter, nur ohne Gedächtnis. Touren wandern später nach
 * Supabase; bis dahin reicht der Browser.
 */
import { encodePolyline, decodePolyline } from '../core/geo.js';
import { store } from './db.js';
import { t } from '../core/i18n-text.js';

/*
 * Gemeinsam mit dem Service Worker: Der Abgleich (data/folder.js, services/health.js) läuft dort weiter, auch wenn
 * man die Seite wechselt (js/sw/sync.js) – localStorage gibt es dort nicht. Was er liest und schreibt (SHARED), liegt
 * darum zusätzlich in IndexedDB („local“: { id: Schlüssel, raw: Text wie im localStorage oder null, at }):
 *   Seite      schreibt localStorage und die Kopie, sagt es dem Service Worker; beim Laden gleicht sie ab – je
 *              Schlüssel gilt das Neuere (Zeitstempel in „wmap~at“), Fehlendes kommt in die Kopie
 *   Service Worker  liest und schreibt nur die Kopie (im Speicher, vor jedem Abgleich neu geladen) und meldet jede
 *              Änderung den offenen Seiten („local“), die sie in ihren localStorage übernehmen
 */
export const inSw = typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope;
const SHARED = new Set([
  'wmap.tours', 'wmap.saved', 'wmap.folder.deleted', 'wmap.folder.revived', 'wmap.tracks.keep', 'wmap.sync.auto',
  'wmap.health.sync', 'wmap.health.auto', 'wmap.health.gone', 'wmap.health.asked', 'wmap.history',
  // Einstellungen, die der Ordner zwischen Geräten abgleicht (data/folder.js SETTINGS)
  'wmap.theme', 'wmap.nav.zoom', 'wmap.nav.3d', 'wmap.voice', 'wmap.muted', 'wmap.offline', 'wmap.datasaver',
  'wmap.contribute', 'wmap.osm.anon', 'wmap.routePrefs', 'wmap.profile', 'wmap.myname', 'wmap.lapsize', 'wmap.chart',
  'wmap.tankerkoenig', 'wmap.units', 'wmap.clock',
]);
const AT = 'wmap~at';
const copy = store('local');
const mem = new Map();          // Service Worker: die Kopie im Speicher
let lastAt = 0;
const nextAt = () => (lastAt = Math.max(Date.now(), lastAt + 1));

function readRaw(key) {
  if (inSw) return mem.get(key)?.raw ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}
const stamps = () => { try { return JSON.parse(localStorage.getItem(AT)) ?? {}; } catch { return {}; } };
function stamp(key, at) {
  const s = stamps();
  s[key] = at;
  try { localStorage.setItem(AT, JSON.stringify(s)); } catch { /* gesperrt */ }
}

/** Geschrieben: in die Kopie und zur anderen Seite (Service Worker bzw. offene Seiten) */
function share(key, raw) {
  if (!SHARED.has(key)) return;
  const row = { id: key, raw, at: nextAt() };
  if (inSw) {
    mem.set(key, row);
    copy.put(row).catch(() => {});
    tellPages({ type: 'local', row });
    return;
  }
  stamp(key, row.at);
  copy.put(row).catch(() => {});
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'local', row }); } catch { /* ohne Service Worker */ }
}

function writeRaw(key, raw) {
  if (inSw) { share(key, raw); return true; }
  try {
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
  } catch { return false; }
  share(key, raw);
  return true;
}

export const local = {
  get(key, fallback = null) {
    try {
      const v = readRaw(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) { return writeRaw(key, JSON.stringify(value)); },
  /** Roh wie im localStorage (Text) – für den Abgleich der Einstellungen */
  raw: (key) => readRaw(key),
  setRaw: (key, raw) => writeRaw(key, raw),
};

/** Service Worker: an alle offenen Seiten */
export function tellPages(msg) {
  if (!inSw) return;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage(msg))).catch(() => {});
}

/**
 * Service Worker: die Kopie neu laden (vor jedem Abgleich – die Seiten schreiben dazwischen).
 * Seite: abgleichen – Neueres aus der Kopie übernehmen, Neueres von hier hineinschreiben. → geänderte Schlüssel
 */
export async function localReady() {
  const rows = await copy.all().catch(() => []);
  if (inSw) {
    for (const r of rows) if ((mem.get(r.id)?.at ?? 0) <= r.at) mem.set(r.id, r);
    return [];
  }
  const s = stamps(), by = new Map(rows.map((r) => [r.id, r])), took = [];
  for (const r of rows) if (SHARED.has(r.id) && r.at > (s[r.id] ?? 0) && takeRow(r, s)) took.push(r.id);
  for (const key of SHARED) {
    const r = by.get(key), raw = readRaw(key);
    // Noch nie kopiert (erster Start mit dieser Fassung): mit Stand 1 – alles aus dem Service Worker ist neuer
    if (!r) { if (raw !== null) copy.put({ id: key, raw, at: s[key] ?? 1 }).catch(() => {}); continue; }
    if (took.includes(key) || raw === r.raw) continue;
    // Hier anders: neuer gespeichert – oder an `local` vorbei direkt in den localStorage (Stimme, Thema …)
    const at = (s[key] ?? 0) > r.at ? s[key] : nextAt();
    s[key] = at;
    copy.put({ id: key, raw, at }).catch(() => {});
  }
  try { localStorage.setItem(AT, JSON.stringify(s)); } catch { /* gesperrt */ }
  return took;
}

/** Eine Zeile aus der Kopie in den localStorage (`s`: Zeitstempel, werden mitgeführt) */
function takeRow(r, s) {
  try {
    if (r.raw === null) localStorage.removeItem(r.id); else localStorage.setItem(r.id, r.raw);
  } catch { return false; }
  s[r.id] = r.at;
  return true;
}

/** Eine Änderung von der anderen Seite: Seite → localStorage, Service Worker → Speicher. → übernommen? */
export function takeShared(row) {
  if (!row?.id || !SHARED.has(row.id)) return false;
  if (inSw) {
    if ((mem.get(row.id)?.at ?? 0) >= row.at) return false;
    mem.set(row.id, row);
    return true;
  }
  const s = stamps();
  if ((s[row.id] ?? 0) >= row.at) return false;
  if (!takeRow(row, s)) return false;
  try { localStorage.setItem(AT, JSON.stringify(s)); } catch { /* gesperrt */ }
  return true;
}

/* ── Zuletzt genutzt ──────────────────────────────────────────────────────── */

const RECENT_KEY = 'wmap.recent';
const RECENT_MAX = 8;

/**
 * Einträge: { kind: 'place'|'category'|'route', title, subtitle, icon, … }
 * Der gleiche Eintrag rutscht nach vorn statt doppelt aufzutauchen.
 */
export const recent = {
  list(kind = null) {
    const all = local.get(RECENT_KEY, []);
    return kind ? all.filter((e) => (Array.isArray(kind) ? kind.includes(e.kind) : e.kind === kind)) : all;
  },
  add(entry) {
    const key = recentKey(entry);
    const all = local.get(RECENT_KEY, []).filter((e) => recentKey(e) !== key);
    all.unshift({ ...entry, at: Date.now() });
    local.set(RECENT_KEY, all.slice(0, RECENT_MAX * 3));
  },
  remove(entry) {
    const key = recentKey(entry);
    local.set(RECENT_KEY, local.get(RECENT_KEY, []).filter((e) => recentKey(e) !== key));
  },
  clear() { local.set(RECENT_KEY, []); },
  /**
   * Mit einer zweiten Liste zusammenführen (App und Android Auto,
   * data/car-share.js): je Eintrag der neuere, neueste zuerst
   * → { list, changed (hier kam etwas dazu) }
   */
  merge(other) {
    const mine = local.get(RECENT_KEY, []);
    const by = new Map();
    for (const e of [...mine, ...other]) {
      if (!e?.kind) continue;
      const k = recentKey(e);
      if (!by.has(k) || (e.at ?? 0) > (by.get(k).at ?? 0)) by.set(k, e);
    }
    const list = [...by.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, RECENT_MAX * 3);
    const changed = JSON.stringify(list) !== JSON.stringify(mine);
    if (changed) local.set(RECENT_KEY, list);
    return { list, changed };
  },
};

function recentKey(e) {
  if (e.kind === 'route') return `route|${e.from?.label}|${e.to?.label}|${e.profile}`;
  if (e.kind === 'category') return `category|${e.category}|${e.place ?? ''}`;
  return `place|${e.title}|${e.point?.map((v) => v.toFixed(4))}`;
}

/* ── Touren ───────────────────────────────────────────────────────────────── */

const TOURS_KEY = 'wmap.tours';

/** Wege und Touren haben sich geändert – z. B. für den Ordner-Abgleich (data/folder.js). */
export const changed = (detail) => dispatchEvent(new CustomEvent('wmap:data', { detail }));

/**
 * Tour: { id, name, description, profile, points: [[lon, lat]], shape (Polyline5),
 *         stats: { length, time, ascent, descent }, preview (Data-URL), created, updated,
 *         fixed: true – Verlauf steht fest (bekannter Weg, GPX), nicht neu rechnen }
 */
export const tours = {
  all() {
    return local.get(TOURS_KEY, []).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  },
  get(id) { return this.all().find((t) => t.id === id) ?? null; },
  save(tour) {
    const list = local.get(TOURS_KEY, []);
    const i = list.findIndex((t) => t.id === tour.id);
    const next = { ...tour, updated: Date.now(), created: tour.created ?? Date.now() };
    if (i >= 0) list[i] = next; else list.push(next);
    const saved = this.put(next, list);
    changed({ kind: 'tour', id: next.id });
    return saved;
  },
  /** Speichern, wie sie ist (updated bleibt) – für den Abgleich */
  put(tour, list = null) {
    if (!list) {
      list = local.get(TOURS_KEY, []);
      const i = list.findIndex((t) => t.id === tour.id);
      if (i >= 0) list[i] = tour; else list.push(tour);
    }
    if (local.set(TOURS_KEY, list)) return tour;
    // Voll? Dann ohne Vorschaubild versuchen – das ist der größte Posten
    const slim = list.map((t) => (t.id === tour.id ? { ...t, preview: null } : t));
    if (local.set(TOURS_KEY, slim)) return { ...tour, preview: null };
    throw new Error(t('tracks.error.storage_full'));
  },
  remove(id) {
    local.set(TOURS_KEY, local.get(TOURS_KEY, []).filter((t) => t.id !== id));
    changed({ kind: 'tour', id, removed: true });
  },
  newId() { return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; },
};

export const shapeOf = (coords) => encodePolyline(coords, 5);
export const coordsOf = (shape) => (shape ? decodePolyline(shape, 5) : []);

/* ── Teilen per Link ──────────────────────────────────────────────────────── */

/*
 * Der Link trägt die Tour selbst – ohne Server. Gespeichert werden nur Name,
 * Beschreibung, Profil und die gesetzten Punkte; wer den Link öffnet, lässt
 * die Route neu rechnen. Gepackt mit deflate, damit auch lange Touren in eine
 * URL passen.
 */
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Beliebiges JSON kurz und URL-tauglich packen (deflate + base64url). */
export async function packJson(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return `j${b64url(raw)}`;
  return `z${b64url(await pipe(raw, new CompressionStream('deflate-raw')))}`;
}

export async function unpackJson(code) {
  let bytes = unb64url(code.slice(1));
  if (code[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Tour als Link-Code. Feste Touren (bekannte Wege, GPX) tragen ihren Verlauf
 * mit (s), sonst reichen die Punkte – der Empfänger rechnet neu.
 */
export function encodeShare(tour) {
  return packJson({
    n: tour.name, d: tour.description || undefined, p: tour.profile, w: encodePolyline(tour.points, 5),
    s: tour.fixed && tour.shape ? tour.shape : undefined,
    // Hintergrund: bekannte Wege aus OSM, die der Planer unter die Tour legt
    o: tour.backgrounds?.some((b) => b.type === 'way')
      ? tour.backgrounds.filter((b) => b.type === 'way').map((b) => [b.id, b.kind, b.name]) : undefined,
  });
}

export async function decodeShare(code) {
  const o = await unpackJson(code);
  return {
    name: o.n ?? t('share.tour.default_name'), description: o.d ?? '', profile: o.p ?? 'hike', points: decodePolyline(o.w, 5),
    ...(o.s ? { fixed: true, shape: o.s } : {}),
    ...(o.o ? { backgrounds: o.o.map(([id, kind, name]) => ({ type: 'way', id, kind, name: name ?? '' })) } : {}),
  };
}

/* ── GPX ──────────────────────────────────────────────────────────────────── */

const xml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/**
 * GPX 1.1 mit Track (inkl. Höhe, wo bekannt) und den gesetzten Punkten als
 * Wegpunkte. `elevationAt(i)` liefert die Höhe zum i-ten Linienpunkt.
 * Stichworte „wmap:ID“ (und „wmap-fixed“) erkennen die Datei beim Abgleich wieder.
 */
export function toGpx(tour, coords, elevationAt = () => null) {
  const pts = coords.map(([lon, lat], i) => {
    const ele = elevationAt(i);
    return `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${ele !== null ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`;
  }).join('\n');
  const wpts = tour.points.map(([lon, lat], i) =>
    `  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${i === 0 ? t('tracks.gpx.start') : i === tour.points.length - 1 ? t('tracks.gpx.goal') : t('tracks.gpx.point', { i })}</name></wpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WMap" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(tour.name)}</name>${tour.description ? `<desc>${xml(tour.description)}</desc>` : ''}<time>${new Date(tour.updated ?? Date.now()).toISOString()}</time>${tour.id ? `<keywords>wmap:${xml(tour.id)}${tour.fixed ? ' wmap-fixed' : ''}</keywords>` : ''}</metadata>
${wpts}
  <trk>
    <name>${xml(tour.name)}</name>${tour.description ? `\n    <desc>${xml(tour.description)}</desc>` : ''}${tour.profile ? `\n    <type>${xml(tour.profile)}</type>` : ''}
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Datei speichern (Text oder Blob) → { name } bzw. null, wenn der Dialog abgebrochen wurde */
export function download(filename, text, type = 'application/gpx+xml') {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  // In der App: Speichern-Dialog des Systems (Plugin „folder“) – ein Download
  // über <a download> kommt in den WebViews der Apps nicht an
  const core = window.__TAURI__?.core;
  if (core) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    }).then((data) => core.invoke('plugin:folder|save', { name: filename, data, mime: type }))
      .catch((err) => { if (!/abgebrochen|cancel/i.test(String(err))) throw new Error(String(err?.message ?? err)); return null; });
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve({ name: filename });
}
