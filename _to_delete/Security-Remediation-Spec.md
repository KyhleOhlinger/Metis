# Metis Security Remediation Spec

| | |
|---|---|
| **Product** | Metis (Tauri 2 desktop app, `com.metis.desktop`) |
| **Version reviewed** | 0.15.24 |
| **Review date** | 2026-11-05 |
| **Reviews covered** | (1) Vulnerability / configuration review, (2) Logic review |
| **Status** | Draft. No fixes applied yet. |

## 0. How to use this spec

Each finding has an ID, a severity, the code location, what is wrong, the fix to build, and acceptance criteria. Work the phases in section 4 in order. Mark each finding `Open`, `In progress`, `Fixed`, or `Won't fix` in the tracker table (section 3) as it moves.

IDs: `SEC-nn` come from the vulnerability review. `LOG-nn` come from the logic review. `INFO-nn` are low-risk observations.

Severity is the reviewer's judgement of impact times likelihood for a local, single-user desktop app. Most issues need a script injection in the webview, a hostile vault, or a hostile LAN device first. Several are marked **Verify first** because the claim comes from code that was only partly visible. Reproduce those before changing code.

### Scope and limits of the review

- Read: Tauri config and capabilities, all Rust under `src-tauri/src`, the AI/provider services, Markdown rendering and sanitising, plugin store, export and backup services, agent write path, scripts, lockfile versions.
- Not read: most UI components (settings panels, planner tabs, editor widgets other than `inlinePreviewPlugin.ts`), CSS, built `dist/`, `help.html`.
- Not done: `npm audit` and `cargo audit` (registries unreachable from the review sandbox), git history secret scan, dynamic testing, fuzzing.
- First action for the next session: run `npm audit`, `cargo audit`, and a secret scan (`gitleaks` or similar) on a networked machine and add results here.

### Existing strengths to preserve

Do not regress these while fixing the items below.

- Rust-side vault boundary checks (`registered_vault`, `safe_resolve`, `starts_with`) on every vault command.
- Export paths gated by dialog grants (`pick_save_path`, `pick_export_directory`).
- Help window isolated by capability and label check.
- Owner-only (0600) writes for app-data JSON.
- Plugins are CSS-only. `main.js` is never executed.
- CSS filter decodes escapes and comments before matching.
- Backup git calls use argument arrays, a validated GitHub remote, and refuse to push when the remote is ahead.
- SVG is excluded from uploads. Agent writes need an explicit Apply click.

---

## 1. Vulnerability review findings

### SEC-01 (Medium): Network allowlist is bypassed by wildcard capability

- **Where:** `src-tauri/capabilities/default.json` (`{"url": "https://*"}`, `{"url": "https://*:*/*"}`); `src-tauri/tauri.conf.json` CSP `connect-src ... https:`; `src/services/metisFetch.ts`; `src/utils/providerUrlSafety.ts`; `tauri-plugin-http` with `unsafe-headers`.
- **Problem:** The named provider list and the `assertProfileHost` pin exist only in frontend JavaScript. The capability and CSP allow any HTTPS host, and `unsafe-headers` lets the webview set arbitrary headers. Any script that runs in the webview can send vault text or API keys to any HTTPS server.
- **Fix:**
  1. Remove the two wildcard entries from `default.json` and `https:` from `connect-src`.
  2. Keep the fixed provider list. For OpenAI-compatible and LiteLLM gateways, add the user's host at runtime. Use a Rust command (for example `allow_gateway_host(url)`) that validates the URL, shows a native confirmation dialog, stores the host in app data, and extends the HTTP scope (`tauri-plugin-http` runtime scope or a Rust-side proxy command).
  3. Prefer routing all AI requests through one Rust command that enforces the host and strips or sets headers itself. Then drop `unsafe-headers` from `Cargo.toml`.
  4. Loopback entries (`http://127.0.0.1:**`, `http://localhost:**`) stay only if a loopback gateway is configured. Otherwise remove them.
- **Acceptance:**
  - From devtools, `fetch("https://example.org")` through the plugin is rejected.
  - A configured custom gateway works only after the native confirmation.
  - A unit test asserts `default.json` contains no `https://*` entry.

### SEC-02 (Medium): Any directory can be opened as a vault

- **Where:** `vault_fs/commands/vault_open.rs` (`open_vault`, `create_vault`); `shell.rs` (`open_vault_window`).
- **Problem:** These commands accept any path string from the webview. There is no check that the path came from the folder picker. After `open_vault("/Users/x")` every vault-bounded command (read, write, delete recursively, search/replace) applies to the whole home folder.
- **Fix:**
  1. Keep a `VaultGrants` set in Rust state, persisted in app data like export grants. A path enters it only from `pick_folder`, `create_vault`'s parent picker, or an OS "open recent" entry the user chose.
  2. `open_vault`, `create_vault` (parent), and `open_vault_window` reject paths not in the set.
  3. Reject `/`, drive roots, the user's home folder itself, and system folders as vault roots.
  4. Change the frontend to call a single `pick_and_open_vault` command, so the path never round-trips through JavaScript.
- **Acceptance:**
  - Calling `open_vault("/etc")` or `open_vault(home)` from devtools fails.
  - Re-opening the last vault on launch still works (it is in the persisted set).

### SEC-03 (Medium): Asset protocol scope is `**`

- **Where:** `tauri.conf.json` -> `app.security.assetProtocol.scope = ["**"]`; `src/utils/vaultImages.ts` (`safeConvertFileSrc`).
- **Problem:** Only a JavaScript function restricts `asset://` URLs to the vault. The protocol itself can serve any file the app can read. Combined with SEC-01, a script injection can read arbitrary images and media. A symlink in the vault pointing outside it is also served.
- **Fix:**
  1. Set the static scope to `[]`.
  2. When a vault opens, call the runtime scope API (`asset_protocol_scope().allow_directory(vault, true)`) from Rust. Revoke it when the window closes or the vault changes.
  3. Do not follow symlinks that leave the vault (`require_literal_leading_dot` and canonical checks, as in `build_file_tree`).
- **Acceptance:** `convertFileSrc("/etc/hosts")` returns a 403-style failure. Vault images still render.

### SEC-04 (Medium): Supernote sync URL check allows redirection to any host

- **Where:** `src-tauri/src/supernote.rs` (`url_on_device`, `join_url`, `links_from_json`, `links_from_hrefs`).
- **Problem:** `url_on_device` is `url.starts_with("http://10.0.0.8:8089")`. The URL `http://10.0.0.8:8089@evil.example/x.note` passes, because `10.0.0.8:8089` becomes the userinfo and the real host is `evil.example`. The sync is plain HTTP, so a rogue device or a LAN man-in-the-middle can make the app fetch from any host, bypassing the private-IP rule. The response is saved into the vault.
- **Fix:**
  1. Parse with `url::Url`. Require `scheme == "http"`, `host == Host::Ipv4(expected)`, `port_or_known_default() == Some(port)`, and empty username and password.
  2. Apply the check to every URL before every request (listings and files), and to the final URL after any redirect (redirects are already disabled; keep that).
  3. Add `url` as a direct dependency (it is already in `Cargo.lock`).
- **Acceptance (unit tests):** each of these is rejected: `http://10.0.0.8:8089@evil.example/x`, `http://10.0.0.8:80891/x` (prefix match on a longer port), `http://10.0.0.8.evil.example:8089/x`, `https://10.0.0.8:8089/x`. Normal listings still sync.

### SEC-05 (Low-Medium): A hostile vault can switch off plugin Restricted Mode

- **Where:** `src-tauri/src/plugins.rs` (`CommunityPluginsFile::Ids`, `read_community`).
- **Problem:** If `.metis/community-plugins.json` is a plain array (legacy format), `read_community` returns `restricted = false`. A vault from a downloaded zip or cloned repo can ship that file and a CSS plugin, which then loads with no consent.
- **Fix:** For the array format return `restricted = true` and keep the ids as "previously enabled, needs re-approval". Also treat any vault-resident plugin state as untrusted: store the restricted-mode decision in app data keyed by canonical vault path, not in the vault.
- **Acceptance:** A vault containing `["x"]` opens in Restricted Mode. Toggling in settings persists across restarts.

### SEC-06 (Low-Medium): CSS and raw `<img>` can make outbound requests (**Verify first**)

- **Where:** `plugins.rs` `assert_safe_css`; `markdownHtml.ts` (`ALLOWED_URI_REGEXP`, `style` attribute for sticky notes); CSP `img-src ... https:`, `style-src 'unsafe-inline'`.
- **Problem:**
  1. Plugin CSS blocks `@import` but not `url(https://...)`, so CSS can send beacon requests.
  2. `resolveMarkdownImageSrc` blocks remote images for Markdown `![]()` syntax, but raw `<img src="https://...">` in a note or AI reply appears to pass DOMPurify and the CSP. That allows tracking pixels and data exfiltration through the URL (for example, from prompt-injected AI output).
- **Fix:**
  1. Reproduce with a note containing `<img src="https://example.org/p?x=1">` and watch network activity.
  2. Narrow CSP to `img-src 'self' asset: data: blob:` (no `https:`).
  3. In `assert_safe_css`, reject `url(` except `url(data:image/...)` and same-origin paths.
  4. Add a DOMPurify hook that removes `src`/`srcset`/`poster` values with a scheme other than the app's own.
  5. Remove `style` from the sticky-note allow list, or sanitise it with a property allowlist.
- **Acceptance:** None of the above produces a network request. Existing local images still render.

### SEC-07 (Low-Medium): Backup git runs inside untrusted vaults

- **Where:** `src-tauri/src/backup_sync.rs` (`git_raw`, `ensure_git_repo`, `files_section_names`).
- **Problem:**
  1. If the vault already has a `.git` directory, Metis runs `git` in it without checking its config. A hostile `.git/config` (`core.fsmonitor`, `core.sshCommand`, hooks) can run code when the user turns on GitHub backup.
  2. The "Files" section stages every top-level non-dot item, such as `credentials.json`, to a remote that may be public. The default `.gitignore` only covers `.env`.
- **Fix:**
  1. Run git with `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c protocol.ext.allow=never -c core.sshCommand=ssh` and `GIT_CONFIG_NOSYSTEM=1`. Refuse to proceed if `.git/config` contains `fsmonitor`, `sshCommand`, `hooksPath`, `askpass`, or `credential.helper`.
  2. Show an explicit file list (counts and top-level names) in the confirm dialog, and exclude common secret names by default (`*.pem`, `*.key`, `id_*`, `credentials*`, `*.p12`, `.env*`).
  3. Warn when the remote repository is public (optional, via the GitHub API).
- **Acceptance:** A repo with `core.fsmonitor=touch /tmp/pwned` does not create `/tmp/pwned` during sync.

### SEC-08 (Low): Unbounded zlib inflate in `.note` rendering

- **Where:** `src-tauri/src/supernote_render.rs` `decode_flate` (`read_to_end` with no cap).
- **Problem:** A small hostile `.note` file (synced from a device or placed in the vault) can inflate to gigabytes. `panic = "abort"` in release makes an allocation failure kill the whole app.
- **Fix:** Wrap the decoder with `.take(needed as u64 + 1)` where `needed = width * height * 2`. Error if more is produced. Check `width * height` against `MAX_DIM` before allocating. Review `image::load_from_memory` limits (set explicit `Limits`).
- **Acceptance:** A test zlib bomb of a few KB returns an error and memory stays bounded.

### SEC-09 (Low): `copy_files_to_folder` writes to any destination

- **Where:** `src-tauri/src/shell.rs` `copy_files_to_folder`.
- **Problem:** The destination directory is any path from the webview. It is created if missing. Sources are vault-bound, but the names and contents are vault-controlled, so a script injection can place files anywhere (for example into `~/.ssh` or a LaunchAgents folder).
- **Fix:** Require the destination to be under an export-directory grant (`pick_export_directory`) or the result of a fresh native folder dialog inside the same command. Do not call `create_dir_all` on arbitrary input. Apply the file-name and extension rules from LOG-01.
- **Acceptance:** Calling the command with `/tmp/x` and no grant fails.

### SEC-10 (Low): API keys stored as plaintext JSON

- **Where:** `settings.rs`, `usePersonaStore.ts` (`settings.json` under app data).
- **Fix:** Store keys in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service). Keep only a reference in `settings.json`. Migrate existing keys on first run and then delete the plaintext copy. Plaintext at 0600 is the documented current behaviour, so this is hardening.

### INFO-01: `save_note` checks the `.md` extension before resolving symlinks

A symlink named `x.md` inside the vault pointing at a non-`.md` vault file (for example `.metis/vault.json`) would be writable. Fix: check the extension of the resolved path as well, and write with `O_NOFOLLOW` where available.

### INFO-02: `reveal_in_finder` AppleScript quoting

`"`, `\n` and `\r` are rejected, but a trailing backslash is not. It most likely only causes an AppleScript error. Fix: pass the path as an `osascript` argument (`on run argv`) instead of building script text.

### INFO-03: Internal hostname in a public repository

`llm-gateway.prod.plat.unauth.wayfair.io` is hardcoded in `tauri.conf.json`, `capabilities/default.json`, and `providerUrlSafety.ts`. The git remote is `github.com/KyhleOhlinger/Metis`. Confirm the repo's visibility and whether the name may be public. If not, move it to user-added gateway config (see SEC-01) and consider the hostname exposed in git history.

### INFO-04: Dependency review pending

Locked versions looked current (tauri 2.10.3, tauri-plugin-http 2.5.7, reqwest 0.12.28, dompurify 3.4.17, marked 17.0.6, vite 6.4.5). `Cargo.lock` carries two reqwest versions. No advisory check was possible. Run `npm audit`, `cargo audit`, and `cargo deny` and record results.

---

## 2. Logic review findings

### LOG-01 (Medium): Export directory grants have no file-name or type restrictions

- **Where:** `shell.rs` (`pick_export_directory`, `authorize_export`, `write_export_bytes`).
- **Problem:** A persistent folder grant allows writing any file name and extension anywhere strictly inside that folder. Only `/` is rejected as a grant. If the user chooses their home folder as the Jekyll root, a script injection can overwrite `~/.zshrc` or `~/Library/LaunchAgents/*.plist`. One-shot save grants also never expire and are not bound to the content or type.
- **Fix:**
  1. Reject grants for the home folder, its ancestors, and known sensitive locations (`~/Library`, `~/.ssh`, `/etc`, `/usr`, `C:\Windows`).
  2. For folder grants allow only extensions in an allowlist (`md`, `markdown`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `yml`, `yaml`, `pdf`, `html`). Reject any path segment that starts with `.` and reject files with no extension.
  3. Clear the pending one-shot grant on any new `pick_save_path` call (including a cancel) and expire it after 5 minutes.
  4. Require the written extension to match the extension the dialog was opened with.
- **Acceptance:** Tests for `~/.zshrc`, `~/Library/LaunchAgents/x.plist`, `.git/config` under a granted folder all fail. Normal PDF and Jekyll exports work.

### LOG-02 (Medium): "Create note" silently overwrites existing notes and rewrites extensions

- **Where:** `vault_fs/commands/write.rs` `agent_write_note`; `PendingWriteCard.tsx`; `useAgentRun.ts`; `useSystemPersonaRuns.ts`.
- **Problem:** `agent_write_note` never checks whether the target exists, and `set_extension("md")` turns `notes/plan.txt` into `notes/plan.md`. A model-proposed `create_new_note` (the card says "create") can replace an existing note. It can also write into hidden folders (`.metis`, `.obsidian`, `.git`). The `..` check is a substring match, which blocks legitimate names such as `a..b.md`.
- **Fix:**
  1. Add a required `mode` argument: `create` (fail if exists) or `overwrite` (explicit).
  2. `create_new_note` always uses `create`. On conflict show the existing note and let the user choose "Overwrite" or "Save as <name> 2.md". Never overwrite silently.
  3. Reject a non-`.md` extension instead of rewriting it.
  4. Reject any path component starting with `.`.
  5. Replace the substring `..` check with a component-based check (`normalize_path` already errors on escapes).
- **Acceptance:** Creating a note whose name exists returns a conflict and leaves the file untouched. `.metis/x.md` and `a/b.txt` are rejected.

### LOG-03 (Medium): Pending-write Apply may use stale or wrong content (**Verify first**)

- **Where:** `PendingWriteCard.tsx` `handleApply`; `useAgentRun.ts`; `contentMerge.ts`.
- **Problem:** The write stores `path` (the file active when the run started) and the model's content. For append, prepend and insert, Apply computes the final text from `activeFileContent` as it is at click time. If the user switched notes or kept editing between the run and Apply, the merge uses a different document's text and then writes it to the original path. This is silent data loss. `cursorOffset` is frozen at run time, so the insertion point can also drift. The card shows only the file name, not a diff.
- **Fix:**
  1. At run time store `{path, baseHash}` (hash of the file content the model saw).
  2. At Apply, read the current content for `write.path` (editor buffer if open, otherwise disk), compare the hash, and block with "Note changed since this suggestion" if it differs. Offer "Re-run" or "Apply anyway" with a diff.
  3. Show a diff or the exact inserted block before Apply, plus the full path.
  4. Disable Apply when `write.path !== activeFilePath` for current-file tools.
- **Acceptance:** Run the agent on note A, switch to note B, click Apply: note B is not modified and note A is not overwritten with B's text.

### LOG-04 (Medium): Autosave can resurrect deleted notes and overwrite external changes (**Verify first**)

- **Where:** `src/hooks/noteAutosave.ts`, `save_note` in `write.rs`, `watcher.rs`.
- **Problem:**
  1. Saves are keyed by path and the debounce timer is not cancelled on rename, move or delete. A pending save then calls `save_note`, which creates the file at the old path if the parent still exists, leaving a ghost note.
  2. There is no external-change detection. An agent write, a second Metis window on the same vault, a git pull, or any other editor is overwritten by the next autosave of a stale buffer (last write wins). The watcher intentionally ignores content changes.
  3. Switching vaults leaves queued saves that fail the boundary check and show only a toast (data in the buffer is lost on quit).
- **Fix:**
  1. Call `cancelNoteAutosave(path)` in the rename, move and delete handlers (and re-key the buffer on rename).
  2. Add `expected_mtime_ms` (or a content hash) to `save_note`. Rust compares it with the file and returns `Conflict` if it changed. The UI then offers reload, keep mine, or diff.
  3. Add a `must_exist` flag so autosave never creates files. Creation stays in `create_note`.
  4. Flush and clear autosave state before a vault switch and on window close.
- **Acceptance:** Delete a note with an edit pending: the file stays deleted. Edit a note outside Metis, then type in Metis: a conflict prompt appears.

### LOG-05 (Low-Medium): Writes are not atomic, and bulk replace has no safety net

- **Where:** `fs::write` in `save_note`, `agent_write_note`, `search.rs` `replace_in_vault`, `conversion.rs`, `plugins.rs`, vault meta writes.
- **Problem:** `fs::write` truncates then writes. A crash or power loss mid-write can leave an empty note. `replace_in_vault` rewrites every matching note with no dry run and no rollback. On a mid-way error it returns `Err` after some files were already changed, and the summary of what changed is lost.
- **Fix:**
  1. Add `write_atomic(path, bytes)` (write to a temp file in the same directory, `fsync`, rename) and use it for all vault and config writes. `supernote.rs` already does this for downloads.
  2. `replace_in_vault`: add a preview command that returns per-file match counts. Require confirmation in the UI. Snapshot originals to `.metis/trash/<timestamp>/` for one-click undo. On error return the partial summary.
- **Acceptance:** Kill the process during a large save: the previous version or the new one is intact, never empty.

### LOG-06 (Low): Symlinks are followed for delete, rename and move

- **Where:** `tree_ops.rs` (`delete_path`, `move_path`, `rename_path`).
- **Problem:** The commands resolve the target with `safe_resolve` and then act on the resolved path. If `vault/link -> vault/notes`, deleting `link` removes the `notes` directory recursively. The move and rename calls operate on the link target too.
- **Fix:** Use `symlink_metadata`. For a symlink, delete or rename the link itself, never its target. Resolve only the parent directory for boundary checks.
- **Acceptance:** Deleting a symlink leaves the target intact.

### LOG-07 (Low): Bare file names are opened as web domains

- **Where:** `src/utils/vaultNavigation.ts` `resolveExternalHref`.
- **Problem:** Any link text matching `name.ext` becomes `https://name.ext`. Links like `[x](report.zip)`, `notes.mov`, `build.sh` or `run.py` open `https://report.zip` and similar in the browser. `.zip`, `.mov`, `.sh` and `.py` are real, registrable top-level domains, so a note can lead the user to an attacker-owned site.
- **Fix:** Treat bare names as vault paths unless they start with `www.` or have an explicit scheme. Deny a list of file-extension TLDs. Show the target domain in a confirmation (or tooltip) before opening external links from rendered notes.
- **Acceptance:** `report.zip` is treated as a vault file link. `https://example.org` and `www.example.org` still open externally.

### LOG-08 (Low): Supernote path mapping and write targets

- **Where:** `supernote.rs` (`relative_under_note`, `pull_browse_access`, `should_pull`).
- **Problem:**
  1. `strip_prefix("Note")` has no separator check, so `/Notebooks/a.note` maps to `books/a.note`.
  2. `dest.starts_with(&dest_root)` is a lexical check. A pre-existing symlink under `handwritten/Supernote/` is followed by `create_dir_all` and `fs::write`.
  3. `should_pull` compares date strings lexically, which is fragile for the device's date formats.
  4. Sync metadata lives in the vault (`.metis/supernote-sync.json`) and is trusted as is.
- **Fix:** Strip only an exact `Note` path component. Canonicalise the destination's parent and reject symlinks before writing. Parse dates to timestamps. Validate meta entries on load.

### LOG-09 (Low): Backup push semantics

- **Where:** `backup_sync.rs`.
- **Problem:**
  1. Staging is limited to selected paths, but `git push` sends the whole branch history. If the vault repository has older commits with other content, they are pushed.
  2. `ensure_origin` overwrites any existing `origin` without telling the user.
  3. `remote_has_commits_we_lack` compares only against `origin/HEAD`, `origin/main`, `origin/master`, not the branch being pushed.
  4. `BackupSyncReport.deletions` is always empty, so the frontend deletion confirmation never fires.
  5. Scheduled runs use `quiet` and suppress errors, so a broken backup fails silently.
- **Fix:** Compare against `origin/<current branch>`. Show an existing `origin` URL and ask before replacing it. Either implement deletion reporting or remove the dead UI. Surface failure state (a status indicator and "last successful backup" time) for scheduled runs. Document that history is pushed.

### LOG-10 (Low): Egress consent is scope-based only (**Verify first**)

- **Where:** `contextBuilder.ts` (`requiresConfirm`), `egressConfirm.ts`, OCR and vision paths.
- **Problem:** `requiresConfirm` is true only for full-vault, specific-folder and planner scopes. The confirm text shows counts and a provider label, not file names. Other paths (single note, selection, handwriting OCR images, the scout call that sends 400-character previews of many notes) depend on implicit consent. Changing the provider or `baseUrl` after consent does not re-prompt.
- **Fix:** Show the list (or top N) of files and any images, plus the destination host. Re-confirm when provider, model host or scope changes. Add a per-vault "never send folders X" exclusion list honoured by `get_file_summaries` and `get_files_content`.

### LOG-11 (Low): Indirect prompt injection reaches write tools

- **Where:** `llmService.ts` (`agentFileTools`), `ai_context.rs` (`get_files_content` formats `---\n## <name>`), `contextBuilder.ts`.
- **Problem:** Untrusted note text and file names are concatenated into the prompt in the same run that exposes `write_to_current_file` and `create_new_note`. A note can instruct the model to propose destructive writes. The Apply gate helps, but the card shows only the file name (see LOG-03).
- **Fix:** Wrap retrieved context in clearly labelled untrusted blocks. Disable write tools by default for multi-note scopes, with an opt-in per run. Escape file names in the context header. Show the diff before Apply. Log tool proposals in the run log.

### LOG-12 (Low): Window and vault lifecycle

- **Where:** `state.rs`, `vault_open.rs`, `watcher.rs`, `lib.rs`.
- **Problem:** `CurrentVault` and `WatcherState` entries are never removed when a window closes. `open_vault` can swap the registered vault at any time without invalidating pending exports, queued saves or watchers tied to the old vault.
- **Fix:** Handle `WindowEvent::Destroyed` to remove the label from all maps and drop the watcher. On vault switch, flush saves, clear one-shot grants for that window, and replace the watcher.

### LOG-13 (Low): Agent run log retention and privacy

- **Where:** `agent_run_log.rs`, `agentRunLogService.ts`.
- **Problem:** Transcripts include retrieved note text and replies. Each can be 8 MB and up to 1000 entries are kept (theoretically about 8 GB) in app data, unencrypted, outside the vault and outside any per-vault exclusion. `scrubSecretsFromMessage` is applied to messages only, not to retrieved context.
- **Fix:** Cap total bytes and age. Make transcript storage opt-in per persona. Run the scrubber over stored context. Add "clear on exit" and per-vault deletion.

### LOG-14 (Low): Plugin install runs the destructive step before validation

- **Where:** `plugins.rs` (`install_plugin_from_folder`, `install_community_plugin_files`).
- **Problem:** The code deletes the existing plugin directory and writes the manifest first, then validates `styles.css`. If validation fails, the previous working plugin is gone and a manifest-only stub remains. `set_community_plugin_enabled` also does not check that the plugin is installed. `install_plugin_from_folder` reads from any source path the webview names.
- **Fix:** Validate everything first, write into a temp directory under `.metis/plugins/.tmp-<id>`, then rename over the old one. Check install state when enabling. Take the source folder from a native picker grant.

### LOG-15 (Low-Medium): Planner adoption copies personal data into untrusted vaults

- **Where:** `planner/storage.rs` `prepare_vault_planner`.
- **Problem:** The decision to adopt the user's legacy shared planner is based on `planner_mode` read from the vault's own `.metis/vault.json`. A foreign vault (or one with that file crafted) with `planner_mode != "vault"` receives a copy of the user's personal calendar, goals and tracker JSON inside its `.metis/planner`. If that vault is then shared or backed up to GitHub, the data leaks with it.
- **Fix:** Ask the user before adopting legacy planner data into any vault they did not create. Track "legacy adopted into vault X" in app data. Exclude `.metis/planner` from backup unless the user opts in (it is currently on by default).

### LOG-16 (Low): Recursive directory walks can blow up on symlink loops (**Verify first**)

- **Where:** `vault_fs/meta.rs` (`build_file_tree_inner`, `collect_md_paths`), `ai_context.rs` (`collect_md_summaries`).
- **Problem:** Each walk checks that the canonical path is inside the vault, then recurses on the non-canonical path. A symlink to an ancestor inside the vault passes the check. Recursion continues until the OS rejects the path (about 40 symlink hops). With a few such links the number of visited paths grows exponentially, which can hang or exhaust memory at vault open. `panic = "abort"` turns that into a crash.
- **Fix:** Track visited canonical directories in a `HashSet`, skip repeats, and add a depth and entry cap (for example depth 32, 100k entries). Do not follow directory symlinks by default.

---

## 3. Tracker

| ID | Title | Severity | Phase | Status |
|---|---|---|---|---|
| SEC-01 | Wildcard network capability | Medium | 1 | Open |
| SEC-02 | Any directory openable as vault | Medium | 1 | Open |
| SEC-03 | Asset scope `**` | Medium | 1 | Open |
| SEC-04 | Supernote URL userinfo bypass | Medium | 0 | Open |
| SEC-05 | Hostile vault disables Restricted Mode | Low-Medium | 0 | Open |
| SEC-06 | CSS / raw `<img>` outbound requests | Low-Medium | 1 | Open (verify) |
| SEC-07 | Git in untrusted vault, over-broad staging | Low-Medium | 2 | Open |
| SEC-08 | Unbounded zlib inflate | Low | 0 | Open |
| SEC-09 | `copy_files_to_folder` any destination | Low | 1 | Open |
| SEC-10 | Plaintext API keys | Low | 3 | Open |
| LOG-01 | Export grants unrestricted | Medium | 1 | Open |
| LOG-02 | Agent create overwrites / rewrites ext | Medium | 0 | Open |
| LOG-03 | Pending write stale content | Medium | 2 | Open (verify) |
| LOG-04 | Autosave ghost files / lost external edits | Medium | 2 | Open (verify) |
| LOG-05 | Non-atomic writes, bulk replace | Low-Medium | 2 | Open |
| LOG-06 | Symlink semantics in delete/rename/move | Low | 2 | Open |
| LOG-07 | Bare file name opened as domain | Low | 0 | Open |
| LOG-08 | Supernote path mapping | Low | 2 | Open |
| LOG-09 | Backup push semantics | Low | 3 | Open |
| LOG-10 | Egress consent gaps | Low | 3 | Open (verify) |
| LOG-11 | Prompt injection reaches write tools | Low | 3 | Open |
| LOG-12 | Window / vault lifecycle | Low | 2 | Open |
| LOG-13 | Run log retention | Low | 3 | Open |
| LOG-14 | Plugin install order of operations | Low | 0 | Open |
| LOG-15 | Planner adoption into untrusted vault | Low-Medium | 2 | Open |
| LOG-16 | Symlink-loop recursion | Low | 2 | Open (verify) |
| INFO-01..04 | See section 1 | Info | 3 | Open |

## 4. Remediation plan

**Phase 0: quick, low-risk fixes (about 1 to 2 days).** SEC-04, SEC-05, SEC-08, LOG-02, LOG-07, LOG-14. Each is a small change with a clear unit test.

**Phase 1: trust boundaries (about 1 week).** SEC-01, SEC-02, SEC-03, SEC-06, SEC-09, LOG-01. These shrink what a script injection can do. Do SEC-01 and SEC-02 together: both change the frontend/Rust contract for network access and vault selection. Re-test every provider, the custom gateway flow, vault open/create/open-in-new-window, exports and the Jekyll flow.

**Phase 2: data integrity (about 1 week).** LOG-03, LOG-04, LOG-05, LOG-06, LOG-12, LOG-15, LOG-16, LOG-08, SEC-07. Introduce `write_atomic` and the `expected_mtime` save contract first, because LOG-03, LOG-04 and LOG-05 depend on them.

**Phase 3: hardening.** SEC-10, LOG-09, LOG-10, LOG-11, LOG-13, INFO items, and dependency/audit CI.

### Cross-cutting work

- Add a `security` test module in Rust covering: path escape (`..`, symlinks, absolute paths), export grants, Supernote URL parsing, plugin CSS, git remote validation.
- Add CI steps: `cargo audit`, `cargo deny`, `npm audit --omit=dev`, secret scan, `cargo clippy -D warnings`.
- Add a lint or test that fails if `capabilities/*.json` contains `https://*` or `scope: ["**"]` appears in `tauri.conf.json`.
- Revisit `panic = "abort"`. A single bad `.note` or path can otherwise take down the whole app. At least isolate the render and sync work behind `catch_unwind` or a worker.
- Consider a Tauri app manifest (`tauri_build::Attributes::app_manifest`) so custom commands are listed in capabilities. Today every window can call every command and the code relies on the `metis-help` label check.

## 5. Notes for the maintainer

- This file lives in `specs/`, which `.gitignore` excludes (`specs/`). It will not be committed. Move it to `docs/` or add `!specs/Security-Remediation-Spec.md` to `.gitignore` if you want it tracked.
- The findings marked **Verify first** are based on code that was only partly visible (UI wiring for Apply and autosave, CSP behaviour for raw `<img>`, symlink-loop behaviour). Reproduce each before coding the fix.
- Re-run the review after Phase 1, since moving to runtime-granted network and vault scopes changes the trust model.
