/**
 * Trainings vergleichen (Meine Touren → Aufgezeichnet → „Vergleichen“, wege.html?compare=id,id,…; gleiche Strecke
 * vom aktuellen Weg aus: …&focus=id).
 *
 *   Auswahl     oben: welche Touren im Vergleich sind (Mehrfachauswahl mit Suche über Name, Datum, Tags – zu zählt sie
 *               nur, „40 Touren“), darunter welche davon die aktuelle ist (Auswahl mit Suche) – wuefl-libs selectpicker
 *   Kacheln     von der aktuellen aus (ohne Wahl die neueste): zum vorigen, zu den letzten 5,
 *               zum Durchschnitt, zum besten bzw. schlechtesten der anderen (umschaltbar, gemerkt) – groß der Wert,
 *               darunter in einer Zeile ± absolut und in Prozent, immer grün (besser) oder rot (schlechter)
 *   Tabelle     je Training Zeit, Strecke, Ø Tempo, max. Geschwindigkeit, Puls, Herzschläge je km, Frequenz,
 *               Leistung und die Veränderung der aktuellen zum vorigen Mal (bei der ersten: zum nächsten)
 *   Verlauf     Tempo, Puls, Frequenz, Leistung über die Strecke in einem Diagramm: die Farbe gehört der Größe
 *               (alle Pulse rot …), das aktuelle Training kräftig, die anderen blass; jede Größe ihre Skala
 *   Entwicklung Gesamtzeit (bzw. Ø Tempo, Puls …) je Training über die Tage, der aktuelle als großer Punkt
 *
 * Die Trainings haben keine eigenen Farben: das aktuelle ist kräftig, die anderen grau (Karte in pages/wege.js) – im
 * Verlauf zählt die Farbe der Größe.
 *
 *   paintCompare(box, list, { focus, same, pool, onHover, onSwitch, onSet })  list: Wege (ganz, nicht nur die
 *                            Karteikarte), beliebig sortiert; `focus`: die aktuelle (sonst die neueste); `same`: gleiche
 *                            Strecke; `pool`: alle Aufzeichnungen (Karteikarten) zum Dazunehmen
 */
import { ElevationProfile } from '../ui/elevation.js';
import { paceOf, cadName, sportName, sportOf } from '../data/track-look.js';
import { metrics } from '../data/track-stats.js';
import { local } from '../data/store.js';
import { fmtDistance, fmtTime, esc } from '../core/geo.js';
import { locale, t } from '../core/i18n.js';
// Auswahl mit Suche für <select data-sp-picker> (legt sich selbst an)
import '../../libs/wuefl-libs/selectpicker/selectpicker.js';

const DAY = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit' });
const SHORT = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const DM = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' });
const HM = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const FULL = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' });

const moving = (tk) => tk.moving || (tk.end - tk.start) / 1000;
const values = (a) => (a ?? []).filter((x) => x > 0);
const mean = (a) => { const v = values(a); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const most = (a) => { const v = values(a); return v.length ? Math.max(...v) : null; };
const num = (v, d = 0) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = (sec) => {
  const s = Math.round(Math.abs(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

/** Eintrag einer Auswahl: „18.10.2026 · Morgenrunde · 5,2 km“, gesucht auch über Tags und Art */
const option = (tk, on) => `<option value="${esc(tk.id)}" ${on ? 'selected' : ''} data-search="${esc([...(tk.tags ?? []), sportName(sportOf(tk))].join(' '))}"
  >${esc(t('wege.compare.option', { date: FULL.format(tk.start), name: tk.name || t('wege.compare.default_name'), length: fmtDistance(tk.length) }))}</option>`;

/** Kennzahlen eines Trainings – null, wo es nichts gibt */
function figures(tk) {
  const mv = moving(tk), hr = mean(tk.hr);
  return {
    time: mv, dist: tk.length, speed: mv ? tk.length / mv : null, top: tk.top > 0 ? tk.top : null,
    hr, hrMax: most(tk.hr), cad: mean(tk.cad), pow: mean(tk.pow),
    // Herzschläge je Kilometer: gleich schnell mit weniger Schlägen – das Herz arbeitet leichter
    beats: hr && tk.length > 100 ? (hr * mv) / 60 / (tk.length / 1000) : null,
  };
}

/**
 * Zeilen der Tabelle: [Schlüssel, Name, Wert als Text, Veränderung als Text, besser: 1 mehr ist besser,
 * −1 weniger ist besser, 0 ohne Wertung, Anteil der Veränderung (sonst (b − a) / a)]. Tempo zu Fuß als Zeit je km.
 */
function rows(ref) {
  const pace = paceOf(ref);
  const speed = (v) => (pace ? `${clock(pace.per / v)} ${pace.unit}` : t('wege.compare.unit.kmh', { v: num(v * 3.6, 1) }));
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  return [
    ['time', t('wege.compare.rows.time'), fmtTime, (a, b) => `${sign(b - a)}${clock(b - a)}`, -1],
    ['dist', t('wege.compare.rows.dist'), fmtDistance, (a, b) => (Math.abs(b - a) < 5 ? t('wege.compare.unit.zero_m') : `${sign(b - a)}${fmtDistance(Math.abs(b - a))}`), 1],
    ['speed', pace ? t('wege.compare.rows.pace') : t('wege.compare.rows.speed'), speed,
      (a, b) => (pace ? `${sign(pace.per / b - pace.per / a)}${clock(pace.per / b - pace.per / a)} ${pace.unit}` : `${sign(b - a)}${t('wege.compare.unit.kmh', { v: num(Math.abs(b - a) * 3.6, 1) })}`), 1,
      // Zeit je km: die Prozente auf die Zeit, nicht auf die Geschwindigkeit (schneller = weniger Minuten)
      pace ? (a, b) => a / b - 1 : null],
    ['top', t('wege.compare.rows.top'), (v) => t('wege.compare.unit.kmh', { v: num(v * 3.6, 1) }), (a, b) => `${sign(b - a)}${t('wege.compare.unit.kmh', { v: num(Math.abs(b - a) * 3.6, 1) })}`, 1],
    ['hr', t('wege.compare.rows.hr'), (v) => `${Math.round(v)}`, (a, b) => `${sign(Math.round(b) - Math.round(a))}${Math.abs(Math.round(b) - Math.round(a))}`, -1],
    ['hrMax', t('wege.compare.rows.hr_max'), (v) => `${Math.round(v)}`, (a, b) => `${sign(b - a)}${Math.abs(Math.round(b - a))}`, -1],
    ['beats', t('wege.compare.rows.beats'), (v) => num(Math.round(v)), (a, b) => `${sign(Math.round(b - a))}${num(Math.abs(Math.round(b - a)))}`, -1],
    ['cad', t('wege.compare.rows.cad', { name: cadName(ref) }), (v) => `${Math.round(v)}`, (a, b) => `${sign(Math.round(b - a))}${Math.abs(Math.round(b - a))}`, 1],
    ['pow', t('wege.compare.rows.pow'), (v) => t('wege.compare.unit.watt', { v: Math.round(v) }), (a, b) => `${sign(Math.round(b - a))}${t('wege.compare.unit.watt', { v: Math.abs(Math.round(b - a)) })}`, 1],
  ];
}

/** Veränderung von a nach b als Zelleninhalt: Text, Prozent, Wertung (good/bad/'') */
function change([, , , diff, better, share], a, b) {
  const pct = a ? Math.round((share ? share(a, b) : (b - a) / a) * 100) : 0;
  // Unter einem halben Prozent zählt nicht (dieselbe Strecke misst nie ganz gleich)
  const moved = Math.abs(b - a) > Math.abs(a) * 0.005;
  return { text: diff(a, b), pct: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${t('wege.compare.unit.pct', { v: Math.abs(pct) })}`, mood: better && moved ? (Math.sign(b - a) === better ? 'good' : 'bad') : '' };
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
  prev: [t('wege.compare.refs.prev'), (cur, others) => { const o = others.filter((x) => x.tk.start < cur.tk.start).at(-1); return o && { f: o.f, note: SHORT.format(o.tk.start) }; }],
  last5: [t('wege.compare.refs.last5'), (cur, others) => { const o = others.filter((x) => x.tk.start < cur.tk.start).slice(-5); return o.length ? { f: average(o.map((x) => x.f)), note: t('wege.compare.refs.avg_of', { n: o.length }) } : null; }],
  avg: [t('wege.compare.refs.avg'), (cur, others) => (others.length ? { f: average(others.map((x) => x.f)), note: t('wege.compare.refs.avg_of', { n: others.length }) } : null)],
  best: [t('wege.compare.refs.best'), (cur, others) => { const o = [...others].filter((x) => x.f.speed).sort((a, b) => b.f.speed - a.f.speed)[0]; return o && { f: o.f, note: SHORT.format(o.tk.start) }; }],
  worst: [t('wege.compare.refs.worst'), (cur, others) => { const o = [...others].filter((x) => x.f.speed).sort((a, b) => a.f.speed - b.f.speed)[0]; return o && { f: o.f, note: SHORT.format(o.tk.start) }; }],
};
const REF_KEY = 'wmap.compareRef';

/** Was die Diagramme zeigen können */
const KINDS = {
  speed: { name: t('wege.compare.kinds.speed'), unit: 'km/h', icon: 'speed', decimals: 1, color: 'light-dark(#1a73e8, #74a7f5)' },
  hr: { name: t('wege.compare.kinds.hr'), unit: 'bpm', icon: 'favorite', color: 'light-dark(#e03131, #ff8787)' },
  cad: { name: t('wege.compare.kinds.cad'), unit: '/min', icon: 'autorenew', color: 'light-dark(#ae3ec9, #e599f7)' },
  pow: { name: t('wege.compare.kinds.pow'), unit: 'W', icon: 'bolt', color: 'light-dark(#e8590c, #ffa94d)' },
};
const KEY = 'wmap.compareChart';      // Verlauf: Liste der gezeigten Größen
const TREND_KEY = 'wmap.compareTrend'; // Entwicklung: eine Größe

/**
 * @param focus    ID des aktuellen Wegs (ohne bzw. nicht dabei: der neueste): er ist kräftig, die anderen blass;
 *                 Kacheln vergleichen ihn mit den anderen, die Tabelle zeigt die Veränderung zum vorigen Mal (beim
 *                 ersten: zum nächsten)
 * @param same     gleiche Strecke (vom Weg aus): Gesamtzeit in der Entwicklung, Text dazu
 * @param pool     alle Aufzeichnungen, aus denen die Mehrfachauswahl wählt
 * @param onHover  (id | null) – Maus über einem anderen im Diagramm: Karte hebt ihn hervor
 * @param onSwitch (id) – eine andere ist die aktuelle (Auswahl)
 * @param onSet    (ids) – andere Touren im Vergleich (Mehrfachauswahl, mindestens zwei)
 * → { hover(id | null) } – von der Karte aus hervorheben
 */
export function paintCompare(box, list, { focus = null, same = false, pool = [], onHover = () => {}, onSwitch = () => {}, onSet = () => {} } = {}) {
  const items = [...list].sort((a, b) => a.start - b.start).map((tk) => ({ tk }));
  let fi = items.findIndex(({ tk }) => tk.id === focus);
  if (fi < 0) fi = items.length - 1;
  focus = items[fi].tk.id;
  const ref = items[fi].tk;
  const figs = items.map(({ tk }) => figures(tk));
  const ROWS = rows(ref).filter(([k]) => figs.some((f) => f[k] != null));
  // Von wo nach wo die Veränderung in der Tabelle gilt
  const [ai, bi, label] = fi > 0 ? [fi - 1, fi, t('wege.compare.table.to_prev')] : [1, 0, t('wege.compare.table.to_next')];
  const cls = (i) => (i === fi ? ' class="focus"' : '');
  // Jedes Training heißt nach seinem Tag („29.9.“), am selben Tag mit Uhrzeit – statt einer Nummer
  const tags = items.map(({ tk }) => DM.format(tk.start));
  const dayOf = items.map(({ tk }, i) => (tags.filter((x) => x === tags[i]).length > 1 ? `${tags[i]} ${HM.format(tk.start)}` : tags[i]));
  const head = items.map((x, i) => `<th scope="col"${cls(i)}>${esc(dayOf[i])}</th>`).join('');
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

  // Kacheln: der aktuelle – womit er verglichen werden kann
  const ci = fi;
  const cur = items.length > 1 ? { tk: items[ci].tk, f: figs[ci] } : null;
  const others = items.map(({ tk }, i) => ({ tk, f: figs[i] })).filter((x, i) => i !== ci);
  const refs = cur ? Object.entries(REFS).map(([k, [name, pick]]) => [k, name, pick(cur, others)]).filter(([, , r]) => r) : [];
  const m = items.map(({ tk }) => metrics(tk));
  const kinds = Object.keys(KINDS).filter((k) => m.some((x) => x[k]?.length));
  const wanted = local.get(KEY);
  let shown = (Array.isArray(wanted) ? wanted : [wanted]).filter((k) => kinds.includes(k));
  if (!shown.length) shown = kinds;            // ohne eigene Wahl alles in einem Diagramm
  // Entwicklung: Gesamtzeit nur auf gleicher Strecke sinnvoll – sonst das Tempo zuerst
  const trends = [...(same ? ['time'] : []), 'speed', ...['hr', 'cad', 'pow'].filter((k) => figs.some((f) => f[k] != null))];
  const trendKind = trends.includes(local.get(TREND_KEY)) ? local.get(TREND_KEY) : trends[0];
  const withTrend = items.length > 2 || (same && items.length > 1);

  // Welche im Vergleich sind (die gewählten zuerst, dann die neuesten) und welche davon die aktuelle ist
  const inSet = new Set(items.map(({ tk }) => tk.id));
  const choices = [...items.map(({ tk }) => tk).reverse(), ...[...pool].filter((tk) => !inSet.has(tk.id)).sort((a, b) => b.start - a.start)];
  box.innerHTML = `
    <div class="cmp-pick">
      <label class="cmp-field"><span><span class="msr">checklist</span> ${t('wege.compare.pick.set')}</span>
        <select class="cmp-set" multiple data-sp-picker="${t('wege.compare.pick.set_title')}" data-sp-save data-sp-summary="${t('wege.compare.pick.set_summary')}">${choices.map((tk) => option(tk, inSet.has(tk.id))).join('')}</select></label>
      <label class="cmp-field"><span><span class="msr">leaderboard</span> ${t('wege.compare.pick.focus')}</span>
        <select class="cmp-focus" data-sp-picker="${t('wege.compare.pick.focus_title')}">${items.map(({ tk }) => tk).reverse().map((tk) => option(tk, tk.id === focus)).join('')}</select></label>
    </div>
    <p class="muted">${same ? t('wege.compare.intro.same', { n: items.length }) : t('wege.compare.intro.count', { n: items.length })} ${t('wege.compare.intro.legend')}</p>
    ${refs.length ? `
      <div class="chip-row cmp-refs" role="group" aria-label="${t('wege.compare.refs.label')}">${refs.map(([k, name]) => `
        <button type="button" class="chip" data-ref="${k}">${esc(name)}</button>`).join('')}</div>
      <div class="cmp-tiles"></div>` : ''}
    <details class="cmp-all" ${items.length < 2 ? 'open' : ''}><summary><span class="msr">table</span> ${t('wege.compare.table.title')}</summary>
    <div class="cmp-scroll"><table class="cmp-table">
      <thead><tr><th></th>${head}<th scope="col">${label}</th></tr></thead>
      <tbody>${table}</tbody>
    </table></div></details>
    ${kinds.length ? `
      <h3 class="cmp-h"><span class="msr">stacked_line_chart</span> ${t('wege.compare.along.title')}</h3>
      <div class="chip-row cmp-kinds" role="group" aria-label="${t('wege.compare.along.label')}">${kinds.map((k) => `
        <button type="button" class="chip" data-cmp="${k}" aria-pressed="${shown.includes(k)}"><span class="msr">${KINDS[k].icon}</span> ${esc(k === 'cad' ? cadName(ref) : KINDS[k].name)}</button>`).join('')}</div>
      <div class="cmp-charts"></div>` : `<p class="muted">${t('wege.compare.along.none')}</p>`}
    ${withTrend ? `<h3 class="cmp-h"><span class="msr">trending_up</span> ${t('wege.compare.trend.title')}</h3>
      <div class="chip-row cmp-trends" role="group" aria-label="${t('wege.compare.trend.label')}">${trends.map((k) => `
        <button type="button" class="chip" data-trend="${k}" aria-pressed="${k === trendKind}">${esc(TREND[k](ref).name)}</button>`).join('')}</div>
      <p class="muted">${t('wege.compare.trend.hint')}</p>
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
      // Groß der Wert, darunter in einer Zeile ± absolut und in Prozent (grün besser, rot schlechter)
      return `<div class="cmp-tile ${c?.mood ?? ''}" title="${a != null ? esc(`${show(a)} · ${r.note}`) : t('wege.compare.tile.none')}"><small>${esc(name)}</small><strong>${esc(show(b))}</strong>
        <span>${c ? `${esc(c.text)} <span class="cmp-pct">${c.pct}</span>` : '–'}</span></div>`;
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
  const index = (id) => items.findIndex(({ tk }) => tk.id === id);
  let charts = [];
  const hover = (id) => {
    if (id === focus) id = null;
    if (id === hovered) return;
    hovered = id;
    for (const c of charts) c.emphasize(ci, id ? index(id) : null);
  };
  // Verlauf: ein Diagramm mit allen gewählten Größen aller Trainings – Farbe je Größe, das aktuelle kräftig
  // Tooltip des Verlaufs: das aktuelle, die letzten vier anderen, das schnellste und das langsamste – nicht alle
  const speeds = figs.map((f, i) => [i, f.speed]).filter(([i, v]) => i !== ci && v != null).sort((a, b) => b[1] - a[1]);
  const best = speeds[0]?.[0], worst = speeds.length > 1 ? speeds.at(-1)[0] : null;
  const recent = items.map((x, i) => i).filter((i) => i !== ci).slice(-4);
  const tip = {
    focus: ci, best, worst, label: (g) => esc(dayOf[g]),
    groups: [...new Set([...recent, best, worst].filter((g) => g != null))].sort((a, b) => a - b),
  };
  const paintCharts = () => {
    const host = box.querySelector('.cmp-charts');
    if (!host) return;
    host.replaceChildren();
    const el = Object.assign(document.createElement('div'), { className: 'elevation cmp-along' });
    el.dataset.kind = shown.join('+');
    host.append(el);
    const chart = new ElevationProfile(el);
    const kindList = shown.map((k) => ({ ...KINDS[k], name: k === 'cad' ? cadName(ref) : KINDS[k].name }));
    chart.showCompare({
      kinds: kindList, length: Math.max(...items.map(({ tk }) => tk.length)), icon: 'stacked_line_chart', tip,
      title: kindList.map((k) => k.name).join(' + '),
      series: shown.flatMap((k, ki) => items.map(({ tk }, i) => ({ name: `${kindList[ki].name} · ${dayOf[i]} · ${DAY.format(tk.start)}`, kind: ki, group: i, points: m[i][k] ?? [] }))),
    });
    chart.emphasize(ci, hovered ? index(hovered) : null);
    charts = [chart];
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
      x: { unit: '', decimals: 0, labels: items.map(({ tk }) => SHORT.format(tk.start)), mark: { x: fi + 1, color: '#1a73e8' } },
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

  // Auswahl: andere Touren im Vergleich (mindestens zwei), eine andere als aktuelle
  box.querySelector('.cmp-set').addEventListener('change', (e) => {
    const ids = [...e.target.selectedOptions].map((o) => o.value);
    if (ids.length === inSet.size && ids.every((id) => inSet.has(id))) return;
    onSet(ids);
  });
  box.querySelector('.cmp-focus').addEventListener('change', (e) => { if (e.target.value !== focus) onSwitch(e.target.value); });
  return { hover };
}

/** Entwicklung: Größe je Training → { name, unit, decimals, value(figures) } */
const TREND = {
  time: () => ({ name: t('wege.compare.trend.time'), unit: 'min', decimals: 1, value: (f) => (f.time ? Math.round(f.time / 6) / 10 : null) }),
  speed: (tk) => (paceOf(tk)
    ? { name: t('wege.compare.rows.pace'), unit: `min ${paceOf(tk).unit}`, decimals: 2, value: (f) => (f.speed ? Math.round(paceOf(tk).per / f.speed / 60 * 100) / 100 : null) }
    : { name: t('wege.compare.rows.speed'), unit: 'km/h', decimals: 1, value: (f) => (f.speed ? Math.round(f.speed * 36) / 10 : null) }),
  hr: () => ({ name: t('wege.compare.rows.hr'), unit: 'bpm', value: (f) => (f.hr ? Math.round(f.hr) : null) }),
  cad: (tk) => ({ name: t('wege.compare.rows.cad', { name: cadName(tk) }), unit: '/min', value: (f) => (f.cad ? Math.round(f.cad) : null) }),
  pow: () => ({ name: t('wege.compare.rows.pow'), unit: 'W', value: (f) => (f.pow ? Math.round(f.pow) : null) }),
};
