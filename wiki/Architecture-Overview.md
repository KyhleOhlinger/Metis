# Architecture Overview

Metis is a three-pane desktop application built on Tauri v2. The frontend is a React SPA and all data lives as plain `.md` files on the user's local filesystem.

Related pages:

- [Architecture Review — May 2026](Architecture-Review-2026-05)
- [Runtime Model](Runtime-Model)
- [Data Model and Vault Contract](Data-Model-And-Vault)
- [Security Model](Security-Model)

## Layout

```
┌──────────┬──────────────────────────┬──────────────┐
│ Sidebar  │         Editor           │   Command    │
│ (files / │   CodeMirror 6 host      │   Center     │
│  search) │   Source / Visual        │  Info/AI/    │
│          │                          │  Settings    │
└──────────┴──────────────────────────┴──────────────┘
```

- **Sidebar** — File tree (with pinned sections), vault-wide search panel, drag-and-drop, context menu.
- **Editor** — CodeMirror 6 with markdown extensions, formatting toolbar, metadata panel, in-editor find/replace.
- **Theme picker** — header color selector now stays interactive across Planner/source transitions and closes on tab/file switch to prevent stale overlay blocking.
- **Command Center** — AI personas, scope picker, streaming responses, agent file tools, settings.
- **Planner mode** — opened from the Planner button at the bottom of the left sidebar.

## State Management

Two Zustand stores:

- **`useStore`** — vault path, file tree, active file, editor state, note/asset indexes, sidebar view, `isMetisVault` flag (tracks whether the open folder has a `.metis/vault.json` marker).
- **`usePersonaStore`** — AI personas, provider API keys, conversation history, quick actions configuration, cross-component signals (`pendingScope`, `selectionQuery`).

## Key Components

| Component | Responsibility |
|-----------|---------------|
| `Editor.tsx` | CodeMirror host, header bar, theme picker, source/visual toggle |
| `Sidebar.tsx` | File tree, drag-and-drop, persona sidebar, search toggle, and bottom Planner entry button |
| `editorExtensions.ts` | All CM6 extensions (~1 300 lines) |
| `Toolbar.tsx` | Formatting toolbar + spellcheck toggle |
| `spellcheck.ts` | Lint-based spellcheck extension and suggestion actions |
| `SearchPanel.tsx` | Vault-wide full-text search & replace |
| `CommandCenter.tsx` | Right panel (Info / AI / Settings tabs) |
| `DailyTaskGrid.tsx` | Planner workspace with tabbed Daily Log/Weekly Review/Monthly Review/Templates/PTO & Events; no-file planner access; editable cadence templates; country+region holiday import (date-deduped); PTO counter; tracker sync overrides Daily Log special-day states (local calendar parsing); Weekly/Monthly/Templates tabs expose `PlannerCodeMirrorField` + shared markdown toolbar |
| `PersonaCreator.tsx` | Modal for creating/editing personas |
| `ModelPicker.tsx` | Combobox for selecting AI models (curated suggestions + free-text) |
| `QuickActionsSettings.tsx` | Drag-to-reorder, edit, and create selection toolbar actions |
| `ConvertVaultModal.tsx` | Converts a foreign folder into a Metis vault (marker + default folders + optional frontmatter back-fill) |
| `SelectionToolbar.tsx` | Floating AI toolbar on text selection |
| `CommandPalette.tsx` | Cmd+P fuzzy note switcher |
| `MetadataPanel.tsx` | YAML frontmatter editor (status, date, parent, aliases, tags) |
| `PlannerCodeMirrorField.tsx` | Compact CodeMirror markdown hosts for planner text fields; registers with the shared `Toolbar` via ref on focus |
| `MarkdownPreview.tsx` | HTML visual preview tab (scroll anchors to bottom when content renders) |

## Services

| Service | Responsibility |
|---------|---------------|
| `aiService.ts` | Single gateway for all AI calls (OpenAI-compatible SDK); streaming, tool calls, connection tests, curated model lists |
| `contextBuilder.ts` | Three-tier context assembly (Direct → TF-IDF → Scout) |
| `geminiNative.ts` | Native Gemini REST API fallback when the OpenAI-compatible endpoint is unreliable; uses `tauri-plugin-http` for CORS-free fetch in production |

## Backend (Rust)

All IPC commands live in `src-tauri/src/main.rs`. Key responsibilities:

- Vault lifecycle (open, create, convert foreign vaults)
- File CRUD (save, read, create, delete, rename, move)
- Smart context for AI (file summaries, batch content reads)
- Vault-wide search and replace
- File-system watcher (structural changes only)
- Persona/settings persistence (OS app-data directory)
- Native folder picker dialog (async, deadlock-safe)

Two managed state structs, keyed by Tauri window label for multi-window isolation:
- `CurrentVault` — vault path per window (used for boundary enforcement)
- `WatcherState` — holds each window's FS watcher

See [specs/Architecture.md](../specs/Architecture.md) for the full reference.
