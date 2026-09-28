/**
 * Beiträge zu OpenStreetMap zählen – getrennt nach Art und Weg:
 *   kind  frage       Ja/Nein-Fragen unterwegs (Mitmachen)
 *         bearbeitet  Ort geändert („Bearbeiten“ in der Ortskarte)
 *         neu         Ort eingetragen („Hier eintragen“)
 *   via   karte       direkt in OSM (mit Konto, Changeset)
 *         hinweis     als OSM-Hinweis (ohne Konto)
 *
 * Zweimal gezählt: auf dem Gerät (eigene Beiträge, in den Einstellungen) und
 * anonym auf dem WMap-Server (Tabelle Statistics: Zeit, Frage ja/nein, Art –
 * ohne Konto, Gerät oder Ort; bEnd/api_stats.php).
 * Mit dem OSM-Testserver wird nichts gezählt.
 */
import { api } from './api.js';
import { local } from './store.js';
import { account } from './osm-api.js';

const KEY = 'wmap.osmStats';
export const STAT_KINDS = ['frage', 'bearbeitet', 'neu'];

const empty = () => Object.fromEntries(STAT_KINDS.map((k) => [k, { karte: 0, hinweis: 0 }]));

/** Eigene Beiträge auf diesem Gerät → { frage: { karte, hinweis }, … } */
export function myOsmStats() {
  const s = local.get(KEY, null);
  const out = empty();
  for (const k of STAT_KINDS) for (const v of ['karte', 'hinweis']) out[k][v] = s?.[k]?.[v] ?? 0;
  return out;
}

/** Nach erfolgreichem Hochladen aufrufen; Fehler beim Server-Zähler sind egal. */
export function countOsm(kind, via, n = 1) {
  if (!n || n < 1 || account.server() === 'dev') return;
  const s = myOsmStats();
  s[kind][via] += n;
  local.set(KEY, s);
  api(['stats', 'count'], { kind, via, n }).catch(() => {});
}

/** Alle Beiträge über WMap (Server) → { osm: {kind: {via: n}}, events, months } */
export const allOsmStats = () => api(['stats', 'summary']);

/** „12 Fragen beantwortet · 3 Orte bearbeitet · 1 neu eingetragen (davon 4 als Hinweis)“ */
export function statsText(s) {
  const sum = (k) => s[k].karte + s[k].hinweis;
  const parts = [
    sum('frage') && `${sum('frage')} ${sum('frage') === 1 ? 'Frage' : 'Fragen'} beantwortet`,
    sum('bearbeitet') && `${sum('bearbeitet')} ${sum('bearbeitet') === 1 ? 'Ort' : 'Orte'} bearbeitet`,
    sum('neu') && `${sum('neu')} neu eingetragen`,
  ].filter(Boolean);
  if (!parts.length) return '';
  const notes = STAT_KINDS.reduce((a, k) => a + s[k].hinweis, 0);
  return parts.join(' · ') + (notes ? ` (davon ${notes} als Hinweis)` : '');
}
