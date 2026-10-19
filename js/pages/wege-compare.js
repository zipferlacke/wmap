/**
 * Trainings vergleichen (Meine Touren → Aufgezeichnet → „Vergleichen“, wege.html?compare=id,id,…; gleiche Strecke
 * vom aktuellen Weg aus: …&focus=id).
 *
 *   Kacheln     nur vom aktuellen aus: dieser Lauf zum vorigen, zu den letzten 5, zum Durchschnitt, zum besten
 *               bzw. schlechtesten der anderen (umschaltbar, gemerkt) – je Kachel der Wert und ± dazu: grün besser,
 *               rot schlechter (schneller, mehr Leistung, weniger Herzschläge je km; Puls und Zeit ohne Wertung –
 *               die Zeit nur auf gleicher Strecke)
 *   Tabelle     je Training Zeit, Strecke, Ø Tempo, max. Geschwindigkeit, Puls, Herzschläge je km, Frequenz,
 *               Leistung und die Veränderung (ohne aktuellen: vom ältesten zum neuesten; mit: zum vorigen Mal)
 *   Verlauf     Tempo, Puls, Frequenz, Leistung über die Strecke – alle Trainings übereinander, je Größe ein
 *               Diagramm; mehrere Größen zugleich wählbar
 *   Entwicklung Gesamtzeit (bzw. Ø Tempo, Puls …) je Training über die Tage, der aktuelle als großer Punkt
 *
 * Jedes Training hat seine Farbe (in der Liste, den Diagrammen und auf der Karte, pages/wege.js).
 *
 *   paintCompare(box, list, { focus, onHover, onSwitch })  list: Wege (ganz, nicht nur die Karteikarte), beliebig
 *                            sortiert; `focus`: gleiche Strecke vom aktuellen Weg aus (er kräftig, die anderen blass)
 *   compareColors(list)      → [{ t, color }] – nach Datum, das älteste zuerst
 */
import { ElevationProfile } from '../ui/elevation.js';
import { paceOf, cadName, sportIcon, sportOf } from '../data/track-look.js';
import { metrics } from '../data/track-stats.js';
import { local } from '../data/store.js';
import { fmtDistance, fmtDuration, esc } from '../core/geo.js';

const COLORS = ['#1a73e8', '#e8590c', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e64980', '#5c940d'];
const DAY = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: '2-digit' });
const SHORT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const moving = (t) => t.moving || (t.end - t.start) / 1000;
const values = (a) => (a ?? []).filter((x) => x > 0);
const mean = (a) => { const v = values(a); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const most = (a) => { const v = values(a); return v.length ? Math.max(...v) : null; };
const num = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = (sec) => {
  const s = Math.round(Math.abs(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export function compareColors(list) {
  return [...list].sort((a, b) => a.start - b.start).map((t, i) => ({ t, color: COLORS[i % COLORS.length] }));
}

/** Kennzahlen eines Trainings – null, wo es nichts gibt */
function figures(t) {
  const mv = moving(t), hr = mean(t.hr);
  return {
    time: mv, dist: t.length, speed: mv ? t.length / mv : null, top: t.top > 0 ? t.top : null,
    hr, hrMax: most(t.hr), cad: mean(t.cad), pow: mean(t.pow),
    // Herzschläge je Kilometer: gleich schnell mit weniger Schlägen – das Herz arbeitet leichter
    beats: hr && t.length > 100 ? (hr * mv) / 60 / (t.length / 1000) : null,
  };
}

/**
 * Zeilen der Tabelle: [Schlüssel, Name, Wert als Text, Veränderung als Text, besser: 1 mehr ist besser,
 * −1 weniger ist besser, 0 ohne Wertung, Anteil der Veränderung (sonst (b − a) / a)]. Tempo zu Fuß als Zeit je km.
 */
function rows(ref) {
  const pace = paceOf(ref);
  const speed = (v) => (pace ? `${clock(pace.per / v)} ${pace.unit}` : `${num(v * 3.6, 1)} km/h`);
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  return [
    ['time', 'Zeit in Bewegung', fmtDuration, (a, b) => `${sign(b - a)}${clock(b - a)}`, 0],
    ['dist', 'Strecke', fmtDistance, (a, b) => (Math.abs(b - a) < 5 ? '±0 m' : `${sign(b - a)}${fmtDistance(Math.abs(b - a))}`), 1],
    ['speed', pace ? `Ø Tempo` : 'Ø Geschwindigkeit', speed,
      (a, b) => (pace ? `${sign(pace.per / b - pace.per / a)}${clock(pace.per / b - pace.per / a)} ${pace.unit}` : `${sign(b - a)}${num(Math.abs(b - a) * 3.6, 1)} km/h`), 1,
      // Zeit je km: die Prozente auf die Zeit, nicht auf die Geschwindigkeit (schneller = weniger Minuten)
      pace ? (a, b) => a / b - 1 : null],
    ['top', 'max. Geschwindigkeit', (v) => `${num(v * 3.6, 1)} km/h`, (a, b) => `${sign(b - a)}${num(Math.abs(b - a) * 3.6, 1)} km/h`, 1],
    ['hr', 'Ø Puls', (v) => `${Math.round(v)}`, (a, b) => `${sign(Math.round(b) - Math.round(a))}${Math.abs(Math.round(b) - Math.round(a))}`, 0],
    ['hrMax', 'max. Puls', (v) => `${Math.round(v)}`, (a, b) => `${sign(b - a)}${Math.abs(Math.round(b - a))}`, 0],
    ['beats', 'Herzschläge je km', (v) => num(Math.round(v)), (a, b) => `${sign(Math.round(b - a))}${num(Math.abs(Math.round(b - a)))}`, -1],
    ['cad', `Ø ${cadName(ref)}`, (v) => `${Math.round(v)}`, (a, b) => `${sign(Math.round(b - a))}${Math.abs(Math.round(b - a))}`, 0],
    ['pow', 'Ø Leistung', (v) => `${Math.round(v)} W`, (a, b) => `${sign(Math.round(b - a))}${Math.abs(Math.round(b - a))} W`, 1],
  ];
}

/** Veränderung von a nach b als Zelleninhalt: Text, Prozent, Wertung (good/bad/'') */
function change([, , , diff, better, share], a, b) {
  const pct = a ? Math.round((share ? share(a, b) : (b - a) / a) * 100) : 0;
  // Unter einem halben Prozent zählt nicht (dieselbe Strecke misst nie ganz gleich)
  const moved = Math.abs(b - a) > Math.abs(a) * 0.005;
  return { text: diff(a, b), pct: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)} %`, mood: better && moved ? (Math.sign(b - a) === better ? 'good' : 'bad') : '' };
}

/** Mittel der Kennzahlen mehrerer Trainings (je Kennzahl über die, die sie haben) */
function average(figs) {
  const out = {};
  for (const k of Object.keys(figs[0] ?? {})) {
    const v = figs.map((f) => f[k]).filter((x) => x != null);
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return out;
}

/** Womit der aktuelle Lauf verglichen wird – Name, Kennzahlen der Vergleichsgröße oder null */
const REFS = {
  prev: ['Vorheriges Mal', (cur, others) => { const o = others.filter((x) => x.t.start < cur.t.start).at(-1); return o && { f: o.f, note: SHORT.format(o.t.start) }; }],
  last5: ['Letzte 5', (cur, others) => { const o = others.filter((x) => x.t.start < cur.t.start).slice(-5); return o.length ? { f: average(o.map((x) => x.f)), note: `Ø aus ${o.length}` } : null; }],
  avg: ['Durchschnitt', (cur, others) => (others.length ? { f: average(others.map((x) => x.f)), note: `Ø aus ${others.length}` } : null)],
  best: ['Bestes', (cur, others) => { const o = [...others].filter((x) => x.f.speed).sort((a, b) => b.f.speed - a.f.speed)[0]; return o && { f: o.f, note: SHORT.format(o.t.start) }; }],
  worst: ['Schlechtestes', (cur, others) => { const o = [...others].filter((x) => x.f.speed).sort((a, b) => a.f.speed - b.f.speed)[0]; return o && { f: o.f, note: SHORT.format(o.t.start) }; }],
};
const REF_KEY = 'wmap.compareRef';

/** Was die Diagramme zeigen können */
const KINDS = {
  speed: { name: 'Tempo', unit: 'km/h', icon: 'speed', decimals: 1 },
  hr: { name: 'Puls', unit: 'bpm', icon: 'favorite' },
  cad: { name: 'Frequenz', unit: '/min', icon: 'autorenew' },
  pow: { name: 'Leistung', unit: 'W', icon: 'bolt' },
};
const KEY = 'wmap.compareChart';      // Verlauf: Liste der gezeigten Größen
const TREND_KEY = 'wmap.compareTrend'; // Entwicklung: eine Größe

/**
 * @param focus    ID des aktuellen Wegs (gleiche Strecke): er ist kräftig, die anderen blass; Kacheln vergleichen ihn
 *                 mit den anderen, die Tabelle zeigt die Veränderung zum vorigen Mal (beim ersten: zum nächsten).
 *                 Ohne: Tabelle vom ältesten zum neuesten.
 * @param onHover  (id | null) – Maus über einem anderen: Karte hebt ihn hervor
 * @param onSwitch (id) – Doppelklick auf einen anderen: der wird der aktuelle
 * → { hover(id | null) } – von der Karte aus hervorheben
 */
export function paintCompare(box, list, { focus = null, onHover = () => {}, onSwitch = () => {} } = {}) {
  const items = compareColors(list);
  const fi = items.findIndex(({ t }) => t.id === focus);
  const ref = items[fi >= 0 ? fi : items.length - 1].t;
  const figs = items.map(({ t }) => figures(t));
  const ROWS = rows(ref).filter(([k]) => figs.some((f) => f[k] != null));
  // Von wo nach wo die Veränderung in der Tabelle gilt
  const [ai, bi, label] = fi < 0 ? [0, items.length - 1, 'Veränderung']
    : fi > 0 ? [fi - 1, fi, 'zum vorigen Mal'] : [1, 0, 'zum nächsten Mal'];
  const cls = (i) => (i === fi ? ' class="focus"' : '');
  const head = items.map(({ color }, i) => `<th scope="col" style="--c:${color}"${cls(i)}><i></i>${i + 1}</th>`).join('');
  const table = ROWS.map((row) => {
    const [k, name, show] = row;
    const a = figs[ai][k], b = figs[bi][k];
    let cell = '<td class="cmp-delta">–</td>';
    if (a != null && b != null && items.length > 1) {
      const c = change(row, a, b);
      cell = `<td class="cmp-delta ${c.mood}">${esc(c.text)}<small>${c.pct}</small></td>`;
    }
    return `<tr><th scope="row">${esc(name)}</th>${figs.map((f, i) => `<td${cls(i)}>${f[k] == null ? '–' : esc(show(f[k]))}</td>`).join('')}${cell}</tr>`;
  }).join('');

  // Kacheln: womit verglichen werden kann
  const cur = fi >= 0 ? { t: items[fi].t, f: figs[fi] } : null;
  const others = items.map(({ t }, i) => ({ t, f: figs[i] })).filter((x, i) => i !== fi);
  const refs = cur ? Object.entries(REFS).map(([k, [name, pick]]) => [k, name, pick(cur, others)]).filter(([, , r]) => r) : [];
  const m = items.map(({ t }) => metrics(t));
  const kinds = Object.keys(KINDS).filter((k) => m.some((x) => x[k]?.length));
  const wanted = local.get(KEY);
  let shown = (Array.isArray(wanted) ? wanted : [wanted]).filter((k) => kinds.includes(k));
  if (!shown.length && kinds.length) shown = [kinds.includes('hr') ? 'hr' : kinds[0]];
  // Entwicklung: Gesamtzeit nur auf gleicher Strecke sinnvoll – sonst das Tempo zuerst
  const trends = [...(fi >= 0 ? ['time'] : []), 'speed', ...['hr', 'cad', 'pow'].filter((k) => figs.some((f) => f[k] != null))];
  const trendKind = trends.includes(local.get(TREND_KEY)) ? local.get(TREND_KEY) : trends[0];
  const withTrend = items.length > 2 || (fi >= 0 && items.length > 1);

  box.innerHTML = `
    <p class="muted">${fi < 0 ? `${items.length} Trainings, das älteste zuerst. Veränderung: vom ersten zum letzten`
      : `Dieselbe Strecke, ${items.length}-mal – das aktuelle kräftig`} –
      <span class="cmp-good">grün</span> besser, <span class="cmp-bad">rot</span> schlechter.${fi < 0 ? '' : ' Doppelklick auf ein anderes macht es zum aktuellen.'}</p>
    <ol class="cmp-list">${items.map(({ t, color }, i) => `
      <li style="--c:${color}" data-cmp-id="${esc(t.id)}"${cls(i)} tabindex="0"><span class="msr">${sportIcon(sportOf(t))}</span>
        <span><strong>${esc(t.name || 'Weg')}${i === fi ? ' <em>aktuell</em>' : ''}</strong><small>${LONG.format(t.start)} · ${fmtDistance(t.length)} · ${fmtDuration(moving(t))}</small></span></li>`).join('')}</ol>
    ${refs.length ? `
      <h3 class="cmp-h"><span class="msr">leaderboard</span> Dieser Lauf im Vergleich</h3>
      <div class="chip-row cmp-refs" role="group" aria-label="Vergleichen mit">${refs.map(([k, name]) => `
        <button type="button" class="chip" data-ref="${k}">${esc(name)}</button>`).join('')}</div>
      <div class="cmp-tiles"></div>` : ''}
    <details class="cmp-all" ${fi < 0 ? 'open' : ''}><summary><span class="msr">table</span> ${fi < 0 ? 'Zahlen' : 'Alle Läufe als Tabelle'}</summary>
    <div class="cmp-scroll"><table class="cmp-table">
      <thead><tr><th></th>${head}<th scope="col">${label}</th></tr></thead>
      <tbody>${table}</tbody>
    </table></div></details>
    ${kinds.length ? `
      <h3 class="cmp-h"><span class="msr">stacked_line_chart</span> Verlauf über die Strecke</h3>
      <div class="chip-row cmp-kinds" role="group" aria-label="Größen im Diagramm">${kinds.map((k) => `
        <button type="button" class="chip" data-cmp="${k}" aria-pressed="${shown.includes(k)}"><span class="msr">${KINDS[k].icon}</span> ${esc(k === 'cad' ? cadName(ref) : KINDS[k].name)}</button>`).join('')}</div>
      <div class="cmp-charts"></div>` : '<p class="muted">Ohne Zeiten gibt es keine Verläufe zu vergleichen.</p>'}
    ${withTrend ? `<h3 class="cmp-h"><span class="msr">trending_up</span> Entwicklung</h3>
      <div class="chip-row cmp-trends" role="group" aria-label="Größe der Entwicklung">${trends.map((k) => `
        <button type="button" class="chip" data-trend="${k}" aria-pressed="${k === trendKind}">${esc(TREND[k](ref).name)}</button>`).join('')}</div>
      <p class="muted">Je Training, das älteste links${fi >= 0 ? ' – der große Punkt ist das aktuelle' : ''}.</p>
      <div class="elevation cmp-trend"></div>` : ''}`;

  // Kacheln
  const paintTiles = (k) => {
    const host = box.querySelector('.cmp-tiles');
    const r = refs.find(([x]) => x === k)?.[2];
    if (!host || !r) return;
    box.querySelectorAll('[data-ref]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ref === k)));
    host.innerHTML = ROWS.filter(([key]) => key !== 'dist' && cur.f[key] != null).map((row) => {
      const [key, name, show] = row;
      const a = r.f[key], b = cur.f[key];
      const c = a != null ? change(row, a, b) : null;
      return `<div class="cmp-tile ${c?.mood ?? ''}"><small>${esc(name)}</small><strong>${esc(show(b))}</strong>
        <span>${c ? `${esc(c.text)}<small class="cmp-pct">${c.pct}</small>` : '–'}</span><small class="muted">${a != null ? `${esc(show(a))} · ${esc(r.note)}` : 'keine Angabe'}</small></div>`;
    }).join('');
  };
  if (refs.length) {
    const want = local.get(REF_KEY);
    paintTiles(refs.some(([k]) => k === want) ? want : refs[0][0]);
    box.querySelector('.cmp-refs').addEventListener('click', (e) => {
      const k = e.target.closest('[data-ref]')?.dataset.ref;
      if (!k) return;
      local.set(REF_KEY, k);
      paintTiles(k);
    });
  }

  let hovered = null;
  const index = (id) => items.findIndex(({ t }) => t.id === id);
  let charts = [];
  const hover = (id) => {
    if (id === focus) id = null;
    if (id === hovered) return;
    hovered = id;
    box.querySelectorAll('.cmp-list li').forEach((li) => li.classList.toggle('hover', li.dataset.cmpId === id));
    if (fi >= 0) for (const c of charts) c.emphasize(fi, id ? index(id) : null);
  };
  // Verlauf: je gewählte Größe ein Diagramm, alle Trainings übereinander
  const paintCharts = () => {
    const host = box.querySelector('.cmp-charts');
    if (!host) return;
    host.replaceChildren();
    charts = shown.map((k) => {
      const el = Object.assign(document.createElement('div'), { className: 'elevation cmp-along' });
      el.dataset.kind = k;
      host.append(el);
      const c = KINDS[k], chart = new ElevationProfile(el);
      chart.showSeries({
        unit: c.unit, decimals: c.decimals, icon: c.icon, title: k === 'cad' ? cadName(ref) : c.name,
        series: items.map(({ t, color }, i) => ({ name: `${i + 1} · ${DAY.format(t.start)}`, color, points: m[i][k] ?? [] })),
      });
      if (fi >= 0) chart.emphasize(fi, hovered ? index(hovered) : null);
      return chart;
    });
  };
  paintCharts();
  box.querySelector('.cmp-kinds')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-cmp]')?.dataset.cmp;
    if (!k) return;
    // Dazu oder weg – eine bleibt
    const next = shown.includes(k) ? shown.filter((x) => x !== k) : kinds.filter((x) => x === k || shown.includes(x));
    if (!next.length) return;
    shown = next;
    local.set(KEY, shown);
    box.querySelectorAll('[data-cmp]').forEach((b) => b.setAttribute('aria-pressed', String(shown.includes(b.dataset.cmp))));
    paintCharts();
  });

  // Entwicklung
  const trendHost = box.querySelector('.cmp-trend');
  const trend = trendHost ? new ElevationProfile(trendHost) : null;
  const paintTrend = (k) => {
    if (!trend) return;
    const d = TREND[k](ref);
    box.querySelectorAll('[data-trend]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.trend === k)));
    trend.showSeries({
      unit: d.unit, decimals: d.decimals ?? 0, icon: 'trending_up', title: d.name, smooth: false,
      x: { unit: '', decimals: 0, labels: items.map(({ t }) => SHORT.format(t.start)), ...(fi >= 0 ? { mark: { x: fi + 1, color: items[fi].color } } : {}) },
      series: [{ name: d.name, color: 'light-dark(#1a73e8, #74a7f5)',
        points: figs.map((f, i) => [i + 1, d.value(f)]).filter(([, v]) => v != null) }],
    });
  };
  paintTrend(trendKind);
  box.querySelector('.cmp-trends')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-trend]')?.dataset.trend;
    if (!k) return;
    local.set(TREND_KEY, k);
    paintTrend(k);
  });

  // Liste: Maus darüber hebt hervor, Doppelklick (am Handy doppelt tippen, Enter) wechselt
  const list_ = box.querySelector('.cmp-list');
  list_.addEventListener('mouseover', (e) => { const id = e.target.closest('[data-cmp-id]')?.dataset.cmpId ?? null; hover(id); onHover(id === focus ? null : id); });
  list_.addEventListener('mouseleave', () => { hover(null); onHover(null); });
  // Am Handy gibt es kein Darüberfahren: der erste Tipp hebt hervor, der zweite wechselt
  list_.addEventListener('click', (e) => {
    const id = e.target.closest('[data-cmp-id]')?.dataset.cmpId;
    if (!id || !focus || id === focus || !matchMedia('(pointer: coarse)').matches) return;
    if (hovered === id) onSwitch(id); else { hover(id); onHover(id); }
  });
  list_.addEventListener('dblclick', (e) => { const id = e.target.closest('[data-cmp-id]')?.dataset.cmpId; if (id && focus && id !== focus) onSwitch(id); });
  list_.addEventListener('keydown', (e) => { const id = e.target.closest('[data-cmp-id]')?.dataset.cmpId; if (e.key === 'Enter' && id && focus && id !== focus) onSwitch(id); });
  return { hover };
}

/** Entwicklung: Größe je Training → { name, unit, decimals, value(figures) } */
const TREND = {
  time: () => ({ name: 'Gesamtzeit', unit: 'min', decimals: 1, value: (f) => (f.time ? Math.round(f.time / 6) / 10 : null) }),
  speed: (t) => (paceOf(t)
    ? { name: 'Ø Tempo', unit: `min ${paceOf(t).unit}`, decimals: 2, value: (f) => (f.speed ? Math.round(paceOf(t).per / f.speed / 60 * 100) / 100 : null) }
    : { name: 'Ø Geschwindigkeit', unit: 'km/h', decimals: 1, value: (f) => (f.speed ? Math.round(f.speed * 36) / 10 : null) }),
  hr: () => ({ name: 'Ø Puls', unit: 'bpm', value: (f) => (f.hr ? Math.round(f.hr) : null) }),
  cad: (t) => ({ name: `Ø ${cadName(t)}`, unit: '/min', value: (f) => (f.cad ? Math.round(f.cad) : null) }),
  pow: () => ({ name: 'Ø Leistung', unit: 'W', value: (f) => (f.pow ? Math.round(f.pow) : null) }),
};
