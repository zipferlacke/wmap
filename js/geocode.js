/**
 * Suche über Photon – den Open-Source-Geocoder von komoot.
 *
 * Photon ist für „Suchen beim Tippen“ gebaut und verzeiht Tippfehler
 * („Götingen“, „Hauptstrase“). Mit lat/lon wird nach Nähe gewichtet.
 */
import { API } from './config.js';

const STATION_WORDS = /\b(hbf|hauptbahnhof|bahnhof|bhf|station)\b\.?/i;

async function photon(q, { center, zoom, limit, signal, bbox, tag } = {}) {
  const u = new URL('/api', API.photon);
  u.searchParams.set('q', q);
  u.searchParams.set('lang', 'de');
  u.searchParams.set('limit', String(limit));
  if (tag) u.searchParams.set('osm_tag', tag);
  if (center) {
    u.searchParams.set('lon', center[0].toFixed(5));
    u.searchParams.set('lat', center[1].toFixed(5));
    if (zoom !== undefined) u.searchParams.set('zoom', String(Math.round(Math.max(4, Math.min(16, zoom)))));
  }
  if (bbox) u.searchParams.set('bbox', bbox.map((v) => v.toFixed(5)).join(','));
  const res = await fetch(u, { signal });
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`);
  return (await res.json()).features ?? [];
}

export async function search(q, { center, zoom, limit = 7, signal, bbox } = {}) {
  // Etwas mehr holen – das Aussortieren nimmt einige wieder weg
  const jobs = [photon(q, { center, zoom, limit: limit + 4, signal, bbox })];
  // „Göttingen Bahnhof“ findet Photon allein schlecht (Industriegleis, Stadtteil
  // „Bahnhof-Ost“) – gezielt nach Bahnhöfen des Orts fragen und vorn einreihen
  const place = q.replace(STATION_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (STATION_WORDS.test(q) && place.length >= 2) {
    jobs.unshift(Promise.all(['railway:station', 'railway:halt'].map((tag) => photon(place, { center, zoom, limit: 2, signal, bbox, tag })))
      .then((r) => r.flat()).catch(() => []));
  }
  const all = (await Promise.all(jobs)).flat();
  return dedupe(all).slice(0, limit);
}

export async function reverse([lon, lat], { signal } = {}) {
  const u = new URL('/reverse', API.photon);
  u.searchParams.set('lon', lon.toFixed(6));
  u.searchParams.set('lat', lat.toFixed(6));
  u.searchParams.set('lang', 'de');
  u.searchParams.set('limit', '1');
  const res = await fetch(u, { signal });
  if (!res.ok) return null;
  return (await res.json()).features?.[0] ?? null;
}

/** Statistik- und Verwaltungsflächen („Bahnhof-Ost, statistical“) sucht niemand. */
const NOISE = new Set(['statistical', 'political', 'census']);

/**
 * Ein Fluss besteht in OSM aus vielen Wegen gleichen Namens – einer reicht.
 * Ebenso bei gleichnamigen Treffern gleicher Art im selben Ort.
 */
function dedupe(features) {
  const seen = new Set();
  return features.filter((f) => {
    const p = f.properties;
    if (NOISE.has(p.osm_value)) return false;
    const key = p.name && !p.housenumber
      ? `${p.osm_value}|${p.name}|${p.city ?? p.county ?? ''}` : `${p.osm_type}${p.osm_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Anzeige ──────────────────────────────────────────────────────────────── */

const TYPE_LABEL = {
  city: 'Stadt', town: 'Stadt', village: 'Dorf', hamlet: 'Ortsteil', suburb: 'Stadtteil',
  river: 'Fluss', stream: 'Bach', canal: 'Kanal', lake: 'See', water: 'Gewässer', peak: 'Gipfel',
  station: 'Bahnhof', halt: 'Haltepunkt', bus_stop: 'Haltestelle', parking: 'Parkplatz', fuel: 'Tankstelle',
  restaurant: 'Restaurant', cafe: 'Café', bakery: 'Bäckerei', supermarket: 'Supermarkt', pitch: 'Sportplatz',
  park: 'Park', forest: 'Wald', wood: 'Wald', castle: 'Burg', museum: 'Museum', hotel: 'Hotel',
  school: 'Schule', hospital: 'Krankenhaus', pharmacy: 'Apotheke', charging_station: 'Ladesäule',
  place_of_worship: 'Kirche', viewpoint: 'Aussichtspunkt', playground: 'Spielplatz', residential: 'Straße',
  primary: 'Straße', secondary: 'Straße', tertiary: 'Straße', unclassified: 'Straße', living_street: 'Straße',
  service: 'Weg', footway: 'Fußweg', path: 'Weg', track: 'Feldweg', cycleway: 'Radweg', motorway: 'Autobahn',
  administrative: 'Gebiet', state: 'Bundesland', country: 'Land', county: 'Landkreis', house: 'Adresse',
};

const TYPE_ICON = {
  place: 'location_city', waterway: 'waves', natural: 'landscape', railway: 'train', highway: 'add_road',
  amenity: 'storefront', shop: 'storefront', leisure: 'park', tourism: 'attractions', boundary: 'map',
  building: 'home', historic: 'castle', landuse: 'forest',
};

export function describe(feature) {
  const p = feature.properties ?? {};
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const title = p.name || street || p.city || 'Ort';
  const place = [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' ');
  const parts = [p.name && street ? street : null, place !== title ? place : null,
    p.city ? null : p.county, p.state].filter(Boolean);
  const type = TYPE_LABEL[p.osm_value] ?? (p.housenumber ? 'Adresse' : null);
  const icon = p.housenumber ? 'home' : (TYPE_ICON[p.osm_key] ?? 'location_on');
  return { title, subtitle: [...new Set(parts)].slice(0, 2).join(', '), type, icon };
}
