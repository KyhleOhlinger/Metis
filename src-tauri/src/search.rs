use crate::security::{registered_vault, reject_untrusted_webview};
use crate::state::CurrentVault;
use crate::types::{ReplaceOutcome, ReplaceSummary, SearchMatch};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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

/// Drop replace snapshots older than 14 days, then drop the oldest until
/// the trash directory is under 64 MiB.
fn prune_trash(trash: &Path) {
    let Ok(entries) = fs::read_dir(trash) else {
        return;
    };
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(14 * 24 * 60 * 60));
    let mut kept: Vec<(SystemTime, PathBuf, u64)> = Vec::new();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            let _ = fs::remove_file(&path);
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if cutoff.is_some_and(|limit| modified < limit) {
            let _ = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            continue;
        }
        kept.push((modified, path, dir_size(&entry.path())));
    }
    kept.sort_by_key(|(modified, _, _)| *modified);
    let mut total: u64 = kept.iter().map(|(_, _, size)| *size).sum();
    const MAX_TRASH_BYTES: u64 = 64 * 1024 * 1024;
    for (_, path, size) in kept {
        if total <= MAX_TRASH_BYTES {
            break;
        }
        let _ = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        total = total.saturating_sub(size);
    }
}

fn dir_size(path: &Path) -> u64 {
    let mut seen = std::collections::HashSet::new();
    dir_size_inner(path, 0, &mut seen)
}

fn dir_size_inner(path: &Path, depth: u32, seen: &mut std::collections::HashSet<(u64, u64)>) -> u64 {
    if depth > 32 {
        return 0;
    }
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.file_type().is_symlink() {
        return 0;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !seen.insert((meta.dev(), meta.ino())) {
            return 0;
        }
    }
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| dir_size_inner(&entry.path(), depth + 1, seen))
        .sum()
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
    confirmed: Vec<crate::types::ConfirmedReplace>,
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
            skipped: 0,
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
    let trash_parent = crate::security::ensure_real_metis_child(&canon_v, "trash")?;
    prune_trash(&trash_parent);
    let trash_root = trash_parent.join(stamp.to_string());
    let mut summaries: Vec<ReplaceSummary> = Vec::new();
    let mut skipped = 0usize;
    let allowed: std::collections::HashMap<String, String> = confirmed
        .into_iter()
        .map(|row| (row.file_path, row.content_hash))
        .collect();

    for file_path in &md_files {
        let path_key = file_path.to_string_lossy().into_owned();
        let Some(expected) = allowed.get(&path_key) else {
            continue;
        };
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if &content_hash(&content) != expected {
            skipped += 1;
            continue;
        }

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
                    skipped,
                });
            }
        }
        if let Err(e) = crate::io_atomic::write_atomic(&snapshot, content.as_bytes()) {
            return Ok(ReplaceOutcome {
                summaries,
                error: Some(format!("Failed to snapshot '{}': {e}", file_path.display())),
                trash_dir: Some(trash_root.to_string_lossy().into_owned()),
                skipped,
            });
        }
        if let Err(e) = crate::io_atomic::write_atomic(file_path, new_content.as_bytes()) {
            return Ok(ReplaceOutcome {
                summaries,
                error: Some(format!("Failed to write '{}': {e}", file_path.display())),
                trash_dir: Some(trash_root.to_string_lossy().into_owned()),
                skipped,
            });
        }

        summaries.push(ReplaceSummary {
            file_path: file_path.to_string_lossy().into_owned(),
            file_name: file_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            replacements: count,
            content_hash: content_hash(&content),
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
        skipped,
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
            content_hash: content_hash(&content),
        });
    }
    Ok(summaries)
}

#[cfg(all(test, unix))]
mod tests {
    use super::dir_size;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::time::Instant;

    #[test]
    fn trash_size_does_not_follow_parent_links() {
        let root = std::env::temp_dir().join(format!(
            "metis-trash-size-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        symlink("..", root.join("up")).unwrap();
        symlink("..", root.join("up2")).unwrap();
        let started = Instant::now();
        let size = dir_size(&root);
        assert!(started.elapsed().as_millis() < 1000, "size walk followed links");
        assert_eq!(size, 0);
        let _ = fs::remove_dir_all(&root);
    }
}

fn content_hash(text: &str) -> String {
    let mut hash: u32 = 5381;
    for unit in text.encode_utf16() {
        hash = hash.wrapping_shl(5).wrapping_add(hash) ^ u32::from(unit);
    }
    format!("{hash:x}")
}
