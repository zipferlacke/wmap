/**
 * Etappen im Tourenplaner: eine lange Tour (Karstwanderweg, Radfernweg …) in
 * Tagesetappen teilen. Die Tour bleibt als Linie im Hintergrund:
 *
 *   „Etappen“ an     Tippen auf die Linie setzt dort ein Tagesende (Fähnchen
 *                    mit Nummer); Fähnchen antippen entfernt es
 *   Automatisch      alle X km ein Tagesende
 *   Liste            je Tag Länge, Höhenmeter, Zeit und wo er endet
 *   Speichern        jede Etappe als eigene Tour mit dem Verlauf dieses
 *                    Stücks – zu finden unter „Meine Touren“
 *
 * Die Tagesenden liegen in tour.stages (Meter entlang der Linie) und werden
 * mit der Tour gespeichert. Geht auch bei geteilten, nur lesbaren Touren –
 * gespeichert werden dann nur die neuen Tagestouren.
 */
import { tours, shapeOf } from '../data/store.js';
import { nearestOnLine, pointAt, simplifyTo, fmtDistance, fmtDuration } from '../core/geo.js';
import * as geocode from '../services/geocode.js';

const COLORS = ['#e8590c', '#7048e8'];
const SRC = 'stages';

/**
 * @param o.box        Element für Liste und Knöpfe
 * @param o.button     Knopf „Etappen“ (schaltet den Modus)
 * @param o.getRoute   → aktuelle Route { coords, cum, length, elevation }
 * @param o.getTour    → Tour (name, profile, stages …)
 * @param o.timeFor    (Meter, hoch, runter) → Sekunden
 * @param o.onChange   Tagesenden geändert (Tour speichern)
 */
export function setupStages({ map, box, button, getRoute, getTour, timeFor, toast, onChange = () => {} }) {
  let active = false;
  let markers = [];
  const places = new Map();          // gerundeter Punkt → Ortsname

  const splits = () => getTour().stages ?? [];
  const setSplits = (list) => {
    const r = getRoute();
    const total = r ? r.cum.at(-1) : 0;
    getTour().stages = [...new Set(list.map((m) => Math.round(m)))].filter((m) => m > 50 && m < total - 50).sort((a, b) => a - b);
    paint();
    onChange();
  };

  button.addEventListener('click', () => {
    active = !active;
    button.setAttribute('aria-pressed', String(active));
    document.body.classList.toggle('stage-mode', active);
    box.hidden = !active && !splits().length;
    if (active) toast('Tippe auf die Linie, wo ein Tag enden soll – oder lass automatisch teilen');
    paint();
  });

  /** Klick auf die Karte im Etappen-Modus → ob er verbraucht ist */
  function click(e) {
    if (!active) return false;
    const r = getRoute();
    if (!r) return true;
    const onLine = map.getLayer('route-main')
      && map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['route-main'] }).length;
    if (!onLine) { toast('Für ein Tagesende genau auf die Linie tippen'); return true; }
    setSplits([...splits(), nearestOnLine(r.coords, r.cum, e.lngLat.toArray()).along]);
    return true;
  }

  /* ── Zahlen je Etappe ─────────────────────────────────────────────────── */

  function stageList() {
    const r = getRoute();
    if (!r) return [];
    const total = r.cum.at(-1);
    const scale = (r.length || total) / total;      // Linie → echte Meter
    const bounds = [0, ...splits(), total];
    return bounds.slice(1).map((b, i) => {
      const a = bounds[i];
      const km = [(a * scale) / 1000, (b * scale) / 1000];
      const [up, down] = climb((r.elevation ?? []).filter(([k]) => k >= km[0] && k <= km[1]));
      const len = (b - a) * scale;
      return { i, a, b, len, up, down, time: timeFor(len, up, down), end: pointAt(r.coords, r.cum, b) };
    });
  }

  function climb(profile) {
    let up = 0, down = 0;
    for (let i = 1; i < profile.length; i += 1) {
      const d = profile[i][1] - profile[i - 1][1];
      if (d > 0) up += d; else down -= d;
    }
    return [Math.round(up), Math.round(down)];
  }

  /** Stück der Linie zwischen zwei Stellen (Meter entlang) */
  function slice(a, b) {
    const r = getRoute();
    const out = [pointAt(r.coords, r.cum, a)];
    for (let i = 0; i < r.coords.length; i += 1) if (r.cum[i] > a && r.cum[i] < b) out.push(r.coords[i]);
    out.push(pointAt(r.coords, r.cum, b));
    return out;
  }

  /* ── Karte und Liste ──────────────────────────────────────────────────── */

  function paint() {
    const r = getRoute();
    const list = r && (active || splits().length) ? stageList() : [];
    // Jeder zweite Tag in anderer Farbe über der Route
    const data = { type: 'FeatureCollection', features: list.length > 1 ? list.map((s) => ({
      type: 'Feature', properties: { color: COLORS[s.i % 2] }, geometry: { type: 'LineString', coordinates: slice(s.a, s.b) },
    })) : [] };
    if (map.getSource(SRC)) map.getSource(SRC).setData(data);
    else if (map.loaded()) {
      map.addSource(SRC, { type: 'geojson', data });
      map.addLayer({ id: SRC, type: 'line', source: SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 6], 'line-opacity': 0.9 } });
    }
    markers.forEach((m) => m.remove());
    markers = list.slice(0, -1).map((s) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'stage-marker';
      el.innerHTML = `<span class="msr">flag</span>${s.i + 1}`;
      el.title = `Ende Tag ${s.i + 1} – antippen zum Entfernen`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSplits(splits().filter((m) => m !== s.b));
      });
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(s.end).addTo(map);
    });
    paintList(list);
  }

  function paintList(list) {
    box.hidden = !active && !splits().length;
    if (box.hidden) return;
    const per = Math.round((list.at(-1)?.b ?? 0) / Math.max(1, list.length) / 1000);
    box.innerHTML = `
      <h3><span class="msr">flag</span> Etappen</h3>
      <p class="muted">${active ? 'Tippe auf die Linie, wo ein Tag enden soll; ein Fähnchen antippen entfernt es.' : 'Mit „Etappen“ oben lassen sich die Tagesenden ändern.'}</p>
      <form class="stage-auto">
        <label>Alle <input type="number" name="km" min="2" max="300" step="1" value="${per > 2 && list.length > 1 ? per : 20}"> km</label>
        <button type="submit" class="button"><span class="msr">auto_awesome</span> Automatisch teilen</button>
        ${splits().length ? '<button type="button" class="button" data-st="clear"><span class="msr">delete_sweep</span> Alle entfernen</button>' : ''}
      </form>
      ${list.length > 1 ? `<ol class="stage-list">${list.map((s) => `
        <li style="--c:${COLORS[s.i % 2]}">
          <strong>Tag ${s.i + 1}</strong>
          <span>${fmtDistance(s.len)} · <span class="msr">north_east</span>${s.up} m · ${fmtDuration(s.time)}</span>
          <small data-place="${s.i}">${s.i === list.length - 1 ? 'Ziel' : 'bis …'}</small>
        </li>`).join('')}</ol>
        <button type="button" class="button primary" data-st="save"><span class="msr">library_add</span> Als ${list.length} Tagestouren speichern</button>` : ''}`;
    list.slice(0, -1).forEach((s) => placeName(s.end).then((name) => {
      const el = box.querySelector(`[data-place="${s.i}"]`);
      if (el && name) el.textContent = `bis ${name}`;
    }));
  }

  // Nacheinander fragen – Photon lehnt viele gleichzeitige Anfragen ab (503)
  let queue = Promise.resolve();
  async function placeName(p) {
    const key = p.map((v) => v.toFixed(3)).join(',');
    if (!places.has(key)) {
      const ask = queue.then(() => geocode.reverse(p)).then((f) => f?.properties.city ?? f?.properties.town ?? f?.properties.village
        ?? f?.properties.locality ?? f?.properties.name ?? null).catch(() => null);
      queue = ask.then(() => new Promise((r) => setTimeout(r, 150)));
      places.set(key, ask);
    }
    return places.get(key);
  }

  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = getRoute();
    const km = Number(new FormData(e.target).get('km'));
    if (!r || !(km >= 2)) return;
    const total = r.cum.at(-1);
    const step = (km * 1000 * total) / (r.length || total);
    const list = [];
    for (let m = step; m < total - step * 0.3; m += step) list.push(m);
    setSplits(list);
  });

  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-st]')?.dataset.st;
    if (act === 'clear') setSplits([]);
    if (act === 'save') await saveDays();
  });

  async function saveDays() {
    const t = getTour();
    const list = stageList();
    const base = t.name || 'Tour';
    for (const s of list) {
      const line = slice(s.a, s.b);
      const end = s.i === list.length - 1 ? 'Ziel' : await placeName(s.end);
      tours.save({
        id: tours.newId(),
        name: `${base} – Tag ${s.i + 1}`,
        description: `Etappe ${s.i + 1} von ${list.length}${end ? ` (bis ${end})` : ''} · aus „${base}“`,
        profile: t.profile,
        points: simplifyTo(line, 8),
        fixed: true,
        shape: shapeOf(simplifyTo(line, 1500)),
        stats: { length: s.len, time: s.time, ascent: s.up, descent: s.down },
        preview: null,
      });
    }
    toast(`${list.length} Tagestouren gespeichert – unter „Meine Touren“`);
  }

  return {
    click,
    get active() { return active; },
    /** Route neu berechnet oder Höhen da */
    refresh() { if (active || splits().length) paint(); else box.hidden = true; },
  };
}
