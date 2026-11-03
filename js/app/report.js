/**
 * Unterwegs kurz fragen und melden – Baustellen, Parkplätze am Ziel.
 */
import { osmRef } from '../map/map.js';
import * as osm from '../osm/objects.js';
import { toast } from '../ui/dialogs.js';
import { quickAsk } from '../osm/quick-ask.js';
import { report, answered, reportsShared, REPORT_KINDS } from '../nav/reports.js';
import { answerParking, anonNotes, alongSetting } from '../osm/survey.js';
import { account } from '../osm/api.js';
import { contribute } from '../data/trace.js';
import { distance } from '../core/geo.js';
import { $, map } from './core.js';
import { survey } from './mitmachen.js';
import { nav } from './nav.js';
import { TRAFFIC_ICON, trafficItems } from './traffic-along.js';
import { t, locale } from '../core/i18n.js';

/* ══════════════════════════════════════════════════════════════════════════
   Unterwegs kurz fragen und melden – wie bei Google
   ══════════════════════════════════════════════════════════════════════════ */

/** Was mit einer Antwort passiert – steht klein unter der Frage. */
function whereItGoes() {
  if (account.loggedIn()) return t('report.goes.account');
  return anonNotes.get() ? t('report.goes.anonymous') : t('report.goes.later');
}

/*
 * An einer gemeldeten Baustelle, Sperrung oder einem Stau auf der Route
 * vorbei: danach einmal fragen, ob sie noch da ist – als Pille, die immer
 * gleich kommt (auch kurz nach einer anderen Frage, die sie wegschiebt).
 * Erst nah dran (150 m), dann weiter weg (250 m) – so fragt es erst, wenn man
 * es gesehen hat. ✕ heißt „nicht mehr da“, abgelaufen heißt keine Antwort.
 * Aus, wenn die kurzen Fragen für diese Fortbewegung aus sind (Einstellungen).
 */
const passing = new Map();
export function checkTrafficPassed(point) {
  if (!nav.active || !contribute.get() || !alongSetting.get(nav.profile)) return;
  for (const item of trafficItems) {
    const ref = `t:${item.road}|${item.title}|${item.point.map((v) => v.toFixed(4)).join(',')}`;
    const d = distance(point, item.point);
    if (d < 150) passing.set(ref, true);
    else if (d > 250 && passing.get(ref) && !answered(ref)) {
      passing.set(ref, false);
      askStillThere(item, ref);
    }
  }
}

async function askStillThere(item, ref) {
  const kind = item.kind === 'warning' ? 'hazard' : item.kind;
  const title = { roadworks: t('report.still.roadworks'), closure: t('report.still.closure'), jam: t('report.still.jam'),
    accident: t('report.still.accident') }[item.kind] ?? t('report.still.other');
  const v = await quickAsk({ pill: true, urgent: true, icon: TRAFFIC_ICON[item.kind]?.[0] ?? 'warning', title, timeout: 15000, no: t('report.still.gone') });
  if (!v) return;
  await report({ kind, point: item.point, answer: v, ref });
  toast(t('report.thanks'));
}

/** „Melden“ in der Navigation: was ist hier los? */
export async function reportHere(point) {
  if (!point) return;
  const v = await quickAsk({
    icon: 'add_alert', title: t('report.here.title'), timeout: 20000,
    options: Object.entries(REPORT_KINDS).map(([value, k]) => ({ value, label: k.label, icon: k.icon })),
    note: reportsShared() ? t('report.here.shared')
      : t('report.here.local'),
  });
  if (!v) return;
  const res = await report({ kind: v, point });
  toast(res.shared ? t('report.here.toast_shared', { kind: REPORT_KINDS[v].label }) : t('report.here.toast_local', { kind: REPORT_KINDS[v].label }));
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
  const p = { osm: { type: osmType, id: Number(ref.id) }, name: tags.name ?? t('report.parking.name'), point: best.f.geometry.coordinates, tags };
  const what = tags.name ? t('report.parking.named', { name: tags.name }) : t('report.parking.this_one');
  const note = whereItGoes();
  const out = {};

  if (!tags.fee) {
    const fee = await quickAsk({
      icon: 'local_parking', title: t('report.parking.fee.title', { what }), sub: t('report.parking.fee.sub'), note,
      options: [{ value: 'no', label: t('report.parking.fee.free'), icon: 'money_off', primary: true }, { value: 'yes', label: t('report.parking.fee.paid'), icon: 'payments' }, { value: '?', label: t('report.parking.fee.unknown') }],
    });
    if (!fee) return;
    if (fee !== '?') out.fee = fee;
    if (fee === 'yes') {
      const price = await quickAsk({
        icon: 'payments', title: t('report.parking.price.title'), note,
        options: [...['1', '1.5', '2', '3'].map((v) => ({ value: v, label: t('report.parking.price.per_hour', { price: Number(v).toLocaleString(locale) }) })), { value: 'other', label: t('report.parking.price.other') }],
      });
      if (price === 'other') {
        const text = await quickAsk({ icon: 'payments', title: t('report.parking.price.ask'), input: true, placeholder: t('report.parking.price.placeholder'), timeout: 60000 });
        const m = text?.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\s*(?:pro|je|\/)?\s*(stunde|std|h|tag|d)?/i);
        if (m) out.charge = `${Number(m[1].replace(',', '.')).toFixed(2)} EUR/${/^(tag|d)$/i.test(m[2] ?? '') ? 'day' : 'hour'}`;
        else if (text) out.remark = `Preis: ${text}`;
      } else if (price) out.charge = `${Number(price).toFixed(2)} EUR/hour`;
    }
  }
  if (!tags.access) {
    const access = await quickAsk({
      icon: 'lock_open', title: t('report.parking.access.title'), note,
      options: [{ value: 'yes', label: t('report.parking.access.all'), primary: true }, { value: 'customers', label: t('report.parking.access.customers') }, { value: 'private', label: t('report.parking.access.private') }],
    });
    if (access) out.access = access;
  }
  if (Object.keys(out).length) {
    const remark = await quickAsk({
      icon: 'edit_note', title: t('report.parking.remark.title'), sub: t('report.parking.remark.sub'), input: true,
      placeholder: t('report.parking.remark.placeholder'), options: [{ value: '', label: t('report.parking.remark.no') }], timeout: 20000,
    });
    if (remark) out.remark = [out.remark, remark].filter(Boolean).join(' · ');
    answerParking(p, out);
    survey.sync();
    toast(t('report.parking.thanks'));
  }
}
