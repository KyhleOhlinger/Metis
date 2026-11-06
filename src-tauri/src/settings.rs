use crate::security::{reject_untrusted_webview, write_private_json_file};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

static SETTINGS_IO: Mutex<()> = Mutex::new(());

const SETTING_KEYS: &[&str] = &[
    "defaultProviderProfileId",
    "quickActions",
    "quickActionScopeDefault",
    "storeAiHistory",
    "aiHistoryMaxResponseChars",
    "spellcheckLanguage",
    "spellcheckEnabled",
    "editorBgPresetId",
    "editorBgCustomColor",
    "stickyDefaults",
    "jekyllBlogRoot",
    "jekyllAuthor",
    "jekyllDefaultCategories",
    "jekyllImageSubfolder",
    "jekyllSiteUrl",
    "jekyllDescription",
    "keybindingOverrides",
    "plannerAiExcludedSections",
    "sourceUpdateCheckEnabled",
    "sourceUpdateDismissedVersion",
    "supernoteDeviceIp",
    "supernoteDevicePort",
    "supernoteSyncIntervalMinutes",
    "allowedAiHosts",
];

// ── Persona & settings persistence ───────────────────────────────────────────
//
// `personas.json` and `settings.json` are stored in the OS-level application
// data directory (e.g. ~/Library/Application Support/com.metis.desktop/ on macOS).
// This keeps user configuration outside the vault so it is shared across vaults.
//
// SECURITY: The settings file contains the user's AI API key stored as plain
// text, protected only by OS-level file permissions.
//
// BUILD ISOLATION: Debug builds write to a dedicated `dev/` subdirectory so
// that credentials entered during development are **never** visible to a
// release build.
//
//   Debug   → <AppData>/com.metis.desktop/dev/settings.json
//   Release → <AppData>/com.metis.desktop/settings.json
//
// This means you can configure test keys freely in dev without any risk of
// them appearing when you run `tauri build`.

pub(crate) fn app_data_dir_for_build(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn app_data_file(app_handle: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app_handle)?.join(name))
}

fn io_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    SETTINGS_IO.lock().map_err(|_| "Settings are busy.".into())
}

fn read_json_value(path: &Path, fallback: Value) -> Result<Value, String> {
    if !path.exists() {
        return Ok(fallback);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&raw).unwrap_or(fallback))
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| format!("Failed to encode settings: {e}"))?;
    write_private_json_file(path, &json)
}

fn emit_changed(app: &tauri::AppHandle) {
    let _ = app.emit("settings-changed", ());
}

/// Shipped preset ids stay on their vendor host. Custom `prov-*` profiles are not pinned.
fn preset_host_error(profile: &Value) -> Result<(), String> {
    let id = profile.get("id").and_then(|value| value.as_str()).unwrap_or("");
    let pinned = match id {
        "preset-openai" => "api.openai.com",
        "preset-gemini" => "generativelanguage.googleapis.com",
        "preset-groq" => "api.groq.com",
        "preset-perplexity" => "api.perplexity.ai",
        "preset-anthropic" => "api.anthropic.com",
        "preset-litellm" => "loopback",
        _ => return Ok(()),
    };
    let base = profile.get("baseUrl").and_then(|value| value.as_str()).unwrap_or("");
    let url = url::Url::parse(base).map_err(|_| "Invalid provider Base URL.".to_string())?;
    let host = url.host_str().unwrap_or("");
    if pinned == "loopback" {
        if matches!(host, "localhost" | "127.0.0.1" | "::1") {
            return Ok(());
        }
        return Err(format!(
            "The local preset stays on this computer. {host} was rejected."
        ));
    }
    if host != pinned {
        return Err(format!("This preset only talks to {pinned}."));
    }
    Ok(())
}

fn object_mut(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("settings object")
}

/// Application semver from `Cargo.toml` (matches native About dialog).
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

#[tauri::command]
pub fn load_personas(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let path = app_data_file(&app_handle, "personas.json")?;
    if !path.exists() {
        return Ok("[]".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read personas: {e}"))
}

#[tauri::command]
pub fn upsert_persona(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    persona_json: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let persona: Value = serde_json::from_str(&persona_json)
        .map_err(|e| format!("Invalid persona: {e}"))?;
    let id = persona
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or("Persona is missing an id.")?
        .to_string();
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "personas.json")?;
    let mut file = read_json_value(&path, Value::Array(Vec::new()))?;
    let list = file.as_array_mut().ok_or("Personas file is invalid.")?;
    if let Some(existing) = list.iter_mut().find(|item| item.get("id").and_then(|v| v.as_str()) == Some(id.as_str())) {
        *existing = persona;
    } else {
        list.push(persona);
    }
    write_json_value(&path, &file)?;
    emit_changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn delete_persona(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "personas.json")?;
    let mut file = read_json_value(&path, Value::Array(Vec::new()))?;
    let list = file.as_array_mut().ok_or("Personas file is invalid.")?;
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    write_json_value(&path, &file)?;
    emit_changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn load_settings(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "settings.json")?;
    if !path.exists() {
        return Ok("{}".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    grant_saved_hosts(&app_handle, &raw);
    Ok(raw)
}

fn grant_saved_hosts(app: &tauri::AppHandle, raw: &str) {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let Some(list) = value.get("providerProfiles").and_then(|item| item.as_array()) else {
        return;
    };
    for profile in list {
        if let Some(base) = profile.get("baseUrl").and_then(|item| item.as_str()) {
            let _ = crate::shell::allow_ai_host(app, base);
        }
    }
}

#[tauri::command]
pub fn update_setting(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    key: String,
    value_json: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err("That setting cannot be patched.".into());
    }
    let value: Value = serde_json::from_str(&value_json)
        .map_err(|e| format!("Invalid setting value: {e}"))?;
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "settings.json")?;
    let mut file = read_json_value(&path, Value::Object(Map::new()))?;
    let obj = object_mut(&mut file);
    obj.insert(key, value);
    obj.remove("vaultNoteNavigation");
    write_json_value(&path, &file)?;
    emit_changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn upsert_provider_profile(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    profile_json: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let profile: Value = serde_json::from_str(&profile_json)
        .map_err(|e| format!("Invalid provider profile: {e}"))?;
    let id = profile
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or("Provider profile is missing an id.")?
        .to_string();
    preset_host_error(&profile)?;
    if let Some(base) = profile.get("baseUrl").and_then(|value| value.as_str()) {
        crate::shell::allow_ai_host(&app_handle, base)?;
    }
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "settings.json")?;
    let mut file = read_json_value(&path, Value::Object(Map::new()))?;
    let obj = object_mut(&mut file);
    let profiles = obj.entry("providerProfiles").or_insert_with(|| Value::Array(Vec::new()));
    let list = profiles.as_array_mut().ok_or("Provider profiles are invalid.")?;
    if let Some(existing) = list.iter_mut().find(|item| item.get("id").and_then(|v| v.as_str()) == Some(id.as_str())) {
        *existing = profile;
    } else {
        list.push(profile);
    }
    obj.remove("vaultNoteNavigation");
    write_json_value(&path, &file)?;
    emit_changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn remove_provider_profile(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    let _guard = io_lock()?;
    let settings_path = app_data_file(&app_handle, "settings.json")?;
    let mut settings = read_json_value(&settings_path, Value::Object(Map::new()))?;
    let obj = object_mut(&mut settings);
    let mut next_default = obj.get("defaultProviderProfileId").and_then(|v| v.as_str()).map(|s| s.to_string());
    if let Some(list) = obj.get_mut("providerProfiles").and_then(|v| v.as_array_mut()) {
        list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
        if next_default.as_deref() == Some(id.as_str()) {
            next_default = list.first().and_then(|item| item.get("id")).and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }
    match next_default {
        Some(value) => {
            obj.insert("defaultProviderProfileId".into(), Value::String(value.clone()));
            let personas_path = app_data_file(&app_handle, "personas.json")?;
            let mut personas = read_json_value(&personas_path, Value::Array(Vec::new()))?;
            if let Some(list) = personas.as_array_mut() {
                for persona in list {
                    if persona.get("providerProfileId").and_then(|v| v.as_str()) == Some(id.as_str()) {
                        if let Some(obj) = persona.as_object_mut() {
                            obj.insert("providerProfileId".into(), Value::String(value.clone()));
                        }
                    }
                }
            }
            write_json_value(&personas_path, &personas)?;
        }
        None => {
            obj.insert("defaultProviderProfileId".into(), Value::Null);
        }
    }
    obj.remove("vaultNoteNavigation");
    write_json_value(&settings_path, &settings)?;
    emit_changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn load_vault_navigation(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    reject_untrusted_webview(&window)?;
    let path = app_data_file(&app_handle, "vault-navigation.json")?;
    if path.exists() {
        return fs::read_to_string(&path).map_err(|e| format!("Failed to read vault navigation: {e}"));
    }
    let settings_path = app_data_file(&app_handle, "settings.json")?;
    let settings = read_json_value(&settings_path, Value::Object(Map::new()))?;
    let existing = settings
        .get("vaultNoteNavigation")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    Ok(existing.to_string())
}

#[tauri::command]
pub fn patch_vault_navigation(
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    navigation_json: String,
) -> Result<(), String> {
    reject_untrusted_webview(&window)?;
    if navigation_json.len() > 512 * 1024 {
        return Err("Vault navigation is too large.".into());
    }
    let navigation: Value = serde_json::from_str(&navigation_json)
        .map_err(|e| format!("Invalid navigation: {e}"))?;
    if !navigation.is_object() {
        return Err("Vault navigation must be an object.".into());
    }
    let _guard = io_lock()?;
    let path = app_data_file(&app_handle, "vault-navigation.json")?;
    write_json_value(&path, &navigation)?;
    let settings_path = app_data_file(&app_handle, "settings.json")?;
    if settings_path.exists() {
        let mut settings = read_json_value(&settings_path, Value::Object(Map::new()))?;
        if object_mut(&mut settings).remove("vaultNoteNavigation").is_some() {
            write_json_value(&settings_path, &settings)?;
        }
    }
    emit_changed(&app_handle);
    Ok(())
}
