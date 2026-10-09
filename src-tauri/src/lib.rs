//! WMap als App: dieselben Web-Dateien wie im Browser (web/, von
//! web-kopieren.sh kopiert) in einem eigenen Fenster.
use tauri::{Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Rechner: zweiter Start durch einen geo:-Link → Link geht ans offene Fenster
  // (muss vor deep-link stehen); durch eine GPX-Datei (Doppelklick) → Import;
  // über einen Shortcut der .desktop-Datei (--wmap-go=…) → dessen Seite
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
    let cwd = std::path::PathBuf::from(cwd);
    if let Some(page) = tauri_plugin_folder::shortcut_page(&args) {
      open_page(app, &page);
    } else if tauri_plugin_folder::open_paths(app, args.iter().skip(1).map(|a| arg_path(&cwd, a))) {
      open_page(app, "import.html");
    }
    if let Some(win) = app.get_webview_window("main") {
      let _ = win.unminimize();
      let _ = win.set_focus();
    }
  }));
  let builder = builder.plugin(tauri_plugin_deep_link::init());
  // Handy: GPS über das Gerät (js/core/native.js nutzt es, sobald es da ist)
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_geolocation::init());
  // Android: Trainings und Routen aus Health Connect (js/services/health.js)
  let builder = builder.plugin(tauri_plugin_health::init());
  // Ordner verbinden (js/data/folder.js) – das WebView kennt die Ordner-API von Chrome nicht
  let builder = builder.plugin(tauri_plugin_folder::init());
  // Weblinks über der App (js/core/links.js): Custom Tab bzw. eigenes Fenster
  let builder = builder.plugin(tauri_plugin_browser::init());
  builder
    .manage(Pending::default())
    .invoke_handler(tauri::generate_handler![overpass, pending_link])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Debug-Fassung am Rechner: am Fenstertitel zu erkennen (am Handy heißt
      // die App selbst so, tools/android-einbinden.py)
      #[cfg(all(desktop, debug_assertions))]
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title("wmap-Debug");
      }
      #[cfg(target_os = "linux")]
      allow_geolocation(app)?;
      // Karten-Links „geo:…“ und (Handy) geteilte Links auf app.wuefl.de/wmap:
      // beim Start und während die App läuft
      if let Some(urls) = app.deep_link().get_current()? {
        // Für die Seite bereitlegen – sie holt es beim Laden ab (pending_link, js/core/theme.js)
        *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = link_target(&urls);
      }
      let handle = app.handle().clone();
      app.deep_link().on_open_url(move |event| open_link(&handle, &event.urls()));
      // Mit einer GPX- oder FIT-Datei gestartet (Doppelklick, „Öffnen mit“): die Seite
      // holt sie beim Plugin „folder“ ab (core/theme.js → import.html)
      #[cfg(desktop)]
      {
        let cwd = std::env::current_dir().unwrap_or_default();
        let args = std::env::args_os().skip(1).map(|a| arg_path(&cwd, &a.to_string_lossy()));
        tauri_plugin_folder::open_paths(app.handle(), args);
      }
      // Über einen Shortcut gestartet: die Seite holt sie ebenso ab (→ dorthin)
      #[cfg(desktop)]
      if let Some(page) = tauri_plugin_folder::shortcut_page(std::env::args_os()) {
        tauri_plugin_folder::open_page(app.handle(), page);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("WMap konnte nicht starten")
    .run(|_app, _event| {
      // macOS: Dateien kommen nicht als Argument, sondern als „Opened“
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Opened { urls } = &_event {
        let paths = urls.iter().filter_map(|u| u.to_file_path().ok());
        if tauri_plugin_folder::open_paths(_app, paths) {
          open_page(_app, "import.html");
        }
      }
    });
}

/// Datei aus den Argumenten: Pfad oder file://-Link (die .desktop-Datei gibt
/// mit `%u` Links weiter – nötig für geo:, Dateimanager schicken dann file://)
#[cfg(desktop)]
fn arg_path(cwd: &std::path::Path, arg: &str) -> std::path::PathBuf {
  Url::parse(arg)
    .ok()
    .filter(|u| u.scheme() == "file")
    .and_then(|u| u.to_file_path().ok())
    .unwrap_or_else(|| cwd.join(arg))
}

/// Während die App läuft: zu einer Seite neben der gerade offenen – eingepackt
/// oder die Webversion (neue GPX-Datei → import.html, Shortcut → seine Seite)
#[cfg(desktop)]
fn open_page(app: &tauri::AppHandle, page: &str) {
  let Some(win) = app.get_webview_window("main") else { return };
  let Ok(Ok(mut url)) = win.url().map(|u| u.join(page)) else { return };
  url.set_fragment(None);
  let _ = win.navigate(url);
  let _ = win.set_focus();
}

/// Link, mit dem die App gestartet wurde – die Seite holt ihn ab (`pending_link`)
#[derive(Default)]
struct Pending(std::sync::Mutex<Option<String>>);

/// Mit einem Link gestartet? → Ziel neben der offenen Seite (z. B. `index.html?geo=…`), einmal.
/// Am Handy kommt das Umschalten beim Start (open_link aus `setup`) nicht an: Die erste Seite
/// lädt da noch. Darum fragt jede Seite beim Laden hier nach (js/core/theme.js).
#[tauri::command]
fn pending_link(state: tauri::State<Pending>) -> Option<String> {
  state.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Link → Ziel neben der gerade offenen Seite, eingepackt oder die Webversion:
///   geo:…                      → `index.html?geo=…` (tauri-start.js reicht
///                                `?geo=` beim Wechsel weiter; js/app.js openGeo)
///   https://app.wuefl.de/wmap/… → dieselbe Seite samt `?…` und `#…` (geteilte
///                                Orte, Routen, Touren, Listen – ui/share.js)
fn link_target(urls: &[Url]) -> Option<String> {
  if let Some(link) = urls.iter().find(|u| u.scheme() == "geo") {
    let mut page = Url::parse("http://x/index.html").ok()?;
    page.query_pairs_mut().append_pair("geo", link.as_str());
    return Some(format!("index.html?{}", page.query()?));
  }
  let link = urls.iter().find(|u| u.scheme() == "https" && u.host_str() == Some("app.wuefl.de"))?;
  // Nur Seiten von WMap: „/wmap/tour.html“ → „tour.html“, „/wmap/“ → „index.html“
  let rest = link.path().strip_prefix("/wmap/")?;
  let name = if rest.is_empty() { "index.html" } else { rest };
  if name.contains('/') || !name.ends_with(".html") {
    return None;
  }
  let mut target = name.to_string();
  if let Some(q) = link.query() {
    target.push('?');
    target.push_str(q);
  }
  if let Some(f) = link.fragment() {
    target.push('#');
    target.push_str(f);
  }
  Some(target)
}

/// Link in der App öffnen (link_target) – während sie läuft. Die Seite wechselt selbst (`eval`): Das kehrt
/// sofort zurück. `win.url()` und `navigate` fragen am Handy den Haupt-Thread – auf dem dieser Aufruf schon
/// läuft: Die App stand 10 s weiß da und stürzte dann ab (wry main_pipe, SendError). Das Ziel liegt zusätzlich
/// für `pending_link` bereit, falls die Seite gerade erst lädt.
fn open_link(app: &tauri::AppHandle, urls: &[Url]) {
  let Some(target) = link_target(urls) else { return };
  *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(target.clone());
  let Some(win) = app.get_webview_window("main") else { return };
  let Ok(rel) = serde_json::to_string(&target) else { return };
  let _ = win.eval(format!(
    "(() => {{ const to = new URL({rel}, location.href); window.__TAURI__?.core?.invoke('pending_link').catch(() => {{}}); if (to.href !== location.href) location.assign(to); }})()"
  ));
  #[cfg(desktop)]
  let _ = win.set_focus();
}

/// WebKitGTK lehnt Standortabfragen ab, solange niemand zustimmt – die
/// Web-App fragt ohnehin selbst nach, darum hier durchlassen (GeoClue liefert).
#[cfg(target_os = "linux")]
fn allow_geolocation(app: &tauri::App) -> tauri::Result<()> {
  use webkit2gtk::glib::prelude::*;
  use webkit2gtk::{GeolocationPermissionRequest, PermissionRequestExt, WebViewExt};
  if let Some(win) = app.get_webview_window("main") {
    win.with_webview(|wv| {
      wv.inner().connect_permission_request(|_, req| {
        if req.is::<GeolocationPermissionRequest>() {
          req.allow();
          return true;
        }
        false
      });
    })?;
  }
  Ok(())
}

/// Nur diese Server (js/core/config.js API.overpass) – kein allgemeiner Abruf aus der Seite
const OVERPASS: [&str; 3] = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/// Overpass-Anfrage aus den Apps (js/services/overpass.js). Die Regeln der
/// öffentlichen Server verlangen einen User-Agent oder Referer, der die App
/// eindeutig erkennen lässt – beides hier. → (Status, Antwort)
#[tauri::command]
async fn overpass(url: String, query: String) -> Result<(u16, String), String> {
  if !OVERPASS.contains(&url.as_str()) {
    return Err(format!("Kein Overpass-Server: {url}"));
  }
  tauri::async_runtime::spawn_blocking(move || {
    let agent: ureq::Agent = ureq::Agent::config_builder()
      .timeout_global(Some(std::time::Duration::from_secs(45)))
      .http_status_as_error(false)
      .user_agent(concat!("WMap/", env!("CARGO_PKG_VERSION"), " (+https://wuefl.de/wmap)"))
      .build()
      .into();
    let mut res = agent
      .post(&url)
      .header("Referer", "https://app.wuefl.de/wmap/")
      .header("Accept", "application/json")
      .send_form([("data", query.as_str())])
      .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    // Große Antworten (Umrisse) – bis 64 MB statt der üblichen 10 MB
    let body = res.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().map_err(|e| e.to_string())?;
    Ok((status, body))
  })
  .await
  .map_err(|e| e.to_string())?
}
