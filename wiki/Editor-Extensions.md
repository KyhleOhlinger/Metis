# Editor Extensions

All CodeMirror 6 extensions are defined in `src/components/editorExtensions.ts` and wired in `src/components/Editor.tsx`.

## Extension Inventory

| Export | Source | Purpose |
|--------|--------|---------|
| `metisHighlightStyleDark` | editorExtensions.ts | GFM syntax highlighting (dark themes) |
| `metisHighlightStyleLight` | editorExtensions.ts | GFM syntax highlighting (light themes) |
| `metisHighlightStyle` | editorExtensions.ts | Re-export — alias for the dark variant (backward compat) |
| `metisLineNumbers` | editorExtensions.ts | Custom gutter line numbers styled to match active theme |
| `codeBlockPlugin` | editorExtensions.ts | Background + left-border decoration on fenced code blocks |
| `copyButtonPlugin` | editorExtensions.ts | Language badge + hover Copy button on code fence opening line |
| `calloutPlugin` | editorExtensions.ts | Obsidian-style `> [!TYPE]` callout blocks with coloured left borders |
| `wikilinkExtensions` | editorExtensions.ts | `[[` autocomplete (names + aliases), `/` slash menu, decorations, Cmd+Click handler |
| `markdownLinkCollapseExtension` | editorExtensions.ts | Collapses `[Display](url)` to a display-name token with `data-md-link-href` for Cmd/Ctrl+click in source mode; auto-expands on cursor entry for editing |
| `taskListClickExtension` | editorExtensions.ts | Decorates task markers and toggles `[ ]` / `[x]` on click in source mode |
| `listContinuationKeymap` | editorExtensions.ts | Enter continues bullet/task/ordered lists; empty indented item outdents, empty root item exits |
| `makeInlinePreviewExtension` | editorExtensions.ts | Inline `<img>` + reveal-in-Finder menu for local paths; GFM pipe tables collapse to HTML preview when the caret leaves the table (click preview to edit); Cmd/Ctrl+click link following |
| `smartPasteExtension` | editorExtensions.ts | Clipboard image → `save_asset` + `![](assets/...)`; URL over selection → Markdown link |
| `markdownAutoComplete` | editorExtensions.ts | Auto-close pairs: ` ``` `, `**`, `_`, `` ` ``, `[]()` |
| `hideFrontmatterField` | editorExtensions.ts | Decorates YAML frontmatter fields for MetadataPanel integration |
| `createVisualModePlugin` | editorExtensions.ts | Factory function for the visual mode ViewPlugin (handles preview overlay coordination) |
| `search()` | @codemirror/search | Provides match highlighting state; the built-in panel is replaced by `EditorFindBar.tsx` (Cmd+F / Cmd+R) |

## Dynamic Theming

Background colour presets (Dark, Black, Slate, Purple, Pink, White, Cream) are hot-swapped via a CM6 `Compartment` (`bgCompartment` in `Editor.tsx`) without destroying the editor, preserving cursor position, undo history, and scroll state.

The highlight style is also theme-aware: `metisHighlightStyleDark` is used for dark backgrounds, `metisHighlightStyleLight` for light backgrounds (White, Cream).

## Spellcheck

Spellcheck is implemented using `@codemirror/lint` with a Tauri backend powered by `spellbook` (a pure Rust Hunspell-compatible library from the Helix editor team). It is toggled via `spellcheckCompartment` in `Editor.tsx`. The toggle button lives in the formatting Toolbar and persists its state to `localStorage` (`metis_spellcheck`).

**Architecture:**
- `src/components/spellcheck.ts` exports `spellcheckLinter(language)` — a CM6 async linter
- The linter extracts prose words from the document, using the CM6 syntax tree to skip code blocks, frontmatter, inline code, URLs, and other non-prose nodes
- Unique words are sent in a batch to the Rust `check_spelling` Tauri command with the selected language code
- The Rust backend loads Hunspell `.aff` + `.dic` dictionary files from `resources/dictionaries/<lang>/` using the `spellbook` crate, which performs full morphological analysis (plurals, verb conjugations, contractions, compound words, etc.)
- Dictionaries are loaded lazily and cached in a `Mutex<HashMap<String, Dictionary>>` for the process lifetime
- Results are cached on the client side (`knownGood` / `knownBad` sets) to minimize IPC; cache resets when the language changes
- Misspelled words are shown with wavy yellow underlines via CSS overrides on `.cm-lintRange-warning`
- The linter uses a 500ms debounce to avoid excessive checks while typing

**Spelling suggestions:**
- After identifying misspelled words, the linter fetches suggestions in a single batch call to the Rust `suggest_spelling` Tauri command (up to 5 suggestions per word, max 50 words per call)
- Each `Diagnostic` includes `actions` — clickable buttons rendered inside the CM6 lint tooltip
- Hovering a misspelled word shows a styled tooltip with the message (including up to 3 inline suggestions) and action buttons for all available suggestions
- Clicking a suggestion replaces the misspelled word with case-preserving logic (matches uppercase, title case, or lowercase)
- Suggestions are cached per-language in a `suggestionCache` map on the client side; the cache resets when the dictionary language changes

**Dictionary selection:**
- Users choose their dictionary in Settings → Spellcheck (en_US or en_GB)
- The setting is persisted in `settings.json` as `spellcheckLanguage`
- Dictionaries ship as bundled Tauri resources in `src-tauri/resources/dictionaries/`
- The `list_dictionaries` Tauri command scans available dictionary directories

## Source Mode vs. Visual Mode

- **Source mode** — CodeMirror is visible; `Toolbar` and `SelectionToolbar` are active; `makeInlinePreviewExtension` renders `<img>` elements as block widgets below image markdown lines.
- **Visual mode** — CodeMirror is hidden (`opacity: 0`, `pointer-events: none`) but remains mounted so state is preserved; `MarkdownPreview` is overlaid. The preview converts markdown to HTML via `marked`, sanitises with DOMPurify, and attaches a unified click handler for wikilinks, external URLs, and task-list checkboxes.

## List Indent/Outdent Behavior

Tab and Shift+Tab have custom handlers in `Editor.tsx` that override CodeMirror's defaults for Markdown list editing:

### Tab Key
- **List item (single cursor):** Inserts 4 spaces at the line start so the bullet marker and text shift together. CM6 auto-maps the cursor forward.
- **Plain text (single cursor):** Inserts 4 spaces at the cursor position with an explicit selection update.
- **Multi-line selection:** Indents all touched lines by 4 spaces at line start.

### Shift+Tab Key
- **Indented list item (indent > 0):** Removes up to 4 leading spaces from the current line **and** all contiguous child lines (lines immediately following with strictly greater indentation). Children move with the parent to preserve hierarchy. Blank lines within a child block are skipped but included in the range.
- **Root-level list item, cursor at column 0:** Removes the bullet marker (`- `, `* `, `+ `, `1. `, `- [ ] `, etc.) entirely, converting to plain text.
- **Root-level list item, cursor past column 0 with content:** Consumes the keypress but does nothing (already at minimum indent). If the line is empty (just the marker with no content after it), the marker is still removed regardless of cursor position.
- **Non-list line:** Removes up to 4 leading spaces from all touched lines (generic outdent).

### Enter Key (`listContinuationKeymap` in `editorExtensions.ts`)
- **List item:** Continues the list prefix on the new line (bullet, task checkbox, or incremented ordered number). If the item is empty (only the marker): outdents by one level if indented; removes the marker entirely at root level.
- **Non-list line:** Inserts a plain newline with cursor at column 0 — does not inherit indentation from the previous line.

### Task Due Date Convention
- Task items support an optional due date marker in plain markdown text: `(due: YYYY-MM-DD)`.
- Slash menu includes `Task List (with Due Date)` to insert a task scaffold quickly.

### Task Marker Click (`taskListClickExtension` in `editorExtensions.ts`)
- Task markers are decorated with a `data-task-checkbox` attribute in the visible viewport.
- Clicking a marker toggles the checkbox character in-place (`[ ]` ↔ `[x]`) using a single CodeMirror transaction.
- Works for both unordered (`-`, `*`, `+`) and ordered (`1.`) Markdown list prefixes.

### Collapsed Markdown Links (`markdownLinkCollapseExtension` in `editorExtensions.ts`)
- Standard markdown links (`[Display Name](URL)`) are rendered as a compact token that shows only `Display Name`.
- The rendered token is styled with a single blue underline.
- The URL and markdown brackets are hidden only at render time; underlying source text is unchanged.
- When the cursor/selection enters the link range, collapse is disabled so the full markdown syntax appears for manual edits.
- Image markdown (`![alt](src)`) is excluded from this collapse behavior.

### Toolbar List Toggles (`Toolbar.tsx`)
- **Bullet / Ordered / Task list icons:** Use prefix-only `ChangeSpec` operations (insert or delete at line start) rather than full-line replacements. This ensures `ChangeSet.mapPos` correctly positions the cursor after the new prefix. `dispatchListChanges` uses `mapPos(pos, 1)` (forward association) so the cursor lands after the marker, not at position 0.

## Adding New Extensions

1. Export from `editorExtensions.ts`
2. Include in the `extensions` array in `Editor.tsx`
3. Use the `Compartment` pattern for any extension that needs hot-swappable configuration
