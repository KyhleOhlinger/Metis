# Metis Architecture (Alias)

This file is a lowercase alias maintained for tooling compatibility.

Canonical architecture documentation lives in `wiki/Metis-Architecture.md`.

## Latest Planner Notes

- Daily Log active cell: weighted **`grid-template-columns` / `grid-template-rows`** (`4fr` / `3fr` on the active week column and weekday row vs `1fr` neighbors) so the focused cell uses ~¼ of the grid area while others shrink; grid fills planner pane height while expanded.
- **Goals** planner tab: arbitrary editable sections (title + markdown body), defaults “Business related” / “Self-Improvement”, persisted in `localStorage` key `metis_planner_goals_v1`; shares the Planner markdown toolbar with weekly/monthly/templates.
- Security hardening: `convert_vault_to_metis` now requires a registered active vault for the calling window and rejects canonical path mismatch before mutating disk.
- Conversion progress events are now emitted to the calling window scope (not app-wide broadcast).
- Build/upload guidance now distinguishes compile-critical source/config/runtime assets from optional documentation (`wiki/`).
- Full code/architecture review completed (May 2026) with findings documented in `wiki/Architecture-Review-2026-05.md`.
- Wiki navigation expanded for GitHub wiki usage with runtime, data model, operations, troubleshooting, build/release, and contributing pages.
- Backend docs corrected to remove stale `walkdir` crate reference and clarify conversion-command trust-boundary review expectations.
- Planner can be opened from the sidebar even when no note is currently selected.
- Public Holidays support user-selected country + province/state import with non-overwriting date merge behavior.
- Editor background/theme picker remains usable in Planner mode and now closes cleanly on tab/file switches to avoid stale click-blocking overlays.
- Planner surfaces (cards/inputs/borders/text) now inherit the active editor color preset via planner theme bridge variables for consistent visual theming.
- Date navigation is context-aware by planner tab:
  - Daily Log: week navigation
  - Weekly Review: month navigation
  - Monthly Review: year navigation
- Monthly reviews render as a single-page year view (all months on one screen).
- Task items support optional inline due dates using `(due: YYYY-MM-DD)`.
- Daily/Weekly/Monthly planner block templates are user-editable and apply from current date onward.
- Editor background/theme picker is usable in Planner mode and no longer leaves stale overlays on mode/file switches.
- Planner cards/inputs/text now inherit active editor color presets (not only outer background).
# Metis — Architecture & Feature Reference

> Last updated: April 2026

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Directory Structure](#2-directory-structure)
3. [Frontend Architecture](#3-frontend-architecture)
   - [State Management](#31-state-management)
   - [Component Tree](#32-component-tree)
   - [Editor Subsystem](#33-editor-subsystem)
4. [AI Subsystem](#4-ai-subsystem)
   - [Persona Model](#41-persona-model)
   - [System Personas](#42-system-personas)
   - [Context Builder](#43-context-builder)
   - [AI Service Layer](#44-ai-service-layer)
   - [Agent File Tools](#45-agent-file-tools)
5. [Metadata & Note Index](#5-metadata--note-index)
6. [Backend Architecture (Rust / Tauri)](#6-backend-architecture-rust--tauri)
   - [Tauri Commands](#61-tauri-commands)
   - [File-System Watcher](#62-file-system-watcher)
   - [Security Model](#63-security-model)
7. [Data Flow](#7-data-flow)
8. [Feature Inventory](#8-feature-inventory)
9. [Extension Points](#9-extension-points)

---

## 1. High-Level Overview

Metis is a **local-first, AI-augmented personal knowledge base** built with Tauri v2. All notes live as plain `.md` files on the user's own filesystem — there is no cloud sync and no proprietary data format.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop Shell                           │
│                                                                      │
│  ┌──────────┐   ┌──────────────────────────────────┐  ┌──────────┐  │
│  │ Sidebar  │   │            Editor                │  │ Command  │  │
│  │          │   │  ┌────────────────────────────┐  │  │  Center  │  │
│  │  File    │   │  │   Formatting Toolbar        │  │  │          │  │
│  │  Tree    │   │  ├────────────────────────────┤  │  │  Info    │  │
│  │  (status │   │  │   CodeMirror 6             │  │  │  AI ✦    │  │
│  │  colours)│   │  │   (Source / Visual)          │  │  │  Settings│  │
│  │          │   │  └────────────────────────────┘  │  │          │  │
│  │ Sections │   │  ┌────────────────────────────┐  │  └──────────┘  │
│  │ daily    │   │  │   MetadataPanel (frontmatter│  │               │
│  │ meetings │   │  └────────────────────────────┘  │               │
│  │ summaries│   └──────────────────────────────────┘               │
│  │ assets   │                                                        │
│  └──────────┘                                                        │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Rust backend  (src-tauri/src/main.rs)           │   │
│  │  open_vault · save_note · create_note · move_path            │   │
│  │  agent_write_note · get_file_summaries · get_files_content   │   │
│  │  search_vault · replace_in_vault                             │   │
│  │  load/save personas/settings · reveal_in_finder · watcher    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │      Cloud AI  (OpenAI / Gemini / Groq / Perplexity)        │   │
│  │  Streaming via openai-compatible SDK · Only active note sent │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Technology stack**

| Layer | Technology |
|-------|-----------|
| UI framework | React 18 + TypeScript |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 3 |
| Editor | CodeMirror 6 |
| State | Zustand 5 |
| Desktop shell | Tauri v2 (Rust) |
| Preview | `marked` + DOMPurify |
| Fuzzy search | Fuse.js |
| Icons | lucide-react |
| AI SDK | openai (OpenAI-compatible) |

---

## 2. Directory Structure

```
Metis/
├── src/                              # React / TypeScript frontend
│   ├── main.tsx                      # React entry point
│   ├── App.tsx                       # Root layout + global effects
│   ├── index.css                     # Global styles + CM6 overrides
│   ├── vite-env.d.ts
│   │
│   ├── components/
│   │   ├── Editor.tsx                # CodeMirror host, header bar, theme picker
│   │   ├── editorExtensions.ts       # All CM6 extensions (~1 300 lines)
│   │   ├── Toolbar.tsx               # Markdown formatting toolbar + spellcheck toggle
│   │   ├── spellcheck.ts            # CM6 lint-based spellcheck (IPC to Rust OS dictionary)
│   │   ├── MarkdownPreview.tsx       # HTML visual preview tab
│   │   ├── MetadataPanel.tsx         # YAML frontmatter panel inside editor pane
│   │   ├── SelectionToolbar.tsx      # Floating AI toolbar on text selection
│   │   ├── Sidebar.tsx               # File tree + drag-and-drop + persona sidebar
│   │   ├── CommandCenter.tsx         # Right panel (Info / AI / Settings tabs)
│   │   ├── PersonaCreator.tsx        # Modal for creating / editing personas
│   │   ├── ModelPicker.tsx           # Combobox for AI model selection (curated + free-text)
│   │   ├── QuickActionsSettings.tsx  # Selection toolbar action customisation panel
│   │   ├── EditorFindBar.tsx          # Custom in-editor find & replace bar (React-based, replaces CM6 built-in panel)
│   │   ├── SearchPanel.tsx           # Vault-wide full-text search & replace panel
│   │   ├── CommandPalette.tsx        # Cmd+P fuzzy note switcher
│   │   ├── ContextMenu.tsx           # Right-click context menu
│   │   ├── ConvertVaultModal.tsx     # Foreign vault → Metis vault conversion dialog
│   │   └── CreateVaultModal.tsx      # New vault dialog
│   │
│   ├── hooks/
│   │   └── useMenuEvents.ts          # Native menu-bar event bridge
│   │
│   ├── store/
│   │   ├── useStore.ts               # Zustand store — vault, editor, UI state
│   │   └── usePersonaStore.ts        # Zustand store — personas, settings, history
│   │
│   ├── services/
│   │   ├── aiService.ts              # AI gateway (streaming, tool calls, connection test)
│   │   ├── contextBuilder.ts         # Tiered context assembly (direct / TF-IDF / scout)
│   │   └── geminiNative.ts           # Native Gemini REST API fallback (generateContent)
│   │
│   ├── types/
│   │   └── persona.ts                # Persona, Settings, HistoryEntry, ExecutionScope types
│   │
│   └── utils/
│       ├── treeUtils.ts              # In-memory file tree helpers
│       └── resolveWikilinkAsset.ts   # Vault-wide asset path resolution
│
├── src-tauri/
│   ├── src/
│   │   └── main.rs                   # All Tauri commands + FS watcher
│   ├── Cargo.toml
│   ├── tauri.conf.json               # App config, CSP, asset protocol
│   └── capabilities/
│       └── default.json              # Tauri v2 permission grants
│
├── wiki/                             # Developer wiki (GitHub Wiki style)
│   ├── Home.md
│   ├── Getting-Started.md
│   ├── Architecture-Overview.md
│   ├── Search-and-Replace.md
│   ├── AI-Subsystem.md
│   ├── Editor-Extensions.md
│   ├── Tauri-Backend.md
│   ├── Security-Model.md
│   └── .order
│
├── public/                           # Static assets (help.html, help.js)
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 3. Frontend Architecture

### 3.1 State Management

State is split across two Zustand stores.

#### `useStore` — vault and editor state

```typescript
interface MetisState {
  // Vault
  vaultPath: string | null;           // Absolute path to the open vault folder
  isMetisVault: boolean;              // True when .metis/vault.json marker is present
  files: FileNode[];                  // Full recursive file tree

  // Editor
  activeFilePath: string | null;      // Currently open note
  activeFileContent: string;          // Live content (includes unsaved changes)
  isDirty: boolean;                   // Unsaved-changes indicator
  cursorOffset: number;               // CM6 cursor position (for agent insert_at_cursor)
  selectedText: string;               // Currently highlighted text
  selectionCoords: { top; left } | null; // Viewport coords for SelectionToolbar
  selectionEndOffset: number;         // End of selection (for insert-after-selection)

  // UI
  activeFolderPath: string | null;    // Folder selected in the sidebar AI scope
  editorTab: "source" | "visual" | "planner"; // Lifted so native menu + sidebar planner can switch it
  pendingMenuAction: string | null;   // Native-menu actions routed to Sidebar
  sidebarView: "files" | "search";   // Toggle between file tree and vault-wide search panel

  // Caches (rebuilt on every tree change, no extra IPC)
  noteIndex: NoteMetadata[];          // Flat list of all .md notes with frontmatter metadata
  assetIndex: AssetMetadata[];        // Flat list of all non-md assets → ![[img]] resolution
}
```

**Key design decisions:**
- `noteIndex` stores per-note metadata (`status`, `aliases`, `date`, `parent`) extracted from YAML frontmatter. It is rebuilt from the file tree on every `setVault` / `refreshVault`, then enriched in the background by `enrichNoteIndex` which batch-reads all note content.
- `setActiveFile` and `setActiveFileContent` both re-parse frontmatter and update the calling note's `noteIndex` entry immediately, so status colours, alias autocomplete, and `CommandPalette` filters are always in sync with the current editor state.
- CodeMirror extensions read both indexes via `useStore.getState()` (escape hatch) to avoid triggering React re-renders inside editor plugins.
- `cursorOffset` and `selectionEndOffset` are written on every editor cursor move so the AI agent always knows where to insert content without requiring an extra IPC round-trip.

#### `usePersonaStore` — personas, settings, AI history

```typescript
interface PersonaState {
  personas: Persona[];                // All AI personas (system defaults + user-created)
  activePersonaId: string | null;
  settings: Settings;                 // Per-provider API keys + default provider
  history: HistoryEntry[];            // Last 50 AI conversation turns (in-memory)
  loading: boolean;                   // True while loading from disk on first mount

  // Cross-component signals
  pendingScope: ExecutionScope | null;    // Set by Sidebar context menu → consumed by CommandCenter
  selectionQuery: SelectionQuery | null;  // Set by SelectionToolbar → consumed by AITab
}
```

Personas and settings are persisted to `personas.json` / `settings.json` in the OS app-data directory via Tauri (`load_personas`, `save_personas`, `load_settings`, `save_settings`). They are intentionally stored _outside_ the vault so they are shared across all vaults.

On first load, `loadFromDisk` merges any persisted personas with `DEFAULT_PERSONAS`, ensuring newly introduced system personas are added without overwriting user-created ones.

---

### 3.2 Component Tree

```
AppErrorBoundary
└── App
    ├── CommandPalette           (modal overlay, Cmd+P — fuzzy search with status filter chips)
    ├── Sidebar (pane 1, collapsible to 32 px strip)
    │   ├── [header: vault name, new-note, new-folder, search, calendar, expand/collapse]
    │   ├── SearchPanel          (vault-wide find & replace, toggled via search icon or Cmd+Shift+F)
    │   ├── InlineInput          (rename / create)
    │   ├── FileTreeNode         (recursive, drag-and-drop, status-coloured icons)
    │   │   └── ContextMenu      (right-click, includes "Run with Persona")
    │   ├── CreateVaultModal
    │   └── ConvertVaultModal    (foreign vault → Metis vault conversion, live progress bar)
    │
    ├── Editor (pane 2)
    │   ├── [header bar: filename, bg colour picker, source/visual toggle]
    │   ├── Toolbar              (source mode only — H1-H3, Bold, Italic, Code…)
    │   ├── SelectionToolbar     (floating, appears on text selection — AI quick actions)
    │   ├── [CodeMirror host div]
    │   ├── MarkdownPreview      (visual mode only, overlaid on hidden CM6 instance)
    │   └── MetadataPanel        (YAML frontmatter editor: status, date, parent, aliases)
    │
    └── CommandCenter (pane 3, collapsible to 32 px strip)
        ├── [Info tab]           (vault/note stats, save status)
        ├── [AI tab]             (System / Custom persona chips, scope picker, chat, streaming output)
        │   ├── Librarian panel  (orphan-note scan, read-only input)
        │   └── Task Manager panel (todo.md aggregation, read-only input)
        └── [Settings tab]       (provider API keys, connection test, System Default / Custom persona groups)
            ├── QuickActionsSettings  (drag-to-reorder, edit, create selection toolbar actions)
            └── ModelPicker           (curated model combobox, used in PersonaCreator + Settings)
```

**Layout:** Three-pane flex row in `App.tsx`. Sidebar and Command Center panels animate between `w-60` (expanded) and `w-8` (collapsed) using `transition-[width]` with `overflow-hidden`.

**Error Boundary:** `AppErrorBoundary` wraps the entire tree and renders a recoverable error screen instead of a blank window when a React render error is thrown.

---

### 3.3 Editor Subsystem

`editorExtensions.ts` contains all CodeMirror 6 extensions, organized into sections:

| Export | Purpose |
|--------|---------|
| `metisHighlightStyleDark` / `metisHighlightStyleLight` | Rich GFM syntax highlighting for dark and light themes respectively; `metisHighlightStyle` re-exports the dark variant for backward compat |
| `metisLineNumbers` | Custom gutter line numbers styled to match the active theme |
| `codeBlockPlugin` | Background + left-border decoration on fenced code blocks |
| `copyButtonPlugin` | Language badge + hover "Copy" button on code fence opening line |
| `calloutPlugin` | Obsidian-style `> [!TYPE]` callout block decoration with coloured left borders |
| `wikilinkExtensions` | `[[` autocomplete (searches note names **and** aliases), `/` slash menu, wikilink decorations + Cmd+Click handler |
| `taskListClickExtension` | Source-mode click handler + decorations for task markers; clicking `[ ]` / `[x]` toggles completion |
| `listContinuationKeymap` | Enter key continues bullet / task / ordered lists; empty item exits list |
| `makeInlinePreviewExtension` | Inline `<img>` rendering below image lines; Cmd+Click to follow links in source mode |
| `smartPasteExtension` | Clipboard image → `save_asset` + inserts `![](assets/...)`; URL-over-selection → Markdown link |
| `markdownAutoComplete` | Auto-close ` ``` `, `[]()`, `**`, `_`, `` ` `` |
| `hideFrontmatterField` | Decorates YAML frontmatter fields for the MetadataPanel integration |
| `createVisualModePlugin` | Factory function for the visual mode ViewPlugin (handles preview overlay coordination) |
| `search()` | Provides search state & match highlighting (from `@codemirror/search`); the built-in panel is replaced by `EditorFindBar.tsx` — a React component that dispatches `setSearchQuery` effects and calls `findNext`/`findPrevious`/`replaceNext`/`replaceAll` commands programmatically |

**Dynamic theming** — `Editor.tsx` defines a `bgCompartment` (CodeMirror `Compartment`) that is reconfigured in-place when the user changes the background colour preset (Dark / Black / Slate / Purple / Pink / White / Cream). This avoids destroying and re-creating the editor, preserving cursor position, undo history, and scroll state.

**Spellcheck** — A lint-based spellcheck system is exposed via a `spellcheckCompartment`. When enabled, a `@codemirror/lint` linter extracts prose words from the document (skipping code blocks, frontmatter, URLs, and other syntax nodes using the CM6 syntax tree), sends unique words in a batch to the Rust `check_spelling` Tauri command, and renders wavy underlines on misspelled words. Hovering a misspelled word shows a styled tooltip with up to 3 inline suggestions and clickable action buttons for up to 5 — clicking a suggestion replaces the word with case-preserving logic. Suggestions are fetched in a single batch via the `suggest_spelling` Tauri command and cached per-language on the client side. The Rust backend uses `spellbook` (a pure Rust Hunspell-compatible library from the Helix editor team) to parse bundled `.aff` + `.dic` dictionary files, giving full morphological analysis (plurals, verb tenses, contractions, etc.). Dictionaries are loaded lazily into a `Mutex<HashMap<String, Dictionary>>` and cached for the process lifetime. The user selects their preferred dictionary language (e.g. "en_US", "en_GB") in Settings → Spellcheck; switching languages clears the client-side word and suggestion caches. The on/off toggle is persisted to `localStorage` and accessible from the formatting toolbar.

**Source mode vs. Visual mode:**
- **Source mode** — CodeMirror is visible; `Toolbar` and `SelectionToolbar` are active; `makeInlinePreviewExtension` renders actual `<img>` elements as block widgets below image markdown lines.
- **Visual mode** — CodeMirror is hidden (`opacity: 0`, `pointer-events: none`) but remains mounted so state is preserved; `MarkdownPreview` is overlaid. The preview converts markdown to HTML via `marked`, sanitises with DOMPurify, and attaches a unified click handler for wikilinks, external URLs, and task-list checkboxes.

---

## 4. AI Subsystem

### 4.1 Persona Model

Each AI **Persona** is a named configuration object stored in `personas.json`:

```typescript
interface Persona {
  id: string;           // Stable UUID
  name: string;         // Display name, e.g. "Writer"
  icon: string;         // Emoji or short label
  systemPrompt: string;
  model: string;        // e.g. "gpt-4o", "gemini-1.5-pro", "llama3-70b-8192"
  provider: "openai" | "gemini" | "groq" | "perplexity";
  disabled?: boolean;   // When true, hidden from the AI tab chip bar
}
```

**Execution Scope** controls how much of the vault the AI sees for a given run:

```typescript
type ExecutionScope =
  | { type: "current-file" }                          // Active note only
  | { type: "specific-file"; filePath: string }       // A specific .md file (chosen from dropdown)
  | { type: "specific-folder"; folderPath: string }   // All .md files in a folder
  | { type: "full-vault" };                           // Every .md file in the vault
```

The **File scope** dropdown lets users pick any `.md` file in the vault. Selecting a file also switches the editor to that note, keeping the AI context and the visible content in sync.

---

### 4.2 System Personas

Two **System Default** personas ship with the app and cannot be edited or deleted:

#### The Librarian (`persona-librarian`)
- Scans the in-memory `noteIndex` for **orphaned notes** — notes with no incoming or outgoing `[[wikilinks]]`.
- Parses outgoing links from each note's content and builds an in-degree map.
- Generates a Markdown report with counts, lists of isolated notes, and suggested linking strategies.
- Runs client-side; only the report is passed to the LLM for final commentary.
- Has a dedicated UI panel in the AI tab with its own "Scan Vault" button.

#### Task Manager (`persona-task`)
- Scans all notes in the vault for incomplete Markdown checkbox items only (`- [ ]`, `* [ ]`, `+ [ ]`, `1. [ ]`).
- Aggregates open tasks into a structured Markdown list grouped by source file, and includes a source wikilink on each task item.
- Adds a **Vault Task Sync** action that applies checkbox updates from `summaries/todo.md` back to source notes, then regenerates `todo.md` from the latest vault task state.
- Uses `agent_write_note` to write (or overwrite) `summaries/todo.md` automatically after the AI response is streamed.
- Has a dedicated "Scan & Update todo.md" button in the AI tab.
- `todo.md` is always sorted to the top of the folder it lives in (`summaries/` by default).

**System persona rules:**
- Displayed in their own "System" group in the AI tab chip bar and "System Default" group in the Settings personas list.
- Cannot be expanded for editing; the generic Ask input and Run button are greyed out when a system persona is active.
- Enable/disable toggle still applies — disabled system personas are hidden from the chip bar.

---

### 4.3 Context Builder

`src/services/contextBuilder.ts` assembles the context string sent to the AI using a **three-tier strategy** to stay within the model's token limit:

```
Tier 1 — DIRECT
  Total chars of all files ≤ usable char budget (75% of model context × 4 chars/token)
  → Send all files as-is

Tier 2 — TF-IDF
  Total chars ≤ 3× budget
  → Score each file against the user's query by term frequency/inverse document frequency
  → Send only the highest-scoring files that fit within the budget

Tier 3 — SCOUT
  Total chars > 3× budget
  → Pre-filter with TF-IDF to ≤ 60 candidate files
  → Make a fast, non-streaming LLM call with only file titles + 400-char previews
  → LLM returns a JSON array of the filenames it needs
  → Fetch full content only for those files; fall back to TF-IDF picks if scout fails
```

For `current-file` and `specific-file` scopes, the pipeline is bypassed entirely — the target note is sent directly.

Model context limits are maintained in a lookup table in `contextBuilder.ts`. Unknown models currently fall back to 32 k tokens. The budget reserves 25% for response and system-prompt overhead.

---

### 4.4 AI Service Layer

`src/services/aiService.ts` is the single gateway for all AI calls. It uses the **OpenAI-compatible SDK** (`openai` npm package) so the same code works with OpenAI, Google Gemini (via their OpenAI-compat endpoint), Groq, and Perplexity:

| Provider | Base URL |
|----------|---------|
| OpenAI | `https://api.openai.com/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq | `https://api.groq.com/openai/v1` |
| Perplexity | `https://api.perplexity.ai` |

The primary export is `streamResponse`, which:
1. Builds an OpenAI client from the persona's provider config.
2. Wraps the context string in `<context>…</context>` tags.
3. Starts a streaming chat completion with `stream: true`.
4. Accumulates streamed text chunks and calls `callbacks.onChunk(text)` on each delta.
5. Accumulates streamed tool call argument fragments in parallel.
6. On stream end, parses accumulated tool calls and calls `callbacks.onDone(fullText, toolCalls)`.

`testProviderConnection` is a zero-cost connectivity check that calls `models.list()` and scrubs any accidental API key fragments from error messages before showing them in the UI. The error classifier (`describeError`) unwraps the OpenAI SDK's `APIConnectionError.cause` to surface the actual network failure (DNS, TLS, timeout, etc.) instead of the generic "Connection error." message.

**Gemini native fallback:** `src/services/geminiNative.ts` provides a direct Gemini REST API client (`generateContent` / `streamGenerateContent`) that bypasses the OpenAI-compat layer when the official endpoint is unreliable (e.g. empty-body HTTP 429 on chat + tools). It uses `@tauri-apps/plugin-http` (`tauriFetch`) in production for CORS-free requests, with a Vite dev proxy fallback in development. The native path activates automatically when the configured base URL points to the official Google API host.

**TLS backend:** `tauri-plugin-http` is configured with the `native-tls` feature (instead of the default `rustls-tls`). This makes the underlying `reqwest` client use the OS certificate store (macOS Keychain, Windows SChannel, Linux OpenSSL), so corporate/internal CA certificates installed on the system are trusted automatically — no per-provider certificate bypass flags are needed.

**Security:** API keys are never hard-coded. They are read from `settings.json` in the OS app-data directory and passed through the Zustand store. `dangerouslyAllowBrowser: true` is required for the Tauri webview environment where the key is user-owned and stored locally — a future migration path to `tauri-plugin-stronghold` is noted in the source.

---

### 4.5 Agent File Tools

When the AI tab is in **agent mode** (scope other than `current-file` / `specific-file`), the model is given five function-calling tools via `AGENT_FILE_TOOLS`:

| Tool | Behaviour |
|------|-----------|
| `write_to_current_file` | Full overwrite of the active note with new content |
| `append_to_current_file` | Add a new section at the end; agent supplies only the chunk |
| `prepend_to_current_file` | Insert at the start (after any YAML frontmatter); agent supplies only the chunk |
| `insert_at_cursor` | Insert content at the current cursor position |
| `create_new_note` | Create a new `.md` file at a vault-relative path |

For `append` / `prepend` / `insert_at_cursor`, the agent sends **only the new chunk** — the frontend handles merging with the existing file content. This prevents the model from needing to reproduce the entire file and reduces token cost.

Tool calls are dispatched by `CommandCenter` via the `agent_write_note` Tauri command, which enforces the vault boundary on the Rust side before writing to disk.

The **SelectionToolbar** (the floating bar that appears when text is highlighted in the editor) provides quick-access AI actions (Improve, Summarise, Expand, Extract action items) that pre-fill the AI tab via `usePersonaStore.selectionQuery` and optionally auto-run. If the Command Center is closed or on a different tab, it is automatically opened and switched to the AI tab.

---

## 5. Metadata & Note Index

### NoteMetadata type

```typescript
interface NoteMetadata {
  name: string;         // Filename without extension
  path: string;         // Absolute path
  aliases?: string[];   // Alternative names (from `aliases:` frontmatter)
  status?: string;      // Workflow status: draft | in-progress | review | done | archived
  date?: string;        // ISO date string (from `date:` frontmatter)
  parent?: string;      // Containing folder name (auto-derived from path, not frontmatter)
}
```

### Enrichment pipeline

1. **Immediate (on vault open):** `flattenNotes()` populates `name` and `path` only from the file tree — no IPC reads required.
2. **Background (async):** `enrichNoteIndex()` batch-reads all `.md` files in groups of 20 concurrent `get_file_content` IPC calls and calls `parseNoteMeta()` on each, updating the corresponding `noteIndex` entries.
3. **Lazy (on file open):** `setActiveFile()` calls `parseNoteMeta()` immediately for the opened note and updates its entry — ensuring freshness even before background enrichment reaches that note.
4. **Live (on edit):** `setActiveFileContent()` re-parses and updates the active note's entry on every content change — status colours and alias autocomplete always reflect the current unsaved content.

### Downstream consumers

| Consumer | Uses |
|----------|------|
| Sidebar `FileTreeNode` | `status` → coloured file icon (blue = in-progress, yellow = review, green = done, muted = draft/archived) |
| `CommandPalette` | `status` → filter chips; `aliases` → Fuse.js search keys |
| `editorExtensions` wikilink autocomplete | `aliases` → matched alongside `name`; detail label shows which alias was matched |
| `MetadataPanel` | `status` dropdown, `date` picker, `aliases` input — all write back to frontmatter |

---

## 6. Backend Architecture (Rust / Tauri)

All backend logic lives in `src-tauri/src/main.rs`. Rust crates used:

| Crate | Purpose |
|-------|---------|
| `tauri` v2 | Desktop shell + IPC |
| `tauri-plugin-dialog` | Native file/folder picker dialogs |
| `tauri-plugin-http` | CORS-free HTTP fetch for native Gemini API calls in production builds |
| `serde` + `serde_json` | Serialise structs to JSON for IPC + validate JSON payloads before writing |
| `walkdir` | Ergonomic recursive directory walking |
| `notify` v6 | Cross-platform recursive file-system event watcher |
| `base64` | Decode clipboard image data for `save_asset` |
| `regex` | Pattern matching for vault-wide search and replace |
| `spellbook` | Pure Rust Hunspell-compatible spellchecker (from Helix editor) — parses `.aff` + `.dic` files |
| `open` | Open URLs and paths in OS default apps |

Two pieces of **managed state** are registered at startup, both keyed by Tauri window label so each open window maintains completely independent state:
- `WatcherState(Mutex<HashMap<String, RecommendedWatcher>>)` — keeps each window's active FS watcher alive, indexed by window label.
- `CurrentVault(Mutex<HashMap<String, String>>)` — tracks the vault path per window. File-operation commands look up their window's entry to enforce the vault boundary without trusting the frontend to pass it each time.

---

### 6.1 Tauri Commands

#### Vault & file tree

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `open_vault` | `path` | `VaultData` | Validate path, create missing default folders (`daily`, `meetings`, `summaries`, `assets`), walk directory tree, record vault in `CurrentVault`, return `FileNode` tree |
| `create_vault` | `parent_path`, `name` | `VaultData` | Create vault folder + default subfolders, record in `CurrentVault`, return initial tree |
| `convert_vault_to_metis` | `vault_path`, `add_metadata` | `VaultData` | Write `.metis/vault.json` marker, create default subfolders, optionally back-fill minimal YAML frontmatter to existing `.md` files; emits `convert-vault-progress` events for live progress tracking |

#### File CRUD

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `save_note` | `path`, `content` | `()` | Write `.md` file within vault boundary |
| `get_file_content` | `path` | `String` | Read `.md` file within vault boundary |
| `create_note` | `dir_path`, `name` | `String` (new path) | Create `.md` file seeded with `# Title` |
| `create_folder` | `parent_path`, `name` | `String` (new path) | Create directory |
| `delete_path` | `path`, `vault_path` | `()` | Delete file (`.md`, images, PDF) or folder recursively; refuses to delete vault root |
| `rename_path` | `path`, `new_name` | `String` (new path) | Rename file or folder in same directory |
| `move_path` | `src`, `dest_dir`, `vault_path` | `String` (new path) | Move file/folder; validates destination is inside vault and not a descendant of source |

#### Smart context (for AI)

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `get_file_summaries` | `folder_path`, `recursive` | `Vec<FileSummary>` | Fast metadata scan: path, name, 400-char preview, char count; vault-boundary checked |
| `get_files_content` | `paths: Vec<String>` | `String` | Fetch + concatenate full content for an explicit list of paths (max 100 per call); vault-boundary checked |
| `get_folder_md_contents` | `folder_path` | `String` | Legacy single-call command; retained for backward compatibility |

#### Vault-wide search & replace

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `search_vault` | `query`, `case_sensitive`, `regex_mode` | `Vec<SearchMatch>` | Full-text search across all `.md` files in the vault — matches both file names (stem without `.md`) and file contents; filename matches use `line_number: 0` as a sentinel; returns up to 1 000 matches with file path, line number, line content, and match offsets; supports plain-text and regex modes |
| `replace_in_vault` | `query`, `replacement`, `case_sensitive`, `regex_mode` | `Vec<ReplaceSummary>` | Find-and-replace across all `.md` files; returns per-file replacement counts; only writes files that actually changed |

#### Agent writes

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `agent_write_note` | `rel_path`, `content` | `String` (absolute path) | Create or overwrite a note at a vault-relative or absolute path; enforces `.md` extension; creates parent directories within vault; path-traversal safe via `normalize_path` |

#### Assets & system

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `save_asset` | `vault_path`, `filename`, `data_base64` | `String` (relative path) | Decode base-64 image, write to `assets/`, return vault-relative path for Markdown insertion |
| `check_spelling` | `words: Vec<String>`, `language: String` | `Result<Vec<String>>` | Check words against a Hunspell dictionary (via `spellbook`); returns misspelled words; dictionaries loaded lazily from bundled resources |
| `suggest_spelling` | `words: Vec<String>`, `language: String` | `Result<HashMap<String, Vec<String>>>` | Return up to 5 Hunspell suggestions per misspelled word (max 50 words per call) |
| `list_dictionaries` | — | `Vec<String>` | Scan the bundled `resources/dictionaries/` directory and return available language codes (e.g. `["en_GB", "en_US"]`) |
| `open_url` | `url` | `()` | Open `https://` URL in OS default browser |
| `reveal_in_finder` | `path`, `vault_path` | `()` | Reveal item in Finder (macOS AppleScript) / Explorer (Windows `/select`) / xdg-open (Linux) |
| `open_vault_window` | `vault_path` | `()` | Spawn a new Metis window pre-loaded with the given vault via `?vault=` URL query param |
| `set_vault_watch` | `path` | `()` | Start recursive FS watcher; emits `vault-changed` Tauri events |

#### Persona & settings persistence

| Command | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `load_personas` | — | `String` (JSON) | Read `personas.json` from OS app-data dir; returns `"[]"` if not found |
| `save_personas` | `json` | `()` | Validate JSON then write `personas.json` to OS app-data dir |
| `load_settings` | — | `String` (JSON) | Read `settings.json` from OS app-data dir; returns `"{}"` if not found |
| `save_settings` | `json` | `()` | Validate JSON then write `settings.json` to OS app-data dir |

---

### 6.2 File-System Watcher

`set_vault_watch` starts a `notify::RecommendedWatcher` stored in `WatcherState`. It watches only **structural** changes:

```
Create(_) | Remove(_) | Modify(Name(_))   →  emit "vault-changed"
Modify(Data(_))                            →  ignored (editor auto-saves don't refresh sidebar)
```

The frontend debounces incoming `vault-changed` events by **300 ms** before calling `refreshVault()`, collapsing rapid bursts (e.g. moving a folder with many files) into a single IPC round-trip.

---

### 6.3 Security Model

| Concern | Implementation |
|---------|---------------|
| **Path traversal (names)** | `sanitize_name()` blocks `/`, `\`, `\0`, `.`, `..`, Windows reserved names (CON, NUL, COM1–9, LPT1–9), and names over 255 chars in all user-supplied file/folder names |
| **Path traversal (agent writes)** | `normalize_path()` resolves `.` and `..` path components; any `..` that would escape the root returns an error before the vault-boundary check |
| **Path traversal (image src)** | `MarkdownPreview.tsx` normalises image `src` attributes and validates they remain within the vault before calling `convertFileSrc()`. Absolute paths and `../` traversal that would escape the vault are replaced with an empty string. |
| **Vault boundary — file I/O (fail-closed)** | `save_note`, `get_file_content`, `create_note`, `create_folder`, `rename_path`, `move_path`, `delete_path`, `get_file_summaries`, `get_files_content`, `agent_write_note`, `save_asset`, `search_vault`, `replace_in_vault`, `set_vault_watch`, and `reveal_in_finder` all require a registered `CurrentVault` entry for the calling window. |
| **Vault boundary — canonical paths** | All file-operation commands resolve target paths via `safe_resolve()` and compare against the canonicalized vault via `canon_vault()`, preventing `..`-based traversal and symlink escapes. File I/O uses the resolved canonical path. |
| **TOCTOU mitigation** | Commands use the canonicalized path for both the boundary check and the actual file operation, narrowing the race-condition window between check and use. |
| **Per-window state isolation** | `CurrentVault` and `WatcherState` are `Mutex<HashMap<String, …>>` keyed by Tauri window label. Each vault window has completely isolated state; one window cannot influence another’s vault boundary. |
| **Extension allowlist** | `save_note` / `get_file_content` / `get_files_content` accept only `.md`; `save_asset` accepts only `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg`; `delete_path` applies `ALLOWED_FILE_EXTS` for file deletions |
| **Asset size limit** | `save_asset` rejects base64 payloads exceeding 50 MiB before decoding, preventing memory exhaustion / disk fill |
| **Vault root protection** | `delete_path` refuses to delete the vault root directory itself |
| **Bulk read limits** | `get_files_content` rejects requests for more than 100 paths per call and enforces a 5 MiB aggregate response cap |
| **URL injection** | `open_url` validates the scheme is `https://` (case-insensitive) before calling `open::that()` |
| **AppleScript injection** | `reveal_in_finder` (macOS) rejects paths containing `"`, `\n`, or `\r` before embedding them in an AppleScript string literal |
| **HTML injection** | Preview HTML is sanitised with DOMPurify before `dangerouslySetInnerHTML`; `asset://` URLs are stashed in `data-src` during sanitisation and moved to `src` afterwards |
| **Regex complexity limits (ReDoS)** | `search_vault` and `replace_in_vault` reject user-supplied regex patterns longer than 1 000 characters and set a 1 MiB compiled NFA size limit to prevent catastrophic backtracking |
| **Wikilink path normalisation** | `resolveWikilinkAssetPath()` normalises `..` segments in wikilink paths and validates the result stays within the vault root before passing it to `convertFileSrc()` |
| **JSON payload validation** | `save_personas` and `save_settings` call `serde_json::from_str` to validate the payload is well-formed JSON before writing to disk |
| **API key isolation (dev vs. release)** | Debug builds write settings to `<AppData>/com.metis.app/dev/settings.json`; release builds use `<AppData>/com.metis.app/settings.json`. Dev credentials can never appear in a production build. |
| **API key storage** | Keys stored in OS app-data dir (`settings.json`), protected by OS file permissions. `dangerouslyAllowBrowser: true` is required in the Tauri webview context where keys are user-owned. Future: migrate to `tauri-plugin-stronghold`. Keys are never logged or sent anywhere except the user’s chosen AI provider. |
| **Data minimisation** | Only the specific note content required for the AI task is sent to the cloud. The full vault is never transmitted in a single call. The three-tier context strategy (`DIRECT → TF-IDF → SCOUT`) further limits what is sent. |
| **CSP** | `script-src 'self'` prevents inline script execution and external script injection. `connect-src` is explicitly allowlisted to approved HTTPS domains (AI providers, enterprise gateway, and the public-holiday import API) rather than broad wildcards. `style-src 'unsafe-inline'` is limited to styles (no script execution risk). |
| **Capabilities scope** | `capabilities/default.json` covers `main`, `vault_*`, and `metis-help` windows so all dynamically-created vault windows receive the same permission set as the primary window. HTTP fetch permission is restricted to an explicit allowlist (provider domains, approved enterprise gateways, and `date.nager.at` for holiday import). |
| **Spellcheck dictionary validation** | `check_spelling` / `suggest_spelling` accept only discovered bundled dictionary language codes and reject invalid path characters before dictionary file resolution |
| **Dialog deadlock prevention** | `pick_folder` uses the async callback API (`DialogExt::pick_folder`) with `mpsc::channel` + `spawn_blocking` to avoid the macOS main-thread deadlock that `blocking_pick_folder` causes inside synchronous Tauri commands. |

---

## 7. Data Flow

### Opening a vault

```
User clicks "Open Vault…" (menu or sidebar button)
  → invoke("pick_folder")                 [Rust: async, dialog parented to calling window]
      → tauri_plugin_dialog::DialogExt::pick_folder (callback API, no deadlock)
      → returns selected folder path or null if cancelled
  → invoke("open_vault", { path })
      → Rust: validates path, creates missing default dirs, records in CurrentVault[window.label]
      → build_file_tree() → returns VaultData { path, files[], is_metis_vault, vault_hint }
  → useStore.setVault(data)
      → files, vaultPath, noteIndex (names + paths only), assetIndex updated
      → setTimeout(() => enrichNoteIndex(), 0) — background frontmatter enrichment
  → Sidebar renders FileTreeNode tree
  → invoke("set_vault_watch", { path })
  → localStorage.setItem("metis_last_vault_path", path)

  [File › Open Vault menu item only — opens in a NEW window]
  → invoke("open_vault_window", { vaultPath })
      → Rust: validates path, spawns WebviewWindowBuilder with label "vault_<timestamp>"
      → new window loads index.html?vault=<encoded-path>
      → App.tsx reads ?vault param → calls open_vault in the new window context
```

### Editing and auto-saving

```
User types in CodeMirror
  → EditorView.updateListener fires
  → useStore.setActiveFileContent(content)
      → isDirty = true
      → parseNoteMeta(content) → updates noteIndex entry for active file immediately
  → debounced 1 s timer restarts
  → timer fires → invoke("save_note", { path, content })
  → useStore.markSaved()  → isDirty = false
```

### AI agent run

```
User clicks "Run" in AI tab (or SelectionToolbar quick-action)
  → buildSmartContext(scope, userMessage, persona, providerConfig, ...)
      → if current-file or specific-file: use target file content directly
      → if folder/vault:
          invoke("get_file_summaries", { folderPath, recursive })
          → Tier 1/2/3 selection (direct / TF-IDF / scout)
          → invoke("get_files_content", { paths })
  → streamResponse(persona, context, userMessage, providerConfig, callbacks, tools)
      → OpenAI-compat streaming chat completion
      → callbacks.onChunk(text)  → append to streaming display
      → callbacks.onDone(full, toolCalls)
          → if toolCalls empty: show response text
          → if tool call present (e.g. append_to_current_file):
              invoke("agent_write_note", { relPath, content })  or
              useStore.setActiveFileContent(merged)  + invoke("save_note")
  → usePersonaStore.addHistory(entry)
```

### Drag-and-drop file move

```
User drags node (pointerdown → pointermove > threshold)
  → document.body.style.userSelect = "none"  (prevent text selection)
  → ghost div follows cursor (direct DOM mutation — no React re-render)
  → findDropTarget() returns data-node-path of hovered folder or data-persona-id
  → pointerup fires
  → if dropped on folder: invoke("move_path", { src, destDir, vaultPath })
  → if dropped on persona chip: usePersonaStore.setPendingScope(scope)
                                 → CommandCenter opens and runs scoped AI query
  → document.body.style.userSelect = ""
  → refreshVault() reconciles disk state
```

---

## 8. Feature Inventory

### Vault Management
- Create a new vault: dialog picks parent folder, names it, creates `daily/`, `meetings/`, `summaries/`, `assets/` subfolders
- Open an existing vault from disk
- **Convert foreign vaults:** opening a non-Metis folder shows `ConvertVaultModal` — user can "Open As-Is" or "Convert" (writes `.metis/vault.json` marker, creates default folders, optionally back-fills YAML frontmatter with a live progress bar)
- Auto-restore last opened vault on launch (persisted to `localStorage`)
- **Multi-window:** Opening a different vault while one is already open spawns a new Metis window pre-loaded via `?vault=` query param; does not clobber the primary window's `localStorage` key
- Real-time sidebar refresh via Rust FS watcher + 300 ms frontend debounce

### File Tree (Sidebar)
- Recursive file tree with expand/collapse chevrons
- **Pinned sections** (at top): `daily`, `meetings`, `summaries`, `assets`
- **Status-coloured icons:** file icons are tinted based on the note's `status` frontmatter field (blue = in-progress, yellow = review, green = done, muted = draft/archived); colours update immediately on edit
- **Files** (below): all other vault contents
- `todo.md` is always sorted to the top of the folder it lives in (`summaries/` by default)
- Expand all / Collapse all toggle
- Inline create: new note or new folder at any level
- Inline rename (Enter to confirm, Escape to cancel)
- Delete note, folder, or asset file
- Drag-and-drop move with optimistic UI update; drag to a persona chip to scope an AI run
- Right-click context menu: New Note Here, New Folder Here, Rename, Run with Persona, Reveal in Finder, Copy Path, Delete
- **Vault-wide search & replace:** `Cmd+Shift+F` (or search icon in sidebar header) opens a full-text search panel replacing the file tree; debounced 300 ms query; case-sensitive and regex toggles; searches both file names and file contents; results grouped by file with line numbers and match highlighting; filename matches are highlighted in file headers with an accent ring; click-to-navigate to file + line; collapsible Replace All with vault-wide string replacement
- Collapsible sidebar that renders an icon strip when collapsed

### Editor
- CodeMirror 6 with full GFM markdown parsing (`@codemirror/lang-markdown` + `@lezer/markdown`)
- **Source mode:** raw markdown with rich syntax highlighting
- **Visual mode:** full HTML preview (images, tables, task lists, callouts, wikilinks); links use consistent blue underlined styling in rendered prose
- **In-editor find & replace:** `Cmd+F` opens the custom React find bar (find-only by default); `Cmd+R` opens find-and-replace; Enter / Shift+Enter for next/prev match; case-sensitive and regex toggles; match count display; replace single / replace all buttons; shortcuts toggle: press again to focus, press while focused to close; when the sidebar was last focused, `Cmd+F` routes to vault-wide search instead
- Formatting toolbar: H1–H3, Bold, Italic, Code, Link, Image, Code Block, Blockquote, Bullet List, Numbered List, Task list, Table, HR, Spellcheck toggle — **responsive**: a `ResizeObserver` switches to compact mode (smaller icons, tighter padding) when the editor pane is narrow
- **Spellcheck toggle:** enables/disables lint-based spellcheck using Hunspell dictionaries (spellbook) via a Tauri command; misspelled words shown with wavy underlines; hovering a misspelled word shows a tooltip with suggestions — click a suggestion to replace the word (case-preserving); dictionary language selectable in Settings → Spellcheck (en_US, en_GB); state persisted to `localStorage`; visual indicator shows active state on the toolbar button
- Keyboard shortcuts: `Cmd+B` bold, `Cmd+I` italic, `Cmd+S` save
- Background colour presets: Dark, Black, Slate, Purple, Pink, White, Cream — hot-swapped via CM6 `Compartment`
- Switching workspace modes (Source / Visual / Planner) scrolls the CodeMirror viewport to the **bottom** of the document; Visual preview (`MarkdownPreview`) and Command Center tab panels scroll their primary scroll regions to the bottom on tab changes; Planner internal tab switches scroll the planner content area to the bottom
- Auto-save: 1 second after last keystroke

### Rich Source Mode
- Inline `<img>` widgets rendered below image markdown lines; **right‑click** opens **Reveal in Finder / Reveal in File Explorer** for vault-local paths (same containment checks as filesystem sidebar reveal)
- **GFM table preview (source mode):** completed pipe tables show raw markdown while the caret intersects the table; moving the caret elsewhere collapses the block into a clickable HTML preview (click returns to markdown at the table start), analogous to link-collapse behavior
- `Cmd/Ctrl+Click` on `[text](url)` (including collapsed-link tokens with `data-md-link-href`) or `[[wikilink]]` ranges to follow links
- Fenced code blocks: per-language syntax highlighting, language badge, hover Copy button
- Callout blocks (`> [!INFO]`, `> [!WARNING]`, `> [!TIP]`, `> [!DANGER]`, etc.) with coloured left borders
- Auto-close pairs: ` ``` `, `**`, `_`, `` ` ``, `[]()`
- Slash menu `/` at line start: heading 1–3, bullet/ordered/task list, task list with due-date scaffold, code block, callout, divider
- Enter key continues bullet, task, and numbered lists; empty indented item outdents by one level, empty root-level item removes the marker; non-list lines get a plain newline (no indentation carried over)
- Tab on a list item indents the line by 4 spaces (marker + text shift together); on plain text inserts 4 spaces at cursor
- Shift+Tab on an indented list item outdents the line and all contiguous child lines (deeper indentation) by 4 spaces, preserving hierarchy; at root level with cursor at column 0, removes the bullet marker entirely; at root level with cursor past column 0, does nothing
- Smart paste: URL over selection → Markdown link; image from clipboard → `save_asset` + `![](assets/...)`
- Wikilink autocomplete: typing `[[` shows a live dropdown searching both note names and aliases
- Click task checkboxes directly in source mode: clicking the task marker toggles `- [ ]` ↔ `- [x]`
- Markdown links collapse in source mode: `[Display](URL)` renders as just `Display` (blue underline) while keeping full markdown in the underlying document; when the cursor enters the link range, the full markdown syntax reappears for editing
- YAML frontmatter editing via `MetadataPanel` below the editor

### Metadata Panel
- **Properties section** (always visible): `status` dropdown (draft / in-progress / review / done / archived), `date` calendar picker, `parent` (read-only, auto-derived from containing folder), `aliases` text input (comma-separated)
- **Tags section:** editable tag chips backed by the `tags:` frontmatter key
- **Generic fields section:** arbitrary additional frontmatter key/value pairs (smart keys filtered out to avoid duplication)
- **Links section:** read-only list of all `[[wikilinks]]` found in the note body
- Status pill shown in collapsed header bar
- All edits go through `onContentChange` so undo/redo and auto-save work correctly

### AI (Command Center — AI Tab)
- **Persona chips** grouped into System and Custom sections
- **System Default personas** (read-only, cannot be edited/deleted):
  - **The Librarian** — scans the vault for orphaned notes (no incoming/outgoing links) and reports them
- **Task Manager** — aggregates only incomplete `- [ ]` tasks across all notes into `summaries/todo.md`, with source-note links on each task
- **Task Manager** — also supports a bi-directional vault task sync action (`todo.md` checkbox state ↔ source-note checkbox state)
- Task items support an optional due-date marker `(due: YYYY-MM-DD)`; task scan/sync preserves this inline metadata
- **Custom personas:** create, edit, delete; configure model, provider, and system prompt
- **Scope picker:** Current File / Specific File (with vault-wide dropdown) / Folder / Full Vault
- **Smart context:** automatic Tier 1/2/3 context assembly with status indicator
- **Streaming responses:** output appears progressively in real-time; a spinning loading indicator with "{Persona} is thinking…" is shown between request submission and first token arrival
- **Agent file tools:** Write, Append, Prepend, Insert at Cursor, Create New Note — with a pending-changes review step before applying
- **Floating SelectionToolbar:** quick AI actions on highlighted text (Improve, Summarise, Expand, Explain, Extract action items, Ask…) — auto-opens Command Center if closed
- **Customisable quick actions (`QuickActionsSettings`):** drag to reorder, edit label/prompt, pin a specific persona to an action, create new custom actions, delete any action except the "Ask…" fallback
- **Model picker (`ModelPicker`):** curated model suggestions per provider (small/medium/large/reasoning tiers), free-text input, background `models.list()` refresh button
- **Gemini native fallback (`geminiNative.ts`):** direct Gemini REST API client bypasses the OpenAI-compat layer when it returns unreliable responses; uses `tauri-plugin-http` for CORS-free fetch in production
- **Persona management (Settings tab):** personas sorted into System Default / Custom groups; enable/disable toggle per persona; disabled personas hidden from the chip bar
- **Connection test:** zero-cost `models.list()` check per provider
- **History:** configurable via `storeAiHistory` toggle and `aiHistoryMaxResponseChars` cap; kept in memory, viewable in the AI tab

### Task Planner (Editor — Planner Tab)
- Access: bottom `Planner` button in the left files sidebar (not in the Source/Visual header toggle)
- **Formatting toolbar** (Weekly Review, Monthly Review, Templates tabs): same controls as the note editor (`Toolbar.tsx`), targeting the last-focused `PlannerCodeMirrorField` (`src/components/PlannerCodeMirrorField.tsx`)
- Daily Task View grid: Monday-Friday rows and week-range columns with purple/white headers
- Per-cell sections for planning/logging (template-editable labels; defaults are `What do I want to do` / `What did I do`)
- Daily template system for `What do I want to do` with cadence support (`daily`, `weekly`, `monthly`, `interval days`) and auto-population for empty plan cells
- New templates immediately seed future workday cells (one-year horizon) without overwriting existing plan text
- Templates are editable after creation (name, cadence, start date, interval, recurrence day, content)
- Weekly / monthly / interval templates support explicit recurrence-day selection (e.g., every Monday)
- Disabling or deleting a template requires a "final day" cutoff; auto-generated occurrences after that date are removed while existing manual plans remain untouched
- Special-day status toggle (`Work`, `Public Holiday`, `Sick Day`, `PTO`, `Personal`) with centered green status labels
- Context-aware planner navigation:
  - Daily Log: Previous Week / Today / Next Week
  - Weekly Review: Previous Month / This Month / Next Month
  - Monthly Review: Previous Year / This Year / Next Year
- Templates and PTO & Events tabs intentionally hide date navigation controls
- Internal planner tabs: `Daily Log`, `Weekly Review`, `Monthly Review`, `Templates`, `PTO & Events`
- Templates are managed in the dedicated `Templates` tab (not inline in Daily Log)
- Templates tab includes a planner-block template editor:
  - Daily Log: rename primary/secondary block labels, toggle secondary block visibility
  - Weekly Review: rename column headers and change default review body template
  - Monthly Review: rename headers and edit prompt list
  - Changes apply from the current date onward; past entries keep previous structure/content
- PTO & Events tracker tab provides editable tables for Public Holidays, PTO, Conferences, and Office Trips plus a PTO allocation/remaining counter
- PTO, Conferences, and Office Trips support date ranges via explicit `startDate` + `endDate` and sync across the full inclusive span
- Public Holidays no longer store a manual `longWeekend` flag; a `Long Weekend` chip is derived automatically when the holiday date falls on Monday or Friday
- Weekly Review view: week-range list (`Encountered Weekly`) with per-week notes (`Main Points & Issues Encountered`) and an `Action Points` template
- Monthly Review view: consolidated single-page year view (all 12 months visible together); columns are **Month** · **Issues Encountered** (editable markdown seeded from template prompts) · **Monthly Achievements** (right column); completion metadata (`date_completed`) still updates when either editable field changes
- Public Holidays table supports explicit country + province/state selection before import
- Import deduplicates by date: existing dates are not re-added; imported details are appended to that row's notes
- Local persistence in `localStorage` as nested JSON with shared month-level storage:
  - `daily_logs` keyed by `week_id`
  - `weekly_reviews` keyed by `week_id`
  - `monthly_review` keyed by month/year with optional `date_completed`
  - `tracker` object (`public_holidays`, `pto`, `conferences`, `office_trips`, `pto_stats`)
  - planner templates persisted separately as `metis_daily_task_templates_v1`
  - legacy daily-only planner data is migrated in-place on load
- Tracker sync engine auto-overrides Daily Log cells for matching event dates and adds an in-cell `Edit Event` jump back to the tracker tab
- Office Trips are synced as non-destructive top-of-cell banners (with `Edit Event`) and do not override the day's status or planning blocks
- Date-only tracker inputs (`YYYY-MM-DD`) are parsed as local calendar dates (not UTC) to prevent weekday drift in day-of-week display and cell matching

### Navigation
- `Cmd+P` Quick Switcher: Fuse.js fuzzy search across all vault notes (searches names and aliases); filterable by status chips
- `Cmd+Shift+F` Vault-wide full-text search (opens sidebar search panel)
- `Cmd+F` In-editor find (custom React find bar); `Cmd+R` find-and-replace; shortcuts toggle (open → focus → close); context-aware — routes to sidebar search when sidebar was last interacted with
- Keyboard navigation in palette: ↑↓ arrows, Enter to open, Escape to close
- Wikilinks in preview are clickable and navigate to the linked note
- External links open in OS default browser (validated `https://` only)

### Daily Notes
- Calendar button creates or opens `daily/YYYY-MM-DD.md`
- Seeded with `# YYYY-MM-DD` on first creation

### Native Menu Bar (macOS / Windows / Linux)
- File: New Note (`Cmd+N`), New Folder (`Cmd+Shift+N`), Open Vault (`Cmd+O`), New Vault, Save (`Cmd+S`), Open Daily Note (`Cmd+D`), Reveal in Finder, Close Window
- Edit: Undo, Redo, Cut, Copy, Paste, Select All (all predefined / OS-native)
- View: Toggle Sidebar (`Cmd+\`), Toggle Panel (`Cmd+Shift+\`), Source Mode, Visual Mode, Fullscreen
- Window: Minimize, Maximize
- Help: Metis Documentation

---

## 9. Extension Points

### Adding a new AI provider
1. Add the provider name to the `AIProvider` union in `src/types/persona.ts`.
2. Add its base URL to `PROVIDER_BASE_URLS` in `src/services/aiService.ts`.
3. Add curated models to `PROVIDER_PREFERRED_MODELS` in `src/services/aiService.ts`.
4. Add its model context limits to `MODEL_CONTEXT_TOKENS` in `src/services/contextBuilder.ts`.
5. Add provider config UI to the Settings tab in `CommandCenter.tsx`.

### Adding a new System Default persona
1. Add a constant ID (e.g. `MYPERSONA_ID`) and persona object to `DEFAULT_PERSONAS` in `src/types/persona.ts`.
2. Add the ID to `SYSTEM_DEFAULT_IDS` in `CommandCenter.tsx`.
3. Implement any client-side data scanning logic in `CommandCenter.tsx`'s `AITab` (see `buildOrphanReport` / `buildTaskContext` as patterns).
4. Add a dedicated UI panel (rendered when `activePersona?.id === MYPERSONA_ID`) with its own run button.

### Adding new Tauri commands
1. Implement the function in `src-tauri/src/main.rs`.
2. Add it to `tauri::generate_handler![...]`.
3. Call `invoke("command_name", { params })` from TypeScript.
4. If the command writes or reads files, enforce the vault boundary against `CurrentVault`.

### Adding new agent file tools
1. Add a new tool definition to `AGENT_FILE_TOOLS` in `src/services/aiService.ts`.
2. Handle the new `toolCall.name` case in the `onDone` callback inside `CommandCenter.tsx`'s `AITab`.

### Adding new CodeMirror extensions
1. Export from `editorExtensions.ts`.
2. Include in the `extensions` array in `Editor.tsx`.
3. Use the `bgCompartment` / `Compartment` pattern for any extension that needs hot-swappable configuration.

### Extending the pinned sidebar sections
1. Add the folder name to `PINNED_NAMES` in `Sidebar.tsx`.
2. Add the corresponding default folder creation call in both `open_vault` and `create_vault` in `main.rs`.

### Adding YAML frontmatter fields
`MetadataPanel.tsx` reads and writes YAML frontmatter from the active note's content. To add a dedicated control:
1. Add the key to `SMART_KEYS` (prevents duplication in the generic Fields section).
2. Add a `PropRow` entry in the Properties section with your custom control.
3. If the value should be serialised as a YAML inline array, add the key to `LIST_KEYS`.
4. Update `parseNoteMeta` in `useStore.ts` if the field should be indexed in `noteIndex`.
