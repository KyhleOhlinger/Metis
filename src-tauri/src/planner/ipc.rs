use crate::plugins::require_core_plugin;
use crate::security::registered_vault;
use crate::state::CurrentVault;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::storage::*;
use super::types::*;

/// Open vault for this window. The client path must be that same directory.
///
/// SECURITY: rejects the help webview, a missing registration, and a path that
/// is not the vault this window already opened.
fn planner_vault(
    vault_path: &str,
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    let registered = registered_vault(window, vault_state)?;
    let requested = crate::security::canon_vault(Path::new(vault_path))?;
    if requested != registered {
        return Err("Planner commands only apply to the open vault.".into());
    }
    require_core_plugin(&registered, "planner")?;
    Ok(registered)
}

fn read_planner_keys(dir: &Path, keys: &[&str]) -> Result<HashMap<String, Option<String>>, String> {
    let mut files = HashMap::new();
    for file in keys {
        files.insert((*file).to_string(), read_planner_json(&dir.join(file))?);
    }
    Ok(files)
}

fn validated_keys(file_keys: &[String]) -> Result<Vec<&'static str>, String> {
    if file_keys.is_empty() {
        return Err("planner_load_files: no file keys.".into());
    }
    if file_keys.len() > PLANNER_FILES.len() {
        return Err("planner_load_files: too many file keys.".into());
    }
    let mut keys = Vec::with_capacity(file_keys.len());
    for key in file_keys {
        keys.push(validate_planner_file_key(key)?);
    }
    Ok(keys)
}

#[tauri::command]
pub fn planner_get_config(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<PlannerConfig, String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    let active = prepare_vault_planner(&app, &vault)?;
    Ok(PlannerConfig {
        active_dir: active.to_string_lossy().into_owned(),
        legacy_adoption_pending: legacy_adoption_pending(&app, &vault),
    })
}

#[tauri::command]
pub fn planner_decide_legacy_adoption(
    vault_path: String,
    approve: bool,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    decide_legacy_adoption(&app, &vault, approve)
}

#[tauri::command]
pub fn planner_load_files(
    vault_path: String,
    file_keys: Vec<String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<HashMap<String, Option<String>>, String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    let keys = validated_keys(&file_keys)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    read_planner_keys(&dir, &keys)
}

#[tauri::command]
pub fn planner_load_file(
    vault_path: String,
    file_key: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Option<String>, String> {
    let files = planner_load_files(vault_path, vec![file_key.clone()], app, window, vault_state)?;
    Ok(files.get(&file_key).cloned().flatten())
}

#[tauri::command]
pub fn planner_save_files(
    vault_path: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
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
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let mut files = HashMap::new();
    files.insert(file_key, json);
    planner_save_files(vault_path, files, app, window, vault_state)
}

#[tauri::command]
pub fn planner_import_bundle(
    vault_path: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    write_files_to_dir(&dir, &files)
}

#[tauri::command]
pub fn planner_local_import_allowed(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<bool, String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    Ok(local_import_allowed(&app, &vault))
}

#[tauri::command]
pub fn get_planner_storage_dir(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault = planner_vault(&vault_path, &window, &vault_state)?;
    let dir = prepare_vault_planner(&app, &vault)?;
    Ok(dir.to_string_lossy().into_owned())
}
