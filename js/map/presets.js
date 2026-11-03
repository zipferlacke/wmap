/**
 * Fertige Kartenebenen offener Anbieter (Plugins-Seite → „Aktivieren“) und
 * was man über sie wissen kann:
 *
 *   info     langes Drücken auf die Karte → was an dieser Stelle ist (Gestein, Alter …)
 *   legend   Legende als Bild (Plugin-Seite, Info-Dialog)
 *
 * Installiert ist ein Preset eine gewöhnliche Rasterebene (map/layers.js) mit
 * source.presetId – so finden Karte und Plugin-Seite die Angaben hier wieder.
 */
import { esc } from '../core/geo.js';
import { t } from '../core/i18n.js';

const BGR_BASE = 'https://services.bgr.de/wms/geologie/guek250/';
const BGR = (layers) => `${BGR_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
  + `&LAYERS=${layers}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`;
const BGR_LEGEND = (layer) => `${BGR_BASE}?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=${layer}`;
const BGR_ATTR = `${t('layers.presets.attribution')} GÜK250 (WMS), © <a href="https://www.bgr.bund.de" target="_blank" rel="noopener">BGR</a>, Hannover, 2019`;
// Die BGR liefert nur zwischen 1:546 000 und 1:34 000 – Zoom 9 bis 13
const BGR_ZOOM = { minzoom: 8.5, maxzoom: 13 };

export const PRESETS = [
  {
    id: 'geo-de', icon: 'landslide', name: t('layers.presets.geo_de.name'),
    operator: t('layers.presets.bgr_operator'),
    text: t('layers.presets.geo_de.text'),
    tiles: BGR('7,8,11'), attribution: BGR_ATTR, ...BGR_ZOOM,
    url: 'https://www.bgr.bund.de/DE/Themen/Sammlungen-Grundlagen/GG_geol_Info/Karten/Deutschland/GUEK250/guek250_node.html',
    info: { type: 'bgr', layers: '7,8' },
    legend: [{ title: t('layers.presets.geo_de.legend'), src: BGR_LEGEND(7) }],
  },
  {
    id: 'geo-de-rock', icon: 'texture', name: t('layers.presets.geo_rock.name'),
    operator: t('layers.presets.bgr_operator'),
    text: t('layers.presets.geo_rock.text'),
    tiles: BGR('4,5'), attribution: BGR_ATTR, ...BGR_ZOOM, url: 'https://www.bgr.bund.de',
    info: { type: 'bgr', layers: '4,5' },
    legend: [{ title: t('layers.presets.geo_rock.legend'), src: BGR_LEGEND(4) }],
  },
  {
    id: 'geo-world', icon: 'public', name: t('layers.presets.geo_world.name'),
    operator: t('layers.presets.geo_world.operator'),
    text: t('layers.presets.geo_world.text'),
    tiles: 'https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png', attribution: `${t('layers.presets.attribution')} <a href="https://macrostrat.org" target="_blank" rel="noopener">Macrostrat</a> (CC BY 4.0)`, url: 'https://macrostrat.org',
    info: { type: 'macrostrat' },
    legendText: t('layers.presets.geo_world.legend_text'),
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
  if (!res.ok) throw new Error(t('layers.info.answer', { source: 'BGR', status: res.status }));
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
  if (!res.ok) throw new Error(t('layers.info.answer', { source: 'Macrostrat', status: res.status }));
  const data = (await res.json())?.success?.data ?? [];
  // Die genaueste Karte zuerst – Macrostrat liefert grob bis fein
  return data.slice(0, 2).map((u) => ({
    title: u.name || u.strat_name || t('layers.info.unit'), color: u.color,
    rows: [
      [t('layers.info.rows.age'), u.b_int_name === u.t_int_name ? u.b_int_name : t('layers.info.rows.age_range', { from: u.b_int_name, to: u.t_int_name })],
      [t('layers.info.rows.million_years'), u.b_age != null ? `${Math.round(u.b_age)}–${Math.round(u.t_age)}` : ''],
      [t('layers.info.rows.rock'), (u.lith ?? '').replace(/Major:|Minor/g, '').replace(/[{}]/g, '').trim()],
      [t('layers.info.rows.description'), u.descrip ?? ''],
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
      ${error ? `<p class="muted">${t('layers.info.unavailable', { error: esc(error) })}</p>` : items.map((it) => `
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
        <summary><span class="msr">format_list_bulleted</span> ${t('layers.info.legend.summary', { title: esc(l.title) })}</summary>
        <div class="layer-legend-img"><img src="${esc(l.src)}" alt="${t('layers.info.legend.alt', { title: esc(l.title) })}" loading="lazy"></div>
      </details>`).join('');
  }
  return preset.legendText ? `<p class="layer-legend-text"><span class="msr">palette</span> ${esc(preset.legendText)}</p>` : '';
}
