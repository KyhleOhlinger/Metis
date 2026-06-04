use crate::security::canon_vault;
use crate::state::CurrentVault;
use crate::types::FileSummary;
use std::fs;
use std::path::{Path, PathBuf};

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
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<FileSummary>, String> {
    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_file_summaries: {e}"))?;

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
    collect_md_summaries(&target, &canon_v, recursive, &mut summaries)?;
    summaries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(summaries)
}

fn collect_md_summaries(
    dir: &Path,
    vault: &Path,
    recursive: bool,
    out: &mut Vec<FileSummary>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read dir: {e}"))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        // SECURITY: skip any path that escapes the vault (e.g. symlink traversal)
        let canon = path.canonicalize().unwrap_or_default();
        if !canon.starts_with(vault) {
            continue;
        }
        if path.is_dir() && recursive {
            collect_md_summaries(&path, vault, recursive, out)?;
        } else if path.is_file() && path.extension().and_then(|x| x.to_str()) == Some("md") {
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
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    if paths.len() > 100 {
        return Err("Too many paths requested in a single call (max 100).".into());
    }
    const MAX_TOTAL_BYTES: usize = 5 * 1024 * 1024; // 5 MiB response cap

    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_files_content: {e}"))?;

    let mut combined = String::new();
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
        let content = fs::read_to_string(&canon)
            .map_err(|e| format!("Cannot read '{}': {e}", raw_path))?;
        let name = canon.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let section = format!("\n\n---\n## {name}\n\n{content}");
        if combined.len().saturating_add(section.len()) > MAX_TOTAL_BYTES {
            return Err("Requested content exceeds max response size (5 MiB). Narrow the scope.".into());
        }
        combined.push_str(&section);
    }
    Ok(combined)
}

/// Legacy single-call command kept for backward compatibility.
/// New code should prefer `get_file_summaries` + `get_files_content`.
#[tauri::command]
pub fn get_folder_md_contents(
    folder_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_folder_md_contents: {e}"))?;

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
