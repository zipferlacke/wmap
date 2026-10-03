/**
 * Seitenleiste neben der Karte (Meine Touren, Entdecken, Tour planen): der `userDialog` aus wuefl-libs –
 * am Rechner links in voller Höhe, am Handy von unten, die Karte dahinter bleibt bedienbar
 * (`position: { wide: 'left', small: 'bottom' }`, `backgroundUsage`). Leiste oben, Griff, Ziehen und
 * Einklappen bringt die Bibliothek mit.
 *
 * Der Inhalt steht im HTML der Seite (`src`) und zieht in den Dialog um – **hinter** dessen Formular, nicht
 * hinein: Die Seiten haben eigene Formulare (Suche, Bewertung …), und verschachtelt gingen die verloren.
 *
 * Was die Bibliothek (noch) nicht anbietet und hier über ihren Griff läuft:
 *   - Startgröße: am Handy 58 % der Höhe – größer ziehen bleibt möglich. Ohne das wäre die Leiste so hoch
 *     wie beim Öffnen und ließe sich nur kleiner ziehen.
 *   - Größe und „eingeklappt“ merken (`key`, derselbe Speicher wie bisher)
 *   - `collapse(on)` aus dem Programm
 * Der Griff nimmt Zeiger- und Tastenereignisse auch aus einem Skript an – damit wird gezogen und geklappt.
 */
import { userDialog } from '../../libs/wuefl-libs/userDialog/userDialog.js';

/** Starthöhe am Handy als Anteil der Fensterhöhe */
const START = 0.58;

/**
 * @param src            Element mit dem Inhalt (wird geleert und entfernt)
 * @param o.id           ID des Dialogs
 * @param o.label        aria-label
 * @param o.title        Titel (HTML) – leer, wenn die Seite dort ein eigenes Feld einsetzt
 * @param o.className    weitere Klassen am Dialog
 * @param o.barLeft, o.barRight   Knöpfe oben, wie bei userDialog
 * @param o.key          Größe und „eingeklappt“ unter diesem Namen merken
 * @param o.onChange     ({ collapsed, size }) nach Ziehen und Klappen – z. B. Karte neu einpassen
 * @param o.onEsc        Esc (der Dialog bleibt offen)
 * @returns {{ dialog, title, left, right, collapse(on), readonly collapsed, readonly size }}
 */
export function sidePanel(src, { id = 'panel', label = '', title = '', className = '', barLeft = null, barRight = null, key = null, onChange = () => {}, onEsc = null } = {}) {
  let dlg = null;
  userDialog({
    id, title, position: { wide: 'left', small: 'bottom' }, backgroundUsage: true, barLeft, barRight,
    onInsert() {
      dlg = document.getElementById(id);
      dlg.classList.add('wege-panel', ...className.split(/\s+/).filter(Boolean));
      if (label) dlg.setAttribute('aria-label', label);
      dlg.querySelector('.uD-header').classList.add('wege-bar');
      dlg.append(...src.childNodes);
      src.remove();
      // Vor den Listenern der Bibliothek: Die Leiste bleibt stehen – Enter in einem Feld der Kopfzeile und Esc
      // schlössen sie sonst (und nähmen sie aus dem Dokument)
      dlg.querySelector('.uD-form').addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); e.stopImmediatePropagation(); onEsc?.(); });
    },
  });

  const grip = dlg.querySelector('.uD-grip');
  // show() legt den Fokus auf den Griff – ohne Tastatur stünde er gleich hervorgehoben da
  if (document.activeElement === grip) grip.blur();
  const small = matchMedia('(max-width: 700px)');
  const vertical = () => small.matches;
  const collapsed = () => dlg.hasAttribute('data-collapsed');
  const size = () => (vertical() ? dlg.offsetHeight : dlg.offsetWidth);

  /** Auf eine Größe ziehen, wie mit dem Finger am Griff */
  const dragTo = (to) => {
    const now = size();
    if (!Number.isFinite(to) || Math.abs(to - now) < 6) return;
    const at = (s) => (vertical() ? { clientX: innerWidth / 2, clientY: innerHeight - s } : { clientX: s, clientY: innerHeight / 2 });
    for (const [type, s] of [['pointerdown', now], ['pointermove', to], ['pointerup', to]]) {
      grip.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, isPrimary: true, ...at(s) }));
    }
  };
  const collapse = (on) => {
    if (collapsed() !== !!on) grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  // Gemerkt wird je Lage: h = Breite am Rechner, v = Höhe am Handy
  const store = key ? `uD-sheet:${key}` : null;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(store)) ?? {}; } catch { return {}; } })();
  const start = () => {
    const s = saved[vertical() ? 'v' : 'h'];
    if (s) dragTo(s);
    else if (vertical()) dragTo(Math.round(innerHeight * START));
    if (saved.collapsed) collapse(true);
  };
  start();
  // Drehen oder Fenster schmaler: Die Bibliothek fängt in der neuen Lage ohne Größe an
  small.addEventListener('change', () => setTimeout(start));

  let ready = false;
  new MutationObserver(() => {
    if (!ready || dlg.hasAttribute('data-dragging')) return;
    const px = parseFloat(dlg.style.getPropertyValue('--uD-size'));
    if (Number.isFinite(px)) saved[vertical() ? 'v' : 'h'] = px;
    saved.collapsed = collapsed();
    if (store) try { localStorage.setItem(store, JSON.stringify(saved)); } catch { /* voll oder gesperrt */ }
    onChange({ collapsed: saved.collapsed, size: size() });
  }).observe(dlg, { attributes: true, attributeFilter: ['style', 'data-collapsed', 'data-dragging'] });
  setTimeout(() => { ready = true; });

  return {
    dialog: dlg,
    title: dlg.querySelector('.uD-title'),
    left: dlg.querySelector('.uD-bar-group-left'),
    right: dlg.querySelector('.uD-bar-group-right'),
    collapse,
    get collapsed() { return collapsed(); },
    get size() { return size(); },
  };
}
