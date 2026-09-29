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

/**
 * WMS-Adresse als Kachelvorlage für MapLibre (EPSG:3857, 512er Bilder).
 * `format` „image/vnd.jpeg-png“ (MapServer): JPEG, wo Bild ist, sonst
 * durchsichtiges PNG – bei Luftbildern ein Bruchteil der Daten.
 */
export const wms = (url, layer, format = 'image/png') => `${url}${url.includes('?') ? '&' : '?'}SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=${format}&TRANSPARENT=TRUE`;

/** → die neue Ebene oder null */
export async function addOwnSource({ toast = () => {}, index = 0 } = {}) {
  const v = await ask({
    icon: 'add_link', title: 'Eigene Quelle',
    html: `<p class="muted">Kartenkacheln, ein WMS-Dienst oder GeoJSON – auch privat mit Benutzer und Passwort. Alles bleibt nur auf diesem Gerät.</p>
      <div class="plugin-form">
        <label>Name<input type="text" name="name" maxlength="120" placeholder="z. B. Messnetz Harz"></label>
        <label>Art<select name="kind">
          <option value="tiles">Kartenkacheln ({z}/{x}/{y})</option>
          <option value="wms">WMS-Dienst</option>
          <option value="geojson">GeoJSON-Datei</option></select></label>
        <label>Adresse (https)<input type="text" name="url" inputmode="url" placeholder="https://…"></label>
        <label>WMS-Ebene (nur bei WMS)<input type="text" name="layer" placeholder="z. B. ni_dop20"></label>
        <label>Benutzer (optional)<input type="text" name="user" autocomplete="off"></label>
        <label>Passwort (optional)<input type="password" name="pass" autocomplete="new-password"></label>
      </div>`,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Hinzufügen', primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((i) => [i.name, i.value.trim()])),
  });
  if (!v || v === 'no') return null;
  if (!/^https:\/\//.test(v.url)) { toast('Die Adresse muss mit https:// beginnen'); return null; }
  const auth = v.user ? basicAuth(v.user, v.pass) : null;
  const name = v.name || new URL(v.url).hostname;
  const source = { kind: 'url', url: v.url.split('?')[0] };
  try {
    let l;
    if (v.kind === 'geojson') {
      const res = await fetch(v.url, auth ? { headers: { Authorization: auth } } : {});
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Zugang abgelehnt – Benutzer oder Passwort prüfen' : `Der Server antwortet mit ${res.status}`);
      l = newLayer(await res.text(), { name, source, index });
    } else {
      if (v.kind === 'wms' && !v.layer) { toast('Bitte die WMS-Ebene angeben'); return null; }
      const tiles = v.kind === 'wms' ? wms(v.url.split('?')[0], v.layer) : v.url;
      if (v.kind === 'tiles' && !tiles.includes('{z}')) { toast('Kachel-Adressen brauchen {z}, {x} und {y}'); return null; }
      l = rasterLayer({ name, tiles, source, auth });
    }
    l.onMain = true;
    await layers.put(l);
    toast(`„${name}“ liegt jetzt auf der Karte`);
    return l;
  } catch (err) {
    toast(err.name === 'TypeError' ? 'Nicht erreichbar – vielleicht erlaubt der Server keinen Abruf aus dem Browser (CORS)' : err.message);
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

