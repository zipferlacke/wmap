"""Plugin-Ordner (data/plugin-folders.js): lose GeoJSON, wmap-plugin.json (Ebene, Kacheln, Erweiterung), kaputte Datei,
neu einlesen ersetzt und behält Schalter, Erweiterung aus dem Ordner startet; Plugin-Seite und Anleitung (Firefox: nur einmal einlesen)."""
import json
import sys
from common import Browser

PT = json.dumps({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'pegel': 3}, 'geometry': {'type': 'Point', 'coordinates': [10.1, 51.5]}}]})
FILES = {
    'Hochsitze.geojson': PT,
    'Messnetz/wmap-plugin.json': json.dumps({'name': 'Messnetz Harz', 'description': 'Grundwasser', 'operator': 'Verband', 'data': 'messstellen.geojson', 'color': '#123456', 'colorBy': 'pegel'}),
    'Messnetz/messstellen.geojson': PT,
    'Geologie/wmap-plugin.json': json.dumps({'name': 'Geologie', 'tiles': 'https://example.org/{z}/{x}/{y}.png', 'opacity': 0.5}),
    'Warnung/wmap-plugin.json': json.dumps({'name': 'Wetterwarnung', 'type': 'extension', 'script': 'main.js'}),
    'Warnung/main.js': "export function activate(wmap) { window.__ext = wmap.version; }",
    'lose.js': "export function activate() {}",
    'kaputt.geojson': '{nicht json',
}

RUN = """
const done = arguments[arguments.length - 1];
(async () => {
  const files = Object.entries(arguments[0]).map(([path, t]) => ({ path, text: async () => t }));
  const { _importFiles } = await import('./js/data/plugin-folders.js');
  const { layers } = await import('./js/map/layers.js');
  const { extensions, runExtensions } = await import('./js/map/extensions.js');
  const mine = async () => (await layers.all()).filter((l) => l.source?.folder === 'test');
  const r1 = await _importFiles('test', files);
  const l1 = await mine();
  // Schalter ändern: Messnetz von der Karte, Erweiterung an
  const m = l1.find((l) => l.name === 'Messnetz Harz'); await layers.put({ ...m, onMain: false });
  const ex = await extensions.all(); await extensions.save(ex.map((x) => (x.folder === 'test' && x.name === 'Wetterwarnung' ? { ...x, active: true } : x)));
  const r2 = await _importFiles('test', files);
  const l2 = await mine();
  const e2 = (await extensions.all()).filter((x) => x.folder === 'test');
  await runExtensions({ map: { loaded: () => true, once() {} }, toast: (t) => { window.__toast = t; } });
  const out = {
    r1, r2, names: l1.map((l) => l.name).sort(), count2: l2.length,
    messnetz: (({ color, colorBy, description, operator }) => ({ color, colorBy, description, operator }))(l2.find((l) => l.name === 'Messnetz Harz')),
    messnetzOnMain: l2.find((l) => l.name === 'Messnetz Harz').onMain,
    geo: l2.find((l) => l.name === 'Geologie')?.raster?.tiles, opacity: l2.find((l) => l.name === 'Geologie')?.opacity,
    exts: e2.map((x) => `${x.name}:${x.active}`).sort(), ran: window.__ext ?? null, toast: window.__toast ?? null,
  };
  for (const l of l2) await layers.remove(l.id);
  await extensions.save((await extensions.all()).filter((x) => x.folder !== 'test'));
  return out;
})().then(done, (e) => done('FEHLER ' + e));
"""

with Browser(width=420, height=900) as b:
    b.open('plugins.html', wait=3)
    r = b.d.execute_async_script(RUN, FILES)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    ok = isinstance(r, dict) and r['names'] == ['Geologie', 'Hochsitze', 'Messnetz Harz'] and r['count2'] == 3 \
        and r['messnetz'] == {'color': '#123456', 'colorBy': 'pegel', 'description': 'Grundwasser', 'operator': 'Verband'} \
        and r['messnetzOnMain'] is False and r['geo'] and r['opacity'] == 0.5 \
        and r['exts'] == ['Wetterwarnung:true', 'lose:false'] and r['ran'] and r['r1']['failed'] == ['kaputt.geojson']
    print('stimmt:', ok)
    if not ok:
        b.errors.append(('plugin-ordner', 'Ergebnis falsch'))
    # Firefox: nur einmal einlesen – Knopf „Ordner einlesen“ statt „hinzufügen“, Hinweis
    print('Firefox:', b.js("return [document.querySelector('[data-add=plugin-folder]').hidden, document.querySelector('input[data-add=folder-once]').closest('label').hidden, document.querySelector('.plug-folders').innerText.slice(0, 60)]"))
    b.js("document.querySelector('.plug-add').scrollIntoView()")
    b.shot('plugin-ordner')
    b.open('plugin-anleitung.html', wait=2)
    print('Anleitung:', b.js("return [...document.querySelectorAll('h3')].map((h) => h.innerText)"))
    b.shot('plugin-anleitung')
    sys.exit(b.report())
