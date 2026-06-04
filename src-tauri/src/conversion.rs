use crate::security::reject_untrusted_webview;
use crate::types::{ConvertProgress, default_image_dir_str};
use crate::security::{canon_vault, safe_resolve};
use crate::state::CurrentVault;
use crate::types::VaultData;
use crate::vault_fs::{
    build_file_tree, collect_md_files, read_vault_meta, enrich_frontmatter, ensure_default_vault_dirs, write_vault_meta,
};
use std::fs;
use std::path::PathBuf;
use tauri::Emitter;

// ── Vault conversion ──────────────────────────────────────────────────────────

/// Convert a foreign (non-Metis) markdown vault to a Metis vault by:
///   1. Writing the `.metis/vault.json` identification marker
///   2. Creating the default folder structure (`daily`, `meetings`, `summaries`, `assets`)
///   3. Optionally enriching every `.md` file's frontmatter with `parent` (derived
///      from its containing folder) and `date` (from filesystem ctime or today).
///      Only fields that are absent in the existing frontmatter are injected;
///      no existing metadata is ever overwritten.  No `status` is set by default.
///
/// Progress is reported via `convert-vault-progress` Tauri events so the
/// frontend can display a live progress bar without blocking the UI thread.
///
/// SECURITY: `vault_path` is validated to be an existing directory.  The
/// helper `enrich_frontmatter` never overwrites fields already present in a
/// note's frontmatter, preventing accidental data loss.
#[tauri::command]
pub fn convert_vault_to_metis(
    vault_path: String,
    add_metadata: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    reject_untrusted_webview(&window)?;
    let requested_root = PathBuf::from(&vault_path);
    if !requested_root.exists() {
        return Err(format!("Path does not exist: {vault_path}"));
    }
    if !requested_root.is_dir() {
        return Err(format!("Path is not a directory: {vault_path}"));
    }

    // SECURITY: fail-closed conversion boundary.
    // Conversion mutates the vault folder, so it must be bound to the currently
    // registered vault for this window (same trust model as other mutating
    // commands). We compare canonical paths to block alias/symlink tricks.
    let lock = vault_state.0.lock().unwrap();
    let active_vault = lock
        .get(window.label())
        .ok_or("convert_vault_to_metis: no vault registered for this window.")?
        .clone();
    drop(lock);

    let active_canon = canon_vault(&PathBuf::from(&active_vault))
        .map_err(|e| format!("convert_vault_to_metis: {e}"))?;
    let requested_canon =
        safe_resolve(&requested_root).map_err(|e| format!("convert_vault_to_metis: {e}"))?;
    if requested_canon != active_canon {
        return Err("convert_vault_to_metis: requested path does not match active vault.".into());
    }
    let root = requested_canon;

    // Collect .md files upfront so we know the total for accurate progress.
    let md_files: Vec<PathBuf> = if add_metadata {
        collect_md_files(&root)
    } else {
        vec![]
    };

    // Total steps: marker + folders + (optionally) one step per .md file + finalise
    let total = 2 + md_files.len() + 1;
    let mut current = 0usize;

    let emit = |step: &str, cur: usize| {
        let _ = window.emit(
            "convert-vault-progress",
            ConvertProgress {
                step: step.to_string(),
                current: cur,
                total,
            },
        );
    };

    // ── Step 1: Write vault marker ────────────────────────────────────────────
    emit("Writing vault marker…", current);
    write_vault_meta(&root)?;
    current += 1;

    // ── Step 2: Create default folder structure ───────────────────────────────
    emit("Creating default folders…", current);
    ensure_default_vault_dirs(&root);
    current += 1;

    // ── Steps 3..N: Enrich frontmatter ───────────────────────────────────────
    for file_path in &md_files {
        let display_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("note.md");
        emit(&format!("Updating metadata: {display_name}"), current);

        if let Ok(content) = fs::read_to_string(file_path) {
            let updated = enrich_frontmatter(&content, file_path, &root);
            // Only write back if the content actually changed
            if updated != content {
                let _ = fs::write(file_path, updated.as_bytes());
            }
        }
        current += 1;
    }

    // ── Final step: Build tree ────────────────────────────────────────────────
    emit("Finalising…", current);

    // Register the converted vault for this window's vault-boundary enforcement
    vault_state
        .0
        .lock()
        .unwrap()
        .insert(window.label().to_string(), root.to_string_lossy().to_string());

    let files = build_file_tree(&root)?;
    Ok(VaultData {
        path: root.to_string_lossy().to_string(),
        files,
        is_metis_vault: true,
        vault_hint: None,
        default_image_dir: read_vault_meta(&root)
            .map(|m| m.default_image_dir)
            .unwrap_or_else(|_| default_image_dir_str()),
    })
}
