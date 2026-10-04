/**
 * Datei und vorhandene Tour zusammenführen – mit Haken (pages/wege.js Vorschau einer geöffneten Datei,
 * pages/import.js, Ordner-Abgleich ui/folder-inbox.js): Je Angabe, die die Datei anders hat, ein Haken „aus der
 * Datei übernehmen“. Angehakt ist, wo die genaueren Daten gewinnen (data/duplicates.js choices); ändern kann man
 * jeden. „Zusammenführen“ → { shape, hr, cad, pow, marks }, „Abbrechen“ → null (nichts passiert).
 */
import { ask } from './dialogs.js';
import { esc } from '../core/geo.js';
import { cadName } from '../data/track-look.js';

const label = (keep, k) => ({ shape: 'Strecke, Zeit und Kilometer', hr: 'Puls', cad: cadName(keep), pow: 'Leistung', marks: 'Runden der Uhr' }[k]);

/** `list` aus choices(keep, file); `extra`: weitere Knöpfe vor „Abbrechen“ ([{ value, label, icon }]) → Auswahl, deren value oder null */
export async function askMerge(keep, list, { fileName = '', extra = [], auto = false } = {}) {
  const r = await ask({
    auto, icon: 'merge', title: 'Zusammenführen', className: 'merge-ask stacked',
    html: `<p>Diese Tour gibt es schon: „${esc(keep.name ?? 'Tour')}“.${fileName ? ` Aus der Datei „${esc(fileName)}“ übernehmen:` : ' Aus der Datei übernehmen:'}</p>
      ${list.map((c) => `<label class="settings-toggle"><span><strong>${esc(label(keep, c.key))}</strong><small>${esc(c.detail)}</small></span>
        <input type="checkbox" data-pick="${c.key}" ${c.on ? 'checked' : ''}></label>`).join('')}
      <p class="muted">Name, Art und Farbe der Tour bleiben. Ohne Haken bleibt, was hier steht.</p>`,
    buttons: [
      { value: 'merge', label: 'Zusammenführen', icon: 'merge', primary: true, run: (dlg, done) => done(Object.fromEntries([...dlg.querySelectorAll('[data-pick]')].map((x) => [x.dataset.pick, x.checked]))) },
      ...extra,
      { value: 'no', label: 'Abbrechen' },
    ],
  });
  return r === 'no' ? null : r;
}
