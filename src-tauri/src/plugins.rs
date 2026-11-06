//! Vault-scoped core / community plugin config under `.metis/`.
//!
//! Community packages may include `manifest.json` + optional `styles.css`.
//! `main.js` (and other scripts) are never copied or executed.

use crate::security::registered_vault;
use crate::state::CurrentVault;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

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
    "backup",
];

const REQUIRED_CORE_PLUGIN_IDS: &[&str] = &["file-explorer", "command-palette"];

/// Keep in lockstep with `defaultEnabled: false` in `src/plugins/corePlugins.ts`.
const CORE_PLUGINS_DEFAULT_OFF: &[&str] = &["supernote"];

fn is_known_core_id(id: &str) -> bool {
    CORE_PLUGIN_IDS.contains(&id)
}

fn is_required_core_id(id: &str) -> bool {
    REQUIRED_CORE_PLUGIN_IDS.contains(&id)
}

/// Missing keys stay on, except Supernote, which is off until the vault enables it.
pub(crate) fn core_plugin_enabled(vault: &Path, id: &str) -> bool {
    if is_required_core_id(id) {
        return true;
    }
    let default_on = !CORE_PLUGINS_DEFAULT_OFF.contains(&id);
    let Ok(path) = core_path(vault) else {
        return default_on;
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return default_on;
    };
    let Ok(file) = serde_json::from_str::<CorePluginsFile>(&raw) else {
        return default_on;
    };
    file.plugins.get(id).copied().unwrap_or(default_on)
}

pub(crate) fn require_core_plugin(vault: &Path, id: &str) -> Result<(), String> {
    if core_plugin_enabled(vault, id) {
        Ok(())
    } else {
        Err(format!("The {id} plugin is turned off for this vault."))
    }
}

fn assert_dest_under_plugins(vault: &Path, dest: &Path) -> Result<(), String> {
    let root = plugins_dir(vault)?;
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
    #[serde(default)]
    pub pending_suggestions: Vec<String>,
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

fn plugins_dir(vault: &Path) -> Result<PathBuf, String> {
    let dir = crate::security::ensure_real_metis_child(vault, "plugins")?;
    Ok(dir)
}

fn core_path(vault: &Path) -> Result<PathBuf, String> {
    Ok(crate::security::ensure_real_metis(vault)?.join("core-plugins.json"))
}

fn community_path(vault: &Path) -> Result<PathBuf, String> {
    Ok(crate::security::ensure_real_metis(vault)?.join("community-plugins.json"))
}

fn vault_for_window(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    registered_vault(window, vault_state)
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
    // Comments, whitespace, and CSS hex escapes are decoded before the check
    // so `\40import` cannot hide `@import`.
    let flat = flatten_css(css);
    if flat.contains("</")
        || flat.contains("<script")
        || flat.contains("javascript:")
        || flat.contains("expression(")
        || flat.contains("@import")
        || flat.contains("behavior:")
        || flat.contains("-moz-binding")
        || css_has_remote_url(&flat)
    {
        return Err("Plugin stylesheet contains disallowed CSS.".into());
    }
    Ok(())
}

/// `url()` can fetch a remote image. Only an inline image is allowed.
fn css_has_remote_url(css: &str) -> bool {
    let lower = css.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(idx) = rest.find("url(") {
        let after = &rest[idx + 4..];
        let end = after.find(')').unwrap_or(after.len());
        let body = after[..end]
            .trim()
            .trim_matches(|ch| ch == '"' || ch == '\'' || ch == ' ');
        if !body.starts_with("data:image/") {
            return true;
        }
        rest = &after[end..];
    }
    false
}

fn is_css_hex(ch: char) -> bool {
    ch.is_ascii_hexdigit()
}

/// One CSS escaped code point, per CSS Syntax. Returns the decoded char and
/// the index just after the escape, including a hex escape's trailing whitespace.
fn consume_css_escape(chars: &[char], start: usize) -> (char, usize) {
    let mut i = start;
    if i >= chars.len() {
        return ('\u{FFFD}', i);
    }
    if is_css_hex(chars[i]) {
        let mut hex = String::new();
        while i < chars.len() && hex.len() < 6 && is_css_hex(chars[i]) {
            hex.push(chars[i]);
            i += 1;
        }
        if i < chars.len() && chars[i] == '\r' {
            i += 1;
            if i < chars.len() && chars[i] == '\n' {
                i += 1;
            }
        } else if i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let cp = u32::from_str_radix(&hex, 16).unwrap_or(0xFFFD);
        let ch = char::from_u32(cp)
            .filter(|c| *c != '\0')
            .unwrap_or('\u{FFFD}');
        return (ch, i);
    }
    let ch = chars[i];
    (ch, i + 1)
}

fn flatten_css(css: &str) -> String {
    let chars: Vec<char> = css.chars().collect();
    let mut decoded = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = i.saturating_add(2);
            continue;
        }
        if chars[i] == '\\' {
            let (ch, next) = consume_css_escape(&chars, i + 1);
            decoded.push(ch);
            i = next;
            continue;
        }
        decoded.push(chars[i]);
        i += 1;
    }
    let mut out = String::with_capacity(decoded.len());
    for ch in decoded.chars() {
        if !ch.is_whitespace() {
            out.push(ch.to_ascii_lowercase());
        }
    }
    out
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

fn real_plugin_file(root: &Path, path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return false;
    }
    let Ok(canon) = path.canonicalize() else {
        return false;
    };
    let Ok(root_canon) = root.canonicalize() else {
        return false;
    };
    canon.starts_with(&root_canon)
}

fn scan_installed(vault: &Path) -> Vec<InstalledPlugin> {
    let Ok(root) = plugins_dir(vault) else {
        return Vec::new();
    };
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        if validate_plugin_id(&folder).is_err() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !real_plugin_file(&root, &manifest_path) {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(mut plugin) = parse_manifest(&raw) else {
            continue;
        };
        if plugin.id != folder {
            continue;
        }
        plugin.has_styles = real_plugin_file(&root, &path.join("styles.css"));
        plugin.has_unsupported_js = path.join("main.js").is_file();
        out.push(plugin);
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn read_core(vault: &Path) -> HashMap<String, bool> {
    let Ok(path) = core_path(vault) else {
        return HashMap::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let mut map = serde_json::from_str::<CorePluginsFile>(&raw)
        .map(|f| f.plugins)
        .unwrap_or_default();
    map.retain(|k, _| is_known_core_id(k));
    map
}

fn community_on_disk(vault: &Path) -> (bool, Vec<String>) {
    let Ok(path) = community_path(vault) else {
        return (false, Vec::new());
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return (false, Vec::new());
    };
    match serde_json::from_str::<CommunityPluginsFile>(&raw) {
        // A bare id list used to turn Restricted Mode off. It is only a suggestion now.
        Ok(CommunityPluginsFile::Ids(ids)) => (false, ids),
        Ok(CommunityPluginsFile::Full {
            restricted_mode,
            enabled,
        }) => (!restricted_mode, enabled),
        Err(_) => (false, Vec::new()),
    }
}

fn read_community(app: &tauri::AppHandle, vault: &Path) -> (bool, Vec<String>) {
    let (suggests_unlocked, ids) = community_on_disk(vault);
    let restricted = crate::feature_consent::restricted_mode(app, vault, suggests_unlocked);
    (restricted, ids)
}

fn write_json(path: &Path, json: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create .metis: {e}"))?;
    }
    crate::io_atomic::write_atomic(path, json.as_bytes()).map_err(|e| format!("Failed to write plugin config: {e}"))
}

fn load_state(app: &tauri::AppHandle, vault: &Path) -> VaultPluginState {
    let (restricted_mode, enabled) = read_community(app, vault);
    let mut core = read_core(vault);
    let mut pending_suggestions = Vec::new();
    let suggested = core.get("supernote").copied().unwrap_or(false);
    let approved = crate::feature_consent::supernote_approved(app, vault);
    if suggested && crate::feature_consent::supernote_decision(app, vault).is_none() {
        pending_suggestions.push("supernote".into());
    }
    if !approved {
        core.insert("supernote".into(), false);
    }
    VaultPluginState {
        restricted_mode,
        core,
        enabled,
        installed: scan_installed(vault),
        pending_suggestions,
    }
}

fn persist_community(vault: &Path, restricted: bool, enabled: &[String]) -> Result<(), String> {
    let body = serde_json::json!({
        "restrictedMode": restricted,
        "enabled": enabled,
    });
    write_json(
        &community_path(vault)?,
        &serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
    )
}

#[tauri::command]
pub fn load_vault_plugins(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    Ok(load_state(&window.app_handle(), &vault))
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
    if id == "supernote" {
        crate::feature_consent::set_supernote_consent(&window.app_handle(), &vault, enabled)?;
    }
    let mut core = read_core(&vault);
    core.insert(id.clone(), enabled);
    let body = serde_json::json!({ "plugins": core });
    write_json(
        &core_path(&vault)?,
        &serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
    )?;
    Ok(load_state(&window.app_handle(), &vault))
}

#[tauri::command]
pub fn decide_supernote_consent(
    approved: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    crate::feature_consent::set_supernote_consent(&window.app_handle(), &vault, approved)?;
    if !approved {
        let mut core = read_core(&vault);
        core.insert("supernote".into(), false);
        let body = serde_json::json!({ "plugins": core });
        write_json(
            &core_path(&vault)?,
            &serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".into()),
        )?;
    }
    Ok(load_state(&window.app_handle(), &vault))
}

#[tauri::command]
pub fn list_jekyll_exports(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Vec<String>, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    Ok(crate::feature_consent::jekyll_exported(&window.app_handle(), &vault))
}

#[tauri::command]
pub fn remember_jekyll_export(
    rel_path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<(), String> {
    let vault = vault_for_window(&window, &vault_state)?;
    crate::feature_consent::remember_jekyll_note(&window.app_handle(), &vault, &rel_path)
}

#[tauri::command]
pub fn set_plugin_restricted_mode(
    restricted: bool,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    crate::feature_consent::set_restricted_mode(&window.app_handle(), &vault, restricted)?;
    let (_, enabled) = read_community(&window.app_handle(), &vault);
    persist_community(&vault, restricted, &enabled)?;
    Ok(load_state(&window.app_handle(), &vault))
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
    let (restricted, mut list) = read_community(&window.app_handle(), &vault);
    list.retain(|x| x != &id);
    if enabled {
        let manifest = plugins_dir(&vault)?.join(&id).join("manifest.json");
        if !manifest.is_file() {
            return Err("Install the plugin before enabling it.".into());
        }
        list.push(id);
    }
    persist_community(&vault, restricted, &list)?;
    Ok(load_state(&window.app_handle(), &vault))
}

fn commit_plugin_dir(
    vault: &Path,
    id: &str,
    manifest: &str,
    css: Option<&str>,
    readme: Option<&str>,
) -> Result<(), String> {
    if let Some(css) = css {
        assert_safe_css(css)?;
    }
    let plugins = plugins_dir(vault)?;
    fs::create_dir_all(&plugins).map_err(|e| format!("Cannot create plugins directory: {e}"))?;
    let dest = plugins.join(id);
    assert_dest_under_plugins(vault, &dest)?;
    let tmp = plugins.join(format!(".tmp-{id}"));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| format!("Cannot clear plugin staging folder: {e}"))?;
    }
    fs::create_dir_all(&tmp).map_err(|e| format!("Cannot create plugin staging folder: {e}"))?;
    crate::io_atomic::write_atomic(&tmp.join("manifest.json"), manifest.as_bytes())
        .map_err(|e| format!("Failed to write manifest.json: {e}"))?;
    if let Some(css) = css {
        crate::io_atomic::write_atomic(&tmp.join("styles.css"), css.as_bytes())
            .map_err(|e| format!("Failed to write styles.css: {e}"))?;
    }
    if let Some(readme) = readme {
        if readme.len() <= MAX_README_BYTES {
            let _ = crate::io_atomic::write_atomic(&tmp.join("README.md"), readme.as_bytes());
        }
    }
    let backup = plugins.join(format!(".bak-{id}"));
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| format!("Cannot clear plugin backup: {e}"))?;
    }
    if dest.exists() {
        fs::rename(&dest, &backup).map_err(|e| format!("Cannot move the existing plugin aside: {e}"))?;
    }
    if let Err(err) = fs::rename(&tmp, &dest) {
        if backup.exists() {
            let _ = fs::rename(&backup, &dest);
        }
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("Cannot install plugin: {err}"));
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    Ok(())
}

/// The folder comes from the native picker inside this command, not from a path the webview supplies.
#[tauri::command]
pub async fn install_plugin_from_dialog(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel::<Option<String>>();
    window
        .app_handle()
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose a plugin folder")
        .pick_folder(move |result| {
            let _ = tx.send(result.map(|path| path.to_string()));
        });
    let selected = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| format!("Plugin folder dialog failed: {e}"))?;
    let Some(source_path) = selected else {
        return Err("Plugin install cancelled.".into());
    };
    let vault = vault_for_window(&window, &vault_state)?;
    let source = PathBuf::from(source_path.trim());
    if !source.is_dir() {
        return Err("Choose a folder that contains manifest.json.".into());
    }
    let manifest_raw = fs::read_to_string(source.join("manifest.json"))
        .map_err(|_| "Folder is missing manifest.json.".to_string())?;
    let plugin = parse_manifest(&manifest_raw)?;
    let css = if source.join("styles.css").is_file() {
        Some(
            fs::read_to_string(source.join("styles.css"))
                .map_err(|e| format!("Failed to read styles.css: {e}"))?,
        )
    } else {
        None
    };
    let readme = fs::read_to_string(source.join("README.md")).ok();
    commit_plugin_dir(
        &vault,
        &plugin.id,
        &manifest_raw,
        css.as_deref(),
        readme.as_deref(),
    )?;
    Ok(load_state(&window.app_handle(), &vault))
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
    let css = styles_css.and_then(|css| {
        let trimmed = css.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    commit_plugin_dir(&vault, &plugin.id, &manifest_json, css.as_deref(), None)?;
    Ok(load_state(&window.app_handle(), &vault))
}

#[tauri::command]
pub fn uninstall_community_plugin(
    id: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<VaultPluginState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    validate_plugin_id(&id)?;
    let dest = plugins_dir(&vault)?.join(&id);
    assert_dest_under_plugins(&vault, &dest)?;
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("Failed to uninstall plugin: {e}"))?;
    }
    let (restricted, mut enabled) = read_community(&window.app_handle(), &vault);
    enabled.retain(|x| x != &id);
    persist_community(&vault, restricted, &enabled)?;
    Ok(load_state(&window.app_handle(), &vault))
}

#[tauri::command]
pub fn read_community_plugin_styles(
    id: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    validate_plugin_id(&id)?;
    let (restricted, enabled) = read_community(&window.app_handle(), &vault);
    if restricted {
        return Err("Community plugins are in Restricted Mode.".into());
    }
    if !enabled.iter().any(|x| x == &id) {
        return Err("Plugin is not enabled.".into());
    }
    let plugins = plugins_dir(&vault)?;
    let plugin_dir = plugins.join(&id);
    let dir_meta = fs::symlink_metadata(&plugin_dir)
        .map_err(|_| "Plugin folder is missing.".to_string())?;
    if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
        return Err("Plugin folder cannot be a link.".into());
    }
    let path = plugin_dir.join("styles.css");
    assert_dest_under_plugins(&vault, &plugin_dir)?;
    if !path.exists() {
        return Ok(String::new());
    }
    if !real_plugin_file(&plugins, &path) {
        return Err("Plugin styles cannot be a link.".into());
    }
    let css = fs::read_to_string(&path).map_err(|e| format!("Failed to read styles.css: {e}"))?;
    assert_safe_css(&css)?;
    Ok(css)
}

#[cfg(test)]
mod css_tests {
    use super::assert_safe_css;

    #[test]
    fn id_list_is_not_an_unlocked_settings_object() {
        let parsed: super::CommunityPluginsFile = serde_json::from_str(r#"["x"]"#).unwrap();
        assert!(matches!(parsed, super::CommunityPluginsFile::Ids(_)));
    }

    #[test]
    fn rejects_hex_escaped_import() {
        assert!(assert_safe_css(r"body{color:red} \40import 'x.css';").is_err());
        assert!(assert_safe_css(r"@\69 mport url(https://evil)").is_err());
        assert!(assert_safe_css("body{background:url(https://evil/x.png)}").is_err());
        assert!(assert_safe_css("body{background:url(data:image/png;base64,aaaa)}").is_ok());
        assert!(assert_safe_css("a{color:blue}").is_ok());
    }
}
