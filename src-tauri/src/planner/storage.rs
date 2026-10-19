use crate::security::write_private_json_file;
use crate::settings::app_data_dir_for_build;
use crate::vault_fs::read_vault_meta;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::types::*;

pub(crate) fn validate_planner_file_key(file_key: &str) -> Result<&'static str, String> {
    PLANNER_FILES
        .iter()
        .find(|name| **name == file_key)
        .copied()
        .ok_or_else(|| format!("Unknown planner file key: {file_key}"))
}

/// Legacy profile-wide planner directory. Read only, and only when it already
/// exists, so Metis does not recreate a shared planner store.
fn legacy_shared_planner_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app_data_dir_for_build(app).ok()?.join("planner");
    if dir.is_dir() { Some(dir) } else { None }
}

pub(crate) fn vault_planner_dir(vault: &Path) -> PathBuf {
    vault.join(".metis").join("planner")
}

pub(crate) fn ensure_vault_planner_dir(vault: &Path) -> Result<PathBuf, String> {
    let dir = vault_planner_dir(vault);
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create vault planner dir: {e}"))?;
    Ok(dir)
}

fn write_planner_json(path: &Path, json: &str) -> Result<(), String> {
    if json.len() > PLANNER_MAX_JSON_BYTES {
        return Err("Planner payload too large.".into());
    }
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("Invalid planner JSON: {e}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create planner directory: {e}"))?;
    }
    write_private_json_file(path, json)
}

pub(crate) fn read_planner_json(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read planner file: {e}"))?;
    if raw.len() > PLANNER_MAX_JSON_BYTES {
        return Err("Planner file too large.".into());
    }
    Ok(Some(raw))
}

/// Planner files live only under `<vault>/.metis/planner/`.
///
/// If that folder has no planner JSON yet, copy the legacy app-data planner in
/// once so existing shared calendars are not dropped. Later reads and writes
/// stay in the vault.
pub(crate) fn prepare_vault_planner(app: &AppHandle, vault: &Path) -> Result<PathBuf, String> {
    let dir = ensure_vault_planner_dir(vault)?;
    let meta = read_vault_meta(vault)?;
    // Only vaults that were on the old shared planner (or never chose a mode)
    // receive a one-time copy. A vault already set to "vault" keeps its own files.
    let adopt_legacy = meta.planner_mode.as_deref() != Some("vault");
    if adopt_legacy && !planner_dir_has_content(&dir) {
        if let Some(shared) = legacy_shared_planner_dir(app) {
            if planner_dir_has_content(&shared) {
                copy_planner_tree(&shared, &dir)?;
            }
        }
    }
    if meta.planner_mode.as_deref() != Some("vault") || meta.planner_setup_required {
        let mut next = meta;
        next.planner_mode = Some("vault".into());
        next.planner_setup_required = false;
        crate::vault_fs::write_vault_meta_full(vault, &next)?;
    }
    Ok(dir)
}

pub(crate) fn copy_planner_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Cannot create planner directory: {e}"))?;
    for file in PLANNER_FILES {
        let src = from.join(file);
        if !src.exists() {
            continue;
        }
        let dst = to.join(file);
        fs::copy(&src, &dst).map_err(|e| format!("Failed to copy planner file {file}: {e}"))?;
    }
    Ok(())
}

pub(crate) fn planner_dir_has_content(dir: &Path) -> bool {
    for file in PLANNER_FILES {
        let path = dir.join(file);
        if !path.exists() {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > 4 {
                return true;
            }
        }
    }
    false
}

pub(crate) fn write_files_to_dir(dir: &Path, files: &HashMap<String, String>) -> Result<(), String> {
    for (file_key, json) in files {
        let file = validate_planner_file_key(file_key)?;
        write_planner_json(&dir.join(file), json)?;
    }
    Ok(())
}

