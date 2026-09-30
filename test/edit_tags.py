"""Ort bearbeiten (osm/edit.js): Reihenfolge (Name, Angaben wie in der Ortskarte, Grundlegendes, Ausgefülltes, zugeklappt
„Weiteres“ mit „Alle Tags“ am Ende), Beschreibung, Merkmale, alle Tags (entfernen), was hochgeladen würde; Ortskarte mit
Merkmalen, Angaben nicht antippbar. OSM wird im Browser nachgestellt (fetch abgefangen) – nichts geht an den echten Server."""
import sys
import time
from common import Browser

TAGS = {'name': 'Bäckerei Test', 'shop': 'bakery', 'opening_hours': 'Mo-Fr 08:00-18:00', 'delivery': 'no', 'fixme': 'prüfen', 'website': 'https://example.org/?a=b'}

# Oberste Ebene des Formulars und was unter „Weiteres“ steht
ORDER = """const f = document.querySelector('dialog .osm-form');
const top = [...f.children].map((el) => el.matches('.osm-facts') ? ['Angaben', [...el.querySelectorAll('[name]:not([name=gone])')].map((n) => n.name.replace(/^(socket|payment):.*/, '$1:'))]
  : el.matches('details.osm-more') ? 'Weiteres' : el.matches('.osm-traits') ? 'Merkmale' : el.matches('.oh-block') ? 'opening_hours' : el.querySelector('[name]')?.name);
const more = [...f.querySelectorAll('details.osm-more [name]')].map((n) => n.name);
return { top: top.map((x) => Array.isArray(x) ? [x[0], [...new Set(x[1])]] : x), more, open: f.querySelector('details.osm-more').open };"""

SETUP = """
const tags = arguments[0];
window.__sent = [];
const real = window.fetch.bind(window);
window.fetch = async (url, o = {}) => {
  const u = String(url);
  if (!u.includes('openstreetmap.org')) return real(url, o);
  window.__sent.push({ u, method: o.method ?? 'GET', body: typeof o.body === 'string' ? o.body : String(o.body ?? '') });
  if (u.includes('/nodes.json')) return new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, version: 3, lat: 51.5, lon: 9.9, tags }] }));
  if (u.endsWith('/changeset/create')) return new Response('123');
  return new Response('ok');
};
localStorage.setItem('wmap.osm.token.live', JSON.stringify('test'));
localStorage.setItem('wmap.osm.user.live', JSON.stringify({ name: 'Test' }));
const { editPlace } = await import('./js/osm/edit.js');
window.__done = false;
editPlace({ osm: { type: 'node', id: 1 }, tags: { ...tags }, point: [9.9, 51.5], title: tags.name }, { toast: (t) => { window.__toast = t; } }).then(() => { window.__done = true; });
return 1;
"""

with Browser(width=420, height=900) as b:
    b.open('settings.html', wait=2)
    b.d.execute_async_script('const done = arguments[arguments.length - 1]; (async () => {' + SETUP + '})().then(done, (e) => done(String(e)))', TAGS)
    time.sleep(.8)
    print('Felder:', b.js("return [...document.querySelectorAll('dialog .osm-field > span, dialog .osm-more > summary')].map((s) => s.innerText.split('\\n')[0].trim())"))
    order = b.js(ORDER)
    print('Aufbau:', order)
    ok_order = order['top'] == ['name', ['Angaben', ['opening_hours', 'cuisine', 'outdoor_seating', 'wheelchair', 'phone']], 'description', 'website', 'Merkmale', 'Weiteres'] \
        and order['more'][-1] == '_raw' and 'organic' in order['more'] and 'delivery' not in order['more'] and 'addr:street' in order['more'] and not order['open']
    print('Aufbau stimmt:', ok_order)
    if not ok_order:
        b.errors.append(('aufbau', 'Reihenfolge im Dialog falsch'))
    raw = b.js("return document.querySelector('dialog textarea[name=_raw]').value")
    print('Alle Tags:', raw.replace('\n', ' | '))
    b.js("""const d = document.querySelector('dialog');
      d.querySelectorAll('details').forEach((x) => { x.open = true; });
      const set = (sel, v) => { const e = d.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('textarea[name=description]', 'Bio-Bäckerei mit Café');
      set('select[name=organic]', 'only');
      set('select[name=delivery]', 'yes');
      const r = d.querySelector('textarea[name=_raw]'); set('textarea[name=_raw]', r.value.split('\\n').filter((l) => !l.startsWith('fixme=')).join('\\n'));""")
    b.shot('bearbeiten-merkmale')
    b.js("const d = document.querySelector('dialog'); d.scrollTop = d.querySelector('.osm-traits').offsetTop - 60")
    b.shot('bearbeiten-merkmale-2')
    b.js("[...document.querySelectorAll('dialog button')].find((x) => /Speichern/.test(x.innerText)).click()")
    b.wait('return window.__done', 10)
    up = [s for s in b.js('return window.__sent') if s['u'].endswith('/upload')]
    body = up[0]['body'] if up else ''
    print('Toast:', b.js('return window.__toast'))
    ok = all(x in body for x in ['k="description" v="Bio-Bäckerei mit Café"', 'k="organic" v="only"', 'k="delivery" v="yes"', 'k="shop" v="bakery"', 'k="opening_hours" v="Mo-Fr 08:00-18:00"', 'v="https://example.org/?a=b"']) and 'fixme' not in body
    print('Hochgeladen stimmt:', ok)
    if not ok:
        print(body)
        b.errors.append(('upload', 'falscher Inhalt'))
    # Ortskarte: Merkmale unter dem Namen, Beschreibung
    card = b.d.execute_async_script("""const done = arguments[arguments.length - 1];
      import('./js/ui/poi-info.js').then((m) => {
        const info = m.describePoi({ name: 'Bäckerei Test', shop: 'bakery', delivery: 'yes', organic: 'only', description: 'Bio-Bäckerei mit Café' });
        const el = document.createElement('div'); el.innerHTML = m.poiCard(info);
        done([el.querySelector('header small')?.textContent, el.querySelector('.poi-desc')?.textContent]);
      });""")
    print('Ortskarte:', card)
    if not card or 'Lieferdienst' not in (card[0] or '') or 'Nur Bio' not in (card[0] or ''):
        b.errors.append(('karte', 'Merkmale fehlen'))
    # Ladesäule: Angaben je Art oben (mit Öffnungszeiten), die Kacheln der Ortskarte öffnen nichts
    CHARGE = {'amenity': 'charging_station', 'name': 'Ladesäule Test', 'contact:website': 'https://alt.example'}
    card = b.d.execute_async_script("""const done = arguments[arguments.length - 1];
      import('./js/ui/poi-info.js').then((m) => {
        const el = document.createElement('div'); el.innerHTML = m.poiCard(m.describePoi(arguments[0]));
        done([[...el.querySelectorAll('.poi-facts > div')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim()), el.querySelectorAll('[data-edit], [role=button]').length]);
      });""", CHARGE)
    print('Ortskarte Ladesäule:', card)
    if card[1]:
        b.errors.append(('karte', 'Kacheln sind noch antippbar'))
    b.d.execute_async_script('const done = arguments[arguments.length - 1]; (async () => {' + SETUP + '})().then(done, (e) => done(String(e)))', CHARGE)
    time.sleep(.8)
    order = b.js(ORDER)
    print('Aufbau Ladesäule:', order)
    if order['top'] != ['name', ['Angaben', ['capacity', 'socket:', 'fee', 'operator', 'opening_hours', 'access', 'payment:']], 'description', 'phone', 'contact:website', 'Weiteres'] \
            or order['more'][-1] != '_raw':
        b.errors.append(('aufbau', 'Reihenfolge Ladesäule falsch'))
    b.js("""const d = document.querySelector('dialog');
      const set = (sel, v) => { const e = d.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('input[name="socket:type2"]', '2');
      set('input[name="socket:type2:output"]', '22 kW');
      set('input[name=capacity]', '2');
      set('select[name=fee]', 'no');
      const app = d.querySelector('input[name="payment:app"]'); app.checked = true; app.dispatchEvent(new Event('change', { bubbles: true }));
      set('input[name="contact:website"]', 'https://neu.example');""")
    b.shot('bearbeiten-ladesaeule')
    b.js("[...document.querySelectorAll('dialog button')].find((x) => /Speichern/.test(x.innerText)).click()")
    b.wait('return window.__done', 10)
    up = [s for s in b.js('return window.__sent') if s['u'].endswith('/upload')]
    body = up[-1]['body'] if up else ''
    ok2 = all(x in body for x in ['k="socket:type2" v="2"', 'k="socket:type2:output" v="22 kW"', 'k="capacity" v="2"', 'k="fee" v="no"',
                                  'k="payment:app" v="yes"', 'k="contact:website" v="https://neu.example"']) and 'k="website"' not in body
    print('Ladesäule hochgeladen stimmt:', ok2)
    if not ok2:
        print(body)
        b.errors.append(('ladesäule', 'falscher Inhalt'))
    b.js("localStorage.removeItem('wmap.osm.token.live'); localStorage.removeItem('wmap.osm.user.live')")
    sys.exit(b.report())
