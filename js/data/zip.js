/**
 * ZIP ohne Bibliothek – für die Sicherung mit Ordnerstruktur.
 *
 *   makeZip([{ path, data, date }]) → Blob    data: Text oder Uint8Array
 *   readZip(blob) → [{ path, text() }]
 *
 * Gepackt wird mit „deflate“ (CompressionStream), wo der Browser es kann –
 * GPX schrumpft dabei auf etwa ein Viertel –, sonst unkomprimiert. Lesen
 * kann beides, also auch ZIPs von anderen Programmen.
 */
const enc = new TextEncoder();

let table = null;
function crc32(bytes) {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const canDeflate = typeof CompressionStream !== 'undefined';
async function stream(bytes, how, kind) {
  const s = new Blob([bytes]).stream().pipeThrough(new (how === 'in' ? DecompressionStream : CompressionStream)(kind));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Datum im DOS-Format der ZIP-Einträge */
function dos(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (canDeflate && raw.length > 256) {
      const packed = await stream(raw, 'out', 'deflate-raw');
      if (packed.length < raw.length) { body = packed; method = 8; }
    }
    const { time, date } = dos(f.date ?? new Date());
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);            // Namen in UTF-8
    head.setUint16(8, method, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((s, x) => s + x.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

export async function readZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  // Ende des Inhaltsverzeichnisses von hinten suchen
  let e = buf.length - 22;
  while (e >= 0 && view.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error('Das ist keine ZIP-Datei');
  const count = view.getUint16(e + 10, true);
  let p = view.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (path.endsWith('/')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = buf.subarray(start, start + csize);
    out.push({
      path,
      async bytes() {
        if (method === 0) return body;
        if (method === 8) return stream(body, 'in', 'deflate-raw');
        throw new Error(`${path}: Packverfahren ${method} geht nicht`);
      },
      async text() { return dec.decode(await this.bytes()); },
    });
  }
  return out;
}
