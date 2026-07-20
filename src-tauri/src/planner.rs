use crate::security::{canon_vault, reject_untrusted_webview, write_private_json_file};
use crate::settings::app_data_dir_for_build;
use crate::types::VaultMeta;
use crate::vault_fs::{read_vault_meta, write_vault_meta_full};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const PLANNER_MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
const MIRROR_REGISTRY_FILE: &str = "mirror-registry.json";

pub const PLANNER_FILE_MANIFEST: &str = "manifest.json";
pub const PLANNER_FILE_TEMPLATES: &str = "templates.json";
pub const PLANNER_FILE_LAYOUT: &str = "layout-templates.json";
pub const PLANNER_FILE_GOALS: &str = "goals.json";
pub const PLANNER_FILE_REVIEWS: &str = "reviews.json";
pub const PLANNER_FILE_FIELD_HEIGHTS: &str = "field-heights.json";
pub const PLANNER_FILE_MIRROR_STATE: &str = "mirror-state.json";

const PLANNER_FILES: &[&str] = &[
    PLANNER_FILE_MANIFEST,
    PLANNER_FILE_TEMPLATES,
    PLANNER_FILE_LAYOUT,
    PLANNER_FILE_GOALS,
    PLANNER_FILE_REVIEWS,
    PLANNER_FILE_FIELD_HEIGHTS,
];

#[derive(Serialize, Deserialize, Default)]
struct MirrorRegistry {
    vault_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct MirrorState {
    last_synced_unix: u64,
    source: String,
    read_only: bool,
}

#[derive(Serialize)]
pub struct PlannerSaveResult {
    pub mirror_error: Option<String>,
}

#[derive(Serialize)]
pub struct PlannerConfig {
    pub mode: String,
    pub setup_required: bool,
    pub active_dir: String,
    pub mirror_dir: String,
    pub mirror_last_synced_unix: Option<u64>,
}

#[derive(Serialize)]
pub struct PlannerMirrorStatus {
    pub mode: String,
    pub mirror_dir: String,
    pub mirror_last_synced_unix: Option<u64>,
    pub registered_vault_count: usize,
}

#[derive(Serialize)]
pub struct PlannerRestoreCheck {
    pub offer_restore: bool,
    pub vault_mirror_has_data: bool,
    pub shared_empty: bool,
}

fn validate_planner_file_key(file_key: &str) -> Result<&'static str, String> {
    PLANNER_FILES
        .iter()
        .find(|name| **name == file_key)
        .copied()
        .ok_or_else(|| format!("Unknown planner file key: {file_key}"))
}

fn shared_planner_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir_for_build(app)?.join("planner");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create shared planner dir: {e}"))?;
    Ok(dir)
}

fn vault_planner_dir(vault: &Path) -> PathBuf {
    vault.join(".metis").join("planner")
}

fn ensure_vault_planner_dir(vault: &Path) -> Result<PathBuf, String> {
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

fn read_planner_json(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read planner file: {e}"))?;
    if raw.len() > PLANNER_MAX_JSON_BYTES {
        return Err("Planner file too large.".into());
    }
    Ok(Some(raw))
}

fn resolve_effective_mode(meta: &VaultMeta) -> String {
    meta.planner_mode
        .clone()
        .filter(|m| m == "shared" || m == "vault")
        .unwrap_or_else(|| "shared".into())
}

fn active_planner_dir(app: &AppHandle, vault: &Path, mode: &str) -> Result<PathBuf, String> {
    match mode {
        "vault" => ensure_vault_planner_dir(vault),
        _ => shared_planner_dir(app),
    }
}

fn copy_planner_tree(from: &Path, to: &Path) -> Result<(), String> {
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

fn read_mirror_state(vault: &Path) -> Option<MirrorState> {
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

fn unregister_mirror_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let vault_str = vault.to_string_lossy().into_owned();
    let mut registry = read_mirror_registry(app)?;
    let before = registry.vault_paths.len();
    registry.vault_paths.retain(|p| p != &vault_str);
    if registry.vault_paths.len() != before {
        write_mirror_registry(app, &registry)?;
    }
    Ok(())
}

fn shared_registry_vault_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
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

fn register_mirror_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let vault_str = vault.to_string_lossy().into_owned();
    let mut registry = read_mirror_registry(app)?;
    if !registry.vault_paths.iter().any(|p| p == &vault_str) {
        registry.vault_paths.push(vault_str);
        write_mirror_registry(app, &registry)?;
    }
    Ok(())
}

fn mirror_shared_to_vault(app: &AppHandle, vault: &Path) -> Result<(), String> {
    let shared = shared_planner_dir(app)?;
    let vault_dir = ensure_vault_planner_dir(vault)?;
    copy_planner_tree(&shared, &vault_dir)?;
    write_mirror_state(vault)
}

fn mirror_shared_to_registered_vaults(app: &AppHandle) -> Result<(), String> {
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

fn planner_dir_has_content(dir: &Path) -> bool {
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

fn shared_planner_is_empty(app: &AppHandle) -> Result<bool, String> {
    let shared = shared_planner_dir(app)?;
    Ok(!planner_dir_has_content(&shared))
}

fn vault_mirror_has_content(vault: &Path) -> bool {
    planner_dir_has_content(&vault_planner_dir(vault))
}

fn after_shared_write(app: &AppHandle, vault: &Path) -> Result<(), String> {
    register_mirror_vault(app, vault)?;
    mirror_shared_to_registered_vaults(app)
}

fn write_files_to_dir(dir: &Path, files: &HashMap<String, String>) -> Result<(), String> {
    for (file_key, json) in files {
        let file = validate_planner_file_key(file_key)?;
        write_planner_json(&dir.join(file), json)?;
    }
    Ok(())
}

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
