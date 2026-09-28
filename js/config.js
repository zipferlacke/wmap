/**
 * Zentrale Endpunkte und Profile.
 *
 * Alle öffentlichen Server sind kostenlos, aber ohne Garantie – beim Umzug auf
 * eigene Server ändert sich nur diese Datei.
 */

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Mapterhorn-Höhenkacheln (Terrarium, 512 px) – in Deutschland bis Zoom 16
export const TERRAIN_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';

export const API = {
  // Photon (komoot): tippfehlertolerante Suche über OSM-Daten
  photon: 'https://photon.komoot.io',
  // Valhalla (FOSSGIS): nur für die Entwicklung gedacht
  valhalla: 'https://valhalla1.openstreetmap.de',
  // OSM-API: einzelne Objekte nach Klick – Tags und Umriss in ~0,1 s
  osm: 'https://api.openstreetmap.org/api/0.6',
  // Wikipedia/Wikidata/Commons: Bilder und Kurzbeschreibung zu Orten
  wikidata: 'https://www.wikidata.org/wiki/Special:EntityData',
  commons: 'https://commons.wikimedia.org/wiki/Special:FilePath',
  // Tankerkönig (Markttransparenzstelle): Spritpreise, braucht einen
  // kostenlosen Schlüssel – https://creativecommons.tankerkoenig.de
  tankerkoenig: 'https://creativecommons.tankerkoenig.de/json/list.php',
  // DBF (Derf's Abfahrtstafel, DB-IRIS): Abfahrten an Bahnhöfen – nur Züge.
  // Ein freies Hobby-Projekt: nur auf Klick fragen, Ergebnisse kurz merken.
  departures: 'https://dbf.finalrewind.org',
  // Autobahn GmbH: Sperrungen, Baustellen, Meldungen auf Autobahnen
  autobahn: 'https://verkehr.autobahn.de/o/autobahn',
  // Overpass: Kategorien, POIs entlang der Route, Geometrien zum Hervorheben
  // der Reihe nach gefragt, wenn einer ausgelastet ist oder nicht antwortet
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],
};

/**
 * Fortbewegungsarten.
 *
 * `costing`  Valhalla-Kostenmodell, `options` dessen Einstellungen
 * `radius`   Suchkorridor für POIs entlang der Route in Metern
 * `announce` Entfernungen für die Sprachansage: früh und kurz vorher
 * `tour`     im Tourenplaner wählbar; `nav` in der Routenplanung
 */
export const PROFILES = {
  foot: {
    label: 'Zu Fuß', icon: 'directions_walk', costing: 'pedestrian', nav: true,
    radius: 150, announce: { far: 80, near: 15 },
  },
  bike: {
    label: 'Fahrrad', icon: 'directions_bike', costing: 'bicycle', nav: true,
    options: { bicycle_type: 'Hybrid' },
    radius: 250, announce: { far: 200, near: 30 },
  },
  car: {
    label: 'Auto', icon: 'directions_car', costing: 'auto', nav: true,
    radius: 400, announce: { far: 500, near: 60 },
  },
  /* Bus & Bahn: Verbindungen nach Fahrplan (departures.js, EFA), keine Navigation */
  transit: {
    label: 'Bus & Bahn', icon: 'directions_transit', nav: true, transit: true,
    radius: 150, announce: { far: 80, near: 15 },
  },

  /* Nur im Tourenplaner: welche Wege genommen werden, steuern die Optionen */
  hike: {
    label: 'Wandern', icon: 'hiking', costing: 'pedestrian', tour: true,
    // Wanderwege bis T3 (alpin), Feldwege und Pfade gern, Straßen eher nicht
    options: { max_hiking_difficulty: 3, use_tracks: 1, walkway_factor: 0.9, use_living_streets: 0.6, service_factor: 1.2 },
    radius: 150, announce: { far: 80, near: 15 }, hikeTime: true,
  },
  walk: {
    label: 'Spazieren', icon: 'directions_walk', costing: 'pedestrian', tour: true,
    options: { max_hiking_difficulty: 1, use_tracks: 0.5 },
    radius: 150, announce: { far: 80, near: 15 }, hikeTime: true,
  },
  road: {
    label: 'Rennrad', icon: 'directions_bike', costing: 'bicycle', tour: true,
    // nur Asphalt, Straßen sind in Ordnung
    options: { bicycle_type: 'Road', avoid_bad_surfaces: 1, use_roads: 0.6, use_hills: 0.5 },
    radius: 250, announce: { far: 200, near: 30 },
  },
  tour: {
    label: 'Tourenrad', icon: 'pedal_bike', costing: 'bicycle', tour: true,
    options: { bicycle_type: 'Hybrid', avoid_bad_surfaces: 0.4, use_roads: 0.3 },
    radius: 250, announce: { far: 200, near: 30 },
  },
  gravel: {
    label: 'Gravel', icon: 'landscape', costing: 'bicycle', tour: true,
    // Schotter und Feldwege willkommen, große Straßen meiden
    options: { bicycle_type: 'Cross', avoid_bad_surfaces: 0.1, use_roads: 0.15 },
    radius: 250, announce: { far: 200, near: 30 },
  },
  mtb: {
    label: 'Mountainbike', icon: 'downhill_skiing', costing: 'bicycle', tour: true,
    options: { bicycle_type: 'Mountain', avoid_bad_surfaces: 0, use_roads: 0.1, use_hills: 1 },
    radius: 250, announce: { far: 200, near: 30 },
  },
  drive: {
    label: 'Auto', icon: 'directions_car', costing: 'auto', tour: true,
    radius: 400, announce: { far: 500, near: 60 },
  },
};

/**
 * Tankerkönig-Schlüssel. Leer lassen, dann gibt es keine Preise – oder im
 * Menü „Spritpreise“ im Browser hinterlegen (bleibt nur dort gespeichert).
 */
export const TANKERKOENIG_KEY = '';

/** Höchstens so viele Routen werden zur Auswahl gestellt. */
export const MAX_ROUTES = 5;

/** Steht im Changeset (created_by) – bei neuen Versionen mitziehen. */
export const APP_VERSION = '0.8.0';

/**
 * Öffentliche Adresse der Web-App (mit / am Ende). Geteilte Links zeigen im
 * Browser auf die aktuelle Seite; in der Desktop-App (tauri://…) auf diese
 * Adresse – leer: dort wird das Teilen abgelehnt.
 */
export const PUBLIC_URL = 'https://app.wuefl.de/wmap/';

/**
 * OpenStreetMap-Konto zum Hochladen der Antworten (OAuth 2.0 mit PKCE, ohne
 * Geheimnis). Die App muss einmal registriert werden:
 * openstreetmap.org → Einstellungen → OAuth 2-Anwendungen → neu,
 *   Weiterleitungs-URL: <App-Adresse>/oauth.html
 *   „Vertrauliche Anwendung“: aus
 *   Berechtigungen: Benutzereinstellungen lesen, Karte bearbeiten, Hinweise bearbeiten
 * Die Client-ID kommt hierher – oder in den Einstellungen im Browser.
 * `dev` ist der Testserver: dort darf man ausprobieren, ohne echte Daten zu ändern.
 */
export const OSM_AUTH = {
  live: {
    label: 'OpenStreetMap',
    web: 'https://www.openstreetmap.org',
    api: 'https://api.openstreetmap.org/api/0.6',
    clientId: '',
  },
  dev: {
    label: 'OSM-Testserver',
    web: 'https://master.apis.dev.openstreetmap.org',
    api: 'https://master.apis.dev.openstreetmap.org/api/0.6',
    clientId: '',
  },
};

/**
 * Meldungen unterwegs (Stau, Unfall, Baustelle …) für alle sichtbar machen:
 * eine Supabase-Tabelle, anonym beschreibbar – Aufbau in tools/reports.sql.
 * Leer: Meldungen bleiben auf dem Gerät.
 */
export const REPORTS = {
  url: '',     // z. B. https://xyzcompany.supabase.co
  key: '',     // der öffentliche „anon“-Schlüssel
};
