/**
 * Kleine Rückfragen als Dialog aus wuefl-libs.
 *
 *   const v = await ask({ icon: 'wifi_off', title: '…', text: '…',
 *     buttons: [{ value: 'no', label: 'Nein' }, { value: 'yes', label: 'Ja', primary: true }] });
 *
 * → Wert des gedrückten Knopfs, null bei Esc oder ✕ (oben rechts). `className` kommt zu
 *   „dialog confirm“ dazu (z. B. „stacked“: Knöpfe untereinander).
 * Mit `read(dlg)` liefert der
 *   Hauptknopf (primary) stattdessen dessen Ergebnis – z. B. ein Eingabefeld;
 *   Enter im Feld drückt den Hauptknopf. `setup(dlg, done)` läuft nach dem
 *   Öffnen – für eigene Knöpfe im Text; `done(v)` schließt mit Wert v.
 * `auto: true`: der Dialog kommt von selbst – er wartet, bis kein anderer
 *   offen ist (whenFree).
 */
import { esc } from '../core/geo.js';

/*
 * Dialoge, die von selbst kommen (Willkommen, Neuigkeiten, „Navigation
 * fortsetzen?“, 3D im Mobilfunk), warten aufeinander: nie zwei übereinander,
 * keiner mitten in einen offenen hinein. Was man selbst antippt, kommt sofort.
 */
let line = Promise.resolve();
// Nur echte Dialoge (showModal) – Blätter und Leisten, die als <dialog open>
// dauerhaft dastehen, zählen nicht
const open = () => { try { return !!document.querySelector('dialog:modal'); } catch { return false; } };
/** Platz in der Reihe → Promise, erfüllt, sobald kein Dialog mehr offen ist */
export function whenFree() {
  const turn = line.then(() => (open() ? new Promise((done) => {
    const t = setInterval(() => { if (!open()) { clearInterval(t); done(); } }, 250);
  }) : null));
  line = turn;
  return turn;
}

/** `auto`: kommt von selbst (nicht auf einen Tipp hin) – wartet, bis kein anderer Dialog offen ist */
export function ask({ auto = false, ...opts }) {
  return auto ? whenFree().then(() => show(opts)) : show(opts);
}

function show({ icon = 'help', title, text = '', html = '', buttons, read = null, className = '', setup = null }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dialog confirm ${className}`.trim();
    dlg.innerHTML = `
      <button type="button" class="dialog-x" aria-label="Schließen" title="Schließen"><span class="msr">close</span></button>
      <h2><span class="msr">${esc(icon)}</span> ${esc(title)}</h2>
      ${text ? `<p>${esc(text)}</p>` : ''}${html}
      <div class="confirm-actions">${buttons.map((b) => `
        <button type="button" class="button${b.primary ? ' primary' : ''}" value="${esc(b.value)}">
          ${b.icon ? `<span class="msr">${esc(b.icon)}</span> ` : ''}${esc(b.label)}</button>`).join('')}
      </div>`;
    document.body.append(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const primary = buttons.find((b) => b.primary)?.value;
    const pick = (v) => done(read && v === primary ? read(dlg) : v);
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('.dialog-x')) { done(null); return; }
      const b = e.target.closest('.confirm-actions button[value]');
      if (b) pick(b.value);
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input') && primary !== undefined) { e.preventDefault(); pick(primary); }
    });
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
    dlg.querySelector('input:not([readonly])')?.focus();
    setup?.(dlg, done);
  });
}

/**
 * Kurze Meldung unten – für alle Seiten. Mit `action` ({ label, run }) steht
 * ein Knopf daneben, und die Meldung bleibt länger stehen.
 */
export function toast(text, { action } = {}) {
  // Autobildschirm: auch dort kurz zeigen (car/car.js)
  window.wmapCarToast?.(text);
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-action', textContent: action.label });
    b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), action ? 9000 : 3500);
}
