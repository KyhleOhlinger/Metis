use crate::security::write_private_json_file;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const MAX_ENTRIES: usize = 1000;

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

fn log_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app_handle)?.join("agent-run-log.json"))
}

#[tauri::command]
pub fn load_agent_run_log(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = log_path(&app_handle)?;
    if !path.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read agent run log: {e}"))
}

#[tauri::command]
pub fn append_agent_run_log(app_handle: tauri::AppHandle, entry_json: String) -> Result<(), String> {
    let entry: Value = serde_json::from_str(&entry_json)
        .map_err(|e| format!("Invalid agent run log entry: {e}"))?;

    let path = log_path(&app_handle)?;
    let mut entries: Vec<Value> = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read agent run log: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };

    entries.insert(0, entry);
    entries.truncate(MAX_ENTRIES);

    let out = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize agent run log: {e}"))?;
    write_private_json_file(&path, &out)
}

#[tauri::command]
pub fn clear_agent_run_log(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = log_path(&app_handle)?;
    write_private_json_file(&path, "[]")
}
