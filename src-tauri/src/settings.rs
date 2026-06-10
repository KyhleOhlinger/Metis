use crate::security::write_private_json_file;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ── Persona & settings persistence ───────────────────────────────────────────
//
// `personas.json` and `settings.json` are stored in the OS-level application
// data directory (e.g. ~/Library/Application Support/com.metis.app/ on macOS).
// This keeps user configuration outside the vault so it is shared across vaults.
//
// SECURITY: The settings file contains the user's AI API key stored as plain
// text, protected only by OS-level file permissions.
//
// BUILD ISOLATION: Debug builds write to a dedicated `dev/` subdirectory so
// that credentials entered during development are **never** visible to a
// release build.
//
//   Debug   → <AppData>/com.metis.app/dev/settings.json
//   Release → <AppData>/com.metis.app/settings.json
//
// This means you can configure test keys freely in dev without any risk of
// them appearing when you run `tauri build`.

fn app_data_dir_for_build(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    #[cfg(debug_assertions)]
    let dir = base.join("dev");
    #[cfg(not(debug_assertions))]
    let dir = base;

    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(dir)
}

fn app_data_file(app_handle: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app_handle)?.join(name))
}

/// Application semver from `Cargo.toml` (matches native About dialog).
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

/// App profile directory where the webview persists planner data (`localStorage`).
#[tauri::command]
pub fn get_planner_storage_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    Ok(app_data_dir_for_build(&app_handle)?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn load_personas(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Personas are loaded from the main app webview only (not help).
    let path = app_data_file(&app_handle, "personas.json")?;
    if !path.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read personas: {e}"))
}

#[tauri::command]
pub fn save_personas(app_handle: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Invalid personas JSON: {e}"))?;
    let path = app_data_file(&app_handle, "personas.json")?;
    write_private_json_file(&path, &json)
}

#[tauri::command]
pub fn load_settings(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_data_file(&app_handle, "settings.json")?;
    if !path.exists() {
        return Ok("{}".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))
}

#[tauri::command]
pub fn save_settings(app_handle: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Invalid settings JSON: {e}"))?;
    let path = app_data_file(&app_handle, "settings.json")?;
    write_private_json_file(&path, &json)
}
