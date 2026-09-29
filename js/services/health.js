/**
 * Health Connect (nur in der Android-App): Trainings anderer Apps – Fitbit,
 * Samsung Health, Strava, Google Fit … – mit ihren Routen als Wege
 * übernehmen. Die Arbeit macht das eigene Tauri-Plugin
 * (src-tauri/plugins/health, Kotlin); im Browser gibt es das nicht.
 *
 *   healthSessions()   Freigabe prüfen bzw. erfragen, dann alle Trainings
 *   importHealth(list) Routen holen und als Wege speichern – schon
 *                      übernommene (gleiche ID oder gleicher Weg) nicht doppelt
 *
 * Routen fremder Apps gibt Health Connect ab Android 15 mit einer
 * Dauerfreigabe heraus; sonst fragt es je Training nach.
 */
import { tracks, buildTrack, guessProfile, sameTrack, defaultName } from '../data/tracks.js';

const core = window.__TAURI__?.core;
export const healthAvailable = !!core && /Android/i.test(navigator.userAgent);

const call = (cmd, args = {}) => core.invoke(`plugin:health|${cmd}`, args);
const READ = 'android.permission.health.READ_EXERCISE';

/** Art des Trainings (Health Connect) → Profil in WMap; sonst am Tempo erkennen */
const PROFILE = { biking: 'bike', hiking: 'hike', walking: 'walk', running: 'foot' };

export const TYPE_NAME = {
  biking: 'Radfahren', biking_stationary: 'Heimtrainer', hiking: 'Wandern', walking: 'Gehen',
  running: 'Laufen', running_treadmill: 'Laufband', swimming_open_water: 'Schwimmen', swimming_pool: 'Schwimmbad',
  skiing: 'Ski', snowboarding: 'Snowboard', paddling: 'Paddeln', rowing: 'Rudern', sailing: 'Segeln',
  wheelchair: 'Rollstuhl', skating: 'Skaten', other_workout: 'Training',
};

const APP_NAME = {
  'com.google.android.apps.fitness': 'Google Fit', 'com.fitbit.FitbitMobile': 'Fitbit',
  'com.sec.android.app.shealth': 'Samsung Health', 'com.strava': 'Strava', 'de.komoot.android': 'Komoot',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect', 'com.huawei.health': 'Huawei Health',
  'com.withings.wiscale2': 'Withings', 'com.polar.polarflow': 'Polar Flow', 'com.suunto.android': 'Suunto',
};
export const appName = (pkg) => APP_NAME[pkg] ?? pkg?.split('.').slice(-2).join('.') ?? '?';

/** Alle Trainings (neueste zuerst) – fragt beim ersten Mal nach der Freigabe */
export async function healthSessions({ days = 3650 } = {}) {
  const st = await call('status');
  if (!st.available) throw new Error(st.sdkStatus === 2 ? 'Health Connect muss erst aktualisiert werden' : 'Health Connect gibt es auf diesem Gerät nicht');
  if (!st.granted?.includes(READ)) {
    const r = await call('request_access');
    if (!r.granted?.includes(READ)) throw new Error('Ohne Freigabe für Trainings kann WMap nichts lesen');
  }
  const { sessions } = await call('sessions', { days });
  return sessions.sort((a, b) => b.start - a.start);
}

/**
 * Trainings mit Route als Wege speichern.
 * → { added, known, empty, denied }; onProgress(i, n)
 */
export async function importHealth(sessions, { onProgress } = {}) {
  const have = await tracks.all();
  const seen = new Set(have.map((t) => t.source?.health).filter(Boolean));
  const out = { added: 0, known: 0, empty: 0, denied: 0 };
  for (const [i, s] of sessions.entries()) {
    onProgress?.(i, sessions.length);
    if (s.route === 'none') continue;
    if (seen.has(s.id)) { out.known += 1; continue; }
    let points;
    try {
      ({ points } = await call('route', { id: s.id }));
    } catch (err) {
      // Nachfrage für diese Route abgelehnt – dann nicht weiter nerven
      if (/nicht freigegeben|denied/i.test(String(err))) { out.denied += 1; break; }
      throw err;
    }
    const profile = PROFILE[s.type] ?? null;
    let t = buildTrack(points.map(([lon, lat, , ms]) => [lon, lat, ms]), { kind: 'health', profile: profile ?? 'foot', name: '' });
    if (!t) { out.empty += 1; continue; }
    if (!profile) t = guessProfile(t);
    t = { ...t, name: s.title || defaultName(t.profile, t.start), source: { health: s.id, app: s.app } };
    if (have.some((x) => sameTrack(x, t))) { out.known += 1; continue; }
    await tracks.put(t);
    have.push(t);
    out.added += 1;
  }
  return out;
}
