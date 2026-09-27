/**
 * Kategorien: deutsches Suchwort → OSM-Filter für Overpass.
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
export const CATEGORIES = [
  { id: 'parking', label: 'Parkplätze', one: 'Parkplatz', icon: 'local_parking', color: '#1e6fd9',
    terms: ['parkplatz', 'parkplaetze', 'parken', 'parkhaus', 'parkflaeche', 'tiefgarage'],
    filters: ['["amenity"="parking"]'], kind: 'area', route: ['car'] },
  { id: 'fuel', label: 'Tankstellen', one: 'Tankstelle', icon: 'local_gas_station', color: '#d9480f',
    terms: ['tankstelle', 'tanken', 'benzin', 'diesel', 'sprit'],
    filters: ['["amenity"="fuel"]'], kind: 'point', route: ['car'] },
  { id: 'charging', label: 'E-Ladesäulen', one: 'Ladesäule', icon: 'ev_station', color: '#0ca678',
    terms: ['ladesaeule', 'eladesaeule', 'ladestation', 'ladepunkt', 'elektrotankstelle', 'wallbox', 'strom tanken', 'elektroauto laden'],
    filters: ['["amenity"="charging_station"]'], kind: 'point', route: ['car', 'bike'] },
  { id: 'bakery', label: 'Bäckereien', one: 'Bäckerei', icon: 'bakery_dining', color: '#b7791f',
    terms: ['baeckerei', 'baecker', 'backerei', 'backer', 'broetchen', 'backwaren'],
    filters: ['["shop"="bakery"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'supermarket', label: 'Supermärkte', one: 'Supermarkt', icon: 'shopping_cart', color: '#2f9e44',
    terms: ['supermarkt', 'supermaerkte', 'einkaufen', 'lebensmittel', 'discounter', 'edeka', 'rewe', 'aldi', 'lidl'],
    filters: ['["shop"="supermarket"]', '["shop"="convenience"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'restaurant', label: 'Restaurants', one: 'Restaurant', icon: 'restaurant', color: '#c2255c',
    terms: ['restaurant', 'essen', 'gaststaette', 'gasthaus', 'gasthof', 'wirtshaus'],
    filters: ['["amenity"="restaurant"]'], extra: ['["amenity"="fast_food"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'fastfood', label: 'Imbisse', one: 'Imbiss', icon: 'fastfood', color: '#e8590c',
    terms: ['imbiss', 'fastfood', 'doener', 'pommes', 'pizza', 'burger'],
    filters: ['["amenity"="fast_food"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'cafe', label: 'Cafés', one: 'Café', icon: 'local_cafe', color: '#8d5524',
    terms: ['cafe', 'kaffee', 'kuchen', 'konditorei'],
    filters: ['["amenity"="cafe"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'icecream', label: 'Eisdielen', one: 'Eisdiele', icon: 'icecream', color: '#e64980',
    terms: ['eisdiele', 'eiscafe', 'eis'],
    filters: ['["amenity"="ice_cream"]', '["shop"="ice_cream"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'pub', label: 'Kneipen & Biergärten', one: 'Kneipe', icon: 'sports_bar', color: '#a61e4d',
    terms: ['kneipe', 'bar', 'pub', 'biergarten', 'bier'],
    filters: ['["amenity"~"^(pub|bar|biergarten)$"]'], kind: 'point' },
  { id: 'toilets', label: 'Toiletten', one: 'Toilette', icon: 'wc', color: '#495057',
    terms: ['toilette', 'toiletten', 'wc', 'klo'],
    filters: ['["amenity"="toilets"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'water', label: 'Trinkwasser', one: 'Trinkwasser', icon: 'water_drop', color: '#1c7ed6',
    terms: ['trinkwasser', 'wasserstelle', 'brunnen', 'wasser auffuellen'],
    filters: ['["amenity"="drinking_water"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'rest', label: 'Rastplätze', one: 'Rastplatz', icon: 'airline_seat_recline_normal', color: '#5c940d',
    terms: ['rastplatz', 'raststaette', 'raststation', 'autohof', 'pause'],
    filters: ['["highway"~"^(rest_area|services)$"]'], kind: 'area', route: ['car'] },
  { id: 'shelter', label: 'Hütten & Unterstände', one: 'Hütte', icon: 'cottage', color: '#5f3dc4',
    terms: ['huette', 'schutzhuette', 'unterstand', 'berghuette', 'alm'],
    filters: ['["amenity"="shelter"]', '["tourism"~"^(alpine_hut|wilderness_hut)$"]'], kind: 'point', route: ['bike', 'foot'] },
  { id: 'bench', label: 'Bänke', one: 'Bank', icon: 'chair', color: '#868e96',
    terms: ['bank zum sitzen', 'sitzbank', 'baenke', 'picknick'],
    filters: ['["amenity"="bench"]', '["leisure"="picnic_table"]'], kind: 'point' },
  { id: 'viewpoint', label: 'Aussichtspunkte', one: 'Aussichtspunkt', icon: 'visibility', color: '#7048e8',
    terms: ['aussicht', 'aussichtspunkt', 'aussichtsturm', 'ausblick', 'panorama'],
    filters: ['["tourism"="viewpoint"]', '["man_made"="tower"]["tower:type"="observation"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'peak', label: 'Gipfel', one: 'Gipfel', icon: 'landscape', color: '#795548',
    terms: ['gipfel', 'berg', 'berge', 'huegel'],
    filters: ['["natural"="peak"]'], kind: 'point' },
  { id: 'hotel', label: 'Unterkünfte', one: 'Unterkunft', icon: 'hotel', color: '#3b5bdb',
    terms: ['hotel', 'unterkunft', 'pension', 'hostel', 'uebernachtung', 'motel', 'ferienwohnung'],
    filters: ['["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]'], kind: 'point', route: ['car', 'bike', 'foot'] },
  { id: 'camping', label: 'Campingplätze', one: 'Campingplatz', icon: 'camping', color: '#2b8a3e',
    terms: ['camping', 'campingplatz', 'zeltplatz', 'wohnmobil', 'stellplatz'],
    filters: ['["tourism"~"^(camp_site|caravan_site)$"]'], kind: 'area', route: ['car', 'bike'] },
  { id: 'pharmacy', label: 'Apotheken', one: 'Apotheke', icon: 'local_pharmacy', color: '#e03131',
    terms: ['apotheke', 'apotheken', 'medikamente'],
    filters: ['["amenity"="pharmacy"]'], kind: 'point', route: ['car'] },
  { id: 'hospital', label: 'Krankenhäuser', one: 'Krankenhaus', icon: 'local_hospital', color: '#c92a2a',
    terms: ['krankenhaus', 'klinik', 'notaufnahme', 'hospital'],
    filters: ['["amenity"="hospital"]'], kind: 'area' },
  { id: 'doctor', label: 'Ärzte', one: 'Arzt', icon: 'stethoscope', color: '#f03e3e',
    terms: ['arzt', 'aerzte', 'praxis', 'hausarzt'],
    filters: ['["amenity"~"^(doctors|clinic)$"]'], kind: 'point' },
  { id: 'atm', label: 'Geldautomaten', one: 'Geldautomat', icon: 'atm', color: '#087f5b',
    terms: ['geldautomat', 'bankautomat', 'geld abheben', 'atm', 'sparkasse', 'volksbank'],
    filters: ['["amenity"="atm"]', '["amenity"="bank"]'], kind: 'point' },
  { id: 'bus', label: 'Bushaltestellen', one: 'Bushaltestelle', icon: 'directions_bus', color: '#1971c2',
    terms: ['bushaltestelle', 'haltestelle', 'bus'],
    filters: ['["highway"="bus_stop"]'], kind: 'point' },
  { id: 'train', label: 'Bahnhöfe', one: 'Bahnhof', icon: 'train', color: '#364fc7',
    terms: ['bahnhof', 'bahnhoefe', 'zug', 'haltepunkt', 's-bahn'],
    filters: ['["railway"~"^(station|halt)$"]'], kind: 'point' },
  { id: 'bikeshop', label: 'Fahrradläden', one: 'Fahrradladen', icon: 'pedal_bike', color: '#0b7285',
    terms: ['fahrradladen', 'fahrradwerkstatt', 'radladen', 'fahrradreparatur'],
    filters: ['["shop"="bicycle"]', '["amenity"="bicycle_repair_station"]'], kind: 'point', route: ['bike'] },
  { id: 'bikeparking', label: 'Fahrradständer', one: 'Fahrradständer', icon: 'directions_bike', color: '#1098ad',
    terms: ['fahrradstaender', 'fahrradparkplatz', 'radstaender', 'fahrrad abstellen'],
    filters: ['["amenity"="bicycle_parking"]'], kind: 'point' },
  { id: 'carrepair', label: 'Werkstätten', one: 'Werkstatt', icon: 'car_repair', color: '#5c7cfa',
    terms: ['werkstatt', 'autowerkstatt', 'kfz', 'reifen'],
    filters: ['["shop"~"^(car_repair|tyres)$"]'], kind: 'point' },
  { id: 'playground', label: 'Spielplätze', one: 'Spielplatz', icon: 'toys', color: '#f08c00',
    terms: ['spielplatz', 'spielplaetze', 'kinder'],
    filters: ['["leisure"="playground"]'], kind: 'area' },
  { id: 'soccer', label: 'Fußballplätze', one: 'Fußballplatz', icon: 'sports_soccer', color: '#37b24d',
    terms: ['fussballplatz', 'fussball', 'bolzplatz', 'fussballfeld', 'sportplatz'],
    filters: ['["leisure"="pitch"]["sport"~"soccer"]'], kind: 'area' },
  { id: 'sports', label: 'Sportanlagen', one: 'Sportanlage', icon: 'sports', color: '#40c057',
    terms: ['sportanlage', 'sporthalle', 'stadion', 'turnhalle', 'fitness'],
    filters: ['["leisure"~"^(sports_centre|stadium|fitness_centre)$"]'], kind: 'area' },
  { id: 'pool', label: 'Schwimmbäder', one: 'Schwimmbad', icon: 'pool', color: '#1c7ed6',
    terms: ['schwimmbad', 'freibad', 'hallenbad', 'baden', 'badesee', 'therme'],
    filters: ['["leisure"="water_park"]', '["leisure"="sports_centre"]["sport"="swimming"]', '["amenity"="public_bath"]', '["leisure"="bathing_place"]'],
    kind: 'area' },
  { id: 'river', label: 'Flüsse', one: 'Fluss', icon: 'waves', color: '#1864ab',
    terms: ['fluss', 'fluesse', 'strom'],
    filters: ['["waterway"="river"]'], kind: 'line' },
  { id: 'stream', label: 'Bäche & Kanäle', one: 'Bach', icon: 'water', color: '#339af0',
    terms: ['bach', 'baeche', 'kanal', 'graben'],
    filters: ['["waterway"~"^(stream|canal)$"]'], kind: 'line' },
  { id: 'lake', label: 'Seen & Teiche', one: 'See', icon: 'water', color: '#1971c2',
    terms: ['see', 'seen', 'teich', 'weiher', 'stausee', 'talsperre'],
    filters: ['["natural"="water"]["water"~"^(lake|reservoir|pond|oxbow)$"]'], kind: 'area' },
  { id: 'park', label: 'Parks', one: 'Park', icon: 'park', color: '#2f9e44',
    terms: ['park', 'parks', 'gruenanlage', 'garten'],
    filters: ['["leisure"~"^(park|garden)$"]'], kind: 'area' },
  { id: 'forest', label: 'Wälder', one: 'Wald', icon: 'forest', color: '#2b8a3e',
    terms: ['wald', 'waelder', 'forst'],
    filters: ['["landuse"="forest"]', '["natural"="wood"]'], kind: 'area' },
  { id: 'church', label: 'Kirchen', one: 'Kirche', icon: 'church', color: '#862e9c',
    terms: ['kirche', 'kirchen', 'kapelle', 'dom', 'moschee', 'synagoge'],
    filters: ['["amenity"="place_of_worship"]'], kind: 'area' },
  { id: 'castle', label: 'Burgen & Schlösser', one: 'Burg', icon: 'castle', color: '#9c36b5',
    terms: ['burg', 'burgen', 'schloss', 'schloesser', 'ruine'],
    filters: ['["historic"~"^(castle|ruins|manor)$"]'], kind: 'area' },
  { id: 'museum', label: 'Museen', one: 'Museum', icon: 'museum', color: '#ae3ec9',
    terms: ['museum', 'museen', 'ausstellung', 'galerie'],
    filters: ['["tourism"~"^(museum|gallery)$"]'], kind: 'point' },
  { id: 'cinema', label: 'Kinos', one: 'Kino', icon: 'movie', color: '#d6336c',
    terms: ['kino', 'kinos', 'film'],
    filters: ['["amenity"="cinema"]'], kind: 'point' },
  { id: 'school', label: 'Schulen', one: 'Schule', icon: 'school', color: '#f59f00',
    terms: ['schule', 'schulen', 'gymnasium', 'grundschule'],
    filters: ['["amenity"="school"]'], kind: 'area' },
  { id: 'police', label: 'Polizei', one: 'Polizei', icon: 'local_police', color: '#1c3d8a',
    terms: ['polizei', 'wache', 'polizeiwache'],
    filters: ['["amenity"="police"]'], kind: 'point' },
];

export const byId = (id) => CATEGORIES.find((c) => c.id === id);

/** Kategorien für die Leiste „Entlang der Route“ je Profil. */
export const routeCategories = (profile) => CATEGORIES.filter((c) => c.route?.includes(profile));

/* ── Abgleich ─────────────────────────────────────────────────────────────── */

export const normalize = (s) => String(s ?? '').toLowerCase()
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

const FILLER = new Set(['in', 'im', 'bei', 'beim', 'nahe', 'um', 'an', 'am', 'der', 'die', 'das', 'den',
  'dem', 'von', 'vom', 'nach', 'naehe', 'naechste', 'naechster', 'naechstes', 'hier', 'zeige', 'zeig',
  'suche', 'mir', 'alle', 'mit', 'und', 'fuer', 'ein', 'eine', 'einen', 'umgebung']);

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
