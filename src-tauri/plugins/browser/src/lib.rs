//! Weblinks aus der App öffnen (js/core/links.js): nicht im Fenster von WMap,
//! sondern darüber – mit einer Leiste: ✕ links schließt, rechts „Im Browser
//! öffnen“ gibt den Link an den Standardbrowser.
//!
//!   open { url, external }   external: gleich im Standardbrowser
//!
//! Android: Custom Tab des Systems (android/…/BrowserPlugin.kt); Rechner:
//! eigenes Fenster „link“ mit eingeblendeter Leiste (desktop.rs).
use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

#[cfg(desktop)]
mod desktop;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  let builder = Builder::new("browser");
  #[cfg(desktop)]
  let builder = builder.invoke_handler(tauri::generate_handler![desktop::open]);
  builder
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("de.wuefl.wmap.browser", "BrowserPlugin")?;
      Ok(())
    })
    .build()
}
