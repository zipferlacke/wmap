//! Befehle, die die Web-App aufrufen darf (`plugin:browser|…`); share und
//! copy gibt es nur unter Android (das WebView kann beides nicht).
const COMMANDS: &[&str] = &["open", "share", "share_file", "copy"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
