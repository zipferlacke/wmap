/**
 * Fertige Kartenebenen offener Anbieter (Plugins-Seite → „Aktivieren“) und
 * was man über sie wissen kann:
 *
 *   info     langes Drücken auf die Karte → was an dieser Stelle ist (Gestein, Alter …)
 *   legend   Legende als Bild (Plugin-Seite, Info-Dialog)
 *
 * Installiert ist ein Preset eine gewöhnliche Rasterebene (layers.js) mit
 * source.presetId – so finden Karte und Plugin-Seite die Angaben hier wieder.
 */
import { esc } from './geo.js';

const BGR_BASE = 'https://services.bgr.de/wms/geologie/guek250/';
const BGR = (layers) => `${BGR_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
  + `&LAYERS=${layers}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`;
const BGR_LEGEND = (layer) => `${BGR_BASE}?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=${layer}`;
const BGR_ATTR = 'Geologie: GÜK250 (WMS), © <a href="https://www.bgr.bund.de" target="_blank" rel="noopener">BGR</a>, Hannover, 2019';
// Die BGR liefert nur zwischen 1:546 000 und 1:34 000 – Zoom 9 bis 13
const BGR_ZOOM = { minzoom: 8.5, maxzoom: 13 };

export const PRESETS = [
  {
    id: 'geo-de', icon: 'landslide', name: 'Geologie Deutschland',
    operator: 'BGR – Bundesanstalt für Geowissenschaften und Rohstoffe',
    text: 'Geologische Übersichtskarte 1:250 000 (GÜK250): welche Gesteine an der Oberfläche liegen, farbig nach Erdzeitalter, dazu Störungen und Verwerfungen. Zu sehen ab Zoom 9 – vom Landkreis bis zum Ort. Lange auf die Karte drücken zeigt das Erdzeitalter an dieser Stelle.',
    tiles: BGR('7,8,11'), attribution: BGR_ATTR, ...BGR_ZOOM,
    url: 'https://www.bgr.bund.de/DE/Themen/Sammlungen-Grundlagen/GG_geol_Info/Karten/Deutschland/GUEK250/guek250_node.html',
    info: { type: 'bgr', layers: '7,8' },
    legend: [{ title: 'Erdzeitalter', src: BGR_LEGEND(7) }],
  },
  {
    id: 'geo-de-rock', icon: 'texture', name: 'Gesteinsarten Deutschland',
    operator: 'BGR – Bundesanstalt für Geowissenschaften und Rohstoffe',
    text: 'Dieselbe Übersichtskarte (GÜK250), gefärbt nach Gesteinsart statt Alter: Sand, Ton, Kalk, Granit, Schiefer … Gut für Wanderungen und Boden. Zu sehen ab Zoom 9. Lange auf die Karte drücken zeigt das Gestein an dieser Stelle.',
    tiles: BGR('4,5'), attribution: BGR_ATTR, ...BGR_ZOOM, url: 'https://www.bgr.bund.de',
    info: { type: 'bgr', layers: '4,5' },
    legend: [{ title: 'Gesteinsarten', src: BGR_LEGEND(4) }],
  },
  {
    id: 'geo-world', icon: 'public', name: 'Geologie weltweit',
    operator: 'Macrostrat (University of Wisconsin–Madison)',
    text: 'Geologische Karten aus aller Welt, zusammengesetzt aus vielen Quellen – grob für ganze Länder, genauer, wo es gute Karten gibt. Farbig nach Erdzeitalter. Lange auf die Karte drücken zeigt Gestein und Alter an dieser Stelle.',
    tiles: 'https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png', attribution: 'Geologie: <a href="https://macrostrat.org" target="_blank" rel="noopener">Macrostrat</a> (CC BY 4.0)', url: 'https://macrostrat.org',
    info: { type: 'macrostrat' },
    legendText: 'Die Farben folgen der internationalen Zeitskala: Violett Trias, Blau Jura, Grün Kreide, Gelb/Orange Tertiär und Quartär, Braun/Grau Erdaltertum. Langes Drücken nennt Einheit und Alter.',
  },
];

export const presetOf = (layer) => PRESETS.find((p) => p.id === layer?.source?.presetId) ?? null;

/* ── Was ist an dieser Stelle? ────────────────────────────────────────────── */

const R = 6378137;
const merc = ([lon, lat]) => [(lon * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];

/** Leere und technische Felder der BGR weglassen */
const BGR_SKIP = /^(OBJECTID|ID der geologischen Einheit|Shape|leg_.*)$/i;
const empty = (v) => v == null || /^\s*(null)?\s*$/i.test(String(v));

async function bgrInfo(info, [lon, lat], zoom, signal) {
  // Kleiner Ausschnitt um den Punkt, Mitte abfragen; Spielraum ≈ ein paar Pixel
  const [x, y] = merc([lon, lat]);
  const r = Math.max(30, (40075016 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom) * 50);
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: info.layers, QUERY_LAYERS: info.layers,
    STYLES: '', CRS: 'EPSG:3857', BBOX: [x - r, y - r, x + r, y + r].map((v) => v.toFixed(1)).join(','),
    WIDTH: '101', HEIGHT: '101', I: '50', J: '50', INFO_FORMAT: 'application/geo+json', FEATURE_COUNT: '5',
  });
  const res = await fetch(`${BGR_BASE}?${q}`, { signal });
  if (!res.ok) throw new Error(`BGR antwortet mit ${res.status}`);
  const { features = [] } = await res.json();
  return features.map((f) => {
    const p = f.properties ?? {};
    const title = p.Legendentext && !empty(p.Legendentext) ? p.Legendentext.trim() : '';
    const rows = Object.entries(p).filter(([k, v]) => !BGR_SKIP.test(k) && !empty(v) && k !== 'Legendentext' && String(v).trim() !== title)
      .map(([k, v]) => [k, String(v).trim()]);
    return { title, rows };
  }).filter((x) => x.title || x.rows.length);
}

async function macrostratInfo([lon, lat], signal) {
  const res = await fetch(`https://macrostrat.org/api/v2/geologic_units/map?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}`, { signal });
  if (!res.ok) throw new Error(`Macrostrat antwortet mit ${res.status}`);
  const data = (await res.json())?.success?.data ?? [];
  // Die genaueste Karte zuerst – Macrostrat liefert grob bis fein
  return data.slice(0, 2).map((u) => ({
    title: u.name || u.strat_name || 'Geologische Einheit', color: u.color,
    rows: [
      ['Alter', u.b_int_name === u.t_int_name ? u.b_int_name : `${u.b_int_name} bis ${u.t_int_name}`],
      ['Millionen Jahre', u.b_age != null ? `${Math.round(u.b_age)}–${Math.round(u.t_age)}` : ''],
      ['Gestein', (u.lith ?? '').replace(/Major:|Minor/g, '').replace(/[{}]/g, '').trim()],
      ['Beschreibung', u.descrip ?? ''],
    ].filter(([, v]) => v),
  }));
}

/**
 * Info aller sichtbaren Preset-Ebenen an einem Punkt.
 * → [{ layer, preset, items: [{ title, color?, rows }] }] (nur mit Treffern)
 */
export async function layerInfoAt(shown, point, zoom, { signal } = {}) {
  const out = await Promise.all(shown.map(async (layer) => {
    const preset = presetOf(layer);
    if (!preset?.info) return null;
    try {
      const items = preset.info.type === 'bgr' ? await bgrInfo(preset.info, point, zoom, signal) : await macrostratInfo(point, signal);
      return items.length ? { layer, preset, items } : null;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return { layer, preset, items: [], error: err.message };
    }
  }));
  return out.filter(Boolean);
}

/** HTML für den Info-Dialog */
export function layerInfoHtml(results) {
  return results.map(({ preset, items, error }) => `
    <section class="layer-info">
      <h3><span class="msr">${preset.icon}</span> ${esc(preset.name)}</h3>
      ${error ? `<p class="muted">Gerade nicht abrufbar (${esc(error)})</p>` : items.map((it) => `
        <p class="layer-info-title">${it.color ? `<i style="background:${esc(it.color)}"></i>` : ''}<strong>${esc(it.title)}</strong></p>
        ${it.rows.length ? `<dl>${it.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`).join('')}
      ${legendHtml(preset, { open: false })}
    </section>`).join('');
}

/** Legende: Bild(er) zum Aufklappen oder ein erklärender Satz */
export function legendHtml(preset, { open = true } = {}) {
  if (preset.legend?.length) {
    return preset.legend.map((l) => `
      <details class="layer-legend" ${open ? 'open' : ''}>
        <summary><span class="msr">format_list_bulleted</span> Legende: ${esc(l.title)}</summary>
        <div class="layer-legend-img"><img src="${esc(l.src)}" alt="Legende ${esc(l.title)}" loading="lazy"></div>
      </details>`).join('');
  }
  return preset.legendText ? `<p class="layer-legend-text"><span class="msr">palette</span> ${esc(preset.legendText)}</p>` : '';
}
