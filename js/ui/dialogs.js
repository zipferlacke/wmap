/**
 * Kleine Rückfragen – der `userDialog` aus wuefl-libs (am Rechner mittig, am Handy von unten).
 *
 *   const v = await ask({ icon: 'wifi_off', title: '…', text: '…',
 *     buttons: [{ value: 'no', label: 'Nein' }, { value: 'yes', label: 'Ja', primary: true }] });
 *
 * → Wert des gedrückten Knopfs, null bei Esc oder ✕ (oben rechts). `className` kommt zu
 *   „userDialog confirm“ dazu (z. B. „stacked“: Knöpfe untereinander), `id` wird die ID des Dialogs.
 * Mit `read(dlg)` liefert der
 *   Hauptknopf (primary) stattdessen dessen Ergebnis – z. B. ein Eingabefeld;
 *   Enter im Feld drückt den Hauptknopf. `setup(dlg, done)` läuft nach dem
 *   Öffnen – für eigene Knöpfe im Text; `done(v)` schließt mit Wert v.
 * Ein Knopf mit `run(dlg, done)` schließt nicht von selbst (Probe hören, erst nachfragen, erst laden …).
 * `closable: false`: kein ✕, Esc wirkt nicht – nur die Knöpfe führen heraus.
 * `auto: true`: der Dialog kommt von selbst – er wartet, bis kein anderer
 *   offen ist (whenFree).
 *
 * Ein Hauptknopf und höchstens ein zweiter stehen in der Fußzeile der Bibliothek (`confirmText`/`cancelText`);
 * mehr Knöpfe, „stacked“ und Knöpfe mit `run` kennt sie nicht – die stehen als eigene Zeile im Inhalt.
 */
import { userDialog } from '../../libs/wuefl-libs/userDialog/userDialog.js';
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

let count = 0;
function show({ icon = 'help', title, text = '', html = '', buttons, read = null, className = '', setup = null, closable = true, id = null }) {
  const primary = buttons.find((b) => b.primary);
  const rest = buttons.filter((b) => b !== primary);
  const footer = !!primary && rest.length <= 1 && !buttons.some((b) => b.run) && !/\bstacked\b/.test(className);
  const label = (b) => `${b.icon ? `<span class="msr">${esc(b.icon)}</span> ` : ''}${esc(b.label)}`;
  const dialogId = id ?? `ask-${Date.now()}-${++count}`;
  let dlg = null;
  let picked = null;                 // { v }: über einen eigenen Knopf oder done() geschlossen
  const done = (v) => { picked = { v }; dlg.uDFinish('pick'); };
  const pick = (v) => done(read && primary && v === primary.value ? read(dlg) : v);

  const result = userDialog({
    id: dialogId,
    title: `<span class="msr">${esc(icon)}</span> ${esc(title)}`,
    content: `${text ? `<p>${esc(text)}</p>` : ''}${html}${footer ? '' : `
      <div class="confirm-actions">${buttons.map((b) => `
        <button type="button" class="button${b.primary ? ' primary' : ''}" value="${esc(b.value)}">${label(b)}</button>`).join('')}
      </div>`}`,
    ...(footer ? { confirmText: label(primary), ...(rest[0] ? { cancelText: label(rest[0]) } : { onlyConfirm: true }) } : {}),
    barRight: closable ? { icon: '<span class="msr">close</span>', title: 'Schließen', action: 'close' } : null,
    onInsert() {
      dlg = document.getElementById(dialogId);
      dlg.classList.add('confirm', ...className.split(/\s+/).filter(Boolean));
      // Vor den Listenern der Bibliothek: Im Inhalt stehen eigene Knöpfe und Felder – abgeschickt wird nur über
      // ihren Hauptknopf, und Esc schließt mit „nichts gewählt“ (null) statt mit dem zweiten Knopf
      dlg.querySelector('form').addEventListener('submit', (e) => {
        if (!e.submitter?.matches('.dialog_submit')) { e.preventDefault(); e.stopImmediatePropagation(); }
      });
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault(); e.stopImmediatePropagation();
        if (closable) dlg.uDFinish('close');
      });
      if (footer) {
        // Dieselben Namen wie die eigene Knopfzeile – Stile und Tests finden beide gleich
        dlg.querySelector('.uD-footer').classList.add('confirm-actions');
        dlg.querySelector('.dialog_submit').value = primary.value;
        dlg.querySelector('.dialog_submit').classList.add('primary');
        if (rest[0]) dlg.querySelector('.dialog_close').value = rest[0].value;
        else dlg.querySelector('.dialog_close').remove();   // onlyConfirm blendet ihn nur aus
      }
    },
  });

  if (!footer) {
    dlg.addEventListener('click', (e) => {
      const el = e.target.closest('.confirm-actions button[value]');
      if (!el) return;
      const b = buttons.find((x) => String(x.value) === el.value);
      if (b?.run) b.run(dlg, done); else pick(el.value);
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input') && primary && !primary.run) { e.preventDefault(); pick(primary.value); }
    });
  }
  // Fokus ins erste Feld, sonst auf das ✕ – nicht auf den Griff (stünde hervorgehoben da) und nicht auf den
  // Hauptknopf (Enter löschte sonst gleich)
  const first = dlg.querySelector('input:not([readonly])') ?? dlg.querySelector('.uD-bar-right');
  if (first) first.focus(); else document.activeElement?.blur();
  setup?.(dlg, done);

  return result.then((r) => {
    if (picked) return picked.v;
    // Der Dialog ist schon aus dem Dokument – seine Felder lassen sich trotzdem noch lesen
    if (r.action === 'submit') return read ? read(dlg) : String(primary.value);
    if (r.action === 'cancel' && footer && rest[0]) return String(rest[0].value);
    return null;
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
