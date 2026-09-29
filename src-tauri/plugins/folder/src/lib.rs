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
//!   save { name, data, mime } eine Datei (Base64) über den Speichern-Dialog des
//!                       Systems ablegen, z. B. den ZIP-Export → { name }
//!   opened { peek }     GPX-Dateien, mit denen WMap geöffnet wurde („Öffnen
//!                       mit“, Teilen, Doppelklick) → { count, files: [{ name, text }] };
//!                       `peek`: nur zählen, sonst abholen (danach leer).
//!                       Rechner: die App gibt sie mit open_paths() herein
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
#[cfg(desktop)]
pub use desktop::open_paths;

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
    desktop::disconnect,
    desktop::save,
    desktop::opened
  ]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("de.wuefl.wmap.folder", "FolderPlugin")?;
      Ok(())
    })
    .build()
}
