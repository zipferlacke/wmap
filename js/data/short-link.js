/**
 * Kurzer Link beim Teilen (bEnd/api_share.php). Sonst steckt alles im Link selbst – bei einer langen
 * Aufzeichnung wird er für manches Chatfeld zu lang. Auf Wunsch liegt der gepackte Inhalt dann 30 Tage auf dem
 * WMap-Server (unverschlüsselt), der Link trägt nur die Kennung:
 *
 *   wege.html#k=<Kennung>   geteilte Aufzeichnung (sonst #weg=…)
 *   tour.html#k=<Kennung>   geteilte Tour (sonst #t=…)
 *
 * Wer so einen Link öffnet, bekommt den Inhalt vom Server und sieht danach dasselbe wie mit dem langen Link
 * (resolveShort setzt ihn in die Adresse).
 */
import { api } from '../services/api.js';
import { pageUrl } from '../ui/share.js';

const PAGE = { weg: ['wege.html', 'weg'], tour: ['tour.html', 't'] };

/** Inhalt hochladen → kurzer Link (wirft mit lesbarer Meldung) */
export async function shortLink(kind, code) {
  const { id } = await api(['share', 'put'], { kind, code });
  return `${pageUrl(PAGE[kind][0])}#k=${id}`;
}

/** Steht ein kurzer Link in der Adresse (#k=…): Inhalt holen und als langen einsetzen → true | Fehlermeldung | null (kein kurzer Link) */
export async function resolveShort() {
  const id = location.hash.match(/^#k=([A-Za-z0-9]+)$/)?.[1];
  if (!id) return null;
  try {
    const { kind, code } = await api(['share', 'get'], { id });
    history.replaceState(null, '', `${location.pathname}${location.search}#${PAGE[kind][1]}=${code}`);
    return true;
  } catch (err) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return err.message || 'Der Link ließ sich nicht öffnen';
  }
}
