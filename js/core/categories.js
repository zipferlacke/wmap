/**
 * Kategorien: Suchwort der Sprache (Sprachdatei, immer auch das deutsche) → OSM-Filter für Overpass.
 *
 * `terms`   Wortstämme (klein, ohne Umlaute); ein Suchwort passt, wenn es mit
 *           einem Stamm beginnt oder sich höchstens um einen Buchstaben
 *           unterscheidet – „Parkplaz“ und „Backerei“ finden trotzdem etwas.
 * `filters` Overpass-Tag-Filter, jeder für sich eine Abfrage (ODER)
 * `extra`   wird mitgesucht, gehört aber zu einer eigenen Kategorie
 *           (Restaurants zeigen auch Imbisse, ein Imbiss bleibt ein Imbiss)
 * `kind`    'point' | 'area' | 'line' – wie die Geometrie gezeigt wird
 * `route`   in der Leiste „Entlang der Route“ für diese Profile anbieten
 */
import { t, words } from './i18n.js';
export const CATEGORIES = [
  { id: 'parking', label: t('categories.parking.label'), one: t('categories.parking.one'), icon: 'local_parking', color: '#1e6fd9',
    terms: words('categories.parking.terms'),
    filters: ['["amenity"="parking"]'], kind: 'area', route: ['car'] },
  { id: 'fuel', label: t('categories.fuel.label'), one: t('categories.fuel.one'), icon: 'local_gas_station', color: '#d9480f',
    terms: words('categories.fuel.terms'),
    filters: ['["amenity"="fuel"]'], kind: 'point', route: ['car'] },
  { id: 'charging', label: t('categories.charging.label'), one: t('categories.charging.one'), icon: 'ev_station', color: '#0ca678',
    terms: words('categories.charging.terms'),
    filters: ['["amenity"="charging_station"]'], kind: 'point', route: ['car', 'bike'] },
  { id: 'bakery', label: t('categories.bakery.label'), one: t('categories.bakery.one'), icon: 'bakery_dining', color: '#b7791f',
    terms: words('categories.bakery.terms'),
    filters: ['["shop"="bakery"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'supermarket', label: t('categories.supermarket.label'), one: t('categories.supermarket.one'), icon: 'shopping_cart', color: '#2f9e44',
    terms: words('categories.supermarket.terms'),
    filters: ['["shop"="supermarket"]', '["shop"="convenience"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'restaurant', label: t('categories.restaurant.label'), one: t('categories.restaurant.one'), icon: 'restaurant', color: '#c2255c',
    terms: words('categories.restaurant.terms'),
    filters: ['["amenity"="restaurant"]'], extra: ['["amenity"="fast_food"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'fastfood', label: t('categories.fastfood.label'), one: t('categories.fastfood.one'), icon: 'fastfood', color: '#e8590c',
    terms: words('categories.fastfood.terms'),
    filters: ['["amenity"="fast_food"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'cafe', label: t('categories.cafe.label'), one: t('categories.cafe.one'), icon: 'local_cafe', color: '#8d5524',
    terms: words('categories.cafe.terms'),
    filters: ['["amenity"="cafe"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'icecream', label: t('categories.icecream.label'), one: t('categories.icecream.one'), icon: 'icecream', color: '#e64980',
    terms: words('categories.icecream.terms'),
    filters: ['["amenity"="ice_cream"]', '["shop"="ice_cream"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'pub', label: t('categories.pub.label'), one: t('categories.pub.one'), icon: 'sports_bar', color: '#a61e4d',
    terms: words('categories.pub.terms'),
    filters: ['["amenity"~"^(pub|bar|biergarten)$"]'], kind: 'point' },
  { id: 'toilets', label: t('categories.toilets.label'), one: t('categories.toilets.one'), icon: 'wc', color: '#495057',
    terms: words('categories.toilets.terms'),
    filters: ['["amenity"="toilets"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'water', label: t('categories.water.label'), one: t('categories.water.one'), icon: 'water_drop', color: '#1c7ed6',
    terms: words('categories.water.terms'),
    filters: ['["amenity"="drinking_water"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'rest', label: t('categories.rest.label'), one: t('categories.rest.one'), icon: 'airline_seat_recline_normal', color: '#5c940d',
    terms: words('categories.rest.terms'),
    filters: ['["highway"~"^(rest_area|services)$"]'], kind: 'area', route: ['car'] },
  { id: 'shelter', label: t('categories.shelter.label'), one: t('categories.shelter.one'), icon: 'cottage', color: '#5f3dc4',
    terms: words('categories.shelter.terms'),
    filters: ['["amenity"="shelter"]', '["tourism"~"^(alpine_hut|wilderness_hut)$"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'bench', label: t('categories.bench.label'), one: t('categories.bench.one'), icon: 'chair', color: '#868e96',
    terms: words('categories.bench.terms'),
    filters: ['["amenity"="bench"]', '["leisure"="picnic_table"]'], kind: 'point' },
  { id: 'viewpoint', label: t('categories.viewpoint.label'), one: t('categories.viewpoint.one'), icon: 'visibility', color: '#7048e8',
    terms: words('categories.viewpoint.terms'),
    filters: ['["tourism"="viewpoint"]', '["man_made"="tower"]["tower:type"="observation"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'peak', label: t('categories.peak.label'), one: t('categories.peak.one'), icon: 'landscape', color: '#795548',
    terms: words('categories.peak.terms'),
    filters: ['["natural"="peak"]'], kind: 'point' },
  { id: 'hotel', label: t('categories.hotel.label'), one: t('categories.hotel.one'), icon: 'hotel', color: '#3b5bdb',
    terms: words('categories.hotel.terms'),
    filters: ['["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'camping', label: t('categories.camping.label'), one: t('categories.camping.one'), icon: 'camping', color: '#2b8a3e',
    terms: words('categories.camping.terms'),
    filters: ['["tourism"~"^(camp_site|caravan_site)$"]'], kind: 'area', route: ['car', 'bike'] },
  { id: 'pharmacy', label: t('categories.pharmacy.label'), one: t('categories.pharmacy.one'), icon: 'local_pharmacy', color: '#e03131',
    terms: words('categories.pharmacy.terms'),
    filters: ['["amenity"="pharmacy"]'], kind: 'point', route: ['car'] },
  { id: 'hospital', label: t('categories.hospital.label'), one: t('categories.hospital.one'), icon: 'local_hospital', color: '#c92a2a',
    terms: words('categories.hospital.terms'),
    filters: ['["amenity"="hospital"]'], kind: 'area' },
  { id: 'doctor', label: t('categories.doctor.label'), one: t('categories.doctor.one'), icon: 'stethoscope', color: '#f03e3e',
    terms: words('categories.doctor.terms'),
    filters: ['["amenity"~"^(doctors|clinic)$"]'], kind: 'point' },
  { id: 'atm', label: t('categories.atm.label'), one: t('categories.atm.one'), icon: 'atm', color: '#087f5b',
    terms: words('categories.atm.terms'),
    filters: ['["amenity"="atm"]', '["amenity"="bank"]'], kind: 'point' },
  { id: 'bus', label: t('categories.bus.label'), one: t('categories.bus.one'), icon: 'directions_bus', color: '#1971c2',
    terms: words('categories.bus.terms'),
    filters: ['["highway"="bus_stop"]'], kind: 'point' },
  { id: 'train', label: t('categories.train.label'), one: t('categories.train.one'), icon: 'train', color: '#364fc7',
    terms: words('categories.train.terms'),
    filters: ['["railway"~"^(station|halt)$"]'], kind: 'point' },
  { id: 'bikeshop', label: t('categories.bikeshop.label'), one: t('categories.bikeshop.one'), icon: 'pedal_bike', color: '#0b7285',
    terms: words('categories.bikeshop.terms'),
    filters: ['["shop"="bicycle"]', '["amenity"="bicycle_repair_station"]'], kind: 'point', route: ['bike'] },
  { id: 'bikeparking', label: t('categories.bikeparking.label'), one: t('categories.bikeparking.one'), icon: 'directions_bike', color: '#1098ad',
    terms: words('categories.bikeparking.terms'),
    filters: ['["amenity"="bicycle_parking"]'], kind: 'point' },
  { id: 'carrepair', label: t('categories.carrepair.label'), one: t('categories.carrepair.one'), icon: 'car_repair', color: '#5c7cfa',
    terms: words('categories.carrepair.terms'),
    filters: ['["shop"~"^(car_repair|tyres)$"]'], kind: 'point' },
  { id: 'playground', label: t('categories.playground.label'), one: t('categories.playground.one'), icon: 'toys', color: '#f08c00',
    terms: words('categories.playground.terms'),
    filters: ['["leisure"="playground"]'], kind: 'area' },
  { id: 'soccer', label: t('categories.soccer.label'), one: t('categories.soccer.one'), icon: 'sports_soccer', color: '#37b24d',
    terms: words('categories.soccer.terms'),
    filters: ['["leisure"="pitch"]["sport"~"soccer"]'], kind: 'area' },
  { id: 'sports', label: t('categories.sports.label'), one: t('categories.sports.one'), icon: 'sports', color: '#40c057',
    terms: words('categories.sports.terms'),
    filters: ['["leisure"~"^(sports_centre|stadium|fitness_centre)$"]'], kind: 'area' },
  { id: 'pool', label: t('categories.pool.label'), one: t('categories.pool.one'), icon: 'pool', color: '#1c7ed6',
    terms: words('categories.pool.terms'),
    filters: ['["leisure"="water_park"]', '["leisure"="sports_centre"]["sport"="swimming"]', '["amenity"="public_bath"]', '["leisure"="bathing_place"]'],
    kind: 'area' },
  { id: 'river', label: t('categories.river.label'), one: t('categories.river.one'), icon: 'waves', color: '#1864ab',
    terms: words('categories.river.terms'),
    filters: ['["waterway"="river"]'], kind: 'line' },
  { id: 'stream', label: t('categories.stream.label'), one: t('categories.stream.one'), icon: 'water', color: '#339af0',
    terms: words('categories.stream.terms'),
    filters: ['["waterway"~"^(stream|canal)$"]'], kind: 'line' },
  { id: 'lake', label: t('categories.lake.label'), one: t('categories.lake.one'), icon: 'water', color: '#1971c2',
    terms: words('categories.lake.terms'),
    filters: ['["natural"="water"]["water"~"^(lake|reservoir|pond|oxbow)$"]'], kind: 'area' },
  { id: 'park', label: t('categories.park.label'), one: t('categories.park.one'), icon: 'park', color: '#2f9e44',
    terms: words('categories.park.terms'),
    filters: ['["leisure"~"^(park|garden)$"]'], kind: 'area' },
  { id: 'forest', label: t('categories.forest.label'), one: t('categories.forest.one'), icon: 'forest', color: '#2b8a3e',
    terms: words('categories.forest.terms'),
    filters: ['["landuse"="forest"]', '["natural"="wood"]'], kind: 'area' },
  { id: 'church', label: t('categories.church.label'), one: t('categories.church.one'), icon: 'church', color: '#862e9c',
    terms: words('categories.church.terms'),
    filters: ['["amenity"="place_of_worship"]'], kind: 'area' },
  { id: 'castle', label: t('categories.castle.label'), one: t('categories.castle.one'), icon: 'castle', color: '#9c36b5',
    terms: words('categories.castle.terms'),
    filters: ['["historic"~"^(castle|ruins|manor)$"]'], kind: 'area' },
  { id: 'museum', label: t('categories.museum.label'), one: t('categories.museum.one'), icon: 'museum', color: '#ae3ec9',
    terms: words('categories.museum.terms'),
    filters: ['["tourism"~"^(museum|gallery)$"]'], kind: 'point' },
  { id: 'cinema', label: t('categories.cinema.label'), one: t('categories.cinema.one'), icon: 'movie', color: '#d6336c',
    terms: words('categories.cinema.terms'),
    filters: ['["amenity"="cinema"]'], kind: 'point' },
  { id: 'school', label: t('categories.school.label'), one: t('categories.school.one'), icon: 'school', color: '#f59f00',
    terms: words('categories.school.terms'),
    filters: ['["amenity"="school"]'], kind: 'area' },
  { id: 'police', label: t('categories.police.label'), one: t('categories.police.one'), icon: 'local_police', color: '#1c3d8a',
    terms: words('categories.police.terms'),
    filters: ['["amenity"="police"]'], kind: 'point' },
];

export const byId = (id) => (String(id).startsWith('name:') ? nameCategory(id.slice(5)) : CATEGORIES.find((c) => c.id === id));

/*
 * Suche nach einem Namen oder einer Marke („Rewe“, „Aldi“, „dm“) wie nach einer Kategorie: alle in der Gegend,
 * deren Name oder Marke den Text enthält – nur Geschäfte, Lokale und dergleichen (keine Straßen gleichen Namens).
 * `byName`: der Text; Kachel-Treffer prüfen den Namen statt der Art (app/category.js).
 */
const PLACE_KEYS = '^(shop|amenity|tourism|leisure|craft|office|healthcare)$';
export function nameCategory(text) {
  const q = String(text).trim();
  // Overpass nimmt einen regulären Ausdruck: Sonderzeichen werden zu „beliebiges Zeichen“
  const re = q.replace(/[^\p{L}\p{N} &'-]/gu, '.');
  return {
    id: `name:${q}`, label: q, one: q, icon: 'storefront', color: '#e8590c', kind: 'point', byName: q,
    filters: [`["name"~"${re}",i][~"${PLACE_KEYS}"~"."]`, `["brand"~"${re}",i]`],
  };
}

/** Kategorien für die Leiste „Entlang der Route“ je Profil. */
export const routeCategories = (profile) => CATEGORIES.filter((c) => c.route?.includes(profile));

/* ── Abgleich ─────────────────────────────────────────────────────────────── */

const normalize = (s) => String(s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9+\- ]/g, ' ').replace(/-/g, '').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Passt ein einzelnes Wort zu einem Stamm?
 *
 * Ein längeres Wort gilt nur mit kurzer Endung als Treffer (Plural, Beugung).
 * Sonst würde aus „Parkstraße“ ein Park und aus „Waldweg“ ein Wald.
 * `loose` lässt beim Tippen auch angefangene Wörter zu („parkpl“).
 */
function wordMatches(word, term, loose) {
  if (word === term) return 3;
  if (term.length >= 4 && word.startsWith(term) && word.length - term.length <= 2) return 2;
  if (term.startsWith(word) && word.length >= (loose ? 3 : Math.max(4, term.length - 2))) return 2;
  if (term.length >= 5 && lev(word, term) <= (term.length >= 9 ? 2 : 1)) return 1;
  return 0;
}

for (const c of CATEGORIES) if (c.terms) c.terms = c.terms.map(normalize);
const FILLER = new Set(words('search.words.filler').map(normalize));

const PREPOSITION = /\s(in|im|bei|beim|nahe|um|am|an)\s/i;

/**
 * Sucht eine Kategorie im Text.
 * → { category, place, strong } – `place` ist der Rest („Parkplätze in
 *   Göttingen“ → „Göttingen“), `strong` sagt, ob der Text eindeutig eine
 *   Kategorie-Suche ist. null, wenn keine Kategorie passt.
 */
export function matchCategory(text, { loose = false } = {}) {
  const words = normalize(text).split(' ').filter(Boolean);
  if (!words.length) return null;
  let best = null;
  for (const cat of CATEGORIES) {
    for (const term of cat.terms) {
      const parts = term.split(' ');
      for (let i = 0; i + parts.length <= words.length; i += 1) {
        let score = 0;
        for (let k = 0; k < parts.length; k += 1) {
          const s = wordMatches(words[i + k], parts[k], loose && i + k === words.length - 1);
          if (!s) { score = 0; break; }
          score += s;
        }
        // Längere Begriffe schlagen kürzere: „fussballplatz“ vor „platz“
        if (score && (!best || score * 10 + term.length > best.score)) {
          best = { category: cat, score: score * 10 + term.length, from: i, to: i + parts.length };
        }
      }
    }
  }
  if (!best) return null;
  // Kurze Wörter wie „eis“ oder „bus“ nur als ganzes Suchwort gelten lassen –
  // sonst wird aus „Eisenach“ eine Eisdielen-Suche.
  const hit = words.slice(best.from, best.to).join(' ');
  if (hit.length <= 4 && words.length > 1 && best.score < 30) return null;
  const rest = [...words.slice(0, best.from), ...words.slice(best.to)].filter((w) => !FILLER.has(w));
  // Den Ortsnamen im Original zurückgeben, damit Photon Umlaute behält
  const place = rest.length ? originalRest(text, rest) : null;
  // Eindeutig ist: nur die Kategorie („Parkplatz“) oder Kategorie + „in Ort“.
  // „Park Sanssouci“ dagegen meint eher den einen Park als alle Parks dort.
  const strong = !place || PREPOSITION.test(` ${text} `);
  return { category: best.category, place, strong };
}

function originalRest(text, restNormalized) {
  const orig = String(text).split(/\s+/).filter(Boolean);
  const out = orig.filter((w) => restNormalized.includes(normalize(w)));
  return out.join(' ') || restNormalized.join(' ');
}

/** Alle Filter, die eine Suche nach der Kategorie abfragt. */
export const searchFilters = (c) => [...c.filters, ...(c.extra ?? [])];
