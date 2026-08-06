use super::super::meta::{read_vault_meta, validate_relative_vault_dir};
use super::sanitize::sanitize_name;
use crate::security::{canon_vault, normalize_path, reject_untrusted_webview, safe_resolve};
use crate::state::CurrentVault;
use crate::types::default_image_dir_str;
use std::fs;
use std::path::PathBuf;

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
