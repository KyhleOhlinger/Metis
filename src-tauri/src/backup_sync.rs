//! GitHub backup of the open vault.
//!
//! SECURITY: Git runs only after the user selects GitHub, and only inside the
//! vault already opened for this window. Commands use an argument array (no
//! shell). Remotes are GitHub https or SSH with no embedded credentials. Sync
//! stages the selected Spaces, Files entries, and vault planner. It does not
//! delete vault files, and it does not stage API keys, personas, or the agent
//! run log (those live outside the vault). If the remote has commits this repo
//! does not, sync stops without pulling or pushing.

use crate::plugins::{core_plugin_enabled, require_core_plugin};
use crate::security::{registered_vault, write_private_json_file};
use crate::settings::app_data_dir_for_build;
use crate::state::CurrentVault;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SPACES: &[&str] = &["daily", "meetings", "summaries", "handwritten", "assets"];
const CONFIG_FILE: &str = "backup-sync.json";

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceFlags {
    daily: bool,
    meetings: bool,
    summaries: bool,
    handwritten: bool,
    assets: bool,
}

impl Default for SpaceFlags {
    fn default() -> Self {
        Self {
            daily: true,
            meetings: true,
            summaries: true,
            handwritten: true,
            assets: true,
        }
    }
}

impl SpaceFlags {
    fn enabled(&self, name: &str) -> bool {
        match name {
            "daily" => self.daily,
            "meetings" => self.meetings,
            "summaries" => self.summaries,
            "handwritten" => self.handwritten,
            "assets" => self.assets,
            _ => false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct VaultBackupOptions {
    /// 0 on configs written before the GitHub opt-in. 1 after that choice exists.
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    enabled: bool,
    /// Git init, commit, and push run only when this is true.
    #[serde(default)]
    github: bool,
    #[serde(default)]
    remote_url: String,
    #[serde(default)]
    spaces: SpaceFlags,
    #[serde(default = "default_true")]
    files: bool,
    /// Off until the user opts in. A vault's own config cannot turn this on.
    #[serde(default)]
    vault_planner: bool,
    /// 0 is off. Allowed: 15, 30, 60, 360, 1440.
    #[serde(default)]
    schedule_minutes: u32,
    #[serde(default)]
    last_success_ms: u64,
    #[serde(default)]
    last_error: String,
}

fn default_true() -> bool {
    true
}

impl Default for VaultBackupOptions {
    fn default() -> Self {
        Self {
            schema: 1,
            enabled: false,
            github: false,
            remote_url: String::new(),
            spaces: SpaceFlags::default(),
            files: true,
            vault_planner: false,
            schedule_minutes: 0,
            last_success_ms: 0,
            last_error: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupConfigFile {
    #[serde(default)]
    vaults: Vec<StoredVaultBackup>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredVaultBackup {
    vault_path: String,
    #[serde(flatten)]
    options: VaultBackupOptions,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    spaces: Vec<String>,
    files: Vec<String>,
    vault_planner: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSyncState {
    enabled: bool,
    github: bool,
    remote_url: String,
    spaces: SpaceFlags,
    files: bool,
    vault_planner: bool,
    schedule_minutes: u32,
    vault_path: String,
    last_success_ms: u64,
    last_error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSyncReport {
    status: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSyncOptionsInput {
    enabled: bool,
    github: bool,
    remote_url: String,
    spaces: SpaceFlags,
    files: bool,
    vault_planner: bool,
    schedule_minutes: u32,
}

fn vault_for_window(
    window: &tauri::WebviewWindow,
    vault_state: &tauri::State<'_, CurrentVault>,
) -> Result<PathBuf, String> {
    let vault = registered_vault(window, vault_state).map_err(|err| {
        if err == "No vault registered for this window." {
            "Open a vault before configuring backup sync.".into()
        } else {
            err
        }
    })?;
    require_core_plugin(&vault, "backup")?;
    Ok(vault)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir_for_build(app)?.join(CONFIG_FILE))
}

fn load_config(app: &tauri::AppHandle) -> Result<BackupConfigFile, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(BackupConfigFile::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read backup settings: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Backup settings are invalid: {e}"))
}

fn save_config(app: &tauri::AppHandle, file: &BackupConfigFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file)
        .map_err(|e| format!("Failed to encode backup settings: {e}"))?;
    write_private_json_file(&config_path(app)?, &json)
}

fn options_for<'a>(
    file: &'a BackupConfigFile,
    app: &tauri::AppHandle,
    vault: &Path,
) -> Option<&'a VaultBackupOptions> {
    let key = crate::vault_identity::decision_key(app, vault);
    file.vaults
        .iter()
        .find(|row| row.vault_path == key)
        .map(|row| &row.options)
}

fn upsert_options(
    file: &mut BackupConfigFile,
    app: &tauri::AppHandle,
    vault: &Path,
    options: VaultBackupOptions,
) {
    let key = crate::vault_identity::decision_key(app, vault);
    if let Some(row) = file.vaults.iter_mut().find(|row| row.vault_path == key) {
        row.options = options;
    } else {
        file.vaults.push(StoredVaultBackup {
            vault_path: key,
            options,
        });
    }
}

fn normalize_schedule(minutes: u32) -> Result<u32, String> {
    match minutes {
        0 | 15 | 30 | 60 | 360 | 1440 => Ok(minutes),
        _ => Err("Choose Off, 15 minutes, 30 minutes, hourly, every 6 hours, or daily.".into()),
    }
}

/// Configs written before the GitHub choice had no enable flag. A saved remote
/// means GitHub was already in use.
fn prepare_options(options: &mut VaultBackupOptions) {
    if options.schema >= 1 {
        if !options.enabled {
            options.github = false;
        }
        return;
    }
    if !options.remote_url.trim().is_empty() {
        options.enabled = true;
        options.github = true;
    }
    options.schema = 1;
}

fn state_from(vault: &Path, options: &VaultBackupOptions) -> BackupSyncState {
    BackupSyncState {
        enabled: options.enabled,
        github: options.github,
        remote_url: options.remote_url.clone(),
        spaces: options.spaces.clone(),
        files: options.files,
        vault_planner: options.vault_planner,
        schedule_minutes: options.schedule_minutes,
        vault_path: vault.to_string_lossy().into_owned(),
        last_success_ms: options.last_success_ms,
        last_error: options.last_error.clone(),
    }
}

#[tauri::command]
pub fn backup_sync_get(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
) -> Result<BackupSyncState, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let mut file = load_config(&app)?;
    let mut options = options_for(&file, &app, &vault).cloned().unwrap_or_default();
    let before = options.clone();
    prepare_options(&mut options);
    if options != before {
        upsert_options(&mut file, &app, &vault, options.clone());
        save_config(&app, &file)?;
    }
    Ok(state_from(&vault, &options))
}

#[tauri::command]
pub fn backup_sync_set_options(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
    options: BackupSyncOptionsInput,
) -> Result<BackupSyncState, String> {
    if !options.remote_url.trim().is_empty() {
        validate_github_remote(&options.remote_url)?;
    }
    let vault = vault_for_window(&window, &vault_state)?;
    let mut file = load_config(&app)?;
    let mut stored = options_for(&file, &app, &vault).cloned().unwrap_or_default();
    prepare_options(&mut stored);
    stored.enabled = options.enabled;
    stored.github = options.enabled && options.github;
    stored.remote_url = options.remote_url.trim().to_string();
    stored.spaces = options.spaces;
    stored.files = options.files;
    stored.vault_planner = options.vault_planner;
    stored.schedule_minutes = if stored.github {
        normalize_schedule(options.schedule_minutes)?
    } else {
        0
    };
    // Choosing GitHub makes this vault the repository. No second folder.
    if stored.github {
        ensure_git_repo(&vault)?;
    }
    upsert_options(&mut file, &app, &vault, stored.clone());
    save_config(&app, &file)?;
    Ok(state_from(&vault, &stored))
}

#[tauri::command]
pub fn backup_sync_run(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
    replace_origin: Option<bool>,
) -> Result<BackupSyncReport, String> {
    let result = backup_sync_run_inner(
        window.clone(),
        app.clone(),
        vault_state.clone(),
        replace_origin,
    );
    if let Err(err) = &result {
        if let Ok(vault) = vault_for_window(&window, &vault_state) {
            remember_backup_result(&app, &vault, Some(err));
        }
    }
    result
}

fn backup_sync_run_inner(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, CurrentVault>,
    replace_origin: Option<bool>,
) -> Result<BackupSyncReport, String> {
    let vault = vault_for_window(&window, &vault_state)?;
    let file = load_config(&app)?;
    let mut options = options_for(&file, &app, &vault).cloned().unwrap_or_default();
    prepare_options(&mut options);
    if !options.enabled {
        return Err("Turn on backup before syncing.".into());
    }
    if !options.github {
        return Err("Choose GitHub before syncing. The vault is not made into a Git repository until then.".into());
    }
    validate_github_remote(&options.remote_url)?;
    if options.remote_url.trim().is_empty() {
        return Err("Set a GitHub remote before syncing.".into());
    }
    ensure_git_repo(&vault)?;
    let url = options.remote_url.trim();
    let branch = current_branch(&vault)?;
    if let Some(existing) = current_origin(&vault)? {
        if existing != url && !replace_origin.unwrap_or(false) {
            let message = format!(
                "This vault's origin is {existing}. Replace it with {url} before syncing?"
            );
            remember_backup_result(&app, &vault, Some(&message));
            return Ok(BackupSyncReport {
                status: "origin_differs".into(),
                message,
            });
        }
    }
    ensure_origin(&vault, url)?;
    if remote_has_commits_we_lack(&vault, &branch)? {
        let message = format!(
            "origin/{branch} has commits this backup does not. Sync did not pull or push."
        );
        remember_backup_result(&app, &vault, Some(&message));
        return Ok(BackupSyncReport {
            status: "remote_ahead".into(),
            message,
        });
    }

    let include_vault_planner =
        options.vault_planner && core_plugin_enabled(&vault, "planner");
    let manifest = manifest_for(&vault, &options, include_vault_planner)?;
    // SECURITY: stage selected vault paths only. Do not add the whole vault, and
    // do not delete files that were left out of this backup.
    stage_backup(&vault, &manifest)?;
    let cached = git_raw(&vault, &["diff", "--cached", "--quiet"])?;
    let mut message = String::new();
    if cached.status.success() {
        message.push_str("Backup already matches the last commit. ");
    } else if cached.status.code() == Some(1) {
        git(&vault, &["commit", "-m", "Metis backup"])?;
        message.push_str("Committed the selected backup. ");
    } else {
        return Err("Could not read the backup commit state.".into());
    }

    if let Some(push_to) = push_origin(&vault)? {
        if push_to != url {
            return Err(
                "Backup refused: origin's push URL is not the GitHub remote configured in Settings."
                    .into(),
            );
        }
    }
    git(&vault, &["push", "-u", "origin", &branch])?;
    message.push_str(&format!("Pushed {branch} to origin."));
    remember_backup_result(&app, &vault, None);
    Ok(BackupSyncReport {
        status: "ok".into(),
        message,
    })
}

fn current_branch(repo: &Path) -> Result<String, String> {
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch.trim();
    if branch.is_empty() || branch == "HEAD" {
        return Err("The backup repository is not on a branch.".into());
    }
    if !branch
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        || branch.starts_with('-')
        || branch.contains("..")
    {
        return Err("The backup branch name is not safe to push.".into());
    }
    Ok(branch.to_string())
}

fn remember_backup_result(app: &tauri::AppHandle, vault: &Path, error: Option<&str>) {
    let Ok(mut file) = load_config(app) else {
        return;
    };
    let mut options = options_for(&file, app, vault).cloned().unwrap_or_default();
    match error {
        Some(message) => {
            options.last_error = message.chars().take(500).collect();
        }
        None => {
            options.last_error.clear();
            options.last_success_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
        }
    }
    upsert_options(&mut file, app, vault, options);
    let _ = save_config(app, &file);
}

fn manifest_for(
    vault: &Path,
    options: &VaultBackupOptions,
    include_vault_planner: bool,
) -> Result<BackupManifest, String> {
    let mut spaces = Vec::new();
    for name in SPACES {
        if options.spaces.enabled(name) {
            spaces.push((*name).to_string());
        }
    }
    let files = if options.files {
        files_section_names(vault)?
    } else {
        Vec::new()
    };
    Ok(BackupManifest {
        spaces,
        files,
        vault_planner: include_vault_planner,
    })
}

fn files_section_names(vault: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(vault).map_err(|e| format!("Cannot read vault: {e}"))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_files_section_name(&name) {
            continue;
        }
        names.push(name);
    }
    names.sort();
    Ok(names)
}

fn is_files_section_name(name: &str) -> bool {
    if name.starts_with('.') || name == ".git" {
        return false;
    }
    if SPACES.iter().any(|space| space.eq_ignore_ascii_case(name)) {
        return false;
    }
    if name.to_ascii_lowercase().ends_with(".note") && !name.contains('/') && !name.contains('\\')
    {
        return false;
    }
    if is_secret_file_name(name) {
        return false;
    }
    true
}

fn is_secret_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
        || lower.starts_with("id_")
        || lower.starts_with("credentials")
        || lower == ".env"
        || lower.starts_with(".env.")
}

const DEFAULT_GITIGNORE: &str = "\
# Added by Metis backup sync. This file is left alone once it exists.
.DS_Store
.DS_Store?
._*
Thumbs.db
ehthumbs.db
Desktop.ini
*.log
.env
.env.*
.*.tmp
";

/// Create `.git` and a default `.gitignore` only for the GitHub backup option.
fn ensure_git_repo(repo: &Path) -> Result<(), String> {
    require_real_git_dir(repo)?;
    if !repo.join(".git").exists() {
        git(repo, &["init", "-b", "main"])?;
    }
    ensure_default_gitignore(repo)
}

/// `.git` has to be a real directory. A file (`gitdir:`) or a link is refused
/// before any git command runs.
fn require_real_git_dir(repo: &Path) -> Result<(), String> {
    let git_dir = repo.join(".git");
    if !git_dir.exists() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(&git_dir)
        .map_err(|e| format!("Backup refused: cannot read .git ({e})."))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("Backup refused: .git must be a real directory inside the vault.".into());
    }
    // A commondir file makes Git read config and attributes from another
    // directory. That other config is not the file scanned above, and a clean
    // filter in it runs on `git add`. Refuse the pointer before any Git command.
    match fs::symlink_metadata(git_dir.join("commondir")) {
        Ok(_) => Err(
            "Backup refused: .git/commondir points Git at another config.".into(),
        ),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Backup refused: cannot read .git/commondir ({err}).")),
    }
}
fn ensure_default_gitignore(repo: &Path) -> Result<(), String> {
    let path = repo.join(".gitignore");
    if path.exists() {
        return Ok(());
    }
    fs::write(&path, DEFAULT_GITIGNORE).map_err(|e| format!("Failed to write .gitignore: {e}"))
}

/// GitHub https or SSH remotes only. Rejects URL credentials and other hosts.
pub(crate) fn validate_github_remote(raw: &str) -> Result<(), String> {
    let url = raw.trim();
    if url.is_empty() {
        return Ok(());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("The Git remote contains spaces or control characters.".into());
    }
    if url.starts_with("git@github.com:") {
        let path = &url["git@github.com:".len()..];
        return github_repo_path(path);
    }
    if url.starts_with("ssh://git@github.com/") {
        let path = &url["ssh://git@github.com/".len()..];
        return github_repo_path(path);
    }
    if url.starts_with("https://github.com/") {
        let rest = &url["https://github.com/".len()..];
        if rest.contains('@') {
            return Err("The Git remote must not include a username or password.".into());
        }
        return github_repo_path(rest);
    }
    Err("Use a GitHub remote (https://github.com/owner/repo or git@github.com:owner/repo.git).".into())
}

fn github_repo_path(path: &str) -> Result<(), String> {
    let path = path.trim_end_matches(".git");
    let mut parts = path.split('/').filter(|p| !p.is_empty());
    let Some(owner) = parts.next() else {
        return Err("The GitHub remote is missing an owner and repository.".into());
    };
    let Some(repo) = parts.next() else {
        return Err("The GitHub remote is missing a repository name.".into());
    };
    if parts.next().is_some() {
        return Err("The GitHub remote should be a repository, not a file path.".into());
    }
    if !is_github_name(owner) || !is_github_name(repo) {
        return Err("The GitHub owner or repository name is not valid.".into());
    }
    Ok(())
}

fn is_github_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.ends_with('.')
}

fn push_origin(repo: &Path) -> Result<Option<String>, String> {
    let out = git_raw(repo, &["remote", "get-url", "--push", "origin"])?;
    if !out.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() { Ok(None) } else { Ok(Some(url)) }
}

fn current_origin(repo: &Path) -> Result<Option<String>, String> {
    let out = git_raw(repo, &["remote", "get-url", "origin"])?;
    if !out.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        Ok(None)
    } else {
        Ok(Some(url))
    }
}

fn ensure_origin(repo: &Path, url: &str) -> Result<(), String> {
    if current_origin(repo)?.is_some() {
        git(repo, &["remote", "set-url", "origin", url])?;
    } else {
        git(repo, &["remote", "add", "origin", url])?;
    }
    Ok(())
}

fn stage_backup(repo: &Path, selected: &BackupManifest) -> Result<(), String> {
    let mut paths = Vec::new();
    for name in &selected.spaces {
        if repo.join(name).exists() {
            paths.push(name.clone());
        }
    }
    for name in &selected.files {
        if repo.join(name).exists() {
            paths.push(name.clone());
        }
    }
    if selected.vault_planner && repo.join(".metis").join("planner").exists() {
        paths.push(".metis/planner".into());
    }
    if repo.join(".gitignore").exists() {
        paths.push(".gitignore".into());
    }
    if paths.is_empty() {
        return Ok(());
    }
    // Exclude pathspecs come before `--`. Names after `--` are the selection.
    let mut args = vec![
        "add".into(),
        "-A".into(),
        ":(exclude,glob)**/*.pem".into(),
        ":(exclude,glob)**/*.key".into(),
        ":(exclude,glob)**/*.p12".into(),
        ":(exclude,glob)**/id_*".into(),
        ":(exclude,glob)**/credentials*".into(),
        ":(exclude,glob)**/.env".into(),
        ":(exclude,glob)**/.env.*".into(),
        ":(exclude,glob)**/.*.tmp".into(),
        "--".into(),
    ];
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git(repo, &refs)?;
    Ok(())
}

fn remote_has_commits_we_lack(repo: &Path, branch: &str) -> Result<bool, String> {
    let fetch = git_raw(repo, &["fetch", "origin", branch])?;
    if !fetch.status.success() {
        let err = String::from_utf8_lossy(&fetch.stderr);
        if fetch_failed_for_missing_refs(&err) {
            return Ok(false);
        }
        return Err(format!("Could not fetch the remote: {}", err.trim()));
    }
    let remote_ref = format!("origin/{branch}");
    let remote_ref = first_existing_ref(repo, &[&remote_ref])?;
    let Some(remote_ref) = remote_ref else {
        return Ok(false);
    };
    if git_raw(repo, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success()
    {
        let check = git_raw(repo, &["merge-base", "--is-ancestor", &remote_ref, "HEAD"])?;
        Ok(!check.status.success())
    } else {
        Ok(true)
    }
}

fn fetch_failed_for_missing_refs(err: &str) -> bool {
    err.contains("couldn't find remote ref")
        || err.contains("remote repository is empty")
        || err.contains("no such ref")
}

fn first_existing_ref(repo: &Path, candidates: &[&str]) -> Result<Option<String>, String> {
    for name in candidates {
        let out = git_raw(repo, &["rev-parse", "--verify", "--quiet", name])?;
        if out.status.success() {
            return Ok(Some((*name).to_string()));
        }
    }
    Ok(None)
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_raw(repo, args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if err.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else {
            err
        };
        Err(format!("Git failed: {detail}"))
    }
}

fn git_config_key_allowed(section: &str, key: &str) -> bool {
    let section = section.to_ascii_lowercase();
    let key = key.to_ascii_lowercase();
    match section.as_str() {
        "core" => matches!(
            key.as_str(),
            "repositoryformatversion"
                | "filemode"
                | "bare"
                | "logallrefupdates"
                | "ignorecase"
                | "precomposeunicode"
        ),
        "remote.origin" | "remote \"origin\"" => matches!(key.as_str(), "url" | "fetch"),
        "user" => true,
        other if other.starts_with("branch.") => matches!(key.as_str(), "remote" | "merge"),
        _ => false,
    }
}

/// First config key outside the backup allowlist. `include.path`,
/// `remote.origin.pushurl`, `url.*.insteadOf`, and clean-filter keys are refused.
fn disallowed_git_key(config: &str) -> Option<String> {
    let mut section = String::new();
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('[') {
            let Some((header, after)) = rest.split_once(']') else {
                continue;
            };
            let header = header.trim();
            section = header
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches('"')
                .to_ascii_lowercase();
            if header.to_ascii_lowercase().starts_with("remote ") {
                let name = header
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_ascii_lowercase();
                section = format!("remote.{name}");
            }
            if header.to_ascii_lowercase().starts_with("branch ") {
                let name = header
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_ascii_lowercase();
                section = format!("branch.{name}");
            }
            if header.to_ascii_lowercase().starts_with("url ") {
                section = "url".into();
            }
            let after = after.trim();
            if after.is_empty() {
                continue;
            }
            if let Some(setting) = disallowed_assignment(&section, after) {
                return Some(setting);
            }
            continue;
        }
        if let Some(setting) = disallowed_assignment(&section, trimmed) {
            return Some(setting);
        }
    }
    None
}

fn disallowed_assignment(section: &str, line: &str) -> Option<String> {
    let key = line
        .split('=')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if key.is_empty() {
        return None;
    }
    if git_config_key_allowed(section, &key) {
        None
    } else {
        Some(format!("{section}.{key}"))
    }
}

fn attributes_define_filter(text: &str) -> bool {
    text.lines().any(|line| {
        let code = line.split('#').next().unwrap_or("");
        code.to_ascii_lowercase().contains("filter=")
    })
}

fn refuse_hostile_git_config(repo: &Path) -> Result<(), String> {
    require_real_git_dir(repo)?;
    let path = repo.join(".git").join("config");
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err("Backup refused: .git/config is a link.".into());
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if let Some(setting) = disallowed_git_key(&text) {
                return Err(format!(
                    "Backup refused: this vault's git config sets {setting}."
                ));
            }
        }
    }
    walk_attributes(repo, 0)?;
    let info = repo.join(".git").join("info").join("attributes");
    if let Ok(meta) = fs::symlink_metadata(&info) {
        if meta.file_type().is_symlink() {
            return Err("Backup refused: git attributes are a link.".into());
        }
        if let Ok(text) = fs::read_to_string(&info) {
            if attributes_define_filter(&text) {
                return Err(
                    "Backup refused: a git attributes file defines a clean filter.".into(),
                );
            }
        }
    }
    Ok(())
}

/// Nested `.gitattributes` are checked. Directory links are not followed.
fn walk_attributes(dir: &Path, depth: u32) -> Result<(), String> {
    if depth > 12 {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if entry.file_name() == ".git" {
                continue;
            }
            walk_attributes(&path, depth + 1)?;
            continue;
        }
        if entry.file_name() == ".gitattributes" {
            if let Ok(text) = fs::read_to_string(&path) {
                if attributes_define_filter(&text) {
                    return Err(
                        "Backup refused: a git attributes file defines a clean filter.".into(),
                    );
                }
            }
        }
    }
    Ok(())
}

fn git_raw(repo: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    refuse_hostile_git_config(repo)?;
    let git_dir = repo.join(".git");
    Command::new("git")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .arg("-c")
        .arg("protocol.ext.allow=never")
        .args(args)
        .current_dir(repo)
        .env("GIT_DIR", &git_dir)
        .env("GIT_COMMON_DIR", &git_dir)
        .env("GIT_WORK_TREE", repo)
        .env("GIT_CEILING_DIRECTORIES", repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .map_err(|e| format!("Git is not available ({e}). Install Git and try again."))
}

#[cfg(test)]
mod tests {
    use super::{
        attributes_define_filter, disallowed_git_key, ensure_default_gitignore, is_files_section_name,
        require_real_git_dir,
        prepare_options,
        validate_github_remote, SpaceFlags, VaultBackupOptions,
    };
    use std::fs;

    #[test]
    fn hostile_repo_config_is_named() {
        let config = "[core]\nfsmonitor = touch /tmp/pwned\n[credential]\nhelper = store\n";
        assert_eq!(disallowed_git_key(config).as_deref(), Some("core.fsmonitor"));
        assert_eq!(disallowed_git_key("[user]\nname = Metis\n"), None);
        assert_eq!(
            disallowed_git_key("[include]\npath = ../evil\n").as_deref(),
            Some("include.path")
        );
        assert_eq!(
            disallowed_git_key("[remote \"origin\"]\npushurl = git@evil.example:x.git\n").as_deref(),
            Some("remote.origin.pushurl")
        );
        assert!(disallowed_git_key("[url \"git@evil:x\"]\ninsteadOf = https://github.com/\n").is_some());
        assert_eq!(
            disallowed_git_key("[filter \"x\"] clean = touch /tmp/pwn").as_deref(),
            Some("filter.clean")
        );
        assert_eq!(
            disallowed_git_key("[include] path = ../x.cfg").as_deref(),
            Some("include.path")
        );
        assert!(attributes_define_filter("*.md filter=secret\n"));
        assert!(!is_files_section_name("id_rsa"));
        assert!(!is_files_section_name("notes.pem"));
    }

    #[test]
    fn git_commondir_is_refused_before_git_runs() {
        let root = std::env::temp_dir().join(format!("metis-commondir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).unwrap();
        assert!(require_real_git_dir(&root).is_ok());
        fs::write(root.join(".git").join("commondir"), "other.git\n").unwrap();
        fs::create_dir_all(root.join("other.git")).unwrap();
        let err = require_real_git_dir(&root).unwrap_err();
        assert!(err.contains("commondir"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn github_remote_rules() {
        assert!(validate_github_remote("").is_ok());
        assert!(validate_github_remote("https://github.com/KyhleOhlinger/Metis.git").is_ok());
        assert!(validate_github_remote("git@github.com:KyhleOhlinger/Metis.git").is_ok());
        assert!(validate_github_remote("https://user:token@github.com/a/b.git").is_err());
        assert!(validate_github_remote("https://gitlab.com/a/b.git").is_err());
        assert!(validate_github_remote("file:///tmp/repo").is_err());
    }

    #[test]
    fn legacy_remote_keeps_github_on() {
        let mut options = VaultBackupOptions {
            schema: 0,
            remote_url: "https://github.com/owner/repo.git".into(),
            ..VaultBackupOptions::default()
        };
        options.schema = 0;
        options.enabled = false;
        options.github = false;
        prepare_options(&mut options);
        assert!(options.enabled);
        assert!(options.github);
        assert_eq!(options.schema, 1);
    }

    #[test]
    fn schema_without_remote_stays_off() {
        let mut options = VaultBackupOptions::default();
        options.schema = 0;
        options.remote_url.clear();
        prepare_options(&mut options);
        assert!(!options.enabled);
        assert!(!options.github);
        assert_eq!(options.schema, 1);
    }

    #[test]
    fn new_backup_stays_off() {
        let mut options = VaultBackupOptions::default();
        prepare_options(&mut options);
        assert!(!options.enabled);
        assert!(!options.github);
    }

    #[test]
    fn files_section_skips_spaces_and_dotfiles() {
        assert!(is_files_section_name("Notes"));
        assert!(is_files_section_name("inbox.md"));
        assert!(!is_files_section_name("daily"));
        assert!(!is_files_section_name(".metis"));
        assert!(!is_files_section_name(".git"));
        assert!(!is_files_section_name("page.note"));
    }

    #[test]
    fn unchecked_space_is_not_copied() {
        let spaces = SpaceFlags {
            daily: false,
            ..SpaceFlags::default()
        };
        assert!(!spaces.enabled("daily"));
        assert!(spaces.enabled("assets"));
    }

    #[test]
    fn default_gitignore_is_written_once() {
        let root = std::env::temp_dir().join(format!("metis-gitignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        ensure_default_gitignore(&root).unwrap();
        let text = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(text.contains(".DS_Store"));
        assert!(text.contains(".env"));
        fs::write(root.join(".gitignore"), "keep\n").unwrap();
        ensure_default_gitignore(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join(".gitignore")).unwrap(), "keep\n");
        let _ = fs::remove_dir_all(&root);
    }
}
