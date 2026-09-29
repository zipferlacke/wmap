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
 *                      übernommene (gleiche ID oder gleicher Weg) nicht doppelt
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
  return { available: true, read: !!st.granted?.includes(READ), routes: !!st.granted?.includes(ROUTES) };
}

/** Freigabe-Dialog von Health Connect → wie healthStatus() */
export async function healthRequest() {
  await call('request_access');
  return healthStatus();
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
