<?php
/**
 * Einstellungen der WMap-API.
 *
 * ORIGINS: Von wo aus Passkeys gelten (WebAuthn prüft die Herkunft). Die
 * Domain ohne Port ist zugleich die „Relying Party“ (rpId).
 */
const ORIGINS = [
    "https://app.wuefl.de",
    "http://localhost:8080",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
];
const SESSION_DAYS = 180;
const MAX_SHAPE = 250000;          // Zeichen – reicht für ~1500 km Tour
const MAX_PLUGIN_DATA = 2000000;   // Bytes GeoJSON je hochgeladenem Plugin
?>
