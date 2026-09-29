/**
 * Health Connect übernehmen – mit Überblick vorher (nach Art und App, mit
 * oder ohne Route, schon übernommen) und danach, was aus welchem Grund
 * fehlt. Aufgerufen von der Seite „Sicherung & Abgleich“ (pages/sync.js).
 */
import { ask, toast } from './dialogs.js';
import { esc } from '../core/geo.js';
import {
  healthSessions, importHealth, knownHealthIds, fillHealthTypes, fillHealthValues, healthSettings,
  appName, typeName, typeIcon,
} from '../services/health.js';
import { local } from '../data/store.js';

/** `changed`: nach Änderungen an den Wegen (neu zeichnen) */
export async function healthImportDialog({ changed = async () => {} } = {}) {
  let list;
  try {
    toast('Health Connect wird gelesen …');
    list = await healthSessions();
  } catch (err) { toast(String(err?.message ?? err)); return; }
  // Ältere Importe kannten die Art noch nicht – nachtragen
  if (await fillHealthTypes(list)) await changed();
  // Puls & Co. für früher übernommene Wege nachladen (einmal je Weg)
  const withValues = await fillHealthValues({ onProgress: (i, total) => { if (i % 10 === 0) toast(`Messwerte nachladen: ${i + 1} von ${total} …`); } });
  if (withValues) { await changed(); toast(`Puls & Co. für ${withValues} ${withValues === 1 ? 'Weg' : 'Wege'} nachgeladen`); }
  const known = await knownHealthIds();
  const n = (x) => x.toLocaleString('de-DE');
  const routed = list.filter((x) => x.route !== 'none');
  const fresh = routed.filter((x) => !known.has(x.id));
  const consent = fresh.filter((x) => x.route === 'consent').length;
  const groups = new Map();
  for (const x of list) {
    const key = `${typeName(x.type)} · ${appName(x.app)}`;
    const g = groups.get(key) ?? { n: 0, route: 0, icon: typeIcon(x.type) };
    g.n += 1;
    if (x.route !== 'none') g.route += 1;
    groups.set(key, g);
  }
  const rows = [...groups].sort((a, b) => b[1].n - a[1].n)
    .map(([k, g]) => `<tr><td><span class="msr">${g.icon}</span> ${esc(k)}</td><td>${g.n}</td><td>${g.route}</td></tr>`).join('');
  const day = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  const recent = list.slice(0, 12).map((x) => `<tr><td>${day.format(x.start)}</td><td><span class="msr">${typeIcon(x.type)}</span> ${esc(typeName(x.type))}</td>
      <td>${known.has(x.id) ? 'übernommen' : x.route === 'data' ? `${n(x.points)} Punkte` : x.route === 'consent' ? 'Route (Rückfrage)' : 'ohne Route'}</td></tr>`).join('');
  const v = await ask({
    icon: 'favorite', title: 'Health Connect', className: consent ? 'news stacked' : 'news',
    html: list.length ? `<p>${n(list.length)} Trainings, davon <strong>${n(routed.length)} mit Route</strong>
        ${routed.length - fresh.length ? ` – ${n(routed.length - fresh.length)} schon übernommen` : ''}.</p>
      <table class="health-table"><thead><tr><th>Art · App</th><th>Trainings</th><th>mit Route</th></tr></thead><tbody>${rows}</tbody></table>
      <h3>Zuletzt</h3>
      <table class="health-table"><tbody>${recent}</tbody></table>
      ${consent ? `<p class="perm-hint"><span class="msr">info</span> Für ${n(consent)} Routen fragt Health Connect einzeln nach.
        Einfacher: in Health Connect WMap antippen und die Trainingsrouten auf „Immer erlauben“ stellen –
        oder bei der ersten Rückfrage „Alle erlauben“ wählen.</p>` : ''}`
      : '<p>Health Connect hat keine Trainings – oder keine, die WMap lesen darf.</p>',
    buttons: [
      ...(consent ? [{ value: 'settings', label: 'Health Connect öffnen', icon: 'settings' }] : []),
      ...(fresh.length
        ? [{ value: 'no', label: 'Abbrechen' }, { value: 'ok', label: `${n(fresh.length)} Routen übernehmen`, icon: 'download', primary: true }]
        : [{ value: 'no', label: 'OK', primary: true }]),
    ],
  });
  if (v === 'settings') { healthSettings('health').catch((err) => toast(err.message ?? String(err))); return; }
  if (v !== 'ok') return;
  let r;
  try {
    r = await importHealth(fresh, { onProgress: (i, total) => { if (i % 5 === 0) toast(`Übernehme ${i + 1} von ${total} …`); } });
    // Wie der automatische Abgleich: Stand für „Sicherung & Abgleich“
    local.set('wmap.health.sync', { at: Date.now(), added: r.added, denied: r.denied, error: null });
  } catch (err) { toast(String(err?.message ?? err)); }
  await changed();
  if (!r) return;
  const why = [
    r.known ? [r.known, 'schon übernommen'] : null,
    r.dup ? [r.dup, 'gleicher Weg schon da (z. B. selbst aufgezeichnet oder aus einer anderen App)'] : null,
    r.empty ? [r.empty, 'kürzer als 200 m oder ohne brauchbare Punkte'] : null,
    r.denied ? [r.denied, 'Route nicht freigegeben – Rückfrage abgelehnt oder abgebrochen'] : null,
  ].filter(Boolean);
  const done = await ask({
    icon: r.added ? 'task_alt' : 'info', title: `${n(r.added)} ${r.added === 1 ? 'Weg' : 'Wege'} übernommen`, className: 'news',
    html: why.length ? `<p>Nicht übernommen:</p>
      <table class="health-table"><tbody>${why.map(([k, t]) => `<tr><td>${esc(t)}</td><td>${n(k)}</td></tr>`).join('')}</tbody></table>
      ${r.denied ? `<p class="perm-hint"><span class="msr">info</span> In Health Connect WMap antippen, die Trainingsrouten auf „Immer erlauben“ stellen
        und dann noch einmal auf „Aus Health Connect“ tippen – übernommen wird nur, was fehlt.</p>` : ''}` : '<p>Alles da.</p>',
    buttons: [
      ...(r.denied ? [{ value: 'settings', label: 'Health Connect öffnen', icon: 'settings' }] : []),
      { value: 'ok', label: 'OK', primary: true },
    ],
  });
  if (done === 'settings') healthSettings('health').catch((err) => toast(err.message ?? String(err)));
}

