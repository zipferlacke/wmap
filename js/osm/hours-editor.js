/**
 * Öffnungszeiten zum Ausfüllen – statt der OSM-Schreibweise
 * („Mo-Fr 08:00-18:00; Sa 08:00-13:00“) ein aufklappbarer Block
 * „Öffnungszeiten“: Montag bis Sonntag und Feiertage untereinander, rechts
 * die Zeiten (mehrere je Tag, z. B. mit Mittagspause). Ein Tag ohne Zeiten
 * ist geschlossen; Feiertage ohne Angabe bleiben offen gelassen.
 * Unten: „Rund um die Uhr“, „Dauerhaft geschlossen“ und „Als Text“.
 *
 *   hoursField(value, { gone })  HTML – ein verstecktes Feld name="opening_hours"
 *                                hält den Wert; mit `gone` auch der Knopf
 *                                „Dauerhaft geschlossen“ (name="gone" = "1")
 *   mountHours(root)             verdrahtet den Block
 *
 * Solange niemand etwas ändert, bleibt der Wert genau wie er war – auch
 * wenn WMap ihn anders schreiben würde. Zu Verschachteltes (Monate,
 * Schulferien …) zeigt der Block als Text.
 */
import { parseWeek, buildHours, formatHours } from '../ui/poi-info.js';
import { esc } from '../core/geo.js';

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const PH = 7;   // Zeile „Feiertage“

const toMin = (v) => { const [h, m] = String(v || '0:0').split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Wert → { mode: 'week' | '24/7' | 'raw' | 'empty', days: [[[von, bis]]] ×7, ph: null | 'off' | [[von, bis]] } */
function read(value) {
  const v = (value ?? '').trim();
  const days = Array.from({ length: 7 }, () => []);
  if (!v) return { mode: 'empty', days, ph: null };
  if (v === '24/7') return { mode: '24/7', days, ph: null };
  const week = parseWeek(v);
  // Nur Tage und Feiertage: Monate, Wochen, Kommentare scheitern schon in
  // parseWeek; Schulferien überginge es – die fielen beim Speichern weg
  const rules = v.split(';').map((r) => r.trim()).filter(Boolean);
  if (!week || rules.some((r) => /^SH\b/.test(r))) return { mode: 'raw', days, ph: null };
  let ph = null;
  const phRule = rules.find((r) => /^PH\b/.test(r));
  if (phRule) {
    const rest = phRule.replace(/^PH\s*/, '');
    if (/^(off|closed)$/i.test(rest)) ph = 'off';
    else {
      const w = parseWeek(`Mo ${rest}`);
      if (!w) return { mode: 'raw', days, ph: null };
      ph = w[0];
    }
  }
  return { mode: 'week', days: week.map((d) => d ?? []), ph };
}

/** Zustand → Wert (ohne Angaben: leer) */
function write(state) {
  if (state.mode === '24/7') return '24/7';
  if (state.mode === 'gone' || state.mode === 'empty') return '';
  const fix = (spans) => spans.map(([a, b]) => [a, b === 0 ? 1440 : b <= a ? b + 1440 : b]);
  let out = buildHours(state.days.map(fix), '');
  if (state.ph === 'off') out = [out, 'PH off'].filter(Boolean).join('; ');
  else if (state.ph?.length) {
    const ph = buildHours([fix(state.ph), [], [], [], [], [], []], '').replace(/^Mo\s*/, '');
    out = [out, `PH ${ph}`].filter(Boolean).join('; ');
  }
  return out;
}

function spanHtml(day, [a, b], i) {
  const name = day === PH ? 'Feiertage' : DAYS[day];
  return `<span class="oh-span" data-i="${i}">
      <input type="time" class="oh-a" value="${toTime(a)}" aria-label="${name} ab">
      <i>–</i>
      <input type="time" class="oh-b" value="${toTime(b % 1440)}" aria-label="${name} bis">
      <button type="button" class="oh-del" data-oh="del" title="Diese Zeit entfernen" aria-label="Zeit entfernen"><span class="msr">close</span></button>
    </span>`;
}

function rowHtml(day, spans, ph) {
  const isPh = day === PH;
  const empty = !spans?.length;
  const none = isPh && ph === null;
  const state = empty ? (isPh ? (ph === 'off' ? 'geschlossen' : 'wie an anderen Tagen – keine Angabe') : 'geschlossen') : '';
  return `<div class="oh-day${empty ? ' closed' : ''}${isPh ? ' oh-ph' : ''}" data-day="${day}">
      <span class="oh-name">${isPh ? 'Feiertage' : DAYS[day]}
        <span class="oh-row-actions">
          <button type="button" class="oh-add" data-oh="add" title="Zeit hinzufügen"><span class="msr">add</span> ${empty ? 'Zeiten' : 'Zeit'}</button>
          ${isPh && empty ? `<button type="button" class="oh-add" data-oh="ph-off">${none ? 'geschlossen' : 'keine Angabe'}</button>` : ''}
        </span>
      </span>
      <span class="oh-times">
        ${(spans ?? []).map((s, i) => spanHtml(day, s, i)).join('')}
        ${empty ? `<span class="oh-closed">${state}</span>` : ''}
      </span>
    </div>`;
}

function summary(value, mode) {
  if (mode === 'gone') return 'dauerhaft geschlossen';
  if (!value) return 'keine Angabe';
  return formatHours(value).replace(/\n/g, ' · ');
}

function bodyHtml(state, raw) {
  if (state.mode === '24/7') {
    return `<p class="oh-note"><span class="msr">all_inclusive</span> Rund um die Uhr geöffnet</p>
      <button type="button" class="link-button" data-oh="week">Doch Zeiten je Tag angeben</button>`;
  }
  if (state.mode === 'gone') {
    return `<p class="oh-note"><span class="msr">block</span> Dauerhaft geschlossen – den Ort gibt es so nicht mehr.
        Das geht als Hinweis an die Mapper, die ihn dann austragen.</p>
      <button type="button" class="link-button" data-oh="week">Doch Zeiten angeben</button>`;
  }
  if (state.mode === 'raw') {
    return `<p class="muted">Diese Zeiten sind zu verschachtelt für die Liste (z. B. Monate oder Schulferien) – hier als Text in
        OSM-Schreibweise.</p>
      <input type="text" class="oh-raw" value="${esc(raw)}" placeholder="Mo-Fr 08:00-18:00; Sa 08:00-13:00" autocomplete="off">
      <button type="button" class="link-button" data-oh="week">Stattdessen je Tag neu eintragen</button>`;
  }
  return `<div class="oh-week">${state.days.map((d, i) => rowHtml(i, d, null)).join('')}${rowHtml(PH, state.ph === 'off' ? [] : state.ph, state.ph)}</div>
    <button type="button" class="link-button oh-copy" data-oh="copy-mo"><span class="msr">content_copy</span> Montag für Di–Fr übernehmen</button>`;
}

/** @param gone  Knopf „Dauerhaft geschlossen“ zeigen (nur beim Bearbeiten) */
export function hoursField(value = '', { gone = true } = {}) {
  const state = read(value);
  return `<details class="oh-block" data-gone="${gone ? 1 : 0}">
      <summary><span class="msr">schedule</span> Öffnungszeiten <small class="oh-summary">${esc(summary(value, state.mode))}</small></summary>
      <input type="hidden" name="opening_hours" value="${esc(value ?? '')}">
      <input type="hidden" name="gone" value="">
      <div class="oh-body">${bodyHtml(state, value)}</div>
      <div class="oh-quick">
        <button type="button" class="button" data-oh="24/7"><span class="msr">all_inclusive</span> 24/7 geöffnet</button>
        ${gone ? '<button type="button" class="button" data-oh="gone"><span class="msr">block</span> Dauerhaft geschlossen</button>' : ''}
        <button type="button" class="link-button" data-oh="raw">Als Text</button>
      </div>
    </details>`;
}

/** Block im Formular verdrahten – hält name="opening_hours" (und name="gone") aktuell */
export function mountHours(root) {
  const el = root.querySelector('.oh-block');
  if (!el) return;
  const field = el.querySelector('input[name="opening_hours"]');
  const goneField = el.querySelector('input[name="gone"]');
  const body = el.querySelector('.oh-body');
  let state = read(field.value);
  if (state.mode === 'empty') state.mode = 'week';

  // Aus den Feldern lesen, was gerade dasteht
  const collect = () => {
    if (state.mode !== 'week') return;
    const rows = [...body.querySelectorAll('.oh-day')];
    const spansOf = (row) => [...row.querySelectorAll('.oh-span')].map((s) => [toMin(s.querySelector('.oh-a').value), toMin(s.querySelector('.oh-b').value)]);
    state.days = rows.filter((r) => Number(r.dataset.day) < PH).map(spansOf);
    const ph = spansOf(rows.find((r) => Number(r.dataset.day) === PH));
    state.ph = ph.length ? ph : state.ph === 'off' ? 'off' : null;
  };
  const update = () => {
    const value = state.mode === 'raw' ? body.querySelector('.oh-raw')?.value.trim() ?? '' : write(state);
    field.value = value;
    goneField.value = state.mode === 'gone' ? '1' : '';
    el.querySelector('.oh-summary').textContent = summary(value, state.mode);
  };
  const paint = () => { body.innerHTML = bodyHtml(state, field.value); };

  el.addEventListener('input', (e) => {
    if (e.target.matches('.oh-raw')) { update(); return; }
    if (e.target.matches('input[type="time"]')) { collect(); update(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-oh]');
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.oh;
    collect();
    const day = Number(b.closest('.oh-day')?.dataset.day);
    const list = day === PH ? (Array.isArray(state.ph) ? state.ph : []) : state.days[day];
    if (act === 'add') {
      // Nächste Zeit nach der letzten, sonst 08:00–18:00 (Feiertage 10–14)
      const last = list.at(-1);
      list.push(last ? [Math.min(last[1] + 60, 1380), Math.min(last[1] + 240, 1439)] : day === PH ? [600, 840] : [480, 1080]);
      if (day === PH) state.ph = list; else state.days[day] = list;
    } else if (act === 'del') {
      list.splice(Number(b.closest('.oh-span').dataset.i), 1);
      if (day === PH && !list.length) state.ph = null;
    } else if (act === 'ph-off') {
      state.ph = state.ph === 'off' ? null : 'off';
    } else if (act === 'copy-mo') {
      for (let d = 1; d <= 4; d += 1) state.days[d] = state.days[0].map((s) => [...s]);
    } else if (act === '24/7' || act === 'gone') {
      state.mode = act;
    } else if (act === 'week') {
      if (state.mode === 'raw' || !state.days.some((d) => d.length)) {
        state.days = [...Array(5).fill(null).map(() => [[480, 1080]]), [[480, 780]], []];
        state.ph = null;
      }
      state.mode = 'week';
    } else if (act === 'raw') {
      const text = write(state);
      state.mode = 'raw';
      body.innerHTML = bodyHtml(state, text);
      update();
      body.querySelector('.oh-raw')?.focus();
      return;
    }
    paint();
    update();
  });
}
