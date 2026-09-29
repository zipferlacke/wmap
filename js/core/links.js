/**
 * Weblinks (Website eines Orts, Quellen, Impressum …) in der App: nicht im
 * Fenster von WMap öffnen, sondern darüber – Android als Custom Tab, am
 * Rechner in einem eigenen Fenster, beide mit Leiste: ✕ links schließt,
 * rechts „Im Browser öffnen“ (Plugin src-tauri/plugins/browser).
 * Im Browser bleibt alles, wie es ist (neuer Tab).
 *
 *   openLink(url)   von Hand, z. B. aus einer Meldung
 * Links auf andere Seiten derselben Herkunft (WMap selbst) laufen normal.
 */
const core = window.__TAURI__?.core;

export function openLink(url) {
  if (!core) { window.open(url, '_blank', 'noopener'); return; }
  core.invoke('plugin:browser|open', { url, external: false })
    .catch(() => core.invoke('plugin:browser|open', { url, external: true }).catch(() => {}));
}

if (core) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || a.hasAttribute('download')) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
    e.preventDefault();
    openLink(url.href);
  }, true);
}
