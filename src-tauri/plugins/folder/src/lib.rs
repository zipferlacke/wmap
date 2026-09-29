//! Ordner verbinden in der App (js/data/folder.js): Das WebView der App kennt
//! die File System Access API von Chrome nicht – darum wählt hier das System
//! den Ordner, und die App liest und schreibt nur darin.
//!
//!   pick                Ordner wählen → { connected, name }
//!   info                { connected, name }
//!   list                Dateien (.gpx, .json, .geojson, .js) bis 5 Ebenen tief → { files: [{ path, modified }] }
//!   read { path }       → { text }
//!   write { path, text } legt fehlende Ordner an → { modified }
//!   remove { path }
//!   disconnect
//!
//! Alle Befehle nehmen `slot` (optional): leer = Ordner für Sicherung &
//! Synchronisation, „layers“ = Ordner für eigene Ebenen (Plugins).
//!
//! Pfade sind relativ zum gewählten Ordner, mit „/“ – „..“ und absolute
//! Pfade lehnt das Plugin ab. Android: Kotlin (android/…/FolderPlugin.kt,
//! Speicherzugriff des Systems – auch Nextcloud, Drive …); Rechner: Rust.
use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

#[cfg(desktop)]
mod desktop;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("folder");
  #[cfg(desktop)]
  let builder = builder.invoke_handler(tauri::generate_handler![
    desktop::pick,
    desktop::info,
    desktop::list,
    desktop::read,
    desktop::write,
    desktop::remove,
    desktop::disconnect
  ]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("de.wuefl.wmap.folder", "FolderPlugin")?;
      Ok(())
    })
    .build()
}
