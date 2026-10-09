/**
 * Teilen per Link – ohne Server, alles steckt in der Adresse (nur der kurze
 * Link auf Wunsch liegt 30 Tage auf dem Server, data/short-link.js):
 *
 *   ?ort=lon,lat&name=…&zeit=…    ein Ort oder „hier bin ich“ (mit Uhrzeit)
 *   ?route=…                       Route mit Profil und Wegpunkten (gepackt)
 *   ?anfrage=Name                  „Name möchte wissen, wo du bist“ – wer den
 *                                  Link öffnet, schickt seinen Standort zurück
 *
 * Beim Teilen fragt ein Dialog: Teilen-Menü des Geräts (wo es das gibt), Text
 * mit Link kopieren oder nur den Link kopieren.
 */
import { packJson, unpackJson, local } from '../data/store.js';
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { PUBLIC_URL } from '../core/config.js';

const NAME_KEY = 'wmap.myname';
// Android-App: das WebView hat weder navigator.share noch eine verlässliche
// Zwischenablage – beides über das Plugin „browser“
const core = window.__TAURI__?.core;
const androidApp = !!core && /Android/i.test(navigator.userAgent);
const web = /^https?:$/.test(location.protocol) && location.hostname !== 'tauri.localhost';
const base = () => {
  if (web) return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html`;
  // Desktop-App: tauri://localhost kann niemand öffnen
  if (!PUBLIC_URL) throw new Error('Teilen geht in der Desktop-App erst mit PUBLIC_URL in core/config.js');
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

/** Wegpunkte [{ label, point }] und Profil → Link */
export async function routeUrl({ profile, waypoints }) {
  const w = waypoints.filter((x) => x.point).map((x) => [r5(x.point[0]), r5(x.point[1]), x.me ? '' : x.label ?? '']);
  return `${base()}?route=${await packJson({ p: profile, w })}`;
}

export async function readRoute(code) {
  const o = await unpackJson(code);
  return { profile: o.p, waypoints: (o.w ?? []).map(([lon, lat, label]) => ({ label: label || 'Geteilter Punkt', point: [lon, lat], me: false })) };
}

export const requestUrl = (name) => `${base()}?anfrage=${encodeURIComponent(name)}`;

/**
 * Teilen-Dialog: Teilen-Menü des Geräts, Text mit Link kopieren oder nur den
 * Link kopieren. `url` darf eine Funktion sein (auch async) – Fehler dabei
 * landen als Hinweis. `short` (async → Adresse): Ist der Link lang, gibt es dazu
 * „Kurzen Link erstellen“ (data/short-link.js – der Inhalt liegt dann 30 Tage
 * auf dem Server). → 'shared' | 'copied' | null
 */
export async function share({ title, text = '', url: make, short = null, note = '' }, toast) {
  let url;
  try { url = typeof make === 'function' ? await make() : make; } catch (err) { toast?.(err.message); return null; }
  const full = text ? `${text}\n${url}` : url;
  const system = androidApp || !!navigator.share;
  const choice = await ask({
    icon: 'share', title, className: 'stacked',
    html: `<div class="share-preview">${text ? `<p>${esc(text)}</p>` : ''}<span class="share-url">${esc(url)}</span></div>${note ? `<p class="muted share-note">${esc(note)}</p>` : ''}`,
    buttons: [
      ...(system ? [{ value: 'share', label: 'Teilen …', icon: 'share', primary: true }] : []),
      ...(text ? [{ value: 'text', label: 'Text mit Link kopieren', icon: 'content_copy', primary: !system }] : []),
      { value: 'link', label: 'Nur Link kopieren', icon: 'link', primary: !system && !text },
      ...(short && url.length > SHORT_FROM ? [{ value: 'short', label: 'Kurzen Link erstellen', icon: 'compress' }] : []),
      { value: 'no', label: 'Abbrechen' },
    ],
  });
  if (choice === 'short') {
    let small;
    try { small = await short(); } catch (err) { toast?.(err.message || 'Der kurze Link ließ sich nicht anlegen'); return share({ title, text, url }, toast); }
    return share({ title, text, url: small, note: 'Kurzer Link: Die Tour liegt dafür 30 Tage auf dem WMap-Server – danach geht der Link nicht mehr.' }, toast);
  }
  if (choice === 'share') {
    try {
      if (androidApp) await core.invoke('plugin:browser|share', { title, text: full });
      else await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return null;             // selbst abgebrochen
      return copy(full, 'Text mit Link kopiert', title, toast);
    }
  }
  if (choice === 'text') return copy(full, 'Text mit Link kopiert', title, toast);
  if (choice === 'link') return copy(url, 'Link kopiert', title, toast);
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
    toast?.(`${done} – jetzt einfügen und senden`);
  } catch {
    await ask({ icon: 'content_copy', title, text: 'Kopieren ging nicht – bitte selbst markieren und kopieren:',
      html: `<textarea class="share-link" readonly rows="${Math.min(6, value.split('\n').length + 2)}" onfocus="this.select()">${esc(value)}</textarea>`,
      buttons: [{ value: 'ok', label: 'Fertig', primary: true }] });
  }
  return 'copied';
}

/** Eigener Name für Anfragen – einmal fragen, dann merken. */
export async function myName() {
  const known = local.get(NAME_KEY);
  if (known) return known;
  const v = await ask({
    icon: 'badge', title: 'Wie heißt du?',
    text: 'Der Name steht in der Anfrage, damit man weiß, wer fragt. Er bleibt auf diesem Gerät.',
    html: '<input class="share-name" type="text" maxlength="40" autocomplete="given-name" placeholder="Vorname">',
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: 'Weiter', primary: true }],
    read: (dlg) => dlg.querySelector('.share-name').value.trim(),
  });
  if (!v || v === 'no') return null;
  local.set(NAME_KEY, v);
  return v;
}

export const clock = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
