use super::super::meta::{
    build_file_tree, detect_vault_hint, ensure_default_vault_dirs, read_vault_meta,
    write_vault_meta, write_vault_meta_full,
};
use super::sanitize::sanitize_name;
use crate::security::reject_untrusted_webview;
use crate::state::CurrentVault;
use crate::types::*;
use std::fs;
use std::path::PathBuf;

/// Receive the vault root path (chosen by the frontend folder-picker dialog),
/// walk the directory tree, and return the structured file list.
///
/// SECURITY: `path` is validated to be an existing directory before use.
/// Records the vault in `CurrentVault` so later file-operation commands can
/// enforce the vault boundary without trusting the frontend to pass it each time.
#[tauri::command]
pub fn open_vault(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    reject_untrusted_webview(&window)?;
    let root = PathBuf::from(&path);

    if !root.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    // Detect whether this is already a Metis vault by looking for the marker.
    let has_marker = root.join(".metis").join("vault.json").exists();

    // Migration heuristic: vaults that were created by Metis before the marker
    // feature was introduced won't have `.metis/vault.json`, but they will have
    // the characteristic `daily/` and `meetings/` folder structure.  Silently
    // write the marker so they are recognised as Metis vaults from now on,
    // without showing the conversion prompt to the user.
    let looks_like_metis = !has_marker
        && root.join("daily").is_dir()
        && root.join("meetings").is_dir();

    if looks_like_metis {
        let _ = write_vault_meta(&root);
    }

    let is_metis_vault = has_marker || looks_like_metis;

    let vault_hint = if is_metis_vault {
        // For Metis vaults, idempotently re-create any missing default folders.
        ensure_default_vault_dirs(&root);
        None
    } else {
        // For foreign vaults, leave the directory structure untouched and
        // identify the originating tool so the frontend can show an informative
        // conversion prompt.
        Some(detect_vault_hint(&root))
    };

    // Record the vault path for this specific window so file-operation commands
    // can enforce the correct vault boundary per-window.
    vault_state.0.lock().unwrap().insert(window.label().to_string(), path.clone());

    let files = build_file_tree(&root)?;
    let default_image_dir = read_vault_meta(&root)
        .map(|m| m.default_image_dir)
        .unwrap_or_else(|_| default_image_dir_str());
    let vault_meta = read_vault_meta(&root).unwrap_or_else(|_| VaultMeta {
        version: "1".into(),
        name: root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Vault")
            .to_string(),
        created_at_unix: 0,
        metis_version: env!("CARGO_PKG_VERSION").into(),
        default_image_dir: default_image_dir_str(),
        planner_mode: None,
        planner_setup_required: false,
    });
    Ok(VaultData {
        path,
        files,
        is_metis_vault,
        vault_hint,
        default_image_dir,
        planner_mode: vault_meta.planner_mode,
        planner_setup_required: vault_meta.planner_setup_required,
    })
}

/// Create a new vault folder at `parent_path/<name>` and return it as a VaultData.
///
/// SECURITY: `name` is sanitised; parent must exist and be a directory.
/// Records the new vault in `CurrentVault` after creation.
#[tauri::command]
pub fn create_vault(
    parent_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    let name = sanitize_name(&name)?;
    let parent = PathBuf::from(&parent_path);

    if !parent.is_dir() {
        return Err(format!("Parent is not a valid directory: {parent_path}"));
    }

    let vault = parent.join(&name);
    if vault.exists() {
        return Err(format!("'{name}' already exists in that location."));
    }

    fs::create_dir(&vault).map_err(|e| format!("Failed to create vault: {e}"))?;

    // Create default folder structure — errors are intentionally ignored so a
    // partially-created vault (e.g. permission edge-case) still opens cleanly.
    ensure_default_vault_dirs(&vault);

    // Write the Metis vault marker so `open_vault` recognises this as a Metis
    // vault on every subsequent open.  Failure is non-fatal — the vault works
    // normally; the user would just see the conversion prompt next time.
    let _ = write_vault_meta(&vault);
    if let Ok(mut meta) = read_vault_meta(&vault) {
        meta.planner_setup_required = true;
        let _ = write_vault_meta_full(&vault, &meta);
    }

    let vault_path_str = vault.to_string_lossy().to_string();

    // Record the vault path for this window so file-operation commands can
    // enforce the correct vault boundary.
    vault_state.0.lock().unwrap().insert(window.label().to_string(), vault_path_str.clone());

    let files = build_file_tree(&vault).unwrap_or_default();
    let vault_meta = read_vault_meta(&vault).unwrap_or_else(|_| VaultMeta {
        version: "1".into(),
        name: name.clone(),
        created_at_unix: 0,
        metis_version: env!("CARGO_PKG_VERSION").into(),
        default_image_dir: default_image_dir_str(),
        planner_mode: None,
        planner_setup_required: true,
    });
    Ok(VaultData {
        path: vault_path_str,
        files,
        is_metis_vault: true,
        vault_hint: None,
        default_image_dir: default_image_dir_str(),
        planner_mode: vault_meta.planner_mode,
        planner_setup_required: vault_meta.planner_setup_required,
    })
}
