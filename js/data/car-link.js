/**
 * Ans Auto senden – nur die Android-App (ab 2.2.0), wenn das Handy gerade mit Android Auto verbunden ist: ein
 * Ort, die geplante Route (mit der gewählten Alternative) oder eine geplante Tour geht an WMap im Auto; dort
 * öffnet sich die Routenübersicht mit „Los“. Die App am Handy und WMap im Auto sind dieselbe App
 * (tools/android/MainActivity.kt → car/CarLink.kt → `shared` in js/car/car.js).
 *
 *   carLink.connected          Auto verbunden?
 *   carLink.onChange(fn)       verbunden bzw. getrennt
 *   sendToCar(payload, toast)  { type: 'place', point, label, poi } | { type: 'route', profile, waypoints, length, time }
 *                              | { type: 'tour', id }
 */
const android = () => window.WMapAndroid;

export const carLink = {
  get connected() { try { return !!android()?.carConnected?.(); } catch { return false; } },
  onChange(fn) { addEventListener('wmap:car', fn); },
};

export function sendToCar(payload, toast) {
  let r = '';
  try { r = android()?.carSend?.(JSON.stringify(payload)) ?? ''; } catch { /* alte App */ }
  toast?.(r === 'sent' ? 'Ans Auto gesendet' : r === 'waiting' ? 'Gesendet – im Auto WMap öffnen' : 'Kein Auto verbunden');
  return !!r;
}
