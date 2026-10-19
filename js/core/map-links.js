/**
 * Links auf Karten lesen – damit man sie oben in die Suche einfügen kann:
 *
 *   WMap (app.wuefl.de, dev.wuefl.de …)  → { wmap: './tour.html#k=…' } – die Seite öffnen
 *   geo:51.53,9.93 …                     → wie core/geo-uri.js
 *   openstreetmap.org/#map=17/51.53/9.93, ?mlat=&mlon=, /node/123 (way, relation)
 *   google.com/maps/place/Name/@51.53,9.93,17z/…!3d51.53!4d9.93, ?q=51.53,9.93, ?query=, ?ll=
 *   maps.apple.com/?ll=51.53,9.93&q=Name, bing.com/maps?cp=51.53~9.93, sonst ?lat=&lon=
 *
 * → { point: [lon, lat], zoom, name } | { osm: { type: 'N'|'W'|'R', id } } | { wmap } | { query }
 *   | { short: true } (Kurzlink, den nur der Anbieter auflöst) | null
 */
import { parseGeoUri } from './geo-uri.js';

const PAGES = ['tour.html', 'wege.html', 'index.html', 'entdecken.html'];
const SHARED = /^#(k|t|weg|list|p)=/;

/**
 * Geteilter WMap-Link (auch in einem Satz, etwa aus einer Nachricht) → Adresse in dieser App
 * („./tour.html#k=…“) | null. Nur Seiten von WMap: unter „/wmap/“ oder von hier.
 */
export function linkTarget(text) {
  const m = String(text ?? '').match(/https?:\/\/\S+/);
  if (!m) return null;
  let u;
  try { u = new URL(m[0].replace(/[)>\].,;!?]+$/, '')); } catch { return null; }
  if (!SHARED.test(u.hash) && !u.search) return null;
  const here = globalThis.location?.origin;
  if (!/\/wmap\//i.test(u.pathname) && u.origin !== here) return null;
  const page = u.pathname.split('/').pop() || 'index.html';
  if (!PAGES.includes(page)) return null;
  return `./${page}${u.search}${u.hash}`;
}

const pair = (lat, lon) => {
  const p = [Number(lon), Number(lat)];
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180 && (p[0] || p[1]) ? p : null;
};
const latLonText = (s) => {
  const m = String(s ?? '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m && pair(m[1], m[2]);
};
const zoomOf = (z) => (Number(z) > 0 && Number(z) <= 22 ? Number(z) : null);
const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

export function parseMapLink(text) {
  const t = String(text ?? '').trim();
  if (/^geo:/i.test(t)) {
    const g = parseGeoUri(t);
    return g && (g.point ? { point: g.point, zoom: g.zoom, name: g.label, query: g.query } : { query: g.query });
  }
  const raw = t.match(/^(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\/?\S*$/i)?.[0];
  if (!raw) return null;
  let u;
  try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const qs = u.searchParams;

  const wmap = linkTarget(u.href);
  if (wmap) return { wmap };

  if (/(^|\.)openstreetmap\.(org|de)$|^osm\.org$/.test(host)) {
    const obj = u.pathname.match(/^\/(node|way|relation)\/(\d+)/);
    if (obj) return { osm: { type: obj[1][0].toUpperCase(), id: Number(obj[2]) } };
    const marker = pair(qs.get('mlat'), qs.get('mlon'));
    const view = u.hash.match(/map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (marker) return { point: marker, zoom: zoomOf(view?.[1] ?? qs.get('zoom')), name: '' };
    if (view) return { point: pair(view[2], view[3]), zoom: zoomOf(view[1]), name: '', view: true };
    return null;
  }

  if (/^(maps\.app\.goo\.gl|goo\.gl)$/.test(host)) return { short: true };
  if (/(^|\.)google\.[a-z.]+$/.test(host) && (u.pathname.startsWith('/maps') || host.startsWith('maps.'))) {
    // Die Stecknadel (!3d…!4d…) ist der Ort; @… nur die Mitte der Ansicht
    const pin = u.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
    const name = decode(u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)?.[1] ?? '');
    const q = qs.get('q') ?? qs.get('query') ?? qs.get('destination') ?? '';
    const point = (pin && pair(pin[1], pin[2])) || latLonText(q) || latLonText(qs.get('ll')) || (at && pair(at[1], at[2]));
    if (point) return { point, zoom: zoomOf(at?.[3]), name: latLonText(name) ? '' : name, view: !pin && !latLonText(q) && !name };
    if (q || name) return { query: q || name };
    return null;
  }

  if (host === 'maps.apple.com' || host === 'maps.apple') {
    const point = latLonText(qs.get('ll')) || latLonText(qs.get('coordinate')) || latLonText(qs.get('q')) || latLonText(qs.get('sll'));
    const name = latLonText(qs.get('q')) ? '' : qs.get('q') ?? qs.get('name') ?? '';
    if (point) return { point, zoom: zoomOf(qs.get('z')), name };
    const query = qs.get('address') ?? qs.get('q');
    return query ? { query } : null;
  }

  if (/(^|\.)bing\.com$/.test(host) && u.pathname.startsWith('/maps')) {
    const cp = qs.get('cp')?.split('~');
    const point = cp && pair(cp[0], cp[1]);
    if (point) return { point, zoom: zoomOf(qs.get('lvl')), name: '' };
    return qs.get('q') ? { query: qs.get('q') } : null;
  }

  // Andere Kartenseiten: lat/lon (lng) in der Adresse
  const point = pair(qs.get('lat') ?? qs.get('mlat'), qs.get('lon') ?? qs.get('lng') ?? qs.get('mlon'));
  return point ? { point, zoom: zoomOf(qs.get('zoom') ?? qs.get('z')), name: qs.get('name') ?? '' } : null;
}
