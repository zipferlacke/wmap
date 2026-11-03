"""Anfrage an einen Dienst (js/services/servers.js): Wechsel beim Ausfall, einmal wiederholt, Pause, alle in Pause: der früheste, Abbrechen und 404 sind kein Ausfall."""
import json
import sys
from common import Browser

STEPS = r"""
const { API } = await import('./js/core/config.js');
const { askServer } = await import('./js/services/servers.js');
const out = {};
const real = window.fetch; const calls = []; let answer = () => new Response('{}');
window.fetch = async (u, o) => { const s = String(u); if (!s.startsWith('https://s')) return real(u, o); calls.push(s.slice(8, 10)); return answer(s, o); };
localStorage.removeItem('wmap.servers.next');
API.t1 = ['https://s1/', 'https://s2/'];
let bad = null;
answer = (s) => { bad ??= s.slice(8, 10); if (s.includes(bad)) throw new TypeError('Failed to fetch'); return new Response('{}'); };
const hits = []; for (let i = 0; i < 2; i += 1) { const r = await askServer('t1', '/x'); hits.push(r.status); }
out.fail = { bad, calls: [...calls], hits, paused: Object.keys(JSON.parse(localStorage.getItem('wmap.servers.next') ?? '{}')) };
calls.length = 0;
API.t2 = ['https://s3/', 'https://s4/'];
const n = { 'https://s3/': Date.now() + 1000, 'https://s4/': Date.now() + 500000 };
localStorage.setItem('wmap.servers.next', JSON.stringify(n));
answer = () => new Response('{}');
await askServer('t2', 'y');
out.earliest = [...calls];
calls.length = 0; localStorage.removeItem('wmap.servers.next');
API.t3 = ['https://s5/'];
answer = () => new Response('', { status: 404 });
out.notFound = { status: (await askServer('t3', 'z')).status, calls: [...calls], paused: localStorage.getItem('wmap.servers.next') };
calls.length = 0;
API.t4 = ['https://s6/'];
const c = new AbortController();
answer = () => { c.abort(); throw new DOMException('x', 'AbortError'); };
out.abort = await askServer('t4', 'z', { signal: c.signal }).then(() => 'kein Fehler', (e) => e.name);
out.abortPaused = localStorage.getItem('wmap.servers.next');
calls.length = 0;
API.t5 = ['https://s7/'];
answer = () => new Response('', { status: 503 });
out.down = { status: (await askServer('t5', 'z')).status, calls: [...calls] };
window.fetch = real;
localStorage.removeItem('wmap.servers.next');
window.__result = JSON.stringify(out);
"""

with Browser(width=420, height=900) as b:
    b.open('settings.html', wait=2)
    b.js("const s = document.createElement('script'); s.type = 'module'; s.textContent = arguments[0]; document.head.append(s);", STEPS)
    r = json.loads(b.wait('return window.__result', 30))
    print(json.dumps(r, ensure_ascii=False))
    f = r['fail']
    # Der erste gezogene fällt aus: zwei Versuche, dann der andere, danach nur noch dieser
    other = 's2' if f['bad'] == 's1' else 's1'
    ok = f['hits'] == [200, 200] and f['calls'] == [f['bad'], f['bad'], other, other] \
        and f['paused'] == [f"https://{f['bad']}/"] \
        and r['earliest'] == ['s3'] \
        and r['notFound'] == {'status': 404, 'calls': ['s5'], 'paused': None} \
        and r['abort'] == 'AbortError' and r['abortPaused'] is None \
        and r['down'] == {'status': 503, 'calls': ['s7', 's7']}
    print('stimmt:', ok)
    if not ok:
        b.errors.append(('servers', 'Ergebnis falsch'))
    sys.exit(b.report())
