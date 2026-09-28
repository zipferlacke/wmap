/**
 * Unterwegs kurz fragen und melden – Baustellen, Parkplätze am Ziel.
 */
import { osmRef } from '../map.js';
import * as osm from '../osm.js';
import { toast } from '../ui.js';
import { quickAsk } from '../quick-ask.js';
import { report, answered, reportsShared, REPORT_KINDS } from '../reports.js';
import { answerParking, anonNotes } from '../survey.js';
import { account } from '../osm-api.js';
import { contribute } from '../trace.js';
import { distance } from '../geo.js';
import { $, map } from './core.js';
import { survey } from './mitmachen.js';
import { nav } from './nav.js';
import { TRAFFIC_ICON, trafficItems } from './traffic-along.js';

/* ══════════════════════════════════════════════════════════════════════════
   Unterwegs kurz fragen und melden – wie bei Google
   ══════════════════════════════════════════════════════════════════════════ */

/** Was mit einer Antwort passiert – steht klein unter der Frage. */
function whereItGoes() {
  if (account.loggedIn()) return 'Geht mit deinem OSM-Konto direkt in die Karte.';
  return anonNotes.get() ? 'Geht ohne Konto als Hinweis an OpenStreetMap.' : 'Wird gespeichert, bis du dich bei OSM anmeldest.';
}

/*
 * An einer gemeldeten Baustelle, Sperrung oder einem Stau vorbei: danach
 * einmal fragen, ob sie noch da ist. Erst nah dran (150 m), dann weiter weg
 * (250 m) – so fragt es erst, wenn man es gesehen hat.
 */
const passing = new Map();
export function checkTrafficPassed(point) {
  if (!nav.active || !contribute.get()) return;
  for (const t of trafficItems) {
    const ref = `t:${t.road}|${t.title}|${t.point.map((v) => v.toFixed(4)).join(',')}`;
    const d = distance(point, t.point);
    if (d < 150) passing.set(ref, true);
    else if (d > 250 && passing.get(ref) && !answered(ref)) {
      passing.set(ref, false);
      askStillThere(t, ref);
    }
  }
}

async function askStillThere(t, ref) {
  const kind = t.kind === 'warning' ? 'hazard' : t.kind;
  const title = { roadworks: 'Ist die Baustelle noch da?', closure: 'Ist hier noch gesperrt?', jam: 'Ist hier noch Stau?',
    accident: 'Ist der Unfall noch da?' }[t.kind] ?? 'Gibt es hier noch eine Behinderung?';
  const v = await quickAsk({
    icon: TRAFFIC_ICON[t.kind]?.[0] ?? 'warning', title, sub: [t.road, t.title].filter(Boolean).join(' '),
    options: [{ value: 'yes', label: 'Ja', icon: 'check' }, { value: 'no', label: 'Nein', icon: 'close' }],
    note: reportsShared() ? 'Hilft allen, die hier später fahren.' : '',
  });
  if (!v) return;
  await report({ kind, point: t.point, answer: v, ref });
  toast('Danke!');
}

/** „Melden“ in der Navigation: was ist hier los? */
export async function reportHere(point) {
  if (!point) return;
  const v = await quickAsk({
    icon: 'add_alert', title: 'Was möchtest du melden?', timeout: 20000,
    options: Object.entries(REPORT_KINDS).map(([value, k]) => ({ value, label: k.label, icon: k.icon })),
    note: reportsShared() ? 'Andere sehen deine Meldung für ein paar Stunden.'
      : 'Noch ohne Meldeserver – die Meldung bleibt vorerst auf diesem Gerät.',
  });
  if (!v) return;
  const res = await report({ kind: v, point });
  toast(res.shared ? `${REPORT_KINDS[v].label} gemeldet – danke!` : `${REPORT_KINDS[v].label} vermerkt`);
}

/*
 * Am Ziel mit dem Auto: Parkplatz in der Nähe? Dann kurz nachfragen, was in
 * OSM noch fehlt – kostenlos? wie teuer? für alle? – und optional ein
 * Vermerk für andere.
 */
export async function askParking(dest) {
  if (!contribute.get() || !navigator.onLine) return;
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi', filter: ['==', ['get', 'class'], 'parking'] });
  let best = null;
  for (const f of feats) {
    const d = distance(dest, f.geometry.coordinates);
    if (d < 200 && (!best || d < best.d)) best = { f, d };
  }
  const ref = best && osmRef(best.f);
  if (!ref) return;
  let tags;
  try { tags = await osm.tags(ref.type, ref.id); } catch { return; }
  if (tags.amenity !== 'parking' || (tags.fee && tags.access)) return;
  const osmType = { N: 'node', W: 'way', R: 'relation' }[ref.type] ?? ref.type;
  const p = { osm: { type: osmType, id: Number(ref.id) }, name: tags.name ?? 'Parkplatz', point: best.f.geometry.coordinates, tags };
  const what = tags.name ? `„${tags.name}“` : 'der Parkplatz hier';
  const note = whereItGoes();
  const out = {};

  if (!tags.fee) {
    const fee = await quickAsk({
      icon: 'local_parking', title: `Ist ${what} kostenlos?`, sub: 'Du bist gerade angekommen', note,
      options: [{ value: 'no', label: 'Kostenlos', icon: 'money_off', primary: true }, { value: 'yes', label: 'Kostet etwas', icon: 'payments' }, { value: '?', label: 'Weiß nicht' }],
    });
    if (!fee) return;
    if (fee !== '?') out.fee = fee;
    if (fee === 'yes') {
      const price = await quickAsk({
        icon: 'payments', title: 'Wie viel ungefähr?', note,
        options: [...['1', '1.5', '2', '3'].map((v) => ({ value: v, label: `${v.replace('.', ',')} €/Std.` })), { value: 'other', label: 'Anders …' }],
      });
      if (price === 'other') {
        const text = await quickAsk({ icon: 'payments', title: 'Was kostet es?', input: true, placeholder: 'z. B. 1,50 € pro Stunde oder 6 € am Tag', timeout: 60000 });
        const m = text?.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\s*(?:pro|je|\/)?\s*(stunde|std|h|tag|d)?/i);
        if (m) out.charge = `${Number(m[1].replace(',', '.')).toFixed(2)} EUR/${/^(tag|d)$/i.test(m[2] ?? '') ? 'day' : 'hour'}`;
        else if (text) out.remark = `Preis: ${text}`;
      } else if (price) out.charge = `${Number(price).toFixed(2)} EUR/hour`;
    }
  }
  if (!tags.access) {
    const access = await quickAsk({
      icon: 'lock_open', title: 'Kann dort jeder parken?', note,
      options: [{ value: 'yes', label: 'Ja, alle', primary: true }, { value: 'customers', label: 'Nur Kunden' }, { value: 'private', label: 'Privat' }],
    });
    if (access) out.access = access;
  }
  if (Object.keys(out).length) {
    const remark = await quickAsk({
      icon: 'edit_note', title: 'Noch etwas für andere?', sub: 'z. B. Schranke, Höhenbegrenzung, nur bis 20 Uhr', input: true,
      placeholder: 'Vermerk (freiwillig)', options: [{ value: '', label: 'Nein, danke' }], timeout: 20000,
    });
    if (remark) out.remark = [out.remark, remark].filter(Boolean).join(' · ');
    answerParking(p, out);
    survey.sync();
    toast('Danke! Das hilft allen, die hier parken wollen.');
  }
}
