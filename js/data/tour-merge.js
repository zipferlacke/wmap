/**
 * Gemeinsam planen: zwei Fassungen einer Tour zusammenführen (pages/tour.js pushCollab). Grundlage ist der letzte
 * gemeinsame Stand `base` (so stand es auf dem Server, als man zuletzt abgeglichen hat), dazu die eigene Fassung
 * `mine` und die vom Server `theirs`. Was nur eine Seite geändert hat, kommt einfach hinein; nur wo beide dieselbe
 * Stelle anders geändert haben, bleibt eine Frage.
 *
 *   Name, Beschreibung, Art     je für sich
 *   Wegpunkte                   wie diff3: Abschnitte zwischen Punkten, die beide unverändert haben
 *   feste Strecke (fixed/shape) als Ganzes
 *   Hintergrund-Wege            je Weg: dazu oder weg
 *
 * Ohne `base` (unbekannt) ist alles, was sich unterscheidet, eine Frage.
 *
 * mergeTours(base, mine, theirs) → { tour, conflicts }   conflicts: [{ key, mine, theirs, before?, after? }]
 * resolve(merged, picks) → Tour   picks[i]: 'mine' | 'theirs' je Frage
 */

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Wie im Link (Polyline, 5 Stellen): sonst wären eigene Punkte nie gleich denen vom Server
const ptKey = (p) => `${(+p[0]).toFixed(5)},${(+p[1]).toFixed(5)}`;

/** Längste gemeinsame Folge → Paare [i, j] (aufsteigend) */
function lcs(a, b) {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
  }
  return out;
}

/** Wegpunkte dreifach abgleichen → [{ ok: Punkte } | { mine, theirs }] in Reihenfolge */
export function mergePoints(base, mine, theirs) {
  const [o, a, b] = [base, mine, theirs].map((l) => l.map(ptKey));
  const ma = new Map(lcs(o, a)), mb = new Map(lcs(o, b));
  const parts = [];
  const push = (p) => { if (p.ok && parts.at(-1)?.ok) parts.at(-1).ok.push(...p.ok); else if (!p.ok || p.ok.length) parts.push(p); };
  let io = 0, ia = 0, ib = 0;
  for (;;) {
    let i = io;
    while (i < o.length && !(ma.has(i) && mb.has(i))) i++;
    const ea = i < o.length ? ma.get(i) : a.length, eb = i < o.length ? mb.get(i) : b.length;
    const O = o.slice(io, i), A = a.slice(ia, ea), B = b.slice(ib, eb);
    if (same(A, O)) push({ ok: theirs.slice(ib, eb) });
    else if (same(B, O) || same(A, B)) push({ ok: mine.slice(ia, ea) });
    else push({ mine: mine.slice(ia, ea), theirs: theirs.slice(ib, eb) });
    if (i >= o.length) break;
    push({ ok: [mine[ea]] });
    io = i + 1; ia = ea + 1; ib = eb + 1;
  }
  return parts;
}

const FIELDS = ['name', 'description', 'profile'];
const fixedOf = (t) => (t.fixed ? { fixed: true, shape: t.shape ?? null } : { fixed: false, shape: null });

export function mergeTours(base, mine, theirs) {
  const tour = {};
  const conflicts = [];
  const field = (key, get, set) => {
    const [o, a, b] = [base, mine, theirs].map((t) => (t ? get(t) : undefined));
    if (same(a, b)) return set(a);
    if (base && same(a, o)) return set(b);
    if (base && same(b, o)) return set(a);
    conflicts.push({ key, mine: a, theirs: b });
    return set(a);   // vorläufig – resolve setzt die Wahl
  };
  for (const k of FIELDS) field(k, (t) => t[k] ?? '', (v) => { tour[k] = v; });
  field('fixed', fixedOf, (v) => Object.assign(tour, v));

  // Wegpunkte
  const parts = base ? mergePoints(base.points, mine.points, theirs.points)
    : same(mine.points.map(ptKey), theirs.points.map(ptKey)) ? [{ ok: mine.points }] : [{ mine: mine.points, theirs: theirs.points }];
  tour.parts = parts.map((p, i) => {
    if (p.ok) return p;
    // Zum Zeigen auf der Karte: der Punkt davor und danach, die beide behalten haben
    conflicts.push({ key: 'points', part: i, mine: p.mine, theirs: p.theirs, before: parts[i - 1]?.ok?.at(-1) ?? null, after: parts[i + 1]?.ok?.[0] ?? null });
    return { ...p };
  });

  // Hintergrund-Wege: je Weg – wer ihn dazugetan oder weggenommen hat, gilt
  const ids = (t) => new Map((t?.backgrounds ?? []).map((w) => [`${w.type}/${w.id}`, w]));
  const [o, a, b] = [ids(base), ids(mine), ids(theirs)];
  tour.backgrounds = [...new Map([...a, ...b])].filter(([k]) => (a.has(k) && b.has(k)) || !o.has(k)).map(([, w]) => w);
  return { tour, conflicts };
}

/** Fragen beantwortet → fertige Tour (ohne `parts`) */
export function resolve({ tour, conflicts }, picks) {
  const out = { ...tour };
  const parts = tour.parts.map((p) => ({ ...p }));
  conflicts.forEach((c, i) => {
    const v = c[picks[i] === 'theirs' ? 'theirs' : 'mine'];
    if (c.key === 'points') parts[c.part] = { ok: v };
    else if (c.key === 'fixed') Object.assign(out, v);
    else out[c.key] = v;
  });
  out.points = parts.flatMap((p) => p.ok);
  delete out.parts;
  return out;
}
