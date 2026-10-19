/**
 * Datei und vorhandene Tour zusammenführen (pages/wege.js Vorschau einer geöffneten Datei, mehrere Dateien und
 * Ordner-Abgleich ui/import-ask.js, doppelte Touren ui/duplicates-ask.js). Oben steht, was „Neu“ ist (die Datei
 * bzw. die doppelte Aufzeichnung) und was „Bisher“ (die Tour, die bleibt). Je Angabe, die sich unterscheidet, eine
 * Zeile mit beiden Werten – gewählt ist, wo die genaueren Daten sind (data/duplicates.js choices); „Neu“ ersetzt
 * das Bisherige. „Strecke · Zeit · Kilometer“ ist eine Angabe: alle drei kommen aus denselben Punkten.
 * „Zusammenführen“ → { shape, hr, cad, pow, marks } (true: Neu), „Abbrechen“ → null (nichts passiert).
 *
 * Neue Datei ohne vorhandene Tour (Einträge ohne `old`/`new`): je Messwert ein Haken, ob er mitkommt.
 */
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { cadName } from '../data/track-look.js';

const label = (keep, k) => ({ shape: 'Strecke · Zeit · Kilometer', hr: 'Puls', cad: cadName(keep), pow: 'Leistung', marks: 'Runden der Uhr' }[k]);
const hint = { shape: 'gehören zusammen – sie kommen aus denselben Punkten' };

/**
 * `list` aus choices(keep, file); `extra`: weitere Knöpfe vor „Abbrechen“ ([{ value, label, icon, picks }]) →
 * die Wahl, der value eines weiteren Knopfs (mit `picks: true`: { value, picks }) oder null.
 * `title`, `go` (Hauptknopf) und `from` (die ganze Frage oben) lassen sich ersetzen; `cancel: false`: ohne
 * „Abbrechen“ (mehrere Dateien – dort heißt Aufhören „Später weitermachen“). `newName`, `oldName`: was „Neu“ und
 * „Bisher“ ist
 */
export async function askMerge(keep, list, { fileName = '', extra = [], auto = false, title = 'Zusammenführen', go = 'Zusammenführen', from = null, cancel = true, icon = 'merge',
  newName = null, oldName = null, note = null } = {}) {
  const both = list.some((c) => c.old != null);
  // [data-pick] steht am Haken bzw. am Knopf „Neu“ – gewählt heißt: aus der Datei
  const read = (dlg) => Object.fromEntries([...dlg.querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]));
  const neu = newName ?? (fileName ? `die Datei „${fileName}“` : 'die Datei');
  const bisher = oldName ?? `die Tour „${keep.name ?? 'Tour'}“, wie sie in WMap ist`;
  const rows = both
    ? list.map((c) => `<fieldset class="merge-row"><legend><strong>${esc(label(keep, c.key))}</strong>${hint[c.key] ? `<small>${esc(hint[c.key])}</small>` : ''}</legend>
        <label class="merge-side"><input type="radio" name="m-${c.key}" data-pick="${c.key}" value="new" ${c.on ? 'checked' : ''}><b>Neu</b><span>${esc(c.new ?? '')}</span></label>
        <label class="merge-side"><input type="radio" name="m-${c.key}" value="old" ${c.on ? '' : 'checked'}><b>Bisher</b><span>${esc(c.old ?? '')}</span></label>
      </fieldset>`).join('')
    : list.map((c) => `<label class="settings-toggle"><span><strong>${esc(label(keep, c.key))}</strong><small>${esc(c.detail)}</small></span>
        <input type="checkbox" data-pick="${c.key}" data-shape="toggle" ${c.on ? 'checked' : ''}></label>`).join('');
  const r = await ask({
    auto, icon, title, className: 'merge-ask stacked',
    html: `<p>${esc(from ?? `Die Tour „${keep.name ?? 'Tour'}“ gibt es schon.`)}</p>
      ${both ? `<dl class="merge-legend"><dt>Neu</dt><dd>${esc(neu)}</dd><dt>Bisher</dt><dd>${esc(bisher)}</dd></dl>` : ''}
      ${rows}
      <p class="muted">${esc(note ?? (both ? 'Je Zeile: „Neu“ ersetzt das Bisherige, „Bisher“ lässt es, wie es ist. Name, Art und Farbe bleiben immer die bisherigen.' : 'Ohne Haken kommt der Messwert nicht mit.'))}</p>`,
    buttons: [
      { value: 'merge', label: go, icon, primary: true, run: (dlg, done) => done(read(dlg)) },
      ...extra.map((b) => (b.picks ? { ...b, run: (dlg, done) => done({ value: b.value, picks: read(dlg) }) } : b)),
      ...(cancel ? [{ value: 'no', label: 'Abbrechen' }] : []),
    ],
  });
  return r === 'no' ? null : r;
}
