"""WMap-Konto über OpenStreetMap (bEnd/api_auth.php, osm_login.php): id_token prüfen, Konto anlegen/wiederfinden, löschen.
Statt OSM signiert ein Testschlüssel – er steht für die Dauer des Tests im Schlüsselspeicher des Servers."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'http://localhost:8080/web/wuefl_products/wmap/bEnd/api.php'
CACHE = os.path.join(ROOT, 'bEnd/data/osm-jwks.json')
ISS = 'https://www.openstreetmap.org'
CLIENT = open(os.path.join(ROOT, 'bEnd/config.php')).read().split('OSM_CLIENT_ID = "')[1].split('"')[0]
SUB = str(900000000 + int(time.time()) % 1000000)   # keine echte OSM-Nutzer-ID

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
tmp = tempfile.mkdtemp()
key = os.path.join(tmp, 'k.pem')
subprocess.run(['openssl', 'genrsa', '-out', key, '2048'], check=True, capture_output=True)
mod = subprocess.run(['openssl', 'rsa', '-in', key, '-noout', '-modulus'], check=True, capture_output=True, text=True).stdout.split('=')[1].strip()
jwk = {'kty': 'RSA', 'kid': 'wmap-test', 'alg': 'RS256', 'n': b64(bytes.fromhex(mod)), 'e': 'AQAB'}


def token(**over):
    claims = {'iss': ISS, 'aud': CLIENT, 'sub': SUB, 'exp': int(time.time()) + 120, 'iat': int(time.time()),
              'preferred_username': 'WMap Test'} | over
    head = b64(json.dumps({'alg': 'RS256', 'kid': 'wmap-test', 'typ': 'JWT'}).encode())
    body = b64(json.dumps(claims).encode())
    sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key], input=f'{head}.{body}'.encode(), check=True, capture_output=True).stdout
    return f'{head}.{body}.{b64(sig)}'


def api(path, data=None, bearer=None):
    body = urllib.parse.urlencode({'request': json.dumps(path), 'data': json.dumps(data or {})}).encode()
    req = urllib.request.Request(API, body, {'Authorization': f'Bearer {bearer}'} if bearer else {})
    raw = urllib.request.urlopen(req).read()
    try:
        return json.loads(raw)
    except ValueError:
        raise SystemExit(f"keine JSON-Antwort: {raw[:600]!r}")


fails = 0
def check(name, ok, got=''):
    global fails
    fails += not ok
    print(('OK  ' if ok else 'FEHLER ') + name, '' if ok else got)


old = open(CACHE).read() if os.path.exists(CACHE) else None
try:
    with open(CACHE, 'w') as f:
        json.dump({'time': int(time.time()), 'keys': [jwk]}, f)
    r = api(['auth', 'osm'], {'id_token': token()})
    check('anmelden legt Konto an', r[0] == 0 and r[1]['user']['name'] == 'WMap Test', r)
    t1, uid = r[1]['token'], r[1]['user']['id']
    r = api(['auth', 'osm'], {'id_token': token(preferred_username='WMap Umbenannt')})
    check('zweites Mal: dasselbe Konto, neuer Name', r[0] == 0 and r[1]['user']['id'] == uid and r[1]['user']['name'] == 'WMap Umbenannt', r)
    check('me mit Token', api(['auth', 'me'], bearer=t1)[1]['id'] == uid)
    for name, tok in [
        ('fremde Anwendung', token(aud='andere-app')),
        ('Testserver statt openstreetmap.org', token(iss='https://master.apis.dev.openstreetmap.org')),
        ('abgelaufen', token(exp=int(time.time()) - 600)),
        ('Signatur verändert', token()[:-6] + 'AAAAAA'),
        ('Inhalt verändert', (lambda p: p[0] + '.' + b64(json.dumps({'iss': ISS, 'aud': CLIENT, 'sub': '1', 'exp': 9999999999}).encode()) + '.' + p[2])(token().split('.'))),
        ('kein Token', ''),
    ]:
        r = api(['auth', 'osm'], {'id_token': tok})
        check(f'abgelehnt: {name}', r[0] == 1, r)
        print('     ', r[1])
    s = api(['auth', 'summary'], bearer=t1)
    check('summary', s[0] == 0 and 'passkeys' not in s[1] and s[1]['tours'] == 0, s)
    check('löschen ohne Anmeldung geht nicht', api(['auth', 'delete'])[0] == 1)
    d = api(['auth', 'delete'], bearer=t1)
    check('löschen', d[0] == 0 and d[1]['name'] == 'WMap Umbenannt', d)
    check('Token danach ungültig', api(['auth', 'me'], bearer=t1)[1] is None)
    r = api(['auth', 'osm'], {'id_token': token()})
    check('nach dem Löschen: neues Konto', r[0] == 0 and r[1]['user']['id'] != uid, r)
    api(['auth', 'delete'], bearer=r[1]['token'])
    # Konto aus der Passkey-Zeit, noch angemeldet: wird übernommen statt neu angelegt
    import hashlib, sqlite3
    old_tok = b64(os.urandom(32))
    db = sqlite3.connect(os.path.join(ROOT, 'bEnd/data/wmap.sqlite'))
    cur = db.execute("INSERT INTO Users (name) VALUES ('Alt mit Passkey')")
    old_id = cur.lastrowid
    db.execute('INSERT INTO Sessions (token, user_id, expires) VALUES (?, ?, ?)', (hashlib.sha256(old_tok.encode()).hexdigest(), old_id, int(time.time()) + 3600))
    db.commit()
    r = api(['auth', 'osm'], {'id_token': token(sub=str(int(SUB) + 1))}, bearer=old_tok)
    check('altes Konto übernommen', r[0] == 0 and r[1]['user']['id'] == old_id and r[1]['user']['name'] == 'WMap Test', r)
    api(['auth', 'delete'], bearer=r[1]['token'])

    # ── Im Browser: Rückkehr von OSM (Token-Tausch nachgestellt), Einstellungen, Abmelden, Löschen
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from common import Browser
    FAKE = '''
      const [idToken, sub] = arguments;
      const real = window.fetch.bind(window);
      window.fetch = (url, o) => {
        const u = String(url);
        const json = (v) => Promise.resolve(new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }));
        if (u.startsWith('https://www.openstreetmap.org/oauth2/token')) return json({ access_token: 'osm-test', id_token: idToken });
        if (u.includes('/user/details.json')) return json({ user: { display_name: 'WMap Test', id: +sub } });
        return real(url, o);
      };
      localStorage.setItem('wmap.osm.pkce', JSON.stringify({ verifier: 'v', state: 's~x', server: 'live', at: Date.now(), from: location.href }));
      localStorage.setItem('wmap.osm.return', JSON.stringify({ type: 'osm-oauth', code: 'c', state: 's~x' }));
      return import('./js/osm/api.js').then((m) => m.finishLogin()).then(() => 1);'''
    with Browser(width=420, height=900) as br:
        br.open('settings.html', wait=2)
        txt = br.js("return document.querySelector('#osm').innerText")
        check('Einstellungen: Anmelden mit OpenStreetMap, kein Passkey', 'Mit OpenStreetMap anmelden' in txt and 'Passkey' not in br.js('return document.body.innerText'), txt)
        br.js(FAKE, token(), SUB)
        txt = br.wait("const t = document.querySelector('#osm').innerText; return /Angemeldet als/.test(t) && t", 10)
        check('nach der Rückkehr: angemeldet (OSM + WMap)', bool(txt) and 'WMap Test' in txt and br.js("return !!localStorage.getItem('wmap.token')"), txt)
        br.shot('konto-einstellungen')
        br.open('entdecken.html#andere', wait=3)
        row = br.wait("return document.querySelector('.ent-konto')?.innerText", 15)
        check('Entdecken: angemeldet', row and 'WMap Test' in row, row)
        br.open('settings.html', wait=2)
        br.js("document.querySelector('[data-act=logout]').click()")
        time.sleep(1)
        check('Abmelden: beides weg', br.js("return !JSON.parse(localStorage.getItem('wmap.token')) && !JSON.parse(localStorage.getItem('wmap.osm.token.live'))"))
        br.open('deleteKonto.html', wait=2)
        check('Löschen-Seite ohne Anmeldung: anmelden', 'Mit OpenStreetMap anmelden' in br.js("return document.querySelector('.delete-button').innerText"))
        br.js(FAKE, token(), SUB)
        st = br.wait("const t = document.querySelector('.delete-status').innerText; return /Angemeldet als/.test(t) && t", 10)
        check('Löschen-Seite nach Anmeldung', bool(st), st)
        br.js("document.querySelector('.delete-button').click()")
        time.sleep(.5)
        br.js("[...document.querySelectorAll('dialog button')].find((b) => /Endgültig/.test(b.innerText)).click()")
        st = br.wait("const t = document.querySelector('.delete-status').innerText; return /gelöscht/.test(t) && t", 10)
        check('gelöscht', bool(st), st)
        br.shot('konto-geloescht')
        errs = [e for e in br.errors if 'tile' not in e[1].lower()]
        check('keine JS-Fehler', not errs, errs)
    db.execute("DELETE FROM Statistics WHERE event IN ('konto_neu', 'konto_geloescht') AND time > datetime('now', '-5 minutes')")
    db.commit()
finally:
    if old is None:
        os.remove(CACHE)
    else:
        open(CACHE, 'w').write(old)
sys.exit(1 if fails else 0)
