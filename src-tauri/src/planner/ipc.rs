use crate::plugins::require_core_plugin;
use crate::security::{canon_vault, reject_untrusted_webview};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::storage::*;
use super::types::*;

fn planner_vault(vault_path: &str, window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    reject_untrusted_webview(window)?;
    let vault = canon_vault(Path::new(vault_path))?;
    require_core_plugin(&vault, "planner")?;
    Ok(vault)
}

#[tauri::command]
pub fn planner_get_config(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerConfig, String> {
    let vault = planner_vault(&vault_path, &window)?;
    let active = prepare_vault_planner(&app, &vault)?;
    Ok(PlannerConfig {
        active_dir: active.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn planner_load_file(
    vault_path: String,
    file_key: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    let vault = planner_vault(&vault_path, &window)?;
    let file = validate_planner_file_key(&file_key)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    read_planner_json(&dir.join(file))
}

#[tauri::command]
pub fn planner_save_files(
    vault_path: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let vault = planner_vault(&vault_path, &window)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    write_files_to_dir(&dir, &files)
}

#[tauri::command]
pub fn planner_save_file(
    vault_path: String,
    file_key: String,
    json: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let mut files = HashMap::new();
    files.insert(file_key, json);
    planner_save_files(vault_path, files, app, window)
}

#[tauri::command]
pub fn planner_import_bundle(
    vault_path: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let vault = planner_vault(&vault_path, &window)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    write_files_to_dir(&dir, &files)
}

#[tauri::command]
pub fn get_planner_storage_dir(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    let vault = planner_vault(&vault_path, &window)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    Ok(dir.to_string_lossy().into_owned())
}
