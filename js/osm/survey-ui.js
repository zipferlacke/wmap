/**
 * Oberfläche zu „Mitmachen“: Fragenkarten im Sheet, Öffnungszeiten-Editor,
 * Anmelden und Hochladen.
 */
import { QUESTS, questions, answer, skip, scan, queue, commentFor, anonNotes, editsAsNotes, remarkNotes } from './survey.js';
import { countOsm } from './stats.js';
import { account, login, upload, changesetUrl } from './api.js';
import { contribute } from '../data/trace.js';
import { hoursTable, parseWeek, buildHours, formatHours, DAYS_DE } from '../ui/poi-info.js';
import { showHighlight } from '../map/map.js';
import { esc } from '../core/geo.js';

const MODE = { foot: 'zu Fuß', bike: 'mit dem Rad', car: 'mit dem Auto' };
const toTime = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };

export class SurveyView {
  #root; #map; #toast; #onCount;
  #busy = false; #lastResult = null; #editing = null;

  /**
   * @param root      die Sheet-Ansicht [data-view=survey]
   * @param opts.onCount  Anzahl offener Fragen hat sich geändert (optional)
   */
  constructor(root, { map, toast, onCount }) {
    this.#root = root;
    this.#map = map;
    this.#toast = toast;
    this.#onCount = onCount;
    root.addEventListener('click', (e) => this.#click(e));
    root.addEventListener('input', (e) => { if (e.target.closest('.hours-editor')) this.#preview(e.target.closest('.hours-editor')); });
    root.addEventListener('change', (e) => { if (e.target.closest('.hours-editor')) this.#preview(e.target.closest('.hours-editor')); });
    addEventListener('online', () => this.sync());
  }

  get count() { return questions.list().length; }

  /** Nach einer Fahrt: neue Fragen suchen. → Anzahl */
  async refresh() {
    if (!contribute.get() || !navigator.onLine || this.#busy) return this.count;
    this.#busy = true;
    const update = () => { this.#onCount?.(this.count); if (this.#root.offsetParent) this.render(); };
    if (this.#root.offsetParent) this.render();
    try { await scan({ onUpdate: update }); } catch (err) { if (this.#root.offsetParent) this.#toast(err.message); } finally {
      this.#busy = false;
    }
    this.#onCount?.(this.count);
    if (this.#root.offsetParent) this.render();
    return this.count;
  }

  render() {
    const list = questions.list();
    const $ = (s) => this.#root.querySelector(s);
    $('.survey-sub').textContent = !contribute.get() ? 'Ausgeschaltet'
      : (list.length ? `${list.length} ${list.length === 1 ? 'Frage' : 'Fragen'} zu Orten, an denen du warst`
        : this.#busy ? '' : 'Keine offenen Fragen') + (this.#busy ? `${list.length ? ' · ' : ''}suche weitere …` : '');
    this.#renderAccount();
    const ul = $('.survey-list');
    if (!contribute.get()) {
      ul.innerHTML = `<li class="survey-empty"><p>Mitmachen ist ausgeschaltet. In den Einstellungen lässt es sich
        einschalten – dann merkt sich WMap deinen Weg auf diesem Gerät und fragt danach kurz nach.</p></li>`;
    } else if (!list.length && this.#busy) {
      ul.innerHTML = '<li class="survey-empty"><p><span class="msr spin">progress_activity</span> Schaue, wo du warst …</p></li>';
    } else if (!list.length) {
      ul.innerHTML = `<li class="survey-empty"><p>Nach der nächsten Fahrt oder dem nächsten Spaziergang mit
        WMap gibt es hier kurze Fragen – z. B. ob ein Parkplatz etwas kostet oder die Bäckerei noch die
        gleichen Öffnungszeiten hat. Deine Antworten verbessern OpenStreetMap.</p>
        <button type="button" class="button" data-act="scan"><span class="msr">refresh</span> Jetzt nachsehen</button></li>`;
    } else {
      ul.innerHTML = list.map((q) => this.#card(q)).join('');
    }
    showHighlight(this.#map, {
      points: list.map((q) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: q.point },
        properties: { name: q.name, category: 'survey', color: '#7b1fa2' },
      })),
    });
    this.#onCount?.(list.length);
  }

  #renderAccount() {
    const el = this.#root.querySelector('.survey-account');
    const waiting = queue.size();
    const dev = account.server() === 'dev' ? ' <span class="chip small">Testserver</span>' : '';
    let html;
    if (account.loggedIn()) {
      html = `<p><span class="msr">account_circle</span> Angemeldet als <strong>${esc(account.user()?.name ?? '?')}</strong>${dev}</p>`
        + (waiting ? `<button type="button" class="button" data-act="upload"><span class="msr">cloud_upload</span> ${waiting} hochladen</button>` : '');
    } else if (waiting) {
      html = `<p>${waiting} ${waiting === 1 ? 'Antwort wartet' : 'Antworten warten'} aufs Hochladen.${dev}</p>
        <button type="button" class="button primary" data-act="login"><span class="msr">login</span> Bei OpenStreetMap anmelden</button>`;
    } else {
      html = '';
    }
    if (this.#lastResult) html += `<p class="survey-result">${this.#lastResult}</p>`;
    el.innerHTML = html;
    el.hidden = !html;
  }

  #card(q) {
    const def = QUESTS[q.quest];
    const when = q.at ? new Date(q.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
    const sub = [when, MODE[q.mode]].filter(Boolean).join(' · ');
    let body = '';
    if (def.kind === 'hours' && this.#editing !== q.key) {
      body = `<div class="quest-hours">${hoursTable(q.tags.opening_hours) ?? ''}</div>
        <div class="quest-options">
          <button type="button" class="button primary" data-answer="yes"><span class="msr">check</span> Stimmt noch</button>
          <button type="button" class="button" data-act="edit"><span class="msr">edit_calendar</span> Andere Zeiten</button>
          <button type="button" class="button" data-answer="gone"><span class="msr">block</span> Gibt es nicht mehr</button>
        </div>`;
    } else if (def.kind === 'hours' || def.kind === 'hours-new') {
      // Erst die schnellen Antworten, dann die Woche zum Ausfüllen
      body = `<div class="quest-options quest-quick">
          <button type="button" class="button" data-answer="24/7"><span class="msr">all_inclusive</span> Rund um die Uhr</button>
          <button type="button" class="button" data-answer="gone"><span class="msr">block</span> Gibt es nicht mehr</button>
        </div>
        ${this.#editor(q)}`;
    } else {
      body = `<div class="quest-options">${def.options.map((o) => `
        <button type="button" class="button" data-answer="${esc(o.value)}">${o.icon ? `<span class="msr">${esc(o.icon)}</span> ` : ''}${esc(o.label)}</button>`).join('')}
      </div>`;
    }
    return `<li class="quest" data-key="${esc(q.key)}">
      <div class="quest-head">
        <span class="msr quest-icon">${esc(def.icon)}</span>
        <div><strong>${esc(def.title(q))}</strong><small>${esc(q.quest.startsWith('road') || q.quest === 'way_lit' ? sub : [q.name, sub].filter(Boolean).join(' · '))}</small></div>
        <button type="button" class="button" data-shape="round no-background" data-act="show" title="Auf der Karte zeigen"><span class="msr">location_on</span></button>
      </div>
      ${body}
      <div class="quest-foot">
        <button type="button" class="link-button" data-act="later">Weiß nicht / später</button>
        <button type="button" class="link-button" data-act="never">Nicht mehr fragen</button>
      </div>
    </li>`;
  }

  /**
   * Woche zum Ausfüllen: je Tag ein Chip (antippen = geöffnet/geschlossen),
   * daneben die Zeiten und „+ Pause“ für eine Mittagspause.
   */
  #editor(q) {
    const week = (q.tags.opening_hours && parseWeek(q.tags.opening_hours))
      ?? [...Array(5).fill([[480, 1080]]), [[480, 780]], []];
    const rows = DAYS_DE.map((d, i) => {
      const spans = week[i] ?? [];
      const [a, b] = spans[0] ?? [480, 1080];
      const [c, e] = spans[1] ?? [840, 1080];
      return `<div class="he-day${spans.length ? '' : ' closed'}${spans.length > 1 ? ' split' : ''}" data-day="${i}">
        <label class="he-chip" title="Geöffnet?"><input type="checkbox" class="he-open" ${spans.length ? 'checked' : ''}><span>${d}</span></label>
        <span class="he-closed">geschlossen</span>
        <span class="he-times">
          <span class="he-span"><input type="time" class="he-a" value="${toTime(a)}" aria-label="${d} ab"><i>–</i><input type="time" class="he-b" value="${toTime(b)}" aria-label="${d} bis"></span>
          <span class="he-span he-second"><input type="time" class="he-c" value="${toTime(c)}" aria-label="${d} nach der Pause ab"><i>–</i><input type="time" class="he-e" value="${toTime(e)}" aria-label="${d} bis"></span>
          <label class="he-pause" title="Mittagspause"><input type="checkbox" class="he-split" ${spans.length > 1 ? 'checked' : ''}><span class="msr">coffee</span><span class="he-pause-label">Pause</span></label>
        </span>
      </div>`;
    }).join('');
    const back = this.#editing === q.key && QUESTS[q.quest].kind === 'hours'
      ? '<button type="button" class="button" data-act="unedit">Zurück</button>' : '';
    return `<div class="hours-editor">
      <div class="he-week">${rows}</div>
      <button type="button" class="link-button he-copy" data-act="copy-mo"><span class="msr">content_copy</span> Montag für Di–Fr übernehmen</button>
      <p class="he-preview"></p>
      <div class="quest-options">
        ${back}
        <button type="button" class="button primary" data-act="save-hours"><span class="msr">check</span> Speichern</button>
      </div>
    </div>`;
  }

  #readEditor(ed) {
    return [...ed.querySelectorAll('.he-day')].map((tr) => {
      if (!tr.querySelector('.he-open').checked) return [];
      const v = (c) => tr.querySelector(c).value;
      const spans = [[toMin(v('.he-a')), toMin(v('.he-b'))]];
      if (tr.querySelector('.he-split').checked) spans.push([toMin(v('.he-c')), toMin(v('.he-e'))]);
      return spans.map(([a, b]) => [a, b === 0 ? 1440 : b <= a ? b + 1440 : b]);
    });
  }

  #preview(ed) {
    for (const tr of ed.querySelectorAll('.he-day')) {
      const open = tr.querySelector('.he-open').checked;
      tr.classList.toggle('closed', !open);
      tr.classList.toggle('split', tr.querySelector('.he-split').checked);
    }
    const q = questions.list().find((x) => x.key === ed.closest('.quest').dataset.key);
    const text = buildHours(this.#readEditor(ed), q?.tags.opening_hours ?? '');
    // Lesbar statt OSM-Schreibweise („Di 14:00–18:00“ statt „Tu 14:00-18:00“)
    ed.querySelector('.he-preview').innerHTML = text
      ? `<span class="msr">visibility</span> ${esc(formatHours(text)).replace(/\n/g, ' · ')}` : 'An keinem Tag geöffnet?';
  }

  async #click(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const card = btn.closest('.quest');
    const q = card && questions.list().find((x) => x.key === card.dataset.key);
    const act = btn.dataset.act;

    if (act === 'scan') { btn.disabled = true; await this.refresh(); this.render(); return; }
    if (act === 'login') { this.#login(); return; }
    if (act === 'upload') { this.sync({ loud: true }); return; }
    if (!q) return;

    if (act === 'show') {
      this.#map.flyTo({ center: q.point, zoom: Math.max(this.#map.getZoom(), 17), duration: 900 });
    } else if (act === 'edit') {
      this.#editing = q.key;
      card.outerHTML = this.#card(q);
      this.#preview(this.#root.querySelector(`.quest[data-key="${CSS.escape(q.key)}"] .hours-editor`));
    } else if (act === 'unedit') {
      this.#editing = null;
      card.outerHTML = this.#card(q);
    } else if (act === 'copy-mo') {
      const ed = card.querySelector('.hours-editor');
      const mo = ed.querySelector('.he-day[data-day="0"]');
      for (let d = 1; d <= 4; d += 1) {
        const tr = ed.querySelector(`.he-day[data-day="${d}"]`);
        for (const c of ['.he-open', '.he-split']) tr.querySelector(c).checked = mo.querySelector(c).checked;
        for (const c of ['.he-a', '.he-b', '.he-c', '.he-e']) tr.querySelector(c).value = mo.querySelector(c).value;
      }
      this.#preview(ed);
    } else if (act === 'save-hours') {
      const ed = card.querySelector('.hours-editor');
      const hours = buildHours(this.#readEditor(ed), q.tags.opening_hours ?? '');
      if (!hours) { this.#toast('Bitte mindestens einen Tag mit Zeiten angeben'); return; }
      this.#done(q, { hours });
    } else if (act === 'later') {
      skip(q);
      this.render();
    } else if (act === 'never') {
      skip(q, { forever: true });
      this.render();
    } else if (btn.dataset.answer === '24/7') {
      this.#done(q, { hours: '24/7' });
    } else if (btn.dataset.answer) {
      this.#done(q, btn.dataset.answer);
    }
  }

  #done(q, value) {
    answer(q, value);
    this.#editing = null;
    const noOsm = (q.quest === 'detour' && value !== 'gone') || (q.quest === 'missing_way' && value === 'none');
    if (!noOsm) {
      this.#toast(account.loggedIn() ? 'Danke! Wird hochgeladen …'
        : anonNotes.get() ? 'Danke! Geht als Hinweis an OpenStreetMap' : 'Danke! Gespeichert – hochladen nach der Anmeldung');
    }
    this.render();
    this.sync();
  }

  async #login() {
    try {
      const user = await login();
      this.#toast(`Angemeldet als ${user.name}`);
      this.render();
      this.sync({ loud: true });
    } catch (err) { this.#toast(err.message); }
  }

  /**
   * Warteschlange hochladen, wenn angemeldet und online. Tag-Änderungen in
   * einem Changeset, Hinweise einzeln – jeder erst nach Erfolg aus der Liste.
   */
  async sync({ loud = false } = {}) {
    if (!navigator.onLine || this.#syncing) return;
    // Ohne Konto: auf Wunsch als anonymer Hinweis, sonst warten
    const anon = !account.loggedIn();
    if (anon && !anonNotes.get()) return;
    const q = queue.get();
    if (!q.edits.length && !q.notes.length) return;
    this.#syncing = true;
    const parts = [];
    try {
      if (q.edits.length && !anon) {
        const res = await upload({ edits: q.edits }, { comment: commentFor(q.edits) });
        const cur = queue.get();
        cur.edits = cur.edits.filter((e) => !q.edits.includes(e) && !q.edits.some((x) => x.at === e.at && x.osm.id === e.osm.id));
        queue.set(cur);
        countOsm('frage', 'karte', res.applied.length);
        if (res.changeset) parts.push(`<a href="${changesetUrl(res.changeset)}" target="_blank" rel="noopener">${res.applied.length} ${res.applied.length === 1 ? 'Änderung' : 'Änderungen'}</a>`);
        if (res.conflicts.length) parts.push(`${res.conflicts.length} übersprungen (dort hat sich inzwischen etwas geändert)`);
      }
      // Anonym werden Änderungen zu Hinweisen für Mapper
      const notes = [...q.notes, ...(anon ? editsAsNotes(q.edits) : remarkNotes(q.edits))];
      if (anon) {
        const cur = queue.get();
        cur.edits = cur.edits.filter((e) => !q.edits.some((x) => x.at === e.at && x.osm.id === e.osm.id));
        cur.notes = [...cur.notes, ...notes.filter((n) => !cur.notes.some((x) => x.text === n.text))];
        queue.set(cur);
      }
      for (const n of notes) {
        await upload({ notes: [n] }, {});
        countOsm('frage', 'hinweis');
        const cur = queue.get();
        cur.notes = cur.notes.filter((x) => x.text !== n.text);
        queue.set(cur);
        parts.push('1 Hinweis');
      }
      if (parts.length) {
        this.#lastResult = `Gesendet: ${parts.join(', ')}. Danke!`;
        this.#toast(anon ? 'Als Hinweis an OpenStreetMap gesendet – danke!' : 'Bei OpenStreetMap hochgeladen – danke!');
      }
    } catch (err) {
      if (loud || this.#root.offsetParent) this.#toast(err.message);
    } finally {
      this.#syncing = false;
      if (this.#root.offsetParent) this.#renderAccount();
    }
  }

  #syncing = false;
}
