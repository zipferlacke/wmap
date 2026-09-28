/**
 * Karten-Links „geo:“ (RFC 5870 und was Android daraus gemacht hat) lesen –
 * damit WMap sie öffnen kann wie die Standard-Karten-App:
 *
 *   geo:51.53,9.93                      Punkt
 *   geo:51.53,9.93?z=15                 mit Zoom
 *   geo:0,0?q=51.53,9.93(Gänseliesel)   Punkt mit Namen
 *   geo:0,0?q=Weender+Straße+Göttingen  Suche
 *   geo:51.53,9.93?q=Bäckerei           Suche in der Nähe
 *
 * → { point: [lon, lat] | null, zoom: Zahl | null, label: '', query: '' }
 *   oder null, wenn es kein geo:-Link ist.
 */
export function parseGeoUri(text) {
  const m = String(text ?? '').trim().match(/^geo:([^?]*)(?:\?(.*))?$/i);
  if (!m) return null;
  const [lat, lon] = m[1].split(';')[0].split(',').map(Number);
  const params = new URLSearchParams(m[2] ?? '');
  const zoom = Number(params.get('z'));
  let point = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? [lon, lat] : null;
  let label = '';
  let query = (params.get('q') ?? '').trim();
  // q=Breite,Länge(Name) – ein Punkt, kein Suchbegriff
  const at = query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\((.*)\))?$/);
  if (at) {
    point = [Number(at[2]), Number(at[1])];
    label = (at[3] ?? '').trim();
    query = '';
  }
  if (!point && !query) return null;
  return { point, zoom: zoom > 0 && zoom <= 23 ? zoom : null, label, query };
}
