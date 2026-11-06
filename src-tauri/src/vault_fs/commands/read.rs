use crate::security::{registered_vault, reject_untrusted_webview, safe_resolve};
use crate::state::CurrentVault;
use std::fs;
use std::path::PathBuf;

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
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("get_file_content: {e}"))?;
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

/// Modification time of a vault note, in milliseconds since the Unix epoch.
#[tauri::command]
pub fn note_file_stamp(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<u64, String> {
    reject_untrusted_webview(&window)?;
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("note_file_stamp: {e}"))?;
    let resolved = safe_resolve(&PathBuf::from(&path)).map_err(|e| format!("note_file_stamp: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("note_file_stamp: path is outside the active vault.".into());
    }
    super::write::file_mtime_ms(&resolved)
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

    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("read_vault_image_base64: {e}"))?;
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
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    reject_untrusted_webview(&window)?;
    if paths.len() > 100 {
        return Err("get_file_contents_batch: at most 100 paths per call.".into());
    }

    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("get_file_contents_batch: {e}"))?;
    let blocked = crate::ai_context::never_send_folders(&app, &canon_v);

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
        if resolved
            .strip_prefix(&canon_v)
            .ok()
            .is_some_and(|rel| crate::ai_context::is_never_send(&rel.to_string_lossy(), &blocked))
        {
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
