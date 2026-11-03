/**
 * Eigene Ebenen hinzufügen – gemeinsam für Ebenen-Menü der Karte und die
 * Plugin-Seite:
 *
 *   addOwnSource()   Adresse: Kartenkacheln, WMS oder GeoJSON, auf Wunsch mit
 *                    Benutzer und Passwort (bleibt nur auf diesem Gerät)
 *   addOwnFiles()    GeoJSON-Dateien – einzeln oder ein ganzer Ordner
 *                    (<input webkitdirectory>, auch Unterordner)
 *   Plugin-Ordner (mehrere, gemerkt, mit wmap-plugin.json): data/plugin-folders.js
 *
 * Neue Ebenen liegen gleich auf der Hauptkarte (onMain).
 */
import { layers, newLayer, rasterLayer, basicAuth } from '../map/layers.js';
import { ask } from './dialogs.js';
import { t } from '../core/i18n.js';

/**
 * WMS-Adresse als Kachelvorlage für MapLibre (EPSG:3857, 512er Bilder).
 * `format` „image/vnd.jpeg-png“ (MapServer): JPEG, wo Bild ist, sonst
 * durchsichtiges PNG – bei Luftbildern ein Bruchteil der Daten.
 */
export const wms = (url, layer, format = 'image/png') => `${url}${url.includes('?') ? '&' : '?'}SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=${format}&TRANSPARENT=TRUE`;

/** → die neue Ebene oder null */
export async function addOwnSource({ toast = () => {}, index = 0 } = {}) {
  const v = await ask({
    icon: 'add_link', title: t('layers_menu.own_source.title'),
    html: `<p class="muted">${t('layers_menu.own_source.hint')}</p>
      <div class="plugin-form">
        <label>${t('layers_menu.own_source.name')}<input type="text" name="name" maxlength="120" placeholder="${t('layers_menu.own_source.name_example')}"></label>
        <label>${t('layers_menu.own_source.kind')}<select name="kind">
          <option value="tiles">${t('layers_menu.own_source.kinds.tiles')}</option>
          <option value="wms">${t('layers_menu.own_source.kinds.wms')}</option>
          <option value="geojson">${t('layers_menu.own_source.kinds.geojson')}</option></select></label>
        <label>${t('layers_menu.own_source.url')}<input type="text" name="url" inputmode="url" placeholder="https://…"></label>
        <label>${t('layers_menu.own_source.layer')}<input type="text" name="layer" placeholder="${t('layers_menu.own_source.layer_example')}"></label>
        <label>${t('layers_menu.own_source.user')}<input type="text" name="user" autocomplete="off"></label>
        <label>${t('layers_menu.own_source.password')}<input type="password" name="pass" autocomplete="new-password"></label>
      </div>`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('layers_menu.own_source.add'), primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((i) => [i.name, i.value.trim()])),
  });
  if (!v || v === 'no') return null;
  if (!/^https:\/\//.test(v.url)) { toast(t('layers_menu.own_source.error.https')); return null; }
  const auth = v.user ? basicAuth(v.user, v.pass) : null;
  const name = v.name || new URL(v.url).hostname;
  const source = { kind: 'url', url: v.url.split('?')[0] };
  try {
    let l;
    if (v.kind === 'geojson') {
      const res = await fetch(v.url, auth ? { headers: { Authorization: auth } } : {});
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? t('layers_menu.own_source.error.denied') : t('layers_menu.own_source.error.status', { status: res.status }));
      l = newLayer(await res.text(), { name, source, index });
    } else {
      if (v.kind === 'wms' && !v.layer) { toast(t('layers_menu.own_source.error.no_layer')); return null; }
      const tiles = v.kind === 'wms' ? wms(v.url.split('?')[0], v.layer) : v.url;
      if (v.kind === 'tiles' && !tiles.includes('{z}')) { toast(t('layers_menu.own_source.error.no_zxy')); return null; }
      l = rasterLayer({ name, tiles, source, auth });
    }
    l.onMain = true;
    await layers.put(l);
    toast(t('layers_menu.own_source.added', { name }));
    return l;
  } catch (err) {
    toast(err.name === 'TypeError' ? t('layers_menu.own_source.error.cors') : err.message);
    return null;
  }
}

/**
 * GeoJSON-Dateien laden – aus einer Auswahl oder einem ganzen Ordner.
 * Andere Dateien im Ordner werden übergangen. → { added: [Ebene], failed: [Name] }
 */
export async function addOwnFiles(fileList, { index = 0 } = {}) {
  const added = [], failed = [];
  for (const f of fileList) {
    if (!/\.(geo)?json$/i.test(f.name)) continue;
    try {
      const l = newLayer(await f.text(), { name: f.name.replace(/\.(geo)?json$/i, ''), source: { kind: 'file', ...(f.webkitRelativePath ? { path: f.webkitRelativePath } : {}) }, index: index + added.length });
      l.onMain = true;
      await layers.put(l);
      added.push(l);
    } catch { failed.push(f.name); }
  }
  return { added, failed };
}

