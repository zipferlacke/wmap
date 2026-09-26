/**
 * Kleine Rückfragen als Dialog aus wuefl-libs.
 *
 *   const v = await ask({ icon: 'wifi_off', title: '…', text: '…',
 *     buttons: [{ value: 'no', label: 'Nein' }, { value: 'yes', label: 'Ja', primary: true }] });
 *
 * → Wert des gedrückten Knopfs, null bei Esc
 */
import { esc } from './geo.js';

export function ask({ icon = 'help', title, text = '', html = '', buttons }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog confirm';
    dlg.innerHTML = `
      <h2><span class="msr">${esc(icon)}</span> ${esc(title)}</h2>
      ${text ? `<p>${esc(text)}</p>` : ''}${html}
      <div class="confirm-actions">${buttons.map((b) => `
        <button type="button" class="button${b.primary ? ' primary' : ''}" value="${esc(b.value)}">
          ${b.icon ? `<span class="msr">${esc(b.icon)}</span> ` : ''}${esc(b.label)}</button>`).join('')}
      </div>`;
    document.body.append(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('.confirm-actions button[value]');
      if (b) done(b.value);
    });
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
  });
}
