/**
 * Bild in Bild: die Navigation in einem kleinen Fenster, das über anderen
 * Apps und Tabs liegen bleibt – wie bei Google Maps.
 *
 * Zu sehen ist nur die Karte mit dem Standort (weit unten) und oben der Pfeil
 * der nächsten Anweisung mit der Entfernung – kein Text, keine Knöpfe, Leisten
 * oder Zeiten; im Mini-Fenster ist kaum Platz.
 *
 *   Android-App    die ganze App, im Mini-Fenster auf Karte und Anweisung
 *                  reduziert (html.pip-mode, css/app/dialogs.css) – beim
 *                  Rauswischen während der Navigation von selbst, sonst per
 *                  Knopf (MainActivity.kt, Schnittstelle window.WMapAndroid)
 *   Chrome, Edge,  Document Picture-in-Picture: die Karte selbst wandert ins
 *   neue Firefox   Mini-Fenster, darüber die Anweisung (gleiches HTML und CSS)
 *   Chrome Android Video-Bild-in-Bild: Karte (nach jedem Kartenbild kopiert,
 *   Safari         dazu der Standortpfeil) und die Anweisung auf ein Canvas
 *                  gemalt, das als Video ins Mini-Fenster geht
 *   sonst          keine Schnittstelle – der Knopf bleibt weg
 *
 * Gespiegelt wird die Anweisung (#nav .nav-banner); ein MutationObserver hält
 * das Fenster aktuell, die Navigation selbst weiß davon nichts.
 */
const ANDROID = () => typeof window.WMapAndroid?.enterPip === 'function';
const DOC_PIP = 'documentPictureInPicture' in window;
const VIDEO_PIP = !DOC_PIP && document.pictureInPictureEnabled && 'captureStream' in HTMLCanvasElement.prototype;

export const pipSupported = () => ANDROID() || DOC_PIP || VIDEO_PIP;

/**
 * Android-App: während der Navigation beim Verlassen von selbst ins Bild in
 * Bild. Folgt der Klasse „navigating“ am body (setzt die Navigation).
 */
export function autoPip() {
  if (!ANDROID()) return;
  let on = null;
  const sync = () => {
    const now = document.body.classList.contains('navigating');
    if (now === on) return;
    on = now;
    try { window.WMapAndroid.setPip(now); } catch { /* ältere App */ }
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
}

export class NavPip {
  #nav; #map; #win = null; #box = null; #home = null; #video = null; #canvas = null; #observer = null; #frame = 0; #drawn = 0;

  /**
   * @param nav  die Navigationsansicht (#nav)
   * @param map  die Karte – wandert im Mini-Fenster mit
   */
  constructor(nav, { map = null } = {}) { this.#nav = nav; this.#map = map; }

  get open() { return !!this.#win || !!document.pictureInPictureElement; }

  async toggle() {
    if (ANDROID()) { window.WMapAndroid.enterPip(); return; }
    if (this.open) { this.close(); return; }
    if (DOC_PIP) await this.#openDocument();
    else if (VIDEO_PIP) await this.#openVideo();
    this.#observer = new MutationObserver(() => this.#schedule());
    this.#observer.observe(this.#nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    this.#render();
  }

  close() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#win?.close();
    this.#win = null;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }

  #schedule() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; this.#render(); });
  }

  /* ── Chrome/Edge: echtes Mini-Fenster ──────────────────────────────────── */

  async #openDocument() {
    const mapEl = this.#map?.getContainer();
    const win = await window.documentPictureInPicture.requestWindow(mapEl ? { width: 360, height: 520 } : { width: 340, height: 190 });
    // Stile der App mitnehmen – so sieht das Banner genauso aus
    for (const el of document.querySelectorAll('link[rel="stylesheet"], style')) win.document.head.append(el.cloneNode(true));
    win.document.documentElement.lang = 'de';
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = mapEl ? 'pip-body pip-map' : 'pip-body';
    this.#box = win.document.createElement('div');
    this.#box.className = 'nav pip-nav';
    // Die Karte selbst ins Fenster – beim Schließen zurück an ihren Platz
    if (mapEl) {
      this.#home = { parent: mapEl.parentNode, next: mapEl.nextSibling };
      win.document.body.append(mapEl);
      win.addEventListener('resize', () => this.#map.resize());
      requestAnimationFrame(() => this.#map.resize());
    }
    win.document.body.append(this.#box);
    win.addEventListener('pagehide', () => {
      if (this.#home) {
        this.#home.parent.insertBefore(mapEl, this.#home.next);
        this.#home = null;
        this.#map.resize();
      }
      this.#win = null;
      this.#box = null;
      this.#observer?.disconnect();
      this.#observer = null;
    });
    this.#win = win;
  }

  /* ── Safari: Canvas als Video ──────────────────────────────────────────── */

  async #openVideo() {
    this.#canvas = Object.assign(document.createElement('canvas'), this.#map ? { width: 540, height: 720 } : { width: 540, height: 130 });
    this.#video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    this.#video.srcObject = this.#canvas.captureStream(5);
    this.#drawCanvas();
    // Die Karte nur direkt nach dem Zeichnen kopieren – danach ist ihr Bild leer
    this.#map?.on('render', this.#onRender);
    await this.#video.play();
    await this.#video.requestPictureInPicture();
    this.#video.addEventListener('leavepictureinpicture', () => {
      this.#map?.off('render', this.#onRender);
      this.#observer?.disconnect();
      this.#observer = null;
    }, { once: true });
  }

  #onRender = () => {
    const now = performance.now();
    if (now - this.#drawn < 200) return;
    this.#drawn = now;
    this.#drawCanvas();
  };

  #render() {
    if (this.#win) {
      const top = document.createElement('div');
      top.className = 'nav-top';
      top.append(this.#nav.querySelector('.nav-banner').cloneNode(true));
      this.#box.replaceChildren(top);
    } else if (this.#canvas) {
      if (this.#map) this.#map.triggerRepaint();   // zeichnet in #onRender
      else this.#drawCanvas();
    }
  }

  #drawCanvas() {
    const c = this.#canvas, ctx = c.getContext('2d');
    const $ = (s) => this.#nav.querySelector(s);
    const text = (s) => ($(s) && !$(s).hidden ? $(s).textContent.trim() : '');
    // Oben nur der Pfeil und daneben, wie weit noch – im Mini-Fenster ist kaum Platz
    const BANNER = 130;
    if (this.#map) this.#drawMap(ctx, BANNER);
    ctx.fillStyle = '#1a73e8';
    ctx.fillRect(0, 0, c.width, BANNER);
    ctx.fillStyle = '#fff';
    ctx.font = '100px "Material Symbols Rounded"';
    ctx.textBaseline = 'middle';
    ctx.fillText(text('.nav-icon') || 'navigation', 22, BANNER / 2);
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.fillText(text('.nav-dist'), 150, BANNER / 2 + 4, c.width - 168);
  }

  /** Karte unter dem Banner: ausgeschnitten um den eigenen Standort, dazu der Pfeil */
  #drawMap(ctx, top) {
    const c = this.#canvas;
    const src = this.#map.getCanvas();
    if (!src.width) return;
    const box = src.getBoundingClientRect();
    const k = src.width / box.width;                  // CSS-Pixel → Pixel der Karte
    const me = document.querySelector('.nav-me')?.getBoundingClientRect();
    const mx = me ? (me.left + me.width / 2 - box.left) * k : src.width / 2;
    const my = me ? (me.top + me.height / 2 - box.top) * k : src.height * 0.7;
    const h = c.height - top;
    const scale = Math.max(c.width / src.width, h / src.height);
    const sw = c.width / scale, sh = h / scale;
    // Der Standort weit unten (~80 %) – man sieht mehr vom Weg voraus
    const sx = Math.min(Math.max(mx - sw / 2, 0), src.width - sw);
    const sy = Math.min(Math.max(my - sh * 0.8, 0), src.height - sh);
    ctx.drawImage(src, sx, sy, sw, sh, 0, top, c.width, h);
    if (!me) return;
    // Pfeil: Drehung aus dem transform des Markers (rotateZ bzw. rotate)
    const deg = Number(document.querySelector('.nav-me').style.transform.match(/rotate(?:Z)?\((-?[\d.]+)deg\)/)?.[1] ?? 0);
    const x = (mx - sx) * scale, y = top + (my - sy) * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgb(0 0 0 / .35)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.rotate((deg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 6); ctx.lineTo(-12, 13); ctx.closePath();
    ctx.fillStyle = '#1a73e8';
    ctx.fill();
    ctx.restore();
  }

}
