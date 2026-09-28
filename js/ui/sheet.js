/**
 * Bottom-Sheet in frei wählbarer Höhe.
 *
 * Am Griff ziehen ändert die Höhe stufenlos, ein Doppelklick (oder Doppeltipp)
 * springt zwischen ganz offen und dem Minimum. „Ganz offen“ heißt: so hoch wie
 * der Inhalt, höchstens 3/4 des Bildschirms. Das Minimum zeigt nur Kopf und
 * Aktionsleiste der sichtbaren Ansicht – bei einer Route also Zeit, Strecke
 * und „Starten“.
 */
export class Sheet {
  #el; #grip; #onResize; #lastTap = 0;

  /**
   * @param {HTMLElement} el         der Dialog
   * @param {object}      opts
   * @param {Function}    opts.onResize   nach dem Ziehen bzw. Umschalten
   * @param {Function}    opts.topLimit   oberste erlaubte Kante in px (z. B. unter der Suchleiste)
   */
  constructor(el, { onResize, topLimit = () => 0 } = {}) {
    this.#el = el;
    this.#grip = el.querySelector('.sheet-grip');
    this.#onResize = onResize;
    this.topLimit = topLimit;

    let startY = null, startH = 0, moved = false;
    this.#grip.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      startH = el.getBoundingClientRect().height;
      moved = false;
      this.#grip.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    this.#grip.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      if (moved) this.height = startH - dy;
    });
    const end = () => {
      if (startY === null) return;
      startY = null;
      el.classList.remove('dragging');
      if (moved) { this.#onResize?.(); return; }
      // Doppeltipp von Hand erkennen – dblclick kommt auf Touch nicht zuverlässig
      const now = Date.now();
      if (now - this.#lastTap < 350) { this.toggle(); this.#lastTap = 0; } else this.#lastTap = now;
    };
    this.#grip.addEventListener('pointerup', end);
    this.#grip.addEventListener('pointercancel', end);
    this.#grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
    });
  }

  /**
   * Obergrenze: höchstens 3/4 des Bildschirms, nie über die Suchleiste und nie
   * höher als der Inhalt – bei wenig Inhalt bleibt das Sheet klein.
   */
  get max() {
    const limit = Math.min(window.innerHeight * 0.75, window.innerHeight - this.topLimit() - 8);
    return Math.max(this.min, Math.min(limit, this.natural));
  }

  /** So hoch, wie der Inhalt es braucht (auch wenn er gerade eingeklappt ist). */
  get natural() {
    const atMin = this.#el.classList.contains('at-min');
    const { height, maxHeight } = this.#el.style;
    this.#el.classList.remove('at-min');
    this.#el.style.height = 'auto';
    this.#el.style.maxHeight = 'none';
    const h = this.#el.scrollHeight;
    this.#el.style.height = height;
    this.#el.style.maxHeight = maxHeight;
    this.#el.classList.toggle('at-min', atMin);
    return h;
  }

  /** Kopf + Aktionen der sichtbaren Ansicht + Griff. */
  get min() {
    const view = [...this.#el.querySelectorAll('.view')].find((v) => !v.hidden);
    const part = (s) => view?.querySelector(`:scope > ${s}`)?.getBoundingClientRect().height ?? 0;
    const style = getComputedStyle(this.#el);
    return Math.ceil(this.#grip.getBoundingClientRect().height + part('.sheet-head') + part('.sheet-actions')
      + parseFloat(style.paddingBottom) + 12);
  }

  set height(px) {
    const h = Math.round(Math.min(this.max, Math.max(this.min, px)));
    this.#el.style.height = `${h}px`;
    this.#el.style.maxHeight = 'none';
    this.#el.classList.toggle('at-min', h <= this.min + 2);
  }

  /** Ganz auf (so weit der Inhalt reicht) oder aufs Minimum. */
  toggle() {
    const h = this.#el.getBoundingClientRect().height;
    const max = this.max;
    this.height = h >= max - 20 ? this.min : max;
    this.#el.scrollTop = 0;
    this.#onResize?.();
  }

  /** Zurück auf „so hoch wie der Inhalt“ (mit der Obergrenze aus dem CSS). */
  reset() {
    this.#el.style.height = '';
    this.#el.style.maxHeight = '';
    this.#el.classList.remove('at-min');
  }
}
