/**
 * GPX öffnen (import.html). Die Dateien kommen
 *
 *   App (Android, Rechner)   über „Öffnen mit“, „Teilen“ bzw. Doppelklick –
 *                            das Plugin „folder“ hält sie bereit (opened);
 *                            core/theme.js schickt beim Start hierher
 *   installierte Web-App     Dateizuordnung (manifest file_handlers →
 *                            launchQueue) bzw. Teilen-Menü am Handy
 *                            (share_target → sw.js legt sie in „wmap-share“)
 *   sonst                    über die Dateiauswahl hier
 *
 * Je Datei:
 *   Als aufgezeichnete Tour  vorher auf Doppelte prüfen (WMap-ID bzw. gleicher
 *   speichern                Weg), dann speichern und gleich zeigen – geht nur
 *                            mit Zeiten in der Datei
 *   Als geplante Tour öffnen nur öffnen (tour.html#t=…, wie eine geteilte
 *                            Tour) – gespeichert wird erst mit Speichern dort
 */
import { mountAppBar } from '../ui/appbar.js';
import { toast } from '../ui/dialogs.js';
import { esc } from '../core/geo.js';
import { tracks, parseGpx, sameTrack } from '../data/tracks.js';
import { encodeShare } from '../data/store.js';
import { tourFromGpx } from '../data/folder.js';

const root = document.querySelector('.import');
const SHARE = 'wmap-share';
const TIMED = /<trkpt[^>]*>(?:(?!<\/trkpt>)[\s\S])*<time>/;
const DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const km = (m) => `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;

/** [{ name, text, tour, track, id, dup, saved, error }] */
const files = [];

/** Neue Dateien ({ name, text }) aufnehmen und prüfen */
export async function addFiles(list) {
  const all = await tracks.all();
  for (const { name, text } of list) {
    const f = { name: name || 'Datei.gpx', text };
    try {
      f.tour = tourFromGpx(text, f.name);
      if (!f.tour) throw new Error('Keine Strecke in der Datei');
      if (TIMED.test(text)) {
        f.track = parseGpx(text)[0] ?? null;
        // Aus WMap exportiert: die ID steht im Stichwort wmap:…
        f.id = text.match(/<keywords>[^<]*\bwmap:([\w-]+)/)?.[1] ?? f.track?.id;
        f.dup = f.track ? all.find((t) => t.id === f.id || sameTrack(t, f.track)) ?? null : null;
      }
    } catch (err) { f.error = err.message; }
    files.push(f);
  }
  render();
}

function card(f, i) {
  if (f.error) {
    return `<section><h3><span class="msr">error</span> ${esc(f.name)}</h3>
      <p class="sync-status error"><span class="msr">error</span><span>Lässt sich nicht öffnen: ${esc(f.error)}</span></p></section>`;
  }
  const facts = [km(f.tour.stats.length), f.track ? DAY.format(f.track.start) : 'ohne Zeiten'].join(' · ');
  const recorded = f.saved
    ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.saved)}"><span class="msr">visibility</span> Gespeichert – ansehen</a>`
    : f.dup
      ? `<a class="button" href="./wege.html?id=${encodeURIComponent(f.dup.id)}"><span class="msr">content_copy</span> Gibt es schon – ansehen</a>`
      : f.track ? `<button type="button" class="button primary" data-act="track" data-i="${i}"><span class="msr">directions_walk</span> Als aufgezeichnete Tour speichern</button>` : '';
  return `<section>
    <h3><span class="msr">route</span> ${esc(f.tour.name)}</h3>
    <p class="settings-hint">${esc(facts)} · ${esc(f.name)}</p>
    ${!f.track ? '<p class="settings-hint">Ohne Zeiten in der Datei geht sie nur als geplante Tour.</p>' : ''}
    ${f.dup && !f.saved ? `<p class="settings-hint">Diesen Weg hast du schon: „${esc(f.dup.name)}“.</p>` : ''}
    <div class="sync-actions">
      ${recorded}
      <button type="button" class="button${f.track ? '' : ' primary'}" data-act="tour" data-i="${i}"><span class="msr">edit_road</span> Als geplante Tour öffnen</button>
    </div>
  </section>`;
}

function render() {
  root.innerHTML = `${files.length ? files.map(card).join('') : `<section>
      <h3><span class="msr">upload_file</span> GPX-Datei öffnen</h3>
      <p class="settings-hint">Wähle eine GPX-Datei – z. B. von Garmin, Komoot oder einer anderen App. Mit Zeiten kannst du sie als aufgezeichnete Tour speichern, sonst als geplante Tour öffnen.</p>
    </section>`}
    <section>
      <div class="sync-actions">
        <label class="button"><span class="msr">folder_open</span> ${files.length ? 'Weitere Datei wählen' : 'Datei wählen'}<input type="file" accept=".gpx,application/gpx+xml" multiple hidden data-file="gpx"></label>
      </div>
    </section>`;
}

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const f = files[Number(b.dataset.i)];
  if (!f) return;
  if (b.dataset.act === 'track') {
    // Kurz vorher noch einmal: vielleicht kam er inzwischen über den Ordner
    const dup = (await tracks.all()).find((t) => t.id === f.id || sameTrack(t, f.track));
    if (dup) { f.dup = dup; render(); toast('Diesen Weg gibt es schon'); return; }
    const t = { ...f.track, id: f.id ?? f.track.id, updated: Date.now() };
    await tracks.put(t);
    f.saved = t.id;
    if (files.length === 1) { location.href = `./wege.html?id=${encodeURIComponent(t.id)}`; return; }
    toast(`„${t.name}“ gespeichert`);
    render();
  }
  if (b.dataset.act === 'tour') {
    // Wie eine geteilte Tour: ansehen, gespeichert wird erst dort
    location.href = `./tour.html#t=${await encodeShare(f.tour)}`;
  }
});

root.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-file="gpx"]');
  if (!inp?.files?.length) return;
  await addFiles(await Promise.all([...inp.files].map(async (x) => ({ name: x.name, text: await x.text() }))));
});

/* ── Woher die Dateien kommen ─────────────────────────────────────────────── */

async function incoming() {
  const got = [];
  // App: „Öffnen mit“, „Teilen“, Doppelklick
  const core = window.__TAURI__?.core;
  if (core) {
    const r = await core.invoke('plugin:folder|opened', { peek: false }).catch(() => null);
    got.push(...(r?.files ?? []));
  }
  // Web-App: Teilen-Menü (sw.js hat die Dateien abgelegt)
  if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
    try {
      const cache = await caches.open(SHARE);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        got.push({ name: decodeURIComponent(res.headers.get('X-Name') ?? 'Datei.gpx'), text: await res.text() });
      }
      await caches.delete(SHARE);
    } catch { /* dann eben über die Auswahl */ }
    history.replaceState(null, '', './import.html');
  }
  return got;
}

// Web-App: Dateizuordnung (auch später, wenn das Fenster schon offen ist)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (p) => {
    const list = await Promise.all((p.files ?? []).map(async (h) => { const x = await h.getFile(); return { name: x.name, text: await x.text() }; }));
    if (list.length) addFiles(list);
  });
}

mountAppBar();
render();
const first = await incoming();
if (first.length) await addFiles(first);
