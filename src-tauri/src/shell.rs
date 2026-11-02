use crate::security::{
    canon_vault, normalize_path, registered_vault, registered_vault_raw, reject_untrusted_webview,
    safe_resolve, write_private_json_file,
};
use crate::settings::app_data_dir_for_build;
use crate::state::{CurrentVault, ExportGrants};
use crate::vault_fs::{
    read_vault_meta, validate_relative_vault_dir, write_vault_meta, write_vault_meta_full,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ── Webview navigation guard ─────────────────────────────────────────────────

/// Allow only in-app asset URLs inside Metis webviews; open http(s) in the OS browser.
pub fn allow_in_app_webview_navigation(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "blob" | "data" => true,
        "http" | "https" => {
            #[cfg(debug_assertions)]
            {
                if matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")) {
                    return true;
                }
            }
            let _ = open::that(url.as_str());
            false
        }
        _ => false,
    }
}

// ── Native folder picker ──────────────────────────────────────────────────────

/// Open a native folder-picker dialog parented to the **calling window**.
///
/// Uses the async callback API (`pick_folder`) so the native `NSOpenPanel` is
/// dispatched through the platform event loop on the main thread, while the
/// async Tauri command awaits the result on the async runtime without blocking.
///
/// Using `blocking_pick_folder` in a synchronous command handler causes a
/// deadlock on macOS because Tauri v2 dispatches synchronous IPC on the main
/// thread, and `blocking_pick_folder` also needs to schedule the sheet on the
/// same main thread — they wait on each other indefinitely.
///
/// Returns the selected folder path as a string, or `null` if the user
/// cancelled.
#[tauri::command]
pub async fn pick_folder(window: tauri::WebviewWindow) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    use std::sync::mpsc;

    // Callback-based API: the dialog is shown through the platform event loop
    // (on the correct main thread), so there is no deadlock risk.
    let (tx, rx) = mpsc::channel::<Option<String>>();

    window.app_handle().clone()
        .dialog()
        .file()
        .set_parent(&window)
        .pick_folder(move |result| {
            let _ = tx.send(result.map(|fp| fp.to_string()));
        });

    // Wait for the user's selection on a blocking worker thread so the async
    // executor is not stalled while the dialog is open.
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .unwrap_or(None)
}

// ── System file-manager integration ──────────────────────────────────────────

/// Reveal `path` in the OS file manager.
///
/// On macOS: uses AppleScript to select the specific item inside Finder so the
/// user can see it in context.  The sidebar and path bar remain fully accessible
/// so the user can navigate anywhere within or outside the vault.
///
/// SECURITY: Path existence is validated before spawning a subprocess.
#[tauri::command]
pub fn reveal_in_finder(
    path: String,
    vault_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    // SECURITY: enforce active-vault containment even for reveal operations.
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("reveal_in_finder: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("reveal_in_finder: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("reveal_in_finder: path is outside the active vault.".into());
    }
    reveal_impl(&resolved.to_string_lossy(), &vault_path)
}

#[cfg(target_os = "macos")]
fn reveal_impl(path: &str, vault_path: &str) -> Result<(), String> {
    // SECURITY: AppleScript string literals have no backslash-escape mechanism.
    // macOS APFS allows `"` in filenames, so we must reject such paths rather
    // than risk AppleScript injection.  We also reject control characters
    // (\n, \r) that could break the multi-line script.
    for arg in [path, vault_path] {
        if arg.contains('"') || arg.contains('\n') || arg.contains('\r') {
            return Err("Path contains characters unsupported for Finder reveal.".into());
        }
    }

    // `reveal` opens a single Finder window with the item selected inside its
    // parent folder.  From there the user can press Cmd+Up, use the path bar
    // (View › Show Path Bar), or click the Back button to reach the vault root
    // or any other directory — no second window is created.
    let _ = vault_path; // kept in signature for forward-compat; unused on macOS
    let script = format!(
        "tell application \"Finder\"\n\
         activate\n\
         reveal POSIX file \"{path}\"\n\
         end tell"
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn reveal_impl(path: &str, _vault_path: &str) -> Result<(), String> {
    // Strip embedded double-quotes before wrapping in quotes so the
    // Explorer argument parser doesn't see mismatched quote pairs.
    // Explorer's /select argument is a single token: `/select,"path"`.
    let safe = path.replace('"', "");
    std::process::Command::new("explorer")
        .arg(format!("/select,\"{safe}\""))
        .spawn()
        .map_err(|e| format!("Failed to reveal in Explorer: {e}"))?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal_impl(path: &str, _vault_path: &str) -> Result<(), String> {
    let parent = Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    open::that(&parent).map_err(|e| format!("Failed to open file manager: {e}"))
}

// ── Multi-window vault launcher ───────────────────────────────────────────────

/// Percent-encode characters that are unsafe inside a URL query-parameter
/// value.  We only encode the subset that can actually appear in POSIX / NTFS
/// paths to keep the implementation dependency-free.
fn url_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for ch in path.chars() {
        match ch {
            // Characters safe in query-param values (RFC 3986 §3.4)
            'A'..='Z' | 'a'..='z' | '0'..='9'
            | '-' | '_' | '.' | '~' | '/' | ':' => out.push(ch),
            // Everything else (including spaces, #, &, ?, %) → percent-encode
            c => {
                for byte in c.to_string().as_bytes() {
                    out.push('%');
                    out.push_str(&format!("{byte:02X}"));
                }
            }
        }
    }
    out
}

/// Spawn a **new** Metis window pre-loaded with `vault_path`.
///
/// The vault path is passed as a `?vault=` query parameter so the new window's
/// `App.tsx` can open it on first render without touching the shared
/// `localStorage` key used by the primary window.
///
/// This is called by the frontend when the user picks a vault that is
/// different from the one already open in the current window.
#[tauri::command]
pub fn open_vault_window(
    vault_path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Validate the path is an existing directory before spawning a window
    let dir = PathBuf::from(&vault_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {vault_path}"));
    }

    // Unique label — Tauri requires labels to match [a-zA-Z0-9_-]
    let label = format!(
        "vault_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let vault_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Vault");

    let encoded = url_encode_path(&vault_path);
    // `WebviewUrl::App` is resolved against devUrl in development and the
    // bundled dist in production, so query params are forwarded correctly.
    let url = tauri::WebviewUrl::App(
        format!("index.html?vault={encoded}").into(),
    );

    // Open at a sensible default that fits comfortably on most screens.
    // 1 100 × 780 avoids the window overflowing a 13" laptop display while
    // still providing a comfortable three-pane layout.
    //
    // min_inner_size MUST match tauri.conf.json's minWidth/minHeight (580 × 480)
    // so that window-management tools like Rectangle can snap secondary windows
    // to any fraction of the screen, just like the primary window.
    tauri::WebviewWindowBuilder::new(&app_handle, &label, url)
        .title(format!("Metis — {vault_name}"))
        .inner_size(1100.0, 780.0)
        .min_inner_size(580.0, 480.0)
        .resizable(true)
        .on_navigation(allow_in_app_webview_navigation)
        .build()
        .map_err(|e| format!("Failed to open new vault window: {e}"))?;

    Ok(())
}

// ── External URL opener ───────────────────────────────────────────────────────

/// Open `url` in the OS default browser.
///
/// SECURITY: Only `http://` and `https://` URLs are accepted to prevent abuse
/// (e.g. `file://`, `javascript:`, or custom-protocol injection).
#[tauri::command]
pub fn open_url(url: String, window: tauri::WebviewWindow) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let host_start = if lower.starts_with("https://") {
        8
    } else if lower.starts_with("http://") {
        7
    } else {
        return Err("Only http(s) URLs may be opened externally.".into());
    };
    if trimmed.len() <= host_start {
        return Err("Invalid URL.".into());
    }
    open::that(trimmed).map_err(|e| format!("Failed to open URL: {e}"))
}

/// Persist the vault-relative default folder for pasted/saved images.
#[tauri::command]
pub fn set_vault_default_image_dir(
    vault_path: String,
    relative_dir: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let rel = validate_relative_vault_dir(&relative_dir)?;

    let trusted = registered_vault_raw(&window, &vault_state)
        .map_err(|e| format!("set_vault_default_image_dir: {e}"))?;

    if PathBuf::from(&vault_path) != PathBuf::from(&trusted) {
        return Err("set_vault_default_image_dir: vault path mismatch.".into());
    }

    let vault = PathBuf::from(&trusted);
    let canon_v = canon_vault(&vault)
        .map_err(|e| format!("set_vault_default_image_dir: {e}"))?;
    let dir_path = safe_resolve(&canon_v.join(&rel))
        .map_err(|e| format!("set_vault_default_image_dir: {e}"))?;
    if !dir_path.starts_with(&canon_v) {
        return Err("set_vault_default_image_dir: folder escapes vault boundary.".into());
    }
    if !dir_path.is_dir() {
        return Err(format!("Folder does not exist: {rel}"));
    }

    let mut meta = if vault.join(".metis").join("vault.json").exists() {
        read_vault_meta(&vault)?
    } else {
        write_vault_meta(&vault)?;
        read_vault_meta(&vault)?
    };
    meta.default_image_dir = rel.clone();
    write_vault_meta_full(&vault, &meta)?;
    Ok(rel)
}

/// Copy vault-local files to a user-chosen destination directory (may be outside the vault).
#[tauri::command]
pub fn copy_files_to_folder(
    source_paths: Vec<String>,
    dest_dir: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<usize, String> {
    reject_untrusted_webview(&window)?;
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("copy_files_to_folder: {e}"))?;

    let dest = PathBuf::from(&dest_dir);
    let dest_resolved = if dest.exists() {
        safe_resolve(&dest).map_err(|e| format!("copy_files_to_folder: {e}"))?
    } else {
        fs::create_dir_all(&dest)
            .map_err(|e| format!("Failed to create destination folder: {e}"))?;
        safe_resolve(&dest).map_err(|e| format!("copy_files_to_folder: {e}"))?
    };
    if !dest_resolved.is_dir() {
        return Err("Destination is not a directory.".into());
    }

    let mut copied = 0usize;
    for src_str in source_paths {
        let src = PathBuf::from(&src_str);
        let resolved = safe_resolve(&src).map_err(|e| format!("copy_files_to_folder: {e}"))?;
        if !resolved.starts_with(&canon_v) {
            return Err(format!(
                "Source file escapes vault boundary: {}",
                resolved.display()
            ));
        }
        if !resolved.is_file() {
            continue;
        }
        let file_name = resolved
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid source file name.")?;
        let mut target = dest_resolved.join(file_name);
        if target.exists() {
            let stem = resolved
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image");
            let ext = resolved
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            let mut n = 1u32;
            loop {
                let candidate = if ext.is_empty() {
                    dest_resolved.join(format!("{stem}-{n}"))
                } else {
                    dest_resolved.join(format!("{stem}-{n}.{ext}"))
                };
                if !candidate.exists() {
                    target = candidate;
                    break;
                }
                n += 1;
                if n > 9999 {
                    return Err(format!("Too many name collisions for {file_name}"));
                }
            }
        }
        fs::copy(&resolved, &target)
            .map_err(|e| format!("Failed to copy {}: {e}", resolved.display()))?;
        copied += 1;
    }
    Ok(copied)
}

// ── PDF / export file I/O (user-chosen paths via save dialog) ─────────────────

/// Native save-file dialog. Returns absolute path or `None` if cancelled.
///
/// SECURITY: The chosen path is stored as a one-shot grant for this window.
/// `write_export_bytes` rejects every other path.
#[tauri::command]
pub async fn pick_save_path(
    window: tauri::WebviewWindow,
    export_grants: tauri::State<'_, ExportGrants>,
    default_name: String,
    extension: String,
    default_directory: Option<String>,
) -> Result<Option<String>, String> {
    use std::path::PathBuf;
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    if crate::security::reject_untrusted_webview(&window).is_err() {
        return Err("This command is not available from the help window.".into());
    }

    let ext = extension.trim().trim_start_matches('.').to_lowercase();
    let default = if default_name.to_lowercase().ends_with(&format!(".{ext}")) {
        default_name
    } else if ext.is_empty() {
        default_name
    } else {
        format!("{default_name}.{ext}")
    };

    let (tx, rx) = mpsc::channel::<Option<String>>();

    let mut dialog = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(&default)
        .add_filter("Export", &[ext.as_str()]);

    if let Some(dir) = default_directory {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    }

    dialog.save_file(move |result| {
            let path = result.map(|fp| {
                let mut p = fp.to_string();
                if !ext.is_empty() && !p.to_lowercase().ends_with(&format!(".{ext}")) {
                    p.push('.');
                    p.push_str(&ext);
                }
                p
            });
            let _ = tx.send(path);
        });

    let chosen = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .unwrap_or(None);
    let Some(path) = chosen else {
        return Ok(None);
    };
    let resolved = resolve_export_path(Path::new(&path))?;
    // SECURITY: grant is the resolved path, not the raw dialog string.
    export_grants
        .pending_files
        .lock()
        .unwrap()
        .insert(window.label().to_string(), resolved);
    Ok(Some(path))
}

/// Folder picker that records a persistent export grant (Jekyll blog root).
///
/// SECURITY: Typing a path in settings does not authorize writes. Only a folder
/// returned by this dialog is stored in `export-grants.json`.
#[tauri::command]
pub async fn pick_export_directory(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    crate::security::reject_untrusted_webview(&window)?;

    let (tx, rx) = mpsc::channel::<Option<String>>();
    window
        .app_handle()
        .clone()
        .dialog()
        .file()
        .set_parent(&window)
        .pick_folder(move |result| {
            let _ = tx.send(result.map(|fp| fp.to_string()));
        });

    let chosen = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .unwrap_or(None);
    let Some(path) = chosen else {
        return Ok(None);
    };
    let granted = remember_export_directory(&window.app_handle(), Path::new(&path))?;
    Ok(Some(granted.to_string_lossy().into_owned()))
}

const EXPORT_GRANTS_FILE: &str = "export-grants.json";
const MAX_EXPORT_DIRS: usize = 32;

#[derive(Serialize, Deserialize, Default)]
struct ExportGrantFile {
    directories: Vec<String>,
}

enum ExportPermit {
    /// Exact file from `pick_save_path`. Consumed after a successful write.
    OneShot,
    /// File strictly inside a folder from `pick_export_directory`.
    UnderDirectory,
}

/// Resolve an export path through its nearest existing ancestor.
///
/// SECURITY: Collapses `..` before the walk, then canonicalizes the existing
/// prefix so `/tmp` and `/private/tmp` compare equal. Missing suffixes stay
/// attached and cannot jump out via a symlink that is not the ancestor.
pub(crate) fn resolve_export_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Export path is empty.".into());
    }
    let raw = path.to_string_lossy();
    if raw.contains('\0') {
        return Err("Invalid export path.".into());
    }
    if !path.is_absolute() {
        return Err("Export path must be absolute.".into());
    }
    let normalized = normalize_path(path)?;
    let mut suffix = Vec::new();
    let mut cursor = normalized;
    loop {
        if cursor.exists() {
            let canon = cursor
                .canonicalize()
                .map_err(|e| format!("Cannot resolve export path: {e}"))?;
            let mut out = canon;
            for part in suffix.iter().rev() {
                out.push(part);
            }
            return Ok(out);
        }
        let Some(name) = cursor.file_name().map(|n| n.to_os_string()) else {
            return Err("Cannot resolve export path.".into());
        };
        suffix.push(name);
        if !cursor.pop() {
            return Err("Cannot resolve export path.".into());
        }
    }
}

fn export_grants_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app)?.join(EXPORT_GRANTS_FILE))
}

fn load_export_directories(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let path = export_grants_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read export grants: {e}"))?;
    let file: ExportGrantFile = serde_json::from_str(&raw).unwrap_or_default();
    let mut out = Vec::new();
    for dir in file.directories {
        let candidate = PathBuf::from(&dir);
        if !candidate.is_dir() {
            continue;
        }
        if let Ok(canon) = candidate.canonicalize() {
            if canon.parent().is_some() {
                out.push(canon);
            }
        }
    }
    Ok(out)
}

fn remember_export_directory(app: &tauri::AppHandle, dir: &Path) -> Result<PathBuf, String> {
    if !dir.is_dir() {
        return Err("Export folder is not a directory.".into());
    }
    let canon = dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve export folder: {e}"))?;
    // SECURITY: a grant of `/` would authorize writes anywhere on the volume.
    if canon.parent().is_none() {
        return Err("Choose a folder inside a drive, not the drive itself.".into());
    }
    let mut dirs = load_export_directories(app)?;
    dirs.retain(|existing| existing != &canon);
    dirs.push(canon.clone());
    if dirs.len() > MAX_EXPORT_DIRS {
        let drop_count = dirs.len() - MAX_EXPORT_DIRS;
        dirs.drain(0..drop_count);
    }
    let file = ExportGrantFile {
        directories: dirs
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to encode export grants: {e}"))?;
    write_private_json_file(&export_grants_path(app)?, &json)?;
    Ok(canon)
}

fn authorize_export(
    app: &tauri::AppHandle,
    window_label: &str,
    grants: &ExportGrants,
    resolved: &Path,
) -> Result<ExportPermit, String> {
    let pending_hit = grants
        .pending_files
        .lock()
        .unwrap()
        .get(window_label)
        .cloned();
    if pending_hit.as_deref() == Some(resolved) {
        return Ok(ExportPermit::OneShot);
    }
    let dirs = load_export_directories(app)?;
    let under_grant = dirs.iter().any(|dir| resolved.starts_with(dir) && resolved != dir);
    if under_grant {
        return Ok(ExportPermit::UnderDirectory);
    }
    Err(
        "This export path was not approved. Use Save in the dialog, or choose the Jekyll folder with Browse."
            .into(),
    )
}

/// Write export bytes to a user-approved path (may be outside the vault).
///
/// SECURITY: The path must match this window's one-shot save-dialog grant, or
/// resolve strictly inside a folder granted by `pick_export_directory`.
/// Rejects empty payloads and oversize exports (~100 MB).
#[tauri::command]
pub fn write_export_bytes(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    export_grants: tauri::State<'_, ExportGrants>,
    path: String,
    data_base64: String,
) -> Result<(), String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    crate::security::reject_untrusted_webview(&window)?;

    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Invalid export payload: {e}"))?;

    const MAX_BYTES: usize = 100 * 1024 * 1024;
    if bytes.is_empty() {
        return Err("Export file is empty.".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("Export file is too large (max 100 MB).".into());
    }

    let resolved = resolve_export_path(Path::new(&path))?;
    let permit = authorize_export(&app_handle, window.label(), &export_grants, &resolved)?;

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            match permit {
                ExportPermit::OneShot => {
                    return Err("Export folder does not exist.".into());
                }
                ExportPermit::UnderDirectory => {
                    // Parent is a missing suffix under the granted folder.
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create export directory: {e}"))?;
                }
            }
        }
    }

    fs::write(&resolved, bytes).map_err(|e| format!("Failed to write export file: {e}"))?;

    if matches!(permit, ExportPermit::OneShot) {
        export_grants
            .pending_files
            .lock()
            .unwrap()
            .remove(window.label());
    }
    Ok(())
}

#[cfg(test)]
mod export_path_tests {
    use super::resolve_export_path;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn missing_suffix_stays_under_existing_ancestor() {
        let root = std::env::temp_dir().join(format!(
            "metis-export-grant-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let target = root.join("_posts").join("note.markdown");
        let resolved = resolve_export_path(&target).unwrap();
        let canon = root.canonicalize().unwrap();
        assert!(resolved.starts_with(&canon));
        assert_ne!(resolved, canon);

        let sibling = PathBuf::from(format!("{}-evil/note.markdown", canon.display()));
        assert!(!sibling.starts_with(&canon));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parent_dir_cannot_escape_the_ancestor() {
        let root = std::env::temp_dir().join(format!(
            "metis-export-escape-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let target = root.join("_posts").join("..").join("..").join("outside.txt");
        let resolved = resolve_export_path(&target).unwrap();
        let canon = root.canonicalize().unwrap();
        assert!(!resolved.starts_with(&canon));
        let _ = fs::remove_dir_all(&root);
    }
}

