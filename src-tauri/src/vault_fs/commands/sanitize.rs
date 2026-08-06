use std::path::PathBuf;

/// Validate that `name` is safe to use as a file or folder name.
///
/// SECURITY controls applied:
///  - Empty / oversized names rejected
///  - Path separators, null bytes, and `..`/`.` components blocked
///  - Windows reserved device names (CON, NUL, COM1 … LPT9) rejected
///    cross-platform so notes created on macOS/Linux are also safe on Windows
pub(crate) fn sanitize_name(name: &str) -> Result<String, String> {
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
