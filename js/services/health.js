/**
 * Health Connect (nur in der Android-App): Trainings anderer Apps – Fitbit,
 * Samsung Health, Strava, Google Fit … – mit ihren Routen als Wege
 * übernehmen. Die Arbeit macht das eigene Tauri-Plugin
 * (src-tauri/plugins/health, Kotlin); im Browser gibt es das nicht.
 *
 *   healthStatus()     { available, reason, read, routes } – was freigegeben ist
 *   healthRequest()    Freigabe-Dialog von Health Connect
 *   healthSettings(t)  Einstellungen öffnen: 'health' (Freigaben von WMap in
 *                      Health Connect), 'app' (App-Info), 'location'
 *   healthSessions()   Freigabe prüfen bzw. erfragen, dann alle Trainings
 *   importHealth(list) Routen holen und als Wege speichern – schon
 *                      übernommene (gleiche ID oder gleicher Weg) nicht doppelt;
 *                      dazu die Messwerte (Puls, Frequenz, Leistung) je Punkt
 *   fillHealthValues() Messwerte für früher übernommene Wege nachladen
 *
 * Routen fremder Apps gibt Health Connect nur mit „Immer erlauben“ ohne
 * Rückfrage heraus; sonst fragt es je Training nach. Lehnt man einmal ab,
 * fragt der Import für den Rest nicht mehr und zählt sie nur.
 */
import { tracks, buildTrack, guessProfile, sameTrack, defaultName } from '../data/tracks.js';

const core = window.__TAURI__?.core;
export const healthAvailable = !!core && /Android/i.test(navigator.userAgent);

const call = (cmd, args = {}) => core.invoke(`plugin:health|${cmd}`, args);
const READ = 'android.permission.health.READ_EXERCISE';
const ROUTES = 'android.permission.health.READ_EXERCISE_ROUTES';
const VALUES = 'android.permission.health.READ_HEART_RATE';
// Einmal von selbst nach den neuen Rechten (Messwerte) fragen – danach nur noch über den Dialog
const ASKED = 'wmap.health.asked';

/** Art des Trainings (Health Connect) → Profil in WMap; sonst am Tempo erkennen */
const PROFILE = { biking: 'bike', hiking: 'hike', walking: 'walk', running: 'foot' };

/** Art des Trainings (Namen wie in Health Connect): Name und Symbol (Material Symbols) */
const TYPES = {
  walking: ['Gehen', 'directions_walk'], hiking: ['Wandern', 'hiking'], snowshoeing: ['Schneeschuh', 'snowshoeing'],
  running: ['Laufen', 'directions_run'], running_treadmill: ['Laufband', 'directions_run'],
  biking: ['Radfahren', 'directions_bike'], biking_stationary: ['Heimtrainer', 'pedal_bike'],
  wheelchair: ['Rollstuhl', 'accessible'], skating: ['Skaten', 'roller_skating'], ice_skating: ['Eislaufen', 'ice_skating'],
  skiing: ['Ski', 'downhill_skiing'], snowboarding: ['Snowboard', 'snowboarding'],
  rowing: ['Rudern', 'rowing'], rowing_machine: ['Rudergerät', 'rowing'], paddling: ['Paddeln', 'kayaking'],
  sailing: ['Segeln', 'sailing'], surfing: ['Surfen', 'surfing'], scuba_diving: ['Tauchen', 'scuba_diving'],
  swimming_open_water: ['Schwimmen', 'pool'], swimming_pool: ['Schwimmbad', 'pool'], water_polo: ['Wasserball', 'pool'],
  paragliding: ['Gleitschirm', 'paragliding'], rock_climbing: ['Klettern', 'landscape'], golf: ['Golf', 'golf_course'],
  frisbee_disc: ['Frisbee', 'sports'], soccer: ['Fußball', 'sports_soccer'], football_american: ['Football', 'sports_football'],
  football_australian: ['Australian Football', 'sports_football'], rugby: ['Rugby', 'sports_rugby'],
  basketball: ['Basketball', 'sports_basketball'], volleyball: ['Volleyball', 'sports_volleyball'], handball: ['Handball', 'sports_handball'],
  baseball: ['Baseball', 'sports_baseball'], softball: ['Softball', 'sports_baseball'], cricket: ['Cricket', 'sports_cricket'],
  tennis: ['Tennis', 'sports_tennis'], table_tennis: ['Tischtennis', 'sports_tennis'], badminton: ['Badminton', 'sports_tennis'],
  squash: ['Squash', 'sports_tennis'], racquetball: ['Racquetball', 'sports_tennis'],
  ice_hockey: ['Eishockey', 'sports_hockey'], roller_hockey: ['Rollhockey', 'sports_hockey'],
  martial_arts: ['Kampfsport', 'sports_martial_arts'], boxing: ['Boxen', 'sports_mma'], fencing: ['Fechten', 'sports_kabaddi'],
  dancing: ['Tanzen', 'music_note'], gymnastics: ['Turnen', 'sports_gymnastics'], yoga: ['Yoga', 'self_improvement'],
  pilates: ['Pilates', 'self_improvement'], stretching: ['Dehnen', 'accessibility_new'], meditation: ['Meditation', 'self_improvement'],
  guided_breathing: ['Atemübung', 'air'], elliptical: ['Crosstrainer', 'fitness_center'],
  stair_climbing: ['Treppensteigen', 'stairs'], stair_climbing_machine: ['Stepper', 'stairs'],
  weightlifting: ['Gewichtheben', 'fitness_center'], strength_training: ['Krafttraining', 'fitness_center'],
  calisthenics: ['Calisthenics', 'fitness_center'], high_intensity_interval_training: ['HIIT', 'fitness_center'],
  boot_camp: ['Bootcamp', 'fitness_center'], exercise_class: ['Kurs', 'groups'],
  workout: ['Workout', 'fitness_center'], other_workout: ['Training', 'fitness_center'],
};
export const TYPE_NAME = Object.fromEntries(Object.entries(TYPES).map(([k, [n]]) => [k, n]));
export const typeName = (type) => TYPES[type]?.[0] ?? (type ? type.replace(/_/g, ' ') : 'Training');
export const typeIcon = (type) => TYPES[type]?.[1] ?? 'fitness_center';

const APP_NAME = {
  'com.google.android.apps.fitness': 'Google Fit', 'com.fitbit.FitbitMobile': 'Fitbit',
  'com.sec.android.app.shealth': 'Samsung Health', 'com.strava': 'Strava', 'de.komoot.android': 'Komoot',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect', 'com.huawei.health': 'Huawei Health',
  'com.withings.wiscale2': 'Withings', 'com.polar.polarflow': 'Polar Flow', 'com.suunto.android': 'Suunto',
  'com.huami.watch.hmwatchmanager': 'Zepp', 'com.xiaomi.wearable': 'Mi Fitness', 'com.mi.health': 'Mi Fitness',
  'nodomain.freeyourgadget.gadgetbridge': 'Gadgetbridge', 'com.coros.coros': 'COROS', 'com.wahoofitness.fitness': 'Wahoo',
  'com.runtastic.android': 'adidas Running', 'com.nike.plusgps': 'Nike Run Club', 'cc.pacer.androidapp': 'Pacer',
  'com.google.android.apps.healthdata': 'Health Connect', 'com.oneplus.health': 'OHealth', 'com.heytap.health': 'HeyTap Health',
};
export const appName = (pkg) => APP_NAME[pkg] ?? pkg?.split('.').slice(-2).join('.') ?? '?';

/** Was freigegeben ist: read (Trainings), routes (Routen immer erlaubt) */
export async function healthStatus() {
  if (!healthAvailable) return { available: false, reason: 'Nur in der Android-App' };
  const st = await call('status');
  if (!st.available) {
    return { available: false, reason: st.sdkStatus === 2 ? 'Health Connect muss erst aktualisiert werden' : 'Health Connect gibt es auf diesem Gerät nicht' };
  }
  const has = (p) => !!st.granted?.includes(p);
  return { available: true, read: has(READ), routes: has(ROUTES), values: has(VALUES) };
}

/** Freigabe-Dialog von Health Connect → wie healthStatus() */
export async function healthRequest() {
  await call('request_access');
  return healthStatus();
}

/** Beim ersten Aufruf true (gemerkt in localStorage) */
function once(key) {
  try {
    if (localStorage.getItem(key) === '2') return false;
    localStorage.setItem(key, '2');
    return true;
  } catch { return false; }
}

export const healthSettings = (target = 'health') => call('open_settings', { target });

/**
 * Alle Trainings (neueste zuerst). Ohne Freigabe erst der Dialog zu den
 * Berechtigungen (ui/permissions.js) – dort geht es zu Health Connect.
 */
export async function healthSessions({ days = 3650 } = {}) {
  let st = await healthStatus();
  if (!st.available) throw new Error(st.reason);
  if (!st.read) {
    const { showPermissions } = await import('../ui/permissions.js');
    await showPermissions({ reason: 'health' });
    st = await healthStatus();
    if (!st.read) throw new Error('Ohne Freigabe für Trainings kann WMap nichts lesen');
  } else if (!st.values && once(ASKED)) {
    // Neu: Puls & Co. – einmal nachfragen, ablehnen ist in Ordnung
    await call('request_access').catch(() => {});
  }
  const { sessions } = await call('sessions', { days });
  return sessions.sort((a, b) => b.start - a.start);
}

/** „Rudern am Dienstagabend“ – das Wort aus der Art, der Rest wie bei eigenen Wegen */
const WORD = { running: 'Lauf', running_treadmill: 'Lauf', hiking: 'Wanderung', biking: 'Radtour', walking: 'Spaziergang' };
const nameFor = (type, t) => defaultName(t.profile, t.start).replace(/^\S+/, WORD[type] ?? typeName(type));

/** Schon übernommen? (gleiche ID) – für den Überblick vor dem Import */
export async function knownHealthIds() {
  return new Set((await tracks.all()).map((t) => t.source?.health).filter(Boolean));
}

/**
 * Trainings mit Route als Wege speichern. Eine abgelehnte Nachfrage bricht
 * nicht ab: die übrigen Routen mit Nachfrage werden nur gezählt (denied),
 * die ohne Nachfrage weiter übernommen.
 * → { added, known, dup, empty, denied }; onProgress(i, n)
 */
export async function importHealth(sessions, { onProgress } = {}) {
  const have = await tracks.all();
  const seen = new Set(have.map((t) => t.source?.health).filter(Boolean));
  const out = { added: 0, known: 0, dup: 0, empty: 0, denied: 0 };
  let ask = true;
  for (const [i, s] of sessions.entries()) {
    onProgress?.(i, sessions.length);
    if (s.route === 'none') continue;
    if (seen.has(s.id)) { out.known += 1; continue; }
    if (s.route === 'consent' && !ask) { out.denied += 1; continue; }
    let points;
    try {
      ({ points } = await call('route', { id: s.id }));
    } catch (err) {
      if (!/nicht freigegeben|denied/i.test(String(err))) throw err;
      out.denied += 1;
      ask = false;
      continue;
    }
    const profile = PROFILE[s.type] ?? null;
    let t = buildTrack(points.map(([lon, lat, , ms]) => [lon, lat, ms]), { kind: 'health', profile: profile ?? 'foot', name: '' });
    if (!t) { out.empty += 1; continue; }
    if (!profile) t = guessProfile(t);
    t = { ...t, name: s.title || nameFor(s.type, t), source: { health: s.id, app: s.app, type: s.type } };
    t = await withValues(t, s.end);
    if (have.some((x) => sameTrack(x, t))) { out.dup += 1; continue; }
    await tracks.put(t);
    have.push(t);
    out.added += 1;
  }
  return out;
}

/**
 * Bei schon übernommenen Wegen die Art nachtragen (ältere Importe hatten sie
 * nicht) – und den erfundenen Namen („Spaziergang am …“ fürs Rudern)
 * passend machen, solange er nicht von Hand geändert ist.
 */
export async function fillHealthTypes(sessions) {
  const byId = new Map(sessions.map((s) => [s.id, s.type]));
  let n = 0;
  for (const t of await tracks.all()) {
    const type = byId.get(t.source?.health);
    if (!type) continue;
    const name = t.name === defaultName(t.profile, t.start) ? nameFor(type, t) : t.name;
    if (t.source.type === type && name === t.name) continue;
    await tracks.put({ ...t, name, source: { ...t.source, type } });
    n += 1;
  }
  return n;
}

/* ── Messwerte: Puls, Frequenz, Leistung je Punkt des Wegs ────────────────── */

/**
 * Messreihe [[ms, wert], …] → Wert zu jeder Zeit in `times` (ms): der
 * nächste Messwert höchstens `gap` entfernt, sonst null. Ohne Werte null.
 */
function sampleAt(series, times, gap = 60000) {
  if (!series?.length) return null;
  const s = [...series].sort((a, b) => a[0] - b[0]);
  let j = 0;
  const out = times.map((ms) => {
    while (j + 1 < s.length && Math.abs(s[j + 1][0] - ms) <= Math.abs(s[j][0] - ms)) j += 1;
    return Math.abs(s[j][0] - ms) <= gap && s[j][1] > 0 ? Math.round(s[j][1]) : null;
  });
  return out.some((v) => v !== null) ? out : null;
}

/**
 * Messwerte aus Health Connect an den Weg hängen (hr, cad, pow). Gibt es für
 * eine Art nichts, bleibt, was der Weg schon hatte. `end`: Ende des Trainings.
 */
async function withValues(t, end = t.end) {
  let v;
  try { v = await call('samples', { start: t.start - 60000, end: Math.max(end, t.end) + 60000 }); } catch { return t; }
  const times = (t.times ?? []).map((x) => t.start + x * 1000);
  const hr = sampleAt(v.hr, times);
  // Schritte (Laufen, Gehen) oder Tritte (Rad) – was die App liefert
  const cad = sampleAt(v.steps?.length ? v.steps : v.pedal, times);
  const pow = sampleAt(v.power, times);
  return {
    ...t, ...(hr ? { hr } : {}), ...(cad ? { cad } : {}), ...(pow ? { pow } : {}),
    source: { ...t.source, values: Date.now() },
  };
}

/**
 * Messwerte für einen früher übernommenen Weg nachladen und speichern (der
 * verbundene Ordner bekommt die neue GPX-Datei). → Weg mit neuen Werten, sonst null
 */
export async function refreshHealthValues(t) {
  const next = await withValues(t);
  if (next === t) return null;
  const found = ['hr', 'cad', 'pow'].some((k) => next[k] && next[k] !== t[k]);
  // Nur mit neuen Werten als geändert melden – sonst nur merken, dass nachgesehen wurde
  if (!found) { await tracks.putQuiet(next); return null; }
  const saved = { ...next, updated: Date.now() };
  await tracks.put(saved);
  return saved;
}

/** Alle früher übernommenen Wege ohne Messwerte → Anzahl mit neuen Werten */
export async function fillHealthValues({ onProgress } = {}) {
  const todo = (await tracks.all()).filter((t) => t.source?.health && !t.source.values);
  let n = 0;
  for (const [i, t] of todo.entries()) {
    onProgress?.(i, todo.length);
    if (await refreshHealthValues(t)) n += 1;
  }
  return n;
}
