use serde::{Deserialize, Serialize};

// ── Shared data types (serialised to the frontend via JSON) ──────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    /// Absolute path on the local filesystem
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Deserialize)]
pub struct VaultData {
    /// Absolute path to the vault root directory
    pub path: String,
    pub files: Vec<FileNode>,
    /// True when a `.metis/vault.json` marker file is present in the root.
    pub is_metis_vault: bool,
    /// Set only for non-Metis vaults to hint at the originating tool.
    /// Possible values: "obsidian" | "markdown" | null
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_hint: Option<String>,
    /// Vault-relative folder for pasted/saved images (default `assets`).
    #[serde(default = "default_image_dir_str")]
    pub default_image_dir: String,
}

/// Persisted in `.metis/vault.json` to identify a Metis vault.
#[derive(Serialize, Deserialize, Clone)]
pub struct VaultMeta {
    pub version: String,
    pub name: String,
    pub created_at_unix: u64,
    pub metis_version: String,
    #[serde(default = "default_image_dir_str")]
    pub default_image_dir: String,
}

pub fn default_image_dir_str() -> String {
    "assets".into()
}

/// Emitted as the `convert-vault-progress` Tauri event during vault conversion.
#[derive(Serialize, Clone)]
pub struct ConvertProgress {
    pub step: String,
    pub current: usize,
    pub total: usize,
}

#[derive(serde::Serialize)]
pub struct VaultImageBase64 {
    pub data_base64: String,
    pub mime_type: String,
}
#[derive(Serialize, Clone)]
pub struct FileSummary {
    pub path: String,
    pub name: String,
    /// First 400 characters of the file — enough for title + opening lines.
    pub preview: String,
    pub char_count: usize,
}

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub file_path: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

/// Per-file replacement summary returned by `replace_in_vault`.
#[derive(Serialize, Clone)]
pub struct ReplaceSummary {
    pub file_path: String,
    pub file_name: String,
    pub replacements: usize,
}

