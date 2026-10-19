/**
 * Service Worker als Modul: sw.js (Offline, Kacheln, Updates) und der Abgleich (js/sw/sync.js). Angemeldet von
 * js/data/offline.js – kann ein Browser keinen Service Worker als Modul, nimmt er sw.js allein (ohne Abgleich, die
 * Seiten gleichen dann selbst ab).
 */
import './sw.js';
import './js/sw/sync.js';
