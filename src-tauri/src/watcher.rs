use crate::security::{canon_vault, safe_resolve};
use crate::state::{CurrentVault, WatcherState};
use std::path::PathBuf;
use notify::{RecursiveMode, Watcher};
use tauri::Emitter;

// ── File-system watcher ───────────────────────────────────────────────────────

/// Start (or replace) a recursive watcher on the vault at `path`.
/// Emits a `vault-changed` event to the frontend for structural changes only
/// (create / remove / rename) — content saves do NOT trigger a refresh.
///
/// SECURITY: Validates path is an existing directory before watching.
#[tauri::command]
pub fn set_vault_watch(
    path: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WatcherState>,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    // SECURITY: only allow watching the vault currently registered for this
    // window so arbitrary directories cannot be watched via IPC.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("set_vault_watch: no vault registered for this window.")?
        .clone();
    drop(lock);
    let canon_v = canon_vault(&PathBuf::from(vault_str))
        .map_err(|e| format!("set_vault_watch: {e}"))?;
    let root_resolved = safe_resolve(&root).map_err(|e| format!("set_vault_watch: {e}"))?;
    if root_resolved != canon_v {
        return Err("set_vault_watch: path must match the active vault root.".into());
    }

    let label = window.label().to_string();
    // Clone the window handle so the watcher closure can emit events to THIS
    // window only, keeping each open vault's change-stream isolated.
    let window_clone = window.clone();

    // Only emit for structural changes — avoids a refresh loop when the editor
    // saves note content (those fire Modify(Data) events, not Create/Remove/Rename).
    let mut watcher = notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // In notify v6, renames are Modify(Name(_)); exclude data-only
                // writes so editor autosaves don't trigger a sidebar refresh.
                let structural = matches!(
                    event.kind,
                    notify::EventKind::Create(_)
                        | notify::EventKind::Remove(_)
                        | notify::EventKind::Modify(
                            notify::event::ModifyKind::Name(_)
                        )
                );
                if structural {
                    // Emit only to the specific window that owns this vault.
                    let _ = window_clone.emit("vault-changed", ());
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(&root_resolved, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    // Replace any previous watcher for this window (dropping it stops the old watch).
    state.0.lock().unwrap().insert(label, watcher);

    Ok(())
}
