//! Per-vault consent stored in app data. A vault's own `.metis` files can
//! suggest a feature, but they cannot approve it.

use crate::security::write_private_json_file;
use crate::settings::app_data_dir_for_build;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
const FILE_NAME: &str = "feature-consent.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConsentFile {
    #[serde(default)]
    supernote_approved: Vec<String>,
    #[serde(default)]
    supernote_declined: Vec<String>,
    #[serde(default)]
    jekyll_exported: HashMap<String, Vec<String>>,
    /// Vaults whose owner turned Restricted Mode off.
    #[serde(default)]
    restricted_unlocked: Vec<String>,
    /// Vaults that stay in Restricted Mode. A vault file cannot change this later.
    #[serde(default)]
    restricted_kept: Vec<String>,
}

fn consent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app)?.join(FILE_NAME))
}

fn load(app: &tauri::AppHandle) -> ConsentFile {
    let Ok(path) = consent_path(app) else {
        return ConsentFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return ConsentFile::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save(app: &tauri::AppHandle, file: &ConsentFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| format!("Cannot save feature consent: {e}"))?;
    write_private_json_file(&consent_path(app)?, &json)
}

pub(crate) fn vault_key(vault: &Path) -> String {
    crate::security::canon_vault(vault)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| vault.to_string_lossy().into_owned())
}

pub(crate) fn supernote_approved(app: &tauri::AppHandle, vault: &Path) -> bool {
    let key = vault_key(vault);
    load(app).supernote_approved.iter().any(|path| path == &key)
}

pub(crate) fn supernote_decision(app: &tauri::AppHandle, vault: &Path) -> Option<bool> {
    let file = load(app);
    let key = vault_key(vault);
    if file.supernote_approved.iter().any(|path| path == &key) {
        return Some(true);
    }
    if file.supernote_declined.iter().any(|path| path == &key) {
        return Some(false);
    }
    None
}

pub(crate) fn set_supernote_consent(app: &tauri::AppHandle, vault: &Path, approved: bool) -> Result<(), String> {
    let mut file = load(app);
    let key = vault_key(vault);
    file.supernote_approved.retain(|path| path != &key);
    file.supernote_declined.retain(|path| path != &key);
    if approved {
        file.supernote_approved.push(key);
    } else {
        file.supernote_declined.push(key);
    }
    save(app, &file)
}

/// `migrate_unlocked` is true only for a full settings object that already says
/// Restricted Mode is off. A bare id list does not unlock.
pub(crate) fn restricted_mode(app: &tauri::AppHandle, vault: &Path, migrate_unlocked: bool) -> bool {
    let key = vault_key(vault);
    let mut file = load(app);
    if file.restricted_unlocked.iter().any(|path| path == &key) {
        return false;
    }
    if file.restricted_kept.iter().any(|path| path == &key) {
        return true;
    }
    if migrate_unlocked {
        file.restricted_unlocked.push(key);
        let _ = save(app, &file);
        return false;
    }
    file.restricted_kept.push(key);
    let _ = save(app, &file);
    true
}

pub(crate) fn set_restricted_mode(
    app: &tauri::AppHandle,
    vault: &Path,
    restricted: bool,
) -> Result<(), String> {
    let mut file = load(app);
    let key = vault_key(vault);
    file.restricted_unlocked.retain(|path| path != &key);
    file.restricted_kept.retain(|path| path != &key);
    if restricted {
        file.restricted_kept.push(key);
    } else {
        file.restricted_unlocked.push(key);
    }
    save(app, &file)
}

pub(crate) fn jekyll_exported(app: &tauri::AppHandle, vault: &Path) -> Vec<String> {
    let key = vault_key(vault);
    load(app).jekyll_exported.get(&key).cloned().unwrap_or_default()
}

pub(crate) fn remember_jekyll_note(app: &tauri::AppHandle, vault: &Path, rel: &str) -> Result<(), String> {
    let rel = rel.trim().replace('\\', "/");
    if rel.is_empty() || rel.len() > 512 || rel.starts_with('/') || rel.split('/').any(|part| part == ".." || part.is_empty()) {
        return Err("Invalid exported note path.".into());
    }
    let mut file = load(app);
    let key = vault_key(vault);
    let list = file.jekyll_exported.entry(key).or_default();
    if !list.iter().any(|path| path == &rel) {
        if list.len() >= 5000 {
            return Err("Jekyll export list is full.".into());
        }
        list.push(rel);
    }
    save(app, &file)
}

