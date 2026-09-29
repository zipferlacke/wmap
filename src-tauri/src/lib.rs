//! WMap als App: dieselben Web-Dateien wie im Browser (web/, von
//! web-kopieren.sh kopiert) in einem eigenen Fenster.
use tauri::{Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Rechner: zweiter Start durch einen geo:-Link → Link geht ans offene Fenster
  // (muss vor deep-link stehen); durch eine GPX-Datei (Doppelklick) → Import
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
    let cwd = std::path::PathBuf::from(cwd);
    if tauri_plugin_folder::open_paths(app, args.iter().skip(1).map(|a| cwd.join(a))) {
      open_import(app);
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
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(target_os = "linux")]
      allow_geolocation(app)?;
      // Karten-Links „geo:…“: beim Start und während die App läuft
      if let Some(urls) = app.deep_link().get_current()? {
        open_geo(app.handle(), &urls);
      }
      let handle = app.handle().clone();
      app.deep_link().on_open_url(move |event| open_geo(&handle, &event.urls()));
      // Mit einer GPX-Datei gestartet (Doppelklick, „Öffnen mit“): die Seite
      // holt sie beim Plugin „folder“ ab (core/theme.js → import.html)
      #[cfg(desktop)]
      tauri_plugin_folder::open_paths(app.handle(), std::env::args_os().skip(1).map(std::path::PathBuf::from));
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
          open_import(_app);
        }
      }
    });
}

/// Neue GPX-Datei, während die App läuft: zur Seite zum Öffnen (import.html)
/// neben der gerade offenen – eingepackt oder die Webversion
#[cfg(desktop)]
fn open_import(app: &tauri::AppHandle) {
  let Some(win) = app.get_webview_window("main") else { return };
  let Ok(Ok(mut page)) = win.url().map(|u| u.join("import.html")) else { return };
  page.set_query(None);
  page.set_fragment(None);
  let _ = win.navigate(page);
  let _ = win.set_focus();
}

/// geo:-Link an die Kartenseite: `index.html?geo=…` neben der gerade offenen
/// Seite – eingepackt oder die Webversion (tauri-start.js reicht `?geo=` beim
/// Wechsel weiter). Ausgewertet wird er in js/app.js (openGeo).
fn open_geo(app: &tauri::AppHandle, urls: &[Url]) {
  let Some(link) = urls.iter().find(|u| u.scheme() == "geo") else { return };
  let Some(win) = app.get_webview_window("main") else { return };
  let Ok(Ok(mut page)) = win.url().map(|u| u.join("index.html")) else { return };
  page.query_pairs_mut().clear().append_pair("geo", link.as_str());
  page.set_fragment(None);
  let _ = win.navigate(page);
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
