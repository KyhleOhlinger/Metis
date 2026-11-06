use crate::security::{registered_vault, reject_untrusted_webview};
use crate::state::CurrentVault;
use crate::types::{ReplaceOutcome, ReplaceSummary, SearchMatch};
use std::fs;
use std::path::PathBuf;

// ── Vault-wide search & replace ───────────────────────────────────────────────

use crate::vault_fs::collect_md_paths;

/// Full-text search across all `.md` files in the active vault.
///
/// SECURITY: Only searches within the vault boundary. Paths are canonicalized
/// and checked before reading. Results are capped at 1000 matches.
#[tauri::command]
pub fn search_vault(
    query: String,
    case_sensitive: bool,
    regex_mode: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<SearchMatch>, String> {
    use regex::RegexBuilder;

    reject_untrusted_webview(&window)?;
    if query.is_empty() {
        return Ok(Vec::new());
    }

    // SECURITY: cap every query. Literal mode still compiles a regex, so a huge
    // pasted string is the same cost as a long pattern.
    const MAX_QUERY_LEN: usize = 1000;
    if query.len() > MAX_QUERY_LEN {
        return Err(format!("Search query is too long (max {MAX_QUERY_LEN} characters)."));
    }

    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("search_in_vault: {e}"))?;

    let re = if regex_mode {
        RegexBuilder::new(&query)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20) // 1 MiB compiled NFA limit
            .build()
            .map_err(|e| format!("Invalid regex: {e}"))?
    } else {
        let escaped = regex::escape(&query);
        RegexBuilder::new(&escaped)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| format!("Search error: {e}"))?
    };

    let mut md_files: Vec<PathBuf> = Vec::new();
    collect_md_paths(&canon_v, &canon_v, &mut md_files);
    md_files.sort();

    const MAX_MATCHES: usize = 1000;
    let mut matches: Vec<SearchMatch> = Vec::new();

    for file_path in &md_files {
        if matches.len() >= MAX_MATCHES {
            break;
        }
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let path_str = file_path.to_string_lossy().into_owned();

        // Match against the filename itself (stem without .md extension).
        let stem = file_name.strip_suffix(".md").unwrap_or(&file_name);
        if let Some(m) = re.find(stem) {
            matches.push(SearchMatch {
                file_path: path_str.clone(),
                file_name: file_name.clone(),
                line_number: 0, // 0 signals a filename match
                line_content: stem.to_string(),
                match_start: m.start(),
                match_end: m.end(),
            });
        }

        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, line) in content.lines().enumerate() {
            if matches.len() >= MAX_MATCHES {
                break;
            }
            if let Some(m) = re.find(line) {
                matches.push(SearchMatch {
                    file_path: path_str.clone(),
                    file_name: file_name.clone(),
                    line_number: line_idx + 1,
                    line_content: line.to_string(),
                    match_start: m.start(),
                    match_end: m.end(),
                });
            }
        }
    }

    Ok(matches)
}

/// Find-and-replace across all `.md` files in the active vault.
///
/// SECURITY: Only modifies files within the vault boundary. Every path is
/// canonicalized and verified. Returns a summary of files changed.
#[tauri::command]
pub fn replace_in_vault(
    query: String,
    replacement: String,
    case_sensitive: bool,
    regex_mode: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<ReplaceOutcome, String> {
    use regex::RegexBuilder;

    reject_untrusted_webview(&window)?;
    if query.is_empty() {
        return Ok(ReplaceOutcome {
            summaries: Vec::new(),
            error: None,
            trash_dir: None,
        });
    }

    const MAX_QUERY_LEN: usize = 1000;
    if query.len() > MAX_QUERY_LEN {
        return Err(format!("Replace query is too long (max {MAX_QUERY_LEN} characters)."));
    }
    if replacement.len() > MAX_QUERY_LEN * 4 {
        return Err("Replacement text is too long.".into());
    }

    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("replace_in_vault: {e}"))?;

    let re = if regex_mode {
        RegexBuilder::new(&query)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20) // 1 MiB compiled NFA limit
            .build()
            .map_err(|e| format!("Invalid regex: {e}"))?
    } else {
        let escaped = regex::escape(&query);
        RegexBuilder::new(&escaped)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| format!("Replace error: {e}"))?
    };

    let mut md_files: Vec<PathBuf> = Vec::new();
    collect_md_paths(&canon_v, &canon_v, &mut md_files);
    md_files.sort();

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let trash_root = canon_v.join(".metis").join("trash").join(stamp.to_string());
    let mut summaries: Vec<ReplaceSummary> = Vec::new();

    for file_path in &md_files {
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let count = re.find_iter(&content).count();
        if count == 0 {
            continue;
        }

        let new_content = re.replace_all(&content, replacement.as_str()).into_owned();
        let rel = file_path.strip_prefix(&canon_v).unwrap_or(file_path);
        let snapshot = trash_root.join(rel);
        if let Some(parent) = snapshot.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Ok(ReplaceOutcome {
                    summaries,
                    error: Some(format!("Failed to snapshot '{}': {e}", file_path.display())),
                    trash_dir: Some(trash_root.to_string_lossy().into_owned()),
                });
            }
        }
        if let Err(e) = crate::io_atomic::write_atomic(&snapshot, content.as_bytes()) {
            return Ok(ReplaceOutcome {
                summaries,
                error: Some(format!("Failed to snapshot '{}': {e}", file_path.display())),
                trash_dir: Some(trash_root.to_string_lossy().into_owned()),
            });
        }
        if let Err(e) = crate::io_atomic::write_atomic(file_path, new_content.as_bytes()) {
            return Ok(ReplaceOutcome {
                summaries,
                error: Some(format!("Failed to write '{}': {e}", file_path.display())),
                trash_dir: Some(trash_root.to_string_lossy().into_owned()),
            });
        }

        summaries.push(ReplaceSummary {
            file_path: file_path.to_string_lossy().into_owned(),
            file_name: file_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            replacements: count,
        });
    }

    let trash_dir = if summaries.is_empty() {
        None
    } else {
        Some(trash_root.to_string_lossy().into_owned())
    };
    Ok(ReplaceOutcome {
        summaries,
        error: None,
        trash_dir,
    })
}

/// Files a replace would change, without writing.
#[tauri::command]
pub fn preview_replace_in_vault(
    query: String,
    case_sensitive: bool,
    regex_mode: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<ReplaceSummary>, String> {
    use regex::RegexBuilder;

    reject_untrusted_webview(&window)?;
    if query.is_empty() {
        return Ok(Vec::new());
    }
    const MAX_QUERY_LEN: usize = 1000;
    if query.len() > MAX_QUERY_LEN {
        return Err(format!("Replace query is too long (max {MAX_QUERY_LEN} characters)."));
    }
    let canon_v = registered_vault(&window, &vault_state)
        .map_err(|e| format!("preview_replace_in_vault: {e}"))?;
    let re = if regex_mode {
        RegexBuilder::new(&query)
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| format!("Invalid regex: {e}"))?
    } else {
        RegexBuilder::new(&regex::escape(&query))
            .case_insensitive(!case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| format!("Replace error: {e}"))?
    };
    let mut md_files = Vec::new();
    collect_md_paths(&canon_v, &canon_v, &mut md_files);
    let mut summaries = Vec::new();
    for file_path in md_files {
        let content = match fs::read_to_string(&file_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let count = re.find_iter(&content).count();
        if count == 0 {
            continue;
        }
        summaries.push(ReplaceSummary {
            file_path: file_path.to_string_lossy().into_owned(),
            file_name: file_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            replacements: count,
        });
    }
    Ok(summaries)
}
