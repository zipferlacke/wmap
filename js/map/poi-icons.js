/**
 * Symbole der Orte in der Grundkarte (Kacheln, Ebene „poi“): ein runder Knopf in der Farbe der Art mit weißem
 * Symbol aus der Icon-Schrift (Material Symbols Rounded, wie überall in der Oberfläche) – wie der Kopf des
 * Ortsdialogs. Statt der Symbole des Grundstils.
 *
 * Bild-Kennung `poi:<class>:<subclass>` (OpenMapTiles). Gezeichnet erst, wenn die Karte ein Bild braucht
 * (setMissingStyleImageResolver). Gibt es eine WMap-Kategorie (core/categories.js), gelten deren Symbol und Farbe
 * – Karte, Liste und Dialog sehen gleich aus. Schranken, Poller und Tore bekommen kein Symbol.
 */
import { byId } from '../core/categories.js';

// Farben je Gruppe (wo es keine Kategorie gibt)
const FOOD = '#e8590c', SHOP = '#5c6bc0', HEALTH = '#e03131', CULTURE = '#ae3ec9', NATURE = '#2f9e44';
const SPORT = '#40c057', SERVICE = '#607d8b', TRANSIT = '#1971c2', EDU = '#f59f00', STAY = '#3b5bdb';

/*
 * Unterklasse vor Klasse. Wert: Kennung einer Kategorie oder [Symbol, Farbe]; null = kein Symbol.
 * Fehlt ein Symbol in der Schrift, nimmt drawPoiIcon das nächste der Liste ([Symbol, Ersatz …]).
 */
const SUB = {
  // Verkehr
  parking: 'parking', bicycle_parking: 'bikeparking', motorcycle_parking: ['two_wheeler', '#1e6fd9'],
  bicycle_rental: [['pedal_bike'], '#0b7285'], charging_station: 'charging', fuel: 'fuel',
  bus_stop: 'bus', bus_station: 'bus', tram_stop: [['tram'], TRANSIT], station: 'train', halt: 'train',
  subway: [['subway'], TRANSIT], taxi: [['local_taxi'], '#f59f00'], car_repair: 'carrepair', car_parts: 'carrepair',
  car: [['directions_car'], SERVICE], car_wash: [['local_car_wash'], SERVICE],
  // Essen und Trinken
  bakery: 'bakery', supermarket: 'supermarket', convenience: [['local_convenience_store'], NATURE],
  kiosk: [['storefront'], SHOP], greengrocer: [['nutrition', 'eco'], NATURE], deli: [['storefront'], NATURE],
  department_store: [['store'], SHOP], marketplace: [['storefront'], NATURE], butcher: [['kebab_dining', 'set_meal'], FOOD],
  confectionery: [['cake'], FOOD], coffee: [['coffee'], '#8d5524'], beverages: [['liquor'], FOOD],
  alcohol: [['liquor'], FOOD], wine: [['wine_bar'], FOOD],
  restaurant: 'restaurant', fast_food: 'fastfood', cafe: 'cafe', ice_cream: 'icecream',
  bar: [['local_bar'], '#a61e4d'], nightclub: [['nightlife'], '#a61e4d'], pub: 'pub', biergarten: 'pub',
  // Gesundheit, Drogerie
  pharmacy: 'pharmacy', chemist: [['soap', 'sanitizer'], '#d6336c'], hospital: 'hospital', clinic: 'hospital',
  doctors: 'doctor', dentist: [['dentistry', 'medical_services'], HEALTH], veterinary: [['pets'], HEALTH],
  hearing_aids: [['hearing'], HEALTH], optician: [['eyeglasses', 'visibility'], SHOP],
  // Wasser, Müll, Toiletten
  drinking_water: 'water', waste_basket: [['delete'], '#868e96'], recycling: [['recycling'], NATURE],
  toilets: 'toilets', shelter: [['roofing', 'cottage'], '#5f3dc4'], picnic_site: [['deck', 'table_restaurant'], NATURE],
  // Geld, Post, Amt
  atm: 'atm', bank: [['account_balance'], '#087f5b'], post_box: [['mail'], '#f59f00'],
  post_office: [['local_post_office'], '#f59f00'], parcel_locker: [['package_2', 'inventory_2'], '#f59f00'],
  police: 'police', townhall: [['account_balance'], SERVICE], courthouse: [['gavel'], SERVICE],
  community_centre: [['groups'], SERVICE], public_building: [['account_balance'], SERVICE],
  // Bildung, Kultur
  school: 'school', kindergarten: [['child_care'], EDU], college: [['school'], EDU], university: [['school'], EDU],
  library: [['local_library'], CULTURE], books: [['menu_book'], SHOP], museum: 'museum', gallery: [['palette'], CULTURE],
  art: [['palette'], CULTURE], arts_centre: [['palette'], CULTURE], artwork: [['brush', 'palette'], CULTURE],
  theatre: [['theater_comedy'], CULTURE], cinema: 'cinema', castle: 'castle', monument: [['account_balance'], '#795548'],
  attraction: [['photo_camera'], CULTURE], viewpoint: 'viewpoint', christian: 'church', muslim: [['mosque'], '#862e9c'],
  jewish: [['synagogue'], '#862e9c'], buddhist: [['temple_buddhist'], '#862e9c'], cemetery: [['deceased', 'yard'], '#5c940d'],
  information: [['info'], SERVICE], board: [['info'], SERVICE], guidepost: [['signpost'], SERVICE], map: [['map'], SERVICE],
  office: [['info'], SERVICE],
  // Freizeit, Sport, Natur
  park: 'park', garden: [['yard', 'park'], NATURE], playground: 'playground', sports_centre: 'sports',
  swimming_pool: 'pool', water_park: 'pool', soccer: 'soccer', basketball: [['sports_basketball'], SPORT],
  table_tennis: [['sports_tennis'], SPORT], tennis: [['sports_tennis'], SPORT], yoga: [['self_improvement'], SPORT],
  gymnastics: [['sports_gymnastics'], SPORT], fitness_centre: [['fitness_center'], SPORT],
  // Übernachten
  hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel', motel: 'hotel', dormitory: [['bed', 'hotel'], STAY],
  camp_site: 'camping', caravan_site: 'camping',
  // Dienste und Läden
  hairdresser: [['content_cut'], SHOP], beauty: [['face'], SHOP], massage: [['spa'], SHOP], laundry: [['local_laundry_service'], SERVICE],
  dry_cleaning: [['dry_cleaning'], SERVICE], clothes: [['apparel', 'checkroom'], SHOP], bag: [['shopping_bag'], SHOP],
  shoes: [['steps', 'checkroom'], SHOP], florist: [['local_florist'], NATURE], furniture: [['chair'], SHOP],
  jewelry: [['diamond'], SHOP], watches: [['watch'], SHOP], mobile_phone: [['smartphone'], SHOP], electronics: [['devices'], SHOP],
  computer: [['computer'], SHOP], hifi: [['speaker'], SHOP], tobacco: [['smoking_rooms'], SHOP], travel_agency: [['luggage'], SHOP],
  tailor: [['apparel', 'checkroom'], SHOP], tattoo: [['brush'], SHOP], toys: [['toys'], SHOP], pet: [['pets'], SHOP],
  sports: [['sports_soccer'], SHOP], outdoor: [['hiking'], SHOP], photo: [['photo_camera'], SHOP], stationery: [['edit'], SHOP],
  copyshop: [['print'], SHOP], newsagent: [['newspaper'], SHOP], ticket: [['confirmation_number'], SHOP], gift: [['redeem'], SHOP],
  cosmetics: [['face'], SHOP], perfumery: [['spa'], SHOP], antiques: [['chair'], SHOP], second_hand: [['sell'], SHOP],
  locksmith: [['key'], SHOP], fabric: [['texture'], SHOP], interior_decoration: [['chair'], SHOP], music: [['music_note'], SHOP],
  musical_instrument: [['music_note'], SHOP], mall: [['local_mall'], SHOP], charity: [['volunteer_activism'], SHOP],
  // ohne Symbol
  bollard: null, gate: null, lift_gate: null, cycle_barrier: null, entrance: null,
};
const CLASS = {
  grocery: [['local_grocery_store'], NATURE], alcohol_shop: [['liquor'], FOOD], clothing_store: [['apparel', 'checkroom'], SHOP],
  shop: [['shopping_bag'], SHOP], office: [['work'], SERVICE], lodging: 'hotel', place_of_worship: 'church',
  pitch: [['sports'], SPORT], art_gallery: [['palette'], CULTURE], bus: 'bus', railway: 'train', rail: 'train',
  airport: [['flight'], TRANSIT], town_hall: [['account_balance'], SERVICE], college: [['school'], EDU],
  information: [['info'], SERVICE], post: [['local_post_office'], '#f59f00'], laundry: [['local_laundry_service'], SERVICE],
  car: [['directions_car'], SERVICE], bicycle: [['pedal_bike'], '#0b7285'], hospital: 'hospital', fuel: 'fuel',
  music: [['music_note'], SHOP], beer: 'pub', lift_gate: null, gate: null, bollard: null, cycle_barrier: null,
};
const FALLBACK = [['location_on'], '#868e96'];

/** Ausdruck für `icon-image` der Ebenen der Grundkarte */
export const POI_ICON = ['concat', 'poi:', ['to-string', ['get', 'class']], ':', ['to-string', ['get', 'subclass']]];

/** `poi:<class>:<subclass>` → [Symbole (mit Ersatz), Farbe] oder null (kein Symbol) */
export function poiStyle(id) {
  const [, cls, sub] = id.split(':');
  const hit = sub in SUB ? SUB[sub] : cls in CLASS ? CLASS[cls] : FALLBACK;
  if (hit === null) return null;
  if (typeof hit === 'string') {
    const c = byId(hit);
    return c ? [[c.icon], c.color] : FALLBACK;
  }
  return [Array.isArray(hit[0]) ? hit[0] : [hit[0]], hit[1]];
}

// OSM-Schlüssel, deren Wert die Unterklasse der Kacheln ist (amenity=waste_basket → waste_basket)
const KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'highway', 'railway', 'historic', 'office', 'healthcare', 'religion',
  'sport', 'craft', 'man_made', 'natural', 'emergency', 'information'];

/**
 * Symbol und Farbe für einen Ort aus seinen OSM-Merkmalen – wie auf der Karte (für den Dialog, wo es keine
 * WMap-Kategorie gibt). → { icon, color } oder null
 */
export function iconForTags(tags = {}) {
  for (const k of KEYS) {
    const v = tags[k];
    if (!v || !(v in SUB) || SUB[v] === null) continue;
    const st = poiStyle(`poi::${v}`);
    if (st) return { icon: st[0][0], color: st[1] };
  }
  return null;
}

const FONT = '"Material Symbols Rounded"';
const known = new Map();       // Symbol → in der Schrift? (Ligatur: so breit wie ein Zeichen)

/** Hat die Schrift dieses Symbol? Ohne Ligatur steht der Name als Text da – viel breiter als hoch */
function hasGlyph(ctx, name) {
  if (!known.has(name)) {
    ctx.font = `40px ${FONT}`;
    known.set(name, ctx.measureText(name).width < 60);
  }
  return known.get(name);
}

/**
 * Zeichnet das Symbol für `poi:<class>:<subclass>` und trägt es ein. Ohne Symbol (Schranken …) ein leeres Bild,
 * damit MapLibre nicht jedes Mal nachfragt.
 */
export async function addPoiIcon(map, id) {
  if (map.hasImage(id)) return;
  const style = poiStyle(id);
  if (!style) { map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) }); return; }
  await document.fonts?.load?.(`16px ${FONT}`).catch(() => {});
  if (map.hasImage(id)) return;
  const r = 2;                                   // für scharfe Darstellung
  const S = 20 * r;
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = c.getContext('2d');
  const glyph = style[0].find((g) => hasGlyph(ctx, g)) ?? 'location_on';
  const m = S / 2;
  // Knopf: weißer Rand, leichter Schatten, darin die Farbe der Art
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 2 * r;
  ctx.shadowOffsetY = 0.5 * r;
  ctx.beginPath();
  ctx.arc(m, m, m - 1.5 * r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(m, m, m - 2.75 * r, 0, Math.PI * 2);
  ctx.fillStyle = style[1];
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${12 * r}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, m, m + 0.5 * r);
  if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, S, S), { pixelRatio: r });
}
