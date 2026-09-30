/**
 * Der eigene Standort auf der Karte (MapLibres GeolocateControl), wie man
 * ihn von Google Maps kennt:
 *
 *   Punkt und Kreis   gleiten zwischen zwei Meldungen, statt zu springen
 *   Kreis             blau durchsichtig, so groß wie die Ungenauigkeit – ruhig,
 *                     ohne Pulsieren; ist der Standort genau (≤ 12 m), ganz weg
 *   Blickrichtung     Kegel am Punkt: in Fahrt die Richtung des GPS, sonst der
 *                     Kompass (deviceorientationabsolute) – MapLibre selbst
 *                     kennt keine Richtung
 *
 * Greift auf Interna von MapLibre 5.x zu (_userLocationDotMarker,
 * _accuracyCircleMarker, _dotElement, _circleElement, _watchState).
 */
import { glideMarker } from '../core/smooth.js';

const PRECISE_M = 12;
const GPS_HEADING_SPEED = 1.5;     // m/s – darüber zählt die Richtung des GPS
const GPS_HEADING_MS = 5000;       // so lange nach der letzten Fahrt noch GPS statt Kompass

export function enhanceDot(map, geolocate) {
  let ready = false;
  let heading = null;              // gezeigt (Grad, 0 = Norden)
  let gpsAt = 0;                   // letzte Meldung mit Fahrt
  let compassOn = false;
  let cone = null;

  const paint = () => {
    if (!cone) return;
    cone.hidden = heading === null;
    if (heading !== null) cone.style.transform = `rotate(${heading - map.getBearing()}deg)`;
  };

  const turnTo = (deg) => {
    if (heading !== null && Math.abs(((deg - heading + 540) % 360) - 180) < 1) return;
    heading = deg;
    paint();
  };

  // Kompass: nur, solange der Punkt da ist und die Seite zu sehen
  let lastCompass = 0;
  const onCompass = (e) => {
    if (geolocate._watchState === 'OFF' || document.hidden) { compass(false); return; }
    if (Date.now() - gpsAt < GPS_HEADING_MS) return;
    const now = performance.now();
    if (now - lastCompass < 80) return;              // ~12 Mal je Sekunde reicht
    lastCompass = now;
    let deg = null;
    if (Number.isFinite(e.webkitCompassHeading)) deg = e.webkitCompassHeading;          // iOS
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && Number.isFinite(e.alpha)) deg = 360 - e.alpha;
    if (deg === null) return;
    // Querformat: das Gerät zeigt um den Winkel des Bildschirms gedreht
    deg = (deg + (screen.orientation?.angle ?? 0) + 360) % 360;
    turnTo(deg);
  };
  const EVENT = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  const compass = (on) => {
    if (on === compassOn) return;
    compassOn = on;
    if (on) addEventListener(EVENT, onCompass);
    else removeEventListener(EVENT, onCompass);
  };

  geolocate.on('geolocate', (pos) => {
    if (!ready && geolocate._userLocationDotMarker) {
      ready = true;
      glideMarker(geolocate._userLocationDotMarker);
      if (geolocate._accuracyCircleMarker) glideMarker(geolocate._accuracyCircleMarker);
      cone = document.createElement('div');
      cone.className = 'wmap-heading';
      cone.hidden = true;
      geolocate._dotElement.prepend(cone);
      map.on('rotate', paint);
    }
    const c = pos.coords;
    geolocate._circleElement?.classList.toggle('precise', (c.accuracy ?? 99) <= PRECISE_M);
    if ((c.speed ?? 0) >= GPS_HEADING_SPEED && Number.isFinite(c.heading)) {
      gpsAt = Date.now();
      turnTo(c.heading);
    }
    compass(true);
  });
}
