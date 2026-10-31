/**
 * Suche ohne Suchdienst: Koordinaten in jedem gängigen Format und Links aus anderen Karten oder von WMap
 * selbst, eingetippt oder eingefügt (core/coords.js, core/map-links.js). Steht so etwas im Feld, kommt
 * statt der Photon-Treffer genau dieser eine Vorschlag.
 *
 * directItems(text, onPick, { main }) → Vorschläge | null (keine Koordinate, kein Link)
 *   onPick(f)  bekommt einen Punkt als Feature – wie bei einem Suchtreffer
 *   main       oben in der Suche: Punkte wie langes Drücken (mit Adresse), WMap-Links öffnen die Seite
 */
import { fmtLatLon, fmtMgrs, parseCoords, recoverPlus } from '../core/coords.js';
import { parseMapLink } from '../core/map-links.js';
import * as geocode from '../services/geocode.js';
import * as osm from '../osm/objects.js';
import { toast } from '../ui/dialogs.js';
import { map, state } from './core.js';
import { showPoint } from './place.js';

const KIND = { latlon: 'Koordinate', mgrs: 'MGRS', utm: 'UTM', plus: 'Plus Code' };
const PAGE = { 'tour.html': 'Tour', 'wege.html': 'Aufzeichnung oder Liste', 'index.html': 'Ort oder Route', 'entdecken.html': 'Entdecken' };

const pointFeature = (p, name, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { name, _point: true, ...extra } });

/**
 * Wo ein kurzer Plus Code gemeint ist: beim Ort dahinter („GXJP+QH Göttingen“), sonst hier. → [Punkt, Ort
 * nicht gefunden?] – dann gilt die Kartenmitte, und der Vorschlag sagt es (sonst läge er still woanders).
 */
async function plusRef(rest, signal) {
  if (rest) {
    const [f] = await geocode.search(rest, { limit: 1, signal }).catch(() => []);
    if (f) return [f.geometry.coordinates, false];
  }
  const p = state.position;
  return [p && map.getBounds().contains(p) ? p : map.getCenter().toArray(), !!rest];
}

function pointItem(p, { title, kind, name = '', zoom = null, view = false }, onPick, main) {
  const coords = fmtLatLon(p), mgrs = fmtMgrs(p);
  const head = title ?? (name || coords);
  // Darunter die Formate, die nicht schon im Titel stehen
  const item = {
    icon: view ? 'map' : 'location_on', title: head,
    subtitle: [coords, mgrs].filter((x) => x && x !== head).join(' · '), type: KIND[kind] ?? kind, point: p,
    run: () => {
      if (main && view) { map.flyTo({ center: p, zoom: zoom ?? Math.max(map.getZoom(), 14) }); return; }
      if (main) { showPoint(p, { fly: true, name: name || item.title, zoom }); return; }
      onPick(pointFeature(p, name || coords));
    },
  };
  return item;
}

/** Punkt eines OSM-Objekts (Knoten direkt, Wege und Relationen über ihren Umriss) */
async function osmCenter({ type, id }, signal) {
  if (type === 'N') {
    const el = await osm.element('N', id, { signal });
    return el && { point: [el.lon, el.lat], tags: el.tags ?? {} };
  }
  // Der Umriss bringt seinen Ankerpunkt mit (services/overpass.js toGeoJSON: mitten in der Fläche bzw. auf der Linie)
  const [{ points }, tags] = await Promise.all([osm.shape(type, id, { signal }), osm.tags(type, id, { signal })]);
  const point = points?.[0]?.geometry.coordinates;
  return point && { point, tags };
}

export async function directItems(text, onPick, { main = false, signal } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return null;

  let c = parseCoords(t);
  let missed = false;
  if (c?.short) {
    const [ref, miss] = await plusRef(c.rest, signal);
    missed = miss;
    c = { point: recoverPlus(c.short, ref), kind: 'plus', title: [c.short, c.rest].filter(Boolean).join(' ') };
  }
  if (c?.point) {
    const item = pointItem(c.point, { title: c.title ?? (c.kind === 'mgrs' ? fmtMgrs(c.point) : c.kind === 'latlon' ? fmtLatLon(c.point) : t), kind: c.kind }, onPick, main);
    if (missed) item.subtitle = `„${parseCoords(t).rest}“ nicht gefunden – nahe der Kartenmitte · ${item.subtitle}`;
    return [item];
  }

  const link = parseMapLink(t);
  if (!link) return null;
  if (link.wmap) {
    if (!main) return [];
    const page = link.wmap.slice(2).split(/[?#]/)[0];
    return [{ icon: 'link', title: 'WMap-Link öffnen', subtitle: PAGE[page] ?? page, type: 'Link', run: () => { location.href = link.wmap; } }];
  }
  if (link.short) {
    return [{
      icon: 'link_off', title: 'Kurzlink – den kann nur Google auflösen', subtitle: 'Link im Browser öffnen und die lange Adresse einfügen', type: 'Link',
      run: () => toast('Kurzlinks (maps.app.goo.gl) löst nur Google auf: im Browser öffnen, dann die lange Adresse kopieren'),
    }];
  }
  if (link.osm) {
    const at = await osmCenter(link.osm, signal).catch(() => null);
    if (!at) return [{ icon: 'error', title: 'Dieses OSM-Objekt gibt es nicht (mehr)', type: 'Link', run: () => {} }];
    const name = at.tags.name ?? '';
    const f = { type: 'Feature', geometry: { type: 'Point', coordinates: at.point }, properties: { name: name || fmtLatLon(at.point), osm_type: link.osm.type, osm_id: link.osm.id, _tags: at.tags } };
    return [{ icon: 'location_on', title: name || `OSM-Objekt ${link.osm.id}`, subtitle: [fmtLatLon(at.point), fmtMgrs(at.point)].join(' · '), type: 'OSM', point: at.point, run: () => onPick(f) }];
  }
  if (link.point) return [pointItem(link.point, { kind: 'Link', name: link.name, zoom: link.zoom, view: link.view }, onPick, main)];
  if (link.query) return { query: link.query };
  return null;
}
