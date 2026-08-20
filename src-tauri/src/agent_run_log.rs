use crate::security::{write_private_json_file, write_private_json_file_capped};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_ENTRIES: usize = 1000;
const MAX_RUN_ID_LEN: usize = 80;
/// Transcripts include retrieved context + full replies; larger than settings JSON.
const MAX_TRANSCRIPT_BYTES: usize = 8 * 1024 * 1024;

fn app_data_dir_for_build(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    #[cfg(debug_assertions)]
    let dir = base.join("dev");
    #[cfg(not(debug_assertions))]
    let dir = base;

    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(dir)
}

fn log_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app_handle)?.join("agent-run-log.json"))
}

fn transcripts_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir_for_build(app_handle)?.join("agent-run-transcripts");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create transcript dir: {e}"))?;
    Ok(dir)
}

/// Run ids are used as filenames. Reject anything that is not `[A-Za-z0-9_-]`.
fn validate_run_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_RUN_ID_LEN {
        return Err("Invalid run id.".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid run id.".into());
    }
    Ok(())
}

fn transcript_path(dir: &Path, run_id: &str) -> Result<PathBuf, String> {
    validate_run_id(run_id)?;
    Ok(dir.join(format!("{run_id}.json")))
}

fn entry_id(entry: &Value) -> Option<&str> {
    entry.get("id").and_then(|v| v.as_str())
}

fn remove_transcript(dir: &Path, run_id: &str) {
    if validate_run_id(run_id).is_err() {
        return;
    }
    let path = dir.join(format!("{run_id}.json"));
    let _ = fs::remove_file(path);
}

#[tauri::command]
pub fn load_agent_run_log(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = log_path(&app_handle)?;
    if !path.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read agent run log: {e}"))
}

#[tauri::command]
pub fn append_agent_run_log(
    app_handle: tauri::AppHandle,
    entry_json: String,
    transcript_json: Option<String>,
) -> Result<(), String> {
    let mut entry: Value = serde_json::from_str(&entry_json)
        .map_err(|e| format!("Invalid agent run log entry: {e}"))?;

    let id = entry_id(&entry).unwrap_or("").to_string();
    validate_run_id(&id)?;

    let wrote_transcript = if let Some(raw) = transcript_json {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed == "null" {
            false
        } else {
            let dir = transcripts_dir(&app_handle)?;
            let path = transcript_path(&dir, &id)?;
            write_private_json_file_capped(&path, &raw, MAX_TRANSCRIPT_BYTES)?;
            true
        }
    } else {
        false
    };

    if let Some(obj) = entry.as_object_mut() {
        obj.insert("hasTranscript".into(), Value::Bool(wrote_transcript));
    }

    let path = log_path(&app_handle)?;
    let mut entries: Vec<Value> = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read agent run log: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };

    entries.retain(|e| entry_id(e) != Some(id.as_str()));
    entries.insert(0, entry);

    let dropped = if entries.len() > MAX_ENTRIES {
        entries.split_off(MAX_ENTRIES)
    } else {
        Vec::new()
    };

    if !dropped.is_empty() {
        if let Ok(dir) = transcripts_dir(&app_handle) {
            for old in dropped {
                if let Some(old_id) = entry_id(&old) {
                    remove_transcript(&dir, old_id);
                }
            }
        }
    }

    let out = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize agent run log: {e}"))?;
    write_private_json_file(&path, &out)
}

#[tauri::command]
pub fn load_agent_run_transcript(
    app_handle: tauri::AppHandle,
    run_id: String,
) -> Result<String, String> {
    validate_run_id(&run_id)?;
    let dir = transcripts_dir(&app_handle)?;
    let path = transcript_path(&dir, &run_id)?;
    if !path.exists() {
        return Err("No transcript stored for this run.".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read transcript: {e}"))
}

#[tauri::command]
pub fn clear_agent_run_log(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = log_path(&app_handle)?;
    write_private_json_file(&path, "[]")?;
    let dir = app_data_dir_for_build(&app_handle)?.join("agent-run-transcripts");
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to clear transcripts: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_id_accepts_generated_ids() {
        assert!(validate_run_id("run-1755712345678-abc123").is_ok());
        assert!(validate_run_id("run_1").is_ok());
    }

    #[test]
    fn run_id_rejects_traversal_and_empty() {
        assert!(validate_run_id("").is_err());
        assert!(validate_run_id("../etc/passwd").is_err());
        assert!(validate_run_id("run/1").is_err());
        assert!(validate_run_id("run\\1").is_err());
        assert!(validate_run_id(&"x".repeat(MAX_RUN_ID_LEN + 1)).is_err());
    }
}
