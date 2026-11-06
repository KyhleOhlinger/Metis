use crate::state::CurrentVault;
use std::fs;
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
    // SECURITY: atomic replace, then owner-only mode. A crash mid-write keeps
    // the previous JSON. The mode is set after the rename so the temp umask
    // cannot leave the file world-readable.
    crate::io_atomic::write_atomic(path, json.as_bytes())?;
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

/// `.metis` must be a real directory inside the vault.
///
/// SECURITY: `vault.join(".metis")` follows a directory symlink and later
/// writes land outside the vault. Missing `.metis` is created as a real
/// directory. An existing link is refused.
pub(crate) fn ensure_real_metis(vault: &Path) -> Result<PathBuf, String> {
    let dir = vault.join(".metis");
    match fs::symlink_metadata(&dir) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(
                "The .metis folder is a link. Replace it with a real folder inside the vault."
                    .into(),
            );
        }
        Ok(meta) if !meta.is_dir() => {
            return Err("The .metis path is not a folder.".into());
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&dir).map_err(|e| format!("Cannot create .metis directory: {e}"))?;
        }
        Err(err) => return Err(format!("Cannot read .metis: {err}")),
    }
    let canon = dir
        .canonicalize()
        .map_err(|e| format!("Cannot read .metis: {e}"))?;
    let vault_canon = vault
        .canonicalize()
        .map_err(|e| format!("Cannot read vault: {e}"))?;
    if !canon.starts_with(&vault_canon) {
        return Err("The .metis folder is outside the vault.".into());
    }
    Ok(canon)
}

/// A child of `.metis` (`planner`, `plugins`, `trash`) must not itself be a link.
pub(crate) fn ensure_real_metis_child(vault: &Path, child: &str) -> Result<PathBuf, String> {
    let root = ensure_real_metis(vault)?;
    let path = root.join(child);
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err(format!(
                ".metis/{child} is a link. Replace it with a real folder inside the vault."
            ));
        }
    }
    Ok(path)
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

const VAULT_GRANTS_FILE: &str = "vault-grants.json";

/// Home, filesystem root, and system folders cannot be registered as a vault.
pub(crate) fn vault_root_is_sensitive(path: &Path) -> bool {
    let Ok(canon) = path.canonicalize() else {
        return true;
    };
    if canon.parent().is_none() {
        return true;
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        if let Ok(home) = PathBuf::from(home).canonicalize() {
            if canon == home {
                return true;
            }
        }
    }
    const SYSTEM: &[&str] = &[
        "/etc", "/usr", "/bin", "/sbin", "/System", "/private", "/var", "/opt", "/Library",
    ];
    for root in SYSTEM {
        let root = Path::new(root);
        if canon == root || canon.starts_with(root) {
            return true;
        }
    }
    #[cfg(windows)]
    {
        for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)"] {
            let Some(raw) = std::env::var_os(var) else {
                continue;
            };
            let root = PathBuf::from(raw);
            if canon == root || canon.starts_with(&root) {
                return true;
            }
        }
    }
    false
}

fn grants_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::settings::app_data_dir_for_build(app)?.join(VAULT_GRANTS_FILE))
}

fn load_grants(app: &tauri::AppHandle) -> Vec<String> {
    let Ok(path) = grants_file(app) else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| value.get("paths").cloned())
        .and_then(|paths| serde_json::from_value(paths).ok())
        .unwrap_or_default()
}

/// Remember a folder the user chose in the native vault picker, or created.
pub(crate) fn remember_vault_grant(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if vault_root_is_sensitive(path) {
        return Err("That folder cannot be used as a vault.".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("Cannot use that folder: {e}"))?;
    let key = canon.to_string_lossy().into_owned();
    let mut paths = load_grants(app);
    if !paths.iter().any(|existing| existing == &key) {
        paths.push(key);
    }
    let json = serde_json::json!({ "paths": paths });
    write_private_json_file(
        &grants_file(app)?,
        &serde_json::to_string_pretty(&json).unwrap_or_else(|_| "{\"paths\":[]}".into()),
    )
}

/// A vault opens when it was granted, or when this is the first launch and the
/// folder is already a Metis vault. `/`, home, and system folders never open.
pub(crate) fn vault_open_permitted(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if vault_root_is_sensitive(path) {
        return Err("That folder cannot be used as a vault.".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("Cannot use that folder: {e}"))?;
    let key = canon.to_string_lossy().into_owned();
    let grants_path = grants_file(app)?;
    let known = load_grants(app);
    if known.iter().any(|existing| existing == &key) {
        return Ok(());
    }
    // First launch after this check: an existing Metis vault may reopen.
    if !grants_path.exists() && canon.join(".metis").join("vault.json").is_file() {
        return remember_vault_grant(app, &canon);
    }
    Err("Choose this folder with Open Vault.".into())
}

/// Metis atomic temps are `.{name}.{pid}.{nanos}.tmp`. Other `*.tmp` names stay.
pub(crate) fn is_metis_atomic_tmp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.') else {
        return false;
    };
    let Some(rest) = rest.strip_suffix(".tmp") else {
        return false;
    };
    let Some((head, nanos)) = rest.rsplit_once('.') else {
        return false;
    };
    let Some((file, pid)) = head.rsplit_once('.') else {
        return false;
    };
    !file.is_empty()
        && !pid.is_empty()
        && pid.chars().all(|c| c.is_ascii_digit())
        && !nanos.is_empty()
        && nanos.chars().all(|c| c.is_ascii_digit())
}

/// Delete crashed Metis atomic-write leftovers. Links, dot-folders, and other
/// tools' temp files are left alone.
pub(crate) fn cleanup_stale_tmp(vault: &Path) {
    fn walk(dir: &Path, depth: u32, seen: &mut usize) {
        if depth > 32 || *seen >= 100_000 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            *seen += 1;
            if *seen >= 100_000 {
                return;
            }
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if meta.is_dir() {
                if name.starts_with('.') {
                    continue;
                }
                walk(&path, depth + 1, seen);
                continue;
            }
            if !is_metis_atomic_tmp(&name) {
                continue;
            }
            let old = meta
                .modified()
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 60 * 60);
            if old {
                let _ = fs::remove_file(&path);
            }
        }
    }
    walk(vault, 0, &mut 0);
}

#[cfg(test)]
mod tests {
    use super::is_metis_atomic_tmp;

    #[test]
    fn temp_cleanup_matches_only_metis_names() {
        assert!(is_metis_atomic_tmp(".note.md.123.456.tmp"));
        assert!(!is_metis_atomic_tmp(".syncthing.note.md.tmp"));
        assert!(!is_metis_atomic_tmp(".obsidian.tmp"));
        assert!(!is_metis_atomic_tmp("note.tmp"));
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
