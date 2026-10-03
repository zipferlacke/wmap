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

const HOME = './dashboard.html';
const MAP = './index.html';

export const mobile = () => matchMedia('(max-width: 700px)').matches;

/**
 * @param src  Element der Seite mit dem Inhalt des Panels (zieht in den Dialog um)
 * → { panel (der Dialog), header(), open(), collapse(), padding(), map }
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
    barLeft: { icon: '<span class="msr">arrow_back</span>', title: 'Zurück zur Übersicht', onClick: () => { if (backTo) backTo(); else location.href = HOME; } },
    barRight: { icon: '<span class="msr">close</span>', title: 'Schließen – zur Karte', onClick: () => { location.href = MAP; } },
    onChange: () => { clearTimeout(fitTimer); fitTimer = setTimeout(onFit, 280); },
    onEsc: () => { if (backTo) backTo(); else side.collapse(true); },
  });
  const panel = side.dialog;
  const back = side.left.querySelector('button');

  return {
    /** Kopfzeile: Titel und – für eine Detailansicht – wohin ← führt */
    header(text, onBack = null) {
      side.title.textContent = text;
      backTo = onBack;
      back.title = onBack ? 'Zurück zur Liste' : 'Zurück zur Übersicht';
      panel.classList.toggle('detail', !!onBack);
    },
    get detail() { return !!backTo; },
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
