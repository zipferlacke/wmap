/**
 * Doppelte Touren – dieselbe Tour aus zwei Quellen (Uhr und Handy, Health Connect und Ordner, zweimal importiert).
 * Sobald es welche gibt, kommt am Anfang die Frage (data/auto-sync.js) – mit denselben Dialogen wie beim Import
 * (ui/import-ask.js):
 *
 *   Ja, überall die genaueren Daten   je Gruppe bleibt die Aufzeichnung mit den meisten Angaben; von den anderen
 *                                     kommt, was fehlt, und Abweichendes von der Seite mit mehr Punkten
 *   Selbst einstellen                 je doppelter Aufzeichnung die Haken, was von ihr übernommen wird
 *   Später                            bleibt, wie es ist – gefragt wird beim nächsten Start wieder. Wer wählen
 *                                     will, welche Aufzeichnung bleibt: „Sicherung & Synchronisation“
 *
 * Geschrieben wird am Ende; „Später weitermachen“ (oder ✕) lässt diese und die übrigen doppelt. Die doppelten gehen wie von Hand gelöscht
 * (der Ordner-Abgleich trägt sie in Gelöscht.json ein).
 */
import { toast } from './dialogs.js';
import { askAll, askOne } from './import-ask.js';
import { findDuplicates, resolveDuplicates } from '../data/duplicates.js';
import { t } from '../core/i18n.js';

const LATER = 'wmap.duplicates.later';
// Woher eine Aufzeichnung kommt – „ (Health Connect · Zepp)“, „ (Datei)“, „ (mit WMap aufgezeichnet)“
const sourceOf = (x) => {
  const s = x.kind === 'health' ? ['Health Connect', x.source?.app].filter(Boolean).join(' · ') : x.kind === 'gpx' ? t('tracks.duplicates.ask.source_file') : x.kind === 'rec' || x.kind === 'nav' ? t('tracks.duplicates.ask.source_wmap') : '';
  return s ? ` (${s})` : '';
};
let asking = false;

/** → Anzahl entfernt, oder null (nichts zu tun, später, abgebrochen). `force`: auch nach „Später“ fragen */
export async function offerDuplicates(force = false) {
  if (asking || (!force && sessionStorage.getItem(LATER))) return null;
  const d = await findDuplicates();
  if (!d.count) return null;
  asking = true;
  try {
    const how = await askAll({
      auto: !force, icon: 'content_copy', later: t('common.later'),
      title: t('tracks.duplicates.ask.title', { n: d.count }),
      text: t('tracks.duplicates.ask.text'),
    });
    if (!how) { sessionStorage.setItem(LATER, '1'); return null; }
    const pairs = d.tracks.reduce((n, g) => n + g.length - 1, 0);
    let rest = how === 'best' ? 'best' : null, i = 0;
    const n = await resolveDuplicates(async (keep, other, list) => {
      if (rest === 'best') return null;
      if (rest) return rest;
      const r = await askOne(keep, list, {
        from: t('tracks.duplicates.ask.from', { name: keep.name ?? t('tracks.names.tour') }),
        newName: t('tracks.duplicates.ask.new_name', { name: other.name && other.name !== keep.name ? ` „${other.name}“` : '', source: sourceOf(other) }),
        oldName: t('tracks.duplicates.ask.old_name', { source: sourceOf(keep) }), i: i++, n: pairs });
      if (r === 'best') { rest = 'best'; return null; }
      if (r === 'later') { rest = 'later'; return 'later'; }
      if (r.same) { rest = r.same; return r.same; }
      return r;
    });
    if (n === null) { sessionStorage.setItem(LATER, '1'); return null; }
    if (rest === 'later') sessionStorage.setItem(LATER, '1');
    toast(n ? t('tracks.duplicates.ask.merged', { n }) : t('tracks.duplicates.ask.nothing'));
    // Listen und Karten neu zeichnen (wie nach einem Abgleich)
    if (n) dispatchEvent(new CustomEvent('wmap:folder', { detail: { duplicates: n } }));
    return n;
  } catch (err) {
    toast(err.message || t('tracks.duplicates.ask.failed'));
    return null;
  } finally { asking = false; }
}
