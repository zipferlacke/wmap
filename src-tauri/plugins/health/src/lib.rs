//! Health Connect (Android): Trainings und ihre Routen lesen, die andere Apps
//! (Fitbit, Samsung Health, Strava …) dort ablegen. Die Befehle stehen in
//! Kotlin (android/src/main/java/HealthPlugin.kt) – Tauri leitet
//! `invoke('plugin:health|sessions')` direkt dorthin. Auf anderen Systemen
//! gibt es das Plugin, aber keine Befehle.
use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("health")
    .setup(|_app, _api| {
      #[cfg(target_os = "android")]
      _api.register_android_plugin("de.wuefl.wmap.health", "HealthPlugin")?;
      Ok(())
    })
    .build()
}
