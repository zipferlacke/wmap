/**
 * „Link öffnen“: einen geteilten WMap-Link in der App öffnen – Tour, Mitplanen, Aufzeichnung. In Meine Touren
 * (pages/wege.js) einfach in die Suche einfügen: darunter steht dann „Link öffnen“ (openLinkText).
 * In der App gehen solche Links nicht von selbst auf (sie öffnen den Browser); so muss man nicht erst dorthin.
 * Steht ein Link in der Zwischenablage, steht er gleich im Feld.
 *
 * Erkennen: core/map-links.js linkTarget
 */
import { ask, toast } from './dialogs.js';
import { linkTarget } from '../core/map-links.js';
import { settled } from '../core/back.js';

async function fromClipboard() {
  try {
    const text = await Promise.race([navigator.clipboard?.readText?.(), new Promise((ok) => setTimeout(ok, 1500))]);
    return linkTarget(text) ? text.trim() : '';
  } catch { return ''; }
}

export async function askOpenLink() {
  const clip = await fromClipboard();
  const v = await ask({
    icon: 'link', title: 'Link öffnen',
    text: 'Einen geteilten WMap-Link hier einfügen – Tour, gemeinsam planen oder Aufzeichnung.',
    html: `<input type="url" class="open-link-input" placeholder="https://…" value="${clip.replace(/"/g, '&quot;')}" aria-label="Link">`,
    read: (dlg) => dlg.querySelector('.open-link-input').value,
    buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'go', label: 'Öffnen', icon: 'open_in_new', primary: true }],
  });
  if (!v || v === 'no') return;
  await openLinkText(v);
}

/** Geteilten WMap-Link öffnen (auch aus der Suche in Meine Touren) – sonst ein Hinweis */
export async function openLinkText(v) {
  const to = linkTarget(v);
  if (!to) { toast('Das ist kein geteilter WMap-Link'); return; }
  // Der Dialog nimmt beim Schließen seinen Eintrag im Verlauf zurück (core/back.js) – erst danach wechseln,
  // sonst bricht dieses Zurück den Wechsel ab (in der App blieb man auf Meine Touren)
  await settled();
  // Dieselbe Seite: nur das # ändert sich – neu laden, damit sie den Link liest
  const same = new URL(to, location.href).pathname === location.pathname;
  location.href = to;
  if (same) location.reload();
}
