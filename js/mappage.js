/**
 * Kartenseiten mit Panel (Meine Touren, Entdecken): Karte über den ganzen
 * Bildschirm, daneben das Panel als Seitenleiste zum Ziehen (wuefl-libs
 * userDialog `sheet`) – am Rechner links in voller Höhe, am Handy von unten.
 *
 *   ←  oben links   Liste: zurück zur Übersicht (Dashboard)
 *                   Detail: zurück zur Liste
 *   ✕  oben rechts  Schließen – zurück zur Karte
 *   Griff           über die ganze Kante: ziehen ändert die Größe, weiter
 *                   als das Minimum klappt ein; antippen klappt ein/aus
 *
 * Esc wirkt wie ←, aber nie bis zur Übersicht – aus der Liste klappt Esc das
 * Panel nur ein.
 */
import { sheet } from '../libs/wuefl-libs/userDialog/userDialog.js';

const HOME = './dashboard.html';
const MAP = './index.html';

export const mobile = () => matchMedia('(max-width: 700px)').matches;

export function mapPage(panel, { map, onFit = () => {}, key = 'wmap.panel' } = {}) {
  const bar = panel.querySelector('.wege-bar');
  const title = bar.querySelector('.uD-title');
  const back = bar.querySelector('[data-act="back"]');
  let backTo = null;                 // Detail: wohin ← führt; null: Liste

  // Für die Konsole und Tests, wie auf der Hauptkarte
  window.__wmap = { map };

  // Nach dem Ziehen den Kartenausschnitt an den freien Platz anpassen
  let fitTimer = null;
  const side = sheet(panel, {
    min: 300, key,
    onChange: () => { clearTimeout(fitTimer); fitTimer = setTimeout(onFit, 280); },
  });

  panel.addEventListener('click', (e) => {
    const act = e.target.closest('.wege-bar [data-act]')?.dataset.act;
    if (act === 'back') { if (backTo) backTo(); else location.href = HOME; }
    if (act === 'close') location.href = MAP;
  });
  panel.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (backTo) backTo(); else side.collapse(true);
  });
  back.hidden = false;

  return {
    /** Kopfzeile: Titel und – für eine Detailansicht – wohin ← führt */
    header(text, onBack = null) {
      title.textContent = text;
      backTo = onBack;
      back.title = onBack ? 'Zurück zur Liste' : 'Zurück zur Übersicht';
      panel.classList.toggle('detail', !!onBack);
    },
    get detail() { return !!backTo; },
    open() {
      if (!panel.open) panel.show();
      if (side.collapsed) side.collapse(false);
    },
    collapse: (on) => side.collapse(on),
    /** Freier Kartenausschnitt neben bzw. über dem Panel */
    padding() {
      const r = panel.open && !side.collapsed ? panel.getBoundingClientRect() : null;
      if (!r) return { top: 60, bottom: mobile() ? 60 : 30, left: mobile() ? 20 : 50, right: 60 };
      return mobile() ? { top: 60, bottom: r.height + 20, left: 20, right: 20 } : { top: 40, bottom: 40, left: r.width + 40, right: 60 };
    },
    map,
  };
}
