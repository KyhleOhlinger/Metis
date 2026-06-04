use crate::security::canon_vault;
use crate::state::CurrentVault;
use crate::types::{ReplaceSummary, SearchMatch};
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

    if query.is_empty() {
        return Ok(Vec::new());
    }

    // SECURITY: limit regex pattern length to mitigate ReDoS from complex patterns.
    const MAX_PATTERN_LEN: usize = 1000;
    if regex_mode && query.len() > MAX_PATTERN_LEN {
        return Err(format!("Regex pattern is too long (max {MAX_PATTERN_LEN} characters)."));
    }

    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("search_in_vault: {e}"))?;

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
) -> Result<Vec<ReplaceSummary>, String> {
    use regex::RegexBuilder;

    if query.is_empty() {
        return Ok(Vec::new());
    }

    // SECURITY: limit regex pattern length to mitigate ReDoS.
    const MAX_PATTERN_LEN: usize = 1000;
    if regex_mode && query.len() > MAX_PATTERN_LEN {
        return Err(format!("Regex pattern is too long (max {MAX_PATTERN_LEN} characters)."));
    }

    let vault_lock = vault_state.0.lock().unwrap();
    let vault_str = vault_lock
        .get(window.label())
        .ok_or("No vault is currently open.")?
        .clone();
    drop(vault_lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("replace_in_vault: {e}"))?;

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
            .build()
            .map_err(|e| format!("Replace error: {e}"))?
    };

    let mut md_files: Vec<PathBuf> = Vec::new();
    collect_md_paths(&canon_v, &canon_v, &mut md_files);
    md_files.sort();

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
        if let Err(e) = fs::write(file_path, new_content.as_bytes()) {
            return Err(format!(
                "Failed to write '{}': {e}",
                file_path.display()
            ));
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

    Ok(summaries)
}
