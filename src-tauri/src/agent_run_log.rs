use crate::security::{reject_untrusted_webview, write_private_json_file, write_private_json_file_capped};
use crate::settings::app_data_dir_for_build;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 1000;
const MAX_RUN_ID_LEN: usize = 80;
/// One transcript stays under this size. The whole folder stays under the total below.
const MAX_TRANSCRIPT_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOTAL_TRANSCRIPT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

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
pub fn load_agent_run_log(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let path = log_path(&app_handle)?;
    if !path.exists() {
        return Ok("[]".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read agent run log: {e}"))?;
    let mut entries: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
    let dir = transcripts_dir(&app_handle).ok();
    let dropped = prune_entries(&mut entries, dir.as_deref());
    if !dropped.is_empty() {
        if let Some(dir) = dir.as_ref() {
            for old in dropped {
                if let Some(old_id) = entry_id(&old) {
                    remove_transcript(dir, old_id);
                }
            }
        }
        if let Ok(out) = serde_json::to_string_pretty(&entries) {
            let _ = write_private_json_file(&path, &out);
        }
    }
    serde_json::to_string(&entries).map_err(|e| format!("Failed to read agent run log: {e}"))
}

#[tauri::command]
pub fn append_agent_run_log(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    entry_json: String,
    transcript_json: Option<String>,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
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
    let dir = transcripts_dir(&app_handle).ok();
    let dropped = prune_entries(&mut entries, dir.as_deref());
    if let Some(dir) = dir.as_ref() {
        for old in dropped {
            if let Some(old_id) = entry_id(&old) {
                remove_transcript(dir, old_id);
            }
        }
    }

    let out = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize agent run log: {e}"))?;
    write_private_json_file(&path, &out)
}

#[tauri::command]
pub fn load_agent_run_transcript(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    run_id: String,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    validate_run_id(&run_id)?;
    let dir = transcripts_dir(&app_handle)?;
    let path = transcript_path(&dir, &run_id)?;
    if !path.exists() {
        return Err("No transcript stored for this run.".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read transcript: {e}"))
}

fn entry_started_ms(entry: &Value) -> Option<u64> {
    let value = entry.get("startedAt")?;
    value
        .as_u64()
        .or_else(|| value.as_i64().filter(|n| *n >= 0).map(|n| n as u64))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn transcript_len(dir: Option<&Path>, entry: &Value) -> u64 {
    let Some(dir) = dir else {
        return 0;
    };
    let Some(id) = entry_id(entry) else {
        return 0;
    };
    let Ok(path) = transcript_path(dir, id) else {
        return 0;
    };
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Drop runs older than 30 days, then the oldest runs until the transcript folder is under 32 MiB.
fn prune_entries(entries: &mut Vec<Value>, dir: Option<&Path>) -> Vec<Value> {
    let cutoff = now_ms().saturating_sub(MAX_AGE_MS);
    let mut dropped = Vec::new();
    entries.retain(|entry| match entry_started_ms(entry) {
        Some(started) if started < cutoff => {
            dropped.push(entry.clone());
            false
        }
        _ => true,
    });
    if entries.len() > MAX_ENTRIES {
        dropped.extend(entries.split_off(MAX_ENTRIES));
    }
    let mut total: u64 = entries.iter().map(|entry| transcript_len(dir, entry)).sum();
    while total > MAX_TOTAL_TRANSCRIPT_BYTES && !entries.is_empty() {
        let Some(old) = entries.pop() else {
            break;
        };
        total = total.saturating_sub(transcript_len(dir, &old));
        dropped.push(old);
    }
    dropped
}

fn entry_in_vault(entry: &Value, vault: &Path) -> bool {
    let Some(raw) = entry.get("vaultPath").and_then(|value| value.as_str()) else {
        return false;
    };
    if raw == vault.to_string_lossy() {
        return true;
    }
    std::path::Path::new(raw)
        .canonicalize()
        .map(|canon| canon == vault)
        .unwrap_or(false)
}

#[tauri::command]
pub fn delete_agent_runs_for_vault(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    vault_state: tauri::State<'_, crate::state::CurrentVault>,
) -> Result<(), String> {
    crate::security::reject_untrusted_webview(&window)?;
    let vault = crate::security::registered_vault(&window, &vault_state)?;
    let path = log_path(&app_handle)?;
    let mut entries: Vec<Value> = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read agent run log: {e}"))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Vec::new()
    };
    let removed: Vec<Value> = entries
        .iter()
        .filter(|entry| entry_in_vault(entry, &vault))
        .cloned()
        .collect();
    entries.retain(|entry| !entry_in_vault(entry, &vault));
    if let Ok(dir) = transcripts_dir(&app_handle) {
        for old in removed {
            if let Some(old_id) = entry_id(&old) {
                remove_transcript(&dir, old_id);
            }
        }
    }
    let out = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize agent run log: {e}"))?;
    write_private_json_file(&path, &out)
}

#[tauri::command]
pub fn clear_agent_run_log(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
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

    #[test]
    fn old_runs_are_dropped() {
        let old = serde_json::json!({"id": "old", "startedAt": 1});
        let fresh = serde_json::json!({"id": "fresh", "startedAt": now_ms()});
        let mut entries = vec![fresh, old];
        let dropped = prune_entries(&mut entries, None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entry_id(&entries[0]), Some("fresh"));
        assert_eq!(dropped.len(), 1);
    }
}
