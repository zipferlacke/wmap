/**
 * Sicherung & Abgleich (sync.html) – Kachel in der Übersicht:
 *
 *   Ordner          verbinden, jetzt abgleichen, trennen, automatisch an/aus;
 *                   letzter Abgleich, Fehler, was im Ordner liegt
 *                   (data/folder.js) – ohne Ordner-Zugriff: Ordner einlesen
 *                   und alles teilen
 *   Health Connect  Neues holen (mit Überblick), automatisch beim Öffnen,
 *                   letzter Abgleich, Freigaben (nur Android-App)
 *   Sicherung       alles als ZIP speichern bzw. einspielen
 */
import { mountAppBar } from '../ui/appbar.js';
import { ask, toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { download } from '../data/store.js';
import { restore } from '../data/tracks.js';
import { folder, zipBackup, restoreZip, importLoose, shareAll, canShareFiles, syncSummary } from '../data/folder.js';
import { healthAvailable, healthStatus, healthSync, syncHealth } from '../services/health.js';
import { healthImportDialog } from '../ui/health-import.js';
import { showPermissions } from '../ui/permissions.js';
import { autoSync } from '../data/auto-sync.js';

const root = document.querySelector('.sync');
const WHEN = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ms) => (ms ? WHEN.format(ms) : 'noch nie');
let busy = { folder: false, health: false };

function toggle(name, label, hint, on) {
  return `<label class="settings-toggle">
      <span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span>
      <input type="checkbox" name="${name}" data-shape="toggle" ${on ? 'checked' : ''}>
    </label>`;
}

const status = (icon, text, cls = '') => `<p class="sync-status ${cls}"><span class="msr">${icon}</span><span>${text}</span></p>`;

/* ── Ordner ───────────────────────────────────────────────────────────────── */

const TREE = `<details class="sync-tree"><summary>Was im Ordner liegt</summary><pre>WMap/
├─ settings.json            Einstellungen
├─ Geplante Touren/         je Tour eine GPX-Datei
├─ Aufgezeichnete Touren/
│  └─ 2026/09 September/    je Weg eine GPX-Datei (mit Puls &amp; Co.)
├─ Bus &amp; Bahn/              je gemerkte Verbindung eine JSON-Datei
└─ Lesezeichen.json         Zuhause, Arbeit, Lesezeichen</pre>
  <p class="settings-hint">Jede WMap, die denselben Ordner verbindet, liest ihn ein und gleicht mit ab. Heißt der Ordner selbst „WMap“, entfällt die Ebene.
    GPX-Dateien von woanders (Garmin, Komoot …) dürfen irgendwo darin liegen.</p></details>`;

async function folderHtml() {
  if (!folder.supported) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${status('folder_off', 'Einen Ordner fest verbinden geht in der WMap-App und in Chrome bzw. Edge. Hier kannst du einen Ordner mit GPX-Dateien einlesen'
        + (canShareFiles() ? ' und alles als Dateien teilen – z. B. in Proton Drive oder Nextcloud.' : '.'))}
      <div class="sync-actions">
        <label class="button"><span class="msr">drive_folder_upload</span> Ordner einlesen<input type="file" webkitdirectory multiple hidden data-file="folder"></label>
        ${canShareFiles() ? '<button type="button" class="button" data-act="share"><span class="msr">ios_share</span> Alles teilen</button>' : ''}
      </div>
      ${TREE}
    </section>`;
  }
  const i = await folder.info().catch((err) => ({ connected: false, error: { message: err.message } }));
  if (!i.connected) {
    return `<section>
      <h3><span class="msr">folder</span> Ordner</h3>
      ${status('folder', 'Kein Ordner verbunden. Verbinde einen Ordner, den dein Sync-Programm abgleicht (Nextcloud, Proton Drive, Google Drive, Syncthing …) – '
        + 'dann haben alle deine Geräte dieselben Touren, Wege, Verbindungen, Lesezeichen und Einstellungen. Am Handy wählst du den Ordner auch direkt in der Drive-App.')}
      <div class="sync-actions"><button type="button" class="button primary" data-act="connect" ${busy.folder ? 'disabled' : ''}><span class="msr">create_new_folder</span> Ordner verbinden</button></div>
      ${TREE}
    </section>`;
  }
  const again = i.permission !== 'granted';
  return `<section>
    <h3><span class="msr">folder_open</span> Ordner</h3>
    ${status('folder_open', `Verbunden mit <strong>${esc(i.name)}</strong>`)}
    ${busy.folder ? status('sync', 'Gleiche ab …', 'busy')
      : again ? status('folder_managed', 'Der Browser braucht wieder deine Erlaubnis für den Ordner.', 'warn')
        : status('schedule', `Letzter Abgleich: ${when(i.last)}${i.last ? ` – ${esc(syncSummary(i.result))}` : ''}`)}
    ${i.error ? status('error', `Fehler am ${when(i.error.at)}: ${esc(i.error.message)}`, 'error') : ''}
    <div class="sync-actions">
      <button type="button" class="button${again ? ' primary' : ''}" data-act="sync" ${busy.folder ? 'disabled' : ''}><span class="msr">sync</span> ${again ? 'Erlauben und abgleichen' : 'Jetzt abgleichen'}</button>
      <button type="button" class="button" data-act="disconnect"><span class="msr">link_off</span> Trennen</button>
    </div>
    ${toggle('folder-auto', 'Automatisch abgleichen', 'Beim Öffnen von WMap und kurz nach jeder Änderung. Aus: nur mit „Jetzt abgleichen“.', folder.auto)}
    ${TREE}
  </section>`;
}

/* ── Health Connect ───────────────────────────────────────────────────────── */

async function healthHtml() {
  if (!healthAvailable) return '';
  const st = await healthStatus().catch((err) => ({ available: false, reason: err.message }));
  const last = healthSync.last();
  const line = !st.available ? status('block', esc(st.reason), 'warn')
    : !st.read ? status('favorite', 'Noch nicht freigegeben – WMap darf Health Connect noch nicht lesen.', 'warn')
      : status('check_circle', `Freigegeben${st.routes ? ', Routen immer' : ', Routen mit Rückfrage'}${st.values ? ', mit Puls &amp; Co.' : ''}`);
  return `<section>
    <h3><span class="msr">favorite</span> Health Connect</h3>
    ${line}
    ${busy.health ? status('sync', 'Hole neue Trainings …', 'busy')
      : status('schedule', `Letzter Abgleich: ${when(last?.at)}${last?.at && !last.error ? ` – ${last.added ? `${last.added} neue Wege` : 'nichts Neues'}${last.denied ? `, ${last.denied} Routen nicht freigegeben` : ''}` : ''}`)}
    ${last?.error ? status('error', `Fehler: ${esc(last.error)}`, 'error') : ''}
    <div class="sync-actions">
      <button type="button" class="button primary" data-act="health" ${busy.health || !st.available ? 'disabled' : ''}><span class="msr">download</span> Trainings holen</button>
      <button type="button" class="button" data-act="perms"><span class="msr">verified_user</span> Berechtigungen</button>
    </div>
    ${toggle('health-auto', 'Automatisch holen', 'Beim Öffnen von WMap neue Trainings mit Route als Wege übernehmen – ohne Rückfragen, höchstens alle 30 Minuten.', healthSync.auto)}
  </section>`;
}

/* ── Sicherung ────────────────────────────────────────────────────────────── */

const backupHtml = () => `<section>
    <h3><span class="msr">folder_zip</span> Sicherung</h3>
    <p class="settings-hint">Alles in einer ZIP-Datei – dieselbe Ordnung wie im Ordner, dazu eine vollständige Sicherung. Zum Mitnehmen auf ein anderes Gerät oder fürs Archiv.</p>
    <div class="sync-actions">
      <button type="button" class="button" data-act="backup"><span class="msr">folder_zip</span> Sicherung speichern (ZIP)</button>
      <label class="button"><span class="msr">settings_backup_restore</span> Sicherung laden<input type="file" accept=".zip,.json,application/zip,application/json" hidden data-file="restore"></label>
    </div>
  </section>`;

async function render() {
  root.innerHTML = `${await folderHtml()}${await healthHtml()}${backupHtml()}
    <p class="settings-hint sync-note"><span class="msr">lock</span> Alles bleibt auf deinen Geräten – WMap hat dafür keinen Server. Was im Ordner liegt, gleicht nur dein eigenes Sync-Programm ab.</p>`;
}

/* ── Knöpfe ───────────────────────────────────────────────────────────────── */

async function syncFolder(interactive) {
  busy.folder = true; await render();
  try {
    const r = await folder.sync({ interactive });
    if (r?.needsPermission) toast('Ohne Erlaubnis kein Abgleich');
    else if (r) toast(`Abgeglichen – ${syncSummary(r)}`);
  } catch (err) { toast(`Abgleich ging nicht: ${err.message}`); }
  busy.folder = false; await render();
}

root.addEventListener('click', async (e) => {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'connect') {
    busy.folder = true; await render();
    try { const r = await folder.connect(); if (r) toast(`Ordner verbunden – ${syncSummary(r)}`); } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    busy.folder = false; await render();
  }
  if (act === 'sync') syncFolder(true);
  if (act === 'disconnect') {
    const v = await ask({ icon: 'link_off', title: 'Ordner trennen?', text: 'WMap gleicht dann nicht mehr ab. Die Dateien im Ordner und alles in WMap bleiben, wie es ist.',
      buttons: [{ value: 'no', label: 'Abbrechen' }, { value: 'yes', label: 'Trennen', primary: true }] });
    if (v !== 'yes') return;
    await folder.disconnect();
    toast('Ordner getrennt – die Dateien bleiben, wo sie sind');
    render();
  }
  if (act === 'share') { try { await shareAll(); } catch (err) { if (err.name !== 'AbortError') toast(err.message); } }
  if (act === 'health') {
    busy.health = true; await render();
    await healthImportDialog({ changed: async () => {} }).catch((err) => toast(String(err?.message ?? err)));
    busy.health = false; render();
  }
  if (act === 'perms') { await showPermissions({ reason: 'health' }); render(); }
  if (act === 'backup') {
    zipBackup().then((blob) => download(`wmap-sicherung-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'application/zip'))
      .catch((err) => toast(`Sicherung ging nicht: ${err.message}`));
  }
});

root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'folder-auto') { folder.auto = t.checked; toast(t.checked ? 'Ordner wird automatisch abgeglichen' : 'Nur noch mit „Jetzt abgleichen“'); }
  if (t.name === 'health-auto') {
    healthSync.auto = t.checked;
    toast(t.checked ? 'Neue Trainings kommen beim Öffnen von selbst' : 'Trainings nur noch von Hand');
    if (t.checked) { busy.health = true; await render(); await syncHealth({ quiet: true }).catch(() => {}); busy.health = false; render(); }
  }
  const inp = t.closest('[data-file]');
  if (!inp?.files?.length) return;
  try {
    if (inp.dataset.file === 'folder') {
      const r = await importLoose(inp.files);
      toast(r.imported ? `${r.imported} übernommen${r.skipped ? `, ${r.skipped} gab es schon` : ''}` : r.skipped ? 'Alles schon da' : 'Keine GPX-Dateien gefunden');
    } else {
      const f = inp.files[0];
      const n = /\.zip$/i.test(f.name) || f.type === 'application/zip' ? await restoreZip(f) : await restore(await f.text());
      toast(`${n} Einträge aus der Sicherung übernommen`);
    }
  } catch (err) { toast(err.message); }
  inp.value = '';
});

addEventListener('wmap:folder', () => render());
// Aus den Einstellungen von Android bzw. Health Connect zurück: Stand neu
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

mountAppBar();
await render();
autoSync();
