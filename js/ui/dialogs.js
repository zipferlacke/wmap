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
 */
import { esc } from '../core/geo.js';

export function ask({ icon = 'help', title, text = '', html = '', buttons, read = null, className = '', setup = null }) {
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
