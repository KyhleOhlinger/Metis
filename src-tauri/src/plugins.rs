//! Vault-scoped core / community plugin config under `.metis/`.
//!
//! Community packages may include `manifest.json` + optional `styles.css`.
//! `main.js` (and other scripts) are never copied or executed.

use crate::security::{canon_vault, reject_untrusted_webview};
use crate::state::CurrentVault;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_MANIFEST_BYTES: usize = 16_384;
const MAX_CSS_BYTES: usize = 256 * 1024;
const MAX_README_BYTES: usize = 32_768;

/// Keep in lockstep with `src/plugins/corePlugins.ts`.
const CORE_PLUGIN_IDS: &[&str] = &[
    "file-explorer",
    "command-palette",
    "search",
    "daily-notes",
    "properties",
    "backlinks",
    "word-count",
    "planner",
    "calendar",
    "calculator",
    "sticky-notes",
    "spellcheck",
    "ai",
    "task-manager",
    "handwriting",
    "export",
    "supernote",
];

const REQUIRED_CORE_PLUGIN_IDS: &[&str] = &["file-explorer", "command-palette"];

fn is_known_core_id(id: &str) -> bool {
    CORE_PLUGIN_IDS.contains(&id)
}

fn is_required_core_id(id: &str) -> bool {
    REQUIRED_CORE_PLUGIN_IDS.contains(&id)
}

fn assert_dest_under_plugins(vault: &Path, dest: &Path) -> Result<(), String> {
    let root = plugins_dir(vault);
    if !dest.starts_with(&root) {
        return Err("Plugin path is outside the vault plugins directory.".into());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub has_styles: bool,
    pub has_unsupported_js: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultPluginState {
    pub restricted_mode: bool,
    pub core: HashMap<String, bool>,
    pub enabled: Vec<String>,
    pub installed: Vec<InstalledPlugin>,
}

#[derive(Deserialize, Default)]
struct CorePluginsFile {
    #[serde(default)]
    plugins: HashMap<String, bool>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum CommunityPluginsFile {
    Ids(Vec<String>),
    Full {
        #[serde(default = "default_restricted", rename = "restrictedMode")]
        restricted_mode: bool,
        #[serde(default)]
        enabled: Vec<String>,
    },
}

fn default_restricted() -> bool {
    true
}

fn plugins_dir(vault: &Path) -> PathBuf {
    vault.join(".metis").join("plugins")
}

fn core_path(vault: &Path) -> PathBuf {
    vault.join(".metis").join("core-plugins.json")
}

fn community_path(vault: &Path) -> PathBuf {
    vault.join(".metis").join("community-plugins.json")
}

fn vault_for_window(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    reject_untrusted_webview(window)?;
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("No vault registered for this window.")?
        .clone();
    drop(lock);
    let vault = PathBuf::from(vault_str);
    canon_vault(&vault)
}

/// SECURITY: kebab-case id, no path segments, cannot contain "metis".
pub(crate) fn validate_plugin_id(id: &str) -> Result<(), String> {
    if id.len() < 2 || id.len() > 64 {
        return Err("Plugin id must be 2–64 characters.".into());
    }
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return Err("Plugin id is empty.".into());
    };
    if !first.is_ascii_lowercase() {
        return Err("Plugin id must start with a lowercase letter.".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("Plugin id must be lowercase kebab-case.".into());
    }
    if id.contains("--") || id.ends_with('-') {
        return Err("Invalid plugin id.".into());
    }
    if id.contains("metis") {
        return Err("Plugin id must not contain 'metis'.".into());
    }
    Ok(())
}

/// SECURITY: reject CSS that could break out of a style tag or run script-like rules.
fn assert_safe_css(css: &str) -> Result<(), String> {
    if css.len() > MAX_CSS_BYTES {
        return Err("Plugin stylesheet is too large.".into());
    }
    let lower = css.to_ascii_lowercase();
    if lower.contains("</")
        || lower.contains("<script")
        || lower.contains("javascript:")
        || lower.contains("expression(")
        || lower.contains("@import")
        || lower.contains("behavior:")
        || lower.contains("-moz-binding")
    {
        return Err("Plugin stylesheet contains disallowed CSS.".into());
    }
    Ok(())
}

fn parse_manifest(raw: &str) -> Result<InstalledPlugin, String> {
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err("manifest.json is too large.".into());
    }
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid manifest.json: {e}"))?;
    let obj = v
        .as_object()
        .ok_or("manifest.json must be an object.")?;
    let id = obj
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or("manifest.json is missing id.")?
        .trim()
        .to_string();
    validate_plugin_id(&id)?;
    let name = obj
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or(&id)
        .trim()
        .to_string();
    if name.is_empty() || name.len() > 80 {
        return Err("manifest.json name is invalid.".into());
    }
    let version = obj
        .get("version")
        .and_then(|x| x.as_str())
        .unwrap_or("0.0.0")
        .trim()
        .to_string();
    let author = obj
        .get("author")
        .and_then(|x| x.as_str())
        .unwrap_or("Unknown")
        .trim()
        .to_string();
    let description = obj
        .get("description")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(InstalledPlugin {
        id,
        name,
        version,
        author,
        description,
        has_styles: false,
        has_unsupported_js: false,
    })
}

fn scan_installed(vault: &Path) -> Vec<InstalledPlugin> {
    let root = plugins_dir(vault);
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        if validate_plugin_id(&folder).is_err() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(mut plugin) = parse_manifest(&raw) else {
            continue;
        };
        if plugin.id != folder {
            continue;
        }
        plugin.has_styles = path.join("styles.css").is_file();
        plugin.has_unsupported_js = path.join("main.js").is_file();
        out.push(plugin);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn read_core(vault: &Path) -> HashMap<String, bool> {
    let path = core_path(vault);
    let Ok(raw) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let mut map = serde_json::from_str::<CorePluginsFile>(&raw)
        .map(|f| f.plugins)
        .unwrap_or_default();
    map.retain(|k, _| is_known_core_id(k));
    map
}

fn read_community(vault: &Path) -> (bool, Vec<String>) {
    let path = community_path(vault);
    let Ok(raw) = fs::read_to_string(&path) else {
        return (true, Vec::new());
    };
    match serde_json::from_str::<CommunityPluginsFile>(&raw) {
        Ok(CommunityPluginsFile::Ids(ids)) => (false, ids),
        Ok(CommunityPluginsFile::Full {
            restricted_mode,
            enabled,
        }) => (restricted_mode, enabled),
        Err(_) => (true, Vec::new()),
    }
}

fn write_json(path: &Path, json: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create .metis: {e}"))?;
    }
    fs::write(path, json.as_bytes()).map_err(|e| format!("Failed to write plugin config: {e}"))
}

fn load_state(vault: &Path) -> VaultPluginState {
    let (restricted_mode, enabled) = read_community(vault);
    VaultPluginState {
        restricted_mode,
        core: read_core(vault),
        enabled,
        installed: scan_installed(vault),
    }
}

fn persist_community(vault: &Path, restricted: bool, enabled: &[String]) -> Result<(), String> {
    let body = serde_json::json!({
        "restrictedMode": restricted,
        "enabled": enabled,
    });
    write_json(
        &community_path(vault),
        &serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
    )
}

#[tauri::command]
pub fn load_vault_plugins(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn set_core_plugin_enabled(
    id: String,
    enabled: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    if !is_known_core_id(&id) {
        return Err("Unknown core plugin.".into());
    }
    if is_required_core_id(&id) && !enabled {
        return Err("This plugin is required and cannot be turned off.".into());
    }
    let mut core = read_core(&vault);
    core.insert(id, enabled);
    let body = serde_json::json!({ "plugins": core });
    write_json(
        &core_path(&vault),
        &serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
    )?;
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn set_plugin_restricted_mode(
    restricted: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let (_, enabled) = read_community(&vault);
    persist_community(&vault, restricted, &enabled)?;
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn set_community_plugin_enabled(
    id: String,
    enabled: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    validate_plugin_id(&id)?;
    let (restricted, mut list) = read_community(&vault);
    list.retain(|x| x != &id);
    if enabled {
        list.push(id);
    }
    persist_community(&vault, restricted, &list)?;
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn install_plugin_from_folder(
    source_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let source = PathBuf::from(source_path.trim());
    if !source.is_dir() {
        return Err("Choose a folder that contains manifest.json.".into());
    }
    let manifest_raw = fs::read_to_string(source.join("manifest.json"))
        .map_err(|_| "Folder is missing manifest.json.".to_string())?;
    let plugin = parse_manifest(&manifest_raw)?;
    let dest = plugins_dir(&vault).join(&plugin.id);
    assert_dest_under_plugins(&vault, &dest)?;
    fs::create_dir_all(plugins_dir(&vault))
        .map_err(|e| format!("Cannot create plugins directory: {e}"))?;
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Cannot replace existing plugin: {e}"))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("Cannot create plugin folder: {e}"))?;
    fs::write(dest.join("manifest.json"), manifest_raw.as_bytes())
        .map_err(|e| format!("Failed to write manifest.json: {e}"))?;

    let css_path = source.join("styles.css");
    if css_path.is_file() {
        let css = fs::read_to_string(&css_path).map_err(|e| format!("Failed to read styles.css: {e}"))?;
        assert_safe_css(&css)?;
        fs::write(dest.join("styles.css"), css.as_bytes())
            .map_err(|e| format!("Failed to write styles.css: {e}"))?;
    }
    let readme_path = source.join("README.md");
    if readme_path.is_file() {
        if let Ok(readme) = fs::read_to_string(&readme_path) {
            if readme.len() <= MAX_README_BYTES {
                let _ = fs::write(dest.join("README.md"), readme.as_bytes());
            }
        }
    }
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn install_community_plugin_files(
    manifest_json: String,
    styles_css: Option<String>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let plugin = parse_manifest(&manifest_json)?;
    let dest = plugins_dir(&vault).join(&plugin.id);
    assert_dest_under_plugins(&vault, &dest)?;
    fs::create_dir_all(plugins_dir(&vault))
        .map_err(|e| format!("Cannot create plugins directory: {e}"))?;
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Cannot replace existing plugin: {e}"))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("Cannot create plugin folder: {e}"))?;
    fs::write(dest.join("manifest.json"), manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest.json: {e}"))?;
    if let Some(css) = styles_css {
        let trimmed = css.trim();
        if !trimmed.is_empty() {
            assert_safe_css(trimmed)?;
            fs::write(dest.join("styles.css"), trimmed.as_bytes())
                .map_err(|e| format!("Failed to write styles.css: {e}"))?;
        }
    }
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn uninstall_community_plugin(
    id: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    validate_plugin_id(&id)?;
    let dest = plugins_dir(&vault).join(&id);
    assert_dest_under_plugins(&vault, &dest)?;
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Failed to uninstall plugin: {e}"))?;
    }
    let (restricted, mut enabled) = read_community(&vault);
    enabled.retain(|x| x != &id);
    persist_community(&vault, restricted, &enabled)?;
    Ok(load_state(&vault))
}

#[tauri::command]
pub fn read_community_plugin_styles(
    id: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    validate_plugin_id(&id)?;
    let (restricted, enabled) = read_community(&vault);
    if restricted {
        return Err("Community plugins are in Restricted Mode.".into());
    }
    if !enabled.iter().any(|x| x == &id) {
        return Err("Plugin is not enabled.".into());
    }
    let path = plugins_dir(&vault).join(&id).join("styles.css");
    assert_dest_under_plugins(&vault, &plugins_dir(&vault).join(&id))?;
    if !path.is_file() {
        return Ok(String::new());
    }
    let css = fs::read_to_string(&path).map_err(|e| format!("Failed to read styles.css: {e}"))?;
    assert_safe_css(&css)?;
    Ok(css)
}
