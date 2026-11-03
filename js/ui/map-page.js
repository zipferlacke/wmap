/**
 * Kartenseiten mit Panel (Meine Touren, Entdecken): Karte über den ganzen
 * Bildschirm, daneben das Panel als Seitenleiste (ui/side-panel.js – userDialog
 * aus wuefl-libs) – am Rechner links in voller Höhe, am Handy von unten.
 *
 *   ←  oben links   Liste: zurück zur Übersicht (Dashboard)
 *                   Detail: zurück zur Liste
 *   ✕  oben rechts  Schließen – zurück zur Karte
 *   Ebenen          Knopf oben rechts wie auf der Hauptkarte (Satellit …)
 *   Griff           über die ganze Kante: ziehen ändert die Größe, weiter
 *                   als das Minimum klappt ein; antippen klappt ein/aus
 *
 * Esc wirkt wie ←, aber nie bis zur Übersicht – aus der Liste klappt Esc das
 * Panel nur ein.
 */
import { sidePanel } from './side-panel.js';
import { mountLayerMenu } from './layer-menu.js';
import { t } from '../core/i18n.js';

const HOME = './dashboard.html';
const MAP = './index.html';

export const mobile = () => matchMedia('(max-width: 700px)').matches;

/**
 * @param src  Element der Seite mit dem Inhalt des Panels (zieht in den Dialog um)
 * → { panel (der Dialog), header(), pressBack(), open(), collapse(), padding(), map }
 */
export function mapPage(src, { map, title = '', onFit = () => {}, key = 'wmap.panel' } = {}) {
  let backTo = null;                 // Detail: wohin ← führt; null: Liste

  // Für die Konsole und Tests, wie auf der Hauptkarte
  window.__wmap = { map };
  // Ebenen wie auf der Hauptkarte: Satellit, Wanderwege, Plugins
  mountLayerMenu(map, { toast: (text) => { const el = document.querySelector('#toast'); if (el) el.textContent = text; } });

  // Nach dem Ziehen den Kartenausschnitt an den freien Platz anpassen
  let fitTimer = null;
  const side = sidePanel(src, {
    title, label: title, key,
    barLeft: { icon: '<span class="msr">arrow_back</span>', title: t('map_page.back_dashboard'), onClick: () => { if (backTo) backTo(); else location.href = HOME; } },
    barRight: { icon: '<span class="msr">close</span>', title: t('map_page.close_to_map'), onClick: () => { location.href = MAP; } },
    onChange: () => { clearTimeout(fitTimer); fitTimer = setTimeout(onFit, 280); },
    onEsc: () => { if (backTo) backTo(); else side.collapse(true); },
  });
  const panel = side.dialog;
  const back = side.left.querySelector('button');

  return {
    /**
     * Kopfzeile: Titel und – für eine Detailansicht – wohin ← führt. `icon`/`color`: Symbol vor dem Titel;
     * `onRename(name)`: der Titel ist ein Eingabefeld (Enter oder Verlassen speichert)
     */
    header(text, onBack = null, { icon = null, color = null, onRename = null, placeholder = t('map_page.name') } = {}) {
      const parts = [];
      if (icon) {
        const el = Object.assign(document.createElement('span'), { className: 'msr panel-title-icon', textContent: icon });
        if (color) el.style.color = color;
        parts.push(el);
      }
      if (onRename) {
        const input = Object.assign(document.createElement('input'), { type: 'text', className: 'panel-title-input', value: text, placeholder });
        input.setAttribute('aria-label', placeholder);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = text; input.blur(); e.stopPropagation(); } });
        input.addEventListener('change', () => { const v = input.value.trim(); if (v !== text) { text = v; onRename(v); } });
        parts.push(input);
      } else parts.push(document.createTextNode(text));
      side.title.replaceChildren(...parts);
      side.title.classList.toggle('panel-title-edit', !!(icon || onRename));
      backTo = onBack;
      back.title = onBack ? t('map_page.back_list') : t('map_page.back_dashboard');
      panel.classList.toggle('detail', !!onBack);
    },
    get detail() { return !!backTo; },
    /** Zurück-Taste (core/back.js trapBack): ← der Detailansicht drücken → ob es einen gab */
    pressBack() { if (!backTo) return false; backTo(); return true; },
    open() { if (side.collapsed) side.collapse(false); },
    collapse: (on) => side.collapse(on),
    /** Freier Kartenausschnitt neben bzw. über dem Panel */
    padding() {
      const r = panel.open && !side.collapsed ? panel.getBoundingClientRect() : null;
      if (!r) return { top: 60, bottom: mobile() ? 60 : 30, left: mobile() ? 20 : 50, right: 60 };
      return mobile() ? { top: 60, bottom: r.height + 20, left: 20, right: 20 } : { top: 40, bottom: 40, left: r.width + 40, right: 60 };
    },
    /** Der Dialog selbst */
    panel,
    map,
  };
}
