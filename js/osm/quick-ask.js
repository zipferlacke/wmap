/**
 * Kurze Frage wie bei Google Maps: eine Karte unten mit zwei, drei großen
 * Knöpfen – „Baustelle noch da? Ja / Nein“. Blockiert nichts, verschwindet
 * nach einer Weile von selbst (Leiste zeigt die Zeit) und stellt immer nur
 * eine Frage auf einmal; weitere warten in einer Schlange.
 *
 *   const v = await quickAsk({ icon: 'construction', title: 'Baustelle noch da?',
 *     options: [{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }] });
 *
 * input: true zeigt ein Textfeld (Vermerk) mit „Senden“ – Wert ist dann der Text.
 * → Wert des Knopfs, der Text, oder null (weggeklickt, abgelaufen)
 *
 * pill: true – noch kleiner, für Fragen unterwegs (app/ask-along.js): links
 * ein ✕, die Frage, rechts klein „Bestätigen“ in Grün.
 * → 'yes' (bestätigt), 'no' (✕) oder null (abgelaufen)
 * urgent: true (Meldungen: „Immer noch Stau?“) – schiebt eine gerade
 * gezeigte Pille weg (sie endet mit null) und kommt sofort.
 */
import { esc } from '../core/geo.js';

let chain = Promise.resolve();
/** Beendet die gerade gezeigte Pille */
let closePill = null;

export function quickAsk(opts) {
  if (opts.urgent) closePill?.(null);
  const run = chain.then(() => show(opts));
  chain = run.catch(() => null);
  return run;
}

function show(opts) {
  return opts.pill ? pill(opts) : card(opts);
}

function pill({ icon = 'help', title, timeout = 12000, no = 'Nein, nicht fragen' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'quick-ask pill';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <button type="button" class="qa-no" title="${esc(no)}"><span class="msr">close</span></button>
      <span class="msr qa-icon">${esc(icon)}</span>
      <strong>${esc(title)}</strong>
      <button type="button" class="qa-yes">Bestätigen</button>
      <div class="qa-timer"><span style="animation-duration:${timeout}ms"></span></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const timer = setTimeout(() => done(null), timeout);
    closePill = done;
    function done(v) {
      clearTimeout(timer);
      if (closePill === done) closePill = null;
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
      resolve(v);
    }
    el.querySelector('.qa-no').addEventListener('click', () => done('no'));
    el.querySelector('.qa-yes').addEventListener('click', () => done('yes'));
  });
}

function card({ icon = 'help', title, sub = '', options = [], input = false, placeholder = '', timeout = 15000, note = '' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'quick-ask';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <div class="qa-head">
        <span class="msr qa-icon">${esc(icon)}</span>
        <div><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
        <button type="button" class="button qa-close" data-shape="round no-background" title="Schließen"><span class="msr">close</span></button>
      </div>
      ${input ? `<form class="qa-input"><input type="text" placeholder="${esc(placeholder)}" maxlength="300" enterkeyhint="send">
        <button type="submit" class="button primary"><span class="msr">send</span></button></form>` : ''}
      <div class="qa-options">${options.map((o) => `
        <button type="button" class="button${o.primary ? ' primary' : ''}" data-v="${esc(o.value)}">${o.icon ? `<span class="msr">${esc(o.icon)}</span> ` : ''}${esc(o.label)}</button>`).join('')}</div>
      ${note ? `<p class="qa-note">${esc(note)}</p>` : ''}
      <div class="qa-timer"><span style="animation-duration:${timeout}ms"></span></div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('show'));

    let timer = setTimeout(() => done(null), timeout);
    // Wer tippt, bekommt Zeit
    el.addEventListener('focusin', () => { clearTimeout(timer); el.classList.add('hold'); });
    function done(v) {
      clearTimeout(timer);
      timer = null;
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
      resolve(v);
    }
    el.querySelector('.qa-close').addEventListener('click', () => done(null));
    el.querySelector('.qa-options').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) done(b.dataset.v);
    });
    el.querySelector('.qa-input')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = el.querySelector('.qa-input input').value.trim();
      done(text || null);
    });
  });
}
