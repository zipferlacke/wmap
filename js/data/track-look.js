/**
 * Wie ein aufgezeichneter Weg aussieht (Meine Touren → Aufgezeichnet):
 *
 *   sportOf(t)        Art: von Hand gewählt (t.sport), aus Health Connect
 *                     (source.type), bei eigenen Aufzeichnungen aus dem Profil
 *                     – eine fremde GPX-Datei ohne Angabe hat keine (null):
 *                     sie heißt „GPX“, bekommt ein neutrales Symbol und Grau,
 *                     bis man ihr eine Art gibt
 *   sportName/-Icon   Name und Symbol der Art
 *   colorOf(t)        eigene Farbe (t.color), sonst die der Art
 *   ageOpacity(t)     je älter, desto blasser: bis einen Monat 1, dann in
 *                     Monatsschritten bis 0,4 ab zwei Jahren
 *   shownOnMap(t)     auf der Karte? – am Weg selbst festgelegt (t.hidden),
 *                     sonst für das Jahr (Auge am Jahr), sonst nach der
 *                     Einstellung „Auf der Karte zeigen“ (dieses Jahr, letzte
 *                     30 bzw. 365 Tage, alle)
 *   paceOf(t)         wie Tempo angegeben wird: Rudern je 500 m, Schwimmen
 *                     je 100 m, zu Fuß je km, sonst km/h
 *   cadName(t)        wie die Frequenz heißt (Schritt-, Tritt-, Schlag-, Zug-)
 */
import { local } from './store.js';
import { PROFILE_GROUP } from './tracks.js';
import { typeName, typeIcon } from '../services/health.js';

/* ── Art ──────────────────────────────────────────────────────────────────── */

const FROM_GROUP = { car: 'driving', bike: 'biking', foot: 'walking' };

export function sportOf(t) {
  if (t.sport) return t.sport;
  if (t.source?.type) return t.source.type;
  if (t.kind === 'gpx') return null;
  return t.profile === 'hike' ? 'hiking' : FROM_GROUP[PROFILE_GROUP[t.profile]] ?? null;
}

export const sportName = (sport) => (sport === 'driving' ? 'Auto' : sport ? typeName(sport) : 'GPX');
export const sportIcon = (sport) => (sport === 'driving' ? 'directions_car' : sport ? typeIcon(sport) : 'timeline');

/** Arten zum Auswählen – die häufigen zuerst */
export const SPORTS = ['walking', 'hiking', 'running', 'biking', 'driving', 'rowing', 'paddling', 'sailing', 'swimming_open_water',
  'skiing', 'snowboarding', 'snowshoeing', 'skating', 'ice_skating', 'surfing', 'paragliding', 'rock_climbing', 'golf', 'wheelchair', 'other_workout'];

/* ── Farbe ────────────────────────────────────────────────────────────────── */

const NEUTRAL = '#868e96';
const OTHER = '#ae3ec9';
const SPORT_COLOR = {
  walking: '#e8590c', hiking: '#a0611f', running: '#e03131', wheelchair: '#e8590c',
  biking: '#2f9e44', driving: '#1a73e8',
  rowing: '#0c8599', paddling: '#1098ad', sailing: '#3b5bdb', surfing: '#3b5bdb', swimming_open_water: '#15aabf',
  skiing: '#7048e8', snowboarding: '#7048e8', snowshoeing: '#7048e8', ice_skating: '#7048e8', skating: '#d6336c',
  paragliding: '#f59f00', rock_climbing: '#5c940d', golf: '#5c940d',
};

/** Farben zum Auswählen (eigene Farbe eines Wegs) */
export const COLORS = ['#e03131', '#e8590c', '#f59f00', '#5c940d', '#2f9e44', '#0c8599', '#1a73e8', '#3b5bdb', '#7048e8', '#ae3ec9', '#d6336c', '#495057'];

export const sportColor = (sport) => (sport ? SPORT_COLOR[sport] ?? OTHER : NEUTRAL);
export const colorOf = (t) => t.color || sportColor(sportOf(t));

/* ── Alter: ältere Wege blasser ───────────────────────────────────────────── */

const MONTH_MS = 30.44 * 24 * 3600e3;
/** 1 (bis einen Monat alt) … 0,4 (zwei Jahre und älter), in Monatsschritten */
export function ageOpacity(t, now = Date.now()) {
  const months = Math.max(0, Math.floor((now - t.start) / MONTH_MS));
  return Math.round((1 - 0.6 * Math.min(1, months / 24)) * 100) / 100;
}

/* ── Auf der Karte zeigen ─────────────────────────────────────────────────── */

const SHOW = 'wmap.tracks.show';      // 'all' | 'year' | '30' | '365'
const YEARS = 'wmap.tracks.years';    // { [Jahr]: true | false } – von Hand ein- bzw. ausgeblendet
export const SHOW_OPTIONS = [['all', 'Alle'], ['year', 'Dieses Jahr'], ['365', 'Letzte 365 Tage'], ['30', 'Letzte 30 Tage']];

export const trackShow = {
  get: () => { const v = local.get(SHOW, 'all'); return SHOW_OPTIONS.some(([k]) => k === v) ? v : 'all'; },
  set: (v) => local.set(SHOW, v),
  label: () => Object.fromEntries(SHOW_OPTIONS)[trackShow.get()],
  years: () => local.get(YEARS, {}) ?? {},
  /** Ein Jahr von Hand ein- oder ausblenden (null: wieder nach der Einstellung) */
  setYear(year, on) {
    const y = { ...trackShow.years() };
    if (on === null) delete y[year]; else y[year] = !!on;
    local.set(YEARS, y);
  },
};

/** Fällt der Weg in den eingestellten Zeitraum? */
export function inPeriod(t, now = Date.now()) {
  const mode = trackShow.get();
  if (mode === 'year') return new Date(t.start).getFullYear() === new Date(now).getFullYear();
  if (mode === '30' || mode === '365') return now - t.start <= Number(mode) * 24 * 3600e3;
  return true;
}

/** Auf der Karte? Der Weg selbst geht vor, dann das Jahr, dann der Zeitraum */
export function shownOnMap(t, now = Date.now()) {
  if (t.hidden === true) return false;
  if (t.hidden === false) return true;
  const year = trackShow.years()[new Date(t.start).getFullYear()];
  return year ?? inPeriod(t, now);
}

/* ── Tempo und Frequenz je Art ────────────────────────────────────────────── */

const WATER = new Set(['rowing', 'paddling']);
const SWIM = new Set(['swimming_open_water', 'swimming_pool']);
const group = (t) => PROFILE_GROUP[t.profile] ?? 'foot';

/** { per (m), unit } – Zeit je Strecke – oder null: km/h */
export function paceOf(t) {
  const s = sportOf(t);
  if (WATER.has(s)) return { per: 500, unit: '/500 m' };
  if (SWIM.has(s)) return { per: 100, unit: '/100 m' };
  const onFoot = s ? ['walking', 'hiking', 'running', 'snowshoeing', 'wheelchair'].includes(s) : group(t) === 'foot';
  return onFoot ? { per: 1000, unit: '/km' } : null;
}

export function cadName(t) {
  const s = sportOf(t);
  if (WATER.has(s)) return 'Schlagfrequenz';
  if (SWIM.has(s)) return 'Zugfrequenz';
  if (s === 'biking' || (!s && group(t) === 'bike')) return 'Trittfrequenz';
  if (['walking', 'hiking', 'running'].includes(s) || (!s && group(t) === 'foot')) return 'Schrittfrequenz';
  return 'Frequenz';
}

/** Rundenlängen zur Auswahl: auf dem Wasser auch 500 m */
export const lapSizes = (t) => (WATER.has(sportOf(t)) ? [500, 1000, 2000] : SWIM.has(sportOf(t)) ? [100, 500, 1000] : [1000, 2000, 5000]);
