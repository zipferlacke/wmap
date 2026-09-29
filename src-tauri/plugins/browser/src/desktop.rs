//! Rechner: Link in einem eigenen Fenster „link“. Oben blendet ein Skript
//! eine Leiste ein (✕ | Seite | Im Browser öffnen); deren Knöpfe führen zu
//! „wmap-link:…“ – das fängt die Navigation ab, statt es zu laden.
use tauri::{command, AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "link";

const BAR: &str = r#"
(() => {
  if (window.top !== window || window.__wmapBar) return;
  window.__wmapBar = true;
  const add = () => {
    if (!document.body || document.getElementById('wmap-link-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'wmap-link-bar';
    bar.attachShadow({ mode: 'open' }).innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483647; inset: 0 0 auto 0; height: 44px; }
      div { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 6px; box-sizing: border-box;
        background: #1a73e8; color: #fff; font: 15px system-ui, sans-serif; box-shadow: 0 1px 6px rgb(0 0 0 / .3); }
      a { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: #fff; }
      a:hover { background: rgb(255 255 255 / .15); }
      span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
      svg { width: 22px; height: 22px; fill: currentColor; }
    </style><div>
      <a href="wmap-link://close" title="Schließen"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></a>
      <span>${location.host}</span>
      <a href="wmap-link://open?u=${encodeURIComponent(location.href)}" title="Im Browser öffnen"><svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg></a>
    </div>`;
    document.documentElement.append(bar);
    document.documentElement.style.setProperty('padding-top', '44px', 'important');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
"#;

fn in_browser(url: &str) -> Result<(), String> {
  open::that_detached(url).map_err(|e| e.to_string())
}

#[command]
pub fn open<R: Runtime>(app: AppHandle<R>, url: String, external: Option<bool>) -> Result<(), String> {
  let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
  if !matches!(parsed.scheme(), "http" | "https") {
    return Err("Nur http- und https-Links".into());
  }
  if external.unwrap_or(false) {
    return in_browser(&url);
  }
  if let Some(win) = app.get_webview_window(LABEL) {
    win.navigate(parsed).map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    return Ok(());
  }
  let handle = app.clone();
  WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
    .title("WMap – Link")
    .inner_size(1100.0, 820.0)
    .initialization_script(BAR)
    .on_navigation(move |u| {
      if u.scheme() != "wmap-link" {
        return true;
      }
      let target = u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned());
      let h = handle.clone();
      let close = u.host_str() == Some("close");
      // Nicht im Navigations-Handler selbst schließen – danach
      tauri::async_runtime::spawn(async move {
        if let Some(t) = target {
          let _ = in_browser(&t);
        }
        if let Some(w) = h.get_webview_window(LABEL) {
          let _ = if close { w.close() } else { Ok(()) };
        }
      });
      false
    })
    .build()
    .map_err(|e| e.to_string())?;
  Ok(())
}
