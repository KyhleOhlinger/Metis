// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.
// See the LICENSE file in the repository root for the full license text.

// Prevents an extra console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};
use tauri::menu::{
    AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

// ── Allowed file extensions for vault tree / delete operations ────────────────

/// All file types that Metis displays in the sidebar and allows users to delete.
/// Centralised here so tree-building and delete-path stay in sync.
const ALLOWED_FILE_EXTS: &[&str] = &[
    "md",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
    "pdf",
];

fn is_allowed_ext(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    ALLOWED_FILE_EXTS.contains(&ext.as_str())
}

// ── Managed application state ─────────────────────────────────────────────────

/// Holds the active directory watcher for each open window so every window's
/// vault is watched independently.  Keyed by Tauri window label.
struct WatcherState(Mutex<HashMap<String, RecommendedWatcher>>);

/// Tracks the vault path for each open window so file-operation commands can
/// enforce the correct vault boundary per window.
///
/// SECURITY: Commands that write, read, or delete files validate paths against
/// the entry for their specific window label, preventing any operation from
/// escaping a vault boundary even if the frontend IPC is abused.
struct CurrentVault(Mutex<HashMap<String, String>>);

// ── Shared data types (serialised to the frontend via JSON) ──────────────────

#[derive(Serialize, Deserialize, Clone)]
struct FileNode {
    name: String,
    /// Absolute path on the local filesystem
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Deserialize)]
struct VaultData {
    /// Absolute path to the vault root directory
    path: String,
    files: Vec<FileNode>,
    /// True when a `.metis/vault.json` marker file is present in the root.
    is_metis_vault: bool,
    /// Set only for non-Metis vaults to hint at the originating tool.
    /// Possible values: "obsidian" | "markdown" | null
    #[serde(skip_serializing_if = "Option::is_none")]
    vault_hint: Option<String>,
    /// Vault-relative folder for pasted/saved images (default `assets`).
    #[serde(default = "default_image_dir_str")]
    default_image_dir: String,
}

/// Persisted in `.metis/vault.json` to identify a Metis vault.
#[derive(Serialize, Deserialize, Clone)]
struct VaultMeta {
    version: String,
    name: String,
    created_at_unix: u64,
    metis_version: String,
    #[serde(default = "default_image_dir_str")]
    default_image_dir: String,
}

fn default_image_dir_str() -> String {
    "assets".into()
}

/// Emitted as the `convert-vault-progress` Tauri event during vault conversion.
#[derive(Serialize, Clone)]
struct ConvertProgress {
    step: String,
    current: usize,
    total: usize,
}

// ── Vault identification helpers ──────────────────────────────────────────────

/// Write (or overwrite) the `.metis/vault.json` marker file that identifies a
/// Metis vault.  The `.metis` directory is hidden (dot-prefix) so it never
/// appears in the sidebar file tree.
fn write_vault_meta(vault: &Path) -> Result<(), String> {
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
fn read_vault_meta(vault: &Path) -> Result<VaultMeta, String> {
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

fn write_vault_meta_full(vault: &Path, meta: &VaultMeta) -> Result<(), String> {
    let metis_dir = vault.join(".metis");
    fs::create_dir_all(&metis_dir)
        .map_err(|e| format!("Cannot create .metis directory: {e}"))?;
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to serialise vault meta: {e}"))?;
    fs::write(metis_dir.join("vault.json"), json.as_bytes())
        .map_err(|e| format!("Failed to write vault meta: {e}"))
}

/// Validate a vault-relative directory path (no `..`, no absolute segments).
fn validate_relative_vault_dir(dir: &str) -> Result<String, String> {
    let trimmed = dir.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err("Image folder path cannot be empty.".into());
    }
    if trimmed.contains("..") || trimmed.starts_with('/') || trimmed.contains('\\') {
        return Err("Invalid image folder path.".into());
    }
    Ok(trimmed.to_string())
}

/// Identify the likely originating tool for a non-Metis vault.
/// Returns "obsidian" when `.obsidian/` is present, otherwise "markdown".
fn detect_vault_hint(root: &Path) -> String {
    if root.join(".obsidian").is_dir() {
        "obsidian".into()
    } else {
        "markdown".into()
    }
}

/// Recursively collect all `.md` files under `root`, skipping hidden
/// directories (dot-prefix).  Used by `convert_vault_to_metis` to count and
/// iterate notes for metadata back-fill.
fn collect_md_files(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    fn walk(dir: &Path, result: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue; // skip hidden files / dirs
            }
            if path.is_dir() {
                walk(&path, result);
            } else if path.extension().map(|e| e == "md").unwrap_or(false) {
                result.push(path);
            }
        }
    }
    walk(root, &mut result);
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
fn enrich_frontmatter(content: &str, file_path: &Path, vault_root: &Path) -> String {
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

/// Recursively build a tree of FileNodes from `root`.
/// Includes all non-hidden directories (even empty ones) and all `.md` files.
fn build_file_tree(root: &Path) -> Result<Vec<FileNode>, String> {
    let mut children = Vec::new();

    let entries =
        fs::read_dir(root).map_err(|e| format!("Cannot read directory: {e}"))?;

    let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();

    // Directories first, then files — both sorted alphabetically
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

        // Skip hidden files / directories (e.g. .git, .DS_Store)
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            // Always include directories so newly-created empty folders appear immediately
            let sub_children = build_file_tree(&path)?;
            children.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: Some(sub_children),
            });
        } else {
            // Include .md notes and common image/asset file types so that
            // folders like assets/ expand and show their contents in the sidebar.
            if is_allowed_ext(&path) {
                children.push(FileNode {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: false,
                    children: None,
                });
            }
        }
    }

    Ok(children)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Receive the vault root path (chosen by the frontend folder-picker dialog),
/// walk the directory tree, and return the structured file list.
///
/// SECURITY: `path` is validated to be an existing directory before use.
/// Records the vault in `CurrentVault` so later file-operation commands can
/// enforce the vault boundary without trusting the frontend to pass it each time.
#[tauri::command]
fn open_vault(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    let root = PathBuf::from(&path);

    if !root.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    // Detect whether this is already a Metis vault by looking for the marker.
    let has_marker = root.join(".metis").join("vault.json").exists();

    // Migration heuristic: vaults that were created by Metis before the marker
    // feature was introduced won't have `.metis/vault.json`, but they will have
    // the characteristic `daily/` and `meetings/` folder structure.  Silently
    // write the marker so they are recognised as Metis vaults from now on,
    // without showing the conversion prompt to the user.
    let looks_like_metis = !has_marker
        && root.join("daily").is_dir()
        && root.join("meetings").is_dir();

    if looks_like_metis {
        let _ = write_vault_meta(&root);
    }

    let is_metis_vault = has_marker || looks_like_metis;

    let vault_hint = if is_metis_vault {
        // For Metis vaults, idempotently re-create any missing default folders.
        for default_dir in &["daily", "meetings", "summaries", "assets"] {
            let _ = fs::create_dir(root.join(default_dir));
        }
        None
    } else {
        // For foreign vaults, leave the directory structure untouched and
        // identify the originating tool so the frontend can show an informative
        // conversion prompt.
        Some(detect_vault_hint(&root))
    };

    // Record the vault path for this specific window so file-operation commands
    // can enforce the correct vault boundary per-window.
    vault_state.0.lock().unwrap().insert(window.label().to_string(), path.clone());

    let files = build_file_tree(&root)?;
    let default_image_dir = read_vault_meta(&root)
        .map(|m| m.default_image_dir)
        .unwrap_or_else(|_| default_image_dir_str());
    Ok(VaultData {
        path,
        files,
        is_metis_vault,
        vault_hint,
        default_image_dir,
    })
}

/// Write `content` to `path`.
///
/// SECURITY: Only allows writing `.md` files within the active vault.
/// Parent directory must already exist — we never silently create directories.
#[tauri::command]
fn save_note(
    path: String,
    content: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);

    // Only allow saving markdown files
    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("save_note only accepts .md files".into());
    }

    // SECURITY: fail-closed — require a registered vault for all FS writes.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("save_note: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("save_note: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("save_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("save_note: path is outside the active vault.".into());
    }

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }

    fs::write(&resolved, content.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))
}

/// Read the full text content of a file at `path`.
///
/// SECURITY: Only allows reading `.md` files within the active vault.
#[tauri::command]
fn get_file_content(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("get_file_content only accepts .md files".into());
    }

    // SECURITY: fail-closed — require a registered vault for all FS reads.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("get_file_content: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_file_content: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("get_file_content: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("get_file_content: path is outside the active vault.".into());
    }
    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved.display()));
    }
    if resolved.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", resolved.display()));
    }

    fs::read_to_string(&resolved).map_err(|e| format!("Failed to read file: {e}"))
}

/// Read many `.md` files in **one** IPC round-trip for vault index enrichment.
///
/// Returns `Vec<String>` parallel to `paths`: each entry is the file body or
/// **empty string** if the path is not `.md`, outside the vault, missing, or
/// unreadable — matching `get_file_content(...).catch(() => "")` on the JS side.
///
/// SECURITY: Same boundary checks as `get_file_content`. At most 100 paths per call.
#[tauri::command]
fn get_file_contents_batch(
    paths: Vec<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    if paths.len() > 100 {
        return Err("get_file_contents_batch: at most 100 paths per call.".into());
    }

    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("get_file_contents_batch: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("get_file_contents_batch: {e}"))?;

    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let target = PathBuf::from(&path);
        if target.extension().and_then(|e| e.to_str()) != Some("md") {
            out.push(String::new());
            continue;
        }

        let resolved = match safe_resolve(&target) {
            Ok(r) => r,
            Err(_) => {
                out.push(String::new());
                continue;
            }
        };
        if !resolved.starts_with(&canon_v) {
            out.push(String::new());
            continue;
        }
        if !resolved.exists() || resolved.is_dir() {
            out.push(String::new());
            continue;
        }

        out.push(fs::read_to_string(&resolved).unwrap_or_default());
    }
    Ok(out)
}

// ── Name sanitisation ─────────────────────────────────────────────────────────

/// Validate that `name` is safe to use as a file or folder name.
///
/// SECURITY controls applied:
///  - Empty / oversized names rejected
///  - Path separators, null bytes, and `..`/`.` components blocked
///  - Windows reserved device names (CON, NUL, COM1 … LPT9) rejected
///    cross-platform so notes created on macOS/Linux are also safe on Windows
fn sanitize_name(name: &str) -> Result<String, String> {
    let s = name.trim().to_string();
    if s.is_empty() {
        return Err("Name cannot be empty.".into());
    }
    if s.len() > 255 {
        return Err("Name is too long (max 255 characters).".into());
    }
    // Block path separators, null bytes, and relative-path components
    if s.contains('/') || s.contains('\\') || s.contains('\0') || s == "." || s == ".." {
        return Err("Name contains invalid characters.".into());
    }
    // Block Windows reserved device names (including with extensions, e.g. NUL.md).
    // These cause silent failures or data loss on Windows even when cross-compiling.
    const WINDOWS_RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    // Compare stem only (strip any extension before comparing)
    let stem_upper = PathBuf::from(&s)
        .file_stem()
        .map(|s| s.to_string_lossy().to_uppercase())
        .unwrap_or_default();
    if WINDOWS_RESERVED.contains(&stem_upper.as_str()) {
        return Err(format!("'{s}' is a reserved system name and cannot be used."));
    }
    Ok(s)
}

// ── Vault & file creation ─────────────────────────────────────────────────────

/// Create a new vault folder at `parent_path/<name>` and return it as a VaultData.
///
/// SECURITY: `name` is sanitised; parent must exist and be a directory.
/// Records the new vault in `CurrentVault` after creation.
#[tauri::command]
fn create_vault(
    parent_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    let name = sanitize_name(&name)?;
    let parent = PathBuf::from(&parent_path);

    if !parent.is_dir() {
        return Err(format!("Parent is not a valid directory: {parent_path}"));
    }

    let vault = parent.join(&name);
    if vault.exists() {
        return Err(format!("'{name}' already exists in that location."));
    }

    fs::create_dir(&vault).map_err(|e| format!("Failed to create vault: {e}"))?;

    // Create default folder structure — errors are intentionally ignored so a
    // partially-created vault (e.g. permission edge-case) still opens cleanly.
    for default_dir in &["daily", "meetings", "summaries", "assets"] {
        let _ = fs::create_dir(vault.join(default_dir));
    }

    // Write the Metis vault marker so `open_vault` recognises this as a Metis
    // vault on every subsequent open.  Failure is non-fatal — the vault works
    // normally; the user would just see the conversion prompt next time.
    let _ = write_vault_meta(&vault);

    let vault_path_str = vault.to_string_lossy().to_string();

    // Record the vault path for this window so file-operation commands can
    // enforce the correct vault boundary.
    vault_state.0.lock().unwrap().insert(window.label().to_string(), vault_path_str.clone());

    let files = build_file_tree(&vault).unwrap_or_default();
    Ok(VaultData {
        path: vault_path_str,
        files,
        is_metis_vault: true,
        vault_hint: None,
        default_image_dir: default_image_dir_str(),
    })
}

/// Create a new .md file at `dir_path/<name>.md` with an optional starter body.
///
/// SECURITY: `name` is sanitised; extension is forced to .md; parent must exist and must be
/// inside the active vault (defence-in-depth against a compromised frontend).
#[tauri::command]
fn create_note(
    dir_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
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
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("create_note: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("create_note: {e}"))?;
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
fn create_folder(
    parent_path: String,
    name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let name = sanitize_name(&name)?;
    let parent = PathBuf::from(&parent_path);

    if !parent.is_dir() {
        return Err(format!("Parent is not a valid directory: {parent_path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("create_folder: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("create_folder: {e}"))?;
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

/// Delete a .md file or a vault sub-directory (recursively).
///
/// SECURITY: Vault boundary is enforced from server-side `CurrentVault` state so the
/// frontend cannot manipulate the boundary by passing a crafted `vault_path`.
/// Files must be within the vault and have an allowed extension; directories are
/// removed recursively only after confirming they are not the vault root.
#[tauri::command]
fn delete_path(
    path: String,
    #[allow(unused_variables)]
    vault_path: String, // kept for IPC compat; ignored in favour of server-side state
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);

    // SECURITY: fail-closed — never trust the frontend-supplied vault_path.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("delete_path: no vault registered for this window.")?;

    let vault = PathBuf::from(&trusted_vault_path);

    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let canon_v = canon_vault(&vault).map_err(|e| format!("delete_path: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("delete_path: {e}"))?;

    if resolved == canon_v {
        return Err("Cannot delete the vault root directory.".into());
    }
    if !resolved.starts_with(&canon_v) {
        return Err("Cannot delete files outside the vault.".into());
    }

    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).map_err(|e| format!("Failed to delete folder: {e}"))
    } else {
        if !is_allowed_ext(&resolved) {
            let ext = resolved.extension().and_then(|e| e.to_str()).unwrap_or("");
            return Err(format!("Deleting '.{ext}' files is not permitted."));
        }
        fs::remove_file(&resolved).map_err(|e| format!("Failed to delete file: {e}"))
    }
}

/// Move `src` into `dest_dir` (keeping its original filename).
///
/// SECURITY: Vault boundary is enforced from server-side `CurrentVault` state.
/// Validates that both source and destination are inside the active vault, and
/// prevents moving a folder into one of its own descendants.
#[tauri::command]
fn move_path(
    src: String,
    dest_dir: String,
    #[allow(unused_variables)]
    vault_path: String, // kept for IPC compat; ignored in favour of server-side state
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dest_dir_path = PathBuf::from(&dest_dir);

    // SECURITY: fail-closed — never trust the frontend-supplied vault_path.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("move_path: no vault registered for this window.")?;

    let vault = PathBuf::from(&trusted_vault_path);

    if !src_path.exists() {
        return Err(format!("Source does not exist: {src}"));
    }
    if !dest_dir_path.is_dir() {
        return Err(format!("Destination is not a directory: {dest_dir}"));
    }

    let canon_v = canon_vault(&vault).map_err(|e| format!("move_path: {e}"))?;
    let resolved_src = safe_resolve(&src_path).map_err(|e| format!("move_path: {e}"))?;
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

/// Rename a file or folder within the same parent directory.
///
/// SECURITY: `new_name` is sanitised; `path` must be inside the active vault;
/// the operation cannot move files across directories.
#[tauri::command]
fn rename_path(
    path: String,
    new_name: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let mut new_name = sanitize_name(&new_name)?;
    let target = PathBuf::from(&path);

    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    // SECURITY: fail-closed — require a registered vault.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock.get(window.label())
        .ok_or("rename_path: no vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("rename_path: {e}"))?;
    let resolved = safe_resolve(&target).map_err(|e| format!("rename_path: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("rename_path: path is outside the active vault.".into());
    }

    if resolved.is_file() {
        if let Some(stem) = PathBuf::from(&new_name).file_stem() {
            new_name = stem.to_string_lossy().to_string();
        }
        new_name.push_str(".md");
    }

    let parent = resolved.parent().ok_or("Cannot determine parent directory.")?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("'{new_name}' already exists."));
    }

    fs::rename(&resolved, &new_path).map_err(|e| format!("Failed to rename: {e}"))?;

    Ok(new_path.to_string_lossy().to_string())
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
async fn pick_folder(window: tauri::WebviewWindow) -> Option<String> {
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
fn reveal_in_finder(
    path: String,
    vault_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    // SECURITY: enforce active-vault containment even for reveal operations.
    let lock = vault_state.0.lock().unwrap();
    let active_vault = lock.get(window.label())
        .ok_or("reveal_in_finder: no vault registered for this window.")?
        .clone();
    drop(lock);
    let canon_v = canon_vault(&PathBuf::from(active_vault))
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
fn open_vault_window(
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
        .build()
        .map_err(|e| format!("Failed to open new vault window: {e}"))?;

    Ok(())
}

// ── External URL opener ───────────────────────────────────────────────────────

/// Open `url` in the OS default browser.
///
/// SECURITY: Only https URLs are accepted to prevent abuse
/// (e.g. `file://` or custom-protocol injection).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("Only http(s) URLs may be opened externally.".into());
    }
    open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))
}

/// Persist the vault-relative default folder for pasted/saved images.
#[tauri::command]
fn set_vault_default_image_dir(
    vault_path: String,
    relative_dir: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let rel = validate_relative_vault_dir(&relative_dir)?;

    let lock = vault_state.0.lock().unwrap();
    let trusted = lock
        .get(window.label())
        .ok_or("set_vault_default_image_dir: no vault registered for this window.")?
        .clone();
    drop(lock);

    if PathBuf::from(&vault_path) != PathBuf::from(&trusted) {
        return Err("set_vault_default_image_dir: vault path mismatch.".into());
    }

    let vault = PathBuf::from(&trusted);
    let canon_v = canon_vault(&vault).map_err(|e| format!("set_vault_default_image_dir: {e}"))?;
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
fn copy_files_to_folder(
    source_paths: Vec<String>,
    dest_dir: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<usize, String> {
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("copy_files_to_folder: no vault registered for this window.")?
        .clone();
    drop(lock);

    let vault = PathBuf::from(&vault_str);
    let canon_v = canon_vault(&vault).map_err(|e| format!("copy_files_to_folder: {e}"))?;

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

// ── Persona & settings persistence ───────────────────────────────────────────
//
// `personas.json` and `settings.json` are stored in the OS-level application
// data directory (e.g. ~/Library/Application Support/com.metis.app/ on macOS).
// This keeps user configuration outside the vault so it is shared across vaults.
//
// SECURITY: The settings file contains the user's AI API key stored as plain
// text, protected only by OS-level file permissions.
//
// BUILD ISOLATION: Debug builds write to a dedicated `dev/` subdirectory so
// that credentials entered during development are **never** visible to a
// release build.
//
//   Debug   → <AppData>/com.metis.app/dev/settings.json
//   Release → <AppData>/com.metis.app/settings.json
//
// This means you can configure test keys freely in dev without any risk of
// them appearing when you run `tauri build`.

fn app_data_file(app_handle: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    // Separate data directories for debug vs release so dev credentials are
    // completely isolated from the production data store.
    #[cfg(debug_assertions)]
    let dir = base.join("dev");
    #[cfg(not(debug_assertions))]
    let dir = base;

    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(dir.join(name))
}

#[tauri::command]
fn load_personas(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_data_file(&app_handle, "personas.json")?;
    if !path.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read personas: {e}"))
}

#[tauri::command]
fn save_personas(app_handle: tauri::AppHandle, json: String) -> Result<(), String> {
    // Validate that the payload is valid JSON before writing
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Invalid personas JSON: {e}"))?;
    let path = app_data_file(&app_handle, "personas.json")?;
    fs::write(&path, &json).map_err(|e| format!("Failed to save personas: {e}"))
}

#[tauri::command]
fn load_settings(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_data_file(&app_handle, "settings.json")?;
    if !path.exists() {
        return Ok("{}".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))
}

#[tauri::command]
fn save_settings(app_handle: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Invalid settings JSON: {e}"))?;
    let path = app_data_file(&app_handle, "settings.json")?;
    fs::write(&path, &json).map_err(|e| format!("Failed to save settings: {e}"))
}

// ── Smart context commands ────────────────────────────────────────────────────
//
// These replace the old `get_folder_md_contents` command with a two-command
// API that supports tiered context strategies on the TypeScript side:
//   1. get_file_summaries  — fast metadata scan (path, name, preview, char_count)
//   2. get_files_content   — fetch full content for a specific list of paths
//
// `get_folder_md_contents` is retained for backward compatibility.

/// Compact metadata record returned by `get_file_summaries`.
#[derive(Serialize, Clone)]
struct FileSummary {
    path: String,
    name: String,
    /// First 400 characters of the file — enough for title + opening lines.
    preview: String,
    char_count: usize,
}

/// Recursively (or shallowly) collect .md file metadata inside `folder_path`.
/// SECURITY: all collected paths are vault-boundary-checked before reading.
#[tauri::command]
fn get_file_summaries(
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
fn get_files_content(
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
fn get_folder_md_contents(
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

// ── Vault-wide search & replace ───────────────────────────────────────────────

/// A single matching line returned by `search_vault`.
#[derive(Serialize, Clone)]
struct SearchMatch {
    file_path: String,
    file_name: String,
    line_number: usize,
    line_content: String,
    match_start: usize,
    match_end: usize,
}

/// Per-file replacement summary returned by `replace_in_vault`.
#[derive(Serialize, Clone)]
struct ReplaceSummary {
    file_path: String,
    file_name: String,
    replacements: usize,
}

fn collect_md_paths(dir: &Path, vault: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with('.')) {
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

/// Full-text search across all `.md` files in the active vault.
///
/// SECURITY: Only searches within the vault boundary. Paths are canonicalized
/// and checked before reading. Results are capped at 1000 matches.
#[tauri::command]
fn search_vault(
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
fn replace_in_vault(
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

// ── Agent-initiated file writes ───────────────────────────────────────────────

/// Normalise a path without requiring the file to already exist.
/// Collapses `.` and `..` components so vault-boundary checks work correctly
/// on paths that were assembled by string concatenation rather than
/// `canonicalize()` (which would fail for non-existent files).
///
/// SECURITY: any `..` that would escape the root component causes the function
/// to return an error rather than silently accepting a path-traversal attack.
fn normalize_path(path: &Path) -> Result<PathBuf, String> {
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
fn safe_resolve(path: &Path) -> Result<PathBuf, String> {
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
fn canon_vault(vault: &Path) -> Result<PathBuf, String> {
    vault.canonicalize()
        .map_err(|e| format!("Cannot resolve vault path '{}': {e}", vault.display()))
}

/// Write (or create) a note at a vault-relative **or** absolute path.
///
/// Called by the AI agent on the user's behalf when the user explicitly
/// requests a file to be created or modified.
///
/// SECURITY controls:
///  - Path is normalised to resolve `..` before the vault-boundary check.
///  - Absolute paths that escape the vault are rejected.
///  - Relative paths are joined against the vault root — they can never
///    escape the vault boundary after normalisation.
///  - `.md` extension is enforced.
///  - Parent directories are created if they don't exist (but only within the
///    vault boundary).
///  - Returns the absolute path of the written file so the UI can open / refresh it.
#[tauri::command]
fn agent_write_note(
    rel_path: String,
    content: String,
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
    let canon_v = canon_vault(&vault).map_err(|e| format!("agent_write_note: {e}"))?;

    let raw = PathBuf::from(&rel_path);
    let joined = if raw.is_absolute() { raw } else { canon_v.join(&raw) };

    let mut target = normalize_path(&joined)?;

    if target.extension().and_then(|e| e.to_str()) != Some("md") {
        target.set_extension("md");
    }

    if !target.starts_with(&canon_v) {
        return Err("Path is outside the active vault.".into());
    }

    // Create parent directories within the vault (idempotent, safe)
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }

    // SECURITY: resolve after directory creation so symlinked parents cannot
    // redirect writes outside the active vault.
    let resolved = safe_resolve(&target).map_err(|e| format!("agent_write_note: {e}"))?;
    if !resolved.starts_with(&canon_v) {
        return Err("agent_write_note: resolved path is outside the active vault.".into());
    }

    fs::write(&resolved, content.as_bytes())
        .map_err(|e| format!("Failed to write note: {e}"))?;

    Ok(resolved.to_string_lossy().to_string())
}

// ── Asset saving (clipboard image paste) ─────────────────────────────────────

/// Decode a base-64 image string and write it to `<vault_path>/assets/<filename>`.
/// Returns the relative path used in Markdown image syntax, e.g. `assets/image.png`.
///
/// SECURITY: Extension is validated against an image allowlist; filename is
/// sanitised to prevent path traversal; base-64 data is decoded before writing.
/// The vault path is validated against server-side `CurrentVault` state so the
/// frontend cannot redirect asset writes to arbitrary filesystem locations.
#[tauri::command]
fn save_asset(
    vault_path: String,
    filename: String,
    data_base64: String,
    image_subdir: Option<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    // SECURITY: fail-closed — require a registered vault and verify it matches.
    let trusted_vault_path = {
        let lock = vault_state.0.lock().unwrap();
        lock.get(window.label()).cloned()
    }.ok_or("save_asset: no vault registered for this window.")?;

    let requested_vault = PathBuf::from(&vault_path);
    let trusted_vault = PathBuf::from(&trusted_vault_path);
    let canon_requested = canon_vault(&requested_vault)
        .map_err(|e| format!("save_asset: {e}"))?;
    let canon_trusted = canon_vault(&trusted_vault)
        .map_err(|e| format!("save_asset: {e}"))?;
    if canon_requested != canon_trusted {
        return Err("save_asset: vault path does not match the active vault.".into());
    }

    let vault = PathBuf::from(&trusted_vault_path);
    if !vault.is_dir() {
        return Err(format!("Invalid vault path: {vault_path}"));
    }
    let canon_v = canon_vault(&vault).map_err(|e| format!("save_asset: {e}"))?;

    // Sanitise the filename and validate image extension
    let name = sanitize_name(&filename)?;
    let ext = PathBuf::from(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("'.{ext}' is not an allowed image extension."));
    }

    // SECURITY: reject payloads whose base-64 encoding exceeds ~50 MB
    // (decoded ≈ 37.5 MB) to prevent memory exhaustion / disk fill.
    const MAX_BASE64_LEN: usize = 50 * 1024 * 1024;
    if data_base64.len() > MAX_BASE64_LEN {
        return Err("Asset is too large (max ~50 MB).".into());
    }

    let data = STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    if data.is_empty() {
        return Err("Image data is empty.".into());
    }

    let subdir = match image_subdir {
        Some(s) => validate_relative_vault_dir(&s)?,
        None => read_vault_meta(&vault)
            .map(|m| m.default_image_dir)
            .unwrap_or_else(|_| default_image_dir_str()),
    };

    let target_dir = canon_v.join(&subdir);
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create image folder '{subdir}': {e}"))?;
    }
    let resolved_dir = safe_resolve(&target_dir).map_err(|e| format!("save_asset: {e}"))?;
    if !resolved_dir.starts_with(&canon_v) {
        return Err("save_asset: image directory escapes vault boundary.".into());
    }

    let target = resolved_dir.join(&name);
    fs::write(&target, &data)
        .map_err(|e| format!("Failed to save asset: {e}"))?;

    Ok(format!("{subdir}/{name}"))
}

// ── Spellcheck (Hunspell via spellbook) ───────────────────────────────────────

/// Lazily-loaded Hunspell dictionaries, keyed by language code (e.g. "en_US").
/// Each dictionary is loaded once from bundled resource files and kept for the
/// lifetime of the process.
static DICTIONARIES: OnceLock<Mutex<HashMap<String, spellbook::Dictionary>>> = OnceLock::new();

/// Discover bundled dictionary language codes (e.g. "en_US").
fn discover_dictionary_languages() -> Vec<String> {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let exe_dir = match exe.parent() {
        Some(d) => d.to_path_buf(),
        None => return vec![],
    };

    let candidates = [
        exe_dir.join("resources/dictionaries"),
        exe_dir.join("../Resources/resources/dictionaries"),
        PathBuf::from("src-tauri/resources/dictionaries"),
    ];

    let dir = match candidates.iter().find(|p| p.is_dir()) {
        Some(d) => d,
        None => return vec![],
    };

    let mut langs: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if !entry.path().is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let aff = entry.path().join(format!("{name}.aff"));
            let dic = entry.path().join(format!("{name}.dic"));
            if aff.exists() && dic.exists() {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    langs.sort();
    langs
}

fn validate_dictionary_language(raw: &str) -> Result<String, String> {
    let lang = raw.trim();
    if lang.is_empty() || lang.len() > 32 {
        return Err("Invalid dictionary language.".into());
    }
    if !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Dictionary language contains invalid characters.".into());
    }
    let available = discover_dictionary_languages();
    if !available.iter().any(|d| d == lang) {
        return Err(format!("Unsupported dictionary language: {lang}"));
    }
    Ok(lang.to_string())
}

/// Load a Hunspell dictionary from the bundled resources directory.
/// Dictionary files live at `resources/dictionaries/<lang>/<lang>.aff` and `.dic`.
fn load_dictionary(lang: &str) -> Result<spellbook::Dictionary, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot locate exe: {e}"))?;
    let exe_dir = exe.parent().ok_or("Cannot locate exe directory")?;

    // In dev builds (cargo/tauri dev), resources are at `src-tauri/resources/`.
    // In production bundles, Tauri copies them next to the binary.
    let candidates = [
        exe_dir.join(format!("resources/dictionaries/{lang}/{lang}.aff")),
        exe_dir
            .join("../Resources")
            .join(format!("resources/dictionaries/{lang}/{lang}.aff")),
        PathBuf::from(format!(
            "src-tauri/resources/dictionaries/{lang}/{lang}.aff"
        )),
    ];

    let base = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("Dictionary files not found for '{lang}'"))?
        .parent()
        .unwrap()
        .to_path_buf();

    let aff = fs::read_to_string(base.join(format!("{lang}.aff")))
        .map_err(|e| format!("Failed to read {lang}.aff: {e}"))?;
    let dic = fs::read_to_string(base.join(format!("{lang}.dic")))
        .map_err(|e| format!("Failed to read {lang}.dic: {e}"))?;

    spellbook::Dictionary::new(&aff, &dic)
        .map_err(|e| format!("Failed to parse dictionary '{lang}': {e}"))
}

fn get_or_load_dict(lang: &str) -> Result<(), String> {
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = map_mutex.lock().unwrap();
    if !map.contains_key(lang) {
        let dict = load_dictionary(lang)?;
        map.insert(lang.to_string(), dict);
    }
    Ok(())
}

/// Check a batch of words against a Hunspell dictionary.
/// Returns only the words that are NOT in the dictionary.
/// The `language` parameter selects which dictionary to use (e.g. "en_US", "en_GB").
#[tauri::command]
fn check_spelling(words: Vec<String>, language: String) -> Result<Vec<String>, String> {
    const MAX_WORDS: usize = 10_000;
    const MAX_WORD_LEN: usize = 128;
    if words.len() > MAX_WORDS {
        return Err(format!("Too many words provided (max {MAX_WORDS})."));
    }
    let language = validate_dictionary_language(&language)?;
    get_or_load_dict(&language)?;
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let map = map_mutex.lock().unwrap();
    let dict = map
        .get(&language)
        .ok_or_else(|| format!("Dictionary '{language}' not loaded"))?;

    Ok(words
        .into_iter()
        .filter(|w| {
            if w.len() > MAX_WORD_LEN {
                return false;
            }
            w.len() > 1
                && w.chars().all(|c| c.is_alphabetic() || c == '\'' || c == '\u{2019}')
                && !dict.check(w)
        })
        .collect())
}

/// Return spelling suggestions for a batch of misspelled words.
/// For each input word, returns up to 5 Hunspell suggestions.
/// The result is a map from each word to its suggestion list.
#[tauri::command]
fn suggest_spelling(
    words: Vec<String>,
    language: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    const MAX_SUGGESTIONS: usize = 5;
    const MAX_WORDS: usize = 50;

    let language = validate_dictionary_language(&language)?;
    get_or_load_dict(&language)?;
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let map = map_mutex.lock().unwrap();
    let dict = map
        .get(&language)
        .ok_or_else(|| format!("Dictionary '{language}' not loaded"))?;

    let mut result = HashMap::new();
    for word in words.iter().take(MAX_WORDS) {
        let mut suggestions = Vec::new();
        dict.suggest(word, &mut suggestions);
        suggestions.truncate(MAX_SUGGESTIONS);
        result.insert(word.clone(), suggestions);
    }

    Ok(result)
}

/// Return the list of available dictionary language codes by scanning the
/// bundled resources directory.
#[tauri::command]
fn list_dictionaries() -> Vec<String> {
    discover_dictionary_languages()
}

// ── File-system watcher ───────────────────────────────────────────────────────

/// Start (or replace) a recursive watcher on the vault at `path`.
/// Emits a `vault-changed` event to the frontend for structural changes only
/// (create / remove / rename) — content saves do NOT trigger a refresh.
///
/// SECURITY: Validates path is an existing directory before watching.
#[tauri::command]
fn set_vault_watch(
    path: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WatcherState>,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    // SECURITY: only allow watching the vault currently registered for this
    // window so arbitrary directories cannot be watched via IPC.
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("set_vault_watch: no vault registered for this window.")?
        .clone();
    drop(lock);
    let canon_v = canon_vault(&PathBuf::from(vault_str))
        .map_err(|e| format!("set_vault_watch: {e}"))?;
    let root_resolved = safe_resolve(&root).map_err(|e| format!("set_vault_watch: {e}"))?;
    if root_resolved != canon_v {
        return Err("set_vault_watch: path must match the active vault root.".into());
    }

    let label = window.label().to_string();
    // Clone the window handle so the watcher closure can emit events to THIS
    // window only, keeping each open vault's change-stream isolated.
    let window_clone = window.clone();

    // Only emit for structural changes — avoids a refresh loop when the editor
    // saves note content (those fire Modify(Data) events, not Create/Remove/Rename).
    let mut watcher = notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // In notify v6, renames are Modify(Name(_)); exclude data-only
                // writes so editor autosaves don't trigger a sidebar refresh.
                let structural = matches!(
                    event.kind,
                    notify::EventKind::Create(_)
                        | notify::EventKind::Remove(_)
                        | notify::EventKind::Modify(
                            notify::event::ModifyKind::Name(_)
                        )
                );
                if structural {
                    // Emit only to the specific window that owns this vault.
                    let _ = window_clone.emit("vault-changed", ());
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(&root_resolved, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    // Replace any previous watcher for this window (dropping it stops the old watch).
    state.0.lock().unwrap().insert(label, watcher);

    Ok(())
}

// ── Vault conversion ──────────────────────────────────────────────────────────

/// Convert a foreign (non-Metis) markdown vault to a Metis vault by:
///   1. Writing the `.metis/vault.json` identification marker
///   2. Creating the default folder structure (`daily`, `meetings`, `summaries`, `assets`)
///   3. Optionally enriching every `.md` file's frontmatter with `parent` (derived
///      from its containing folder) and `date` (from filesystem ctime or today).
///      Only fields that are absent in the existing frontmatter are injected;
///      no existing metadata is ever overwritten.  No `status` is set by default.
///
/// Progress is reported via `convert-vault-progress` Tauri events so the
/// frontend can display a live progress bar without blocking the UI thread.
///
/// SECURITY: `vault_path` is validated to be an existing directory.  The
/// helper `enrich_frontmatter` never overwrites fields already present in a
/// note's frontmatter, preventing accidental data loss.
#[tauri::command]
fn convert_vault_to_metis(
    vault_path: String,
    add_metadata: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultData, String> {
    let requested_root = PathBuf::from(&vault_path);
    if !requested_root.exists() {
        return Err(format!("Path does not exist: {vault_path}"));
    }
    if !requested_root.is_dir() {
        return Err(format!("Path is not a directory: {vault_path}"));
    }

    // SECURITY: fail-closed conversion boundary.
    // Conversion mutates the vault folder, so it must be bound to the currently
    // registered vault for this window (same trust model as other mutating
    // commands). We compare canonical paths to block alias/symlink tricks.
    let lock = vault_state.0.lock().unwrap();
    let active_vault = lock
        .get(window.label())
        .ok_or("convert_vault_to_metis: no vault registered for this window.")?
        .clone();
    drop(lock);

    let active_canon = canon_vault(&PathBuf::from(&active_vault))
        .map_err(|e| format!("convert_vault_to_metis: {e}"))?;
    let requested_canon =
        safe_resolve(&requested_root).map_err(|e| format!("convert_vault_to_metis: {e}"))?;
    if requested_canon != active_canon {
        return Err("convert_vault_to_metis: requested path does not match active vault.".into());
    }
    let root = requested_canon;

    // Collect .md files upfront so we know the total for accurate progress.
    let md_files: Vec<PathBuf> = if add_metadata {
        collect_md_files(&root)
    } else {
        vec![]
    };

    // Total steps: marker + folders + (optionally) one step per .md file + finalise
    let total = 2 + md_files.len() + 1;
    let mut current = 0usize;

    let emit = |step: &str, cur: usize| {
        let _ = window.emit(
            "convert-vault-progress",
            ConvertProgress {
                step: step.to_string(),
                current: cur,
                total,
            },
        );
    };

    // ── Step 1: Write vault marker ────────────────────────────────────────────
    emit("Writing vault marker…", current);
    write_vault_meta(&root)?;
    current += 1;

    // ── Step 2: Create default folder structure ───────────────────────────────
    emit("Creating default folders…", current);
    for dir in &["daily", "meetings", "summaries", "assets"] {
        let _ = fs::create_dir(root.join(dir));
    }
    current += 1;

    // ── Steps 3..N: Enrich frontmatter ───────────────────────────────────────
    for file_path in &md_files {
        let display_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("note.md");
        emit(&format!("Updating metadata: {display_name}"), current);

        if let Ok(content) = fs::read_to_string(file_path) {
            let updated = enrich_frontmatter(&content, file_path, &root);
            // Only write back if the content actually changed
            if updated != content {
                let _ = fs::write(file_path, updated.as_bytes());
            }
        }
        current += 1;
    }

    // ── Final step: Build tree ────────────────────────────────────────────────
    emit("Finalising…", current);

    // Register the converted vault for this window's vault-boundary enforcement
    vault_state
        .0
        .lock()
        .unwrap()
        .insert(window.label().to_string(), root.to_string_lossy().to_string());

    let files = build_file_tree(&root)?;
    Ok(VaultData {
        path: root.to_string_lossy().to_string(),
        files,
        is_metis_vault: true,
        vault_hint: None,
        default_image_dir: read_vault_meta(&root)
            .map(|m| m.default_image_dir)
            .unwrap_or_else(|_| default_image_dir_str()),
    })
}

// ── Native application menu ───────────────────────────────────────────────────

/// Build the full native menu for the application window.
///
/// Custom items emit a `menu-event` Tauri event with a string payload so the
/// frontend hook can handle them without any extra IPC round-trips.
/// Predefined items (Undo, Copy, Minimize, etc.) are handled natively by the
/// OS / webview and do not need frontend wiring.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // ── macOS: app-name menu (always the first menu on macOS) ─────────────────
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "Metis")
        .item(&PredefinedMenuItem::about(
            app,
            None,
            Some(AboutMetadata {
                name: Some("Metis".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                short_version: None,
                authors: Some(vec!["Kyhle Öhlinger".into()]),
                comments: Some("A local-first, AI-augmented personal knowledge ecosystem.".into()),
                copyright: Some("© 2026 Kyhle Öhlinger".into()),
                license: Some("MIT".into()),
                website: Some("https://ohlinger.co".into()),
                website_label: Some("ohlinger.co".into()),
                credits: None,
                icon: None,
            }),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // ── File ──────────────────────────────────────────────────────────────────
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_note", "New Note")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_folder", "New Folder")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_vault", "Open Vault…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_vault", "New Vault…")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("daily_note", "Open Daily Note")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("reveal_in_finder", "Reveal in Finder")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // ── Edit ──────────────────────────────────────────────────────────────────
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // ── View ──────────────────────────────────────────────────────────────────
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_panel", "Toggle Panel")
                .accelerator("CmdOrCtrl+Shift+\\")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("source_mode", "Source Mode")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("visual_mode", "Visual Mode")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // ── Window ────────────────────────────────────────────────────────────────
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    // ── Help ──────────────────────────────────────────────────────────────────
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::with_id("open_docs", "Metis Documentation")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_github", "GitHub — Kyhle Öhlinger")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_website", "Website — ohlinger.co")
                .build(app)?,
        )
        .build()?;

    // Assemble — macOS prepends the app-name menu automatically
    #[cfg(target_os = "macos")]
    return MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build();

    #[cfg(not(target_os = "macos"))]
    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Native HTTP client — routes AI provider requests through Rust (reqwest)
        // so they bypass WebKit's CORS enforcement in production builds.
        .plugin(tauri_plugin_http::init())
        // Per-window watcher map — each open window watches its own vault independently
        .manage(WatcherState(Mutex::new(HashMap::new())))
        // Per-window vault path map — vault-boundary checks are scoped to the invoking window
        .manage(CurrentVault(Mutex::new(HashMap::new())))
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        // Forward custom menu item clicks to the frontend as "menu-event" events.
        // Predefined items (Undo, Copy, Minimize, etc.) are handled natively and
        // never reach this handler.
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();

            // Items handled directly in Rust — no frontend round-trip needed.
            match id {
                "open_github"  => { let _ = open::that("https://github.com/kyhleOhlinger"); return; }
                "open_website" => { let _ = open::that("https://ohlinger.co"); return; }

                // Open the bundled help.html in a dedicated lightweight window.
                // The label "metis-help" prevents duplicate windows: if one is
                // already open, get_webview_window returns Some and we focus it.
                "open_docs" => {
                    if let Some(win) = app.get_webview_window("metis-help") {
                        let _ = win.set_focus();
                    } else {
                        let _ = tauri::WebviewWindowBuilder::new(
                            app,
                            "metis-help",
                            tauri::WebviewUrl::App("help.html".into()),
                        )
                        .title("Metis — Help")
                        .inner_size(960.0, 720.0)
                        .min_inner_size(600.0, 480.0)
                        .resizable(true)
                        .build();
                    }
                    return;
                }

                _ => {}
            }

            // All other items are forwarded to the frontend as "menu-event".
            let action = match id {
                "new_note"          => Some("new-note"),
                "new_folder"        => Some("new-folder"),
                "open_vault"        => Some("open-vault"),
                "new_vault"         => Some("new-vault"),
                "save"              => Some("save"),
                "daily_note"        => Some("daily-note"),
                "reveal_in_finder"  => Some("reveal-in-finder"),
                "toggle_sidebar"    => Some("toggle-sidebar"),
                "toggle_panel"      => Some("toggle-panel"),
                "source_mode"       => Some("source-mode"),
                "visual_mode"       => Some("visual-mode"),
                // open_docs / open_github / open_website are handled above
                _                   => None,
            };
            if let Some(action) = action {
                let _ = app.emit("menu-event", action);
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            reveal_in_finder,
            open_url,
            open_vault_window,
            open_vault,
            convert_vault_to_metis,
            load_personas,
            save_personas,
            load_settings,
            save_settings,
            get_file_summaries,
            get_files_content,
            get_folder_md_contents,
            save_note,
            get_file_content,
            get_file_contents_batch,
            create_vault,
            create_note,
            create_folder,
            delete_path,
            rename_path,
            move_path,
            save_asset,
            set_vault_default_image_dir,
            copy_files_to_folder,
            agent_write_note,
            set_vault_watch,
            search_vault,
            replace_in_vault,
            check_spelling,
            suggest_spelling,
            list_dictionaries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Metis");
}
