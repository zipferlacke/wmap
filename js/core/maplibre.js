/**
 * MapLibre laden (ab 6.0 nur noch als ES-Modul) und wie bisher als `window.maplibregl` bereitstellen – der übrige
 * Code nutzt es global. Steht in jeder Seite vor dem eigenen Modul; Module laufen in der Reihenfolge der Seite.
 *
 * Der Worker heißt hier .js statt .mjs (nicht jeder Server liefert .mjs als JavaScript aus) – darum den Pfad selbst
 * angeben; MapLibre sucht sonst maplibre-gl-worker.mjs.
 */
import * as maplibregl from '../../libs/maplibre-gl/maplibre-gl.js';

maplibregl.setWorkerUrl(new URL('../../libs/maplibre-gl/maplibre-gl-worker.js', import.meta.url).href);
window.maplibregl = maplibregl;
