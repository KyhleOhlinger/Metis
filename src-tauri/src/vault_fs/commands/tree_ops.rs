use super::super::meta::is_allowed_ext;
use super::sanitize::sanitize_name;
use crate::security::{canon_vault, registered_vault, registered_vault_raw, reject_untrusted_webview, safe_resolve};
use crate::state::CurrentVault;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    reject_untrusted_webview(&window)?;
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
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("create_note: {e}"))?;
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
    reject_untrusted_webview(&window)?;
    let name = sanitize_name(&name)?;
    let parent = PathBuf::from(&parent_path);

    if !parent.is_dir() {
        return Err(format!("Parent is not a valid directory: {parent_path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("create_folder: {e}"))?;
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

/// The path to operate on. The parent is canonicalized for the vault check.
/// The final component is not followed, so a symlink is the link itself.
fn vault_entry(path: &Path, canon_v: &Path) -> Result<PathBuf, String> {
    if fs::symlink_metadata(path).is_err() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    let Some(name) = path.file_name() else {
        return Err("Invalid path.".into());
    };
    let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) else {
        return Err("Invalid path.".into());
    };
    let canon_parent = safe_resolve(parent)?;
    if canon_parent != canon_v && !canon_parent.starts_with(canon_v) {
        return Err("Path is outside the active vault.".into());
    }
    let entry = canon_parent.join(name);
    if entry == canon_v {
        return Err("Cannot change the vault root directory.".into());
    }
    let meta = fs::symlink_metadata(&entry).map_err(|e| format!("Path does not exist: {e}"))?;
    if !meta.file_type().is_symlink() {
        let resolved = safe_resolve(&entry)?;
        if resolved != canon_v && !resolved.starts_with(canon_v) {
            return Err("Path is outside the active vault.".into());
        }
    }
    Ok(entry)
}

fn delete_without_following(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Path does not exist: {e}"))?;
    let kind = meta.file_type();
    if kind.is_symlink() {
        return fs::remove_file(path).map_err(|e| format!("Failed to delete link: {e}"));
    }
    if kind.is_dir() {
        return fs::remove_dir_all(path).map_err(|e| format!("Failed to delete folder: {e}"));
    }
    if !is_allowed_ext(path) {
        let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
        return Err(format!("Deleting '.{ext}' files is not permitted."));
    }
    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {e}"))
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
    let trusted_vault_path = registered_vault_raw(&window, &vault_state)
        .map_err(|e| format!("delete_path: {e}"))?;

    let vault = PathBuf::from(&trusted_vault_path);

    let canon_v = canon_vault(&vault).map_err(|e| format!("delete_path: {e}"))?;
    let entry = vault_entry(&target, &canon_v).map_err(|e| format!("delete_path: {e}"))?;
    if entry == canon_v {
        return Err("Cannot delete the vault root directory.".into());
    }
    delete_without_following(&entry)
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
    reject_untrusted_webview(&window)?;
    let src_path = PathBuf::from(&src);
    let dest_dir_path = PathBuf::from(&dest_dir);

    // SECURITY: fail-closed — never trust the frontend-supplied vault_path.
    let trusted_vault_path = registered_vault_raw(&window, &vault_state)
        .map_err(|e| format!("move_path: {e}"))?;

    let vault = PathBuf::from(&trusted_vault_path);

    if fs::symlink_metadata(&src_path).is_err() {
        return Err(format!("Source does not exist: {src}"));
    }
    if !dest_dir_path.is_dir() {
        return Err(format!("Destination is not a directory: {dest_dir}"));
    }

    let canon_v = canon_vault(&vault).map_err(|e| format!("move_path: {e}"))?;
    let resolved_src = vault_entry(&src_path, &canon_v).map_err(|e| format!("move_path: {e}"))?;
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

/// True when `from` and `to` are the same path except for ASCII case (e.g. `meetings` → `Meetings`).
/// Needed on case-insensitive volumes where `to.exists()` is true before rename.
pub(crate) fn is_case_only_rename(from: &Path, to: &Path) -> bool {
    if from.parent() != to.parent() {
        return false;
    }
    match (from.file_name(), to.file_name()) {
        (Some(a), Some(b)) if a != b => {
            a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        }
        _ => false,
    }
}

/// Rename within a parent directory, using a two-step temp hop for case-only renames.
pub(crate) fn rename_in_parent(from: &Path, to: &Path) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    if to.exists() {
        if is_case_only_rename(from, to) {
            let parent = from.parent().ok_or("Cannot determine parent directory.")?;
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| format!("System clock error: {e}"))?
                .as_nanos();
            let temp = parent.join(format!(".metis-rename-{nanos}"));
            fs::rename(from, &temp).map_err(|e| format!("Failed to rename: {e}"))?;
            if let Err(err) = fs::rename(&temp, to) {
                if fs::rename(&temp, from).is_err() {
                    return Err(format!(
                        "Failed to rename: {err}. The file was left at {}.",
                        temp.display()
                    ));
                }
                return Err(format!("Failed to rename: {err}"));
            }
            return Ok(());
        }
        let name = to
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        return Err(format!("'{name}' already exists."));
    }
    fs::rename(from, to).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(())
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
    reject_untrusted_webview(&window)?;
    let mut new_name = sanitize_name(&new_name)?;
    let target = PathBuf::from(&path);

    if fs::symlink_metadata(&target).is_err() {
        return Err(format!("Path does not exist: {path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("rename_path: {e}"))?;
    let resolved = vault_entry(&target, &canon_v).map_err(|e| format!("rename_path: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("rename_path: path is outside the active vault.".into());
    }

    let entry_meta = fs::symlink_metadata(&resolved).map_err(|e| format!("rename_path: {e}"))?;
    if entry_meta.file_type().is_file() {
        let existing_ext = resolved
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        if existing_ext.eq_ignore_ascii_case("md") || existing_ext.is_empty() {
            if let Some(stem) = PathBuf::from(&new_name).file_stem() {
                new_name = stem.to_string_lossy().to_string();
            }
            new_name.push_str(".md");
        } else {
            let typed = PathBuf::from(&new_name);
            let typed_ext = typed.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if !typed_ext.eq_ignore_ascii_case(existing_ext) {
                if let Some(stem) = PathBuf::from(&new_name).file_stem() {
                    new_name = stem.to_string_lossy().to_string();
                }
                new_name.push('.');
                new_name.push_str(existing_ext);
            }
        }
    }

    let parent = resolved.parent().ok_or("Cannot determine parent directory.")?;
    let new_path = parent.join(&new_name);

    rename_in_parent(&resolved, &new_path)?;

    Ok(new_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::delete_without_following;
    use std::fs;

    #[test]
    #[cfg(unix)]
    fn deleting_a_symlink_leaves_its_target() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("metis-symlink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes").join("a.md"), b"keep").unwrap();
        let link = dir.join("link");
        symlink(dir.join("notes"), &link).unwrap();
        delete_without_following(&link).unwrap();
        assert!(!link.exists());
        assert_eq!(fs::read(dir.join("notes").join("a.md")).unwrap(), b"keep");
        let _ = fs::remove_dir_all(&dir);
    }
}
