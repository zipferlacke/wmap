/**
 * Höhenprofil mit dem Diagramm aus wuefl-libs.
 *
 * Ohne Kachel, grüne Fläche mit Verlauf, Kilometer als X-Achse. Oben stehen
 * die Höhenmeter als Chips hinter einem Berg-Icon. Fährt der Zeiger über das
 * Profil, meldet `onHover` die Stelle in Kilometern – die Karte markiert sie.
 *
 * Mit `showMetric` zeigt dasselbe Diagramm andere Werte über die Strecke:
 * Tempo, Puls, Frequenz, Leistung eines Wegs (pages/wege.js), mit `showMany`
 * mehrere davon übereinander – jede Reihe mit eigener Skala.
 *
 * Der Knopf rechts im Kopf öffnet das Diagramm im Vollbild (Diagramm der
 * Bibliothek: derselbe Knoten wandert in einen <dialog>). Dort lässt es sich
 * zoomen (Mausrad, zwei Finger), im Blatt nicht.
 */
import * as echarts from '../../libs/echarts/echarts.esm.min.js';
import { Diagramm, setIcons } from '../../libs/wuefl-libs/diagramm/diagramm.js';
import { echartsRenderer } from '../../libs/wuefl-libs/diagramm/renderer-echarts.js';

setIcons('default-msr');

const GREEN = 'light-dark(hsl(142 62% 36%), hsl(142 55% 52%))';
const MAX_POINTS = 600;

/** Für die Anzeige ausdünnen – mehr Punkte als Pixel bringen nichts. */
/** Wert einer Reihe [[x, y] …] (nach x sortiert) an der Stelle x – zwischen zwei Punkten gerechnet; außerhalb null */
function valueAt(points, x) {
  if (!points?.length || x < points[0][0] || x > points.at(-1)[0]) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][0] <= x) lo = mid; else hi = mid; }
  const [x0, y0] = points[lo], [x1, y1] = points[hi];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

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
  #diagram; #points = []; #host; #around;
  #xLabels = null;                 // showSeries mit x.labels: Beschriftung je ganzer Zahl (1, 2, 3 …)
  #emph = null;                    // emphasize: { focus, hover } – Reihe kräftig bzw. hervorgehoben, der Rest blass
  #mark = null;                    // showSeries mit x.mark: { x, color } – dieser Punkt der ersten Reihe groß
  #groups = null;                  // showCompare: je Reihe ihr Training – Hervorheben gilt dem ganzen Training
  #tip = null;                     // showCompare mit tip: eigener, kompakter Tooltip (#compareTip)

  /**
   * `around`: Element(e) neben dem Diagramm, die der Tooltip außerhalb mit frei lässt (Funktion oder Element) –
   * ohne Angabe nur das Diagramm; die Umschalter darüber (Tempo, Puls …) darf er verdecken
   */
  constructor(host, { onHover, around = null } = {}) {
    this.#host = host;
    this.#around = around;
    // Mehrere Reihen: jede hat ihre eigene Achse. Die Bibliothek stellt die erste links, die zweite rechts und
    // jede weitere wieder links darüber – die ab der dritten bleiben unsichtbar (Werte im Tooltip); die
    // Beschriftung der Achse in der Farbe ihrer Reihe
    const renderer = echartsRenderer(echarts, { renderer: 'svg' });
    const draw = renderer.draw.bind(renderer);
    renderer.draw = (griff, option) => {
      if (Array.isArray(option?.yAxis) && option.yAxis.length > 1) {
        option.yAxis = option.yAxis.map((ax, i) => {
          const color = option.series?.find((x) => x.yAxisIndex === i)?.itemStyle?.color;
          // Unsichtbar ganz ohne Beschriftung und Namen – sonst hält ECharts (containLabel) links Platz dafür frei
          return i > 1 ? { ...ax, show: false, name: '', axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            : { ...ax, axisLabel: { ...ax.axisLabel, color }, nameTextStyle: { ...ax.nameTextStyle, color } };
        });
      }
      // Je Training eine Stelle (Entwicklung): nur ganze Zahlen, beschriftet mit dem Namen des Punkts
      const labels = this.#xLabels;
      if (labels && Array.isArray(option?.xAxis)) {
        option.xAxis = option.xAxis.map((ax) => ({ ...ax, interval: 1, axisLabel: { ...ax.axisLabel, formatter: (v) => labels[v - 1] ?? '' } }));
      }
      const mark = this.#mark, first = option?.series?.[0];
      if (mark && first) {
        const hit = (first.data ?? []).find((d) => (Array.isArray(d) ? d[0] : d?.value?.[0]) === mark.x);
        const y = Array.isArray(hit) ? hit[1] : hit?.value?.[1];
        if (y != null) {
          option.series = [{ ...first, markPoint: { symbol: 'circle', symbolSize: 14, label: { show: false }, silent: true,
            itemStyle: { color: mark.color, borderColor: '#fff', borderWidth: 2 }, data: [{ coord: [mark.x, y] }] } }, ...option.series.slice(1)];
        }
      }
      if (this.#tip && option?.tooltip) option.tooltip = { ...option.tooltip, formatter: (params) => this.#compareTip(params) };
      if (this.#emph && Array.isArray(option?.series)) {
        const st = this.#emphStyles(option.series.length);
        option.series = option.series.map((x, i) => ({ ...x, z: st[i].z, lineStyle: { ...x.lineStyle, ...st[i].lineStyle } }));
      }
      return draw(griff, option);
    };
    this.#diagram = new Diagramm(host, { renderer });
    this.#on('updateAxisPointer', (e) => {
      const km = e.axesInfo?.[0]?.value;
      onHover?.(Number.isFinite(km) ? km : null);
    });
    this.#on('globalout', () => onHover?.(null));
    // Thema in WMap umgestellt (Einstellung, nicht das System): das Diagramm kennt nur feste Farben – neu zeichnen
    addEventListener('wmap:theme', () => { if (this.#points.length) this.#diagram.refresh(); });
    // Zurück (Taste am Handy, Browser) schließt das Vollbild, statt es über der nächsten Ansicht stehen zu lassen
    addEventListener('popstate', () => { if (this.#diagram.fullscreen) this.#diagram.toggleFullscreen(false); });
  }

  /**
   * Zeicheninstanz. Ab wuefl-libs 2.5.6 gibt das Diagramm sie heraus; bei
   * älteren Ständen holen wir sie direkt bei ECharts ab.
   */
  #chart() {
    return this.#diagram.instance ?? echarts.getInstanceByDom(this.#host.querySelector('.dg_canvas'));
  }

  /** Läuft das Diagramm gerade im Vollbild? */
  get fullscreen() { return !!this.#diagram.fullscreen; }

  /**
   * Neue Reihe setzen – auch im Vollbild (pages/wege.js schaltet dort zwischen Höhe, Tempo, Puls … um).
   * `mark`: Symbol der Reihe (Berg, Herz …) vor allen Chips. Der Kopf wird nur in setConfig() neu gebaut, die
   * Chips danach an Ort und Stelle befüllt – ein vorangestelltes Element überlebt also jedes Nachladen.
   */
  #config(cfg, mark) {
    // Zoomen nur im Vollbild – im Blatt nähme es dem Finger das Scrollen
    // Tooltip außerhalb (über/unter dem Diagramm, sonst daneben) – Kurve und Werte zugleich sichtbar
    this.#diagram.setConfig({ ...cfg, zoom: 'fullscreen', tooltip_outside: true, tooltip_around: this.#around });
    const el = Object.assign(document.createElement('span'), { className: 'msr elev-mountain', textContent: mark.icon, title: mark.title });
    if (mark.color) el.style.color = mark.color;
    this.#host.querySelector('.dg_tools')?.prepend(el);
  }

  #on(name, cb) {
    if (typeof this.#diagram.on === 'function') this.#diagram.on(name, cb);
    else this.#chart()?.on(name, cb);
  }

  /** Route anzeigen; ohne Höhendaten verschwindet das Profil. */
  show(route) {
    this.#xLabels = null;
    this.#mark = null;
    this.#emph = null;
    this.#groups = null;
    this.#host.hidden = !route?.elevation?.length;
    if (this.#host.hidden) return;
    this.#points = thin(route.elevation);
    const { min, max } = axisRange(route.minEle, route.maxEle);
    const chip = (icon, value, title) => ({
      value, unit: 'm', decimals: 0, color: GREEN,
      label: `<span class="msr" title="${title}">${icon}</span>`,
    });

    this.#config({
      card: false,
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
    }, { icon: 'landscape', title: 'Höhenmeter' });
  }

  /**
   * Andere Messreihe über die Strecke.
   * @param m { name, unit, icon, color, points: [[km, wert]], length (m), decimals?, chips: [[icon, wert, titel]] }
   */
  showMetric({ name, unit, icon, color, points, length, decimals = 0, chips = [] }) {
    this.#xLabels = null;
    this.#mark = null;
    this.#emph = null;
    this.#groups = null;
    this.#host.hidden = !points?.length;
    if (this.#host.hidden) return;
    this.#points = thin(points);
    const vals = this.#points.map(([, v]) => v);
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
    this.#config({
      card: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: 'km', decimals: length < 5000 ? 1 : 0 },
      y_axes: [{ unit, min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad), split_number: 3 }],
      chips: chips.map(([ic, value, title]) => ({
        value, unit, decimals, color, label: `<span class="msr" title="${title}">${ic}</span>`,
      })),
      series: [{ key: name, name, data: this.#points, color, fill: 'gradient', smooth: true, decimals, unit }],
    }, { icon, title: name, color });
  }

  /**
   * Mehrere Reihen über dieselbe Strecke, jede mit eigener Skala (Höhe + Puls, Tempo + Leistung …).
   * @param list [{ name, unit, icon, color, points: [[km, wert]], decimals?, mean? }]
   * @param length Strecke (m)
   */
  showMany(list, length) {
    this.#xLabels = null;
    this.#mark = null;
    this.#emph = null;
    this.#groups = null;
    list = list.filter((m) => m.points?.length);
    if (list.length < 2) { if (list[0]) this.showMetric({ ...list[0], length }); else this.#host.hidden = true; return; }
    this.#host.hidden = false;
    const series = list.map((m) => ({ ...m, points: thin(m.points) }));
    this.#points = series[0].points;
    const range = ({ points }) => {
      const vals = points.map(([, v]) => v);
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
      return { min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad) };
    };
    this.#config({
      card: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: 'km', decimals: length < 5000 ? 1 : 0 },
      y_axes: series.map((m) => ({ unit: m.unit, ...range(m), split_number: 3 })),
      // Je Reihe der Durchschnitt in ihrer Farbe
      chips: series.filter((m) => m.mean != null).map((m) => ({
        value: m.mean, unit: m.unit, decimals: m.decimals ?? 0, color: m.color,
        label: `<span class="msr" title="Ø ${m.name}">${m.icon}</span>`,
      })),
      series: series.map((m, i) => ({
        key: m.name, name: m.name, data: m.points, color: m.color, y_axis: i,
        // Nur die erste als Fläche – sonst deckt eine die andere zu
        ...(i === 0 ? { fill: 'gradient' } : {}), smooth: m.smooth ?? true, decimals: m.decimals ?? 0, unit: m.unit,
      })),
    }, { icon: 'stacked_line_chart', title: list.map((m) => m.name).join(' + ') });
  }

  /**
   * Mehrere Reihen auf einer gemeinsamen Skala (Vergleich: dasselbe Maß verschiedener Trainings).
   * @param o { unit, decimals?, icon, title, x: { unit, decimals?, labels? }, series: [{ name, color, points: [[x, wert]] }],
   *            smooth? } – `x.labels`: x sind die Zahlen 1, 2, 3 … mit diesen Namen an der Achse; `x.mark`:
   *            { x, color } – dieser Punkt der ersten Reihe groß (der aktuelle Lauf in der Entwicklung)
   */
  showSeries({ unit, decimals = 0, icon, title, x = { unit: 'km' }, series, smooth = true }) {
    this.#xLabels = x.labels ?? null;
    this.#mark = x.mark ?? null;
    this.#emph = null;
    this.#groups = null;
    const list = series.filter((m) => m.points?.length);
    this.#host.hidden = !list.length;
    if (!list.length) return;
    const thinned = list.map((m) => ({ ...m, points: thin(m.points) }));
    this.#points = thinned[0].points;
    const vals = thinned.flatMap((m) => m.points.map(([, v]) => v));
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
    this.#config({
      card: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: x.unit, decimals: x.decimals ?? 1 },
      y_axes: [{ unit, min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad), split_number: 3 }],
      chips: [],
      series: thinned.map((m, i) => ({ key: `r${i}`, name: m.name, data: m.points, color: m.color, smooth, decimals, unit })),
    }, { icon, title });
  }

  /**
   * Vergleich in einem Diagramm: mehrere Größen (Tempo, Puls …) mehrerer Trainings. Die Farbe gehört der Größe
   * (alle Pulse rot …), jede Größe hat ihre Skala; welches Training kräftig ist, sagt emphasize() (Index des
   * Trainings, nicht der Reihe).
   * @param o { kinds: [{ name, unit, color, decimals? }], series: [{ name, kind (Index), group (Training), points }],
   *            length (m), icon, title }
   */
  showCompare({ kinds, series, length, icon, title, tip = null }) {
    this.#xLabels = null;
    this.#mark = null;
    this.#tip = null;
    const list = series.filter((m) => m.points?.length);
    this.#host.hidden = !list.length;
    if (!list.length) return;
    const thinned = list.map((m) => ({ ...m, points: thin(m.points) }));
    this.#points = thinned[0].points;
    this.#groups = thinned.map((m) => m.group);
    const used = [...new Set(thinned.map((m) => m.kind))];
    if (tip) this.#tip = { ...tip, kinds, used, byName: new Map(thinned.map((m) => [m.name, m])) };
    const range = (k) => {
      const vals = thinned.filter((m) => m.kind === k).flatMap((m) => m.points.map(([, v]) => v));
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
      return { min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad) };
    };
    this.#config({
      card: false,
      legend: { hidden: true },
      x_axis: { type: 'value', unit: 'km', decimals: length < 5000 ? 1 : 0 },
      y_axes: used.map((k) => ({ unit: kinds[k].unit, ...range(k), split_number: 3 })),
      chips: [],
      series: thinned.map((m, i) => {
        const k = kinds[m.kind];
        return { key: `r${i}`, name: m.name, data: m.points, color: k.color, y_axis: used.indexOf(m.kind), smooth: true, decimals: k.decimals ?? 0, unit: k.unit };
      }),
    }, { icon, title });
  }

  /**
   * Tooltip im Vergleich: je Größe eine Zeile – vorn groß der Wert des aktuellen Trainings, dahinter die gewählten
   * anderen mit ihrem Datum (grau, die Werte schwarz), umbrechend („1.9. 11,2 · 15.9. 11,5 · 29.9. ▲ 12,0“). Welche, sagt `tip.groups`
   * (pages/wege-compare.js: die letzten vier, das beste, das schlechteste); ▲ bestes, ▼ schlechtestes.
   */
  #compareTip(params) {
    const { kinds, used, byName, focus, groups, label, best, worst } = this.#tip;
    const list = [params].flat();
    const x = Array.isArray(list[0]?.value) ? list[0].value[0] : null;
    // ECharts gibt nur die Reihen mit einem Punkt genau hier – die Werte darum selbst ablesen (zwischen zwei Punkten)
    const val = new Map();                   // "Größe:Training" → Wert
    for (const m of Number.isFinite(x) ? byName.values() : []) {
      const v = valueAt(m.points, x);
      if (v != null) val.set(`${m.kind}:${m.group}`, v);
    }
    const num = (v, k) => v.toLocaleString('de-DE', { minimumFractionDigits: k.decimals ?? 0, maximumFractionDigits: k.decimals ?? 0 });
    const tag = (g) => `<i>${label(g)}</i>${g === best ? '▲' : g === worst ? '▼' : ''}`;
    const rows = used.map((ki) => {
      const k = kinds[ki], own = val.get(`${ki}:${focus}`);
      const others = groups.filter((g) => g !== focus && val.has(`${ki}:${g}`))
        .map((g) => `<span>${tag(g)} ${num(val.get(`${ki}:${g}`), k)}</span>`).join('');
      if (own == null && !others) return '';
      return `<div class="cmp-tip-row"><span class="cmp-tip-kind" style="color:${k.color}">${k.name}</span>
        ${own != null ? `<b>${tag(focus)} ${num(own, k)} <small>${k.unit}</small></b>` : ''}<span class="cmp-tip-others">${others}</span></div>`;
    }).join('');
    const km = Number.isFinite(x) ? `${x.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` : '';
    return `<div class="cmp-tip"><strong>${km}</strong>${rows}</div>`;
  }

  /**
   * Vergleich: Reihe `focus` kräftig, die anderen blass; `hover` (Index oder null) dazu hervorgehoben. Gilt bis zur
   * nächsten anderen Darstellung (show, showMetric, showMany) – auch nach einem Neuzeichnen.
   */
  emphasize(focus, hover = null) {
    this.#emph = { focus, hover };
    const chart = this.#chart();
    const n = chart?.getOption?.()?.series?.length;
    if (n) chart.setOption({ series: this.#emphStyles(n) });
  }

  #emphStyles(n) {
    const { focus, hover } = this.#emph;
    return Array.from({ length: n }, (_, s) => {
      const i = this.#groups ? this.#groups[s] : s;
      return {
        z: i === hover ? 5 : i === focus ? 4 : 2,
        lineStyle: { width: i === focus ? 3 : i === hover ? 2.5 : 1.2, opacity: i === focus || i === hover ? 1 : 0.3 },
      };
    });
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
