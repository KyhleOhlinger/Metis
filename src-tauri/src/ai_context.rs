use crate::security::{registered_vault, reject_untrusted_webview, write_private_json_file};
use crate::settings::app_data_dir_for_build;
use crate::state::CurrentVault;
use crate::types::FileSummary;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::vault_fs::DirWalk;

const NEVER_SEND_FILE: &str = "never-send.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NeverSendFile {
    #[serde(default)]
    vaults: Vec<NeverSendVault>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NeverSendVault {
    vault_path: String,
    folders: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNoteBody {
    pub path: String,
    pub content: String,
}

fn never_send_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app)?.join(NEVER_SEND_FILE))
}

fn load_never_send(app: &tauri::AppHandle) -> Result<NeverSendFile, String> {
    let path = never_send_path(app)?;
    if !path.exists() {
        return Ok(NeverSendFile::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read never-send list: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Never-send list is invalid: {e}"))
}

pub(crate) fn never_send_folders(app: &tauri::AppHandle, vault: &Path) -> Vec<String> {
    let Ok(file) = load_never_send(app) else {
        return Vec::new();
    };
    let key = vault.to_string_lossy();
    file.vaults
        .into_iter()
        .find(|row| row.vault_path == key)
        .map(|row| row.folders)
        .unwrap_or_default()
}

fn normalize_never_send_folder(raw: &str) -> Option<String> {
    let folder = raw.trim().replace('\\', "/");
    let folder = folder.trim_matches('/');
    if folder.is_empty() || folder.len() > 240 {
        return None;
    }
    if folder.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return None;
    }
    Some(folder.to_string())
}

pub(crate) fn is_never_send(relative: &str, folders: &[String]) -> bool {
    let relative = relative.replace('\\', "/");
    let relative = relative.trim_matches('/');
    folders.iter().any(|folder| relative == folder || relative.starts_with(&format!("{folder}/")))
}

fn relative_to_vault(vault: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(vault)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn get_never_send_folders(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    reject_untrusted_webview(&window)?;
    let vault = registered_vault(&window, &vault_state)?;
    Ok(never_send_folders(&app, &vault))
}

#[tauri::command]
pub fn set_never_send_folders(
    folders: Vec<String>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    reject_untrusted_webview(&window)?;
    let vault = registered_vault(&window, &vault_state)?;
    let mut clean = Vec::new();
    for folder in folders {
        if let Some(folder) = normalize_never_send_folder(&folder) {
            if !clean.iter().any(|existing: &String| existing == &folder) {
                clean.push(folder);
            }
        }
    }
    clean.truncate(50);
    let mut file = load_never_send(&app)?;
    let key = vault.to_string_lossy().into_owned();
    if let Some(row) = file.vaults.iter_mut().find(|row| row.vault_path == key) {
        row.folders = clean.clone();
    } else {
        file.vaults.push(NeverSendVault {
            vault_path: key,
            folders: clean.clone(),
        });
    }
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("Cannot save never-send list: {e}"))?;
    write_private_json_file(&never_send_path(&app)?, &json)?;
    Ok(clean)
}

// ── Smart context commands ────────────────────────────────────────────────────
//
// These replace the old `get_folder_md_contents` command with a two-command
// API that supports tiered context strategies on the TypeScript side:
//   1. get_file_summaries  — fast metadata scan (path, name, preview, char_count)
//   2. get_files_content   — fetch full content for a specific list of paths
//
// `get_folder_md_contents` is retained for backward compatibility.

/// Recursively (or shallowly) collect .md file metadata inside `folder_path`.
/// SECURITY: all collected paths are vault-boundary-checked before reading.
#[tauri::command]
pub fn get_file_summaries(
    folder_path: String,
    recursive: bool,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<FileSummary>, String> {
    reject_untrusted_webview(&window)?;
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("get_file_summaries: {e}"))?;
    let blocked = never_send_folders(&app, &canon_v);

    let target = PathBuf::from(&folder_path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve folder: {e}"))?;
    if !target.starts_with(&canon_v) {
        return Err("Folder is outside the active vault.".into());
    }
    if !target.is_dir() {
        return Err(format!("Not a directory: {folder_path}"));
    }

    let mut summaries: Vec<FileSummary> = Vec::new();
    let mut walk = DirWalk::new();
    let _ = walk.enter(&target, &canon_v, 0);
    collect_md_summaries(&target, &canon_v, &blocked, recursive, 0, &mut walk, &mut summaries)?;
    summaries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(summaries)
}

fn collect_md_summaries(
    dir: &Path,
    vault: &Path,
    blocked: &[String],
    recursive: bool,
    depth: u32,
    walk: &mut DirWalk,
    out: &mut Vec<FileSummary>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read dir: {e}"))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with('.'))
        {
            continue;
        }
        // SECURITY: skip any path that escapes the vault (e.g. symlink traversal)
        let canon = path.canonicalize().unwrap_or_default();
        if !canon.starts_with(vault) {
            continue;
        }
        if relative_to_vault(vault, &canon)
            .is_some_and(|rel| is_never_send(&rel, blocked))
        {
            continue;
        }
        if recursive && walk.enter(&path, vault, depth + 1) {
            collect_md_summaries(&path, vault, blocked, recursive, depth + 1, walk, out)?;
            continue;
        }
        if path.is_file() && path.extension().and_then(|x| x.to_str()) == Some("md") && walk.allow_file() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let char_count = content.chars().count();
            let preview: String = content.chars().take(400).collect();
            out.push(FileSummary {
                path: canon.to_string_lossy().into_owned(),
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                preview,
                char_count,
            });
        }
    }
    Ok(())
}

/// Fetch and concatenate the full content of an explicit list of file paths.
/// SECURITY: every path is vault-boundary-checked individually before reading.
/// At most 100 paths are accepted per call to prevent abuse.
#[tauri::command]
pub fn get_files_content(
    paths: Vec<String>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<VaultNoteBody>, String> {
    reject_untrusted_webview(&window)?;
    if paths.len() > 100 {
        return Err("Too many paths requested in a single call (max 100).".into());
    }
    const MAX_TOTAL_BYTES: usize = 5 * 1024 * 1024; // 5 MiB response cap

    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("get_files_content: {e}"))?;
    let blocked = never_send_folders(&app, &canon_v);

    let mut files = Vec::new();
    let mut total = 0usize;
    for raw_path in &paths {
        let canon = PathBuf::from(raw_path)
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path '{}': {e}", raw_path))?;
        if !canon.starts_with(&canon_v) {
            return Err(format!("Path is outside the active vault: {}", raw_path));
        }
        if !canon.is_file() {
            continue;
        }
        // SECURITY: only allow reading .md files to prevent exfiltration of
        // non-note files (credentials, configs) to AI providers.
        if canon.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if relative_to_vault(&canon_v, &canon).is_some_and(|rel| is_never_send(&rel, &blocked)) {
            continue;
        }
        let content = fs::read_to_string(&canon)
            .map_err(|e| format!("Cannot read '{}': {e}", raw_path))?;
        total = total.saturating_add(content.len());
        if total > MAX_TOTAL_BYTES {
            return Err("Requested content exceeds max response size (5 MiB). Narrow the scope.".into());
        }
        files.push(VaultNoteBody {
            path: canon.to_string_lossy().into_owned(),
            content,
        });
    }
    Ok(files)
}

/// Legacy single-call command kept for backward compatibility.
/// New code should prefer `get_file_summaries` + `get_files_content`.
#[tauri::command]
pub fn get_folder_md_contents(
    folder_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("get_folder_md_contents: {e}"))?;

    let target = PathBuf::from(&folder_path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve folder: {e}"))?;
    if !target.starts_with(&canon_v) {
        return Err("Folder is outside the active vault.".into());
    }
    if !target.is_dir() {
        return Err(format!("Not a directory: {folder_path}"));
    }

    const MAX_CHARS: usize = 40_000;
    let mut combined = String::new();
    let mut entries: Vec<_> = fs::read_dir(&target)
        .map_err(|e| format!("Cannot read folder: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().is_file()
                && e.path().extension().and_then(|x| x.to_str()) == Some("md")
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if combined.chars().count() >= MAX_CHARS { break; }
        let canon = match entry.path().canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        // SECURITY: re-validate each discovered file path against the active
        // vault root to prevent symlink escapes from the target directory.
        if !canon.starts_with(&canon_v) {
            continue;
        }
        if canon.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let content = fs::read_to_string(&canon).unwrap_or_default();
        combined.push_str(&format!("\n\n---\n## {}\n\n", entry.file_name().to_string_lossy()));
        let remaining_chars = MAX_CHARS.saturating_sub(combined.chars().count());
        // Char-boundary-safe truncation — avoids panicking on multi-byte UTF-8.
        let truncated: String = content.chars().take(remaining_chars).collect();
        let did_truncate = truncated.chars().count() < content.chars().count();
        combined.push_str(&truncated);
        if did_truncate {
            combined.push_str("\n\n[… content truncated …]");
            break;
        }
    }
    Ok(combined)
}
