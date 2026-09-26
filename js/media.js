/**
 * Was es zu einem Ort über die OSM-Tags hinaus gibt: ein Bild, eine
 * Kurzbeschreibung aus Wikipedia und – bei Tankstellen – aktuelle Preise.
 *
 * Quellen, der Reihe nach:
 *   image              direkter Bildlink in OSM
 *   wikimedia_commons  „File:…“ → Vorschaubild von Commons
 *   wikipedia          „de:Titel“ → Wikipedia-Zusammenfassung mit Bild
 *   wikidata           Q-Nummer → Bild (P18) und deutscher Artikel
 */
import { API, TANKERKOENIG_KEY } from './config.js';
import { local } from './store.js';
import { distance } from './geo.js';

const WIDTH = 640;
const filePath = (name) => `${API.commons}/${encodeURIComponent(name.replace(/^File:/i, '').trim())}?width=${WIDTH}`;

async function json(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function wikiSummary(lang, title, signal) {
  const d = await json(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, signal);
  return {
    image: d.originalimage?.source && d.thumbnail?.source ? d.thumbnail.source.replace(/\/\d+px-/, `/${WIDTH}px-`) : d.thumbnail?.source ?? null,
    extract: d.extract || null,
    link: d.content_urls?.desktop?.page ?? null,
  };
}

/** → { image, extract, link } – Felder fehlen, wenn es nichts gibt. */
export async function placeMedia(tags = {}, { signal } = {}) {
  const out = { image: null, extract: null, link: null };

  if (/^https?:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(tags.image ?? '')) out.image = tags.image;
  else if (/^File:/i.test(tags.image ?? '')) out.image = filePath(tags.image);
  if (!out.image && /^File:/i.test(tags.wikimedia_commons ?? '')) out.image = filePath(tags.wikimedia_commons);

  try {
    let wp = tags.wikipedia?.match(/^([a-z]{2,3}):(.+)$/);
    let entity = null;
    if (tags.wikidata && (!wp || !out.image)) {
      const d = await json(`${API.wikidata}/${tags.wikidata}.json`, signal);
      entity = d.entities?.[tags.wikidata];
      const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (!out.image && p18) out.image = filePath(p18);
      const de = entity?.sitelinks?.dewiki?.title;
      if (de) wp = [null, 'de', de];
    }
    if (wp) {
      const s = await wikiSummary(wp[1], wp[2], signal);
      out.extract = s.extract;
      out.link = s.link;
      out.image ??= s.image;
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    /* Bild und Text sind Zugabe */
  }
  return out;
}

/* ── Spritpreise ──────────────────────────────────────────────────────────── */

export const fuelKey = () => local.get('wmap.tankerkoenig', '') || TANKERKOENIG_KEY;

/**
 * Preise der Tankstelle an diesem Punkt (Tankerkönig / Markttransparenzstelle).
 * → { e5, e10, diesel, open, name } oder null (kein Schlüssel, nichts in der Nähe)
 */
export async function fuelPrices([lon, lat], { signal } = {}) {
  const key = fuelKey();
  if (!key) return null;
  const u = new URL(API.tankerkoenig);
  Object.entries({ lat, lng: lon, rad: 1, sort: 'dist', type: 'all', apikey: key })
    .forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const d = await json(u, signal);
  if (!d.ok) throw new Error(d.message || 'Tankerkönig antwortet nicht');
  // Die OSM-Tankstelle und die gemeldete liegen selten exakt übereinander
  const s = (d.stations ?? []).find((x) => distance([lon, lat], [x.lng, x.lat]) < 150);
  return s ? { e5: s.e5, e10: s.e10, diesel: s.diesel, open: s.isOpen, name: s.brand || s.name } : null;
}

/* ── Abfahrten (Züge) ─────────────────────────────────────────────────────── */

/** Ein Bahnhof oder Haltepunkt der Eisenbahn? (Busse: noch keine offene Quelle) */
export function isTrainStation(t = {}) {
  return ['station', 'halt'].includes(t.railway) && t.station !== 'subway' && t.station !== 'light_rail'
    || (t.public_transport === 'station' && (t.train === 'yes' || !!t.uic_ref));
}

const depCache = new Map();

/**
 * Nächste Abfahrten über DBF (Daten der DB, IRIS). Der Bahnhof wird über die
 * IBNR (uic_ref), sonst das DS100-Kürzel, sonst den Namen gefunden.
 * → [{ time, delay, train, destination, platform, cancelled }]
 */
export async function trainDepartures(tags, { signal } = {}) {
  // uic_ref ist in OSM nicht immer die IBNR der DB – der Reihe nach probieren:
  // DS100-Kürzel (HG), IBNR, Name
  const ids = [tags['railway:ref'], tags.uic_ref?.match(/^80\d{5}$/)?.[0], tags.name]
    .filter((x, i, all) => x && all.indexOf(x) === i);
  if (!ids.length) return [];
  const key = ids[0];
  const hit = depCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.list;
  let res = null;
  for (const id of ids) {
    res = await fetch(`${API.departures}/${encodeURIComponent(id)}.json`, { signal }).catch((err) => {
      if (err.name === 'AbortError') throw err;
      return null;
    });
    if (res?.ok) break;
  }
  if (!res?.ok) throw new Error('Abfahrten gerade nicht abrufbar');
  const data = await res.json();
  if (data.error) throw new Error('Für diesen Bahnhof gibt es keine Abfahrten');
  const list = (data.departures ?? [])
    .filter((d) => d.scheduledDeparture)
    .map((d) => ({
      time: d.scheduledDeparture,
      delay: Number(d.delayDeparture) || 0,
      train: d.train,
      destination: d.destination,
      platform: d.platform ?? d.scheduledPlatform ?? '',
      platformChanged: !!d.platform && !!d.scheduledPlatform && d.platform !== d.scheduledPlatform,
      cancelled: !!d.isCancelled,
    }))
    .slice(0, 10);
  depCache.set(key, { at: Date.now(), list });
  return list;
}
