/** Core CodeMirror plugins: code blocks, callouts, visual mode, keymaps, paste, frontmatter. */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, EditorState } from "@codemirror/state";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { resolveWikilinkAssetPath } from "@/utils/resolveWikilinkAsset";
import { normalizePosixPath, isPathWithinVault } from "@/utils/paths";
import { resolveMarkdownImageSrc } from "@/utils/vaultImages";
import { selectionIntersectsRange } from "./editorPluginUtils";

// ── 2. Code block background + language badge + copy button ──────────────────

/** Combined widget shown at the right end of the opening fence line. */
class CodeFenceActionsWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
  ) {
    super();
  }
  eq(other: CodeFenceActionsWidget) {
    return other.code === this.code && other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-code-fence-actions";

    // Language badge (e.g. "typescript")
    if (this.lang) {
      const badge = document.createElement("span");
      badge.className = "cm-code-lang-badge";
      badge.textContent = this.lang.toLowerCase();
      wrap.appendChild(badge);
    }

    // Copy button
    const btn = document.createElement("button");
    btn.className = "cm-copy-btn";
    btn.textContent = "Copy";
    btn.title = "Copy code to clipboard";
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        btn.textContent = "✓ Copied";
        btn.classList.add("cm-copy-btn--copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("cm-copy-btn--copied");
        }, 1800);
      });
    });
    wrap.appendChild(btn);

    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

/** Line decoration applied to every line inside a fenced code block. */
function buildCodeBlockDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;

  syntaxTree(state).cursor().iterate((node) => {
    if (node.name !== "FencedCode") return;

    const firstLine = state.doc.lineAt(node.from);
    // node.to is exclusive; back up one char to stay inside the closing fence
    const endPos = node.to > node.from ? node.to - 1 : node.from;
    const lastLine = state.doc.lineAt(endPos);

    for (let i = firstLine.number; i <= lastLine.number; i++) {
      const line = state.doc.line(i);
      const classes = ["cm-code-block-line"];
      if (i === firstLine.number) classes.push("cm-code-block-first");
      if (i === lastLine.number) classes.push("cm-code-block-last");
      builder.add(
        line.from,
        line.from,
        Decoration.line({ attributes: { class: classes.join(" ") } }),
      );
    }
  });
  return builder.finish();
}

/** Widget decorations: language badge + copy button on the opening fence. */
function buildFenceActionDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(view.state).cursor().iterate((node) => {
    if (node.name !== "FencedCode") return;
    const { state } = view;
    const openFenceLine = state.doc.lineAt(node.from);

    // Extract language identifier from the opening fence (e.g. ```typescript)
    const fenceText = state.sliceDoc(node.from, openFenceLine.to);
    const langMatch = fenceText.match(/^[`~]+(\S+)/);
    const lang = langMatch ? langMatch[1] : "";

    // Extract the code body (lines between fences)
    const fullText = state.sliceDoc(node.from, node.to);
    const lines = fullText.split("\n");
    const lastTrimmed = lines[lines.length - 1].trimStart();
    const hasClosingFence =
      lastTrimmed.startsWith("```") || lastTrimmed.startsWith("~~~");
    const code = lines
      .slice(1, hasClosingFence ? -1 : undefined)
      .join("\n")
      .trim();

    builder.add(
      openFenceLine.to,
      openFenceLine.to,
      Decoration.widget({
        widget: new CodeFenceActionsWidget(code, lang),
        side: 1,
      }),
    );
  });
  return builder.finish();
}

/** Applies a darker background to all lines inside fenced code blocks. */
export const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged)
        this.decorations = buildCodeBlockDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Renders language badge + copy button on the opening fence line. */
export const copyButtonPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildFenceActionDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged)
        this.decorations = buildFenceActionDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── 3. Callout blocks  > [!TYPE] ─────────────────────────────────────────────

const CALLOUT_RE =
  /^>\s*\[!(INFO|NOTE|TIP|WARNING|DANGER|CAUTION|IMPORTANT|SUCCESS|QUESTION|FAILURE|BUG|EXAMPLE|QUOTE)\]/i;

function buildCalloutDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  let inCallout = false;
  let calloutType = "";

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(CALLOUT_RE);

    if (match) {
      inCallout = true;
      calloutType = match[1].toLowerCase();
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          attributes: {
            class: `cm-callout cm-callout-header cm-callout-${calloutType}`,
          },
        }),
      );
    } else if (inCallout && line.text.startsWith(">")) {
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          attributes: {
            class: `cm-callout cm-callout-body cm-callout-${calloutType}`,
          },
        }),
      );
    } else {
      inCallout = false;
      calloutType = "";
    }
  }
  return builder.finish();
}

export const calloutPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCalloutDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged)
        this.decorations = buildCalloutDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── 4. Visual mode — dim syntax markers + render images inline ────────────────

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-image-widget";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-image-widget-img";
    img.addEventListener("error", () => {
      img.style.display = "none";
      const fallback = document.createElement("span");
      fallback.className = "cm-image-widget-fallback";
      fallback.textContent = `⚠ Image not found: ${this.alt || this.src}`;
      wrap.appendChild(fallback);
    });
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function resolveImageSrc(rawSrc: string, activeFilePath: string, vaultPath: string): string {
  if (/^https?:\/\/|^data:/i.test(rawSrc)) return rawSrc;
  const dir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/"));
  return resolveMarkdownImageSrc(rawSrc, vaultPath, dir);
}

// Use vault-wide asset resolution for wikilink images so that Obsidian vaults
// work without manual path adjustments.
function resolveWikiSrc(filename: string, vaultPath: string): string {
  const { assetIndex } = useStore.getState();
  const resolved = normalizePosixPath(
    resolveWikilinkAssetPath(filename, assetIndex, vaultPath),
  );
  if (!isPathWithinVault(resolved, vaultPath)) return "";
  return convertFileSrc(resolved);
}

// Node types whose text should be dimmed when the cursor is not on the same line
const DIM_NODE_NAMES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
]);

// Wikilink image pattern — only match common image extensions
const WIKI_IMAGE_RE =
  /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi;

function buildVisualDecorations(
  view: EditorView,
  activeFilePath: string,
  vaultPath: string,
): DecorationSet {
  const { state } = view;
  const cursorHead = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursorHead).number;

  // Collect into a plain array so we can sort before handing to the builder
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];

  // ── Syntax-tree pass: dim punctuation and replace standard images ────────
  syntaxTree(state).cursor().iterate((node) => {
    // Skip nodes entirely outside the current viewport for performance
    if (node.to < view.viewport.from || node.from > view.viewport.to)
      return false;

    const nodeLine = state.doc.lineAt(node.from).number;
    const onCursorLine = nodeLine === cursorLine;

    // Dim markdown syntax markers when the cursor is on another line
    if (!onCursorLine && DIM_NODE_NAMES.has(node.name)) {
      ranges.push({
        from: node.from,
        to: node.to,
        deco: Decoration.mark({ class: "cm-md-syntax-dim" }),
      });
    }

    // Replace ![alt](url) with an inline image when cursor is not inside it
    if (node.name === "Image") {
      const { from, to } = node;
      if (!selectionIntersectsRange(state.selection, from, to)) {
        const text = state.sliceDoc(from, to);
        const m = text.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (m) {
          const src = resolveImageSrc(m[2], activeFilePath, vaultPath);
          ranges.push({
            from,
            to,
            deco: Decoration.replace({ widget: new ImageWidget(src, m[1]) }),
          });
        }
      }
    }
  });

  // ── Raw-text pass: handle ![[wikilink]] images (non-standard syntax) ─────
  const vpFrom = view.viewport.from;
  const vpTo = view.viewport.to;
  const vpText = state.sliceDoc(vpFrom, vpTo);
  WIKI_IMAGE_RE.lastIndex = 0;
  let wm: RegExpExecArray | null;
  while ((wm = WIKI_IMAGE_RE.exec(vpText)) !== null) {
    const from = vpFrom + wm.index;
    const to = from + wm[0].length;
    if (!selectionIntersectsRange(state.selection, from, to)) {
      const src = resolveWikiSrc(wm[1], vaultPath);
      ranges.push({
        from,
        to,
        deco: Decoration.replace({ widget: new ImageWidget(src, wm[1]) }),
      });
    }
  }

  // Sort ascending by (from, to) — required by RangeSetBuilder
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

/**
 * Factory: returns a ViewPlugin configured for the currently open file.
 * Re-create this by calling with fresh paths when the active file changes
 * (or use a Compartment to swap it in without recreating the whole editor).
 */
export function createVisualModePlugin(
  activeFilePath: string,
  vaultPath: string,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildVisualDecorations(
          view,
          activeFilePath,
          vaultPath,
        );
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = buildVisualDecorations(
            u.view,
            activeFilePath,
            vaultPath,
          );
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ── 5. Markdown auto-complete (pairs, fences, selection wrapping) ─────────────

/**
 * Smart auto-completion for Markdown syntax:
 *
 *  `` ` ``        — third backtick at line-start creates a full code fence
 *                    (inserts ```\n\n``` and places cursor on the blank line)
 *  `` ` ``        — wraps an active selection in inline backticks
 *  `[`            — auto-pairs as `[]`, or wraps selection as `[sel]`
 *  `]`            — skips over an auto-inserted closing `]`
 *  `(`            — auto-pairs as `()` when typed immediately after `]`
 *                    (completing a markdown link: `[text](|)`)
 *  `)`            — skips over an auto-inserted closing `)`
 *  `*`            — wraps an active selection as `**sel**` (bold)
 *  `_`            — wraps an active selection as `_sel_` (italic)
 *  Backspace      — deletes both characters of an empty `[]` or `()` pair
 */
export const markdownAutoComplete = keymap.of([
  // ── Backtick: code fence + inline-code wrapping ──────────────────────────
  {
    key: "`",
    run(view) {
      const { state } = view;
      const { from, to, empty } = state.selection.main;

      // Wrap selection in inline backticks: `selection`
      if (!empty) {
        const sel = state.sliceDoc(from, to);
        view.dispatch({
          changes: { from, to, insert: `\`${sel}\`` },
          selection: { anchor: from + 1, head: to + 1 },
        });
        return true;
      }

      const line = state.doc.lineAt(from);
      const before = state.sliceDoc(line.from, from);

      // Third backtick at the start of a line → full fenced code block.
      // Replace the two already-typed backticks + add the third + closing fence.
      if (/^[ \t]*``$/.test(before)) {
        const fenceStart = from - 2; // position of the first existing backtick
        view.dispatch({
          changes: { from: fenceStart, to: from, insert: "```\n\n```" },
          // Place cursor on the blank middle line, ready to write code
          selection: { anchor: fenceStart + 4 },
        });
        return true;
      }

      // Let the default handler insert a single backtick in all other cases
      return false;
    },
  },

  // ── `[` — bracket pair + selection wrap ─────────────────────────────────
  {
    key: "[",
    run(view) {
      const { state } = view;
      const { from, to, empty } = state.selection.main;

      if (!empty) {
        // Wrap selection: [selected text]
        const sel = state.sliceDoc(from, to);
        view.dispatch({
          changes: { from, to, insert: `[${sel}]` },
          selection: { anchor: from + 1, head: to + 1 },
        });
        return true;
      }

      // Auto-pair: [] with cursor inside
      view.dispatch({
        changes: { from, insert: "[]" },
        selection: { anchor: from + 1 },
      });
      return true;
    },
  },

  // ── `]` — skip over auto-inserted closing bracket ───────────────────────
  {
    key: "]",
    run(view) {
      const { state } = view;
      const { from, empty } = state.selection.main;
      if (empty && state.sliceDoc(from, from + 1) === "]") {
        view.dispatch({ selection: { anchor: from + 1 } });
        return true;
      }
      return false;
    },
  },

  // ── `(` — complete a markdown link [text](|) ────────────────────────────
  {
    key: "(",
    run(view) {
      const { state } = view;
      const { from, empty } = state.selection.main;
      if (!empty) return false;
      // Only auto-pair when immediately after a closing bracket
      const prevC = from > 0 ? state.sliceDoc(from - 1, from) : "";
      if (prevC !== "]") return false;
      view.dispatch({
        changes: { from, insert: "()" },
        selection: { anchor: from + 1 },
      });
      return true;
    },
  },

  // ── `)` — skip over auto-inserted closing paren ─────────────────────────
  {
    key: ")",
    run(view) {
      const { state } = view;
      const { from, empty } = state.selection.main;
      if (empty && state.sliceDoc(from, from + 1) === ")") {
        view.dispatch({ selection: { anchor: from + 1 } });
        return true;
      }
      return false;
    },
  },

  // ── `*` — wrap selection in bold (**sel**) ───────────────────────────────
  {
    key: "*",
    run(view) {
      const { state } = view;
      const { from, to, empty } = state.selection.main;
      if (empty) return false; // Never interfere with list bullets or lone *
      const sel = state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: `**${sel}**` },
        selection: { anchor: from + 2, head: to + 2 },
      });
      return true;
    },
  },

  // ── `_` — wrap selection in italic (_sel_) ───────────────────────────────
  {
    key: "_",
    run(view) {
      const { state } = view;
      const { from, to, empty } = state.selection.main;
      if (empty) return false;
      const sel = state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: `_${sel}_` },
        selection: { anchor: from + 1, head: to + 1 },
      });
      return true;
    },
  },

  // ── Backspace — delete both chars of an empty [] or () pair ─────────────
  {
    key: "Backspace",
    run(view) {
      const { state } = view;
      const { from, empty } = state.selection.main;
      if (!empty || from < 1) return false;
      const prev = state.sliceDoc(from - 1, from);
      const next = state.sliceDoc(from, from + 1);
      if (
        (prev === "[" && next === "]") ||
        (prev === "(" && next === ")")
      ) {
        view.dispatch({
          changes: { from: from - 1, to: from + 1 },
          selection: { anchor: from - 1 },
        });
        return true;
      }
      return false;
    },
  },
]);

// ── 8. List continuation on Enter ────────────────────────────────────────────

/**
 * When Enter is pressed inside a Markdown list item, the next line
 * automatically starts with the same list prefix:
 *   - Bullet:    `- ` / `* ` / `+ `
 *   - Task:      `- [ ] `  (always unchecked on the new line)
 *   - Ordered:   increments the number  (`1. ` → `2. `)
 *
 * Pressing Enter on a line whose list content is empty exits the list
 * (removes the prefix and leaves a blank line).
 */
export const listContinuationKeymap = keymap.of([
  {
    key: "Enter",
    run(view) {
      const { state } = view;
      const { from, to } = state.selection.main;
      const line = state.doc.lineAt(from);
      const text = line.text;

      // Task list must be checked before bullet (task is a sub-pattern of bullet)
      const taskMatch = text.match(/^([ \t]*)([-*+])\s+\[([ xX])\] ?/);
      const bulletMatch = !taskMatch ? text.match(/^([ \t]*)([-*+]) /) : null;
      const orderedMatch =
        !taskMatch && !bulletMatch
          ? text.match(/^([ \t]*)(\d+)\. /)
          : null;

      const match = taskMatch ?? bulletMatch ?? orderedMatch;

      if (match) {
        const prefixLen = match[0].length;

        // Don't intercept if cursor is within the list marker itself
        if (from < line.from + prefixLen) return false;

        const contentAfterPrefix = text.slice(prefixLen);

        // Empty item → outdent if indented, remove marker if at root
        if (!contentAfterPrefix.trim()) {
          const indent = match[1].length;
          if (indent > 0) {
            const rm = Math.min(4, indent);
            view.dispatch({
              changes: { from: line.from, to: line.from + rm },
            });
          } else {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: "" },
              selection: { anchor: line.from },
            });
          }
          return true;
        }

        // Build the new prefix for the continued line
        let newPrefix: string;
        if (taskMatch) {
          newPrefix = `${taskMatch[1]}${taskMatch[2]} [ ] `;
        } else if (bulletMatch) {
          newPrefix = `${bulletMatch[1]}${bulletMatch[2]} `;
        } else if (orderedMatch) {
          const nextNum = parseInt(orderedMatch[2], 10) + 1;
          newPrefix = `${orderedMatch[1]}${nextNum}. `;
        } else {
          return false;
        }

        view.dispatch({
          changes: { from, to, insert: `\n${newPrefix}` },
          selection: { anchor: from + 1 + newPrefix.length },
        });
        return true;
      }

      return false;
    },
  },
]);

// ── 10. Smart paste ──────────────────────────────────────────────────────────

/**
 * Intercepts paste events in the editor:
 *
 *  1. **Image data** — if clipboard contains an image (e.g. a screenshot),
 *     save it to `<vault>/assets/` via the Rust `save_asset` command and insert
 *     `![filename](assets/filename.png)` at the cursor position.
 *
 *  2. **URL over selection** — if the user pastes a URL while text is selected,
 *     wrap the selection as a Markdown link: `[selected text](url)`.
 */
export const smartPasteExtension = EditorView.domEventHandlers({
  paste(event, view) {
    const items = event.clipboardData?.items;
    const { from, to } = view.state.selection.main;
    const selectedText = from !== to ? view.state.sliceDoc(from, to) : "";

    // ── Priority 1: image from clipboard ──────────────────────────────────
    if (items) {
      for (const item of Array.from(items)) {
        if (!item.type.startsWith("image/")) continue;

        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return false;

        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          // Strip the data URI prefix to get the raw base64 payload
          const base64 = dataUrl.split(",")[1];
          if (!base64) return;

          const rawExt = item.type.split("/")[1]?.split(";")[0] ?? "png";
          // Normalise common MIME sub-types
          const ext = rawExt === "jpeg" ? "jpg" : rawExt;
          const filename = `image-${Date.now()}.${ext}`;

            const { vaultPath, defaultImageFolder } = useStore.getState();
            if (!vaultPath) {
              toastError("Open a vault before pasting an image.");
              return;
            }

            try {
              const relPath = await invoke<string>("save_asset", {
                vaultPath,
                filename,
                dataBase64: base64,
                imageSubdir: defaultImageFolder,
              });
            view.dispatch({
              changes: { from, to, insert: `![${filename}](${relPath})` },
              selection: { anchor: from + filename.length + relPath.length + 5 },
            });
          } catch (err) {
            toastError(`Failed to save pasted image: ${String(err)}`);
          }
        };
        reader.readAsDataURL(file);
        return true;
      }
    }

    // ── Priority 2: URL pasted over selected text ──────────────────────────
    const clipText = (event.clipboardData?.getData("text/plain") ?? "").trim();
    if (selectedText && /^https?:\/\/\S+$/.test(clipText)) {
      event.preventDefault();
      view.dispatch({
        changes: { from, to, insert: `[${selectedText}](${clipText})` },
        selection: {
          anchor: from + selectedText.length + clipText.length + 4,
        },
      });
      return true;
    }

    return false;
  },
});

// ── Frontmatter-aware line numbers ───────────────────────────────────────────

function frontmatterLineCount(state: EditorState): number {
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 4_000));
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return 0;
  // Count newlines inside the matched block to get the number of hidden lines
  return (match[0].match(/\n/g) ?? []).length;
}

export const metisLineNumbers = lineNumbers({
  formatNumber(lineNo, state) {
    const fmLines = frontmatterLineCount(state);
    if (lineNo <= fmLines) return ""; // blank gutter for hidden frontmatter rows
    return String(lineNo - fmLines);  // restart counting from 1
  },
});

// ── Frontmatter hider ─────────────────────────────────────────────────────────
//
// YAML frontmatter (`---\n...\n---`) is the on-disk storage for metadata that
// the MetadataPanel exposes as a polished UI.  Showing the raw YAML block in
// the editor is redundant and clutters the writing area, so we hide it with a
// replace decoration.  The data is never deleted — it remains in the file.
//
// Uses a StateField (not a ViewPlugin) because replace decorations that span
// multiple lines must be provided via StateField to satisfy CM6's constraint:
// "Block decorations may not be specified via plugins."

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function buildFrontmatterDeco(state: EditorState): DecorationSet {
  // Only scan the first 4 000 characters — frontmatter is always at the very
  // top of the file, so there is no need to examine large documents fully.
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 4_000));
  const match = text.match(FRONTMATTER_RE);
  if (!match) return Decoration.none;
  return Decoration.set([Decoration.replace({}).range(0, match[0].length)]);
}

export const hideFrontmatterField = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterDeco(state);
  },
  update(decos, tr) {
    if (!tr.docChanged) return decos;
    return buildFrontmatterDeco(tr.state);
  },
  provide(f) {
    return EditorView.decorations.from(f);
  },
});
