use std::fs;
use std::path::{Path, PathBuf};

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
    if json.len() > MAX_PERSISTED_JSON_BYTES {
        return Err("Payload too large.".into());
    }
    fs::write(path, json.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|e| format!("Failed to set file permissions: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)
            .map_err(|e| format!("Failed to set file permissions: {e}"))?;
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
