<?php
/**
 * Einstellungen der WMap-API.
 *
 * OSM_ISSUER / OSM_CLIENT_ID: Angemeldet wird mit dem OpenStreetMap-Konto.
 * Die Client-ID ist dieselbe wie in js/core/config.js (OSM_AUTH.live) – sie
 * ist nicht geheim. Ein Client-Geheimnis gehört weder hierher noch in die App.
 */
const OSM_ISSUER = "https://www.openstreetmap.org";
const OSM_CLIENT_ID = "jv-baCEuub6hnMq3q9FlzYyaAuZI0Vqj_3kY3QkDDfQ";
const SESSION_DAYS = 180;
const MAX_SHAPE = 250000;          // Zeichen – reicht für ~1500 km Tour
const MAX_PLUGIN_DATA = 2000000;   // Bytes GeoJSON je hochgeladenem Plugin

/**
 * Schlüssel (Weiterleitung mit API-Schlüssel, Zugang zu stats.php) – in bEnd/keys.php neben data/: geht mit dem Upload
 * hoch (data/ nicht), ist von außen gesperrt (.htaccess) und steht nicht im Repository (.gitignore).
 *   <?php return ['stats' => '…', 'tankerkoenig' => '…'];
 */
function wmap_keys(){
    static $keys = null;
    if ($keys === null) {
        $file = __DIR__."/keys.php";
        $keys = is_file($file) ? (include $file) : [];
        if (!is_array($keys)) $keys = [];
    }
    return $keys;
}
?>
