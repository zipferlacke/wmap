/**
 * Bedienung der geneigten Karte (3D), zusätzlich zu MapLibre (ab 6.15 hält MapLibre den angefassten Punkt im
 * Gelände selbst unter dem Finger, die Kamera über dem Gelände und springt nach Gesten nicht mehr):
 *
 *   Neigen     zoomt mit – je steiler, desto näher (bis 1,6 Stufen bei 85°), zurückkippen zoomt wieder heraus.
 *              So bleibt der Ausschnitt vorn ungefähr gleich groß
 *   Schieben   mit einem Finger im Maßstab des Vordergrunds (unteres Viertel des Bilds), mal 0,5 + 0,5 · cos(Neigung)
 *              – zwischen 1 (flach) und 0,5 gleitend, nicht hart gekappt. MapLibre schiebt so, dass der Punkt unter dem Finger mitgeht – liegt der geneigt
 *              nahe am Horizont, sind das Kilometer je Wisch. Das Nachrollen nimmt denselben Weg
 *
 * Beides greift in die Geste selbst ein (die Änderung, die MapLibres Bedienung je Bild anwendet), nicht danach mit
 * setZoom/setCenter: Das meldete jedes Mal „Bewegung zu Ende“ – Häuser, Haltestellen und Namen wurden mitten in der
 * Geste neu gebaut. Greift auf MapLibres Interna zu (_handlers._updateMapTransform, 6.x).
 */
const FROM = 40;                 // ab dieser Neigung zoomt es mit und schiebt im Maßstab vorn
const MAX = 85;                  // größte Neigung (map.js)
const ZOOM_AT_MAX = 1.6;         // so viel näher bei 85°
const PAN_MIN = 0.5;             // Schieben höchstens so viel langsamer (senkrecht – erreicht wird es nie)
const FRONT = 0.78;              // Höhe im Bild, deren Maßstab beim Schieben gilt

/** Zusätzlicher Zoom für eine Neigung (weich, 0 bis 40°) */
const tiltZoom = (p) => {
  const t = Math.max(0, Math.min(1, (p - FROM) / (MAX - FROM)));
  return ZOOM_AT_MAX * t * t * (3 - 2 * t);
};
/** Faktor fürs Schieben: cos(Neigung) von 0 … 1 auf 0,5 … 1 – 1 flach, 0,75 bei 60°, 0,63 bei 75°, 0,54 bei 85° */
const panFactor = (p) => PAN_MIN + (1 - PAN_MIN) * Math.cos((p * Math.PI) / 180);

export function tiltGestures(map) {
  const handlers = map._handlers ?? map.handlers;
  const camera = () => map._camera?.transform ?? map.transform;
  const update = handlers?._updateMapTransform?.bind(handlers);
  if (!update) return;

  // Weg in Metern, um den die Karte wandert, wenn bei (x, y) um d Bildpunkte geschoben wird – gerechnet auf der
  // Ebene der Bildmitte, nicht im Gelände nachgeschaut
  const shift = (x, y, d) => {
    const tr = camera();
    const a = tr.screenPointToLocation(new maplibregl.Point(x, y));
    const b = tr.screenPointToLocation(new maplibregl.Point(x - d.x, y - d.y));
    if (!a || !b || !Number.isFinite(a.lng + b.lng + a.lat + b.lat)) return null;
    return Math.hypot((b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 111320);
  };

  handlers._updateMapTransform = (change, active, events) => {
    const p = map.getPitch();
    // Neigen zoomt mit
    if (change.pitchDelta) {
      const to = Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), p + change.pitchDelta));
      const dz = tiltZoom(to) - tiltZoom(p);
      if (Math.abs(dz) > 1e-4) change.zoomDelta = (change.zoomDelta ?? 0) + dz;
    }
    // Schieben: so weit wie der Fingerweg vorn, mal Faktor – MapLibre verschiebt um den Punkt unter dem Finger
    const d = change.panDelta;
    if (d?.mag() && active?.drag) {
      let k = panFactor(p);
      if (p >= FROM) {
        const tr = camera(), at = change.pinchAround ?? change.around ?? tr.centerPoint;
        const want = shift(tr.centerPoint.x, map.getCanvas().clientHeight * FRONT, d);
        const there = shift(at.x, at.y, d);
        if (want && there) k = Math.min(1, (want * k) / there);
      }
      change.panDelta = d.mult(k);
    }
    return update(change, active, events);
  };
}
