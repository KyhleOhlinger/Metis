// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.

//! Binds a vault path to the folder that was actually approved.
//!
//! The first time a path is seen, later decisions keep using that path so
//! existing approvals still match. If a different folder is later placed at
//! the same path, decisions use a new id and the old approval does not carry
//! over.

use crate::security::write_private_json_file;
use crate::settings::app_data_dir_for_build;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
struct Binding {
    path: String,
    dev: u64,
    ino: u64,
    /// Empty while the original folder is still at `path`. A replacement gets
    /// `replaced:<id>` and that string is the decision key from then on.
    id: String,
}

#[derive(Default, Serialize, Deserialize)]
struct BindingFile {
    bindings: Vec<Binding>,
}

fn binding_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app)?.join("vault-bindings.json"))
}

fn load(app: &AppHandle) -> BindingFile {
    let Ok(path) = binding_path(app) else {
        return BindingFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return BindingFile::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save(app: &AppHandle, file: &BindingFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| format!("Cannot save vault binding: {e}"))?;
    write_private_json_file(&binding_path(app)?, &json)
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("replaced:{nanos}")
}

#[cfg(unix)]
fn file_id(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path).ok()?;
    Some((meta.dev(), meta.ino()))
}

#[cfg(windows)]
fn file_id(path: &Path) -> Option<(u64, u64)> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::metadata(path).ok()?;
    // Volume serial plus file index identifies the folder. Directory length is
    // always 0 on Windows, so it cannot tell a replacement folder from the old one.
    let volume = u64::from(meta.volume_serial_number()?);
    let index = meta.file_index()?;
    Some((volume, index))
}

#[cfg(not(any(unix, windows)))]
fn file_id(_path: &Path) -> Option<(u64, u64)> {
    None
}

/// Key for approvals, backup options, and never-send folders.
pub(crate) fn decision_key(app: &AppHandle, vault: &Path) -> String {
    let path = crate::security::canon_vault(vault)
        .map(|canon| canon.to_string_lossy().into_owned())
        .unwrap_or_else(|_| vault.to_string_lossy().into_owned());
    let Some((dev, ino)) = file_id(Path::new(&path)) else {
        return path;
    };
    let mut file = load(app);
    if let Some(existing) = file.bindings.iter_mut().find(|binding| binding.path == path) {
        if existing.dev == dev && existing.ino == ino {
            if existing.id.is_empty() {
                return path;
            }
            return existing.id.clone();
        }
        let id = new_id();
        existing.dev = dev;
        existing.ino = ino;
        existing.id = id.clone();
        let _ = save(app, &file);
        return id;
    }
    file.bindings.push(Binding {
        path: path.clone(),
        dev,
        ino,
        id: String::new(),
    });
    let _ = save(app, &file);
    path
}
