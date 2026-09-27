/**
 * „Aufzeichnen“ auf der Karte – wie bei Komoot: Art wählen, los, unten Zeit,
 * Strecke und Tempo, Pause und Stopp. Die Linie wächst live mit. Beim Stopp
 * einen Namen geben (oder verwerfen); gespeichert wird nur auf dem Gerät.
 *
 * Läuft nur, solange die Seite offen ist – Browser zeichnen im Hintergrund
 * nicht auf. Darum bleibt der Bildschirm an (Wake Lock).
 */
import { recorder, defaultName } from './tracks.js';
import { geo } from './native.js';
import { PROFILES } from './config.js';
import { distance, fmtDistance, esc } from './geo.js';

const KINDS = ['foot', 'hike', 'bike', 'car'];

let ui = null;

/**
 * @param ctx.map    MapLibre-Karte
 * @param ctx.toast  (text, { action }) → Hinweis
 */
export function setupRecording(ctx) {
  ui ??= new RecordUi(ctx);
  // Nach Neuladen weiter aufzeichnen
  if (recorder.active && recorder.kind === 'rec') ui.show();
  return ui;
}

class RecordUi {
  #map; #toast; #el; #watch = null; #lock = null; #timer = null; #me = null;

  constructor({ map, toast }) {
    this.#map = map;
    this.#toast = toast;
    this.#el = document.createElement('section');
    this.#el.className = 'rec';
    this.#el.hidden = true;
    document.body.append(this.#el);
    this.#el.addEventListener('click', (e) => this.#click(e));
    recorder.onChange = () => this.#paint();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && recorder.active) this.#keepAwake();
    });
  }

  /** Auswahl der Art, dann geht es los. */
  choose() {
    if (recorder.active) { this.show(); return; }
    this.#el.hidden = false;
    this.#el.classList.remove('running');
    this.#el.innerHTML = `
      <header><h2><span class="msr rec-dot">radio_button_checked</span> Aufzeichnen</h2>
        <button type="button" class="button" data-shape="round no-background" data-act="close" title="Schließen"><span class="msr">close</span></button></header>
      <p class="muted">Wie bist du unterwegs? Die Aufzeichnung bleibt auf diesem Gerät.</p>
      <div class="rec-kinds">${KINDS.map((k) => `<button type="button" class="chip" data-kind="${k}"><span class="msr">${PROFILES[k].icon}</span>${esc(PROFILES[k].label)}</button>`).join('')}</div>`;
  }

  show() {
    this.#el.hidden = false;
    this.#el.classList.add('running');
    this.#el.innerHTML = `
      <div class="rec-stats">
        <div><strong class="rec-time">0:00</strong><small>Zeit</small></div>
        <div><strong class="rec-dist">0 m</strong><small>Strecke</small></div>
        <div><strong class="rec-speed">–</strong><small>km/h</small></div>
      </div>
      <div class="rec-buttons">
        <button type="button" class="button rec-pause" data-shape="round" data-act="pause" title="Pause"><span class="msr">pause</span></button>
        <button type="button" class="button rec-stop" data-shape="round" data-act="stop" title="Beenden"><span class="msr">stop</span></button>
      </div>`;
    document.body.classList.add('recording');
    this.#startGps();
    this.#keepAwake();
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.#paint(), 1000);
    this.#paint();
  }

  async #click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'close') { this.#el.hidden = true; return; }
    if (b.dataset.kind) {
      recorder.start({ kind: 'rec', profile: b.dataset.kind });
      this.show();
      this.#toast('Aufzeichnung läuft');
      return;
    }
    if (b.dataset.act === 'pause') {
      recorder.pause(!recorder.paused);
      this.#paint();
      return;
    }
    if (b.dataset.act === 'stop') this.#finish();
  }

  async #finish() {
    const info = recorder.info;
    const name = await askName(defaultName(info?.profile, info?.started));
    if (name === undefined) return;             // weiter aufzeichnen
    this.#stopGps();
    this.#el.hidden = true;
    document.body.classList.remove('recording');
    clearInterval(this.#timer);
    this.#line([]);
    if (name === null) { recorder.discard(); this.#toast('Aufzeichnung verworfen'); return; }
    try {
      const t = await recorder.stop({ name });
      if (!t) { this.#toast('Zu kurz zum Speichern'); return; }
      this.#toast(`„${t.name}“ gespeichert`, { action: { label: 'Ansehen', run: () => { location.href = `./wege.html?id=${encodeURIComponent(t.id)}`; } } });
    } catch (err) {
      this.#toast(`Speichern ging nicht: ${err.message}`);
    }
  }

  #paint() {
    if (!recorder.active || recorder.kind !== 'rec' || !this.#el.classList.contains('running')) return;
    const pts = recorder.points;
    const info = recorder.info;
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += distance(pts[i - 1], pts[i]);
    const secs = Math.round((Date.now() - info.started) / 1000);
    const $ = (s) => this.#el.querySelector(s);
    $('.rec-time').textContent = clock(secs);
    $('.rec-dist').textContent = fmtDistance(len);
    // Tempo über die letzten ~15 s
    const last = pts.at(-1);
    let k = pts.length - 1;
    while (k > 0 && last[2] - pts[k - 1][2] < 15000) k -= 1;
    let d = 0;
    for (let i = k + 1; i < pts.length; i += 1) d += distance(pts[i - 1], pts[i]);
    const dt = last ? (last[2] - pts[k][2]) / 1000 : 0;
    $('.rec-speed').textContent = dt > 3 && Date.now() - last[2] < 20000 ? (d / dt * 3.6).toFixed(d / dt * 3.6 < 10 ? 1 : 0).replace('.', ',') : '–';
    const pause = $('.rec-pause');
    pause.querySelector('.msr').textContent = info.paused ? 'play_arrow' : 'pause';
    pause.title = info.paused ? 'Weiter' : 'Pause';
    this.#el.classList.toggle('paused', !!info.paused);
    this.#line(pts);
  }

  #line(pts) {
    const map = this.#map;
    const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => [x, y]) } };
    if (!map.getSource('rec-line')) {
      if (!pts.length || !map.isStyleLoaded()) return;
      map.addSource('rec-line', { type: 'geojson', data });
      map.addLayer({ id: 'rec-casing', type: 'line', source: 'rec-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
      map.addLayer({ id: 'rec-main', type: 'line', source: 'rec-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e8590c', 'line-width': 4.5 } });
    } else {
      map.getSource('rec-line').setData(data);
    }
    const last = pts.at(-1);
    if (last) {
      if (!this.#me) {
        const el = document.createElement('div');
        el.className = 'rec-me';
        this.#me = new maplibregl.Marker({ element: el }).setLngLat(last).addTo(map);
        map.easeTo({ center: last, zoom: Math.max(map.getZoom(), 15) });
      } else {
        this.#me.setLngLat(last);
        // Aus dem Bild gelaufen? Karte nachziehen (nur dann – sonst stört es beim Umschauen)
        const px = map.project(last), { clientWidth: w, clientHeight: h } = map.getContainer();
        if (px.x < 40 || px.y < 80 || px.x > w - 40 || px.y > h - 140) map.easeTo({ center: last, duration: 500 });
      }
    } else { this.#me?.remove(); this.#me = null; }
  }

  #startGps() {
    if (this.#watch !== null || !geo.available()) return;
    this.#watch = geo.watch(
      (p) => recorder.add({ point: [p.coords.longitude, p.coords.latitude], accuracy: p.coords.accuracy }),
      (err) => { if (err.code === 1) this.#toast('Standort ist gesperrt – ohne ihn keine Aufzeichnung'); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  #stopGps() {
    if (this.#watch !== null) geo.clear(this.#watch);
    this.#watch = null;
    this.#lock?.release?.().catch(() => {});
    this.#lock = null;
  }

  async #keepAwake() {
    try { this.#lock = await navigator.wakeLock?.request('screen'); } catch { /* nicht schlimm */ }
  }
}

function clock(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** → Name, null (verwerfen) oder undefined (weiter aufzeichnen). */
function askName(suggestion) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog rec-save';
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Aufzeichnung beenden</h2>
        <label>Name<input type="text" name="name" value="${esc(suggestion)}" maxlength="80"></label>
        <div class="rec-save-actions">
          <button type="button" class="button" data-v="discard"><span class="msr">delete</span> Verwerfen</button>
          <button type="button" class="button" data-v="back">Weiter</button>
          <button type="submit" class="button primary" data-v="save"><span class="msr">check</span> Speichern</button>
        </div>
      </form>`;
    document.body.append(dlg);
    let result;
    dlg.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v === 'discard' && confirm('Aufzeichnung wirklich verwerfen?')) { result = null; dlg.close(); }
      if (v === 'back') { result = undefined; dlg.close(); }
    });
    dlg.querySelector('form').addEventListener('submit', () => {
      result = dlg.querySelector('input').value.trim() || suggestion;
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    dlg.querySelector('input').select();
  });
}
