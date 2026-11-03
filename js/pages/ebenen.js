/**
 * Seite „Eigene Ebenen“: GeoJSON laden (Datei oder Link), auf heller
 * Grundkarte ansehen, nach Messwert einfärben, Objekte antippen und alle
 * Werte lesen. Mit „Auf der Hauptkarte“ erscheint die Ebene auch dort.
 */
import { createMap, BASE_STYLES } from '../map/map.js';
import { Sheet } from '../ui/sheet.js';
import { mountAppNav } from '../ui/appnav.js';
import { ask, toast } from '../ui/dialogs.js';
import { local } from '../data/store.js';
import { layers, newLayer, showLayer, hideLayer, colorExpr, numericProps, mapLayerIds, propertyTable, RAMP } from '../map/layers.js';
import { esc } from '../core/geo.js';
import { locale, t } from '../core/i18n.js';

const $ = (s, root = document) => root.querySelector(s);

const view = local.get('wmap.view');
const { map } = createMap('map', { style: BASE_STYLES.hell, center: view?.center ?? [9.93, 51.53], zoom: view?.zoom ?? 6, auto3d: false });
$('.tour-head').append(mountAppNav().el);
const sheet = $('#sheet');
sheet.show();
document.activeElement?.blur();
new Sheet(sheet, { topLimit: () => $('.tour-head').getBoundingClientRect().bottom });

let list = [];
const ready = new Promise((r) => (map.loaded() ? r() : map.once('load', r)));

async function load({ fitTo = null } = {}) {
  list = await layers.all();
  await ready;
  for (const l of list) showLayer(map, l);
  paint();
  const target = fitTo ? list.find((l) => l.id === fitTo) : null;
  if (target) fit(target);
  else if (list.length && !view) fit(list[0]);
}

function fit(l) {
  const [w, s, e, n] = l.bbox ?? [0, 0, 0, 0];
  const h = map.getContainer().clientHeight;
  if (!l.bbox) return;
  map.fitBounds([[w, s], [e, n]], { padding: { top: 80, bottom: Math.min(h * 0.45, sheet.getBoundingClientRect().height + 30), left: 30, right: 60 }, maxZoom: 15, duration: 700 });
}

function paint() {
  const ul = $('.layer-list');
  if (!list.length) {
    ul.innerHTML = `<li class="muted layer-empty">${t('ebenen.list.empty')}</li>`;
    return;
  }
  ul.innerHTML = list.map((l) => {
    const nums = l.raster ? [] : numericProps(l.data);
    const [, prop] = colorExpr(l);
    const legend = prop ? `<div class="layer-legend"><span>${fmt(prop.min)}</span><i style="background:linear-gradient(90deg,${RAMP.join(',')})"></i><span>${fmt(prop.max)}</span></div>` : '';
    const src = l.source?.kind === 'url' ? t('ebenen.list.source.url', { host: esc(new URL(l.source.url).hostname) }) : l.source?.kind === 'plugin' ? t('ebenen.list.source.plugin', { operator: esc(l.source.operator ?? '?') }) : t('ebenen.list.source.file');
    return `<li class="layer" data-id="${esc(l.id)}">
      <div class="layer-head">
        ${l.raster ? '<span class="msr layer-raster">grid_on</span>' : `<label class="layer-color" title="${t('ebenen.list.color')}"><input type="color" value="${esc(l.color)}" data-act="color"></label>`}
        <div class="layer-name"><strong>${esc(l.name)}</strong><small>${l.raster ? t('ebenen.list.tiles') : t('ebenen.list.objects', { count: l.count.toLocaleString(locale) })} · ${src}</small></div>
        <button type="button" class="button" data-shape="round no-background" data-act="visible" title="${l.visible ? t('ebenen.list.hide') : t('ebenen.list.show')}"><span class="msr">${l.visible ? 'visibility' : 'visibility_off'}</span></button>
        <button type="button" class="button" data-shape="round no-background" data-act="fit" title="${t('ebenen.list.fit')}"><span class="msr">zoom_in_map</span></button>
      </div>
      <div class="layer-opts">
        ${l.raster ? `<label>${t('ebenen.list.opacity')} <input type="range" min="0.1" max="1" step="0.1" value="${l.opacity ?? 0.7}" data-act="opacity"></label>` : ''}
        ${nums.length ? `<label>${t('ebenen.list.color_by.title')} <select data-act="colorby"><option value="">${t('ebenen.list.color_by.single')}</option>${nums.map((p) => `<option value="${esc(p.key)}" ${l.colorBy === p.key ? 'selected' : ''}>${esc(p.key)}</option>`).join('')}</select></label>` : ''}
        <label class="layer-main"><input type="checkbox" data-act="main" ${l.onMain ? 'checked' : ''}> ${t('ebenen.list.on_main')}</label>
        ${l.raster ? '' : `<button type="button" class="link-button" data-act="plugin"><span class="msr">cloud_upload</span> ${t('ebenen.list.as_plugin')}</button>`}
        <button type="button" class="link-button" data-act="delete"><span class="msr">delete</span> ${t('common.delete')}</button>
      </div>
      ${legend}
    </li>`;
  }).join('');
}

const fmt = (v) => v.toLocaleString(locale, { maximumFractionDigits: 2 });

async function update(l) {
  await layers.put(l);
  showLayer(map, l);
  paint();
}

$('.layer-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  const li = e.target.closest('.layer');
  if (!b || !li) return;
  const l = list.find((x) => x.id === li.dataset.id);
  if (b.dataset.act === 'visible') { l.visible = !l.visible; update(l); }
  if (b.dataset.act === 'fit') fit(l);
  if (b.dataset.act === 'plugin') asPlugin(l);
  if (b.dataset.act === 'delete') {
    const v = await ask({ icon: 'delete', title: t('ebenen.delete.title', { name: l.name }), text: t('ebenen.delete.text'),
      buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
    if (v !== 'yes') return;
    await layers.remove(l.id);
    hideLayer(map, l.id);
    list = list.filter((x) => x !== l);
    paint();
  }
});
$('.layer-list').addEventListener('change', (e) => {
  const li = e.target.closest('.layer');
  const l = li && list.find((x) => x.id === li.dataset.id);
  if (!l) return;
  const act = e.target.dataset.act;
  if (act === 'color') l.color = e.target.value;
  if (act === 'colorby') l.colorBy = e.target.value || null;
  if (act === 'main') l.onMain = e.target.checked;
  if (act === 'opacity') l.opacity = Number(e.target.value);
  update(l);
});

/**
 * Ebene als Plugin auf den WMap-Server: privat (nur für dich, auf allen
 * Geräten) oder sofort öffentlich. Bis 2 MB.
 */
async function asPlugin(l) {
  const text = JSON.stringify(l.data);
  if (text.length > 2e6) { toast(t('ebenen.plugin.too_big')); return; }
  const { ensureLogin, konto } = await import('../services/konto.js');
  const { api } = await import('../services/api.js');
  if (!await ensureLogin(t('ebenen.plugin.login_reason'))) return;
  const v = await ask({
    icon: 'cloud_upload', title: t('ebenen.plugin.title'),
    html: `<div class="plugin-form">
        <label>${t('ebenen.plugin.name')}<input type="text" name="name" maxlength="120" value="${esc(l.name)}"></label>
        <label>${t('ebenen.plugin.description.title')}<textarea name="description" rows="2" maxlength="2000" placeholder="${t('ebenen.plugin.description.placeholder')}"></textarea></label>
        <label>${t('ebenen.plugin.operator')}<input type="text" name="operator" maxlength="120" value="${esc(konto.user()?.name ?? '')}"></label>
        <label>${t('ebenen.plugin.data_date')}<input type="month" name="data_date"></label>
        <label class="plugin-public"><input type="checkbox" name="publish"> ${t('ebenen.plugin.publish')}</label>
      </div>`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('ebenen.plugin.upload'), primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value.trim()])),
  });
  if (!v || v === 'no') return;
  try {
    const r = await api(['plugins', 'save'], { ...v, source_type: 'stored', data: text });
    toast(r.status === 'public' ? t('ebenen.plugin.published') : t('ebenen.plugin.private'));
  } catch (err) { toast(err.message); }
}

/* Laden: Datei(en) oder Link */
async function add(text, meta) {
  try {
    const l = newLayer(text, { ...meta, index: list.length });
    await layers.put(l);
    toast(t('ebenen.add.loaded', { name: l.name, count: l.count.toLocaleString(locale) }));
    await load({ fitTo: l.id });
  } catch (err) { toast(err.message); }
}

$('[data-act="file"]').addEventListener('change', async (e) => {
  for (const f of e.target.files) await add(await f.text(), { name: f.name.replace(/\.(geo)?json$/i, ''), source: { kind: 'file' } });
  e.target.value = '';
});
$('[data-act="url"]').addEventListener('click', async () => {
  const url = await ask({
    icon: 'link', title: t('ebenen.add.link.title'),
    text: t('ebenen.add.link.text'),
    html: '<input type="text" class="url-input" placeholder="https://…/daten.geojson" inputmode="url">',
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('ebenen.add.link.load'), primary: true }],
    read: (dlg) => dlg.querySelector('.url-input').value.trim(),
  });
  if (!url || url === 'no') return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(t('ebenen.add.link.status', { status: res.status }));
    await add(await res.text(), { name: decodeURIComponent(url.split('/').pop().replace(/\.(geo)?json.*$/i, '')) || t('ebenen.add.default_name'), source: { kind: 'url', url } });
  } catch (err) { toast(err.message.includes('NetworkError') || err.name === 'TypeError' ? t('ebenen.add.link.cors') : err.message); }
});

/* Antippen: alle Werte des Objekts */
map.on('click', (e) => {
  const ids = list.filter((l) => l.visible).flatMap((l) => mapLayerIds(l.id)).filter((id) => map.getLayer(id));
  const [f] = ids.length ? map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ids }) : [];
  const box = $('.feature-info');
  if (!f) { box.hidden = true; return; }
  const l = list.find((x) => f.layer.id.startsWith(`own-${x.id}-`));
  box.hidden = false;
  box.innerHTML = `<header><strong>${esc(f.properties.name ?? f.properties.Name ?? f.properties.title ?? l?.name ?? t('ebenen.info.object'))}</strong>
    <button type="button" class="button" data-shape="round no-background" data-act="close-info" title="${t('common.close')}"><span class="msr">close</span></button></header>
    ${propertyTable(f.properties)}`;
  sheet.querySelector('.view').scrollTop = 0;
});
$('.feature-info').addEventListener('click', (e) => { if (e.target.closest('[data-act="close-info"]')) e.currentTarget.hidden = true; });
for (const ev of ['mousemove']) {
  map.on(ev, (e) => {
    const ids = list.filter((l) => l.visible).flatMap((l) => mapLayerIds(l.id)).filter((id) => map.getLayer(id));
    map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? 'pointer' : '';
  });
}

load();
