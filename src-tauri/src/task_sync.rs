//! Last task-sync snapshot for the open vault. Stored under `.metis/` so a
//! later sync can tell a source-note edit from a todo.md edit.

use crate::io_atomic::write_atomic;
use crate::security::{registered_vault, reject_untrusted_webview};
use crate::state::CurrentVault;
use std::fs;
use std::path::Path;

const MAX_BYTES: usize = 512 * 1024;

fn snapshot_path(vault: &Path) -> std::path::PathBuf {
    vault.join(".metis").join("task-sync.json")
}

#[tauri::command]
pub fn load_task_sync_snapshot(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let vault = registered_vault(&window, &vault_state)?;
    let path = snapshot_path(&vault);
    if !path.exists() {
        return Ok("{\"tasks\":[]}".into());
    }
    if fs::symlink_metadata(&path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(true)
    {
        return Err("Task sync snapshot is a link.".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read task sync snapshot: {e}"))?;
    if raw.len() > MAX_BYTES {
        return Err("Task sync snapshot is too large.".into());
    }
    Ok(raw)
}

#[tauri::command]
pub fn save_task_sync_snapshot(
    json: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    if json.len() > MAX_BYTES {
        return Err("Task sync snapshot is too large.".into());
    }
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Task sync snapshot is not JSON: {e}"))?;
    let vault = registered_vault(&window, &vault_state)?;
    let path = snapshot_path(&vault);
    if path.exists()
        && fs::symlink_metadata(&path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(true)
    {
        return Err("Task sync snapshot is a link.".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create .metis: {e}"))?;
    }
    write_atomic(&path, json.as_bytes()).map_err(|e| format!("Cannot write task sync snapshot: {e}"))
}
