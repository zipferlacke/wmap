/**
 * Namen für Wege: „Lauf in Rittmarshausen am Dienstagmorgen“ – Art, Gegend und Tageszeit statt Datei- und
 * App-Namen wie „Zepp20240503181502“, „Activity_1234.fit“ oder „Morning Run“.
 *
 *   isPlainName(name)   heißt das nur nach Datei, App, Datum oder Uhrzeit? („Hermannslauf 2024“ nicht)
 *   needsName(t)        soll der Weg einen Namen bekommen? Frisch importiert (nameAuto: 'pending') immer,
 *                       sonst nur fremde Wege (Datei, Health Connect) mit nichtssagendem Namen. Einmal benannt
 *                       (nameAuto = der vergebene Name) nie wieder – auch nicht, wenn man ihn selbst ändert
 *   nameFor(t)          → Name; die Gegend kommt von Photon (nächster Ort), ohne Netz ohne Gegend
 *   nameAll(list)       alle, die einen brauchen, der Reihe nach (höchstens ein Abruf je Sekunde) → Anzahl
 */
import { tracks, trackCoords, defaultName, profileWord } from './tracks.js';
import { sportOf } from './track-look.js';
import { cumulative, pointAt, distance } from '../core/geo.js';
import { askServer } from '../services/servers.js';
import { PHOTON_LANG } from '../services/geocode.js';
import { t, words, ownValue, baseValue } from '../core/i18n.js';

// Wörter, die nur sagen „eine Aufzeichnung aus App X“ – was danach übrig bleibt, ist der eigentliche Name
const FILLER = new RegExp(`\\b(${[
  'zepp', 'amazfit', 'garmin', 'connect', 'strava', 'huawei', 'health', 'polar', 'suunto', 'coros', 'fitbit', 'samsung', 'komoot',
  'wahoo', 'mi', 'fitness', 'google', 'fit', 'gpx', 'tcx', 'export', 'import', 'activity', 'workout',
  'training', 'track', 'route', 'morning', 'afternoon', 'evening', 'night', 'lunch',
  'run', 'ride', 'walk', 'hike', 'swim', 'row', 'outdoor', 'indoor', 'running', 'cycling', 'walking', 'hiking', 'biking', 'rowing', 'untitled', 'new',
  ...words('tracks.names.filler'),
].join('|')})\\b`, 'giu');

export function isPlainName(name) {
  const s = String(name ?? '').replace(/\.(fit|gpx|tcx)$/i, '')
    .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2').replace(/[_-]+/g, ' ');
  return s.replace(FILLER, ' ').replace(/[^\p{L}]+/gu, '').length < 3;
}

// Von WMap selbst vorgeschlagen, noch ohne Gegend („Spaziergang am Dienstagmorgen“)
const WHEN = ['night', 'morning', 'noon', 'afternoon', 'evening'];
const whenPattern = (value) => WHEN.map((k) => value?.[k]).filter(Boolean)
  .map((v) => `^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{what\\\}|\\\{day\\\}/g, '\\S+')}$`);
const BARE = new RegExp([...whenPattern(ownValue('tracks.names.when')), ...whenPattern(baseValue('tracks.names.when'))].join('|'));

export function needsName(t) {
  if (t.kind !== 'gpx' && t.kind !== 'health') return false;     // selbst aufgezeichnet: Name stand zur Wahl
  if (t.nameAuto === 'pending') return true;
  if (typeof t.nameAuto === 'string') return false;
  return isPlainName(t.name) || BARE.test(t.name ?? '') || t.name === defaultName(t.profile, t.start);
}

const WORD = {
  running: 'run', running_treadmill: 'run', walking: 'walk', hiking: 'hike', biking: 'ride', driving: 'car',
  rowing: 'rowing', paddling: 'paddling', sailing: 'sailing', swimming_open_water: 'swimming', skiing: 'skiing',
  snowboarding: 'snowboarding', snowshoeing: 'snowshoeing', skating: 'skating', ice_skating: 'ice_skating',
  surfing: 'surfing', paragliding: 'paragliding', rock_climbing: 'climbing', golf: 'golf', wheelchair: 'drive',
};

/* Gegend: der nächste Ort (Photon, nur „place“) – je ~500 m nur einmal gefragt */
const places = new Map();
const PLACE_KINDS = new Set(['locality', 'hamlet', 'village', 'suburb', 'neighbourhood', 'quarter', 'town', 'city', 'island', 'isolated_dwelling']);
async function placeAt([lon, lat]) {
  const key = `${lon.toFixed(3).slice(0, -1)}|${lat.toFixed(3).slice(0, -1)}`;
  if (places.has(key)) return places.get(key);
  let name = null;
  try {
    const q = new URLSearchParams({ lon: lon.toFixed(5), lat: lat.toFixed(5), lang: PHOTON_LANG, limit: '1', osm_tag: 'place' });
    const res = await askServer('photon', `/reverse?${q}`);
    const f = res.ok ? (await res.json()).features?.[0] : null;
    const p = f?.properties ?? {};
    name = (PLACE_KINDS.has(p.osm_value) && p.name) || p.district || p.city || p.town || p.village || null;
  } catch { /* ohne Netz: ohne Gegend */ }
  places.set(key, name);
  return name;
}

/** Hin und zurück (Ende nah am Start): die Mitte zählt – sonst der Start */
function spotOf(t) {
  const coords = trackCoords(t);
  if (coords.length < 2) return null;
  if (distance(coords[0], coords.at(-1)) > 500) return coords[0];
  const cum = cumulative(coords);
  return pointAt(coords, cum, cum.at(-1) / 2);
}

export async function nameFor(track) {
  const sport = sportOf(track);
  const word = WORD[sport] ? t(`tracks.names.words.${WORD[sport]}`) : profileWord(track.profile);
  const spot = spotOf(track);
  const place = spot ? await placeAt(spot) : null;
  return defaultName(track.profile, track.start, place ? t('tracks.names.with_place', { what: word, place }) : word);   // „Lauf in Rittmarshausen am Dienstagmorgen“
}

let queue = Promise.resolve();
export function nameAll(list, { onEach = () => {} } = {}) {
  // Automatisierte Tests: nur, wenn ein Test es einschaltet (sonst benennt es deren „Lauf 1“ um und fragt Photon)
  try { if (navigator.webdriver && localStorage.getItem('wmap.test.autoName') !== '1') return Promise.resolve(0); } catch { /* weiter */ }
  // Läuft schon eine Runde: danach – wer dann schon benannt ist, fällt bei needsName heraus
  const run = queue.then(async () => {
    let n = 0;
    for (const t of list.filter(needsName)) {
      const now = await tracks.get(t.id).catch(() => null);
      if (!now || !needsName(now)) continue;
      const name = await nameFor(now);
      await tracks.put({ ...now, name, nameAuto: name, updated: Date.now() });
      n += 1;
      onEach(now.id, name);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return n;
  });
  queue = run.catch(() => 0);
  return run;
}
