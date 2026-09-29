//! Rechner: Ordner über den Dialog des Systems wählen, den Pfad in der
//! App-Konfiguration merken (ordner.json) und nur darin arbeiten.
use serde::Serialize;
use std::{
  fs,
  path::{Component, Path, PathBuf},
  time::UNIX_EPOCH,
};
use tauri::{command, AppHandle, Manager, Runtime};

const MAX_DEPTH: usize = 5;

#[derive(Serialize)]
pub struct Info {
  connected: bool,
  name: Option<String>,
}

#[derive(Serialize)]
pub struct Entry {
  path: String,
  modified: u64,
}

#[derive(Serialize)]
pub struct Files {
  files: Vec<Entry>,
}

#[derive(Serialize)]
pub struct Text {
  text: String,
}

#[derive(Serialize)]
pub struct Written {
  modified: u64,
}

/// Welcher Ordner: leer = Sicherung & Synchronisation (ordner.json),
/// sonst z. B. „layers“ für eigene Ebenen (ordner-layers.json)
fn conf_file<R: Runtime>(app: &AppHandle<R>, slot: &Option<String>) -> Result<PathBuf, String> {
  let slot = slot.as_deref().unwrap_or("");
  if !slot.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') || slot.len() > 20 {
    return Err(format!("Ungültiger Ordner: {slot}"));
  }
  let name = if slot.is_empty() { "ordner.json".to_string() } else { format!("ordner-{slot}.json") };
  Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(name))
}

fn root<R: Runtime>(app: &AppHandle<R>, slot: &Option<String>) -> Option<PathBuf> {
  let text = fs::read_to_string(conf_file(app, slot).ok()?).ok()?;
  let v: serde_json::Value = serde_json::from_str(&text).ok()?;
  let p = PathBuf::from(v.get("path")?.as_str()?);
  p.is_dir().then_some(p)
}

fn need_root<R: Runtime>(app: &AppHandle<R>, slot: &Option<String>) -> Result<PathBuf, String> {
  root(app, slot).ok_or_else(|| "Kein Ordner verbunden".to_string())
}

/// Relativer Pfad im Ordner – nichts darüber hinaus
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let p = Path::new(rel);
  if rel.is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
    return Err(format!("Ungültiger Pfad: {rel}"));
  }
  Ok(root.join(p))
}

fn modified(p: &Path) -> u64 {
  fs::metadata(p)
    .and_then(|m| m.modified())
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

fn info_of(p: Option<PathBuf>) -> Info {
  Info {
    connected: p.is_some(),
    name: p.and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
  }
}

#[command]
pub async fn pick<R: Runtime>(app: AppHandle<R>, slot: Option<String>) -> Result<Info, String> {
  let (tx, rx) = std::sync::mpsc::channel();
  app
    .run_on_main_thread(move || {
      let dialog = rfd::AsyncFileDialog::new().set_title("Ordner für WMap wählen").pick_folder();
      std::thread::spawn(move || {
        let _ = tx.send(tauri::async_runtime::block_on(dialog).map(|h| h.path().to_path_buf()));
      });
    })
    .map_err(|e| e.to_string())?;
  let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
    .await
    .map_err(|e| e.to_string())?;
  let Some(path) = picked else { return Err("abgebrochen".into()) };
  let file = conf_file(&app, &slot)?;
  if let Some(dir) = file.parent() {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  fs::write(&file, serde_json::json!({ "path": path }).to_string()).map_err(|e| e.to_string())?;
  Ok(info_of(Some(path)))
}

#[command]
pub fn info<R: Runtime>(app: AppHandle<R>, slot: Option<String>) -> Info {
  info_of(root(&app, &slot))
}

fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<Entry>) {
  let Ok(entries) = fs::read_dir(dir) else { return };
  for e in entries.flatten() {
    let name = e.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
      continue;
    }
    let path = e.path();
    let rel = format!("{prefix}{name}");
    if path.is_dir() {
      if depth < MAX_DEPTH {
        walk(&path, &format!("{rel}/"), depth + 1, out);
      }
    } else {
      let lower = name.to_lowercase();
      if [".gpx", ".json", ".geojson", ".js", ".mjs"].iter().any(|e| lower.ends_with(e)) {
        out.push(Entry { path: rel, modified: modified(&path) });
      }
    }
  }
}

#[command]
pub async fn list<R: Runtime>(app: AppHandle<R>, slot: Option<String>) -> Result<Files, String> {
  let root = need_root(&app, &slot)?;
  tauri::async_runtime::spawn_blocking(move || {
    let mut files = Vec::new();
    walk(&root, "", 0, &mut files);
    Files { files }
  })
  .await
  .map_err(|e| e.to_string())
}

#[command]
pub fn read<R: Runtime>(app: AppHandle<R>, slot: Option<String>, path: String) -> Result<Text, String> {
  let p = inside(&need_root(&app, &slot)?, &path)?;
  fs::read_to_string(&p).map(|text| Text { text }).map_err(|e| e.to_string())
}

#[command]
pub fn write<R: Runtime>(app: AppHandle<R>, slot: Option<String>, path: String, text: String) -> Result<Written, String> {
  let p = inside(&need_root(&app, &slot)?, &path)?;
  if let Some(dir) = p.parent() {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  fs::write(&p, text).map_err(|e| e.to_string())?;
  Ok(Written { modified: modified(&p) })
}

#[command]
pub fn remove<R: Runtime>(app: AppHandle<R>, slot: Option<String>, path: String) -> Result<(), String> {
  let p = inside(&need_root(&app, &slot)?, &path)?;
  match fs::remove_file(&p) {
    Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
    _ => Ok(()),
  }
}

#[command]
pub fn disconnect<R: Runtime>(app: AppHandle<R>, slot: Option<String>) -> Result<(), String> {
  let _ = fs::remove_file(conf_file(&app, &slot)?);
  Ok(())
}

#[derive(Serialize)]
pub struct Saved {
  name: Option<String>,
}

/// Eine Datei über den Speichern-Dialog ablegen (ZIP-Export …); `data` in Base64
#[command]
pub async fn save<R: Runtime>(app: AppHandle<R>, name: String, data: String) -> Result<Saved, String> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
  let start = app.path().download_dir().ok();
  let (tx, rx) = std::sync::mpsc::channel();
  app
    .run_on_main_thread(move || {
      let mut dialog = rfd::AsyncFileDialog::new().set_title("Speichern").set_file_name(&name);
      if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
      }
      let dialog = dialog.save_file();
      std::thread::spawn(move || {
        let _ = tx.send(tauri::async_runtime::block_on(dialog).map(|h| h.path().to_path_buf()));
      });
    })
    .map_err(|e| e.to_string())?;
  let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
    .await
    .map_err(|e| e.to_string())?;
  let Some(path) = picked else { return Err("abgebrochen".into()) };
  fs::write(&path, bytes).map_err(|e| e.to_string())?;
  Ok(Saved { name: path.file_name().map(|n| n.to_string_lossy().into_owned()) })
}

/* ── Mit WMap geöffnete Dateien ─────────────────────────────────────────────── */

#[derive(Serialize, Clone)]
pub struct OpenedFile {
  name: String,
  text: String,
}

#[derive(Default)]
pub struct Opened(std::sync::Mutex<Vec<OpenedFile>>);

#[derive(Serialize)]
pub struct OpenedList {
  count: usize,
  files: Vec<OpenedFile>,
}

const MAX_OPEN: u64 = 50 * 1024 * 1024;

/// Dateien, mit denen WMap gestartet bzw. geöffnet wurde (Doppelklick, „Öffnen
/// mit“): nur GPX, höchstens 50 MB. → true, wenn etwas dazukam
pub fn open_paths<R: Runtime>(app: &AppHandle<R>, paths: impl IntoIterator<Item = PathBuf>) -> bool {
  if app.try_state::<Opened>().is_none() {
    app.manage(Opened::default());
  }
  let state = app.state::<Opened>();
  let mut list = state.0.lock().unwrap_or_else(|e| e.into_inner());
  let before = list.len();
  for p in paths {
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("gpx")) {
      continue;
    }
    if fs::metadata(&p).map(|m| m.len() > MAX_OPEN).unwrap_or(true) {
      continue;
    }
    if let Ok(text) = fs::read_to_string(&p) {
      let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Datei.gpx".into());
      list.push(OpenedFile { name, text });
    }
  }
  list.len() > before
}

/// Geöffnete Dateien: `peek` nur zählen, sonst abholen (danach ist die Liste leer)
#[command]
pub fn opened<R: Runtime>(app: AppHandle<R>, peek: Option<bool>) -> OpenedList {
  let Some(state) = app.try_state::<Opened>() else { return OpenedList { count: 0, files: vec![] } };
  let mut list = state.0.lock().unwrap_or_else(|e| e.into_inner());
  if peek.unwrap_or(false) {
    return OpenedList { count: list.len(), files: vec![] };
  }
  let files = std::mem::take(&mut *list);
  OpenedList { count: files.len(), files }
}
