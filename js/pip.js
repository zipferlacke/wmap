/**
 * Bild in Bild: die nächste Anweisung in einem kleinen Fenster, das über
 * anderen Apps und Tabs liegen bleibt – wie bei Google Maps.
 *
 *   Chrome, Edge,  Document Picture-in-Picture: ein echtes Mini-Fenster mit
 *   neue Firefox   dem Banner (gleiches HTML und CSS wie in der App)
 *   Safari         das Banner auf ein Canvas gemalt und als Video ins
 *                  Bild-in-Bild geschickt
 *   sonst          keine Schnittstelle – der Knopf bleibt weg
 *
 * Gespiegelt wird der Kopf der Navigation (#nav .nav-top) samt Ankunftszeit;
 * ein MutationObserver hält das Fenster aktuell, die Navigation selbst weiß
 * davon nichts.
 */
const DOC_PIP = 'documentPictureInPicture' in window;
const VIDEO_PIP = !DOC_PIP && document.pictureInPictureEnabled && 'captureStream' in HTMLCanvasElement.prototype;

export const pipSupported = () => DOC_PIP || VIDEO_PIP;

export class NavPip {
  #nav; #win = null; #video = null; #canvas = null; #observer = null; #frame = 0;

  /** @param nav  die Navigationsansicht (#nav) */
  constructor(nav) { this.#nav = nav; }

  get open() { return !!this.#win || !!document.pictureInPictureElement; }

  async toggle() {
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
    const win = await window.documentPictureInPicture.requestWindow({ width: 340, height: 190 });
    // Stile der App mitnehmen – so sieht das Banner genauso aus
    for (const el of document.querySelectorAll('link[rel="stylesheet"], style')) win.document.head.append(el.cloneNode(true));
    win.document.documentElement.lang = 'de';
    win.document.body.className = 'pip-body';
    win.addEventListener('pagehide', () => { this.#win = null; this.#observer?.disconnect(); this.#observer = null; });
    this.#win = win;
  }

  /* ── Safari: Canvas als Video ──────────────────────────────────────────── */

  async #openVideo() {
    this.#canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 300 });
    this.#video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    this.#video.srcObject = this.#canvas.captureStream(4);
    this.#drawCanvas();
    await this.#video.play();
    await this.#video.requestPictureInPicture();
    this.#video.addEventListener('leavepictureinpicture', () => { this.#observer?.disconnect(); this.#observer = null; }, { once: true });
  }

  #render() {
    if (this.#win) {
      const top = this.#nav.querySelector('.nav-top').cloneNode(true);
      const eta = this.#nav.querySelector('.nav-times')?.cloneNode(true);
      const box = this.#win.document.createElement('div');
      box.className = 'nav pip-nav';
      box.append(top);
      if (eta) { eta.classList.add('pip-eta'); box.append(eta); }
      this.#win.document.body.replaceChildren(box);
    } else if (this.#canvas) {
      this.#drawCanvas();
    }
  }

  #drawCanvas() {
    const c = this.#canvas, ctx = c.getContext('2d');
    const $ = (s) => this.#nav.querySelector(s);
    const text = (s) => ($(s) && !$(s).hidden ? $(s).textContent.trim() : '');
    ctx.fillStyle = '#1a73e8';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = '120px "Material Symbols Rounded"';
    ctx.textBaseline = 'middle';
    ctx.fillText(text('.nav-icon') || 'navigation', 28, 118);
    ctx.font = 'bold 68px system-ui, sans-serif';
    ctx.fillText(text('.nav-dist'), 180, 80, c.width - 200);
    ctx.font = '600 38px system-ui, sans-serif';
    ctx.fillText(text('.nav-instr'), 180, 145, c.width - 200);
    ctx.font = '30px system-ui, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(text('.nav-toward'), 180, 192, c.width - 200);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgb(0 0 0 / .18)';
    ctx.fillRect(0, 232, c.width, 68);
    ctx.fillStyle = '#fff';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillText(`${text('.nav-eta')}  ·  ${text('.nav-remaining')}`, 28, 267, c.width - 56);
  }
}
