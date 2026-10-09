/**
 * Datei und vorhandene Tour zusammenführen – mit Haken (pages/wege.js Vorschau einer geöffneten Datei,
 * mehrere Dateien und Ordner-Abgleich ui/import-ask.js, doppelte Touren ui/duplicates-ask.js): Je Angabe, die die Datei anders hat, ein Haken „aus der
 * Datei übernehmen“. Angehakt ist, wo die genaueren Daten gewinnen (data/duplicates.js choices); ändern kann man
 * jeden. „Zusammenführen“ → { shape, hr, cad, pow, marks }, „Abbrechen“ → null (nichts passiert).
 */
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { cadName } from '../data/track-look.js';

const label = (keep, k) => ({ shape: 'Strecke, Zeit und Kilometer', hr: 'Puls', cad: cadName(keep), pow: 'Leistung', marks: 'Runden der Uhr' }[k]);

/**
 * `list` aus choices(keep, file); `extra`: weitere Knöpfe vor „Abbrechen“ ([{ value, label, icon, picks }]) →
 * die Haken, der value eines weiteren Knopfs (mit `picks: true`: { value, picks }) oder null.
 * `title`, `go` (Hauptknopf) und `from` („Aus der Datei … übernehmen:“) lassen sich ersetzen
 */
export async function askMerge(keep, list, { fileName = '', extra = [], auto = false, title = 'Zusammenführen', go = 'Zusammenführen', from = null } = {}) {
  const read = (dlg) => Object.fromEntries([...dlg.querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]));
  const r = await ask({
    auto, icon: 'merge', title, className: 'merge-ask stacked',
    html: `<p>Diese Tour gibt es schon: „${esc(keep.name ?? 'Tour')}“. ${esc(from ?? (fileName ? `Aus der Datei „${fileName}“ übernehmen:` : 'Aus der Datei übernehmen:'))}</p>
      ${list.map((c) => `<label class="settings-toggle"><span><strong>${esc(label(keep, c.key))}</strong><small>${esc(c.detail)}</small></span>
        <input type="checkbox" data-pick="${c.key}" data-shape="toggle" ${c.on ? 'checked' : ''}></label>`).join('')}
      <p class="muted">Name, Art und Farbe der Tour bleiben. Ohne Haken bleibt, was hier steht.</p>`,
    buttons: [
      { value: 'merge', label: go, icon: 'merge', primary: true, run: (dlg, done) => done(read(dlg)) },
      ...extra.map((b) => (b.picks ? { ...b, run: (dlg, done) => done({ value: b.value, picks: read(dlg) }) } : b)),
      { value: 'no', label: 'Abbrechen' },
    ],
  });
  return r === 'no' ? null : r;
}
