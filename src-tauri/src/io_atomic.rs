//! Replace a file by writing a temp file in the same directory, flushing it,
//! then renaming. A crash during the write leaves the previous file intact.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().filter(|parent| !parent.as_os_str().is_empty());
    let parent = parent.unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!(".{file_name}.{}.{nanos}.tmp", std::process::id()));
    let result = (|| {
        // SECURITY: create_new refuses a name that already exists, including a
        // pre-planted symlink. Open-or-truncate would follow that link.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| format!("Failed to open temp file: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush temp file: {e}"))?;
        drop(file);
        // Keep the mode of the file being replaced. A 0600 file must not
        // become world-readable because the temp file used the process umask.
        #[cfg(unix)]
        if let Ok(meta) = fs::symlink_metadata(path) {
            if !meta.file_type().is_symlink() {
                let _ = fs::set_permissions(&tmp, meta.permissions());
            }
        }
        fs::rename(&tmp, path).map_err(|e| format!("Failed to replace {}: {e}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::write_atomic;
    use std::fs;

    #[test]
    fn replace_keeps_a_complete_file() {
        let dir = std::env::temp_dir().join(format!("metis-atomic-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new content").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new content");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn exclusive_create_leaves_a_planted_link() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("metis-atomic-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let outside = dir.join("outside.txt");
        fs::write(&outside, b"keep").unwrap();
        let planted = dir.join(".note.md.planted.tmp");
        symlink(&outside, &planted).unwrap();
        // The temp file is opened with create_new, so a planted link is not followed.
        let opened = std::fs::OpenOptions::new().write(true).create_new(true).open(&planted);
        assert!(opened.is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"keep");
        write_atomic(&dir.join("note.md"), b"new content").unwrap();
        assert_eq!(fs::read(&outside).unwrap(), b"keep");
        assert_eq!(fs::read(dir.join("note.md")).unwrap(), b"new content");
        let _ = fs::remove_dir_all(&dir);
    }
}
