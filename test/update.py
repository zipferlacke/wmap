"""Updates (sw.js, js/ui/news.js): Service Worker lädt die Version vorab (cache first, über 127.0.0.1 statt localhost),
neue Version: Aktualisieren und Später, erst nach dem Klick Ladebalken ohne Knöpfe (nicht unterwegs, Scheitern bringt die Knöpfe zurück), minVersion zwingend, auch unterwegs,
minAppVersion sperrt die App (sichern, Download-Seite), appVersion: ältere App bekommt den Hinweis statt des Web-Updates, Aktualisieren springt zur neuesten und zeigt alles Neue seit der gesehenen Version."""
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
const buttons = () => [...(dialog()?.querySelectorAll('.confirm-actions button') ?? [])].filter((x) => x.offsetParent).map(text);
const click = (v) => dialog().querySelector(`button[value=${v}]`).click();
const escape = () => dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
(async () => {
  const { checkUpdates } = await import('./js/ui/news.js');
  const out = {};
  // Service Worker nachgestellt: wir geben Fortschritt und Ende selbst vor (die Seite läd sonst neu)
  const fake = new EventTarget(); fake.state = 'installing';
  const sw = navigator.serviceWorker;
  const real = sw.getRegistration.bind(sw);
  let updates = 0;
  sw.getRegistration = async () => ({ update: async () => { updates += 1; }, installing: fake, waiting: null });
  // Neue Version ohne Zwang: erst fragen, nichts laden, kein Balken
  let p = checkUpdates({ changelog: [{ version: '9.9.9' }] });
  await wait(400);
  const barOf = () => dialog()?.querySelector('.update-bar');
  const barShown = () => !!barOf()?.offsetParent;
  out.normal = { title: text(dialog()?.querySelector('.uD-title')), buttons: buttons(), bar: barShown(), updates };
  // Später: erst beim nächsten Start wieder
  click('later');
  await p;
  out.afterLater = !!dialog()?.open;
  await checkUpdates({ changelog: [{ version: '9.9.9' }] });
  await wait(200);
  out.askedAgain = !!dialog()?.open;
  sessionStorage.removeItem('wmap.update.later');
  // Aktualisieren: Knöpfe weg, Balken mit Fortschritt, nicht wegzuklicken
  checkUpdates({ changelog: [{ version: '9.9.9' }] });
  await wait(300);
  click('update');
  await wait(300);
  out.loading = { buttons: buttons(), bar: barShown(), updates, text: text(dialog()?.querySelector('.update-text')) };
  sw.dispatchEvent(new MessageEvent('message', { data: { type: 'update-progress', done: 50, total: 200 } }));
  out.progress = { now: barOf()?.getAttribute('aria-valuenow'), width: barOf()?.querySelector('i').style.width, text: text(dialog()?.querySelector('.update-status')) };
  escape(); await wait(200);
  out.stays = !!dialog()?.open;
  // Laden gescheitert: kein Neuladen, die Knöpfe sind wieder da
  window.__before = 1;
  fake.state = 'redundant'; fake.dispatchEvent(new Event('statechange'));
  await wait(400);
  out.failed = { buttons: buttons(), bar: barShown(), status: text(dialog()?.querySelector('.update-status')) };
  click('later');
  await wait(200);
  sessionStorage.removeItem('wmap.update.later');
  // Unterwegs: nicht fragen
  document.body.classList.add('navigating');
  await checkUpdates({ changelog: [{ version: '9.9.9' }] });
  out.navSkips = !dialog()?.open;
  document.body.classList.remove('navigating');
  // minVersion: zwingend, auch unterwegs, nur Aktualisieren
  const fake2 = new EventTarget(); fake2.state = 'installing';
  sw.getRegistration = async () => ({ update: async () => {}, installing: fake2, waiting: null });
  document.body.classList.add('navigating');
  checkUpdates({ changelog: [{ version: '9.9.9' }], minVersion: '9.9.9' });
  await wait(400);
  document.body.classList.remove('navigating');
  out.forced = { title: text(dialog()?.querySelector('.uD-title')), buttons: buttons(), bar: barShown() };
  escape(); await wait(200);
  out.forcedStays = !!dialog()?.open;
  dialog()?.remove();
  sw.getRegistration = real;
  // minAppVersion: App zu alt → gesperrt, sichern und zur Download-Seite
  window.__TAURI__ = { app: { getVersion: async () => '2.0.0' } };
  checkUpdates({ changelog: [{ version: '2.1.0' }], minAppVersion: '2.1.0' });
  await wait(500);
  out.app = { title: text(dialog()?.querySelector('.uD-title')), buttons: buttons() };
  escape(); await wait(200);
  out.appStays = !!dialog()?.open;
  dialog().remove();
  // appVersion: App nicht die aktuelle → Hinweis mit Link, „Später“ geht; das Web-Update wird nicht angeboten
  window.__TAURI__ = { app: { getVersion: async () => '2.1.0' } };
  checkUpdates({ changelog: [{ version: '9.9.9', appVersion: '2.2.0' }, { version: '9.9.8', appVersion: '2.0.0' }], minAppVersion: '2.1.0' });
  await wait(500);
  out.hint = { title: text(dialog()?.querySelector('.uD-title')), buttons: buttons(), text: text(dialog()) };
  [...dialog().querySelectorAll('button')].find((x) => /Später/.test(x.innerText)).click(); await wait(300);
  out.hintGone = !dialog()?.open;
  checkUpdates({ changelog: [{ version: '9.9.9', appVersion: '2.2.0' }] });
  await wait(300);
  out.hintAgain = !!dialog()?.open;
  // App aktuell: das Web-Update kommt wie immer
  window.__TAURI__ = { app: { getVersion: async () => '2.2.0' } };
  checkUpdates({ changelog: [{ version: '9.9.9', appVersion: '2.2.0' }] });
  await wait(500);
  out.current = text(dialog()?.querySelector('.uD-title'));
  dialog()?.remove();
  delete window.__TAURI__;
  return out;
})().then(done, (e) => done('FEHLER ' + e + ' ' + e.stack));
"""

with Browser(width=420, height=900) as b:
    b.open('index.html?q=Test', wait=3)
    # Service Worker: die Version wird ganz vorab geladen
    sw = b.wait("""return navigator.serviceWorker.controller && caches.keys().then(async (k) => {
        const app = k.find((x) => x.startsWith('wmap-app-'));
        if (!app) return null;
        const keys = (await (await caches.open(app)).keys()).map((r) => new URL(r.url).pathname);
        return [app, keys.length, keys.filter((p) => p.includes('/appdata/lang/')).map((p) => p.split('/').pop()).sort()]; })""", 90)
    # Sprachen: nur Deutsch und die Liste – andere erst, wenn man sie wählt
    names = json.load(open('../appdata/sw-files.json'))
    names = list(names['files']) if isinstance(names, dict) else names
    files = len([f for f in names if not f.startswith('appdata/lang/') or f.endswith(('de_DE.json', 'languages.json'))])
    version = json.load(open('../appdata/messages.json'))['changelog'][0]['version']
    print('Service Worker:', sw, 'von', files)
    ok_sw = bool(sw) and sw[0].startswith(f'wmap-app-{version}-') and sw[1] >= files * 0.95 \
        and sw[2] == ['de_DE.json', 'languages.json']

    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait("return window.__result", 60))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.shot('update-app')
    ok = isinstance(r, dict) \
        and r['normal'] == {'title': 'system_update Neue Version verfügbar', 'buttons': ['Später', 'system_update Aktualisieren'], 'bar': False, 'updates': 0} \
        and not r['afterLater'] and not r['askedAgain'] \
        and r['loading']['buttons'] == [] and r['loading']['bar'] and r['loading']['updates'] == 1 and 'wird geladen' in r['loading']['text'] \
        and r['progress'] == {'now': '25', 'width': '25%', 'text': '25 %'} and r['stays'] \
        and r['failed']['buttons'] == ['Später', 'system_update Aktualisieren'] and not r['failed']['bar'] and 'nicht geklappt' in r['failed']['status'] and r['navSkips'] \
        and r['forced'] == {'title': 'system_update Update nötig', 'buttons': ['system_update Aktualisieren'], 'bar': False} and r['forcedStays'] \
        and r['app']['title'] == 'system_update WMap-App aktualisieren' and r['app']['buttons'] == ['save Als ZIP sichern', 'open_in_new Zur Download-Seite'] \
        and r['appStays']
    print('Popups stimmen:', ok)
    hint = isinstance(r, dict) and r['hint']['title'] == 'system_update Neue Version der WMap-App' \
        and r['hint']['buttons'] == ['Später', 'open_in_new Zur Download-Seite'] and '2.2.0' in r['hint']['text'] and '2.1.0' in r['hint']['text'] \
        and r['hintGone'] and not r['hintAgain'] and r['current'] == 'system_update Neue Version verfügbar'
    print('appVersion stimmt (App älter: Hinweis statt Web-Update, Später gilt bis zum nächsten Start; App aktuell: Web-Update):', hint)
    ok = ok and hint

    # Aktualisieren: ohne neuen Service Worker die gespeicherte Oberfläche verwerfen, neu laden –
    # danach alles Neue seit der gesehenen Version (auch ohne Karte beim normalen Start)
    b.open('dashboard.html', wait=3)
    b.js("localStorage.setItem('wmap.seen', JSON.stringify({ version: '2.0.0', messages: [] })); localStorage.setItem('wmap.stats.asked', '1'); window.__alt = 1;")
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = \"import('./js/ui/news.js').then((m) => m.applyUpdate())\"; document.head.append(s);")
    news = b.wait("return !window.__alt && document.querySelector('dialog.news[open] .uD-title') && [...document.querySelectorAll('dialog.news[open] .news-release h3')].map((h) => h.innerText.match(/[0-9]+[.][0-9]+[.][0-9]+/)?.[0])", 60)
    print('Nach dem Aktualisieren – Versionen im Dialog:', news)
    b.shot('update-neu')
    # alle Versionen seit der gesehenen (2.0.0) bis zur laufenden
    log = [v['version'] for v in json.load(open('../appdata/messages.json'))['changelog']]
    ok_news = bool(news) and news == log[:log.index('2.0.0')]

    print('Service Worker stimmt:', ok_sw, '· Popups:', ok, '· Neues danach:', ok_news)
    if not (ok_sw and ok and ok_news):
        b.errors.append(('update', 'Ergebnis falsch'))
    sys.exit(b.report())
