/**
 * Alles, was im Browser bleibt: zuletzt Genutztes und Touren.
 *
 * localStorage kann fehlen oder werfen (privates Fenster, gesperrte Daten) –
 * dann läuft alles weiter, nur ohne Gedächtnis. Touren wandern später nach
 * Supabase; bis dahin reicht der Browser.
 */
import { encodePolyline, decodePolyline } from '../core/geo.js';

export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

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
    throw new Error('Speicher voll – Tour konnte nicht gespeichert werden');
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
    name: o.n ?? 'Geteilte Tour', description: o.d ?? '', profile: o.p ?? 'hike', points: decodePolyline(o.w, 5),
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
    `  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${i === 0 ? 'Start' : i === tour.points.length - 1 ? 'Ziel' : `Punkt ${i}`}</name></wpt>`).join('\n');
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
