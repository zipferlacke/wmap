/**
 * Wem WMap seine Daten und Dienste verdankt – für „Über WMap“ in den
 * Einstellungen und das Danke-Banner unten im Dashboard.
 */
export const CREDITS = [
  { what: 'Kartendaten', name: 'OpenStreetMap-Mitwirkende', url: 'https://www.openstreetmap.org/copyright', note: 'ODbL' },
  { what: 'Kartenkacheln', name: 'OpenFreeMap', url: 'https://openfreemap.org' },
  { what: 'Kartenschema', name: 'OpenMapTiles', url: 'https://openmaptiles.org' },
  { what: 'Höhen', name: 'Mapterhorn', url: 'https://mapterhorn.com' },
  { what: 'Suche', name: 'Photon (komoot)', url: 'https://photon.komoot.io' },
  { what: 'Routing', name: 'Valhalla auf Servern der FOSSGIS', url: 'https://valhalla.github.io/valhalla/' },
  { what: 'Orte und Wege', name: 'Overpass API', url: 'https://overpass-api.de' },
  { what: 'Wander- und Radwege', name: 'Waymarked Trails', url: 'https://waymarkedtrails.org', note: 'CC BY-SA' },
  { what: 'Satellitenbild', name: 'Sentinel-2 cloudless von EOX', url: 'https://s2maps.eu', note: 'Copernicus-Daten' },
  { what: 'Geologie Deutschland', name: 'BGR, GÜK250', url: 'https://www.bgr.bund.de', note: 'Plugin' },
  { what: 'Geologie weltweit', name: 'Macrostrat', url: 'https://macrostrat.org', note: 'CC BY 4.0, Plugin' },
  { what: 'Bilder und Texte', name: 'Wikipedia, Wikimedia Commons', url: 'https://www.wikipedia.org' },
  { what: 'Abfahrten', name: 'DBF', url: 'https://dbf.finalrewind.org' },
  { what: 'Spritpreise', name: 'Tankerkönig', url: 'https://creativecommons.tankerkoenig.de', note: 'CC BY 4.0' },
  { what: 'Kartendarstellung', name: 'MapLibre GL JS', url: 'https://maplibre.org' },
];

export const creditList = () => CREDITS.map((c) =>
  `<li>${c.what}: <a href="${c.url}" target="_blank" rel="noopener">${c.name}</a>${c.note ? ` (${c.note})` : ''}</li>`).join('');
