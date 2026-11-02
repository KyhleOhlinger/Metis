use crate::state::CurrentVault;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Vault path string registered for this window, before canonicalization.
///
/// SECURITY: Help webview is rejected. Callers that compare a client-supplied
/// path to the stored string use this. Path checks use [`registered_vault`].
pub(crate) fn registered_vault_raw(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(window)?;
    let lock = vault_state.0.lock().unwrap();
    lock.get(window.label())
        .cloned()
        .ok_or_else(|| "No vault registered for this window.".into())
}

/// Vault registered for this window, canonicalized.
///
/// SECURITY: Help webview is rejected. Callers still check that target paths
/// stay inside the returned directory.
pub(crate) fn registered_vault(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    let vault_str = registered_vault_raw(window, vault_state)?;
    canon_vault(Path::new(&vault_str))
}

/// Help webview must not invoke vault or settings IPC (defense in depth with capabilities).
pub fn reject_untrusted_webview(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "metis-help" {
        return Err("This command is not available from the help window.".into());
    }
    Ok(())
}

const MAX_PERSISTED_JSON_BYTES: usize = 2 * 1024 * 1024;

/// Write app-data JSON with size cap and owner-only permissions on Unix.
pub fn write_private_json_file(path: &Path, json: &str) -> Result<(), String> {
    write_private_json_file_capped(path, json, MAX_PERSISTED_JSON_BYTES)
}

/// Same as [`write_private_json_file`] with a caller-chosen byte cap.
/// Used for agent-run transcripts, which are larger than settings/personas JSON.
pub fn write_private_json_file_capped(
    path: &Path,
    json: &str,
    max_bytes: usize,
) -> Result<(), String> {
    if json.len() > max_bytes {
        return Err("Payload too large.".into());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
        }
    }
    // SECURITY: create owner-only. chmod afterwards covers a file that already existed.
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file
            .metadata()
            .map_err(|e| format!("Failed to set file permissions: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)
            .map_err(|e| format!("Failed to set file permissions: {e}"))?;
    }
    Ok(())
}

/// Create `dir` only when every existing ancestor canonicalizes inside `vault`.
///
/// SECURITY: `create_dir_all` on a logical path follows a symlink that already
/// exists (`vault/link` → `/tmp`) and would mkdir outside the vault before a
/// later `safe_resolve` could reject the file write.
pub(crate) fn create_dir_all_inside_vault(dir: &Path, vault: &Path) -> Result<(), String> {
    if dir.as_os_str().is_empty() {
        return Err("Cannot create directories outside the vault.".into());
    }
    let mut missing_names = Vec::new();
    let mut cursor = dir.to_path_buf();
    let existing = loop {
        if cursor.exists() {
            break cursor;
        }
        let name = cursor
            .file_name()
            .ok_or_else(|| "Cannot create directories outside the vault.".to_string())?;
        missing_names.push(name.to_os_string());
        match cursor.parent() {
            Some(parent) if parent != cursor.as_path() => cursor = parent.to_path_buf(),
            _ => return Err("Cannot create directories outside the vault.".into()),
        }
    };
    let mut current = safe_resolve(&existing)?;
    if !current.starts_with(vault) {
        return Err("Directory escapes the active vault.".into());
    }
    for name in missing_names.into_iter().rev() {
        let next = current.join(&name);
        if !next.exists() {
            fs::create_dir(&next).map_err(|e| format!("Failed to create directories: {e}"))?;
        }
        current = safe_resolve(&next)?;
        if !current.starts_with(vault) {
            return Err("Directory escapes the active vault.".into());
        }
    }
    Ok(())
}
// ── Agent-initiated file writes ───────────────────────────────────────────────

/// Normalise a path without requiring the file to already exist.
/// Collapses `.` and `..` components so vault-boundary checks work correctly
/// on paths that were assembled by string concatenation rather than
/// `canonicalize()` (which would fail for non-existent files).
///
/// SECURITY: any `..` that would escape the root component causes the function
/// to return an error rather than silently accepting a path-traversal attack.
pub(crate) fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    let mut out: Vec<Component> = Vec::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if out.last().map(|c| matches!(c, Component::Normal(_))) == Some(true) {
                    out.pop();
                } else {
                    return Err("Path traversal detected.".into());
                }
            }
            Component::CurDir => {}
            c => out.push(c),
        }
    }
    Ok(out.iter().collect())
}

/// Resolve a filesystem path to its canonical form for vault-boundary checking.
///
/// - **Existing paths** are fully canonicalized (symlinks + `.`/`..` resolved).
/// - **Non-existing paths with an existing parent** canonicalize the parent and
///   join the filename, closing symlink-based escapes on the parent directory.
/// - **Fully non-existing paths** fall back to logical `normalize_path()` which
///   resolves `.` and `..` without touching the filesystem.
///
/// SECURITY: Used by all file-operation commands before the vault-boundary
/// `starts_with` check to prevent `..`-based path traversal attacks.
pub(crate) fn safe_resolve(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Cannot resolve path '{}': {e}", path.display()))
    } else if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if parent.exists() {
            let canon_parent = parent.canonicalize()
                .map_err(|e| format!("Cannot resolve parent '{}': {e}", parent.display()))?;
            Ok(canon_parent.join(name))
        } else {
            normalize_path(path)
        }
    } else {
        normalize_path(path)
    }
}

/// Canonicalize the vault path for safe boundary comparison.
///
/// SECURITY: The vault path stored in `CurrentVault` may differ from its
/// canonical form (e.g. `/var` vs `/private/var` on macOS).  Canonicalizing
/// both the vault and the target ensures `starts_with` cannot be fooled by
/// path aliasing.
pub(crate) fn canon_vault(vault: &Path) -> Result<PathBuf, String> {
    vault.canonicalize()
        .map_err(|e| format!("Cannot resolve vault path '{}': {e}", vault.display()))
}
