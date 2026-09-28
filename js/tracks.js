/**
 * Aufgezeichnete Wege – über Jahre, nur auf diesem Gerät. Kein Konto, kein
 * Server: Die Wege liegen in IndexedDB und sind ausgedünnt winzig (30 km
 * Autofahrt ≈ 300 Punkte ≈ 3 KB, ein Jahr mit 500 Wegen ≈ 1,5 MB). Auf ein
 * anderes Gerät kommen sie per Sicherungsdatei oder GPX.
 *
 * Weg: { id, kind: 'nav'|'rec'|'gpx', profile, name, start, end (ms),
 *        length (m), moving (s), top (m/s), shape (Polyline5),
 *        times [s ab Start je Punkt], hr [Puls je Punkt] (aus GPX, falls da),
 *        bbox, from, to }
 *
 * Aufgezeichnet wird während der Navigation (abschaltbar) und über
 * „Aufzeichnen“ – beides mit dem Recorder unten, der nach einem Absturz
 * oder Neuladen weitermacht.
 */
import { local, tours, changed } from './store.js';
import { store } from './db.js';
import { encodePolyline, decodePolyline, simplify, distance, bbox } from './geo.js';

const SETTING = 'wmap.history';

/** Fahrten und Aufzeichnungen merken? Standard: ja. */
export const historySetting = {
  get: () => local.get(SETTING, true) !== false,
  set: (on) => local.set(SETTING, !!on),
};

/* ── Speicher ─────────────────────────────────────────────────────────────── */

const db = store('tracks');

export const tracks = {
  /** Alle Wege, neueste zuerst. */
  async all() {
    return (await db.all()).sort((a, b) => b.start - a.start);
  },
  get: (id) => db.get(id),
  async put(track) { await db.put(track); changed({ kind: 'track', id: track.id }); },
  /** Speichern ohne Meldung – für den Abgleich */
  putQuiet: (track) => db.put(track),
  async remove(id) { await db.remove(id); changed({ kind: 'track', id, removed: true }); },
  async rename(id, name) {
    const t = await this.get(id);
    if (t) await this.put({ ...t, name, updated: Date.now() });
  },
};

export const trackCoords = (t) => (t?.shape ? decodePolyline(t.shape, 5) : []);

/* ── Aus Rohpunkten einen Weg machen ──────────────────────────────────────── */

const TOLERANCE = { car: 8, bike: 4 };           // Meter; sonst 3

/**
 * Rohpunkte [[lon, lat, ms], …] → Weg (oder null, wenn zu kurz).
 * Stehzeiten zählen nicht zur Bewegungszeit.
 */
function buildTrack(points, { kind, profile, name, from = '', to = '' }) {
  if (points.length < 2) return null;
  let length = 0, moving = 0, top = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = distance(points[i - 1], points[i]);
    const dt = (points[i][2] - points[i - 1][2]) / 1000;
    length += d;
    if (dt > 0 && dt < 120 && d / dt > 0.5) moving += dt;
    // Spitzen über 3 Punkte glätten – ein GPS-Sprung ist kein Tempo
    if (i >= 3) {
      const span = (points[i][2] - points[i - 3][2]) / 1000;
      if (span > 2) top = Math.max(top, (distance(points[i - 3], points[i - 2]) + distance(points[i - 2], points[i - 1]) + d) / span);
    }
  }
  if (length < 200) return null;
  const kept = simplify(points, TOLERANCE[profile] ?? 3);
  const t0 = points[0][2];
  return {
    id: `w${t0.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    kind, profile, name, from, to,
    start: t0, end: points.at(-1)[2],
    length: Math.round(length), moving: Math.round(moving), top: Math.round(top * 10) / 10,
    shape: encodePolyline(kept.map(([x, y]) => [x, y]), 5),
    times: kept.map((p) => Math.round((p[2] - t0) / 1000)),
    // Puls (GPX-Erweiterung) – nur, wenn es welchen gibt
    ...(kept.some((p) => p[3] > 0) ? { hr: kept.map((p) => (p[3] > 0 ? Math.round(p[3]) : null)) } : {}),
    bbox: bbox(kept).map((v) => +v.toFixed(5)),
  };
}

/* ── Recorder ─────────────────────────────────────────────────────────────── */

const LIVE = 'wmap.rec';
const MIN_STEP_M = 4;
const MAX_ACCURACY_M = 35;

/**
 * Nimmt Standortmeldungen auf. Der laufende Stand liegt zusätzlich im
 * localStorage – nach Neuladen oder Absturz geht es dort weiter.
 */
class Recorder {
  #live = null;
  #unsaved = 0;
  onChange = null;

  constructor() {
    const saved = local.get(LIVE);
    if (saved?.points && Date.now() - (saved.points.at(-1)?.[2] ?? saved.started) < 12 * 3600e3) this.#live = saved;
  }

  get active() { return !!this.#live; }
  get kind() { return this.#live?.kind ?? null; }
  get paused() { return !!this.#live?.paused; }
  get points() { return this.#live?.points ?? []; }
  get info() { return this.#live; }

  start({ kind, profile, name = '', from = '', to = '' }) {
    this.#live = { kind, profile, name, from, to, started: Date.now(), paused: false, points: [] };
    this.#save();
  }

  add({ point, accuracy }) {
    const l = this.#live;
    if (!l || l.paused || !point || (accuracy ?? 0) > MAX_ACCURACY_M) return;
    const last = l.points.at(-1);
    if (last && distance(last, point) < MIN_STEP_M) return;
    l.points.push([+point[0].toFixed(6), +point[1].toFixed(6), Date.now()]);
    if (++this.#unsaved >= 10) this.#save();
    this.onChange?.();
  }

  pause(on) {
    if (!this.#live) return;
    this.#live.paused = on;
    this.#save();
  }

  /** Beenden und speichern → der Weg (oder null, wenn zu kurz/abgeschaltet). */
  async stop({ name } = {}) {
    const l = this.#live;
    this.#live = null;
    local.set(LIVE, null);
    this.onChange?.();
    if (!l) return null;
    if (l.kind === 'nav' && !historySetting.get()) return null;
    const t = buildTrack(l.points, { ...l, name: name ?? l.name });
    if (t) await tracks.put(t);
    return t;
  }

  discard() { this.#live = null; local.set(LIVE, null); this.onChange?.(); }

  #save() {
    this.#unsaved = 0;
    if (this.#live) local.set(LIVE, this.#live);
  }
}

addEventListener('pagehide', () => {
  // Der Recorder speichert alle 10 Punkte; beim Verlassen den Rest
  const l = recorder.info;
  if (l) local.set(LIVE, l);
});

export const recorder = new Recorder();

/* ── Namen ────────────────────────────────────────────────────────────────── */

const PROFILE_WORD = { car: 'Autofahrt', drive: 'Ausfahrt', bike: 'Radtour', road: 'Radtour', tour: 'Radtour', gravel: 'Radtour', mtb: 'Radtour', foot: 'Spaziergang', walk: 'Spaziergang', hike: 'Wanderung' };

/** „Radtour am Samstagnachmittag“ */
export function defaultName(profile, when = Date.now()) {
  const d = new Date(when);
  const h = d.getHours();
  const part = h < 5 ? 'Nacht' : h < 11 ? 'morgen' : h < 14 ? 'mittag' : h < 18 ? 'nachmittag' : 'abend';
  const day = d.toLocaleDateString('de-DE', { weekday: 'long' });
  return `${PROFILE_WORD[profile] ?? 'Unterwegs'} am ${part === 'Nacht' ? `${day} in der Nacht` : `${day}${part}`}`;
}

/* ── GPX ──────────────────────────────────────────────────────────────────── */

/** GPX-Datei → Wege (Tracks mit Zeit; Routen ohne Zeit gehen auch). Ohne `profile` gilt der
 *  Typ aus der Datei (<type>) – oder er wird am Tempo erkannt. */
export function parseGpx(text, profile = null) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Keine gültige GPX-Datei');
  const out = [];
  const fileName = doc.querySelector('metadata > name')?.textContent?.trim();
  for (const trk of doc.querySelectorAll('trk, rte')) {
    const pts = [...trk.querySelectorAll('trkpt, rtept')];
    if (pts.length < 2) continue;
    let fake = Date.parse(doc.querySelector('metadata > time')?.textContent ?? '') || Date.now();
    const points = pts.map((p) => {
      const t = Date.parse(p.querySelector('time')?.textContent ?? '');
      fake += 1000;
      // Puls aus Garmin-/Strava-Erweiterungen (gpxtpx:hr, ns3:hr …)
      const hr = [...p.getElementsByTagName('*')].find((e) => e.localName === 'hr')?.textContent;
      return [+p.getAttribute('lon'), +p.getAttribute('lat'), Number.isFinite(t) ? t : fake, hr ? Number(hr) : 0];
    }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const name = trk.querySelector(':scope > name')?.textContent?.trim() || fileName || 'Importierter Weg';
    const type = trk.querySelector(':scope > type')?.textContent?.trim();
    const t = buildTrack(points, { kind: 'gpx', profile: profile ?? (PROFILE_GROUP[type] ? type : 'foot'), name });
    if (t) out.push(profile || PROFILE_GROUP[type] ? t : guessProfile(t));
  }
  return out;
}

export function trackGpx(t) {
  const coords = trackCoords(t);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hr = (i) => (t.hr?.[i] > 0 ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${t.hr[i]}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : '');
  const pts = coords.map(([lon, lat], i) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(t.start + (t.times?.[i] ?? 0) * 1000).toISOString()}</time>${hr(i)}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WMap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${esc(t.name)}</name><time>${new Date(t.start).toISOString()}</time><keywords>wmap:${esc(t.id)}</keywords></metadata>
  <trk>
    <name>${esc(t.name)}</name>
    <type>${esc(t.profile)}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/* ── Sicherung: alles in einer Datei ─────────────────────────────────────── */

export async function backup() {
  return JSON.stringify({ app: 'wmap', version: 1, saved: new Date().toISOString(), tours: tours.all(), tracks: await tracks.all() });
}

/** Sicherung einspielen – vorhandene Einträge bleiben, gleiche IDs werden ersetzt. */
export async function restore(text) {
  const data = JSON.parse(text);
  if (data?.app !== 'wmap') throw new Error('Das ist keine WMap-Sicherung');
  let n = 0;
  for (const t of data.tours ?? []) { tours.save(t); n += 1; }
  for (const t of data.tracks ?? []) { if (t?.id && t.shape) { await tracks.put(t); n += 1; } }
  return n;
}

/* ── Auswertung ───────────────────────────────────────────────────────────── */

/** Importierte Wege ohne Angabe: am Tempo erkennen, womit man unterwegs war. */
function guessProfile(t) {
  const v = t.moving ? t.length / t.moving : 0;
  return { ...t, profile: v > 9 ? 'car' : v > 3.2 ? 'bike' : 'foot' };
}

/** Derselbe Weg schon da? (gleicher Start, fast gleiche Länge) – gegen doppelte Importe */
export const sameTrack = (a, b) => Math.abs(a.start - b.start) < 5000 && Math.abs(a.length - b.length) <= Math.max(50, a.length * 0.02);

export const PROFILE_GROUP = { car: 'car', drive: 'car', bike: 'bike', road: 'bike', tour: 'bike', gravel: 'bike', mtb: 'bike', foot: 'foot', walk: 'foot', hike: 'foot' };
