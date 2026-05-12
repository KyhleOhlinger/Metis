# Metis Wiki

Welcome to the Metis developer wiki. Metis is a local-first, AI-augmented personal knowledge ecosystem built with Tauri v2 (Rust) and React/TypeScript.

## Quick Links

- [Getting Started](Getting-Started)
- [Architecture Overview](Architecture-Overview)
- [Architecture Review (May 2026)](Architecture-Review-2026-05)
- [Runtime Model](Runtime-Model)
- [Data Model and Vault Contract](Data-Model-And-Vault)
- [Tauri Backend](Tauri-Backend)
- [Security Model](Security-Model)
- [Planner Module](Planner-Module)
- [Search and Replace](Search-and-Replace)
- [AI Subsystem](AI-Subsystem)
- [Editor Extensions](Editor-Extensions)
- [Build and Release](Build-And-Release)
- [Operations](Operations)
- [Troubleshooting](Troubleshooting)
- [Contributing](Contributing)

## Audience

- The wiki is developer-focused and describes architecture, runtime behavior, and maintenance workflows.
- End-user guidance lives in the in-app help page (`public/help.html`).

## Tech Stack

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
| AI SDK | openai (OpenAI-compatible) + native Gemini REST fallback |

## Project Structure

```
Metis/
├── src/                              # React/TypeScript frontend
│   ├── components/                   # UI components
│   │   ├── Editor.tsx                # CodeMirror host, header bar, theme picker
│   │   ├── editorExtensions.ts       # All CM6 extensions
│   │   ├── Sidebar.tsx               # File tree, drag-and-drop, persona sidebar
│   │   ├── CommandCenter.tsx         # Right panel (Info / AI / Settings tabs)
│   │   ├── EditorFindBar.tsx         # Custom in-editor find & replace bar (Cmd+F / Cmd+R)
│   │   ├── SearchPanel.tsx           # Vault-wide search & replace
│   │   ├── CommandPalette.tsx        # Cmd+P fuzzy note switcher
│   │   ├── PersonaCreator.tsx        # Persona create/edit modal
│   │   ├── ModelPicker.tsx           # Combobox for AI model selection
│   │   ├── QuickActionsSettings.tsx  # Selection toolbar action customisation
│   │   ├── ConvertVaultModal.tsx     # Foreign vault → Metis vault conversion
│   │   ├── SelectionToolbar.tsx      # Floating AI toolbar on text selection
│   │   ├── Toolbar.tsx               # Markdown formatting toolbar
│   │   ├── spellcheck.ts             # CM6 lint-based spellcheck integration
│   │   ├── MarkdownPreview.tsx       # HTML visual preview tab
│   │   ├── DailyTaskGrid.tsx         # Planner mode (daily/weekly/monthly/templates/tracker)
│   │   ├── MetadataPanel.tsx         # YAML frontmatter panel
│   │   ├── ContextMenu.tsx           # Right-click context menu
│   │   └── CreateVaultModal.tsx      # New vault dialog
│   ├── services/
│   │   ├── aiService.ts              # AI gateway (streaming, tool calls, connection test)
│   │   ├── contextBuilder.ts         # Tiered context assembly
│   │   └── geminiNative.ts           # Native Gemini REST API fallback
│   ├── store/
│   │   ├── useStore.ts               # Zustand store — vault, editor, UI state
│   │   └── usePersonaStore.ts        # Zustand store — personas, settings, history
│   ├── types/
│   │   └── persona.ts                # Persona, Settings, QuickAction, ExecutionScope types
│   ├── utils/
│   │   ├── treeUtils.ts              # In-memory file tree helpers
│   │   └── resolveWikilinkAsset.ts   # Vault-wide asset path resolution
│   └── hooks/
│       └── useMenuEvents.ts          # Native menu-bar event bridge
├── src-tauri/                        # Tauri/Rust backend
│   ├── src/main.rs                   # All Tauri commands + FS watcher
│   ├── Cargo.toml
│   ├── tauri.conf.json               # App config, CSP, asset protocol
│   └── capabilities/default.json     # Tauri v2 permission grants
├── public/                           # Static assets (help.html, help.js)
├── specs/                            # Product specifications & architecture docs
└── wiki/                             # Developer wiki (this directory)
```
