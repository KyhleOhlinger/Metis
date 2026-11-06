//! Supernote Nomad Browse & Access pull into `handwritten/Supernote/`.
//!
//! SECURITY: HTTP stays in Rust (reqwest, same client in dev and release).
//! Destination is a user-supplied IPv4 on RFC1918 or Tailscale CGNAT.

use crate::plugins::require_core_plugin;
use crate::security::{registered_vault, safe_resolve};
use crate::state::CurrentVault;
use crate::vault_fs::sanitize_name;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEST_SPACE: &str = "handwritten";
const DEST_FOLDER: &str = "Supernote";
const SYNC_META_REL: &str = ".metis/supernote-sync.json";
const MAX_SYNC_META_BYTES: usize = 256 * 1024;
const DEFAULT_PORT: u16 = 8089;
const DEFAULT_REMOTE: &str = "Note";
const MAX_FILES: usize = 200;
const MAX_DEPTH: u32 = 6;
const MAX_LISTING_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const LISTING_TIMEOUT_SECS: u64 = 20;
const FILE_TIMEOUT_SECS: u64 = 60;

const PULL_EXTS: &[&str] = &["note", "png", "jpg", "jpeg", "webp", "pdf", "bmp"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupernoteSyncResult {
    pub downloaded: usize,
    pub skipped: usize,
    pub updated: usize,
    pub dest_folder: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SyncMetaFile {
    #[serde(default)]
    files: HashMap<String, SyncMetaEntry>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SyncMetaEntry {
    #[serde(default)]
    pulled_at_ms: u64,
    #[serde(default)]
    device_date: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupernoteFileSyncMeta {
    pub pulled_at_ms: u64,
    pub device_date: Option<String>,
}

fn dest_dir(vault: &Path) -> PathBuf {
    vault.join(DEST_SPACE).join(DEST_FOLDER)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct DeviceDate {
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
}

impl DeviceDate {
    fn label(self) -> String {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}",
            self.year, self.month, self.day, self.hour, self.minute
        )
    }
}

fn parse_device_date(raw: &str) -> Option<DeviceDate> {
    let t = raw.trim().replace('T', " ");
    let (date, time) = t.split_once(' ')?;
    let mut date_parts = date.split('-');
    let year: u16 = date_parts.next()?.parse().ok()?;
    let month: u8 = date_parts.next()?.parse().ok()?;
    let day: u8 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut time_parts = time.split(':');
    let hour: u8 = time_parts.next()?.parse().ok()?;
    let minute: u8 = time_parts.next()?.parse().ok()?;
    if time_parts.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    Some(DeviceDate {
        year,
        month,
        day,
        hour,
        minute,
    })
}

fn device_date_is_newer(remote: &str, stored: &str) -> bool {
    match (parse_device_date(remote), parse_device_date(stored)) {
        (Some(remote), Some(stored)) => remote > stored,
        _ => false,
    }
}

fn sanitize_device_date(raw: &str) -> Option<String> {
    parse_device_date(raw).map(DeviceDate::label)
}

fn json_date(item: &serde_json::Value) -> Option<String> {
    let raw = item
        .get("date")
        .or_else(|| item.get("lastModified"))
        .and_then(|v| v.as_str())?;
    sanitize_device_date(raw)
}

fn sync_meta_path(vault: &Path) -> PathBuf {
    vault.join(SYNC_META_REL)
}

fn load_sync_meta(vault: &Path) -> SyncMetaFile {
    let path = sync_meta_path(vault);
    let Ok(raw) = fs::read_to_string(&path) else {
        return SyncMetaFile::default();
    };
    if raw.len() > MAX_SYNC_META_BYTES {
        return SyncMetaFile::default();
    }
    let parsed: SyncMetaFile = serde_json::from_str(&raw).unwrap_or_default();
    validate_sync_meta(parsed)
}

fn validate_sync_meta(meta: SyncMetaFile) -> SyncMetaFile {
    let mut files = HashMap::new();
    for (key, entry) in meta.files {
        let key = key.replace('\\', "/");
        if !valid_sync_meta_key(&key) {
            continue;
        }
        files.insert(
            key,
            SyncMetaEntry {
                pulled_at_ms: entry.pulled_at_ms,
                device_date: entry.device_date.as_deref().and_then(sanitize_device_date),
                size: entry.size.filter(|size| *size <= MAX_FILE_BYTES as u64),
            },
        );
    }
    SyncMetaFile { files }
}

fn valid_sync_meta_key(key: &str) -> bool {
    if key.is_empty()
        || key.len() > 1024
        || key.starts_with('/')
        || key.ends_with('/')
        || key.contains("//")
    {
        return false;
    }
    let prefix = format!("{DEST_SPACE}/{DEST_FOLDER}/");
    if !key.starts_with(&prefix) {
        return false;
    }
    key.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

fn save_sync_meta(vault: &Path, meta: &SyncMetaFile) -> Result<(), String> {
    crate::security::ensure_real_metis(vault)?;
    let path = sync_meta_path(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create .metis: {e}"))?;
    }
    let body = serde_json::to_string_pretty(meta).unwrap_or_else(|_| "{\"files\":{}}".into());
    if body.len() > MAX_SYNC_META_BYTES {
        return Err("Supernote sync metadata is too large.".into());
    }
    fs::write(&path, body.as_bytes()).map_err(|e| format!("Failed to write sync metadata: {e}"))
}

fn vault_rel_key(vault: &Path, dest: &Path) -> Option<String> {
    dest.strip_prefix(vault)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// Re-pull when size differs, or Nomad listing date is newer than last recorded date.
fn should_pull(
    dest: &Path,
    remote_size: Option<u64>,
    remote_date: Option<&str>,
    prev: Option<&SyncMetaEntry>,
) -> bool {
    if !dest.exists() {
        return true;
    }
    if let Some(sz) = remote_size.filter(|s| *s > 0) {
        if dest.metadata().map(|m| m.len() != sz).unwrap_or(true) {
            return true;
        }
    }
    if let Some(remote) = remote_date.filter(|s| !s.is_empty()) {
        match prev.and_then(|p| p.device_date.as_deref()) {
            Some(stored) if device_date_is_newer(remote, stored) => return true,
            _ => {}
        }
    }
    false
}

fn parse_ipv4(raw: &str) -> Result<[u8; 4], String> {
    let s = raw.trim();
    if s.contains(':') {
        return Err("Enter the IPv4 address only — do not include a port.".into());
    }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return Err("Device address must be an IPv4 like 192.168.1.12.".into());
    }
    let mut out = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
            return Err("Device address is not a valid IPv4.".into());
        }
        let n: u8 = part
            .parse()
            .map_err(|_| "Device address is not a valid IPv4.".to_string())?;
        out[i] = n;
    }
    Ok(out)
}

/// RFC1918 plus Tailscale/CGNAT `100.64.0.0/10`. Blocks metadata and public IPs.
fn assert_lan_ipv4(ip: [u8; 4]) -> Result<(), String> {
    if ip == [0, 0, 0, 0] || ip[0] >= 224 {
        return Err("That address is not allowed.".into());
    }
    if ip[0] == 169 && ip[1] == 254 {
        return Err("Link-local addresses are not allowed.".into());
    }
    if ip[0] == 127 {
        return Err("Use the Nomad's LAN address, not localhost.".into());
    }
    let rfc1918 = ip[0] == 10
        || (ip[0] == 172 && (16..=31).contains(&ip[1]))
        || (ip[0] == 192 && ip[1] == 168);
    let tailscale = ip[0] == 100 && (64..=127).contains(&ip[1]);
    if rfc1918 || tailscale {
        return Ok(());
    }
    Err("Only private LAN or Tailscale addresses are allowed.".into())
}

fn normalize_port(port: Option<u16>) -> Result<u16, String> {
    let p = port.unwrap_or(DEFAULT_PORT);
    if p < 1024 {
        return Err("Port must be 1024 or higher (Browse & Access is 8089).".into());
    }
    Ok(p)
}

fn vault_for_window(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    registered_vault(window, vault_state)
}

fn vault_for_sync(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let vault = vault_for_window(window, vault_state)?;
    require_core_plugin(&vault, "supernote")?;
    if !crate::feature_consent::supernote_approved(app, &vault) {
        return Err("Supernote is not approved for this vault.".into());
    }
    Ok(vault)
}

struct LanGet {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}

/// Same HTTP client in dev and packaged builds, on every OS.
/// `tauri dev` only looked faster because it never used the macOS-only
/// Network.framework client (that path waited on Bonjour and then timed out).
fn lan_http_get(url: &str, timeout_secs: u64, max_bytes: usize) -> Result<LanGet, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(timeout_secs))
        .pool_max_idle_per_host(0)
        .tcp_nodelay(true)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Metis-Supernote/1")
        .build()
        .map_err(|e| format!("Could not create HTTP client: {e}"))?;
    let res = client
        .get(encode_url_for_request(url))
        .send()
        .map_err(|e| map_browse_http_error(&e))?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body = res
        .bytes()
        .map_err(|e| format!("Failed to read response: {e}"))?
        .to_vec();
    if body.len() > max_bytes {
        return Err("Response is too large.".into());
    }
    Ok(LanGet {
        status,
        content_type,
        body,
    })
}

fn error_chain(err: &dyn std::error::Error) -> String {
    let mut parts = Vec::new();
    let mut cur: Option<&dyn std::error::Error> = Some(err);
    while let Some(e) = cur {
        let s = e.to_string();
        if parts.last().map(|p| p != &s).unwrap_or(true) {
            parts.push(s);
        }
        cur = e.source();
    }
    parts.join(" — ")
}

fn looks_like_local_network_denied(msg: &str) -> bool {
    let l = msg.to_ascii_lowercase();
    l.contains("operation not permitted")
        || l.contains("permission denied")
        || l.contains("os error 1")
        || l.contains("no route to host")
        || l.contains("os error 65")
        || l.contains("network is unreachable")
        || l.contains("os error 51")
        || l.contains("host is down")
}

fn decode_href(raw: &str) -> String {
    html_unescape(&percent_decode(raw))
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn ext_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_dir_href(href: &str) -> bool {
    let trimmed = href.trim_end_matches('/');
    if trimmed.is_empty() {
        return true;
    }
    ext_of(trimmed).is_empty()
}

fn join_url(base: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
        return None;
    }
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_string());
    }
    if href.starts_with('/') {
        let origin = {
            let s = base.trim_end_matches('/');
            let idx = s.find("://")?;
            let rest = &s[idx + 3..];
            let host = rest.split('/').next().unwrap_or(rest);
            format!("{}://{}", &s[..idx], host)
        };
        return Some(format!("{origin}{href}"));
    }
    let base_dir = if base.ends_with('/') {
        base.to_string()
    } else if is_dir_href(base) {
        format!("{base}/")
    } else {
        match base.rsplit_once('/') {
            Some((p, _)) => format!("{p}/"),
            None => return None,
        }
    };
    Some(format!("{base_dir}{href}"))
}

fn url_on_device(url: &str, ip: [u8; 4], port: u16) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "http" {
        return false;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let expected = format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]);
    host == expected && parsed.port() == Some(port)
}

fn listing_path_from_url(url: &str, ip: [u8; 4], port: u16) -> String {
    let prefix = format!(
        "http://{}.{}.{}.{}:{port}",
        ip[0], ip[1], ip[2], ip[3]
    );
    percent_decode(url.strip_prefix(&prefix).unwrap_or("/"))
}

fn url_file_name(url: &str) -> String {
    let path = url.split('?').next().unwrap_or(url);
    let last = path.rsplit('/').next().unwrap_or("");
    percent_decode(last)
}

/// Download URL for one listing row.
///
/// Absolute `uri` values are kept when their file name matches `name`.
/// A `uri` that names a different notebook is ignored, and the file is taken
/// from the folder being listed plus `name`. Otherwise every nested folder
/// can save the first notebook's bytes under the later note's name.
fn resolve_listing_file_url(page_url: &str, name: &str, uri: &str) -> Option<String> {
    let name = name.trim();
    let uri = uri.trim();
    let from_uri = if uri.is_empty() {
        None
    } else {
        join_url(page_url, uri)
    };
    if let Some(abs) = &from_uri {
        if name.is_empty() || url_file_name(abs).eq_ignore_ascii_case(name) {
            return Some(abs.clone());
        }
    }
    if name.is_empty() {
        return from_uri;
    }
    join_url(page_url, name)
}

fn encode_path_segment(seg: &str) -> String {
    let bytes = seg.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            out.push('%');
            out.push(bytes[i + 1] as char);
            out.push(bytes[i + 2] as char);
            i += 3;
            continue;
        }
        let c = bytes[i];
        if c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'~') {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{c:02X}"));
        }
        i += 1;
    }
    out
}

fn encode_url_for_request(url: &str) -> String {
    let Some(scheme) = url.find("://") else {
        return url.to_string();
    };
    let rest = &url[scheme + 3..];
    let Some(slash) = rest.find('/') else {
        return url.to_string();
    };
    let origin = &url[..scheme + 3 + slash];
    let path_and_query = &rest[slash..];
    let (path, query) = match path_and_query.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (path_and_query, None),
    };
    let encoded = path
        .split('/')
        .map(|seg| {
            if seg.is_empty() {
                String::new()
            } else {
                encode_path_segment(seg)
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    match query {
        Some(q) => format!("{origin}{encoded}?{q}"),
        None => format!("{origin}{encoded}"),
    }
}

fn relative_under_note(url_path: &str) -> PathBuf {
    let path = url_path.trim_matches('/');
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let rest = if parts.next() == Some("Note") {
        parts.collect::<Vec<_>>().join("/")
    } else {
        path.to_string()
    };
    PathBuf::from(rest)
}

fn ensure_real_dir(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(format!(
            "{} is a link. Sync will not write through it.",
            path.display()
        )),
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(format!("{} is not a folder.", path.display())),
        Err(_) => {
            if let Some(parent) = path.parent() {
                if parent != path && !parent.as_os_str().is_empty() {
                    ensure_real_dir(parent)?;
                }
            }
            fs::create_dir(path).map_err(|e| format!("Cannot create {}: {e}", path.display()))
        }
    }
}

/// Canonical destination under `dest_root`. Any symlink on the way is refused.
fn pull_destination(dest_root: &Path, rel: &Path) -> Result<PathBuf, String> {
    let root_meta = fs::symlink_metadata(dest_root)
        .map_err(|e| format!("Supernote folder is missing: {e}"))?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err("Supernote folder is not a real directory.".into());
    }
    let root = dest_root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve Supernote folder: {e}"))?;
    let mut cursor = root.clone();
    let comps: Vec<_> = rel.components().collect();
    for (index, comp) in comps.iter().enumerate() {
        let std::path::Component::Normal(name) = comp else {
            return Err("Invalid remote path.".into());
        };
        cursor.push(name);
        let last = index + 1 == comps.len();
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "Refusing to write through a link at {}.",
                    cursor.display()
                ));
            }
            Ok(meta) if !last && !meta.is_dir() => {
                return Err(format!("{} is not a folder.", cursor.display()));
            }
            Ok(_) => {}
            Err(_) if last => {}
            Err(_) => {
                fs::create_dir(&cursor)
                    .map_err(|e| format!("Cannot create {}: {e}", cursor.display()))?;
            }
        }
    }
    let parent = cursor.parent().ok_or("Invalid destination.")?;
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve destination: {e}"))?;
    if canon_parent != root && !canon_parent.starts_with(&root) {
        return Err("Destination is outside handwritten/Supernote.".into());
    }
    let name = cursor.file_name().ok_or("Invalid destination.")?;
    Ok(canon_parent.join(name))
}

fn safe_dest_rel(rel: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for comp in rel.components() {
        let std::path::Component::Normal(s) = comp else {
            return Err("Invalid remote path.".into());
        };
        let name = sanitize_name(&s.to_string_lossy())?;
        out.push(name);
    }
    if out.as_os_str().is_empty() {
        return Err("Empty remote path.".into());
    }
    Ok(out)
}

struct ListingLink {
    abs: String,
    is_dir: bool,
    ext: String,
    /// Browse & Access `fileList[].size` in bytes, when present.
    size: Option<u64>,
    /// Device `fileList[].date` (`YYYY-MM-DD HH:MM`).
    date: Option<String>,
}

fn json_u64(v: Option<&serde_json::Value>) -> Option<u64> {
    let v = v?;
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    if let Some(n) = v.as_i64() {
        return Some(n.max(0) as u64);
    }
    if let Some(n) = v.as_f64() {
        if n.is_finite() && n >= 0.0 {
            return Some(n.round() as u64);
        }
    }
    if let Some(s) = v.as_str() {
        parse_size_string(s)
    } else {
        None
    }
}

fn parse_size_string(raw: &str) -> Option<u64> {
    let t = raw.trim();
    if let Ok(n) = t.parse::<u64>() {
        return Some(n);
    }
    let mut parts = t.split_whitespace();
    let n: f64 = parts.next()?.parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let unit = parts.next().unwrap_or("").to_ascii_uppercase();
    let mul = match unit.as_str() {
        "" | "B" => 1.0,
        "KB" | "K" => 1024.0,
        "MB" | "M" => 1024.0 * 1024.0,
        "GB" | "G" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mul).round() as u64)
}

fn file_mtime_ms(path: &Path) -> u64 {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn record_sync_entry(
    meta: &mut SyncMetaFile,
    vault: &Path,
    dest: &Path,
    device_date: Option<String>,
    size: Option<u64>,
    pulled_at_ms: Option<u64>,
) {
    let Some(key) = vault_rel_key(vault, dest) else {
        return;
    };
    let entry = meta.files.entry(key).or_default();
    if let Some(ms) = pulled_at_ms {
        entry.pulled_at_ms = ms;
    } else if entry.pulled_at_ms == 0 {
        entry.pulled_at_ms = file_mtime_ms(dest);
    }
    if device_date.is_some() {
        entry.device_date = device_date;
    }
    if size.is_some() {
        entry.size = size;
    }
}

fn truthy_json(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        serde_json::Value::String(s) => {
            matches!(s.to_ascii_lowercase().as_str(), "true" | "1" | "y" | "yes")
        }
        _ => false,
    }
}

fn skip_dir_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("recycle") || n == "." || n == ".."
}

/// Browse & Access embeds `const json = '{ "fileList": [...] }'` — the table is filled by JS.
fn extract_listing_json(html: &str) -> Option<serde_json::Value> {
    let re = Regex::new(r"(?s)const\s+json\s*=\s*'((?:\\'|[^'])*)'").ok()?;
    let raw = re.captures(html)?.get(1)?.as_str().replace("\\'", "'");
    serde_json::from_str(&raw).ok()
}

fn links_from_json(
    html: &str,
    page_url: &str,
    octets: [u8; 4],
    port: u16,
) -> Option<Vec<ListingLink>> {
    let parsed = extract_listing_json(html)?;
        let list = parsed
            .get("fileList")
            .or_else(|| parsed.get("file_list"))
            .and_then(|v| v.as_array())?;
    let mut out = Vec::new();
    for item in list {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let uri = item
            .get("uri")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if uri.is_empty() && name.is_empty() {
            continue;
        }
        let is_dir = truthy_json(item.get("isDirectory").unwrap_or(&serde_json::Value::Null))
            || truthy_json(item.get("isFolder").unwrap_or(&serde_json::Value::Null));
        if is_dir && skip_dir_name(name) {
            continue;
        }
        let abs = if is_dir {
            let href = if uri.is_empty() { name } else { uri };
            join_url(page_url, href)
        } else {
            resolve_listing_file_url(page_url, name, uri)
        };
        let Some(abs) = abs else {
            continue;
        };
        if !url_on_device(&abs, octets, port) {
            continue;
        }
        let ext = item
            .get("extension")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        let ext = if ext.is_empty() {
            let from_uri = ext_of(&abs);
            if from_uri.is_empty() {
                ext_of(name)
            } else {
                from_uri
            }
        } else {
            ext
        };
        out.push(ListingLink {
            abs,
            is_dir,
            ext,
            size: json_u64(item.get("size")).or_else(|| json_u64(item.get("fileSize"))),
            date: json_date(item),
        });
    }
    Some(out)
}

fn extract_hrefs(html: &str) -> Vec<String> {
    let re = Regex::new(r#"href\s*=\s*["']([^"']+)["']"#).expect("href regex");
    re.captures_iter(html)
        .filter_map(|c| c.get(1).map(|m| decode_href(m.as_str())))
        .collect()
}

fn links_from_hrefs(html: &str, page_url: &str, octets: [u8; 4], port: u16) -> Vec<ListingLink> {
    let mut out = Vec::new();
    for href in extract_hrefs(html) {
        if href == "../"
            || href == ".."
            || href.starts_with("mailto:")
            || href.starts_with("javascript:")
        {
            continue;
        }
        let Some(abs) = join_url(page_url, &href) else {
            continue;
        };
        if !url_on_device(&abs, octets, port) {
            continue;
        }
        let is_dir = is_dir_href(&href) || is_dir_href(&abs);
        out.push(ListingLink {
            abs: abs.clone(),
            is_dir,
            ext: ext_of(&abs),
            size: None,
            date: None,
        });
    }
    out
}

fn listing_links(
    html: &str,
    page_url: &str,
    octets: [u8; 4],
    port: u16,
) -> Vec<ListingLink> {
    links_from_json(html, page_url, octets, port)
        .unwrap_or_else(|| links_from_hrefs(html, page_url, octets, port))
}

fn map_browse_http_error(err: &reqwest::Error) -> String {
    let raw = error_chain(err);
    if looks_like_local_network_denied(&raw) {
        return "macOS dropped the LAN connection even though Local Network may already show Metis on. That switch does not apply to an unsigned app. This build is ad-hoc signed: quit Metis, turn Local Network off and on once, reopen Metis, then sync.".into();
    }
    if err.is_timeout() {
        return "Browse & Access timed out. Enable it on the Nomad, confirm the popup, and check the IP.".into();
    }
    format!(
        "Could not reach Browse & Access ({raw}). Enable it on the Nomad and confirm you are on the same Wi-Fi or Tailscale."
    )
}

fn get_listing(url: &str) -> Result<String, String> {
    let res = lan_http_get(url, LISTING_TIMEOUT_SECS, MAX_LISTING_BYTES)?;
    if !(200..300).contains(&res.status) {
        return Err(format!(
            "Browse & Access returned HTTP {} for {url}",
            res.status
        ));
    }
    Ok(String::from_utf8_lossy(&res.body).into_owned())
}

#[tauri::command]
pub fn ensure_supernote_folder(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault = vault_for_sync(&window, &vault_state, &app)?;
    let handwritten = vault.join(DEST_SPACE);
    ensure_real_dir(&handwritten)?;
    let dest = dest_dir(&vault);
    ensure_real_dir(&dest)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sync_supernote_browse_access(
    ip: String,
    port: Option<u16>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<SupernoteSyncResult, String> {
    let vault = vault_for_sync(&window, &vault_state, &app)?;
    tauri::async_runtime::spawn_blocking(move || pull_browse_access(vault, ip, port))
        .await
        .map_err(|e| format!("Sync task failed: {e}"))?
}

fn pull_browse_access(
    vault: PathBuf,
    ip: String,
    port: Option<u16>,
) -> Result<SupernoteSyncResult, String> {
    let octets = parse_ipv4(&ip)?;
    assert_lan_ipv4(octets)?;
    let port = normalize_port(port)?;
    let dest_root = dest_dir(&vault);
    ensure_real_dir(&vault.join(DEST_SPACE))?;
    ensure_real_dir(&dest_root)?;
    let mut sync_meta = load_sync_meta(&vault);

    let origin = format!(
        "http://{}.{}.{}.{}:{port}",
        octets[0], octets[1], octets[2], octets[3]
    );

    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut updated = 0usize;
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, u32)> = vec![
        (format!("{origin}/"), 0),
        (format!("{origin}/{DEFAULT_REMOTE}"), 0),
        (format!("{origin}/{DEFAULT_REMOTE}/"), 0),
    ];
    let mut root_error: Option<String> = None;
    let mut listed_ok = false;

    while let Some((page_url, depth)) = queue.pop() {
        if downloaded + skipped + updated >= MAX_FILES {
            break;
        }
        if depth > MAX_DEPTH {
            continue;
        }
        if !visited.insert(page_url.clone()) {
            continue;
        }
        if !url_on_device(&page_url, octets, port) {
            continue;
        }

        let html = match get_listing(&page_url) {
            Ok(h) => {
                listed_ok = true;
                h
            }
            Err(e) if depth == 0 => {
                if root_error.is_none() {
                    root_error = Some(e);
                }
                continue;
            }
            Err(_) => continue,
        };

        for link in listing_links(&html, &page_url, octets, port) {
            if link.is_dir {
                if !visited.contains(&link.abs) {
                    queue.push((link.abs, depth + 1));
                }
                continue;
            }
            if !PULL_EXTS.contains(&link.ext.as_str()) {
                continue;
            }
            let url_path = listing_path_from_url(&link.abs, octets, port);
            let rel = match safe_dest_rel(&relative_under_note(&url_path)) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let dest = match pull_destination(&dest_root, &rel) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let existed = fs::symlink_metadata(&dest)
                .map(|meta| !meta.file_type().is_symlink())
                .unwrap_or(false);
            let key_opt = vault_rel_key(&vault, &dest);
            let prev = key_opt
                .as_ref()
                .and_then(|k| sync_meta.files.get(k).cloned());
            if existed && !should_pull(&dest, link.size, link.date.as_deref(), prev.as_ref()) {
                skipped += 1;
                let keep_older_device = matches!(
                    (link.date.as_deref(), prev.as_ref().and_then(|p| p.device_date.as_deref())),
                    (Some(remote), Some(stored)) if device_date_is_newer(stored, remote)
                );
                record_sync_entry(
                    &mut sync_meta,
                    &vault,
                    &dest,
                    if keep_older_device {
                        None
                    } else {
                        link.date.clone()
                    },
                    link.size.or_else(|| dest.metadata().ok().map(|m| m.len())),
                    None,
                );
                continue;
            }
            let res = match lan_http_get(&link.abs, FILE_TIMEOUT_SECS, MAX_FILE_BYTES) {
                Ok(r) => r,
                Err(_) => continue,
            };
            if !(200..300).contains(&res.status) {
                continue;
            }
            if res.content_type.contains("text/html") {
                continue;
            }
            let bytes = res.body;
            if bytes.len() > MAX_FILE_BYTES {
                continue;
            }
            if existed {
                if let Ok(current) = fs::read(&dest) {
                    if current.as_slice() == bytes.as_slice() {
                        skipped += 1;
                        record_sync_entry(
                            &mut sync_meta,
                            &vault,
                            &dest,
                            link.date.clone(),
                            Some(bytes.len() as u64),
                            None,
                        );
                        continue;
                    }
                }
            }
            // Exclusive temp file in the destination directory, then rename.
            // A pre-planted symlink at a predictable temp name is not followed.
            crate::io_atomic::write_atomic(&dest, &bytes)
                .map_err(|e| format!("Failed to save {}: {e}", rel.display()))?;
            record_sync_entry(
                &mut sync_meta,
                &vault,
                &dest,
                link.date.clone(),
                Some(bytes.len() as u64),
                Some(now_ms()),
            );
            if existed {
                updated += 1;
            } else {
                downloaded += 1;
            }
            if downloaded + skipped + updated >= MAX_FILES {
                break;
            }
        }
    }

    if !listed_ok {
        return Err(root_error.unwrap_or_else(|| {
            "Could not reach Browse & Access. Enable it on the Nomad and confirm the popup.".into()
        }));
    }

    save_sync_meta(&vault, &sync_meta)?;

    Ok(SupernoteSyncResult {
        downloaded,
        skipped,
        updated,
        dest_folder: format!("{DEST_SPACE}/{DEST_FOLDER}"),
    })
}

#[tauri::command]
pub fn get_supernote_sync_meta(
    path: String,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<Option<SupernoteFileSyncMeta>, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let target = PathBuf::from(path.trim());
    if target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("note"))
        != Some(true)
    {
        return Err("get_supernote_sync_meta only accepts .note files.".into());
    }
    let resolved = safe_resolve(&target).map_err(|e| format!("get_supernote_sync_meta: {e}"))?;
    if !resolved.starts_with(&vault) {
        return Err("get_supernote_sync_meta: path is outside the active vault.".into());
    }
    let dest_root = dest_dir(&vault);
    if !resolved.starts_with(&dest_root) {
        return Err("Not a synced Supernote notebook.".into());
    }
    let key = vault_rel_key(&vault, &resolved).ok_or("Invalid notebook path.")?;
    let meta = load_sync_meta(&vault);
    if let Some(entry) = meta.files.get(&key) {
        return Ok(Some(SupernoteFileSyncMeta {
            pulled_at_ms: entry.pulled_at_ms,
            device_date: entry.device_date.clone(),
        }));
    }
    if resolved.is_file() {
        return Ok(Some(SupernoteFileSyncMeta {
            pulled_at_ms: file_mtime_ms(&resolved),
            device_date: None,
        }));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_url_rejects_userinfo_port_prefix_and_https() {
        let ip = [10, 0, 0, 8];
        assert!(url_on_device("http://10.0.0.8:8089/Note/a.note", ip, 8089));
        assert!(!url_on_device("http://10.0.0.8:8089@evil.example/x", ip, 8089));
        assert!(!url_on_device("http://10.0.0.8:80891/x", ip, 8089));
        assert!(!url_on_device("http://10.0.0.8.evil.example:8089/x", ip, 8089));
        assert!(!url_on_device("https://10.0.0.8:8089/x", ip, 8089));
    }

    #[test]
    fn nested_file_uses_its_own_uri_when_the_name_matches() {
        let page = "http://10.0.0.8:8089/Note/Folder%202/Subfolder%202/";
        let url = resolve_listing_file_url(
            page,
            "Note 2.note",
            "/Note/Folder 2/Subfolder 2/Note 2.note",
        )
        .unwrap();
        assert!(url.ends_with("/Note/Folder 2/Subfolder 2/Note 2.note"));
    }

    #[test]
    fn uri_pointing_at_another_note_is_not_used() {
        let page = "http://10.0.0.8:8089/Note/Folder 2/Subfolder 2/";
        let url = resolve_listing_file_url(
            page,
            "Note 2.note",
            "/Note/Folder 2/Subfolder 1/Note 1.note",
        )
        .unwrap();
        assert!(url.ends_with("/Note/Folder 2/Subfolder 2/Note 2.note"));
        assert!(!url.contains("Note 1"));
    }

    #[test]
    fn relative_name_stays_in_the_listed_folder() {
        let page = "http://10.0.0.8:8089/Note/Folder 2/Subfolder 2/";
        let url = resolve_listing_file_url(page, "Note 2.note", "Note 2.note").unwrap();
        assert_eq!(
            url,
            "http://10.0.0.8:8089/Note/Folder 2/Subfolder 2/Note 2.note"
        );
    }

    #[test]
    fn request_encodes_spaces_without_double_encoding() {
        let raw = "http://10.0.0.8:8089/Note/Folder 2/Note%202.note";
        assert_eq!(
            encode_url_for_request(raw),
            "http://10.0.0.8:8089/Note/Folder%202/Note%202.note"
        );
    }

    #[test]
    fn note_component_is_exact() {
        assert_eq!(
            relative_under_note("/Notebooks/a.note"),
            PathBuf::from("Notebooks/a.note")
        );
        assert_eq!(
            relative_under_note("/Note/Folder/a.note"),
            PathBuf::from("Folder/a.note")
        );
    }

    #[test]
    fn device_dates_are_parsed_before_compare() {
        assert!(device_date_is_newer("2026-11-06 10:00", "2026-11-06 09:00"));
        assert!(!device_date_is_newer("not-a-date", "2026-11-06 09:00"));
        assert!(!device_date_is_newer("2026-11-06 09:00", "2026-13-01 00:00"));
    }

    #[test]
    fn sync_metadata_drops_unsafe_keys() {
        let mut files = HashMap::new();
        files.insert(
            "../secret.md".into(),
            SyncMetaEntry {
                pulled_at_ms: 1,
                device_date: Some("nope".into()),
                size: Some(u64::MAX),
            },
        );
        files.insert(
            "handwritten/Supernote/a.note".into(),
            SyncMetaEntry {
                pulled_at_ms: 2,
                device_date: Some("2026-01-02 03:04".into()),
                size: Some(12),
            },
        );
        let clean = validate_sync_meta(SyncMetaFile { files });
        assert_eq!(clean.files.len(), 1);
        let kept = clean.files.get("handwritten/Supernote/a.note").unwrap();
        assert_eq!(kept.device_date.as_deref(), Some("2026-01-02 03:04"));
        assert_eq!(kept.size, Some(12));
    }

    #[test]
    #[cfg(unix)]
    fn pull_refuses_a_symlinked_folder() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("metis-supernote-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("outside")).unwrap();
        let root = dir.join("Supernote");
        fs::create_dir_all(&root).unwrap();
        symlink(dir.join("outside"), root.join("linked")).unwrap();
        let err = pull_destination(&root, Path::new("linked/a.note")).unwrap_err();
        assert!(err.contains("link"));
        let _ = fs::remove_dir_all(&dir);
    }
}
