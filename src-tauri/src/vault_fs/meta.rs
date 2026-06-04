use crate::security::canon_vault;
use crate::types::*;
use std::fs;
use std::path::{Path, PathBuf};

// ── Allowed file extensions for vault tree / delete operations ────────────────

/// All file types that Metis displays in the sidebar and allows users to delete.
/// Centralised here so tree-building and delete-path stay in sync.
const ALLOWED_FILE_EXTS: &[&str] = &[
    "md",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
    "pdf",
];

/// Default vault folders (pinned Spaces). Keep in sync with `src/constants/vaultSpaces.ts`.
const DEFAULT_VAULT_DIRS: &[&str] = &["daily", "meetings", "summaries", "handwritten", "assets"];

pub(crate) fn ensure_default_vault_dirs(root: &Path) {
    for dir in DEFAULT_VAULT_DIRS {
        let _ = fs::create_dir(root.join(dir));
    }
}

pub(crate) fn is_allowed_ext(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    ALLOWED_FILE_EXTS.contains(&ext.as_str())
}

// ── Vault identification helpers ──────────────────────────────────────────────

/// Write (or overwrite) the `.metis/vault.json` marker file that identifies a
/// Metis vault.  The `.metis` directory is hidden (dot-prefix) so it never
/// appears in the sidebar file tree.
pub(crate) fn write_vault_meta(vault: &Path) -> Result<(), String> {
    let metis_dir = vault.join(".metis");
    fs::create_dir_all(&metis_dir)
        .map_err(|e| format!("Cannot create .metis directory: {e}"))?;

    let name = vault
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Vault")
        .to_string();

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let meta = VaultMeta {
        version: "1".into(),
        name,
        created_at_unix: ts,
        metis_version: env!("CARGO_PKG_VERSION").into(),
        default_image_dir: default_image_dir_str(),
    };

    let json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialise vault meta: {e}"))?;

    fs::write(metis_dir.join("vault.json"), json.as_bytes())
        .map_err(|e| format!("Failed to write vault meta: {e}"))
}

/// Read `.metis/vault.json`, or return sensible defaults when the marker is absent.
pub(crate) fn read_vault_meta(vault: &Path) -> Result<VaultMeta, String> {
    let meta_path = vault.join(".metis").join("vault.json");
    if !meta_path.exists() {
        let name = vault
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Vault")
            .to_string();
        return Ok(VaultMeta {
            version: "1".into(),
            name,
            created_at_unix: 0,
            metis_version: env!("CARGO_PKG_VERSION").into(),
            default_image_dir: default_image_dir_str(),
        });
    }
    let raw = fs::read_to_string(&meta_path)
        .map_err(|e| format!("Failed to read vault meta: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid vault meta JSON: {e}"))
}

pub(crate) fn write_vault_meta_full(vault: &Path, meta: &VaultMeta) -> Result<(), String> {
    let metis_dir = vault.join(".metis");
    fs::create_dir_all(&metis_dir)
        .map_err(|e| format!("Cannot create .metis directory: {e}"))?;
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to serialise vault meta: {e}"))?;
    fs::write(metis_dir.join("vault.json"), json.as_bytes())
        .map_err(|e| format!("Failed to write vault meta: {e}"))
}

/// Validate a vault-relative directory path (no `..`, no absolute segments).
pub(crate) fn validate_relative_vault_dir(dir: &str) -> Result<String, String> {
    let trimmed = dir.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err("Image folder path cannot be empty.".into());
    }
    if trimmed.starts_with('/') || trimmed.contains('\\') {
        return Err("Invalid image folder path.".into());
    }
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == ".." {
            return Err("Invalid image folder path.".into());
        }
    }
    Ok(trimmed.to_string())
}

/// Identify the likely originating tool for a non-Metis vault.
pub(crate) fn detect_vault_hint(root: &Path) -> String {
    if root.join(".obsidian").is_dir() {
        "obsidian".into()
    } else {
        "markdown".into()
    }
}

pub(crate) fn collect_md_paths(dir: &Path, vault: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with('.'))
        {
            continue;
        }
        let canon = path.canonicalize().unwrap_or_default();
        if !canon.starts_with(vault) {
            continue;
        }
        if path.is_dir() {
            collect_md_paths(&path, vault, out);
        } else if path.is_file() && path.extension().and_then(|x| x.to_str()) == Some("md") {
            out.push(canon);
        }
    }
}

pub(crate) fn collect_md_files(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let canon_v = match canon_vault(root) {
        Ok(c) => c,
        Err(_) => return result,
    };
    collect_md_paths(root, &canon_v, &mut result);
    result
}

/// Convert a Unix timestamp (seconds since 1970-01-01) to a "YYYY-MM-DD" string.
/// Uses a pure Gregorian algorithm so no external date library is needed.
fn secs_to_date_string(secs: u64) -> String {
    let days = secs / 86_400;
    let z    = days + 719_468;
    let era  = z / 146_097;
    let doe  = z - era * 146_097;
    let yoe  = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y    = yoe + era * 400;
    let doy  = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp   = (5 * doy + 2) / 153;
    let d    = doy - (153 * mp + 2) / 5 + 1;
    let m    = if mp < 10 { mp + 3 } else { mp - 9 };
    let y    = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Returns today's date as "YYYY-MM-DD" using the system local clock.
fn today_date_string() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    secs_to_date_string(secs)
}

/// Extract the value of a YAML frontmatter key from `content`, if present.
/// Matches lines of the form `key: value` inside the first `---` block.
fn frontmatter_get<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    let rest = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n"))?;
    let end = rest.find("\n---").or_else(|| rest.find("\r\n---"))?;
    let fm = &rest[..end];
    for line in fm.lines() {
        if let Some(val) = line.strip_prefix(&format!("{key}:")) {
            let v = val.trim();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// Enrich a note's frontmatter with `parent` and `date` fields during vault
/// conversion.  The behaviour is:
///
/// • **No frontmatter** — create a minimal block with `parent` and `date`.
///   No `status` is set; the user can assign it themselves.
/// • **Has frontmatter** — inject only the fields that are absent so existing
///   author content is never overwritten.
///
/// `parent` is derived from the folder that directly contains the file,
/// relative to the vault root (e.g. `daily/` → "daily").
/// `date` is the file's filesystem creation date when available, falling back
/// to today's date.
pub(crate) fn enrich_frontmatter(content: &str, file_path: &Path, vault_root: &Path) -> String {
    // Derive parent from the immediate containing folder, relative to vault root
    let parent_name: Option<String> = file_path
        .parent()
        .and_then(|p| p.strip_prefix(vault_root).ok())
        .and_then(|rel| rel.components().next())
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .filter(|s| !s.is_empty());

    // Attempt to read file creation time; fall back to today
    let date_str = file_path
        .metadata()
        .ok()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| secs_to_date_string(d.as_secs()))
        .unwrap_or_else(today_date_string);

    let has_fm = content.trim_start().starts_with("---");

    if !has_fm {
        // Build a fresh frontmatter block
        let mut fm = String::from("---\n");
        if let Some(ref p) = parent_name {
            fm.push_str(&format!("parent: {p}\n"));
        }
        fm.push_str(&format!("date: {date_str}\n"));
        fm.push_str("---\n\n");
        fm.push_str(content);
        return fm;
    }

    // Has frontmatter — inject only missing fields
    let needs_parent = parent_name.is_some() && frontmatter_get(content, "parent").is_none();
    let needs_date   = frontmatter_get(content, "date").is_none()
                    && frontmatter_get(content, "created").is_none();

    if !needs_parent && !needs_date {
        return content.to_string(); // nothing to add
    }

    // Find the closing `---` of the frontmatter and inject the missing fields
    // just before it so the block remains well-formed.
    let rest = content.strip_prefix("---\n").unwrap_or(content);
    if let Some(end_pos) = rest.find("\n---") {
        let fm_body = &rest[..end_pos];
        let after   = &rest[end_pos + 4..]; // skip "\n---"

        let mut injected = String::new();
        if needs_parent {
            if let Some(ref p) = parent_name {
                injected.push_str(&format!("parent: {p}\n"));
            }
        }
        if needs_date {
            // Prefer any `created:` value already present elsewhere in the body
            let date_val = frontmatter_get(content, "created")
                .map(|s| s.to_string())
                .unwrap_or(date_str);
            injected.push_str(&format!("date: {date_val}\n"));
        }

        return format!("---\n{fm_body}\n{injected}---{after}");
    }

    content.to_string()
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/// Recursively build a tree of FileNodes from `root` (symlink-safe, vault-bounded).
pub(crate) fn build_file_tree(root: &Path) -> Result<Vec<FileNode>, String> {
    let canon_v = canon_vault(root)?;
    build_file_tree_inner(root, &canon_v)
}

pub(crate) fn build_file_tree_inner(root: &Path, canon_vault_root: &Path) -> Result<Vec<FileNode>, String> {
    let mut children = Vec::new();

    let entries =
        fs::read_dir(root).map_err(|e| format!("Cannot read directory: {e}"))?;

    let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();

    sorted.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        b_is_dir
            .cmp(&a_is_dir)
            .then_with(|| a.file_name().cmp(&b.file_name()))
    });

    for entry in sorted {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        // SECURITY: canonicalize every entry; skip symlinks that resolve outside the vault.
        let canon = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !canon.starts_with(canon_vault_root) {
            continue;
        }

        if canon.is_dir() {
            let sub_children = build_file_tree_inner(&path, canon_vault_root)?;
            children.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: Some(sub_children),
            });
        } else if is_allowed_ext(&path) {
            children.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
            });
        }
    }

    Ok(children)
}

