/**
 * Teilen per Link – ohne Server, alles steckt in der Adresse (nur der kurze
 * Link auf Wunsch liegt 30 Tage auf dem Server, data/short-link.js):
 *
 *   ?ort=lon,lat&name=…&zeit=…    ein Ort oder „hier bin ich“ (mit Uhrzeit)
 *   ?route=…                       Route mit Profil und Wegpunkten (gepackt)
 *   ?street=lon,lat,richtung,blick Street View genau so, wie man gerade steht und schaut
 *   ?anfrage=Name                  „Name möchte wissen, wo du bist“ – wer den
 *                                  Link öffnet, schickt seinen Standort zurück
 *
 * Beim Teilen fragt ein Dialog: Teilen-Menü des Geräts (wo es das gibt), Text
 * mit Link kopieren oder nur den Link kopieren.
 *
 * Ein Ort (Ort, „hier bin ich“, unterwegs) geht als Karten-Link „geo:“ – den
 * öffnet jede Karten-App –, darunter in Klammern der Link zu WMap:
 *
 *   Gänseliesel
 *   geo:51.53194,9.93554?q=51.53194,9.93554(Gänseliesel)
 *   (WMap: https://app.wuefl.de/wmap/index.html?ort=9.93554,51.53194&name=Gänseliesel)
 */
import { packJson, unpackJson, local } from '../data/store.js';
import { ask } from './dialogs.js';
import { esc, clockFormat } from '../core/geo.js';
import { PUBLIC_URL } from '../core/config.js';
import { locale, t } from '../core/i18n.js';

const NAME_KEY = 'wmap.myname';
// Android-App: das WebView hat weder navigator.share noch eine verlässliche
// Zwischenablage – beides über das Plugin „browser“
const core = window.__TAURI__?.core;
const androidApp = !!core && /Android/i.test(navigator.userAgent);
const web = /^https?:$/.test(location.protocol) && location.hostname !== 'tauri.localhost';
const base = () => {
  if (web) return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html`;
  // Desktop-App: tauri://localhost kann niemand öffnen
  if (!PUBLIC_URL) throw new Error(t('share.error.desktop'));
  return `${PUBLIC_URL}index.html`;
};
const r5 = (v) => +v.toFixed(5);
// Ab dieser Länge wird ein kurzer Link angeboten (manches Chatfeld schneidet lange ab)
const SHORT_FROM = 400;
/** Öffentliche Adresse einer Seite von WMap (z. B. „wege.html“) – auch aus der App */
export const pageUrl = (page) => base().replace(/index\.html$/, page);

export const placeUrl = ([lon, lat], name = '', { at = null } = {}) => {
  // Komma bleibt lesbar – URLSearchParams machte daraus %2C
  let url = `${base()}?ort=${r5(lon)},${r5(lat)}`;
  if (name) url += `&name=${encodeURIComponent(name)}`;
  if (at) url += `&zeit=${Math.round(at / 60000)}`;             // Minuten reichen
  return url;
};

/** Karten-Link für jede App: geo:Breite,Länge?q=Breite,Länge(Name) – nur was stört, wird kodiert */
export const geoUri = ([lon, lat], name = '') => {
  const at = `${r5(lat)},${r5(lon)}`;
  const label = String(name ?? '').trim().replace(/[\s()+&#%?]/g, (c) => encodeURIComponent(c));
  return `geo:${at}?q=${at}${label ? `(${label})` : ''}`;
};

/** Wegpunkte [{ label, point }] und Profil → Link */
export async function routeUrl({ profile, waypoints }) {
  const w = waypoints.filter((x) => x.point).map((x) => [r5(x.point[0]), r5(x.point[1]), x.me ? '' : x.label ?? '']);
  return `${base()}?route=${await packJson({ p: profile, w })}`;
}

export async function readRoute(code) {
  const o = await unpackJson(code);
  return { profile: o.p, waypoints: (o.w ?? []).map(([lon, lat, label]) => ({ label: label || t('share.route.shared_point'), point: [lon, lat], me: false })) };
}

/** Street View: Standpunkt, Blickrichtung und Neigung → Link */
export const streetUrl = ({ point: [lon, lat], bearing, look }) =>
  `${base()}?street=${r5(lon)},${r5(lat)},${Math.round((bearing % 360 + 360) % 360)},${+look.toFixed(1)}`;

export const requestUrl = (name) => `${base()}?anfrage=${encodeURIComponent(name)}`;

/**
 * Teilen-Dialog: Teilen-Menü des Geräts, Text mit Link kopieren oder nur den
 * Link kopieren. `url` darf eine Funktion sein (auch async) – Fehler dabei
 * landen als Hinweis. `short` (async → Adresse): Ist der Link lang, gibt es dazu
 * „Kurzen Link erstellen“ (data/short-link.js – der Inhalt liegt dann 30 Tage
 * auf dem Server). `geo` ({ point, name }): ein Ort – der Link ist dann der geo:-Link, der zu WMap steht in
 * Klammern darunter. → 'shared' | 'copied' | null
 */
export async function share({ title, text = '', url: make, short = null, note = '', geo = null }, toast) {
  let url;
  try { url = typeof make === 'function' ? await make() : make; } catch (err) { toast?.(err.message); return null; }
  const wmap = url;
  if (geo?.point) url = `${geoUri(geo.point, geo.name)}\n(${t('share.wmap_link', { url: wmap })})`;
  const full = text ? `${text}\n${url}` : url;
  const system = androidApp || !!navigator.share;
  const shown = geo?.point ? `<span class="share-url">${esc(geoUri(geo.point, geo.name))}</span><span class="share-url share-wmap">(${t('share.wmap_link', { url: esc(wmap) })})</span>` : `<span class="share-url">${esc(url)}</span>`;
  const choice = await ask({
    icon: 'share', title, className: 'stacked',
    html: `<div class="share-preview">${text ? `<p>${esc(text)}</p>` : ''}${shown}</div>${note ? `<p class="muted share-note">${esc(note)}</p>` : ''}`,
    buttons: [
      ...(system ? [{ value: 'share', label: t('share.menu.share'), icon: 'share', primary: true }] : []),
      ...(text ? [{ value: 'text', label: t('share.menu.copy_text'), icon: 'content_copy', primary: !system }] : []),
      { value: 'link', label: t('share.menu.copy_link'), icon: 'link', primary: !system && !text },
      ...(short && url.length > SHORT_FROM ? [{ value: 'short', label: t('share.menu.short'), icon: 'compress' }] : []),
      { value: 'no', label: t('common.cancel') },
    ],
  });
  if (choice === 'short') {
    let small;
    try { small = await short(); } catch (err) { toast?.(err.message || t('share.short.failed')); return share({ title, text, url }, toast); }
    return share({ title, text, url: small, note: t('share.short.note') }, toast);
  }
  if (choice === 'share') {
    try {
      if (androidApp) await core.invoke('plugin:browser|share', { title, text: full });
      // Mit geo:-Link alles als Text – das Feld `url` nimmt nur http(s)
      else await navigator.share(geo?.point ? { title, text: full } : { title, text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return null;             // selbst abgebrochen
      return copy(full, t('share.copied.text'), title, toast);
    }
  }
  if (choice === 'text') return copy(full, t('share.copied.text'), title, toast);
  if (choice === 'link') return copy(url, t('share.copied.link'), title, toast);
  return null;
}

/** Kann dieses Gerät Dateien über sein Teilen-Menü weitergeben? (Handy-Browser, Android-App) */
export const canShareFiles = () => androidApp || !!navigator.canShare?.({ files: [new File(['x'], 'x.gpx', { type: 'application/gpx+xml' })] });

/**
 * Eine Datei über das Teilen-Menü des Systems weitergeben (Messenger, Mail …).
 * `body`: Text oder Uint8Array. → true (Menü geöffnet bzw. dort abgebrochen) | false (geht hier nicht:
 * dann herunterladen – auch in einer älteren App, die den Befehl noch nicht kennt)
 */
export async function shareFile(name, body, type, title = '') {
  if (androidApp) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try { await core.invoke('plugin:browser|share_file', { title, name, data: btoa(bin), mime: type }); return true; } catch { return false; }
  }
  const file = new File([body], name, { type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file], title }); return true; } catch (err) { return err.name === 'AbortError'; }
}

/** In die Zwischenablage – geht das nicht, zum Markieren und selbst Kopieren. */
async function copy(value, done, title, toast) {
  try {
    if (androidApp) await core.invoke('plugin:browser|copy', { title, text: value });
    else await navigator.clipboard.writeText(value);
    toast?.(t('share.copied.then', { done }));
  } catch {
    await ask({ icon: 'content_copy', title, text: t('share.copied.failed'),
      html: `<textarea class="share-link" readonly rows="${Math.min(6, value.split('\n').length + 2)}" onfocus="this.select()">${esc(value)}</textarea>`,
      buttons: [{ value: 'ok', label: t('common.done'), primary: true }] });
  }
  return 'copied';
}

/** Eigener Name für Anfragen – einmal fragen, dann merken. */
export async function myName() {
  const known = local.get(NAME_KEY);
  if (known) return known;
  const v = await ask({
    icon: 'badge', title: t('share.my_name.title'),
    text: t('share.my_name.text'),
    html: `<input class="share-name" type="text" maxlength="40" autocomplete="given-name" placeholder="${t('share.my_name.placeholder')}">`,
    buttons: [{ value: 'no', label: t('common.cancel') }, { value: 'ok', label: t('common.next'), primary: true }],
    read: (dlg) => dlg.querySelector('.share-name').value.trim(),
  });
  if (!v || v === 'no') return null;
  local.set(NAME_KEY, v);
  return v;
}

export const clock = (ms) => new Date(ms).toLocaleTimeString(locale, { ...clockFormat() });
