//! WMap als Desktop-App: dieselben Web-Dateien wie im Browser (dist/, von
//! tools/tauri-dist.sh kopiert) in einem eigenen Fenster.
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Handy: GPS über das Gerät (js/native.js nutzt es, sobald es da ist)
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_geolocation::init());
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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("WMap konnte nicht starten");
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
