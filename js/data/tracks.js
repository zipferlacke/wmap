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
 *        bbox, from, to, description?, source? { health, app, type },
 *        sport? (Art, von Hand gewählt oder aus der GPX-Datei – sonst gilt
 *        source.type bzw. das Profil, siehe data/track-look.js),
 *        color? (eigene Farbe), hidden? (true/false: auf der Karte
 *        aus- bzw. eingeblendet, ohne Angabe gilt die Einstellung),
 *        pin? (offline verfügbar: bleibt ganz in der App, nur dieses Gerät) }
 *
 * Mit verbundenem Ordner liegt von älteren Wegen nur eine Karteikarte in der
 * App (`stub: true` – Name, Zeiten, Strecke, grober Verlauf für die Karte),
 * alle Punkte und Messwerte stehen in der GPX-Datei im Ordner und werden
 * geholt, wenn man den Weg öffnet (tracks.full, data/folder.js). Ganz in der
 * App bleiben die Wege der letzten Zeit (Einstellung) und alles, was als
 * „offline verfügbar“ markiert ist.
 *
 * Ohne Ordner bleibt alles, so lange man will – gelöscht wird nichts nach
 * Zeit. Nur wenn das Gerät gar nichts mehr speichert, weicht das Älteste
 * (makeRoom).
 *
 * Aufgezeichnet wird während der Navigation (abschaltbar) und über
 * „Aufzeichnen“ – beides mit dem Recorder unten, der nach einem Absturz
 * oder Neuladen weitermacht.
 */
import { local, tours, changed } from './store.js';
import { store } from './db.js';
import { geo } from '../core/native.js';
import { encodePolyline, decodePolyline, simplify, simplifyTo, distance, bbox } from '../core/geo.js';

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

/* ── Speicher voll ────────────────────────────────────────────────────────── */

const isFull = (err) => err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message ?? ''));
let makingRoom = false;

/**
 * Platz schaffen, wenn das Gerät nichts mehr speichert (kommt praktisch nicht
 * vor: ein Weg braucht rund 2 KB, erlaubt sind Gigabytes): Mit verbundenem
 * Ordner werden die ältesten ganzen Wege zur Karteikarte – ihre Datei liegt
 * ja im Ordner. Ohne Ordner weichen die ältesten Wege selbst, fünf auf
 * einmal; „offline verfügbar“ Markiertes nie. Gelöscht wird ohne Meldung an
 * den Abgleich, und aus Health Connect kommen sie nicht wieder. → Anzahl
 */
async function makeRoom(exceptId) {
  makingRoom = true;
  try {
    const { shelveOldest } = await import('./folder.js');
    // null: kein Ordner verbunden
    const shelved = await shelveOldest(10, exceptId).catch(() => 0);
    const removed = [];
    if (shelved === null) {
      const old = (await db.all()).filter((t) => !t.pin && t.id !== exceptId).sort((a, b) => a.start - b.start).slice(0, 5);
      for (const t of old) { healthGone.add(t.source?.health); await db.remove(t.id); removed.push(t.name || 'Tour'); }
    }
    const n = shelved || removed.length;
    if (n) {
      dispatchEvent(new CustomEvent('wmap:storage-full', { detail: { shelved: shelved ?? 0, removed } }));
      import('../ui/dialogs.js').then(({ toast }) => toast(removed.length
        ? `Speicher voll – die ${removed.length === 1 ? 'älteste Tour' : `${removed.length} ältesten Touren`} wurden gelöscht`
        : `Speicher voll – ${shelved} ältere Touren liegen jetzt nur noch im Ordner`)).catch(() => {});
    }
    return n;
  } finally { makingRoom = false; }
}

/** Speichern; ist der Speicher voll, weicht das Älteste (makeRoom) und es geht noch einmal */
async function save(track) {
  for (let i = 0; ; i += 1) {
    try { return await db.put(track); } catch (err) {
      if (!isFull(err) || makingRoom || i >= 20 || !(await makeRoom(track.id))) throw err;
    }
  }
}

export const tracks = {
  /** Alle Wege, neueste zuerst. */
  async all() {
    return (await db.all()).sort((a, b) => b.start - a.start);
  },
  get: (id) => db.get(id),
  /**
   * Der ganze Weg mit allen Punkten und Messwerten – eine Karteikarte (stub)
   * wird aus dem verbundenen Ordner gelesen. Wirft, wenn der Ordner gerade
   * nicht erreichbar ist. `t`: Weg oder ID, `onStep`: siehe readTrack
   */
  async full(t, onStep) {
    const item = typeof t === 'string' ? await db.get(t) : t;
    if (!item?.stub) return item ?? null;
    onStep?.('Ordner-Teil laden');
    const { readTrack } = await import('./folder.js');
    return readTrack(item, onStep);
  },
  /** Alle Wege ganz (für Sicherung und ZIP); was nicht zu holen ist, bleibt Karteikarte → { list, missing } */
  async allFull() {
    const list = [];
    let missing = 0;
    for (const t of await this.all()) {
      if (!t.stub) { list.push(t); continue; }
      try { list.push(await this.full(t)); } catch { list.push(t); missing += 1; }
    }
    return { list, missing };
  },
  async put(track) { await save(track); changed({ kind: 'track', id: track.id }); },
  /** Speichern ohne Meldung – für den Abgleich */
  putQuiet: (track) => save(track),
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

/* ── Karteikarte: Weg, dessen Punkte nur im Ordner liegen ─────────────────── */

const STUB_POINTS = 60;
const VALUES = ['hr', 'cad', 'pow'];
// Was die Karteikarte selbst weiß und beim Lesen der Datei gilt (dort geändert: Name, Art, Farbe …)
const CARD = ['id', 'kind', 'profile', 'name', 'from', 'to', 'description', 'sport', 'color', 'hidden', 'pin', 'updated',
  'start', 'end', 'length', 'moving', 'top'];

/** Weg → Karteikarte. `fhash`: Fingerabdruck der Datei, die alles enthält */
export function stubOf(t, fhash) {
  const { times: _t, hr: _h, cad: _c, pow: _p, ...card } = t;
  const coords = trackCoords(t);
  return {
    ...card, shape: encodePolyline(simplifyTo(coords, STUB_POINTS), 5), stub: true, fhash, n: coords.length,
    has: VALUES.filter((k) => t[k]?.some((v) => v > 0)),
  };
}

/** Karteikarte + gelesene Datei (parseGpx) → der ganze Weg */
export function fromFile(stub, parsed) {
  const card = Object.fromEntries(CARD.filter((k) => stub[k] !== undefined).map((k) => [k, stub[k]]));
  const source = stub.source || parsed.source ? { ...parsed.source, ...stub.source } : undefined;
  return { ...parsed, ...card, ...(source ? { source } : {}) };
}

/** Karteikarten-Felder von einem Weg nehmen (der Abgleich ersetzt eine Karteikarte durch den ganzen Weg) */
export function unstub(t) {
  const { stub: _s, fhash: _f, n: _n, has: _h, ...rest } = t ?? {};
  return rest;
}

/** Hat der Weg Messwerte (Puls, Frequenz, Leistung)? – auch für Karteikarten */
export const hasValues = (t) => (t.stub ? t.has?.length > 0 : VALUES.some((k) => t[k]?.some((v) => v > 0)));

/**
 * Läuft gerade ein Import, der viele Wege nacheinander speichert (Health
 * Connect)? Der Ordner-Abgleich wartet so lange (data/folder.js) – sonst
 * liefe er mittendrin an und danach gleich noch einmal.
 */
export const bulk = { active: 0 };

/**
 * Kennung für einen Weg aus Health Connect: aus Start und Kennung des
 * Trainings, nicht gewürfelt – nach einer Neuinstallation oder auf einem
 * zweiten Gerät bekommt dasselbe Training dieselbe Kennung wie die Datei im
 * verbundenen Ordner und liegt dort nicht doppelt.
 */
export function healthTrackId(start, healthId) {
  let h = 0x811c9dc5;
  for (const c of String(healthId)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return `w${start.toString(36)}h${(h >>> 0).toString(36).padStart(4, '0').slice(-4)}`;
}

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

/**
 * Punkte [lon, lat, ms, puls?, frequenz?, leistung?] → Weg (null unter 200 m).
 * `keepAll`: nicht ausdünnen – die Punkte sind schon die eines Wegs (eine
 * GPX-Datei von WMap), wieder eingelesen ist er dann Punkt für Punkt derselbe
 */
export function buildTrack(points, { kind, profile, name, from = '', to = '', keepAll = false }) {
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
  const kept = keepAll ? points : keepEvery(points, simplify(points, TOLERANCE[profile] ?? 3),
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
 *
 * Android-App (ab 2.2.0): Solange aufgezeichnet wird – einzeln oder mit der Navigation –, läuft ein Dienst
 * mit Benachrichtigung (`geo.background`, core/native.js). Er sammelt den Standort, wenn der Bildschirm aus
 * oder eine andere App vorn ist; zurück im Bild werden die Punkte nachgetragen. `background` sagt, ob er
 * läuft – dann muss der Bildschirm nicht an bleiben. Seine Benachrichtigung zeigt Zeit und Strecke und hat
 * „Pause“/„Weiter“ und „Beenden“: Solange die Seite zu sehen ist, gleicht der Recorder alle anderthalb
 * Sekunden ab (`#sync`) – Pause aus der Benachrichtigung kommt so hier an, „Beenden“ ruft `stopHandlers`.
 */
class Recorder {
  #live = null;
  #unsaved = 0;
  #bg = false;
  onChange = null;
  /** Der Dienst läuft (oder eben nicht) – z. B. Bildschirm nicht mehr wach halten */
  onBackground = null;
  /** „Beenden“ in der Benachrichtigung, je Art der Aufzeichnung: { rec: () => …, nav: () => … } */
  stopHandlers = {};
  #dirty = false;      // Pause hier geändert – der Dienst übernimmt sie
  #clearStop = false;
  #timer = null;

  constructor() {
    const saved = local.get(LIVE);
    if (saved?.points && Date.now() - (saved.points.at(-1)?.[2] ?? saved.started) < 12 * 3600e3) this.#live = saved;
    if (this.#live) this.#background(true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.#sync(); });
  }

  get background() { return this.#bg; }

  /** Zeit ohne die Pausen, in ms */
  get elapsed() {
    const l = this.#live;
    return l ? (l.paused && l.pausedAt ? l.pausedAt : Date.now()) - l.started - (l.pausedMs ?? 0) : 0;
  }

  /** Strecke bisher in Metern */
  get length() {
    const l = this.#live;
    if (!l) return 0;
    if (l.length === undefined) {
      l.length = 0;
      for (let i = 1; i < l.points.length; i += 1) l.length += distance(l.points[i - 1], l.points[i]);
    }
    return l.length;
  }

  #state() {
    const l = this.#live, last = l.points.at(-1);
    return {
      started: l.started, distance: this.length, lon: last?.[0] ?? null, lat: last?.[1] ?? null,
      push: this.#dirty, paused: !!l.paused, pausedAt: l.pausedAt ?? 0, pausedMs: l.pausedMs ?? 0, clearStop: this.#clearStop,
    };
  }

  async #background(on) {
    clearInterval(this.#timer);
    if (!on) {
      if (this.#bg) geo.background.stop();
      this.#bg = false;
      return;
    }
    this.#dirty = true;
    const state = this.#state();
    this.#dirty = false;
    this.#bg = await geo.background.start(state);
    if (!this.#live) { this.#background(false); return; }
    if (!this.#bg) return;
    this.onBackground?.();
    this.#timer = setInterval(() => { if (document.visibilityState === 'visible') this.#sync(); }, 1500);
    this.#sync();
  }

  /**
   * Mit dem Dienst abgleichen: nachtragen, was er gesammelt hat, während die App nicht zu sehen war; Zeit und
   * Strecke für die Benachrichtigung; Pause und „Beenden“ aus der Benachrichtigung übernehmen.
   */
  async #sync() {
    if (!this.#bg || !this.#live) return;
    const pushed = this.#dirty, cleared = this.#clearStop, state = this.#state();
    this.#dirty = false;
    const r = await geo.background.sync(state);
    const l = this.#live;
    if (!r || !l) return;
    if (cleared) this.#clearStop = false;
    // Der Dienst sammelt nur außerhalb der Pause – darum auch nachtragen, wenn hier gerade Pause ist
    const n = this.addAll(r.points, true);
    if (!pushed && !this.#dirty && r.paused !== !!l.paused) {
      Object.assign(l, { paused: r.paused, pausedAt: r.pausedAt, pausedMs: r.pausedMs });
      this.#save();
      if (!n) this.onChange?.();
    }
    if (r.stop && !cleared && this.stopHandlers[l.kind]) {
      this.#clearStop = true;
      this.stopHandlers[l.kind]();
    }
  }

  get active() { return !!this.#live; }
  get kind() { return this.#live?.kind ?? null; }
  get paused() { return !!this.#live?.paused; }
  get points() { return this.#live?.points ?? []; }
  get info() { return this.#live; }

  /** `keep`: auch als Navigation behalten, wenn „Fahrten merken“ aus ist (geplante Tour) */
  start({ kind, profile, name = '', from = '', to = '', keep = false }) {
    this.#live = { kind, profile, name, from, to, keep, started: Date.now(), paused: false, pausedAt: 0, pausedMs: 0, length: 0, points: [] };
    this.#save();
    this.#background(true);
  }

  /** `time`: wann der Punkt gemessen wurde – für nachgereichte Punkte (sonst: jetzt) */
  add({ point, accuracy, time }) {
    if (!this.#take({ point, accuracy, time })) return;
    if (++this.#unsaved >= 10) this.#save();
    this.onChange?.();
  }

  /** Viele Punkte auf einmal (bei ausgeschaltetem Bildschirm gesammelt) – ein Speichern, eine Meldung */
  addAll(list, force = false) {
    let n = 0;
    for (const p of list) if (this.#take(p, force)) n += 1;
    if (!n) return 0;
    this.#save();
    this.onChange?.();
    return n;
  }

  #take({ point, accuracy, time }, force = false) {
    const l = this.#live;
    if (!l || (l.paused && !force) || !point || (accuracy ?? 0) > MAX_ACCURACY_M) return false;
    const last = l.points.at(-1);
    const step = last ? distance(last, point) : 0;
    if (last && step < MIN_STEP_M) return false;
    // Nachgereichtes nie vor den letzten Punkt oder vor den Start
    if (time && (time < l.started || (last && time < last[2]))) return false;
    l.length = this.length + step;
    l.points.push([+point[0].toFixed(6), +point[1].toFixed(6), time || Date.now()]);
    return true;
  }

  pause(on) {
    const l = this.#live;
    if (!l || !!l.paused === !!on) return;
    // Die Zeit steht in der Pause (elapsed)
    if (on) l.pausedAt = Date.now();
    else if (l.pausedAt) l.pausedMs = (l.pausedMs ?? 0) + Date.now() - l.pausedAt;
    l.paused = on;
    this.#save();
    this.#dirty = true;
    this.#sync();
  }

  /** Beenden und speichern → der Weg (oder null, wenn zu kurz/abgeschaltet). */
  async stop({ name } = {}) {
    // Erst nachtragen, was noch beim Dienst liegt
    await this.#sync();
    const l = this.#live;
    this.#live = null;
    local.set(LIVE, null);
    this.#background(false);
    this.onChange?.();
    if (!l) return null;
    if (l.kind === 'nav' && !l.keep && !historySetting.get()) return null;
    const t = buildTrack(l.points, { ...l, name: name ?? l.name });
    if (t) await tracks.put(t);
    return t;
  }

  discard() { this.#live = null; local.set(LIVE, null); this.#background(false); this.onChange?.(); }

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
  const description = doc.querySelector('metadata > desc')?.textContent?.trim() ?? '';
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
    // Von WMap geschrieben und noch mit denselben Punkten: so lassen, wie sie sind
    const keepAll = !!own && num('points') === points.length;
    const t = buildTrack(points, { kind: 'gpx', profile: profile ?? (PROFILE_GROUP[type] ? type : 'foot'), name, keepAll });
    let one = t && (profile || PROFILE_GROUP[type] ? t : guessProfile(t));
    if (!one) continue;
    // Fremde Datei, die ihre Art nennt (Garmin: running, cycling …): gilt als Art des Wegs
    const sport = SPORT_WORDS[String(type ?? '').toLowerCase()];
    if (sport && !own) one = { ...one, sport };
    if (description) one = { ...one, description };
    if (own) {
      const attr = (k) => own.getAttribute(k) || undefined;
      const src = { ...(attr('app') ? { app: attr('app') } : {}), ...(attr('type') ? { type: attr('type') } : {}) };
      const kind = ['rec', 'nav', 'gpx', 'health'].includes(attr('kind')) ? attr('kind') : one.kind;
      const meta = { sport: attr('sport'), color: /^#[0-9a-f]{6}$/i.test(attr('color') ?? '') ? attr('color') : undefined,
        hidden: attr('hidden') === '1' ? true : attr('hidden') === '0' ? false : undefined, from: attr('from'), to: attr('to') };
      one = { ...one, kind, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)), ...(Object.keys(src).length ? { source: src } : {}) };
      // Gemessenes nur, wenn die Datei noch die Punkte hat, zu denen die Werte gehören
      if (num('points') === points.length) one = { ...one, length: num('length') ?? one.length, moving: num('moving') ?? one.moving, top: num('top') ?? one.top };
    }
    out.push(health ? { ...one, source: { ...one.source, health } } : one);
  }
  return out;
}

export function trackGpx(t) {
  // Eine Karteikarte hat nicht alle Punkte – sie darf nie die Datei ersetzen (data/folder.js liest erst die Datei)
  if (t.stub) throw new Error('Der Weg liegt nur im Ordner');
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
  const attrs = { points: coords.length, kind: t.kind, length: t.length, moving: t.moving, top: t.top, app: t.source?.app, type: t.source?.type,
    // Art, Farbe, aus-/eingeblendet, Start und Ziel – auf allen Geräten gleich
    sport: t.sport, color: t.color, hidden: t.hidden === true ? 1 : t.hidden === false ? 0 : undefined, from: t.from, to: t.to };
  const own = `<extensions><wmap:track ${Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/></extensions>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WMap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:wmap="https://app.wuefl.de/wmap/gpx">
  <metadata><name>${esc(t.name)}</name>${t.description ? `<desc>${esc(t.description)}</desc>` : ''}<time>${new Date(t.start).toISOString()}</time><keywords>wmap:${esc(t.id)}${t.source?.health ? ` wmap-hc:${esc(t.source.health)}` : ''}</keywords>${own}</metadata>
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
  // Karteikarten (Weg liegt nur im Ordner) ganz holen – die Sicherung soll alles enthalten
  const { list } = await tracks.allFull();
  return JSON.stringify({ app: 'wmap', version: 1, saved: new Date().toISOString(), tours: tours.all(), tracks: list.map(unstub) });
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

/**
 * Arten, die fremde GPX-Dateien in <type> nennen (Garmin, Strava, Komoot …)
 * bzw. die Profile von WMap → Art wie in Health Connect (services/health.js)
 */
const SPORT_WORDS = {
  running: 'running', run: 'running', trail_running: 'running', jogging: 'running', 9: 'running',
  walking: 'walking', walk: 'walking', foot: 'walking', hiking: 'hiking', hike: 'hiking',
  cycling: 'biking', biking: 'biking', bike: 'biking', ride: 'biking', road: 'biking', tour: 'biking', gravel: 'biking', mtb: 'biking',
  mountain_biking: 'biking', road_biking: 'biking', gravel_cycling: 'biking', 1: 'biking',
  rowing: 'rowing', kayaking: 'paddling', paddling: 'paddling', canoeing: 'paddling', sailing: 'sailing',
  swimming: 'swimming_open_water', open_water_swimming: 'swimming_open_water',
  skiing: 'skiing', cross_country_skiing: 'skiing', snowboarding: 'snowboarding', skating: 'skating', inline_skating: 'skating',
  car: 'driving', drive: 'driving', driving: 'driving',
};

/**
 * Aus einem Weg eine Tour zum Navigieren oder Speichern: fester Verlauf, ein
 * paar Punkte zum Weiterplanen. `heights`: { ascent, descent } oder null
 */
export function trackAsTour(t, heights = null, id = null) {
  const coords = trackCoords(t);
  const g = PROFILE_GROUP[t.profile] ?? 'foot';
  const profile = g === 'car' ? 'drive' : g === 'bike' ? (['road', 'gravel', 'mtb', 'tour'].includes(t.profile) ? t.profile : 'tour')
    : (heights?.ascent ?? 0) > 150 || t.length > 8000 ? 'hike' : 'walk';
  return {
    id, name: t.name || 'Tour', description: `Aufgezeichnet am ${new Date(t.start).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, profile,
    points: simplifyTo(coords, Math.min(30, Math.max(6, Math.round(t.length / 1000)))),
    shape: encodePolyline(coords, 5), fixed: true,
    stats: { length: t.length, time: t.moving || (trackEnd(t) - t.start) / 1000, ascent: heights?.ascent ?? 0, descent: heights?.descent ?? 0 },
  };
}

export const PROFILE_GROUP = { car: 'car', drive: 'car', bike: 'bike', road: 'bike', tour: 'bike', gravel: 'bike', mtb: 'bike', foot: 'foot', walk: 'foot', hike: 'foot' };
