/**
 * Aufgezeichnete Wege – über Jahre, nur auf diesem Gerät. Kein Konto, kein
 * Server: Die Wege liegen in IndexedDB und sind ausgedünnt winzig (30 km
 * Autofahrt ≈ 300 Punkte ≈ 3 KB, ein Jahr mit 500 Wegen ≈ 1,5 MB). Auf ein
 * anderes Gerät kommen sie per Sicherungsdatei oder GPX.
 *
 * Weg: { id, kind: 'nav'|'rec'|'gpx'|'health', profile, name, start, end (ms),
 *        length (m), moving (s), top (m/s), shape (Polyline5),
 *        times [s ab Start je Punkt], und je Punkt, falls da (GPX, Health
 *        Connect): hr [Puls], cad [Schritt- bzw. Trittfrequenz je min],
 *        pow [Leistung in W] – null, wo nichts gemessen wurde,
 *        bbox, from, to, source? { health, app, type } }
 *
 * Aufgezeichnet wird während der Navigation (abschaltbar) und über
 * „Aufzeichnen“ – beides mit dem Recorder unten, der nach einem Absturz
 * oder Neuladen weitermacht.
 */
import { local, tours, changed } from './store.js';
import { store } from './db.js';
import { encodePolyline, decodePolyline, simplify, distance, bbox } from '../core/geo.js';

const SETTING = 'wmap.history';

/**
 * Navigierte Fahrten merken? Standard: nein. Geplante Touren (Meine Touren →
 * Tour starten) und „Aufzeichnen“ landen immer unter Aufgezeichnete Touren.
 */
export const historySetting = {
  get: () => local.get(SETTING, false) === true,
  set: (on) => local.set(SETTING, !!on),
};

/* ── Speicher ─────────────────────────────────────────────────────────────── */

const db = store('tracks');

/*
 * Aus Health Connect übernommen und dann gelöscht: nicht beim nächsten
 * Abruf wieder holen (js/services/health.js fragt hier nach).
 */
const HEALTH_GONE = 'wmap.health.gone';
export const healthGone = {
  all: () => new Set(local.get(HEALTH_GONE, []) ?? []),
  add(id) { if (id) local.set(HEALTH_GONE, [...new Set([...(local.get(HEALTH_GONE, []) ?? []), id])].slice(-5000)); },
};

export const tracks = {
  /** Alle Wege, neueste zuerst. */
  async all() {
    return (await db.all()).sort((a, b) => b.start - a.start);
  },
  get: (id) => db.get(id),
  async put(track) { await db.put(track); changed({ kind: 'track', id: track.id }); },
  /** Speichern ohne Meldung – für den Abgleich */
  putQuiet: (track) => db.put(track),
  async remove(id) { await this.removeQuiet(id); changed({ kind: 'track', id, removed: true }); },
  /** Löschen ohne Meldung – für den Abgleich (sonst gälte es als „hier gelöscht“) */
  async removeQuiet(id) {
    const t = await db.get(id).catch(() => null);
    healthGone.add(t?.source?.health);
    await db.remove(id);
  },
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
/** Messwert an Stelle i jedes Punkts → { [key]: [...] }, leer ohne Werte */
const perPoint = (pts, i, key) => (pts.some((p) => p[i] > 0) ? { [key]: pts.map((p) => (p[i] > 0 ? Math.round(p[i]) : null)) } : {});

/**
 * Ausgedünnt bleibt nur, was die Form braucht – auf geraden Stücken gingen
 * so Tempo- und Pulswechsel verloren. Darum mindestens alle `ms` einen Punkt.
 */
function keepEvery(points, kept, ms) {
  const set = new Set(kept);
  let last = -Infinity;
  return points.filter((p) => {
    if (set.has(p) || p[2] - last >= ms) { last = p[2]; return true; }
    return false;
  });
}

/** Punkte [lon, lat, ms, puls?, frequenz?, leistung?] → Weg (null unter 200 m) */
export function buildTrack(points, { kind, profile, name, from = '', to = '' }) {
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
  const kept = keepEvery(points, simplify(points, TOLERANCE[profile] ?? 3),
    points.some((p) => p[3] > 0 || p[4] > 0 || p[5] > 0) ? 30000 : 60000);
  const t0 = points[0][2];
  return {
    id: `w${t0.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    kind, profile, name, from, to,
    start: t0, end: points.at(-1)[2],
    length: Math.round(length), moving: Math.round(moving), top: Math.round(top * 10) / 10,
    shape: encodePolyline(kept.map(([x, y]) => [x, y]), 5),
    times: kept.map((p) => Math.round((p[2] - t0) / 1000)),
    // Puls, Frequenz, Leistung (GPX-Erweiterungen) – nur, wenn es welche gibt
    ...perPoint(kept, 3, 'hr'), ...perPoint(kept, 4, 'cad'), ...perPoint(kept, 5, 'pow'),
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

  /** `keep`: auch als Navigation behalten, wenn „Fahrten merken“ aus ist (geplante Tour) */
  start({ kind, profile, name = '', from = '', to = '', keep = false }) {
    this.#live = { kind, profile, name, from, to, keep, started: Date.now(), paused: false, points: [] };
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
    if (l.kind === 'nav' && !l.keep && !historySetting.get()) return null;
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
  // Aus Health Connect (von WMap geschrieben): dasselbe Training erkennen
  const health = doc.querySelector('metadata > keywords')?.textContent?.match(/\bwmap-hc:(\S+)/)?.[1] ?? null;
  // Von WMap geschrieben: Messwerte aus allen Punkten und die Herkunft (trackGpx)
  const own = [...(doc.querySelector('metadata > extensions')?.children ?? [])].find((e) => e.localName === 'track');
  const num = (k) => (own?.hasAttribute(k) && Number.isFinite(Number(own.getAttribute(k))) ? Number(own.getAttribute(k)) : null);
  for (const trk of doc.querySelectorAll('trk, rte')) {
    const pts = [...trk.querySelectorAll('trkpt, rtept')];
    if (pts.length < 2) continue;
    let fake = Date.parse(doc.querySelector('metadata > time')?.textContent ?? '') || Date.now();
    const points = pts.map((p) => {
      const t = Date.parse(p.querySelector('time')?.textContent ?? '');
      fake += 1000;
      // Puls, Frequenz, Leistung aus Garmin-/Strava-Erweiterungen (gpxtpx:hr, ns3:cad, power …)
      const ext = [...p.getElementsByTagName('*')];
      const val = (name) => Number(ext.find((e) => e.localName === name)?.textContent) || 0;
      return [+p.getAttribute('lon'), +p.getAttribute('lat'), Number.isFinite(t) ? t : fake, val('hr'), val('cad'), val('power')];
    }).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const name = trk.querySelector(':scope > name')?.textContent?.trim() || fileName || 'Importierter Weg';
    const type = trk.querySelector(':scope > type')?.textContent?.trim();
    const t = buildTrack(points, { kind: 'gpx', profile: profile ?? (PROFILE_GROUP[type] ? type : 'foot'), name });
    let one = t && (profile || PROFILE_GROUP[type] ? t : guessProfile(t));
    if (!one) continue;
    // Nur wenn die Datei noch die Punkte hat, zu denen die Werte gehören
    if (own && num('points') === points.length) {
      const kind = ['rec', 'nav', 'gpx', 'health'].includes(own.getAttribute('kind')) ? own.getAttribute('kind') : one.kind;
      const src = { ...(own.getAttribute('app') ? { app: own.getAttribute('app') } : {}), ...(own.getAttribute('type') ? { type: own.getAttribute('type') } : {}) };
      one = { ...one, kind, length: num('length') ?? one.length, moving: num('moving') ?? one.moving, top: num('top') ?? one.top, ...(Object.keys(src).length ? { source: src } : {}) };
    }
    out.push(health ? { ...one, source: { ...one.source, health } } : one);
  }
  return out;
}

export function trackGpx(t) {
  const coords = trackCoords(t);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Puls und Frequenz wie Garmin (TrackPointExtension), Leistung als <power> daneben
  const ext = (i) => {
    const tpx = `${t.hr?.[i] > 0 ? `<gpxtpx:hr>${t.hr[i]}</gpxtpx:hr>` : ''}${t.cad?.[i] > 0 ? `<gpxtpx:cad>${t.cad[i]}</gpxtpx:cad>` : ''}`;
    const pw = t.pow?.[i] > 0 ? `<power>${t.pow[i]}</power>` : '';
    return tpx || pw ? `<extensions>${pw}${tpx ? `<gpxtpx:TrackPointExtension>${tpx}</gpxtpx:TrackPointExtension>` : ''}</extensions>` : '';
  };
  const pts = coords.map(([lon, lat], i) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(t.start + (t.times?.[i] ?? 0) * 1000).toISOString()}</time>${ext(i)}</trkpt>`).join('\n');
  // Die Datei enthält nur die vereinfachten Punkte: was aus allen gemessen
  // wurde (Strecke, Zeit in Bewegung, Spitze) und woher der Weg kommt, steht
  // daneben – sonst wäre er auf dem nächsten Gerät kürzer und nur noch „GPX“
  const attrs = { points: coords.length, kind: t.kind, length: t.length, moving: t.moving, top: t.top, app: t.source?.app, type: t.source?.type };
  const own = `<extensions><wmap:track ${Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/></extensions>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WMap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:wmap="https://app.wuefl.de/wmap/gpx">
  <metadata><name>${esc(t.name)}</name><time>${new Date(t.start).toISOString()}</time><keywords>wmap:${esc(t.id)}${t.source?.health ? ` wmap-hc:${esc(t.source.health)}` : ''}</keywords>${own}</metadata>
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
export function guessProfile(t) {
  const v = t.moving ? t.length / t.moving : 0;
  return { ...t, profile: v > 9 ? 'car' : v > 3.2 ? 'bike' : 'foot' };
}

/** Ende eines Wegs in ms (ältere Wege haben kein `end`) */
export const trackEnd = (t) => t.end ?? t.start + (t.times?.at(-1) ?? 0) * 1000;

/**
 * Derselbe Weg schon da? – dieselbe Aufzeichnung, gegen doppelte Importe:
 * gleicher Start (± 5 s) und fast gleiche Länge (2 %). Oder gleicher Start
 * und gleiches Ende bei bis zu 15 % anderer Länge: eine GPX-Datei, die eine
 * ältere WMap geschrieben hat, enthält nur die vereinfachten Punkte – wieder
 * eingelesen ist der Weg etwas kürzer als das Training aus Health Connect.
 */
export function sameTrack(a, b) {
  if (Math.abs(a.start - b.start) >= 5000) return false;
  const diff = Math.abs(a.length - b.length);
  if (diff <= Math.max(50, a.length * 0.02)) return true;
  return Math.abs(trackEnd(a) - trackEnd(b)) < 5000 && diff <= Math.max(a.length, b.length) * 0.15;
}

/**
 * Dieselbe Aktivität – als dieselbe Datei (sameTrack) oder aus zwei Quellen,
 * etwa mit der Uhr (Health Connect) und mit dem Handy aufgezeichnet oder als
 * GPX in den Ordner gelegt. Start, Dauer und Kilometer weichen dann etwas ab
 * (anderer erster Punkt, andere Punktdichte): die Zeiten überlappen zu 80 %
 * des kürzeren, die Längen liegen 15 % beieinander, die Gebiete berühren sich.
 *
 * Beim Import bleiben solche Paare beide stehen – welche Strecke bleibt,
 * entscheidet man beim Zusammenführen (data/duplicates.js).
 */
export function sameActivity(a, b) {
  if (sameTrack(a, b)) return true;
  const shorter = Math.min(trackEnd(a) - a.start, trackEnd(b) - b.start);
  const overlap = Math.min(trackEnd(a), trackEnd(b)) - Math.max(a.start, b.start);
  if (shorter < 60000 || overlap < shorter * 0.8) return false;
  if (Math.abs(a.length - b.length) > Math.max(200, Math.max(a.length, b.length) * 0.15)) return false;
  const [A, B] = [a.bbox, b.bbox];
  return !A || !B || (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]);
}

export const PROFILE_GROUP = { car: 'car', drive: 'car', bike: 'bike', road: 'bike', tour: 'bike', gravel: 'bike', mtb: 'bike', foot: 'foot', walk: 'foot', hike: 'foot' };
