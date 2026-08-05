use crate::security::{canon_vault, reject_untrusted_webview};
use crate::vault_fs::{read_vault_meta, write_vault_meta_full};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

use super::storage::*;
use super::types::*;

#[tauri::command]
pub fn planner_get_config(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerConfig, String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    let active = active_planner_dir(&app, &vault, &mode)?;
    let mirror = vault_planner_dir(&vault);
    let mirror_last_synced_unix = read_mirror_state(&vault).map(|s| s.last_synced_unix);
    Ok(PlannerConfig {
        mode,
        setup_required: meta.planner_setup_required,
        active_dir: active.to_string_lossy().into_owned(),
        mirror_dir: mirror.to_string_lossy().into_owned(),
        mirror_last_synced_unix,
    })
}

#[tauri::command]
pub fn planner_get_mirror_status(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerMirrorStatus, String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    let registered_vault_count = shared_registry_vault_paths(&app)?.len();
    Ok(PlannerMirrorStatus {
        mode,
        mirror_dir: vault_planner_dir(&vault).to_string_lossy().into_owned(),
        mirror_last_synced_unix: read_mirror_state(&vault).map(|s| s.last_synced_unix),
        registered_vault_count,
    })
}

#[tauri::command]
pub fn planner_check_restore(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerRestoreCheck, String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    if mode != "shared" {
        return Ok(PlannerRestoreCheck {
            offer_restore: false,
            vault_mirror_has_data: false,
            shared_empty: false,
        });
    }
    let shared_empty = shared_planner_is_empty(&app)?;
    let vault_mirror_has_data = vault_mirror_has_content(&vault);
    Ok(PlannerRestoreCheck {
        offer_restore: shared_empty && vault_mirror_has_data,
        vault_mirror_has_data,
        shared_empty,
    })
}

#[tauri::command]
pub fn planner_restore_shared_from_vault(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    if resolve_effective_mode(&meta) != "shared" {
        return Err("Restore is only available in shared planner mode.".into());
    }
    if !vault_mirror_has_content(&vault) {
        return Err("This vault has no planner backup to restore.".into());
    }
    let shared = shared_planner_dir(&app)?;
    copy_planner_tree(&vault_planner_dir(&vault), &shared)?;
    after_shared_write(&app, &vault)
}

#[tauri::command]
pub fn planner_sync_shared_mirror(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    if resolve_effective_mode(&meta) != "shared" {
        return Ok(());
    }
    register_mirror_vault(&app, &vault)?;
    mirror_shared_to_registered_vaults(&app)
}

#[tauri::command]
pub fn planner_set_vault_mode(
    vault_path: String,
    mode: String,
    seed_from_shared: bool,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerConfig, String> {
    reject_untrusted_webview(&window)?;
    if mode != "shared" && mode != "vault" {
        return Err("Planner mode must be 'shared' or 'vault'.".into());
    }
    let vault = canon_vault(Path::new(&vault_path))?;
    let mut meta = read_vault_meta(&vault)?;
    meta.planner_mode = Some(mode.clone());
    meta.planner_setup_required = false;
    write_vault_meta_full(&vault, &meta)?;

    if mode == "vault" {
        unregister_mirror_vault(&app, &vault)?;
        if seed_from_shared {
            let shared = shared_planner_dir(&app)?;
            let vault_dir = ensure_vault_planner_dir(&vault)?;
            copy_planner_tree(&shared, &vault_dir)?;
        }
    } else if mode == "shared" {
        register_mirror_vault(&app, &vault)?;
        if let Err(e) = mirror_shared_to_registered_vaults(&app) {
            eprintln!("[planner] mirror after mode switch: {e}");
        }
    }

    planner_get_config(vault_path, app, window)
}

#[tauri::command]
pub fn planner_load_file(
    vault_path: String,
    file_key: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    reject_untrusted_webview(&window)?;
    let file = validate_planner_file_key(&file_key)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    let dir = active_planner_dir(&app, &vault, &mode)?;
    read_planner_json(&dir.join(file))
}

#[tauri::command]
pub fn planner_save_files(
    vault_path: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PlannerSaveResult, String> {
    reject_untrusted_webview(&window)?;
    if files.is_empty() {
        return Ok(PlannerSaveResult { mirror_error: None });
    }
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    let dir = active_planner_dir(&app, &vault, &mode)?;
    write_files_to_dir(&dir, &files)?;

    let mut mirror_error = None;
    if mode == "shared" {
        register_mirror_vault(&app, &vault)?;
        if let Err(e) = mirror_shared_to_registered_vaults(&app) {
            mirror_error = Some(e);
        }
    }
    Ok(PlannerSaveResult { mirror_error })
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
    let _ = planner_save_files(vault_path, files, app, window)?;
    Ok(())
}

#[tauri::command]
pub fn planner_import_bundle(
    vault_path: String,
    target: String,
    files: HashMap<String, String>,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    if target != "shared" && target != "vault" {
        return Err("Import target must be 'shared' or 'vault'.".into());
    }
    let vault = canon_vault(Path::new(&vault_path))?;
    let dir = if target == "vault" {
        ensure_vault_planner_dir(&vault)?
    } else {
        shared_planner_dir(&app)?
    };

    write_files_to_dir(&dir, &files)?;

    if target == "shared" {
        after_shared_write(&app, &vault)?;
    }
    Ok(())
}

#[tauri::command]
pub fn planner_copy_vault_to_shared(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let vault_dir = vault_planner_dir(&vault);
    if !planner_dir_has_content(&vault_dir) {
        return Err("This vault has no vault-scoped planner data to copy.".into());
    }
    let shared = shared_planner_dir(&app)?;
    copy_planner_tree(&vault_dir, &shared)?;
    after_shared_write(&app, &vault)
}

#[tauri::command]
pub fn planner_copy_shared_to_vault(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    if resolve_effective_mode(&meta) != "shared" {
        return Err("Copy shared → vault is only available when this vault uses shared planner mode.".into());
    }
    register_mirror_vault(&app, &vault)?;
    mirror_shared_to_vault(&app, &vault)
}

#[tauri::command]
pub fn get_planner_storage_dir(
    vault_path: String,
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let vault = canon_vault(Path::new(&vault_path))?;
    let meta = read_vault_meta(&vault)?;
    let mode = resolve_effective_mode(&meta);
    let dir = active_planner_dir(&app, &vault, &mode)?;
    Ok(dir.to_string_lossy().into_owned())
}
