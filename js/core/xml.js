/**
 * XML lesen – in der Seite mit dem DOMParser des Browsers, im Service Worker (Abgleich, js/sw/sync.js) gibt es den
 * nicht: dort ein kleiner eigener Leser mit genau dem, was GPX-Dateien brauchen (data/tracks.js parseGpx,
 * data/folder.js tourFromGpx):
 *
 *   querySelector / querySelectorAll   Namen (ohne Präfix, wie CSS in XML), Listen mit „,“, Nachfahre „ “,
 *                                      Kind „>“, „:scope“ am Anfang
 *   getElementsByTagName('*'), children, localName, textContent, getAttribute, hasAttribute
 * Kaputtes XML: ein Element „parsererror“ – wie beim DOMParser.
 */
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => (s.includes('&') ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? m;
}) : s);

class Node {
  constructor(name, parent) {
    this.nodeName = name;
    this.localName = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    this.parentNode = parent;
    this.attrs = null;
    this.children = [];      // nur Elemente
    this.nodes = [];         // Elemente und Text der Reihe nach
  }

  get textContent() {
    let out = '';
    for (const n of this.nodes) out += typeof n === 'string' ? n : n.textContent;
    return out;
  }

  getAttribute(k) { return this.attrs?.get(k) ?? null; }
  hasAttribute(k) { return !!this.attrs?.has(k); }

  getElementsByTagName(name) {
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (name === '*' || c.localName === name || c.nodeName === name) out.push(c); walk(c); } };
    walk(this);
    return out;
  }

  querySelectorAll(sel) {
    const chains = sel.split(',').map(parseChain);
    return this.getElementsByTagName('*').filter((el) => chains.some((c) => matches(el, c, c.length - 1, this)));
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

/** „metadata > name“ → [{ name: 'metadata' }, { comb: '>', name: 'name' }] */
function parseChain(sel) {
  const parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const out = [];
  let comb = ' ';
  for (const p of parts) {
    if (p === '>') { comb = '>'; continue; }
    out.push({ comb, name: p });
    comb = ' ';
  }
  return out;
}

const same = (el, name, scope) => (name === ':scope' ? el === scope : name === '*' || el.localName === name);

/** Passt das Element zum Teil i der Kette (von hinten nach vorn geprüft)? */
function matches(el, chain, i, scope) {
  if (!el || !(el instanceof Node) || !same(el, chain[i].name, scope)) return false;
  if (i === 0) return true;
  if (chain[i].comb === '>') return matches(el.parentNode, chain, i - 1, scope);
  for (let p = el.parentNode; p; p = p.parentNode) if (matches(p, chain, i - 1, scope)) return true;
  return false;
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parse(text) {
  const doc = new Node('#document', null);
  let cur = doc, last = 0, m;
  TOKEN.lastIndex = 0;
  const textUntil = (end) => { if (end > last) { const t = text.slice(last, end); if (cur !== doc) cur.nodes.push(decode(t)); else if (t.trim()) throw new Error('Text außerhalb'); } };
  while ((m = TOKEN.exec(text))) {
    textUntil(m.index);
    last = TOKEN.lastIndex;
    if (m[1] !== undefined) { if (cur !== doc) cur.nodes.push(m[1]); continue; }
    if (!m[3]) continue;   // Kommentar, <?xml …?>, <!DOCTYPE …>
    if (m[2] === '/') {
      if (cur === doc || cur.nodeName !== m[3]) throw new Error(`</${m[3]}> passt nicht`);
      cur = cur.parentNode;
      continue;
    }
    const el = new Node(m[3], cur);
    if (m[4]) {
      el.attrs = new Map();
      ATTR.lastIndex = 0;
      let a;
      while ((a = ATTR.exec(m[4]))) el.attrs.set(a[1], decode(a[2] ?? a[3] ?? ''));
    }
    cur.children.push(el);
    cur.nodes.push(el);
    if (!m[5]) cur = el;
  }
  textUntil(text.length);
  if (cur !== doc || !doc.children.length) throw new Error('unvollständig');
  return doc;
}

/** Text → Dokument mit querySelector & Co. */
export function parseXml(text) {
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(text, 'application/xml');
  try { return parse(String(text)); } catch {
    const doc = new Node('#document', null);
    const err = new Node('parsererror', doc);
    doc.children.push(err);
    doc.nodes.push(err);
    return doc;
  }
}
