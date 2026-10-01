//! Rasterize Ratta `.note` pages for the editor (same pipeline as Obsidian’s
//! unofficial plugin: parse metadata, decode Ratta RLE / PNG layers, composite).
//!
//! SECURITY: vault-bound `.note` only; size and page-dimension caps. Bytes never
//! go through `get_file_content`. Algorithm follows Apache-2.0
//! `supernote-typescript` / `supernote-tool` (Ratta RLE).

use crate::security::{canon_vault, reject_untrusted_webview, safe_resolve};
use crate::state::CurrentVault;
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageBuffer, Rgba, imageops};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

const ADDR: usize = 4;
const MAX_FILE: u64 = 50 * 1024 * 1024;
const MAX_PAGES: usize = 200;
const MAX_DIM: u32 = 4096;
const SPECIAL_LEN_MARKER: u8 = 0xff;
const SPECIAL_LEN: u32 = 0x4000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupernotePageDto {
    pub page: u32,
    pub page_count: u32,
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
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

fn read_u32_le(buf: &[u8], at: usize) -> Result<u32, String> {
    let slice = buf
        .get(at..at + 4)
        .ok_or("Truncated .note file.")?;
    Ok(u32::from_le_bytes(slice.try_into().unwrap()))
}

fn content_at(buf: &[u8], address: u32) -> Result<Option<&[u8]>, String> {
    if address == 0 {
        return Ok(None);
    }
    let at = address as usize;
    let len = read_u32_le(buf, at)? as usize;
    let start = at + ADDR;
    let end = start
        .checked_add(len)
        .ok_or("Invalid .note block length.")?;
    if end > buf.len() {
        return Err("Truncated .note block.".into());
    }
    Ok(Some(&buf[start..end]))
}

fn parse_kv(buf: &[u8], address: u32) -> Result<HashMap<String, String>, String> {
    let Some(raw) = content_at(buf, address)? else {
        return Ok(HashMap::new());
    };
    let text = String::from_utf8_lossy(raw);
    let re = Regex::new(r"<([^:<>]+):([^:<>]*)>").expect("kv regex");
    let mut map = HashMap::new();
    for cap in re.captures_iter(&text) {
        map.insert(cap[1].to_string(), cap[2].to_string());
    }
    Ok(map)
}

fn kv_u32(map: &HashMap<String, String>, key: &str) -> u32 {
    map.get(key)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0)
}

fn pack_rgba(r: u8, g: u8, b: u8, a: u8) -> u32 {
    u32::from_le_bytes([r, g, b, a])
}

fn color_lut() -> [u32; 256] {
    let mut t = [pack_rgba(255, 255, 255, 0); 256];
    t[0x61] = pack_rgba(0, 0, 0, 255);
    t[0x62] = pack_rgba(0, 0, 0, 0);
    t[0x63] = pack_rgba(128, 128, 128, 255);
    t[0x64] = pack_rgba(169, 169, 169, 255);
    t[0x65] = pack_rgba(255, 255, 255, 255);
    t[0x66] = pack_rgba(0, 0, 0, 255);
    t[0x67] = pack_rgba(128, 128, 128, 255);
    t[0x68] = pack_rgba(169, 169, 169, 255);
    t[0x9d] = pack_rgba(128, 128, 128, 255);
    t[0xc9] = pack_rgba(169, 169, 169, 255);
    t[0x9e] = pack_rgba(128, 128, 128, 255);
    t[0xca] = pack_rgba(169, 169, 169, 255);
    t
}

fn adjust_tail(tail: u8, current_bytes: u32, expected_bytes: u32) -> u32 {
    let gap = expected_bytes.saturating_sub(current_bytes);
    for i in (0..8).rev() {
        let l = (((tail & 0x7f) as u32) + 1) << i;
        if l <= gap {
            return l;
        }
    }
    0
}

/// Ratta RLE → packed little-endian RGBA (`supernote-typescript` / supernote-tool).
fn decode_ratta_rle(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let total = (width as usize)
        .checked_mul(height as usize)
        .ok_or("Page is too large.")?;
    let lut = color_lut();
    let mut pixels = vec![0u32; total];
    let mut cursor: usize = 0;
    let mut holder: Option<(u8, u8)> = None;
    let mut i = 0;
    while i + 1 < data.len() {
        let color = data[i];
        let length = data[i + 1];
        i += 2;
        let mut waiting: Vec<(u8, u32)> = Vec::new();
        let mut pushed = false;
        if let Some((prev_color, prev_len)) = holder.take() {
            if color == prev_color {
                let combined = 1 + u32::from(length) + (((u32::from(prev_len) & 0x7f) + 1) << 7);
                waiting.push((color, combined));
                pushed = true;
            } else {
                waiting.push((prev_color, ((u32::from(prev_len) & 0x7f) + 1) << 7));
            }
        }
        if !pushed {
            if length == SPECIAL_LEN_MARKER {
                waiting.push((color, SPECIAL_LEN));
            } else if length & 0x80 != 0 {
                holder = Some((color, length));
            } else {
                waiting.push((color, u32::from(length) + 1));
            }
        }
        for (run_color, run_len) in waiting {
            let packed = lut[run_color as usize];
            let end = (cursor + run_len as usize).min(pixels.len());
            pixels[cursor..end].fill(packed);
            cursor += run_len as usize;
        }
    }
    if let Some((color, length)) = holder {
        let run_len = adjust_tail(length, (cursor as u32) * 4, (total as u32) * 4);
        if run_len > 0 {
            let packed = lut[color as usize];
            let end = (cursor + run_len as usize).min(pixels.len());
            pixels[cursor..end].fill(packed);
            cursor += run_len as usize;
        }
    }
    if cursor != total {
        return Err(format!(
            "Ratta RLE length mismatch ({cursor} pixels, expected {total})."
        ));
    }
    let mut out = Vec::with_capacity(total * 4);
    for p in pixels {
        out.extend_from_slice(&p.to_le_bytes());
    }
    Ok(out)
}

fn decode_png_layer(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(data).map_err(|e| format!("PNG layer: {e}"))?;
    let mut rgba = img.to_rgba8();
    if rgba.width() != width || rgba.height() != height {
        rgba = imageops::resize(&rgba, width, height, imageops::FilterType::Triangle);
    }
    Ok(rgba.into_raw())
}

fn decode_flate(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;
    let mut dec = ZlibDecoder::new(data);
    let mut raw = Vec::new();
    dec.read_to_end(&mut raw)
        .map_err(|e| format!("SN_ASA_COMPRESS: {e}"))?;
    let needed = width as usize * height as usize * 2;
    if raw.len() < needed {
        return Err("SN_ASA_COMPRESS bitmap is truncated.".into());
    }
    let mut out = vec![0u8; width as usize * height as usize * 4];
    for (i, px) in raw.chunks_exact(2).take(width as usize * height as usize).enumerate() {
        let v = u16::from_le_bytes([px[0], px[1]]);
        let (r, g, b, a) = match v {
            0x0000 => (0, 0, 0, 255),
            0xffff => (0, 0, 0, 0),
            0x2104 => (128, 128, 128, 255),
            0xe1e2 => (169, 169, 169, 255),
            _ => (0, 0, 0, 0),
        };
        let o = i * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
    }
    Ok(out)
}

fn decode_layer(data: &[u8], protocol: &str, style: &str, is_bg: bool, w: u32, h: u32) -> Result<Vec<u8>, String> {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) || (is_bg && style.starts_with("user_")) {
        return decode_png_layer(data, w, h);
    }
    if protocol == "SN_ASA_COMPRESS" {
        return decode_flate(data, w, h);
    }
    decode_ratta_rle(data, w, h)
}

fn composite(dst: &mut [u8], src: &[u8]) {
    for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
        if s[3] != 0 {
            d.copy_from_slice(s);
        }
    }
}

fn flatten_white(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.chunks_exact(4) {
        let a = f32::from(px[3]) / 255.0;
        out.push((f32::from(px[0]) * a + 255.0 * (1.0 - a)).round() as u8);
        out.push((f32::from(px[1]) * a + 255.0 * (1.0 - a)).round() as u8);
        out.push((f32::from(px[2]) * a + 255.0 * (1.0 - a)).round() as u8);
        out.push(255);
    }
    out
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let img: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(width, height, rgba.to_vec()).ok_or("Could not build page image.")?;
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    Ok(buf)
}

fn page_size(header: &HashMap<String, String>, landscape: bool) -> (u32, u32) {
    let mut w = 1404;
    let mut h = 1872;
    if header.get("APPLY_EQUIPMENT").map(|s| s.as_str()) == Some("N5") {
        w = 1920;
        h = 2560;
    }
    if landscape {
        std::mem::swap(&mut w, &mut h);
    }
    (w, h)
}

fn layer_visible(info: &str, name: &str) -> bool {
    if info.is_empty() || info == "0" {
        return true;
    }
    let json = if info.starts_with('[') {
        info.to_string()
    } else {
        let Ok(bytes) = STANDARD.decode(info.trim()) else {
            return true;
        };
        String::from_utf8_lossy(&bytes).into_owned()
    };
    let Ok(arr) = serde_json::from_str::<serde_json::Value>(&json) else {
        return true;
    };
    let Some(items) = arr.as_array() else {
        return true;
    };
    for layer in items {
        let is_bg = layer.get("isBackgroundLayer").and_then(|v| v.as_bool()) == Some(true);
        let id = layer.get("layerId").and_then(|v| v.as_i64()).unwrap_or(-1);
        let vis = layer.get("isVisible").and_then(|v| v.as_bool()).unwrap_or(true);
        let mapped = if is_bg {
            "BGLAYER"
        } else if id == 0 {
            "MAINLAYER"
        } else {
            match id {
                1 => "LAYER1",
                2 => "LAYER2",
                3 => "LAYER3",
                _ => "",
            }
        };
        if mapped == name {
            return vis;
        }
    }
    true
}

fn render_page(buf: &[u8], page: u32) -> Result<SupernotePageDto, String> {
    if buf.len() < 28 {
        return Err("File is not a Supernote notebook.".into());
    }
    let sig = String::from_utf8_lossy(&buf[..24.min(buf.len())]);
    if !sig.contains("SN_FILE_VER_") && !sig.contains("SN_FILE_ASA_") {
        return Err("File is not a Supernote notebook.".into());
    }
    let footer_addr = read_u32_le(buf, buf.len() - ADDR)?;
    let footer = parse_kv(buf, footer_addr)?;
    let header_addr = kv_u32(&footer, "FILE_FEATURE");
    let header = parse_kv(buf, header_addr)?;

    let mut pages: Vec<(String, u32)> = footer
        .iter()
        .filter(|(k, _)| {
            let rest = k.strip_prefix("PAGE").unwrap_or("");
            *k == "PAGE" || (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
        })
        .filter_map(|(k, v)| v.parse::<u32>().ok().map(|addr| (k.clone(), addr)))
        .collect();
    pages.sort_by(|a, b| {
        let na = a.0.trim_start_matches("PAGE").parse::<u32>().unwrap_or(0);
        let nb = b.0.trim_start_matches("PAGE").parse::<u32>().unwrap_or(0);
        na.cmp(&nb)
    });
    if pages.is_empty() {
        return Err("This notebook has no pages.".into());
    }
    if pages.len() > MAX_PAGES {
        return Err("Notebook has too many pages.".into());
    }
    let page_count = pages.len() as u32;
    if page == 0 || page as usize > pages.len() {
        return Err(format!("Page {page} is out of range (1–{page_count})."));
    }

    let mut landscape = true;
    let mut any_page = false;
    for (_, addr) in &pages {
        let meta = parse_kv(buf, *addr)?;
        any_page = true;
        let ori = meta.get("ORIENTATION").map(|s| s.as_str()).unwrap_or("0");
        if ori != "90" && ori != "270" {
            landscape = false;
            break;
        }
    }
    if !any_page {
        landscape = false;
    }
    let (width, height) = page_size(&header, landscape);
    if width == 0 || height == 0 || width > MAX_DIM || height > MAX_DIM {
        return Err("Unsupported page size.".into());
    }

    let page_addr = pages[page as usize - 1].1;
    let page_meta = parse_kv(buf, page_addr)?;
    let style = page_meta
        .get("PAGESTYLE")
        .cloned()
        .unwrap_or_else(|| "0".into());
    let seq = page_meta
        .get("LAYERSEQ")
        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            vec![
                "MAINLAYER".into(),
                "LAYER1".into(),
                "LAYER2".into(),
                "LAYER3".into(),
                "BGLAYER".into(),
            ]
        });
    let layer_info = page_meta.get("LAYERINFO").cloned().unwrap_or_default();

    let mut composed = vec![0u8; width as usize * height as usize * 4];
    let mut drew = false;
    for name in seq.iter().rev() {
        if !layer_visible(&layer_info, name) {
            continue;
        }
        let layer_addr = kv_u32(&page_meta, name);
        if layer_addr == 0 {
            continue;
        }
        let layer = parse_kv(buf, layer_addr)?;
        let bitmap_addr = kv_u32(&layer, "LAYERBITMAP");
        let Some(blob) = content_at(buf, bitmap_addr)? else {
            continue;
        };
        if blob.is_empty() {
            continue;
        }
        let proto = layer
            .get("LAYERPROTOCOL")
            .map(|s| s.as_str())
            .unwrap_or("RATTA_RLE");
        let decoded = decode_layer(blob, proto, &style, name == "BGLAYER", width, height)?;
        if decoded.len() != composed.len() {
            continue;
        }
        if name == "BGLAYER" {
            let mut bg = decoded;
            for px in bg.chunks_exact_mut(4) {
                if px[3] == 0 {
                    px[0] = 255;
                    px[1] = 255;
                    px[2] = 255;
                    px[3] = 255;
                }
            }
            composed.copy_from_slice(&bg);
        } else {
            composite(&mut composed, &decoded);
        }
        drew = true;
    }
    if !drew {
        composed.fill(255);
        for px in composed.chunks_exact_mut(4) {
            px[3] = 255;
        }
    }
    let flat = flatten_white(&composed);
    let png = encode_png(width, height, &flat)?;
    Ok(SupernotePageDto {
        page,
        page_count,
        width,
        height,
        png_base64: STANDARD.encode(png),
    })
}

fn render_path(path: PathBuf, page: u32) -> Result<SupernotePageDto, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Cannot read notebook: {e}"))?;
    if meta.len() > MAX_FILE {
        return Err("Notebook is too large (max 50 MB).".into());
    }
    let buf = fs::read(&path).map_err(|e| format!("Cannot read notebook: {e}"))?;
    render_page(&buf, page)
}

#[tauri::command]
pub async fn render_supernote_page(
    path: String,
    page: u32,
    window: tauri::WebviewWindow,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<SupernotePageDto, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let target = PathBuf::from(&path);
    if target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("note"))
        != Some(true)
    {
        return Err("render_supernote_page only accepts .note files.".into());
    }
    let resolved = safe_resolve(&target).map_err(|e| format!("render_supernote_page: {e}"))?;
    if !resolved.starts_with(&vault) {
        return Err("render_supernote_page: path is outside the active vault.".into());
    }
    if !resolved.is_file() {
        return Err("Notebook not found.".into());
    }
    tauri::async_runtime::spawn_blocking(move || render_path(resolved, page))
        .await
        .map_err(|e| format!("Render task failed: {e}"))?
}
