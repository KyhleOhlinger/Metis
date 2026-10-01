//! Supernote Nomad Browse & Access pull into `handwritten/Supernote/`.
//!
//! SECURITY: HTTP stays in Rust (not the webview HTTP plugin). Destination is a
//! user-supplied IPv4 on RFC1918 or Tailscale CGNAT. Page viewing is `supernote_render`.

use crate::security::{canon_vault, reject_untrusted_webview, safe_resolve};
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
const LISTING_TIMEOUT_SECS: u64 = 12;
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

fn sanitize_device_date(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || t.len() > 40 {
        return None;
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | ' ' | 'T' | '.' | '/'))
    {
        return None;
    }
    Some(t.to_string())
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
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_sync_meta(vault: &Path, meta: &SyncMetaFile) -> Result<(), String> {
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
            Some(stored) if remote > stored => return true,
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
    reject_untrusted_webview(window)?;
    let lock = vault_state.0.lock().unwrap();
    let vault_str = lock
        .get(window.label())
        .ok_or("No vault registered for this window.")?
        .clone();
    drop(lock);
    canon_vault(&PathBuf::from(vault_str))
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Metis-Supernote/1")
        .build()
        .map_err(|e| format!("Could not create HTTP client: {e}"))
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
    let prefix = format!(
        "http://{}.{}.{}.{}:{port}",
        ip[0], ip[1], ip[2], ip[3]
    );
    url.starts_with(&prefix)
}

fn listing_path_from_url(url: &str, ip: [u8; 4], port: u16) -> String {
    let prefix = format!(
        "http://{}.{}.{}.{}:{port}",
        ip[0], ip[1], ip[2], ip[3]
    );
    url.strip_prefix(&prefix).unwrap_or("/").to_string()
}

fn relative_under_note(url_path: &str) -> PathBuf {
    let path = url_path.trim_start_matches('/');
    let rest = path
        .strip_prefix("Note/")
        .or_else(|| path.strip_prefix("Note"))
        .unwrap_or(path);
    PathBuf::from(rest.trim_start_matches('/'))
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

fn pull_tmp_path(dest: &Path) -> PathBuf {
    let name = dest
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    dest.with_file_name(format!(".{name}.metis-pull"))
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
    origin: &str,
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
        let href = if uri.is_empty() { name } else { uri };
        let Some(abs) = join_url(&format!("{origin}/"), href) else {
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
    origin: &str,
    octets: [u8; 4],
    port: u16,
) -> Vec<ListingLink> {
    links_from_json(html, origin, octets, port)
        .unwrap_or_else(|| links_from_hrefs(html, page_url, octets, port))
}

fn get_listing(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let res = client
        .get(url)
        .send()
        .map_err(|e| {
            format!(
                "Could not reach Browse & Access ({e}). Enable it on the Nomad and confirm you are on the same Wi-Fi."
            )
        })?;
    if !res.status().is_success() {
        return Err(format!(
            "Browse & Access returned HTTP {} for {url}",
            res.status().as_u16()
        ));
    }
    let bytes = res
        .bytes()
        .map_err(|e| format!("Failed to read directory listing: {e}"))?;
    if bytes.len() > MAX_LISTING_BYTES {
        return Err("Directory listing is too large.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn ensure_supernote_folder(
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<String, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let handwritten = vault.join(DEST_SPACE);
    fs::create_dir_all(&handwritten).map_err(|e| format!("Cannot create handwritten/: {e}"))?;
    let dest = dest_dir(&vault);
    fs::create_dir_all(&dest).map_err(|e| format!("Cannot create handwritten/Supernote/: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sync_supernote_browse_access(
    ip: String,
    port: Option<u16>,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<SupernoteSyncResult, String> {
    let vault = vault_for_window(&window, &vault_state)?;
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
    fs::create_dir_all(vault.join(DEST_SPACE))
        .map_err(|e| format!("Cannot create handwritten/: {e}"))?;
    fs::create_dir_all(&dest_root)
        .map_err(|e| format!("Cannot create handwritten/Supernote/: {e}"))?;
    let mut sync_meta = load_sync_meta(&vault);

    let origin = format!(
        "http://{}.{}.{}.{}:{port}",
        octets[0], octets[1], octets[2], octets[3]
    );
    let list_client = http_client(LISTING_TIMEOUT_SECS)?;
    let file_client = http_client(FILE_TIMEOUT_SECS)?;

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

        let html = match get_listing(&list_client, &page_url) {
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

        for link in listing_links(&html, &page_url, &origin, octets, port) {
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
            let dest = dest_root.join(&rel);
            if !dest.starts_with(&dest_root) {
                continue;
            }
            let existed = dest.exists();
            let key_opt = vault_rel_key(&vault, &dest);
            let prev = key_opt
                .as_ref()
                .and_then(|k| sync_meta.files.get(k).cloned());
            if existed && !should_pull(&dest, link.size, link.date.as_deref(), prev.as_ref()) {
                skipped += 1;
                let keep_older_device = matches!(
                    (link.date.as_deref(), prev.as_ref().and_then(|p| p.device_date.as_deref())),
                    (Some(remote), Some(stored)) if remote < stored
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
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
            }
            let res = file_client.get(&link.abs).send().map_err(|e| {
                format!("Download failed for {}: {e}", rel.display())
            })?;
            if !res.status().is_success() {
                continue;
            }
            let ctype = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ctype.contains("text/html") {
                continue;
            }
            let bytes = res
                .bytes()
                .map_err(|e| format!("Download failed for {}: {e}", rel.display()))?;
            if bytes.len() > MAX_FILE_BYTES {
                continue;
            }
            if existed {
                if let Ok(current) = fs::read(&dest) {
                    if current.as_slice() == bytes.as_ref() {
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
            let tmp = pull_tmp_path(&dest);
            fs::write(&tmp, &bytes)
                .map_err(|e| format!("Failed to save {}: {e}", rel.display()))?;
            fs::rename(&tmp, &dest).map_err(|e| {
                let _ = fs::remove_file(&tmp);
                format!("Failed to save {}: {e}", rel.display())
            })?;
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
