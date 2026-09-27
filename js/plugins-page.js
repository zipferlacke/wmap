/**
 * Plugins – wie ein App-Store, ohne Karte.
 *
 *   Kartenebenen   aus dem Katalog (WMap-Server) und eingebaute (Wander-,
 *                  Rad-, MTB-Wege). Aktivieren legt sie auf die Hauptkarte
 *                  (Ebenen-Menü), deaktivieren nimmt sie wieder weg.
 *   Erweiterungen  JavaScript, das die App verändert (extensions.js) – erst
 *                  nach einem deutlichen Hinweis aktiv.
 *   Eigene         selbst geladene Ebenen: Datei, ganzer Ordner, Adresse
 *                  (auch mit Passwort). Nur auf diesem Gerät.
 *
 * Antippen zeigt ein Plugin groß: Beschreibung, Anbieter, Stand, Quelle –
 * und den Knopf Aktivieren/Deaktivieren.
 *
 * Aufruf: plugins.html · ?f=layer|extension|own|active · ?id=…
 */
import { mountAppBar } from './appbar.js';
import { api } from './api.js';
import { konto, ensureLogin } from './konto.js';
import { local } from './store.js';
import { layers, newLayer, rasterLayer } from './layers.js';
import { extensions } from './extensions.js';
import { addOwnSource, addOwnFiles } from './own-source.js';
import { ask } from './ui.js';
import { esc } from './geo.js';
import { PRESETS, legendHtml } from './presets.js';

const $ = (s, root = document) => root.querySelector(s);
mountAppBar();

function toast(text) {
  let el = $('#toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

const FILTERS = [
  ['all', 'apps', 'Alle'],
  ['layer', 'layers', 'Kartenebenen'],
  ['extension', 'bolt', 'Erweiterungen'],
  ['own', 'folder', 'Eigene'],
  ['active', 'check_circle', 'Aktiv'],
];
const KIND_LABEL = { layer: 'Kartenebene', extension: 'Erweiterung', own: 'Eigene Ebene' };
const TYPE = { geojson: 'Daten (GeoJSON)', raster: 'Kartenkacheln', stored: 'Messdaten, hier gespeichert', script: 'JavaScript' };

/* Eingebaut: die Wegenetze von Waymarked Trails – dieselben Schalter wie im Ebenen-Menü */
const BUILTIN = [
  { key: 'hiking', icon: 'hiking', name: 'Wanderwege', text: 'Alle markierten Wanderwege – vom Rundweg bis zum Europäischen Fernwanderweg, mit ihren Zeichen.' },
  { key: 'cycling', icon: 'directions_bike', name: 'Radwege', text: 'Markierte Radrouten: Radfernwege, regionale und örtliche Routen.' },
  { key: 'mtb', icon: 'landscape', name: 'Mountainbike', text: 'Ausgeschilderte Mountainbike-Strecken.' },
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
      id: `wmt-${b.key}`, kind: 'layer', icon: b.icon, name: b.name, operator: 'Waymarked Trails', type: 'Kartenkacheln',
      description: `${b.text} Daten aus OpenStreetMap, gezeichnet von waymarkedtrails.org (CC BY-SA).`, builtin: b.key,
      active: !!state[b.key], url: 'https://waymarkedtrails.org',
    })),
    ...PRESETS.map((p) => {
      const installed = own.find((l) => l.source?.presetId === p.id);
      return {
        id: p.id, kind: 'layer', icon: p.icon, name: p.name, operator: p.operator, type: 'Kartenkacheln',
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
      id: `x${x.id}`, kind: 'extension', icon: 'bolt', name: x.name, operator: x.operator || 'du selbst', type: 'JavaScript',
      description: 'Selbst per Adresse hinzugefügt.', url: x.url, ext: x, active: !!x.active, localOnly: true,
    })),
    ...own.filter((l) => !['plugin', 'preset'].includes(l.source?.kind)).map((l) => ({
      id: `l${l.id}`, kind: 'own', icon: l.raster ? 'grid_on' : 'scatter_plot', name: l.name,
      operator: l.source?.kind === 'url' ? new URL(l.source.url).hostname : l.source?.path ? 'aus einem Ordner' : 'aus einer Datei',
      type: l.raster ? (l.raster.auth ? 'Kartenkacheln, privat' : 'Kartenkacheln') : `${(l.count ?? 0).toLocaleString('de-DE')} Objekte`,
      description: l.source?.path ? `Datei: ${l.source.path}` : l.source?.url ?? '', layer: l, active: !!(l.onMain && l.visible),
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
      ${i.active ? '<span class="plug-badge"><span class="msr">check</span> Aktiv</span>' : ''}
    </button>`).join('')
    : `<p class="muted plug-empty">${filter === 'own' ? 'Noch keine eigenen Ebenen – unten eine GeoJSON-Datei, einen Ordner oder eine Adresse hinzufügen.'
      : filter === 'active' ? 'Noch nichts aktiv.' : 'Nichts gefunden.'}</p>`;
  if (serverError && filter !== 'own') $('.plug-grid').insertAdjacentHTML('beforeend', `<p class="muted">Katalog gerade nicht erreichbar: ${esc(serverError)}</p>`);
}

/* ── Ein Plugin groß ──────────────────────────────────────────────────────── */

function showDetail(id, { push = true } = {}) {
  const i = items.find((x) => x.id === id);
  if (!i) { showList({ push }); return; }
  if (push) history.pushState({ id }, '', `?id=${encodeURIComponent(id)}`);
  document.title = `${i.name} – Plugins – WMap`;
  $('.plug-grid').hidden = true;
  $('.plug-filter').hidden = true;
  $('.plug-add').hidden = true;
  const box = $('.plug-detail');
  box.hidden = false;
  const facts = [
    ['category', i.type ? `${KIND_LABEL[i.kind]} · ${i.type}` : KIND_LABEL[i.kind]],
    ['business', i.operator && `Anbieter: ${i.operator}`],
    ['event', i.dataDate && `Stand der Daten: ${i.dataDate}`],
    ['copyright', i.attribution],
    ['mail', i.contact && `Kontakt: ${i.contact}`],
    ['lock', i.status === 'private' ? 'Privat – nur für dich' : i.kind === 'own' || i.localOnly ? 'Nur auf diesem Gerät' : ''],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <button type="button" class="button plug-back" data-act="back"><span class="msr">arrow_back</span> Alle Plugins</button>
    <div class="plug-hero">
      <span class="msr plug-icon big kind-${i.kind}">${i.icon}</span>
      <div><h2>${esc(i.name)}</h2><p class="muted">${esc(i.operator ?? '')}</p></div>
    </div>
    <div class="plug-actions">
      <button type="button" class="button ${i.active ? '' : 'primary'}" data-act="toggle">
        <span class="msr">${i.active ? 'toggle_off' : 'toggle_on'}</span> ${i.active ? 'Deaktivieren' : 'Aktivieren'}</button>
      ${i.kind === 'own' ? `<a class="button" href="./ebenen.html"><span class="msr">map</span> Auf der Karte ansehen</a>` : ''}
      ${i.kind === 'own' || i.localOnly || i.mine ? '<button type="button" class="button" data-act="delete"><span class="msr">delete</span> Löschen</button>' : ''}
    </div>
    ${i.kind === 'extension' ? `<p class="plug-warn"><span class="msr">warning</span> Eine Erweiterung ist Programmcode. Aktiv darf sie alles, was WMap darf – auch deinen Standort sehen. Aktiviere nur, was du kennst und dem Anbieter vertraust.</p>` : ''}
    ${i.description ? `<p class="plug-long">${esc(i.description)}</p>` : ''}
    ${opacityHtml(i)}
    ${i.preset ? legendHtml(i.preset) : ''}
    <ul class="plug-facts">${facts.map(([icon, v]) => `<li><span class="msr">${icon}</span>${esc(v)}</li>`).join('')}</ul>
    ${i.url ? `<p class="muted plug-url">Quelle: ${/^https?:/.test(i.url) ? `<a href="${esc(i.url.split('{')[0])}" target="_blank" rel="noopener">${esc(i.url)}</a>` : esc(i.url)}</p>` : ''}`;
  window.scrollTo({ top: 0 });
}

/* ── Deckkraft einer installierten Ebene ──────────────────────────────────── */

const layerOf = (i) => i.layer ?? (i.kind === 'layer' && i.installed?.id && !i.builtin ? i.installed : null);

function opacityHtml(i) {
  const l = layerOf(i);
  if (!l) return '';
  const v = Math.round((l.opacity ?? (l.raster ? 0.7 : 1)) * 100);
  return `<label class="plug-opacity"><span class="msr">opacity</span><span>Deckkraft</span>
      <input type="range" min="10" max="100" step="5" value="${v}" data-act="opacity" aria-label="Deckkraft in Prozent">
      <output>${v} %</output></label>`;
}

let opacityTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-act="opacity"]')) return;
  const id = new URLSearchParams(location.search).get('id');
  const l = layerOf(items.find((x) => x.id === id) ?? {});
  if (!l) return;
  l.opacity = Number(e.target.value) / 100;
  e.target.nextElementSibling.textContent = `${e.target.value} %`;
  // Gespeichert wird kurz nach dem Loslassen; die Karte nimmt es beim nächsten Öffnen
  clearTimeout(opacityTimer);
  opacityTimer = setTimeout(() => layers.put(l).catch((err) => toast(err.message)), 300);
});

function showList({ push = true } = {}) {
  if (push) history.pushState(null, '', filter === 'all' ? './plugins.html' : `?f=${filter}`);
  document.title = 'Plugins – WMap';
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
      const v = await ask({ icon: 'warning', title: `„${i.name}“ aktivieren?`,
        text: `Die Erweiterung lädt Programmcode von ${new URL(i.url).hostname} und darf in WMap alles – auch deinen Standort sehen. Nur aktivieren, wenn du dem Anbieter vertraust.`,
        buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Aktivieren', primary: true }] });
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
  toast(on ? `„${i.name}“ ist aktiv – auf der Karte im Ebenen-Menü` : `„${i.name}“ ist aus`);
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
        : await fetch(p.source_url).then((r) => { if (!r.ok) throw new Error(`Anbieter antwortet mit ${r.status}`); return r.text(); });
      l = newLayer(text, { name: p.name, source, index: Date.now() % 8 });
    }
    l.onMain = true;
    await layers.put(l);
  } catch (err) {
    toast(err.name === 'TypeError' ? 'Anbieter nicht erreichbar (oder erlaubt keinen Abruf aus dem Browser)' : err.message);
    throw err;
  }
}

async function remove(i) {
  const v = await ask({ icon: 'delete', title: `„${i.name}“ löschen?`,
    text: i.mine && i.server ? 'Das Plugin verschwindet aus dem Katalog – für alle.' : 'Es verschwindet von diesem Gerät.',
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', primary: true }] });
  if (v !== 'yes') return;
  try {
    if (i.kind === 'own') await layers.remove(i.layer.id);
    else if (i.localOnly) await extensions.remove(i.ext.id);
    else if (i.mine) {
      await api(['plugins', 'delete'], { id: i.server.id });
      if (i.installed) await (i.kind === 'extension' ? extensions.remove(i.installed.id) : layers.remove(i.installed.id));
    }
    toast('Gelöscht');
  } catch (err) { toast(err.message); }
  await load();
  showList();
}

/* ── Hinzufügen ───────────────────────────────────────────────────────────── */

async function addScript() {
  const v = await ask({
    icon: 'bolt', title: 'Erweiterung per Adresse',
    html: `<p class="muted">Ein JavaScript-Modul (https, .js/.mjs) mit <code>export function activate(wmap)</code>. Es läuft erst, wenn du es aktivierst.</p>
      <div class="plugin-form">
        <label>Name<input type="text" name="name" maxlength="120"></label>
        <label>Adresse<input type="text" name="url" inputmode="url" placeholder="https://…/erweiterung.js"></label>
      </div>`,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Hinzufügen', primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((x) => [x.name, x.value.trim()])),
  });
  if (!v || v === 'no') return;
  if (!/^https:\/\/\S+\.m?js(\?\S*)?$/.test(v.url)) { toast('Bitte eine https-Adresse zu einer .js-Datei'); return; }
  const id = `u${Date.now().toString(36)}`;
  await extensions.set({ id, name: v.name || new URL(v.url).pathname.split('/').pop(), url: v.url, operator: new URL(v.url).hostname, active: false });
  await load();
  showDetail(`x${id}`);
}

async function offer() {
  if (!await ensureLogin('Zum Anbieten eines Plugins')) return;
  const v = await ask({
    icon: 'publish', title: 'Plugin anbieten',
    html: `<p class="muted">Eine Kartenebene oder Erweiterung, die bei dir oder einem Anbieter liegt. Eigene Messdaten lädst du unter „Eigene Ebenen“ als Plugin hoch.</p>
      <div class="plugin-form">
        <label>Name<input type="text" name="name" maxlength="120" required></label>
        <label>Beschreibung<textarea name="description" rows="3" maxlength="2000"></textarea></label>
        <label>Anbieter<input type="text" name="operator" maxlength="120" value="${esc(konto.user()?.name ?? '')}"></label>
        <label>Kontakt (Web oder E-Mail)<input type="text" name="contact" maxlength="200"></label>
        <label>Art<select name="source_type"><option value="geojson">GeoJSON-Link</option><option value="raster">Kartenkacheln oder WMS</option><option value="script">Erweiterung (JavaScript)</option></select></label>
        <label>Link (https)<input type="text" name="source_url" inputmode="url" placeholder="https://…"></label>
        <label>Namensnennung<input type="text" name="attribution" maxlength="300" placeholder="© …"></label>
        <label>Stand der Daten<input type="month" name="data_date"></label>
        <label class="plugin-public"><input type="checkbox" name="publish"> Öffentlich anbieten – sonst nur für dich</label>
      </div>`,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Speichern', primary: true }],
    read: (dlg) => Object.fromEntries([...dlg.querySelectorAll('.plugin-form [name]')].map((x) => [x.name, x.type === 'checkbox' ? x.checked : x.value.trim()])),
  });
  if (!v || v === 'no') return;
  try {
    const r = await api(['plugins', 'save'], v);
    toast(r.status === 'public' ? 'Veröffentlicht – für alle im Katalog' : 'Gespeichert – nur für dich');
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
});
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('input[data-add]');
  if (!inp?.files?.length) return;
  const { added, failed } = await addOwnFiles(inp.files, { index: items.length });
  inp.value = '';
  toast(added.length ? `${added.length} ${added.length === 1 ? 'Ebene' : 'Ebenen'} geladen${failed.length ? ` – ${failed.length} ließen sich nicht lesen` : ''}`
    : failed.length ? `Keine gültige GeoJSON-Datei (${failed.slice(0, 3).join(', ')})` : 'Keine GeoJSON-Dateien gefunden');
  await load();
  filter = 'own';
  showList();
});
$('.plug-search input').addEventListener('input', (e) => { query = e.target.value; if (!$('.plug-detail').hidden) showList(); else paintGrid(); });
addEventListener('popstate', () => {
  const p = new URLSearchParams(location.search);
  filter = p.get('f') || filter;
  if (p.get('id')) showDetail(p.get('id'), { push: false }); else showList({ push: false });
});

await load();
const startId = new URLSearchParams(location.search).get('id');
if (startId) showDetail(startId, { push: false }); else showList({ push: false });
