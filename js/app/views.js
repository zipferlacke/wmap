/**
 * Bottom-Sheet mit Zurück: Stapel der geöffneten Ansichten, Öffnen und Schließen.
 */
import { showPois } from '../map/map.js';
import { Sheet } from '../ui/sheet.js';
import { clearCategory } from './category.js';
import { $, $$, current, debounce, map, q, sheet } from './core.js';
import { nav } from './nav.js';
import { clearPlace, closeOver, resetOver } from './place.js';
import { clearReach } from './reach.js';
import { leaveRouteMode } from './route-plan.js';
import { fitRoute } from './route-results.js';

/* ══════════════════════════════════════════════════════════════════════════
   Bottom-Sheet mit Zurück
   ══════════════════════════════════════════════════════════════════════════ */

const sheetCtl = new Sheet(sheet, {
  onResize: () => recenter(),
  topLimit: () => $('#search').getBoundingClientRect().bottom,
});

/*
 * Jede Ansicht, die man öffnet, landet auf einem Stapel – mit einer Funktion,
 * die sie wiederherstellt. „Zurück“ (Knopf im Sheet oder Zurück-Taste des
 * Handys) holt die vorige. Der Browser-Verlauf läuft mit, damit die
 * Zurück-Taste nicht die Seite verlässt.
 */
export const stack = [];

export function remember(view, restore) {
  stack.push({ view, restore });
  history.pushState({ wmap: stack.length }, '');
  paintBack();
}

export function back() {
  if (history.state?.wmap) history.back();   // → popstate → goBack()
  else goBack();
}

function goBack() {
  const popped = stack.pop();
  if (popped?.view === 'place') closeOver();
  const prev = stack.at(-1);
  if (prev) prev.restore(); else closeAll();
  paintBack();
}

window.addEventListener('popstate', () => { if (stack.length) goBack(); });

/**
 * Eine Ansicht ersetzen statt draufzulegen – z. B. ein zweiter Ort direkt
 * nach dem ersten, damit Zurück zur Liste führt und nicht zum ersten Ort.
 */
export function replaceTop(view, restore) {
  stack[stack.length - 1] = { view, restore };
  paintBack();
}

function paintBack() {
  $('.sheet-back', sheet).hidden = stack.length < 2;
}

export function openSheet(view) {
  if (sheet.dataset.current !== view) sheetCtl.reset();
  $$('.view', sheet).forEach((v) => { v.hidden = v.dataset.view !== view; });
  sheet.dataset.current = view;
  // show() statt showModal(): kein Hintergrund, die Karte bleibt bedienbar
  if (!sheet.open) sheet.show();
  paintBack();
}

export function closeSheet() {
  if (sheet.open) sheet.close();
  delete sheet.dataset.current;
}

/** Alles zu: Sheet, Hervorhebungen, Planung. In der Navigation nur das Sheet. */
export function closeAll() {
  if (nav.active) {
    stack.length = 0;
    clearPlace();
    resetOver();
    showPois(map, []);
    closeSheet();
    paintBack();
    return;
  }
  stack.length = 0;
  resetOver();
  leaveRouteMode();
  clearPlace();
  clearCategory();
  clearReach();
  q.value = '';
  $('#q-clear').hidden = true;
  closeSheet();
  paintBack();
}

$('.sheet-back', sheet).addEventListener('click', back);
$$('.close-sheet', sheet).forEach((b) => b.addEventListener('click', closeAll));

/** Nach Größenänderung: eine Route bleibt mittig im freien Bereich. */
function recenter() {
  if (sheet.dataset.current === 'route' && current()) fitRoute();
}
window.addEventListener('resize', debounce(recenter, 300));
