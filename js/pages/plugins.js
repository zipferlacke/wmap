/**
 * Plugins – wie ein App-Store, ohne Karte.
 *
 *   Kartenebenen   aus dem Katalog (WMap-Server) und eingebaute (Wander-,
 *                  Rad-, MTB-Wege). Aktivieren legt sie auf die Hauptkarte
 *                  (Ebenen-Menü), deaktivieren nimmt sie wieder weg.
 *   Erweiterungen  JavaScript, das die App verändert (map/extensions.js) – erst
 *                  nach einem deutlichen Hinweis aktiv.
 *   Eigene         selbst geladene Ebenen: Datei, Adresse (auch mit Passwort),
 *                  Plugin-Ordner (mehrere, gemerkt – data/plugin-folders.js,
 *                  Aufbau: plugin-anleitung.html). Nur auf diesem Gerät.
 *
 * Antippen zeigt ein Plugin groß: Beschreibung, Anbieter, Stand, Quelle –
 * und den Knopf Aktivieren/Deaktivieren.
 *
 * Aufruf: plugins.html · ?f=layer|extension|own|active · ?id=…
 */
import { mountAppBar } from '../ui/appbar.js';
import { api } from '../services/api.js';
import { konto, ensureLogin } from '../services/konto.js';
import { local } from '../data/store.js';
import { layers, newLayer, rasterLayer } from '../map/layers.js';
import { extensions } from '../map/extensions.js';
import { addOwnSource, addOwnFiles } from '../ui/own-source.js';
import { pluginFolders, folderMode } from '../data/plugin-folders.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { PRESETS, legendHtml } from '../map/presets.js';
import { locale, t } from '../core/i18n.js';

const $ = (s, root = document) => root.querySelector(s);
mountAppBar();

const FILTERS = [
  ['all', 'apps', t('plugins.filter.all')],
  ['layer', 'layers', t('plugins.filter.layer')],
  ['extension', 'bolt', t('plugins.filter.extension')],
  ['own', 'folder', t('plugins.filter.own')],
  ['active', 'check_circle', t('plugins.filter.active')],
];
const KIND_LABEL = { layer: t('plugins.kind.layer'), extension: t('plugins.kind.extension'), own: t('plugins.kind.own') };
const TYPE = { geojson: t('plugins.type.geojson'), raster: t('plugins.type.raster'), stored: t('plugins.type.stored'), script: t('plugins.type.script') };

/* Eingebaut: die Wegenetze von Waymarked Trails – dieselben Schalter wie im Ebenen-Menü */
const BUILTIN = [
  { key: 'hiking', icon: 'hiking', name: t('plugins.builtin.hiking.name'), text: t('plugins.builtin.hiking.text') },
  { key: 'cycling', icon: 'directions_bike', name: t('plugins.builtin.cycling.name'), text: t('plugins.builtin.cycling.text') },
  { key: 'mtb', icon: 'landscape', name: t('plugins.builtin.mtb.name'), text: t('plugins.builtin.mtb.text') },
];

let filter = new URLSearchParams(location.search).get('f') || 'all';
let query = '';
let items = [];
let serverError = '';

/* ── Daten zusammentragen ─────────────────────────────────────────────────── */

async function load() {
  const [own, exts] = await Promise.all([layers.all().catch(() => []), extensions.all()]);
  let server = [];
  serverError = '';
  try { server = await api(['plugins', 'list']); } catch (err) { serverError = err.message; }
  const state = local.get('wmap.layers', {});

  items = [
    ...BUILTIN.map((b) => ({
      id: `wmt-${b.key}`, kind: 'layer', icon: b.icon, name: b.name, operator: 'Waymarked Trails', type: t('plugins.type.raster'),
      description: t('plugins.builtin.description', { text: b.text }), builtin: b.key,
      active: !!state[b.key], url: 'https://waymarkedtrails.org',
    })),
    ...PRESETS.map((p) => {
      const installed = own.find((l) => l.source?.presetId === p.id);
      return {
        id: p.id, kind: 'layer', icon: p.icon, name: p.name, operator: p.operator, type: t('plugins.type.raster'),
        description: p.text, attribution: p.attribution.replace(/<[^>]+>/g, ''), url: p.url, preset: p, installed, active: !!installed,
      };
    }),
    ...server.map((p) => {
      const ext = p.source_type === 'script';
      const installed = ext ? exts.find((x) => x.pluginId === p.id) : own.find((l) => l.source?.pluginId === p.id);
      return {
        id: `p${p.id}`, kind: ext ? 'extension' : 'layer', icon: ext ? 'bolt' : p.source_type === 'raster' ? 'grid_on' : 'scatter_plot',
        name: p.name, operator: p.operator || p.author, type: TYPE[p.source_type] ?? p.source_type, description: p.description,
        dataDate: p.data_date, attribution: p.attribution, contact: p.contact, url: p.source_url, status: p.status, mine: !!+p.mine,
        server: p, installed, active: ext ? !!installed?.active : !!installed,
      };
    }),
    ...exts.filter((x) => !x.pluginId).map((x) => ({
      id: `x${x.id}`, kind: 'extension', icon: 'bolt', name: x.name, operator: x.operator || t('plugins.source.self'), type: t('plugins.type.script'),
      description: x.folder ? (x.description || t('plugins.source.ext_folder', { path: x.path })) : t('plugins.source.ext_url'), url: x.url, ext: x, active: !!x.active, localOnly: true,
    })),
    ...own.filter((l) => !['plugin', 'preset'].includes(l.source?.kind)).map((l) => ({
      id: `l${l.id}`, kind: 'own', icon: l.raster ? 'grid_on' : 'scatter_plot', name: l.name,
      operator: l.operator || (l.source?.kind === 'url' ? new URL(l.source.url).hostname : l.source?.folder ? t('plugins.source.plugin_folder') : l.source?.path ? t('plugins.source.folder') : t('plugins.source.file')),
      type: l.raster ? (l.raster.auth ? t('plugins.type.raster_private') : t('plugins.type.raster')) : t('plugins.type.objects', { count: (l.count ?? 0).toLocaleString(locale) }),
      description: l.description || (l.source?.path ? t('plugins.source.file_path', { path: l.source.path }) : l.source?.url ?? ''), attribution: l.attribution, layer: l, active: !!(l.onMain && l.visible),
    })),
  ];
}

/* ── Liste ────────────────────────────────────────────────────────────────── */

function visible() {
  const q = query.trim().toLowerCase();
  return items.filter((i) => (filter === 'all' || (filter === 'active' ? i.active : i.kind === filter))
    && (!q || [i.name, i.operator, i.description, i.type].some((x) => String(x ?? '').toLowerCase().includes(q))));
}

function paintFilter() {
  $('.plug-filter').innerHTML = FILTERS.map(([k, icon, label]) => {
    const n = k === 'all' ? items.length : k === 'active' ? items.filter((i) => i.active).length : items.filter((i) => i.kind === k).length;
    return `<button type="button" class="chip" data-f="${k}" aria-pressed="${k === filter}"><span class="msr">${icon}</span>${label} <small>${n}</small></button>`;
  }).join('');
}

function paintGrid() {
  paintFilter();
  const list = visible();
  $('.plug-grid').innerHTML = list.length ? list.map((i) => `
    <button type="button" class="plug-card${i.active ? ' active' : ''}" data-id="${esc(i.id)}">
      <span class="msr plug-icon kind-${i.kind}">${i.icon}</span>
      <span class="plug-text">
        <strong>${esc(i.name)}</strong>
        <small>${esc([i.operator, KIND_LABEL[i.kind]].filter(Boolean).join(' · '))}</small>
        ${i.description ? `<span class="plug-desc">${esc(i.description)}</span>` : ''}
      </span>
      ${i.active ? `<span class="plug-badge"><span class="msr">check</span> ${t('plugins.filter.active')}</span>` : ''}
    </button>`).join('')
    : `<p class="muted plug-empty">${filter === 'own' ? t('plugins.list.empty_own')
      : filter === 'active' ? t('plugins.list.empty_active') : t('plugins.list.empty')}</p>`;
  if (serverError && filter !== 'own') $('.plug-grid').insertAdjacentHTML('beforeend', `<p class="muted">${t('plugins.list.server_error', { error: esc(serverError) })}</p>`);
}

/* ── Ein Plugin groß ──────────────────────────────────────────────────────── */

function showDetail(id, { push = true } = {}) {
  const i = items.find((x) => x.id === id);
  if (!i) { showList({ push }); return; }
  if (push) history.pushState({ id }, '', `?id=${encodeURIComponent(id)}`);
  document.title = t('plugins.detail.page_title', { name: i.name });
  $('.plug-grid').hidden = true;
  $('.plug-filter').hidden = true;
  $('.plug-add').hidden = true;
  const box = $('.plug-detail');
  box.hidden = false;
  const facts = [
    ['category', i.type ? `${KIND_LABEL[i.kind]} · ${i.type}` : KIND_LABEL[i.kind]],
    ['business', i.operator && t('plugins.detail.operator', { operator: i.operator })],
    ['event', i.dataDate && t('plugins.detail.data_date', { date: i.dataDate })],
    ['copyright', i.attribution],
    ['mail', i.contact && t('plugins.detail.contact', { contact: i.contact })],
    ['lock', i.status === 'private' ? t('plugins.detail.private') : i.kind === 'own' || i.localOnly ? t('plugins.detail.local') : ''],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <button type="button" class="button plug-back" data-act="back"><span class="msr">arrow_back</span> ${t('plugins.detail.back')}</button>
    <div class="plug-hero">
      <span class="msr plug-icon big kind-${i.kind}">${i.icon}</span>
      <div><h2>${esc(i.name)}</h2><p class="muted">${esc(i.operator ?? '')}</p></div>
    </div>
    <div class="plug-actions">
      <button type="button" class="button ${i.active ? '' : 'primary'}" data-act="toggle">
        <span class="msr">${i.active ? 'toggle_off' : 'toggle_on'}</span> ${i.active ? t('plugins.detail.deactivate') : t('plugins.detail.activate')}</button>
      ${i.kind === 'own' ? `<a class="button" href="./ebenen.html"><span class="msr">map</span> ${t('plugins.detail.on_map')}</a>` : ''}
      ${i.kind === 'own' || i.localOnly || i.mine ? `<button type="button" class="button" data-act="delete"><span class="msr">delete</span> ${t('common.delete')}</button>` : ''}
    </div>
    ${i.kind === 'extension' ? `<p class="plug-warn"><span class="msr">warning</span> ${t('plugins.detail.warning')}</p>` : ''}
    ${i.description ? `<p class="plug-long">${esc(i.description)}</p>` : ''}
    ${opacityHtml(i)}
    ${i.preset ? legendHtml(i.preset) : ''}
    <ul class="plug-facts">${facts.map(([icon, v]) => `<li><span class="msr">${icon}</span>${esc(v)}</li>`).join('')}</ul>
    ${i.url ? `<p class="muted plug-url">${t('plugins.detail.source', { url: /^https?:/.test(i.url) ? `<a href="${esc(i.url.split('{')[0])}" target="_blank" rel="noopener">${esc(i.url)}</a>` : esc(i.url) })}</p>` : ''}`;
  window.scrollTo({ top: 0 });
}

/* ── Deckkraft einer installierten Ebene ──────────────────────────────────── */

const layerOf = (i) => i.layer ?? (i.kind === 'layer' && i.installed?.id && !i.builtin ? i.installed : null);

function opacityHtml(i) {
  const l = layerOf(i);
  if (!l) return '';
  const v = Math.round((l.opacity ?? (l.raster ? 0.7 : 1)) * 100);
  return `<label class="plug-opacity"><span class="msr">opacity</span><span>${t('plugins.detail.opacity.title')}</span>
      <input type="range" min="10" max="100" step="5" value="${v}" data-act="opacity" aria-label="${t('plugins.detail.opacity.label')}">
      <output>${t('plugins.detail.opacity.value', { v })}</output></label>`;
}

let opacityTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-act="opacity"]')) return;
  const id = new URLSearchParams(location.search).get('id');
  const l = layerOf(items.find((x) => x.id === id) ?? {});
  if (!l) return;
  l.opacity = Number(e.target.value) / 100;
  e.target.nextElementSibling.textContent = t('plugins.detail.opacity.value', { v: e.target.value });
  // Gespeichert wird kurz nach dem Loslassen; die Karte nimmt es beim nächsten Öffnen
  clearTimeout(opacityTimer);
  opacityTimer = setTimeout(() => layers.put(l).catch((err) => toast(err.message)), 300);
});

function showList({ push = true } = {}) {
  if (push) history.pushState(null, '', filter === 'all' ? './plugins.html' : `?f=${filter}`);
  document.title = t('plugins.page_title');
  $('.plug-detail').hidden = true;
  $('.plug-grid').hidden = false;
  $('.plug-filter').hidden = false;
  $('.plug-add').hidden = false;
  paintGrid();
}

/* ── Aktivieren, Deaktivieren, Löschen ────────────────────────────────────── */

async function toggle(i) {
  const on = !i.active;
  if (i.builtin) {
    const state = local.get('wmap.layers', {});
    state[i.builtin] = on;
    local.set('wmap.layers', state);
  } else if (i.kind === 'own') {
    Object.assign(i.layer, { onMain: on, visible: on || i.layer.visible });
    await layers.put(i.layer);
  } else if (i.kind === 'extension') {
    if (on) {
      const v = await ask({ icon: 'warning', title: t('plugins.activate.title', { name: i.name }),
        text: i.url ? t('plugins.activate.text_url', { host: new URL(i.url).hostname }) : t('plugins.activate.text_folder', { path: i.ext?.path ?? '' }),
        buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('plugins.detail.activate'), primary: true }] });
      if (v !== 'yes') return;
    }
    const ext = i.ext ?? i.installed ?? { id: `s${i.server.id}`, name: i.name, url: i.url, operator: i.operator, pluginId: i.server.id };
    await extensions.set({ ...ext, active: on });
  } else if (on && i.preset) {
    const p = i.preset;
    const l = rasterLayer({ name: p.name, tiles: p.tiles, attribution: p.attribution, minzoom: p.minzoom, maxzoom: p.maxzoom,
      source: { kind: 'preset', presetId: p.id, url: p.url, operator: p.operator } });
    l.onMain = true;
    await layers.put(l);
  } else if (on) {
    await installLayer(i);
  } else {
    await layers.remove(i.installed.id);
  }
  toast(on ? t('plugins.toast.active', { name: i.name }) : t('plugins.toast.off', { name: i.name }));
  await load();
  showDetail(i.id, { push: false });
}

/** Katalog-Ebene holen und auf die Hauptkarte legen */
async function installLayer(i) {
  const p = i.server;
  const source = { kind: 'plugin', url: p.source_url, operator: p.operator || p.author, updated: p.data_date, pluginId: p.id };
  try {
    let l;
    if (p.source_type === 'raster') l = rasterLayer({ name: p.name, tiles: p.source_url, attribution: p.attribution, source });
    else {
      const text = p.source_type === 'stored' ? JSON.stringify(await api(['plugins', 'data'], { id: p.id }))
        : await fetch(p.source_url).then((r) => { if (!r.ok) throw new Error(t('plugins.error.status', { status: r.status })); return r.text(); });
      l = newLayer(text, { name: p.name, source, index: Date.now() % 8 });
    }
    l.onMain = true;
    await layers.put(l);
  } catch (err) {
    toast(err.name === 'TypeError' ? t('plugins.error.unreachable') : err.message);
    throw err;
  }
}

async function remove(i) {
  const v = await ask({ icon: 'delete', title: t('plugins.delete.title', { name: i.name }),
    text: i.mine && i.server ? t('plugins.delete.server') : t('plugins.delete.local'),
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('common.delete'), primary: true }] });
  if (v !== 'yes') return;
  try {
    if (i.kind === 'own') await layers.remove(i.layer.id);
    else if (i.localOnly) await extensions.remove(i.ext.id);
    else if (i.mine) {
      await api(['plugins', 'delete'], { id: i.server.id });
      if (i.installed) await (i.kind === 'extension' ? extensions.remove(i.installed.id) : layers.remove(i.installed.id));
    }
    toast(t('plugins.delete.done'));
  } catch (err) { toast(err.message); }
  await load();
  showList();
}

/* ── Hinzufügen ───────────────────────────────────────────────────────────── */

async function addScript() {
  const v = await ask({
    icon: 'bolt', title: t('plugins.add.script'),
    html: `<p class="muted">${t('plugins.script.hint')}</p>
      <div class="plugin-form">
        <label>${t('plugins.script.name')}<input type="text" name="name" maxlength="120"></label>
        <label>${t('plugins.script.url.title')}<input type="text" name="url" inputmode="url" placeholder="${t('plugins.script.url.placeholder')}"></label>
      </div>`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('plugins.script.add'), primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((x) => [x.name, x.value.trim()])),
  });
  if (!v || v === 'no') return;
  if (!/^https:\/\/\S+\.m?js(\?\S*)?$/.test(v.url)) { toast(t('plugins.script.bad_url')); return; }
  const id = `u${Date.now().toString(36)}`;
  await extensions.set({ id, name: v.name || new URL(v.url).pathname.split('/').pop(), url: v.url, operator: new URL(v.url).hostname, active: false });
  await load();
  showDetail(`x${id}`);
}

async function offer() {
  if (!await ensureLogin(t('plugins.offer.login_reason'))) return;
  const v = await ask({
    icon: 'publish', title: t('plugins.add.offer'),
    html: `<p class="muted">${t('plugins.offer.hint')}</p>
      <div class="plugin-form">
        <label>${t('plugins.offer.name')}<input type="text" name="name" maxlength="120" required></label>
        <label>${t('plugins.offer.description')}<textarea name="description" rows="3" maxlength="2000"></textarea></label>
        <label>${t('plugins.offer.operator')}<input type="text" name="operator" maxlength="120" value="${esc(konto.user()?.name ?? '')}"></label>
        <label>${t('plugins.offer.contact')}<input type="text" name="contact" maxlength="200"></label>
        <label>${t('plugins.offer.kind.title')}<select name="source_type"><option value="geojson">${t('plugins.offer.kind.geojson')}</option><option value="raster">${t('plugins.offer.kind.raster')}</option><option value="script">${t('plugins.offer.kind.script')}</option></select></label>
        <label>${t('plugins.offer.link')}<input type="text" name="source_url" inputmode="url" placeholder="https://…"></label>
        <label>${t('plugins.offer.attribution')}<input type="text" name="attribution" maxlength="300" placeholder="© …"></label>
        <label>${t('plugins.offer.data_date')}<input type="month" name="data_date"></label>
        <label class="plugin-public"><input type="checkbox" name="publish"> ${t('plugins.offer.publish')}</label>
      </div>`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('common.save'), primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((x) => [x.name, x.type === 'checkbox' ? x.checked : x.value.trim()])),
  });
  if (!v || v === 'no') return;
  try {
    const r = await api(['plugins', 'save'], v);
    toast(r.status === 'public' ? t('plugins.offer.published') : t('plugins.offer.private'));
    await load();
    showList();
  } catch (err) { toast(err.message); }
}

/* ── Ereignisse ───────────────────────────────────────────────────────────── */

document.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-f]');
  if (f) { filter = f.dataset.f; showList(); return; }
  const card = e.target.closest('.plug-card');
  if (card) { showDetail(card.dataset.id); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const current = items.find((x) => x.id === new URLSearchParams(location.search).get('id'));
  if (act === 'back') showList();
  if (act === 'toggle' && current) { e.target.closest('button').disabled = true; try { await toggle(current); } catch { showDetail(current.id, { push: false }); } }
  if (act === 'delete' && current) remove(current);
  const add = e.target.closest('button[data-add]')?.dataset.add;
  if (add === 'source') { if (await addOwnSource({ toast, index: items.length })) { await load(); filter = 'own'; showList(); } }
  if (add === 'script') addScript();
  if (add === 'offer') offer();
  if (add === 'plugin-folder') {
    try { const r = await pluginFolders.add({ index: items.length }); folderLoaded(r.folder.name, r); } catch (err) {
      if (err.name !== 'AbortError') toast(t('plugins.folders.add_failed', { error: err.message }));
    }
  }
  const fa = e.target.closest('[data-folder-act]');
  if (fa) {
    const id = fa.closest('[data-folder]').dataset.folder;
    const name = fa.closest('[data-folder]').dataset.name;
    if (fa.dataset.folderAct === 'reload') {
      fa.disabled = true;
      try { folderLoaded(name, await pluginFolders.reload(id, { index: items.length })); } catch (err) { toast(err.message); }
      fa.disabled = false;
    }
    if (fa.dataset.folderAct === 'remove') {
      const v = await ask({ icon: 'folder_off', title: t('plugins.folders.remove.title', { name }), text: t('plugins.folders.remove.text'),
        buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'yes', label: t('plugins.folders.remove.button'), primary: true }] });
      if (v === 'yes') { await pluginFolders.remove(id); await load(); showList(); paintFolders(); }
    }
  }
});
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('input[data-add]');
  if (!inp?.files?.length) return;
  if (inp.dataset.add === 'folder-once') {
    const r = await pluginFolders.readOnce(inp.files, { index: items.length });
    inp.value = '';
    folderLoaded(r.name, r);
    return;
  }
  const r = await addOwnFiles(inp.files, { index: items.length });
  inp.value = '';
  loaded(r);
});

/** Nach dem Einlesen eines Plugin-Ordners */
async function folderLoaded(name, { layers: nl = 0, extensions: ne = 0, failed = [] }) {
  const what = [nl ? t('plugins.folders.layers', { n: nl }) : '', ne ? t('plugins.folders.extensions', { n: ne }) : ''].filter(Boolean).join(t('plugins.folders.and'));
  toast(`${what ? t('plugins.folders.loaded', { what, name }) : t('plugins.folders.nothing', { name })}${failed.length ? t('plugins.folders.unreadable', { files: failed.slice(0, 3).join(', ') }) : ''}`);
  await load();
  filter = 'own';
  showList();
  paintFolders();
}

/*
 * Plugin-Ordner: in der App und in Chrome/Edge gemerkt (neu einlesen,
 * entfernen); Firefox/Safari können nur einmal einlesen.
 */
async function paintFolders() {
  const box = $('.plug-folders');
  const add = $('[data-add="plugin-folder"]');
  const once = $('input[data-add="folder-once"]')?.closest('label');
  add.hidden = folderMode === 'once';
  if (once) once.hidden = folderMode !== 'once';
  if (folderMode === 'once') {
    box.innerHTML = `<p class="muted"><span class="msr">info</span> ${t('plugins.folders.once_hint')}</p>`;
    return;
  }
  const list = await pluginFolders.list();
  box.innerHTML = list.length ? `<h3>${t('plugins.folders.title')}</h3><ul>${list.map((f) => `
    <li data-folder="${esc(f.id)}" data-name="${esc(f.name)}"><span class="msr">folder</span><strong>${esc(f.name)}</strong>
      <button type="button" class="button" data-folder-act="reload"><span class="msr">refresh</span> ${t('plugins.folders.reload')}</button>
      <button type="button" class="button" data-folder-act="remove" title="${t('plugins.folders.remove.label')}" aria-label="${t('plugins.folders.remove.label')}"><span class="msr">folder_off</span></button></li>`).join('')}</ul>` : '';
}
paintFolders();

async function loaded({ added, failed }) {
  toast(added.length ? `${t('plugins.files.loaded', { n: added.length })}${failed.length ? t('plugins.files.some_failed', { n: failed.length }) : ''}`
    : failed.length ? t('plugins.files.invalid', { files: failed.slice(0, 3).join(', ') }) : t('plugins.files.none'));
  await load();
  filter = 'own';
  showList();
}

$('.plug-search input').addEventListener('input', (e) => { query = e.target.value; if (!$('.plug-detail').hidden) showList(); else paintGrid(); });
addEventListener('popstate', () => {
  const p = new URLSearchParams(location.search);
  filter = p.get('f') || filter;
  if (p.get('id')) showDetail(p.get('id'), { push: false }); else showList({ push: false });
});

await load();
const startId = new URLSearchParams(location.search).get('id');
if (startId) showDetail(startId, { push: false }); else showList({ push: false });
