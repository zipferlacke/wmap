"""Updates (sw.js, js/ui/news.js): Service Worker lädt die Version vorab (cache first, über 127.0.0.1 statt localhost),
„Neue Version verfügbar“ mit Später (fragt dann erst beim nächsten Start wieder), minVersion zwingend (Escape schließt nicht),
minAppVersion sperrt die App (sichern, Download-Seite), Aktualisieren springt zur neuesten und zeigt alles Neue seit der gesehenen Version."""
import json
import sys
import time
import common
from common import Browser

common.BASE = common.BASE.replace('//localhost', '//127.0.0.1')

# Läuft als Modul in der Seite selbst (Skripte aus WebDriver haben in Firefox eigene Module)
STEPS = r"""
const done = (v) => { window.__result = JSON.stringify(v); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dialog = () => document.getElementById('update-dialog');
const text = (el) => el?.innerText.replace(/\s+/g, ' ').trim();
const buttons = () => [...(dialog()?.querySelectorAll('.confirm-actions button') ?? [])].map(text);
const escape = () => dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
(async () => {
  const { checkUpdates } = await import('./js/ui/news.js');
  const out = {};
  // Neue Version ohne Zwang: Später → erst beim nächsten Start wieder
  let p = checkUpdates({ changelog: [{ version: '9.9.9' }] });
  await wait(300);
  out.normal = { title: text(dialog()?.querySelector('h2')), buttons: buttons() };
  dialog().querySelector('button[value=later]').click();
  await p;
  out.afterLater = !!dialog();
  checkUpdates({ changelog: [{ version: '9.9.9' }] });
  await wait(300);
  out.askedAgain = !!dialog();
  // minVersion: zwingend, Escape schließt nicht
  checkUpdates({ changelog: [{ version: '9.9.9' }], minVersion: '9.9.9' });
  await wait(300);
  out.forced = { title: text(dialog()?.querySelector('h2')), buttons: buttons() };
  escape(); await wait(200);
  out.forcedStays = !!dialog()?.open;
  dialog().remove();
  // minAppVersion: App zu alt → gesperrt, sichern und zur Download-Seite
  window.__TAURI__ = { app: { getVersion: async () => '2.0.0' } };
  checkUpdates({ changelog: [{ version: '2.1.0' }], minAppVersion: '2.1.0' });
  await wait(500);
  out.app = { title: text(dialog()?.querySelector('h2')), buttons: buttons() };
  escape(); await wait(200);
  out.appStays = !!dialog()?.open;
  dialog().remove();
  delete window.__TAURI__;
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=900) as b:
    b.open('index.html?q=Test', wait=3)
    # Service Worker: die Version wird ganz vorab geladen
    sw = b.wait("""return navigator.serviceWorker.controller && caches.keys().then(async (k) => {
        const app = k.find((x) => x.startsWith('wmap-app-'));
        return app ? [app, (await (await caches.open(app)).keys()).length] : null; })""", 90)
    files = len(json.load(open('../appdata/sw-files.json')))
    version = json.load(open('../appdata/messages.json'))['changelog'][0]['version']
    print('Service Worker:', sw, 'von', files)
    ok_sw = bool(sw) and sw[0] == f'wmap-app-{version}' and sw[1] >= files * 0.95

    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 60))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.shot('update-app')
    ok = isinstance(r, dict) \
        and r['normal'] == {'title': 'system_update Neue Version verfügbar', 'buttons': ['Später', 'system_update Aktualisieren']} \
        and not r['afterLater'] and not r['askedAgain'] \
        and r['forced']['buttons'] == ['system_update Aktualisieren'] and r['forcedStays'] \
        and r['app']['title'] == 'system_update WMap-App aktualisieren' and r['app']['buttons'] == ['save Als ZIP sichern', 'open_in_new Zur Download-Seite'] \
        and r['appStays']
    print('Popups stimmen:', ok)

    # Aktualisieren: ohne neuen Service Worker die gespeicherte Oberfläche verwerfen, neu laden –
    # danach alles Neue seit der gesehenen Version (auch ohne Karte beim normalen Start)
    b.open('dashboard.html', wait=3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '2.0.0', messages: [] })); window.__alt = 1;")
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = \"import('./js/ui/news.js').then((m) => m.applyUpdate())\"; document.head.append(s);")
    news = b.wait("return !window.__alt && document.querySelector('dialog.news[open] h2') && [...document.querySelectorAll('dialog.news[open] .news-release h3')].map((h) => h.innerText.match(/\d+\.\d+\.\d+/)?.[0])", 60)
    print('Nach dem Aktualisieren – Versionen im Dialog:', news)
    b.shot('update-neu')
    # alle Versionen seit der gesehenen (2.0.0) bis zur laufenden
    log = [v['version'] for v in json.load(open('../appdata/messages.json'))['changelog']]
    ok_news = bool(news) and news == log[:log.index('2.0.0')]

    print('Service Worker stimmt:', ok_sw, '· Popups:', ok, '· Neues danach:', ok_news)
    if not (ok_sw and ok and ok_news):
        b.errors.append(('update', 'Ergebnis falsch'))
    sys.exit(b.report())
