"""Gemeinsam planen (pages/tour.js, data/short-link.js, bEnd/api_share.php) – zwei getrennte Browser, lokaler Server:
1. Anna: Teilen → „Gemeinsam planen“ legt die Tour auf dem Server an; dort liegt sie nur verschlüsselt.
2. Bert öffnet den Link: die Tour ist bei ihm gespeichert, bearbeitbar, mit Hinweis „Gemeinsame Tour“.
3. Bert setzt einen Punkt – Anna holt den Stand: drei Punkte, „zuletzt geändert von Bert“. Mehrmals kurz
   hintereinander gespeichert ist kein Konflikt; den Link erneut geöffnet holt den neuesten Stand.
5. Zusammenführen (data/tour-merge.js): verschiedene Stellen ohne Frage; dieselbe Stelle fragt, beide Fassungen
   auf der Karte (Karte nicht abgedunkelt).
6. Chip „Geteilt · noch 30 Tage“ bzw. „Eingeladen von Anna“ im Planer und in der Liste.
7. „Link öffnen“ (ui/open-link.js) mit Text um den Link, mit eigener Tour verbinden – zusammengeführt.
4. Kurzer Link zum Ansehen ist verschlüsselt (#k=<Kennung>.<Schlüssel>); ein alter ohne Schlüssel geht weiter;
   ein falscher Schlüssel gibt eine Meldung."""
import sys
import time
from common import Browser, BASE

TOURS = "return JSON.parse(localStorage.getItem('wmap.tours') ?? '[]')"

with Browser(500, 800) as a, Browser(500, 800) as b:
    checks = {}
    a.open('tour.html', 3)
    a.js("localStorage.setItem('wmap.myname', JSON.stringify('Anna')); return import('./js/data/store.js').then(({ tours }) => tours.save({ id: 'c1', name: 'Runde', description: '', profile: 'hike', points: [[9.930, 51.530], [9.950, 51.540]] }))")
    a.open('tour.html?id=c1', 6)
    a.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.querySelector('[data-tour=share]').click()")
    time.sleep(1)
    a.js("[...document.querySelectorAll('dialog[open] button')].find((x) => /Gemeinsam/.test(x.innerText))?.click()")
    time.sleep(4)
    c = next((t.get('collab') for t in a.js(TOURS) if t['id'] == 'c1'), None)
    a.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    raw = a.d.execute_async_script("const done = arguments[1]; import('./js/services/api.js').then(({ api }) => api(['share', 'get'], { id: arguments[0] })).then((r) => done(r), (e) => done(String(e)))", c['id']) if c else {}
    print('Server:', {k: (str(v)[:24]) for k, v in raw.items()} if isinstance(raw, dict) else raw)
    checks['1. auf dem Server angelegt, nur verschlüsselt, zum Ändern'] = bool(c) and raw.get('edit') is True and raw.get('editor') == 'Anna' and not raw['code'].startswith('z')
    b.open('index.html', 2)
    b.js("localStorage.setItem('wmap.myname', JSON.stringify('Bert'))")
    b.d.get(f"{BASE}tour.html#k={c['id']}.{c['key']}.{c['token']}")
    time.sleep(7)
    bt = b.js(TOURS)
    hint = b.js("return [document.querySelector('.tour-collab')?.innerText.trim(), document.body.classList.contains('readonly')]")
    print('Bert:', [(t['name'], len(t['points'])) for t in bt], hint)
    checks['2. bei Bert gespeichert, bearbeitbar, Hinweis'] = len(bt) == 1 and len(bt[0]['points']) == 2 and 'Gemeinsame Tour' in hint[0] and not hint[1]
    # Nur geöffnet, nichts geändert: kein neuer Stand auf dem Server – sonst sähe Anna „Bert hat geändert“
    rev = a.d.execute_async_script("const done = arguments[1]; import('./js/services/api.js').then(({ api }) => api(['share', 'get'], { id: arguments[0] })).then((r) => done(r.rev), (e) => done(String(e)))", c['id'])
    print('Stand nach Berts Öffnen:', rev)
    checks['2. nur geöffnet: kein neuer Stand auf dem Server (keine Phantom-Meldung)'] = rev == raw.get('rev')
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const m = window.__wmap.map; const ll = [9.96, 51.535]; m.fire('click', { lngLat: maplibregl.LngLat.convert(ll), point: m.project(ll), originalEvent: new MouseEvent('click') })")
    time.sleep(6)
    a.js("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(5)
    pts = next((t['points'] for t in a.js(TOURS) if t['id'] == 'c1'), [])
    note = a.js("return document.querySelector('.tour-collab')?.innerText")
    print('Anna:', len(pts), note)
    checks['3. Anna hat Berts Punkt, „zuletzt geändert von Bert“'] = len(pts) == 3 and 'Bert' in (note or '')
    # Bert speichert mehrmals kurz hintereinander (Knopf und automatisch) – das ist kein „gleichzeitig geändert“
    b.js("const m = window.__wmap.map; const ll = [9.97, 51.538]; m.fire('click', { lngLat: maplibregl.LngLat.convert(ll), point: m.project(ll), originalEvent: new MouseEvent('click') }); document.querySelector('#save').click(); document.querySelector('#save').click()")
    time.sleep(7)
    clash = b.js("return [...document.querySelectorAll('dialog[open]')].map((d) => d.innerText).join(' ')")
    a.js("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(5)
    pts = next((t['points'] for t in a.js(TOURS) if t['id'] == 'c1'), [])
    print('mehrmals gespeichert:', len(pts), clash[:80])
    checks['3. mehrmals gespeichert: keine Konfliktfrage, Anna hat 4 Punkte'] = 'Gleichzeitig' not in clash and len(pts) == 4
    # Anna ändert, Bert öffnet den Link erneut (die Tour liegt bei ihm schon) – er bekommt Annas Stand
    a.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); const m = window.__wmap.map; const ll = [9.98, 51.542]; m.fire('click', { lngLat: maplibregl.LngLat.convert(ll), point: m.project(ll), originalEvent: new MouseEvent('click') })")
    time.sleep(6)
    b.d.get('about:blank')
    b.d.get(f"{BASE}tour.html#k={c['id']}.{c['key']}.{c['token']}")
    time.sleep(8)
    bt = b.js(TOURS)
    print('Bert erneut:', [(t['name'], len(t['points'])) for t in bt])
    checks['3. Link erneut geöffnet: Bert hat Annas neuen Punkt, keine zweite Tour'] = len(bt) == 1 and len(bt[0]['points']) == 5
    # Zusammenführen: Bert holt nichts ab (Seite „verdeckt“) – beide ändern, Bert schickt danach
    b.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true })")
    a.js("const n = document.querySelector('#tour-name'); n.value = 'Runde Neu'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true }))")
    time.sleep(5)
    click = "const m = window.__wmap.map; const ll = [%s]; m.fire('click', { lngLat: maplibregl.LngLat.convert(ll), point: m.project(ll), originalEvent: new MouseEvent('click') })"
    b.js(click % '9.99, 51.545')
    time.sleep(7)
    bt = b.js(TOURS)[0]
    ask = b.js("return [...document.querySelectorAll('dialog[open]')].map((d) => d.innerText).join(' ')")
    print('verschiedene Stellen:', bt['name'], len(bt['points']), ask[:60])
    checks['5. verschiedene Stellen: ohne Frage beides drin (Annas Name, Berts Punkt)'] = bt['name'] == 'Runde Neu' and len(bt['points']) == 6 and 'Zusammenführen' not in ask
    a.js("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(5)
    # Dieselbe Stelle: beide hängen hinten einen Punkt an – Bert wird gefragt, beide Fassungen auf der Karte
    a.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); " + click % '10.00, 51.55')
    time.sleep(5)
    b.js(click % '9.99, 51.56')
    time.sleep(6)
    seen = b.js("""const d = document.querySelector('.collab-pickbar');
      const s = window.__wmap.map.getSource('collab-diff');
      return [d?.innerText ?? '', s ? s.serialize().data.features.length : 0, !!document.querySelector('dialog:modal'), d?.querySelector('[data-pick=go]').disabled]""")
    print('dieselbe Stelle:', seen[0].replace('\n', ' ')[:140], seen[1:])
    b.shot('collab_merge')
    # Auf der Karte die orange Linie antippen (ein Punkt nur bei Anna), dann „So übernehmen“
    picked = b.js("""const m = window.__wmap.map; const f = m.getSource('collab-diff').serialize().data.features
        .filter((x) => x.properties.side === 'theirs' && x.geometry.type === 'Point');
      const ll = f[f.length - 2]?.geometry.coordinates ?? f[0].geometry.coordinates;
      m.fire('click', { lngLat: maplibregl.LngLat.convert(ll), point: m.project(ll), originalEvent: new MouseEvent('click') });
      const go = document.querySelector('.collab-pickbar [data-pick=go]');
      const r = [document.querySelector('.pick-side[aria-pressed=true]')?.dataset.side, go.disabled];
      go.click(); return r""")
    print('auf der Karte gewählt:', picked)
    time.sleep(6)
    bt = b.js(TOURS)[0]
    gone = b.js("const s = window.__wmap.map.getSource('collab-diff'); return s ? s.serialize().data.features.length : 0")
    b.js("Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })")
    a.js("document.dispatchEvent(new Event('visibilitychange'))")
    time.sleep(5)
    at = next((t for t in a.js(TOURS) if t['id'] == 'c1'), {})
    last = lambda t: [round(x, 2) for x in t['points'][-1]]
    print('gewählt „Von Anna“:', len(bt['points']), last(bt), '| Anna:', len(at.get('points', [])), last(at), gone)
    checks['5. dieselbe Stelle: Leiste, beide Fassungen auf der Karte, Karte frei, Übernehmen erst nach Wahl; Tipp wählt Annas'] = ('Anna' in seen[0]
        and seen[1] > 0 and not seen[2] and seen[3] is True and picked == ['theirs', False])
    checks['5. „Von Anna“ gewählt: beide haben Annas Punkt, Anzeige weg'] = len(bt['points']) == 7 and last(bt) == [10.0, 51.55] and len(at['points']) == 7 and last(at) == [10.0, 51.55] and gone == 0
    # Chip: Anna hat geteilt, Bert ist eingeladen – im Planer und in der Liste, mit Tagen bis zum Ablauf
    chip = "return [...document.querySelectorAll('.collab-chip')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim())"
    plan_a = a.js(chip)
    a.d.get(f'{BASE}wege.html?tab=geplant'); time.sleep(4)
    b.d.get(f'{BASE}wege.html?tab=geplant'); time.sleep(4)
    list_a, list_b = a.js(chip), b.js(chip)
    print('Chips:', plan_a, list_a, list_b)
    checks['6. Chip: Anna „Geteilt · noch 30 Tage“, Bert „Eingeladen von Anna“'] = (any('Geteilt · noch 30 Tage' in x for x in plan_a + list_a)
        and any('Eingeladen von Anna · noch 30 Tage' in x for x in list_b))
    b.shot('collab_chip')
    # Carla hat die Runde schon selbst geplant: „Link öffnen“ in der Liste, dann mit ihrer Tour verbinden
    # (Berts Fenster mit leerem Speicher – ein drittes Firefox wäre zu viel Speicher)
    if True:
        cb = b
        cb.open('tour.html', 3)
        cb.js("localStorage.clear(); localStorage.setItem('wmap.myname', JSON.stringify('Carla')); return import('./js/data/store.js').then(({ tours }) => tours.save({ id: 'own1', name: 'Meine Runde', description: '', profile: 'hike', points: [[9.930, 51.530], [9.940, 51.536]] }))")
        cb.d.get(f'{BASE}wege.html?tab=geplant'); time.sleep(4)
        cb.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
        url = f"Schau mal: {BASE}tour.html#k={c['id']}.{c['key']}.{c['token']} – bis morgen"
        # Link in die Suche – darunter steht „Link öffnen“
        cb.js("const i = document.querySelector('.wege-search input'); i.value = arguments[0]; i.dispatchEvent(new Event('input', { bubbles: true }))", url)
        time.sleep(.5)
        cb.js("const x = document.querySelector('.wege-open-link'); if (!x.hidden) x.click()")
        time.sleep(6)
        q = cb.js("return [...document.querySelectorAll('dialog[open]')].map((d) => d.innerText + ' ' + [...d.querySelectorAll('option')].map((o) => o.textContent).join(' ')).join(' ')")
        cb.js("const d = [...document.querySelectorAll('dialog[open]')].pop(); d.querySelector('.collab-into select').value = 'own1'; [...d.querySelectorAll('button')].find((x) => /verbinden/.test(x.innerText)).click()")
        asked = []
        for _ in range(6):
            time.sleep(3)
            d = cb.js("const d = document.querySelector('.collab-pickbar') ?? [...document.querySelectorAll('dialog.collab-pick[open]')].pop(); return d ? d.innerText : ''")
            if not d: break
            asked.append(d.split('\n')[0])
            cb.js("""const bar = document.querySelector('.collab-pickbar');
              if (bar) { bar.querySelector('.pick-side[data-side=theirs]').click(); bar.querySelector('[data-pick=go]').click(); }
              else [...document.querySelectorAll('dialog.collab-pick[open] button')].find((x) => x.value === 'theirs').click()""")
        time.sleep(5)
        ct = cb.js(TOURS)
        at = next((t for t in a.js(TOURS) if t['id'] == 'c1'), {})
        print('Carla:', 'Gemeinsam planen' in q, 'Meine Runde' in q, asked, [(t['id'], t['name'], len(t['points']), bool(t.get('collab'))) for t in ct], cb.js("return location.search"))
        checks['7. Link öffnen, mit eigener Tour verbunden: gefragt, eine Tour, Stand vom Server'] = ('Meine Runde' in q and asked and len(ct) == 1
            and ct[0]['id'] == 'own1' and ct[0].get('collab', {}).get('id') == c['id'] and ct[0]['name'] == at.get('name') and len(ct[0]['points']) == len(at.get('points', [])))
    # Abgelaufen (31 Tage ohne Änderung): Anna speichert zweimal – ein Hinweis, Chip „Teilen abgelaufen“, Tour bleibt
    import subprocess
    subprocess.run(['docker', 'exec', 'php', 'php', '-r', f'$db = new PDO("sqlite:/var/www/html/web/wuefl_products/wmap/bEnd/data/wmap.sqlite"); $db->exec("UPDATE Shares SET changed = " . (time() - 31 * 86400) . ", created = " . (time() - 31 * 86400) . " WHERE id = \'{c["id"]}\'");'], check=True)
    a.d.get(f'{BASE}tour.html?id=c1'); time.sleep(6)
    first = a.js("return document.getElementById('toast')?.textContent ?? ''")   # das erste Abholen merkt es
    # jede Meldung einmal (der Text wird je Meldung neu gesetzt – childList am #toast)
    a.js("""window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList' && m.target.id === 'toast') window.__toasts.push(m.target.textContent); })
      .observe(document.body, { subtree: true, childList: true })""")
    for ll in ['10.01, 51.552', '10.02, 51.554']:
        a.js("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); " + click % ll)
        time.sleep(5)
    toasts = a.js("return window.__toasts")
    gone = a.js(chip)
    at = next((t for t in a.js(TOURS) if t['id'] == 'c1'), {})
    print('abgelaufen:', first, toasts, gone, len(at.get('points', [])), at.get('collab', {}).get('gone'))
    checks['8. abgelaufen: einmal Bescheid, Chip „Teilen abgelaufen“, Tour bleibt mit Änderungen'] = ('abgelaufen' in first
        and not any('abgelaufen' in x or 'nicht mehr' in x for x in toasts) and any('Teilen abgelaufen' in x for x in gone) and len(at.get('points', [])) == 9)
    r = a.d.execute_async_script("""const done = arguments[0];
      Promise.all([import('./js/data/store.js'), import('./js/data/short-link.js'), import('./js/services/api.js')]).then(async ([s, k, api]) => {
        const code = await s.encodeShare({ name: 'Kurz', description: '', profile: 'hike', points: [[9.93, 51.53], [9.95, 51.54]] });
        const neu = await k.shortLink('tour', code);
        const { id } = await api.api(['share', 'put'], { kind: 'tour', code });
        done([neu, `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tour.html#k=${id}`]);
      }).catch((e) => done(String(e)))""")
    seen = []
    for u in [r[0], r[1], r[0][:-3] + 'AAA']:
        b.d.get('about:blank'); b.d.get(u); time.sleep(4)
        seen.append(b.js("return document.title"))
    print('Kurzlinks:', r[0].split('#')[1], seen)
    checks['4. verschlüsselt, alt geht, falscher Schlüssel nicht'] = '.' in r[0].split('#k=')[1] and seen[:2] == ['Kurz – WMap', 'Kurz – WMap'] and seen[2] != 'Kurz – WMap'
    for k, v in checks.items():
        print(('ok    ' if v else 'FALSCH') + ' ' + k)
    bad = a.report() or b.report()
    sys.exit(bad or not all(checks.values()))
