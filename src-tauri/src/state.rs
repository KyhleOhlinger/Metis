use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::sync::Mutex;

// ── Managed application state ─────────────────────────────────────────────────

/// Holds the active directory watcher for each open window so every window's
/// vault is watched independently.  Keyed by Tauri window label.
pub struct WatcherState(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// Tracks the vault path for each open window so file-operation commands can
/// enforce the correct vault boundary per window.
///
/// SECURITY: Commands that write, read, or delete files validate paths against
/// the entry for their specific window label, preventing any operation from
/// escaping a vault boundary even if the frontend IPC is abused.
pub struct CurrentVault(pub Mutex<HashMap<String, String>>);
