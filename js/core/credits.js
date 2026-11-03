/**
 * Wem WMap seine Daten und Dienste verdankt – für „Über WMap“ in den
 * Einstellungen und das Danke-Banner unten im Dashboard.
 */
import { t } from './i18n.js';
const CREDITS = [
  { what: t('credits.map_data.what'), name: t('credits.map_data.name'), url: 'https://www.openstreetmap.org/copyright', note: 'ODbL' },
  { what: t('credits.tiles.what'), name: 'OpenFreeMap', url: 'https://openfreemap.org' },
  { what: t('credits.schema.what'), name: 'OpenMapTiles', url: 'https://openmaptiles.org' },
  { what: t('credits.heights.what'), name: 'Mapterhorn', url: 'https://mapterhorn.com' },
  { what: t('credits.search.what'), name: 'Photon (komoot)', url: 'https://photon.komoot.io' },
  { what: t('credits.routing.what'), name: t('credits.routing.name'), url: 'https://valhalla.github.io/valhalla/' },
  { what: t('credits.places.what'), name: 'Overpass API', url: 'https://overpass-api.de' },
  { what: t('credits.trails.what'), name: 'Waymarked Trails', url: 'https://waymarkedtrails.org', note: t('credits.trails.note') },
  { what: t('credits.satellite.what'), name: t('credits.satellite.name'), url: 'https://s2maps.eu', note: t('credits.satellite.note') },
  { what: t('credits.geology_de.what'), name: t('credits.geology_de.name'), url: 'https://www.bgr.bund.de', note: t('credits.geology_de.note') },
  { what: t('credits.geology_world.what'), name: 'Macrostrat', url: 'https://macrostrat.org', note: t('credits.geology_world.note') },
  { what: t('credits.images.what'), name: 'Wikipedia, Wikimedia Commons', url: 'https://www.wikipedia.org' },
  { what: t('credits.transit.what'), name: t('credits.transit.name'), url: 'https://www.nvbw.de/open-data', note: t('credits.transit.note') },
  { what: t('credits.aerial.what'), name: t('credits.aerial.name'), url: 'https://www.adv-online.de', note: t('credits.aerial.note') },
  { what: t('credits.traffic.what'), name: t('credits.traffic.name'), url: 'https://verkehr.autobahn.de' },
  { what: t('credits.fuel.what'), name: 'Tankerkönig', url: 'https://creativecommons.tankerkoenig.de', note: t('credits.fuel.note') },
  { what: t('credits.rendering.what'), name: 'MapLibre GL JS', url: 'https://maplibre.org' },
];

export const creditList = () => CREDITS.map((c) =>
  `<li>${c.what}: <a href="${c.url}" target="_blank" rel="noopener">${c.name}</a>${c.note ? ` (${c.note})` : ''}</li>`).join('');
