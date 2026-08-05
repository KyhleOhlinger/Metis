use crate::security::{canon_vault, write_private_json_file};
use crate::settings::app_data_dir_for_build;
use crate::types::VaultMeta;
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

pub(crate) fn shared_planner_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir_for_build(app)?.join("planner");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create shared planner dir: {e}"))?;
    Ok(dir)
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

pub(crate) fn resolve_effective_mode(meta: &VaultMeta) -> String {
    meta.planner_mode
        .clone()
        .filter(|m| m == "shared" || m == "vault")
        .unwrap_or_else(|| "shared".into())
}

pub(crate) fn active_planner_dir(app: &AppHandle, vault: &Path, mode: &str) -> Result<PathBuf, String> {
    match mode {
        "vault" => ensure_vault_planner_dir(vault),
        _ => shared_planner_dir(app),
    }
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

pub(crate) fn read_mirror_state(vault: &Path) -> Option<MirrorState> {
    let path = vault_planner_dir(vault).join(PLANNER_FILE_MIRROR_STATE);
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_mirror_state(vault: &Path) -> Result<(), String> {
    let state = MirrorState {
        last_synced_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        source: "shared".into(),
        read_only: true,
    };
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialise mirror state: {e}"))?;
    write_planner_json(&vault_planner_dir(vault).join(PLANNER_FILE_MIRROR_STATE), &json)
}

fn read_mirror_registry(app: &AppHandle) -> Result<MirrorRegistry, String> {
    let path = shared_planner_dir(app)?.join(MIRROR_REGISTRY_FILE);
    if !path.exists() {
        return Ok(MirrorRegistry::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read mirror registry: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid mirror registry JSON: {e}"))
}

fn write_mirror_registry(app: &AppHandle, registry: &MirrorRegistry) -> Result<(), String> {
    let path = shared_planner_dir(app)?.join(MIRROR_REGISTRY_FILE);
    let json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialise mirror registry: {e}"))?;
    write_planner_json(&path, &json)
}

fn vault_uses_shared_planner(vault: &Path) -> Result<bool, String> {
    let meta = read_vault_meta(vault)?;
    Ok(resolve_effective_mode(&meta) == "shared")
}

pub(crate) fn unregister_mirror_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let vault_str = vault.to_string_lossy().into_owned();
    let mut registry = read_mirror_registry(app)?;
    let before = registry.vault_paths.len();
    registry.vault_paths.retain(|p| p != &vault_str);
    if registry.vault_paths.len() != before {
        write_mirror_registry(app, &registry)?;
    }
    Ok(())
}

pub(crate) fn shared_registry_vault_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let registry = read_mirror_registry(app)?;
    let mut valid: Vec<PathBuf> = Vec::new();
    for vault_str in registry.vault_paths {
        let vault_path = PathBuf::from(&vault_str);
        match canon_vault(&vault_path) {
            Ok(vault) => {
                if vault_uses_shared_planner(&vault)? {
                    valid.push(vault);
                }
            }
            Err(_) => {
                // skip invalid paths — pruned on next mirror pass
            }
        }
    }
    Ok(valid)
}

fn prune_mirror_registry(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let registry = read_mirror_registry(app)?;
    let previous_paths = registry.vault_paths.clone();
    let mut kept: Vec<String> = Vec::new();
    let mut vaults: Vec<PathBuf> = Vec::new();
    for vault_str in registry.vault_paths {
        let vault_path = PathBuf::from(&vault_str);
        match canon_vault(&vault_path) {
            Ok(vault) => {
                if vault_uses_shared_planner(&vault)? {
                    kept.push(vault_str);
                    vaults.push(vault);
                }
            }
            Err(_) => {}
        }
    }
    if kept != previous_paths {
        write_mirror_registry(app, &MirrorRegistry { vault_paths: kept })?;
    }
    Ok(vaults)
}

pub(crate) fn register_mirror_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let vault_str = vault.to_string_lossy().into_owned();
    let mut registry = read_mirror_registry(app)?;
    if !registry.vault_paths.iter().any(|p| p == &vault_str) {
        registry.vault_paths.push(vault_str);
        write_mirror_registry(app, &registry)?;
    }
    Ok(())
}

pub(crate) fn mirror_shared_to_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let shared = shared_planner_dir(app)?;
    let vault_dir = ensure_vault_planner_dir(vault)?;
    copy_planner_tree(&shared, &vault_dir)?;
    write_mirror_state(vault)
}

pub(crate) fn mirror_shared_to_registered_vaults(app: &AppHandle) -> Result<(), String> {
    let shared = shared_planner_dir(app)?;
    if !planner_dir_has_content(&shared) {
        return Ok(());
    }
    let vaults = prune_mirror_registry(app)?;
    let mut errors: Vec<String> = Vec::new();
    for vault in vaults {
        let vault_str = vault.to_string_lossy().into_owned();
        if let Err(e) = mirror_shared_to_vault(app, &vault) {
            errors.push(format!("{vault_str}: {e}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
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

pub(crate) fn shared_planner_is_empty(app: &AppHandle) -> Result<bool, String> {
    let shared = shared_planner_dir(app)?;
    Ok(!planner_dir_has_content(&shared))
}

pub(crate) fn vault_mirror_has_content(vault: &Path) -> bool {
    planner_dir_has_content(&vault_planner_dir(vault))
}

pub(crate) fn after_shared_write(app: &AppHandle, vault: &Path) -> Result<(), String> {
    register_mirror_vault(app, vault)?;
    mirror_shared_to_registered_vaults(app)
}

pub(crate) fn write_files_to_dir(dir: &Path, files: &HashMap<String, String>) -> Result<(), String> {
    for (file_key, json) in files {
        let file = validate_planner_file_key(file_key)?;
        write_planner_json(&dir.join(file), json)?;
    }
    Ok(())
}

