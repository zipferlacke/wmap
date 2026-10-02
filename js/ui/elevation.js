/**
 * Höhenprofil mit dem Diagramm aus wuefl-libs.
 *
 * Ohne Kachel, grüne Fläche mit Verlauf, Kilometer als X-Achse. Oben stehen
 * die Höhenmeter als Chips hinter einem Berg-Icon. Fährt der Zeiger über das
 * Profil, meldet `onHover` die Stelle in Kilometern – die Karte markiert sie.
 *
 * Mit `showMetric` zeigt dasselbe Diagramm andere Werte über die Strecke:
 * Tempo, Puls, Frequenz, Leistung eines Wegs (pages/wege.js).
 */
import * as echarts from '../../libs/echarts/echarts.esm.min.js';
import { Diagramm, setIcons } from '../../libs/wuefl-libs/diagramm/diagramm.js';
import { echartsRenderer } from '../../libs/wuefl-libs/diagramm/renderer-echarts.js';

setIcons('default-msr');

const GREEN = 'light-dark(hsl(142 62% 36%), hsl(142 55% 52%))';
const MAX_POINTS = 600;

/** Für die Anzeige ausdünnen – mehr Punkte als Pixel bringen nichts. */
function thin(points) {
  if (points.length <= MAX_POINTS) return points;
  const step = points.length / MAX_POINTS;
  const out = [];
  for (let i = 0; i < MAX_POINTS; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Glatte Achsengrenzen, damit das Profil nicht am Rand klebt. */
function axisRange(min, max) {
  const span = Math.max(20, max - min);
  const step = span > 800 ? 200 : span > 300 ? 100 : span > 120 ? 50 : 20;
  return { min: Math.floor((min - span * 0.08) / step) * step, max: Math.ceil((max + span * 0.08) / step) * step };
}

export class ElevationProfile {
  #diagram; #points = []; #host;

  constructor(host, { onHover } = {}) {
    this.#host = host;
    this.#diagram = new Diagramm(host, { renderer: echartsRenderer(echarts, { renderer: 'svg' }) });
    this.#on('updateAxisPointer', (e) => {
      const km = e.axesInfo?.[0]?.value;
      onHover?.(Number.isFinite(km) ? km : null);
    });
    this.#on('globalout', () => onHover?.(null));
    // Thema in WMap umgestellt (Einstellung, nicht das System): das Diagramm kennt nur feste Farben – neu zeichnen
    addEventListener('wmap:theme', () => { if (this.#points.length) this.#diagram.refresh(); });
  }

  /**
   * Zeicheninstanz. Ab wuefl-libs 2.5.6 gibt das Diagramm sie heraus; bei
   * älteren Ständen holen wir sie direkt bei ECharts ab.
   */
  #chart() {
    return this.#diagram.instance ?? echarts.getInstanceByDom(this.#host.querySelector('.dg_canvas'));
  }

  #on(name, cb) {
    if (typeof this.#diagram.on === 'function') this.#diagram.on(name, cb);
    else this.#chart()?.on(name, cb);
  }

  /** Route anzeigen; ohne Höhendaten verschwindet das Profil. */
  show(route) {
    this.#host.hidden = !route?.elevation?.length;
    if (this.#host.hidden) return;
    this.#points = thin(route.elevation);
    const { min, max } = axisRange(route.minEle, route.maxEle);
    const chip = (icon, value, title) => ({
      value, unit: 'm', decimals: 0, color: GREEN,
      label: `<span class="msr" title="${title}">${icon}</span>`,
    });

    this.#diagram.setConfig({
      card: false,
      fullscreen: false,
      zoom: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: 'km', decimals: route.length < 5000 ? 1 : 0 },
      y_axes: [{ unit: 'm', min, max, split_number: 3 }],
      chips: [
        chip('north_east', route.ascent, 'Anstieg'),
        chip('south_east', route.descent, 'Abstieg'),
        chip('vertical_align_top', route.maxEle, 'Höchster Punkt'),
        chip('vertical_align_bottom', route.minEle, 'Tiefster Punkt'),
      ],
      series: [{
        key: 'hoehe', name: 'Höhe', data: this.#points,
        color: GREEN, fill: 'gradient', smooth: false, decimals: 0, unit: 'm',
      }],
    });
    // Das Berg-Icon steht vor allen Chips. Der Kopf wird nur in setConfig()
    // neu gebaut, die Chips danach an Ort und Stelle befüllt – ein
    // vorangestelltes Element überlebt also jedes Nachladen.
    const tools = this.#host.querySelector('.dg_tools');
    tools?.prepend(Object.assign(document.createElement('span'), {
      className: 'msr elev-mountain', textContent: 'landscape', title: 'Höhenmeter',
    }));
  }

  /**
   * Andere Messreihe über die Strecke.
   * @param m { name, unit, icon, color, points: [[km, wert]], length (m), decimals?, chips: [[icon, wert, titel]] }
   */
  showMetric({ name, unit, icon, color, points, length, decimals = 0, chips = [] }) {
    this.#host.hidden = !points?.length;
    if (this.#host.hidden) return;
    this.#points = thin(points);
    const vals = this.#points.map(([, v]) => v);
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
    this.#diagram.setConfig({
      card: false,
      fullscreen: false,
      zoom: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: 'km', decimals: length < 5000 ? 1 : 0 },
      y_axes: [{ unit, min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad), split_number: 3 }],
      chips: chips.map(([ic, value, title]) => ({
        value, unit, decimals, color, label: `<span class="msr" title="${title}">${ic}</span>`,
      })),
      series: [{ key: name, name, data: this.#points, color, fill: 'gradient', smooth: true, decimals, unit }],
    });
    const mark = Object.assign(document.createElement('span'), { className: 'msr elev-mountain', textContent: icon, title: name });
    mark.style.color = color;
    this.#host.querySelector('.dg_tools')?.prepend(mark);
  }

  /** Stelle von außen zeigen, z. B. wenn die Maus über der Route auf der Karte steht. */
  showAt(km) {
    const chart = this.#chart();
    if (!chart || !this.#points.length) return;
    if (km === null) { chart.dispatchAction({ type: 'hideTip' }); return; }
    let best = 0;
    for (let i = 1; i < this.#points.length; i += 1) {
      if (Math.abs(this.#points[i][0] - km) < Math.abs(this.#points[best][0] - km)) best = i;
    }
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: best });
  }
}
