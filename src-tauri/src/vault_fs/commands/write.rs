use super::super::meta::{read_vault_meta, validate_relative_vault_dir};
use super::sanitize::sanitize_name;
use crate::security::{
    canon_vault, create_dir_all_inside_vault, normalize_path, registered_vault,
    reject_untrusted_webview, safe_resolve,
};
use crate::state::CurrentVault;
use crate::types::default_image_dir_str;
use std::fs;
use std::path::{Path, PathBuf};

fn is_markdown_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("md")
}

/// Write `content` to `path`.
///
/// SECURITY: Only allows writing `.md` files within the active vault.
/// Parent directory must already exist — we never silently create directories.
#[tauri::command]
pub fn save_note(
    path: String,
    content: String,
    baseline_mtime_ms: Option<u64>,
    baseline_content_hash: Option<String>,
    must_exist: Option<bool>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<u64, String> {
    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);

    // The requested name must be markdown. A symlink named `note.md` can still
    // point at a non-markdown file, so the resolved path is checked again below.
    if !is_markdown_file(&target) {
        return Err("save_note only accepts .md files".into());
    }

    // SECURITY: fail-closed — require a registered vault for all FS writes.
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("save_note: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("save_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("save_note: path is outside the active vault.".into());
    }
    if !is_markdown_file(&resolved) {
        return Err("save_note only accepts .md files".into());
    }

    if must_exist == Some(true) && !resolved.exists() {
        return Err(format!("NOT_FOUND: {}", resolved.display()));
    }
    if resolved.exists() {
        if let Some(expected) = baseline_content_hash.as_deref() {
            let current = fs::read_to_string(&resolved)
                .map_err(|e| format!("Failed to read note: {e}"))?;
            if note_content_hash(&current) != expected {
                return Err(format!("NOTE_CONFLICT: {}", resolved.display()));
            }
        } else if let Some(baseline) = baseline_mtime_ms {
            let modified = file_mtime_ms(&resolved)?;
            if modified > baseline {
                return Err(format!("NOTE_CONFLICT: {}", resolved.display()));
            }
        }
    }

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }

    crate::io_atomic::write_atomic(&resolved, content.as_bytes())?;
    file_mtime_ms(&resolved)
}

/// Same mix as the editor's `noteContentHash`: 32-bit, over UTF-16 code units.
pub(crate) fn note_content_hash(text: &str) -> String {
    let mut hash: u32 = 5381;
    for unit in text.encode_utf16() {
        hash = hash.wrapping_shl(5).wrapping_add(hash) ^ u32::from(unit);
    }
    format!("{hash:x}")
}

pub(crate) fn file_mtime_ms(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map_err(|e| format!("Failed to read file time: {e}"))?;
    Ok(modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read file time: {e}"))?
        .as_millis() as u64)
}

/// `create` fails when the note already exists. `overwrite` replaces it.
fn parse_write_mode(mode: &str) -> Result<bool, String> {
    match mode {
        "create" => Ok(false),
        "overwrite" => Ok(true),
        _ => Err("agent_write_note: mode must be create or overwrite.".into()),
    }
}

fn is_known_non_markdown_ext(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "txt"
            | "text"
            | "json"
            | "html"
            | "htm"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "pdf"
            | "js"
            | "ts"
            | "css"
            | "yml"
            | "yaml"
            | "xml"
            | "csv"
            | "zip"
            | "svg"
            | "canvas"
    )
}

fn reject_hidden_note_components(relative: &Path) -> Result<(), String> {
    for component in relative.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("agent_write_note: path must not contain '..'.".into());
            }
            std::path::Component::Normal(name) => {
                if name.to_string_lossy().starts_with('.') {
                    return Err("agent_write_note: hidden path segments are not allowed.".into());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Reject `..` and hidden components relative to the vault.
/// A missing extension, or a dotted title that is not a known file type, becomes `.md`.
fn agent_note_target(vault: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.contains('\0') {
        return Err("agent_write_note: invalid path.".into());
    }
    let raw = PathBuf::from(rel_path);
    // Hidden-segment checks use the path relative to the vault. A vault that
    // itself lives under a dot folder (for example ~/.notes/vault) is allowed.
    // An absolute path that does not share the vault's exact prefix is checked
    // again after normalization, so `/tmp` and `/private/tmp` still resolve.
    let prefixed = raw.is_absolute() && raw.starts_with(vault);
    let relative = if prefixed {
        raw.strip_prefix(vault).unwrap_or(Path::new("")).to_path_buf()
    } else if raw.is_absolute() {
        PathBuf::new()
    } else {
        raw.clone()
    };
    reject_hidden_note_components(&relative)?;
    let joined = if raw.is_absolute() {
        raw.clone()
    } else {
        vault.join(&PathBuf::from(rel_path))
    };
    let mut target = normalize_path(&joined)?;
    if raw.is_absolute() && !prefixed {
        if let Ok(rest) = target.strip_prefix(vault) {
            reject_hidden_note_components(rest)?;
        }
    }
    match target.extension().and_then(|ext| ext.to_str()) {
        Some("md") => {}
        Some(ext) if is_known_non_markdown_ext(ext) => {
            return Err("agent_write_note: only .md notes can be written.".into());
        }
        Some(_) => {
            // "Meeting 2026.11.06" is a title, not a file type. Append .md.
            let name = target
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "note".into());
            target.set_file_name(format!("{name}.md"));
        }
        None => {
            target.set_extension("md");
        }
    }
    if !target.starts_with(vault) {
        return Err("Path is outside the active vault.".into());
    }
    Ok(target)
}

/// Write (or create) a note at a vault-relative **or** absolute path.
///
/// Called by the AI agent on the user's behalf when the user explicitly
/// requests a file to be created or modified.
///
/// SECURITY controls:
///  - `..` is rejected per path component, not as a substring.
///  - Hidden components (`.git`, `.metis`, `.obsidian`) are rejected.
///  - Only `.md` is written. A different extension is an error, not a rename.
///  - `mode=create` leaves an existing file untouched.
///  - Parent directories are created if they don't exist (but only within the
///    vault boundary).
///  - Returns the absolute path of the written file so the UI can open / refresh it.
#[tauri::command]
pub fn agent_write_note(
    rel_path: String,
    content: String,
    mode: String,
    baseline_content_hash: Option<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let overwrite = parse_write_mode(&mode)?;
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("agent_write_note: {e}"))?;
    let target = agent_note_target(&canon_v, &rel_path)?;

    if let Some(parent) = target.parent() {
        create_dir_all_inside_vault(parent, &canon_v)?;
    }

    // SECURITY: resolve after directory creation so symlinked parents cannot
    // redirect writes outside the active vault.
    let resolved = safe_resolve(&target).map_err(|e| format!("agent_write_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("agent_write_note: resolved path is outside the active vault.".into());
    }
    if !is_markdown_file(&resolved) {
        return Err("agent_write_note: only .md notes can be written.".into());
    }
    if !overwrite && resolved.exists() {
        return Err(format!(
            "NOTE_EXISTS: {}",
            resolved.to_string_lossy()
        ));
    }
    if overwrite && resolved.is_file() {
        let existing = fs::read_to_string(&resolved).unwrap_or_default();
        let Some(expected) = baseline_content_hash.as_deref().filter(|hash| !hash.is_empty()) else {
            return Err(format!(
                "NOTE_CONFLICT: {}",
                resolved.to_string_lossy()
            ));
        };
        if note_content_hash(&existing) != expected {
            return Err(format!(
                "NOTE_CONFLICT: {}",
                resolved.to_string_lossy()
            ));
        }
    }

    crate::io_atomic::write_atomic(&resolved, content.as_bytes())?;

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
    let canon_trusted = registered_vault(&window, &vault_state)
        .map_err(|e| format!("save_asset: {e}"))?;
    let canon_requested = canon_vault(&PathBuf::from(&vault_path))
        .map_err(|e| format!("save_asset: {e}"))?;
    if canon_requested != canon_trusted {
        return Err("save_asset: vault path does not match the active vault.".into());
    }

    if !canon_trusted.is_dir() {
        return Err(format!("Invalid vault path: {vault_path}"));
    }
    let canon_v = canon_trusted;

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
        None => read_vault_meta(&canon_v)
            .map(|m| m.default_image_dir)
            .unwrap_or_else(|_| default_image_dir_str()),
    };

    let target_dir = canon_v.join(&subdir);
    if !target_dir.exists() {
        create_dir_all_inside_vault(&target_dir, &canon_v)
            .map_err(|e| format!("Failed to create image folder '{subdir}': {e}"))?;
    }
    let resolved_dir = safe_resolve(&target_dir).map_err(|e| format!("save_asset: {e}"))?;
    if !resolved_dir.starts_with(&canon_v) {
        return Err("save_asset: image directory escapes vault boundary.".into());
    }

    let target = resolved_dir.join(&name);
    crate::io_atomic::write_atomic(&target, &data).map_err(|e| format!("Failed to save asset: {e}"))?;

    Ok(format!("{subdir}/{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn symlink_named_md_does_not_count_as_markdown_after_resolve() {
        use std::os::unix::fs::symlink;

        let dir = std::env::temp_dir().join(format!("metis-save-note-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("secret.txt");
        fs::write(&target, b"secret").unwrap();
        let link = dir.join("note.md");
        symlink(&target, &link).unwrap();

        assert!(is_markdown_file(&link));
        let resolved = safe_resolve(&link).unwrap();
        assert!(!is_markdown_file(&resolved));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_note_target_rejects_hidden_segments_and_other_extensions() {
        let vault = PathBuf::from("/tmp/metis-vault");
        assert!(agent_note_target(&vault, "notes/plan.md").is_ok());
        assert!(agent_note_target(&vault, "notes/foo..bar.md").is_ok());
        assert!(agent_note_target(&vault, "notes/plan.txt").is_err());
        assert!(agent_note_target(&vault, ".git/config.md").is_err());
        assert!(agent_note_target(&vault, "notes/../secret.md").is_err());
        let created = agent_note_target(&vault, "notes/plan").unwrap();
        assert_eq!(created.extension().and_then(|ext| ext.to_str()), Some("md"));
        let titled = agent_note_target(&vault, "Meeting 2026.11.06").unwrap();
        assert!(titled.ends_with("Meeting 2026.11.06.md"));
        let dot_vault = PathBuf::from("/tmp/.notes/vault");
        assert!(agent_note_target(&dot_vault, "/tmp/.notes/vault/notes/plan.md").is_ok());
    }
}
