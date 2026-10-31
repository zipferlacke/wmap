/**
 * Befehle der App-Plugins (Tauri) – in der Seite wie gewohnt über `window.__TAURI__`. Der Service Worker (Abgleich,
 * js/sw/sync.js) kommt da nicht heran: Die Leitung von Android hängt nur am Fenster der Seite. Er bittet darum eine
 * offene Seite als Boten (js/core/sw-link.js): „tauri“ { cmd, args } → { ok, data | err }. Verschwindet der Bote
 * (Seitenwechsel), wartet er kurz auf die nächste Seite und fragt dort noch einmal.
 *
 *   tauri.here      gibt es die Plugins? (Service Worker: erst nach `await tauri.ready()`)
 *   tauri.invoke(cmd, args)   wie core.invoke('plugin:folder|list', { … })
 */
const page = typeof window !== 'undefined';
const core = page ? window.__TAURI__?.core : null;
const GONE = Symbol('weg');
const WAIT_PAGE_MS = 30000;   // so lange auf eine (neue) Seite warten
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Service Worker: eine offene Seite – die sichtbare zuerst */
async function messenger() {
  const end = Date.now() + WAIT_PAGE_MS;
  for (;;) {
    const list = await self.clients.matchAll({ type: 'window' });
    const c = list.find((x) => x.visibilityState === 'visible') ?? list[0];
    if (c) return c;
    if (Date.now() > end) return null;
    await sleep(300);
  }
}

/** Service Worker: die Seite fragen; geht sie unterdessen (Seitenwechsel) → GONE */
function ask(client, msg) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const watch = setInterval(() => self.clients.get(client.id).then((c) => { if (!c) done(GONE); }), 1000);
    const done = (v) => { clearInterval(watch); ch.port1.close(); resolve(v); };
    ch.port1.onmessage = (e) => done(e.data);
    client.postMessage(msg, [ch.port2]);
  });
}

async function viaPage(msg) {
  for (;;) {
    const c = await messenger();
    if (!c) throw new Error('Keine Seite von WMap offen');
    const r = await ask(c, msg);
    if (r !== GONE) return r;
  }
}

let checked = null;

export const tauri = {
  here: !!core,
  /** Service Worker: einmal bei einer Seite nachfragen, ob es die App ist */
  ready() {
    if (page) return Promise.resolve(this.here);
    if (this.here) return Promise.resolve(true);
    checked ??= viaPage({ type: 'tauri-here' }).then((ok) => { this.here = !!ok; checked = null; return this.here; }).catch(() => { checked = null; return false; });
    return checked;
  },
  async invoke(cmd, args = {}) {
    if (page) return core.invoke(cmd, args);
    const r = await viaPage({ type: 'tauri', cmd, args });
    // Wie in der Seite: abgelehnt mit dem Text des Plugins
    if (!r?.ok) throw new Error(r?.err ?? 'Befehl ging nicht');
    return r.data;
  },
};
