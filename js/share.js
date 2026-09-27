/**
 * Teilen per Link – ohne Server, alles steckt in der Adresse:
 *
 *   ?ort=lon,lat&name=…&zeit=…    ein Ort oder „hier bin ich“ (mit Uhrzeit)
 *   ?route=…                       Route mit Profil und Wegpunkten (gepackt)
 *   ?anfrage=Name                  „Name möchte wissen, wo du bist“ – wer den
 *                                  Link öffnet, schickt seinen Standort zurück
 *
 * Geteilt wird über das Teilen-Menü des Geräts; wo es das nicht gibt, landet
 * der Link in der Zwischenablage.
 */
import { packJson, unpackJson, local } from './store.js';
import { ask } from './ui.js';
import { esc } from './geo.js';
import { PUBLIC_URL } from './config.js';

const NAME_KEY = 'wmap.myname';
const web = /^https?:$/.test(location.protocol) && location.hostname !== 'tauri.localhost';
const base = () => {
  if (web) return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html`;
  // Desktop-App: tauri://localhost kann niemand öffnen
  if (!PUBLIC_URL) throw new Error('Teilen geht in der Desktop-App erst mit PUBLIC_URL in config.js');
  return `${PUBLIC_URL}index.html`;
};
const r5 = (v) => +v.toFixed(5);

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
 * Über das Teilen-Menü des Geräts, sonst Zwischenablage.
 * `url` darf eine Funktion sein (auch async) – Fehler dabei landen als Hinweis.
 * → 'shared' | 'copied' | null
 */
export async function share({ title, text, url: make }, toast) {
  let url;
  try { url = typeof make === 'function' ? await make() : make; } catch (err) { toast?.(err.message); return null; }
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (err) {
      if (err.name === 'AbortError') return null;             // selbst abgebrochen
    }
  }
  try {
    await navigator.clipboard.writeText(text ? `${text}\n${url}` : url);
    toast?.('Link kopiert – jetzt einfügen und senden');
    return 'copied';
  } catch {
    await ask({ icon: 'link', title, html: `<input class="share-link" type="text" readonly value="${esc(url)}" onfocus="this.select()">`,
      buttons: [{ value: 'ok', label: 'Fertig', primary: true }] });
    return 'copied';
  }
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
