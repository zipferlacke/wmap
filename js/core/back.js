/**
 * Zurück überall gleich: Die Zurück-Taste des Handys (Android: Verlauf der WebView) und des Browsers wirkt wie der
 * Zurück-Knopf dessen, was gerade oben liegt.
 *
 *   Modaler Dialog (Rückfrage, Diagramm im Vollbild …)  geht zu – die Seite bleibt. Beim Öffnen legt er einen
 *                                                       Eintrag in den Verlauf, beim Schließen per Knopf geht der
 *                                                       still wieder weg.
 *   sonst                                               die Seite selbst: Karte (app/views.js), Meine Touren
 *                                                       (pages/wege.js) und Plugins führen ihren eigenen Verlauf;
 *                                                       Seiten ohne trapBack(), deren ← auf eine andere Seite
 *                                                       führt, verlässt Zurück wie gewohnt.
 *
 *   trapBack(press)  Seite ohne eigenen Verlauf mit Detailansichten (Entdecken): `press()` drückt den ←-Knopf,
 *                    der gerade gilt, und gibt true – false heißt, es gibt keinen (Zurück verlässt die Seite)
 *   [data-back]      Seiten ohne eigenen Verlauf, deren ← auf eine andere Seite führt (Offline-Karten, Eigene
 *                    Ebenen, Tourenplaner …): Zurück drückt den sichtbaren Knopf mit diesem Merkmal – dann führen
 *                    ← und die Zurück-Taste an dieselbe Stelle, nicht an die zuvor besuchte Seite
 *
 * Wird als erstes Modul jeder Seite geladen (eigenes <script> vor dem der Seite): Sein popstate-Lauscher kommt so
 * vor allen anderen dran und hält das Ereignis an, wenn er nur einen Dialog geschlossen hat.
 */

const MODAL = 'wmapModal';
const TRAP = 'wmapTrap';
const open = [];                       // offene modale Dialoge mit eigenem Eintrag, der oberste zuletzt
let skip = 0;                          // so viele popstate kommen von uns (Eintrag still entfernt) – nicht weitergeben
let press = null;                      // trapBack: ←-Knopf der Seite drücken

/*
 * Während das stille Zurück unterwegs ist (es läuft erst nach dem aktuellen Code), warten neue Einträge – sonst
 * träfe es einen Eintrag, den eine Seite gleich nach dem Schließen anlegt (Rückfrage → Ansicht öffnen).
 */
const pushState = history.pushState.bind(history), replaceState = history.replaceState.bind(history);
const waiting = [];
const idle = [];                       // settled(): warten, bis das stille Zurück durch ist
history.pushState = (...a) => (skip ? waiting.push([pushState, a]) : pushState(...a));
history.replaceState = (...a) => (skip ? waiting.push([replaceState, a]) : replaceState(...a));

const showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function (...args) {
  showModal.apply(this, args);
  if (open.includes(this)) return;
  open.push(this);
  pushState({ ...history.state, [MODAL]: open.length }, '');
  this.addEventListener('close', () => {
    const i = open.indexOf(this);
    if (i < 0) return;                 // schon per Zurück geschlossen
    open.splice(i, 1);
    // Per Knopf geschlossen: den Eintrag wieder entfernen, ohne dass die Seite etwas davon merkt
    if (history.state?.[MODAL]) { skip += 1; history.back(); }
  }, { once: true });
};

addEventListener('popstate', (e) => {
  if (skip) {
    skip -= 1;
    e.stopImmediatePropagation();
    if (!skip) {
      for (const [fn, a] of waiting.splice(0)) fn(...a);
      for (const ok of idle.splice(0)) ok();
    }
    return;
  }
  const top = open.at(-1);
  if (top) {
    open.pop();
    e.stopImmediatePropagation();
    // Wie Esc: Dialoge, die beim Abbrechen etwas tun, bekommen ihr cancel
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
    return;
  }
  if (press && !e.state?.[TRAP]) {
    e.stopImmediatePropagation();
    // Gedrückt: der Wächter kommt wieder hin. Kein Knopf: wirklich zurück (die Seite verlassen)
    if (press()) pushState({ [TRAP]: 1 }, ''); else history.back();
  }
}, { capture: true });

/* Ein sichtbarer Knopf mit [data-back] (nach dem Laden gesucht – auch einer, den die Seite erst anlegt) */
const visible = (el) => !!el && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
addEventListener('load', () => {
  if (press || !document.querySelector('[data-back]')) return;
  trapBack(() => {
    const el = [...document.querySelectorAll('[data-back]')].find(visible);
    el?.click();
    return !!el;
  });
});

/**
 * Erst wenn das stille Zurück eines gerade geschlossenen Dialogs durch ist – vorher zu einer anderen Seite
 * wechseln (location.href = …) bricht das nachlaufende history.back() wieder ab: man bliebe auf der Seite
 */
export function settled() {
  return new Promise((ok) => {
    // Das close-Ereignis des Dialogs kommt erst nach dem Schließen (eigene Aufgabe) – kurz warten, dann steht skip
    setTimeout(() => (skip ? idle.push(ok) : ok()), 50);
  });
}

export function trapBack(fn) {
  press = fn;
  if (!history.state?.[TRAP]) pushState({ [TRAP]: 1 }, '');
}
