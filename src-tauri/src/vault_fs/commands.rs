use super::meta::{
    build_file_tree, detect_vault_hint, ensure_default_vault_dirs, is_allowed_ext,
    read_vault_meta, validate_relative_vault_dir, write_vault_meta,
};
use crate::security::{canon_vault, normalize_path, reject_untrusted_webview, safe_resolve};
use crate::state::CurrentVault;
use crate::types::*;
use std::fs;
use std::path::PathBuf;

// ── Tauri commands ────────────────────────────────────────────────────────────

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
    Ok(VaultData {
        path,
        files,
        is_metis_vault,
        vault_hint,
        default_image_dir,
    })
}

/// Write `content` to `path`.
///
/// SECURITY: Only allows writing `.md` files within the active vault.
/// Parent directory must already exist — we never silently create directories.
#[tauri::command]
pub fn save_note(
    path: String,
    content: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);

    // Only allow saving markdown files
    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("save_note only accepts .md files".into());
    }

    // SECURITY: fail-closed — require a registered vault for all FS writes.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("save_note: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("save_note: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("save_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("save_note: path is outside the active vault.".into());
    }

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }

    fs::write(&resolved, content.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))
}

/// Read the full text content of a file at `path`.
///
/// SECURITY: Only allows reading `.md` files within the active vault.
#[tauri::command]
pub fn get_file_content(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);
    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("get_file_content only accepts .md files".into());
    }

    // SECURITY: fail-closed — require a registered vault for all FS reads.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("get_file_content: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_file_content: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("get_file_content: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("get_file_content: path is outside the active vault.".into());
    }
    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved.display()));
    }
    if resolved.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", resolved.display()));
    }

    fs::read_to_string(&resolved).map_err(|e| format!("Failed to read file: {e}"))
}

/// Read a vault image as base-64 for cloud vision OCR.
///
/// SECURITY: Only raster image extensions; path must stay inside the active vault.
/// Rejects payloads that would exceed ~15 MB decoded.
#[tauri::command]
pub fn read_vault_image_base64(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<crate::types::VaultImageBase64, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!(
            "read_vault_image_base64: '.{ext}' is not an allowed image type."
        ));
    }

    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
    .to_string();

    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("read_vault_image_base64: no vault registered for this window.")?
        .clone();
    drop(lock);

    let vault = PathBuf::from(&vault_str);
    let canon_v =
        canon_vault(&vault).map_err(|e| format!("read_vault_image_base64: {e}"))?;
    let resolved =
        safe_resolve(&target).map_err(|e| format!("read_vault_image_base64: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("read_vault_image_base64: path is outside the active vault.".into());
    }
    if !resolved.is_file() {
        return Err(format!("Image not found: {}", resolved.display()));
    }

    const MAX_BYTES: u64 = 15 * 1024 * 1024;
    let meta = fs::metadata(&resolved)
        .map_err(|e| format!("read_vault_image_base64: {e}"))?;
    if meta.len() > MAX_BYTES {
        return Err("Image is too large (max 15 MB).".into());
    }

    let bytes = fs::read(&resolved).map_err(|e| format!("Failed to read image: {e}"))?;
    if bytes.is_empty() {
        return Err("Image file is empty.".into());
    }

    Ok(crate::types::VaultImageBase64 {
        data_base64: STANDARD.encode(bytes),
        mime_type,
    })
}

/// Read many `.md` files in **one** IPC round-trip for vault index enrichment.
///
/// Returns `Vec<String>` parallel to `paths`: each entry is the file body or
/// **empty string** if the path is not `.md`, outside the vault, missing, or
/// unreadable — matching `get_file_content(...).catch(() => "")` on the JS side.
///
/// SECURITY: Same boundary checks as `get_file_content`. At most 100 paths per call.
#[tauri::command]
pub fn get_file_contents_batch(
    paths: Vec<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    if paths.len() > 100 {
        return Err("get_file_contents_batch: at most 100 paths per call.".into());
    }

    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("get_file_contents_batch: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_file_contents_batch: {e}"))?;

    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let target = PathBuf::from(&path);
        if target.extension().and_then(|e| e.to_str()) != Some("md") {
            out.push(String::new());
            continue;
        }

        let resolved = match safe_resolve(&target) {
            Ok(r) => r,
            Err(_) => {
                out.push(String::new());
                continue;
            }
        };
        if !resolved.starts_with(&canon_v) {
            out.push(String::new());
            continue;
        }
        if !resolved.exists() || resolved.is_dir() {
            out.push(String::new());
            continue;
        }

        out.push(fs::read_to_string(&resolved).unwrap_or_default());
    }
    Ok(out)
}

// ── Name sanitisation ─────────────────────────────────────────────────────────

/// Validate that `name` is safe to use as a file or folder name.
///
/// SECURITY controls applied:
///  - Empty / oversized names rejected
///  - Path separators, null bytes, and `..`/`.` components blocked
///  - Windows reserved device names (CON, NUL, COM1 … LPT9) rejected
///    cross-platform so notes created on macOS/Linux are also safe on Windows
pub(crate) fn sanitize_name(name: &str) -> Result<String, String> {
    let s = name.trim().to_string();
    if s.is_empty() {
        return Err("Name cannot be empty.".into());
    }
    if s.len() > 255 {
        return Err("Name is too long (max 255 characters).".into());
    }
    // Block path separators, null bytes, and relative-path components
    if s.contains('/') || s.contains('\\') || s.contains('\0') || s == "." || s == ".." {
        return Err("Name contains invalid characters.".into());
    }
    // Block Windows reserved device names (including with extensions, e.g. NUL.md).
    // These cause silent failures or data loss on Windows even when cross-compiling.
    const WINDOWS_RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    // Compare stem only (strip any extension before comparing)
    let stem_upper = PathBuf::from(&s)
        .file_stem()
        .map(|s| s.to_string_lossy().to_uppercase())
        .unwrap_or_default();
    if WINDOWS_RESERVED.contains(&stem_upper.as_str()) {
        return Err(format!("'{s}' is a reserved system name and cannot be used."));
    }
    Ok(s)
}

// ── Vault & file creation ─────────────────────────────────────────────────────

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

    let vault_path_str = vault.to_string_lossy().to_string();

    // Record the vault path for this window so file-operation commands can
    // enforce the correct vault boundary.
    vault_state.0.lock().unwrap().insert(window.label().to_string(), vault_path_str.clone());

    let files = build_file_tree(&vault).unwrap_or_default();
    Ok(VaultData {
        path: vault_path_str,
        files,
        is_metis_vault: true,
        vault_hint: None,
        default_image_dir: default_image_dir_str(),
    })
}

/// Create a new .md file at `dir_path/<name>.md` with an optional starter body.
///
/// SECURITY: `name` is sanitised; extension is forced to .md; parent must exist and must be
/// inside the active vault (defence-in-depth against a compromised frontend).
#[tauri::command]
pub fn create_note(
    dir_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let mut name = sanitize_name(&name)?;
    // Strip any extension the user typed and force .md
    if let Some(stem) = PathBuf::from(&name).file_stem() {
        name = stem.to_string_lossy().to_string();
    }
    name.push_str(".md");

    let parent = PathBuf::from(&dir_path);
    if !parent.is_dir() {
        return Err(format!("Directory does not exist: {dir_path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("create_note: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("create_note: {e}"))?;
    let resolved_parent = safe_resolve(&parent).map_err(|e| format!("create_note: {e}"))?;
    if !resolved_parent.starts_with(&canon_v) {
        return Err("create_note: directory is outside the active vault.".into());
    }

    let target = resolved_parent.join(&name);
    if target.exists() {
        return Err(format!("'{name}' already exists."));
    }

    let title = name.trim_end_matches(".md");
    let body = format!("# {title}\n\n");
    fs::write(&target, body.as_bytes()).map_err(|e| format!("Failed to create note: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

/// Create a new subfolder at `parent_path/<name>`.
///
/// SECURITY: `name` is sanitised; parent must exist and must be inside the active vault.
#[tauri::command]
pub fn create_folder(
    parent_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let name = sanitize_name(&name)?;
    let parent = PathBuf::from(&parent_path);

    if !parent.is_dir() {
        return Err(format!("Parent is not a valid directory: {parent_path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("create_folder: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("create_folder: {e}"))?;
    let resolved_parent = safe_resolve(&parent).map_err(|e| format!("create_folder: {e}"))?;
    if !resolved_parent.starts_with(&canon_v) {
        return Err("create_folder: directory is outside the active vault.".into());
    }

    let target = resolved_parent.join(&name);
    if target.exists() {
        return Err(format!("'{name}' already exists."));
    }

    fs::create_dir(&target).map_err(|e| format!("Failed to create folder: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

/// Delete a .md file or a vault sub-directory (recursively).
///
/// SECURITY: Vault boundary is enforced from server-side `CurrentVault` state so the
/// frontend cannot manipulate the boundary by passing a crafted `vault_path`.
/// Files must be within the vault and have an allowed extension; directories are
/// removed recursively only after confirming they are not the vault root.
#[tauri::command]
pub fn delete_path(
    path: String,
    #[allow(unused_variables)]
    vault_path: String, // kept for IPC compat; ignored in favour of server-side state
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);

    // SECURITY: fail-closed — never trust the frontend-supplied vault_path.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("delete_path: no vault registered for this window.")?;

    let vault = PathBuf::from(&trusted_vault_path);

    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let canon_v = canon_vault(&vault).map_err(|e| format!("delete_path: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("delete_path: {e}"))?;

    if resolved == canon_v {
        return Err("Cannot delete the vault root directory.".into());
    }
    if !resolved.starts_with(&canon_v) {
        return Err("Cannot delete files outside the vault.".into());
    }

    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).map_err(|e| format!("Failed to delete folder: {e}"))
    } else {
        if !is_allowed_ext(&resolved) {
            let ext = resolved.extension().and_then(|e| e.to_str()).unwrap_or("");
            return Err(format!("Deleting '.{ext}' files is not permitted."));
        }
        fs::remove_file(&resolved).map_err(|e| format!("Failed to delete file: {e}"))
    }
}

/// Move `src` into `dest_dir` (keeping its original filename).
///
/// SECURITY: Vault boundary is enforced from server-side `CurrentVault` state.
/// Validates that both source and destination are inside the active vault, and
/// prevents moving a folder into one of its own descendants.
#[tauri::command]
pub fn move_path(
    src: String,
    dest_dir: String,
    #[allow(unused_variables)]
    vault_path: String, // kept for IPC compat; ignored in favour of server-side state
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dest_dir_path = PathBuf::from(&dest_dir);

    // SECURITY: fail-closed — never trust the frontend-supplied vault_path.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("move_path: no vault registered for this window.")?;

    let vault = PathBuf::from(&trusted_vault_path);

    if !src_path.exists() {
        return Err(format!("Source does not exist: {src}"));
    }
    if !dest_dir_path.is_dir() {
        return Err(format!("Destination is not a directory: {dest_dir}"));
    }

    let canon_v = canon_vault(&vault).map_err(|e| format!("move_path: {e}"))?;
    let resolved_src = safe_resolve(&src_path).map_err(|e| format!("move_path: {e}"))?;
    let resolved_dest = safe_resolve(&dest_dir_path).map_err(|e| format!("move_path: {e}"))?;

    if !resolved_src.starts_with(&canon_v) {
        return Err("Source is outside the vault.".into());
    }
    if !resolved_dest.starts_with(&canon_v) {
        return Err("Destination is outside the vault.".into());
    }
    if resolved_dest.starts_with(&resolved_src) {
        return Err("Cannot move a folder into itself or one of its subfolders.".into());
    }
    if resolved_src.parent() == Some(resolved_dest.as_path()) {
        return Ok(src);
    }

    let filename = resolved_src.file_name().ok_or("Invalid source path.")?;
    let dest_path = resolved_dest.join(filename);

    if dest_path.exists() {
        return Err(format!(
            "'{}' already exists in the destination folder.",
            filename.to_string_lossy()
        ));
    }

    fs::rename(&resolved_src, &dest_path).map_err(|e| format!("Failed to move: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string())
}

/// Rename a file or folder within the same parent directory.
///
/// SECURITY: `new_name` is sanitised; `path` must be inside the active vault;
/// the operation cannot move files across directories.
#[tauri::command]
pub fn rename_path(
    path: String,
    new_name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let mut new_name = sanitize_name(&new_name)?;
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("rename_path: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("rename_path: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("rename_path: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("rename_path: path is outside the active vault.".into());
    }

    if resolved.is_file() {
        if let Some(stem) = PathBuf::from(&new_name).file_stem() {
            new_name = stem.to_string_lossy().to_string();
        }
        new_name.push_str(".md");
    }

    let parent = resolved.parent().ok_or("Cannot determine parent directory.")?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("'{new_name}' already exists."));
    }

    fs::rename(&resolved, &new_path).map_err(|e| format!("Failed to rename: {e}"))?;

    Ok(new_path.to_string_lossy().to_string())
}

/// Write (or create) a note at a vault-relative **or** absolute path.
///
/// Called by the AI agent on the user's behalf when the user explicitly
/// requests a file to be created or modified.
///
/// SECURITY controls:
///  - Path is normalised to resolve `..` before the vault-boundary check.
///  - Absolute paths that escape the vault are rejected.
///  - Relative paths are joined against the vault root — they can never
///    escape the vault boundary after normalisation.
///  - `.md` extension is enforced.
///  - Parent directories are created if they don't exist (but only within the
///    vault boundary).
///  - Returns the absolute path of the written file so the UI can open / refresh it.
#[tauri::command]
pub fn agent_write_note(
    rel_path: String,
    content: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    if rel_path.contains("..") {
        return Err("agent_write_note: path must not contain '..'.".into());
    }
    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("agent_write_note: {e}"))?;

    let raw = PathBuf::from(&rel_path);
    let joined = if raw.is_absolute() { raw } else { canon_v.join(&raw) };

    let mut target = normalize_path(&joined)?;

    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        target.set_extension("md");
    }

    if !target.starts_with(&canon_v) {
        return Err("Path is outside the active vault.".into());
    }

    // Create parent directories within the vault (idempotent, safe)
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    // SECURITY: resolve after directory creation so symlinked parents cannot
    // redirect writes outside the active vault.
    let resolved = safe_resolve(&target).map_err(|e| format!("agent_write_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("agent_write_note: resolved path is outside the active vault.".into());
    }

    fs::write(&resolved, content.as_bytes())
        .map_err(|e| format!("Failed to write note: {e}"))?;

    Ok(resolved.to_string_lossy().to_string())
}

// ── Asset saving (clipboard image paste) ─────────────────────────────────────

/// Decode a base-64 image string and write it to `<vault_path>/assets/<filename>`.
/// Returns the relative path used in Markdown image syntax, e.g. `assets/image.png`.
///
/// SECURITY: Extension is validated against an image allowlist; filename is
/// sanitised to prevent path traversal; base-64 data is decoded before writing.
/// The vault path is validated against server-side `CurrentVault` state so the
/// frontend cannot redirect asset writes to arbitrary filesystem locations.
#[tauri::command]
pub fn save_asset(
    vault_path: String,
    filename: String,
    data_base64: String,
    image_subdir: Option<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    reject_untrusted_webview(&window)?;
    // SECURITY: fail-closed — require a registered vault and verify it matches.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("save_asset: no vault registered for this window.")?;

    let requested_vault = PathBuf::from(&vault_path);
    let trusted_vault = PathBuf::from(&trusted_vault_path);
    let canon_requested = canon_vault(&requested_vault)
        .map_err(|e| format!("save_asset: {e}"))?;
    let canon_trusted = canon_vault(&trusted_vault)
        .map_err(|e| format!("save_asset: {e}"))?;
    if canon_requested != canon_trusted {
        return Err("save_asset: vault path does not match the active vault.".into());
    }

    let vault = PathBuf::from(&trusted_vault_path);
    if !vault.is_dir() {
        return Err(format!("Invalid vault path: {vault_path}"));
    }
    let canon_v = canon_vault(&vault).map_err(|e| format!("save_asset: {e}"))?;

    // Sanitise the filename and validate image extension
    let name = sanitize_name(&filename)?;
    let ext = PathBuf::from(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // SECURITY: SVG excluded — can embed scripts when served via asset://
    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("'.{ext}' is not an allowed image extension."));
    }

    // SECURITY: reject payloads whose base-64 encoding exceeds ~50 MB
    // (decoded ≈ 37.5 MB) to prevent memory exhaustion / disk fill.
    const MAX_BASE64_LEN: usize = 50 * 1024 * 1024;
    if data_base64.len() > MAX_BASE64_LEN {
        return Err("Asset is too large (max ~50 MB).".into());
    }

    let data = STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    if data.is_empty() {
        return Err("Image data is empty.".into());
    }

    let subdir = match image_subdir {
        Some(s) => validate_relative_vault_dir(&s)?,
        None => read_vault_meta(&vault)
            .map(|m| m.default_image_dir)
            .unwrap_or_else(|_| default_image_dir_str()),
    };

    let target_dir = canon_v.join(&subdir);
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create image folder '{subdir}': {e}"))?;
    }
    let resolved_dir = safe_resolve(&target_dir).map_err(|e| format!("save_asset: {e}"))?;
    if !resolved_dir.starts_with(&canon_v) {
        return Err("save_asset: image directory escapes vault boundary.".into());
    }

    let target = resolved_dir.join(&name);
    fs::write(&target, &data)
        .map_err(|e| format!("Failed to save asset: {e}"))?;

    Ok(format!("{subdir}/{name}"))
}
