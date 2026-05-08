# Metis

<p align="center">
<img width="400" height="400" alt="metis_icon" src="https://github.com/user-attachments/assets/9020f41f-24c5-4789-9617-0831a02376f8" />
</p>

> A local-first, AI-augmented personal knowledge base built for writers, engineers, and thinkers.
> 
In Greek mythology, **Metis** was the Titaness of wisdom, deep thought, and counsel — the first wife of Zeus and mother of Athena. Her name literally means *"wisdom"* or *"skill and craft"*, and she was revered as the embodiment of prudent intelligence: not raw knowledge, but the ability to think clearly, connect ideas, and act with purpose. Zeus, fearing her wisdom would surpass his own power, swallowed Metis whole — yet her counsel guided him from within, and her daughter Athena was later born fully formed, armoured and wise.

This application takes her name for the same reason: a knowledge base should not merely store information, it should help you think. Metis pairs your own writing and ideas with AI personas that reason alongside you — surfacing connections, refining your thoughts, and acting on your behalf — all while keeping every word on your own machine. Like the goddess, the intelligence here is a guide embedded in the work, not a separate oracle you consult from afar.

Metis is a desktop markdown editor that stores your notes as plain `.md` files on your own filesystem — no cloud sync, no lock-in, no subscription. It pairs a powerful CodeMirror 6 editor with a clean three-pane layout, rich markdown rendering, a persona-driven AI writing assistant, and a growing set of smart writing tools.


---

## Supported AI Providers

All providers are accessed via a **Compatible API**. Configure any provider with your own key in **Settings → API Providers**, then use the **↓ Models** button in a persona form to fetch the latest available models directly from the provider.

| Provider | API Endpoint | Key Format | Highlights |
|----------|-------------|------------|------------|
| **OpenAI** | `api.openai.com/v1` | `sk-…` | GPT-4o, o1, o3, and more |
| **Google Gemini** | `generativelanguage.googleapis.com/v1beta/openai` | `AIzaSy…` | Gemini 2.0 Flash, 1.5 Pro/Flash — up to 1 M token context |
| **Groq** | `api.groq.com/openai/v1` | `gsk_…` | Llama 3.x, Mixtral — ultra-fast inference |
| **Perplexity AI** | `api.perplexity.ai` | `pplx-…` | Sonar family with real-time web search |

API keys are stored locally in the OS app-data directory and are never sent anywhere other than the chosen provider.

---

## Features

### Vault-based organisation
- Each project is a **vault** — a normal folder on your filesystem
- Create vaults with pre-built `daily/`, `meetings/`, `summaries/`, and `assets/` sections
- **Convert foreign vaults** — open any folder as a vault; a conversion dialog offers to add the Metis vault marker, create default folders, and optionally back-fill YAML frontmatter with a live progress bar
- Auto-restores your last opened vault on launch
- **Multi-window support** — opening a different vault spawns a new Metis window without losing your current one
- Real-time sidebar sync when files change on disk (Rust FS watcher)

<img width="1381" height="661" alt="image-1778254924442" src="https://github.com/user-attachments/assets/98e6b2f4-cf52-4431-b9c0-6a411fe892a4" />


### Rich markdown editor
- **Source mode** — raw markdown with GFM syntax highlighting, inline image rendering, and `Cmd+Click` link following
- **Visual mode** — full HTML preview with tables, task lists, callouts, and image rendering
- **Formatting toolbar** — H1–H3, Bold, Italic, Code, Link, Image, Code Block, Blockquote, Lists, HR, Callout dropdown, Spellcheck toggle — **responsive**: automatically switches to compact mode (smaller icons, tighter spacing) on narrow editor panes so all items remain visible
- **Spellcheck** — lint-based spellcheck powered by Hunspell dictionaries (via the `spellbook` Rust library); misspelled words are shown with wavy underlines; hover a word to see suggestions, click to replace (case-preserving); toggle on/off from the toolbar; choose between English (US) and English (UK) in Settings → Spellcheck
- **Background themes** — Dark, Black, Slate, Purple, Pink, White, Cream; hot-swapped without reloading the editor
- Theme picker remains interactive in Planner mode and resets popovers cleanly across tab/file transitions
- YAML frontmatter editing panel below the editor
- Auto-save 1 second after your last keystroke

<img width="1392" height="854" alt="image-1778255034159" src="https://github.com/user-attachments/assets/66e3345d-ae5e-400b-841c-01a4e3fd6b78" />

### Writing ergonomics
- Slash menu (`/` at line start) for quick block insertion
- Auto-continue lists on Enter (bullet, task, and numbered)
- Smart paste: drop a URL over selected text → Markdown link; paste a screenshot → saves to `assets/` and inserts `![](assets/...)`
- Auto-close pairs: `` ``` ``, `**`, `_`, `` ` ``, `[]()`
- Fenced code blocks with syntax highlighting, language badges, and a hover Copy button
- Obsidian-style callouts (`> [!INFO]`, `> [!WARNING]`, `> [!TIP]`, …)

### Metadata & note properties
- **Status field** — `draft`, `in-progress`, `review`, `done`, `archived` — shown as coloured file icons in the sidebar
- **Date picker** — ISO date stored in frontmatter
- **Parent** — auto-derived from the containing folder (read-only, no manual entry needed)
- **Aliases** — comma-separated alternative names; searched by `[[` wikilink autocomplete
- **Tags** — editable tag chips
- **Links** — read-only list of all `[[wikilinks]]` found in the note body

<img width="835" height="406" alt="image-1778255125354" src="https://github.com/user-attachments/assets/873a679d-da63-4f93-9dcf-146b5bfb76cc" />

### Search & replace
- **In-editor** — `Cmd+F` opens find, `Cmd+R` opens find-and-replace; supports case-sensitive and regex toggles, Replace / Replace All
- **Vault-wide** — `Cmd+Shift+F` opens the sidebar search panel; searches all `.md` files with case-sensitivity and regex options
- Click any vault-wide result to jump to the file and line
- Vault-wide Replace All writes changes to disk — use version control as a safety net

### Navigation
- `Cmd+P` Quick Switcher — fuzzy-search all notes by name or alias, filterable by status
- `Cmd+Shift+F` Search vault — search (and replace) across all notes
- `[[wikilink]]` autocomplete — scans your entire vault instantly, matching names and aliases
- Wikilinks in Visual mode are clickable
- External links open in your default browser

### File management
- Drag-and-drop to move files and folders (optimistic UI — no lag)
- Drag a file or folder directly onto a persona chip to scope an instant AI run
- Inline create, rename, and delete from the sidebar
- Right-click context menu with Reveal in Finder and Copy Path
- Calendar button creates or opens today's daily note
- `todo.md` always sorts to the top of the folder it lives in (`summaries/` by default)

<img width="235" height="356" alt="image-1778255094639" src="https://github.com/user-attachments/assets/cf6f9191-9a71-45fa-81aa-a677ff4302cc" />

### Planner workspace
- Accessed from the dedicated **Planner** button at the bottom of the left sidebar (works even when no file is selected)
- Tabs: **Daily Log**, **Weekly Review**, **Monthly Review**, **Templates**, **PTO & Events**
- Context-aware navigation labels:
  - Daily Log: Previous Week / Today / Next Week
  - Weekly Review: Previous Month / This Month / Next Month
  - Monthly Review: Previous Year / This Year / Next Year
- Templates and PTO & Events intentionally hide date navigation controls
- Monthly reviews render as a consolidated single-page year view (all 12 months)
- Public holiday import supports country + province/state selection, with strict date deduplication and merge-to-notes behavior
- Daily/Weekly/Monthly review block templates are editable in the Templates tab and apply from the current date/time window onward (past entries stay as-is)

<img width="1365" height="817" alt="image-1778255067455" src="https://github.com/user-attachments/assets/a0115e3a-138e-44ee-87eb-044e95003168" />

### AI writing assistant (Command Center — AI tab)
- **System Default personas** (built-in, protected):
  - **The Librarian** — scans your vault for orphaned notes (no incoming/outgoing links) and suggests connections
  - **Task Manager** — supports Vault Task Scan (aggregate incomplete checkbox tasks into `summaries/todo.md`) and Vault Task Sync (bi-directional checkbox sync between `summaries/todo.md` and source notes)
- **Custom personas** — create personas with custom system prompts, models, and providers
- **Persona chip groups** — System and Custom chips are visually separated
- **Scoped context** — run against the current file, a specific file, a folder, or your full vault
- **Streaming responses** — output appears word-by-word in real-time; a spinning "thinking" indicator displays while the model processes your request
- **Agent file tools** — the AI can write, append, prepend, insert at cursor, or create new notes — with a review step before applying changes
- **Floating selection toolbar** — highlight any text to instantly improve, summarise, expand, or extract action items
- **Supports OpenAI, Google Gemini, Groq, and Perplexity AI** — configure any provider with your own API key; fetch the latest available models on demand
- **Enable / disable personas** — hide personas from the chip bar without deleting them

<img width="314" height="517" alt="image-1778255163396" src="https://github.com/user-attachments/assets/2f9dda42-e3e6-4bf8-8482-55fda8a5b35c" />


---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind CSS 3 |
| Editor | CodeMirror 6 |
| State | Zustand 5 |
| Desktop | Tauri v2 (Rust) |
| Preview | marked + DOMPurify |
| Search | Fuse.js |
| Spellcheck | spellbook (Hunspell-compatible, Rust) |
| AI | openai SDK (OpenAI-compatible) |

---

## Getting Started

### Prerequisites

- [Rust toolchain](https://rustup.rs) (stable, 1.77+)
- [Node.js](https://nodejs.org) 20+
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (on macOS this means Xcode Command Line Tools; on Linux, `webkit2gtk` and related packages)

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run dev
```

This starts the Vite dev server and the Tauri shell together. The application window will open automatically.

> **macOS note:** Run this from a native terminal session (Terminal.app or iTerm2), not inside an IDE sandbox, to ensure the GUI window spawns correctly.

---

## Building a Standalone Application

To produce a self-contained application that can be launched like any other desktop app (double-click, Dock, Spotlight, etc.) without needing to run any commands:

```bash
npm run build
```

This compiles the Rust backend in release mode, bundles the Vite frontend, and packages everything into a native installer for your platform.

### Output locations

| Platform | Bundle type | Location |
|----------|-------------|----------|
| macOS | `.app` (drag-to-Applications) | `src-tauri/target/release/bundle/macos/Metis.app` |
| macOS | `.dmg` installer | `src-tauri/target/release/bundle/dmg/Metis_*.dmg` |
| Windows | `.msi` installer | `src-tauri/target/release/bundle/msi/Metis_*.msi` |
| Windows | `.exe` NSIS installer | `src-tauri/target/release/bundle/nsis/Metis_*.exe` |
| Linux | `.deb` package | `src-tauri/target/release/bundle/deb/metis_*.deb` |
| Linux | `.AppImage` | `src-tauri/target/release/bundle/appimage/metis_*.AppImage` |
| Linux | `.rpm` package | `src-tauri/target/release/bundle/rpm/metis-*.rpm` |

### Installing on macOS

1. Run `npm run build`.
2. Open `src-tauri/target/release/bundle/dmg/` and double-click the `.dmg` file.
3. Drag **Metis.app** into your `/Applications` folder.
4. Launch from Spotlight (`Cmd+Space` → "Metis"), the Dock, or Finder.

> **Gatekeeper note:** Because Metis is not code-signed with an Apple Developer certificate, macOS may show a "cannot be opened because the developer cannot be verified" warning on first launch. To bypass it, right-click (or Control-click) the app → **Open** → **Open** in the dialog. You only need to do this once.

### Installing on Windows

1. Run `npm run build`.
2. Run the `.msi` or `.exe` installer from `src-tauri/target/release/bundle/`.
3. Follow the installer wizard. Metis will appear in the Start menu and can be pinned to the taskbar.

### Installing on Linux

**Debian / Ubuntu:**
```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/metis_*.deb
```

**AppImage (any distro):**
```bash
chmod +x src-tauri/target/release/bundle/appimage/metis_*.AppImage
./src-tauri/target/release/bundle/appimage/metis_*.AppImage
```

### Build time

The first build takes 5–15 minutes because Cargo compiles all Rust dependencies from scratch. Subsequent builds are much faster thanks to Cargo's incremental compilation cache.

---

## Project Structure

```
Metis/
├── src/                        # React / TypeScript frontend
│   ├── components/             # UI components (incl. spellcheck.ts linter)
│   ├── hooks/                  # useMenuEvents (native menu bridge)
│   ├── store/                  # Zustand stores (vault + persona)
│   ├── services/               # AI gateway and smart context builder
│   ├── types/                  # Persona and settings type definitions
│   └── utils/                  # File tree helpers, asset path resolver
├── src-tauri/
│   ├── src/main.rs             # All Rust commands + FS watcher + menu
│   ├── resources/dictionaries/ # Bundled Hunspell .aff/.dic files (en_US, en_GB)
│   └── tauri.conf.json         # App config, CSP, asset protocol
└── wiki/                       # Project wiki (Git Wiki style)
```

---

## Configuring AI

1. Open **Command Center** (right panel) → **Settings** tab.
2. Choose your provider (OpenAI, Gemini, Groq, or Perplexity AI) and paste your API key.
3. Click **Test Connection** to verify.
4. Switch to the **AI** tab to select a persona and run your first prompt.
5. When creating or editing a persona, click **↓ Models** to fetch the latest available models from the provider and pick from a dropdown.

API keys are stored in your OS app-data directory (`~/Library/Application Support/com.metis.app/` on macOS) and are never sent anywhere other than your chosen AI provider. Only the specific note content needed for each task is ever transmitted — your full vault is never sent in a single call.

---

## Roadmap

- [ ] **Graph view** — Visual map of wikilink connections across the vault
- [ ] **Canvas** — Infinite freeform canvas (tldraw SDK) embedded in the editor
- [ ] **Planner analytics** — Reporting views for trend analysis across daily/weekly/monthly planning data
- [ ] **Export** — PDF and HTML export of single notes or the entire vault
- [ ] **Stronghold key storage** — Migrate API keys to `tauri-plugin-stronghold` for hardware-backed encryption
- [ ] **Plugin API** — Extension points for custom commands and editor widgets

---

## Security

Metis is designed to be safe by default. The security model operates on the principle that the frontend (webview) should not be trusted for any operation that writes, reads, or deletes files.

**Vault containment (fail-closed)**
- Every file-operation command (`save_note`, `get_file_content`, `create_note`, `create_folder`, `rename_path`, `move_path`, `delete_path`, `save_asset`, `agent_write_note`, and the smart-context commands) **requires** a vault to be registered in server-side Rust state — if no vault is registered for the calling window, the command is rejected outright (fail-closed)
- All target paths are validated against the vault root recorded in server-side Rust state — never against a path supplied by the frontend
- Each open window maintains completely isolated vault state (keyed by Tauri window label), so one window cannot read or write another window's vault
- `get_file_summaries` and `get_files_content` call `canonicalize()` on every path before the boundary check to detect symlink-based escapes

**Input validation**
- All user-supplied file/folder names pass through `sanitize_name()`, which blocks path separators, null bytes, relative-path components (`..`, `.`), Windows reserved device names, and names over 255 characters
- Agent-written paths are normalised via `normalize_path()` to resolve `..` segments before the vault-boundary check
- Wikilink asset paths are normalised on the frontend to collapse `..` segments before resolution, preventing vault-escape via crafted wikilink image references
- Only `.md` files can be written by the editor; `save_asset` accepts only a known image extension allowlist
- `save_personas` and `save_settings` validate that payloads are well-formed JSON before writing to disk
- User-supplied regex patterns in vault search/replace are length-limited (1 000 chars) and size-limited (1 MiB compiled NFA) to mitigate ReDoS

**Rendering safety**
- HTML preview is sanitised with DOMPurify before `dangerouslySetInnerHTML`
- Image `src` attributes in the preview are normalised and validated to remain within the vault before being passed to `convertFileSrc()` — preventing `../` traversal that could expose arbitrary files via Tauri's asset protocol
- The CSP enforces `script-src 'self'` (no inline scripts, no external scripts) and host-allowlisted `connect-src` entries (AI providers, enterprise gateway, holiday import API)

**API key security**
- Debug builds write credentials to a separate `dev/` subdirectory inside the OS app-data directory; release builds use a different path — so development API keys can never end up in a production build
- API keys are never logged, never included in vault files, and are transmitted only to the user's chosen provider

**External interaction**
- `open_url` validates the scheme is `https://` before opening a URL in the browser
- `reveal_in_finder` (macOS) rejects paths containing `"`, `\n`, or `\r` before embedding them in an AppleScript string literal

---

## Author

Metis is designed and built by **Kyhle Öhlinger**.

| | |
|-|-|
| 🌐 Website | [ohlinger.co](https://ohlinger.co) |
| 🐙 GitHub | [github.com/kyhleOhlinger](https://github.com/kyhleOhlinger) |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Open a pull request

---

## License

Copyright (c) 2026 Kyhle Öhlinger.

Licensed under the MIT License — see [`LICENSE`](/LICENSE) for the full text.
