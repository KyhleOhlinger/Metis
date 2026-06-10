/** CodeMirror plugins for the Metis markdown editor. */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, EditorState, EditorSelection, type Text } from "@codemirror/state";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { useStore } from "@/store/useStore";
import { resolveWikilinkAssetPath } from "@/utils/resolveWikilinkAsset";
import { normalizePosixPath, isPathWithinVault } from "@/utils/paths";
import {
  followVaultHref,
  openNoteByWikilinkNameFromStore,
  revealPlatformLabel,
} from "@/utils/vaultNavigation";
import {
  resolveMarkdownImageAbsPath,
  resolveMarkdownImageSrc,
} from "@/utils/vaultImages";
import { escapeHtml } from "@/utils/markdownHtml";
import { openDomContextMenu } from "@/utils/domContextMenu";
import {
  METIS_STICKY_MIME,
  buildDefaultStickySlashInsert,
  DEFAULT_STICKY_PLACEHOLDER,
  insertStickyNoteAt,
  parseStickyDragPayload,
} from "@/utils/stickyNotes";

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

function escapeHtmlCell(s: string): string {
  return escapeHtml(s);
}

function resolveImageSrc(rawSrc: string, activeFilePath: string, vaultPath: string): string {
  if (/^https?:\/\/|^data:/i.test(rawSrc)) return rawSrc;
  const dir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/"));
  return resolveMarkdownImageSrc(rawSrc, vaultPath, dir);
}

function sourceLinkMenuItems(href: string, fileDir: string, vaultPath: string) {
  const trimmed = href.trim();
  const label = /^https?:\/\//i.test(trimmed) ? "Open Link" : "Open Note";
  return [
    {
      label,
      onClick: () => followVaultHref(trimmed, { fileDir, vaultPath }),
    },
  ];
}

function sourceImageRevealMenuItems(
  src: string,
  fileDir: string,
  vaultPath: string,
): Array<{ label: string; onClick: () => void }> | null {
  const absPath = resolveMarkdownImageAbsPath(src, vaultPath, fileDir);
  if (!absPath) return null;
  return [
    {
      label: revealPlatformLabel(),
      onClick: () => {
        invoke("reveal_in_finder", { path: absPath, vaultPath }).catch(console.error);
      },
    },
  ];
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
      const cursorInside =
        state.selection.main.from <= to && state.selection.main.to >= from;
      if (!cursorInside) {
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
    const cursorInside =
      state.selection.main.from <= to && state.selection.main.to >= from;
    if (!cursorInside) {
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

// ── 6. WikiLink autocomplete + clickable [[links]] ────────────────────────────

/**
 * Completion source for [[wikilinks]].
 * Reads noteIndex from the store at call-time — no stale closures.
 */
function wikilinkCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  // Match [[ followed by any non-bracket characters up to the cursor
  const match = context.matchBefore(/\[\[[^\]]*$/);
  if (!match) return null;

  const { noteIndex } = useStore.getState();
  if (!noteIndex.length) return null;

  const query = match.text.slice(2).toLowerCase();

  // Build completion options: match on canonical name OR any YAML alias.
  // When an alias matches, show it as `detail` so the user knows why the note
  // appeared.  The inserted text is always [[canonical name]] so links resolve.
  const makeApplyFn = (noteName: string) =>
    function apply(view: import("@codemirror/view").EditorView, _: unknown, _from: number, to: number) {
      // Consume any trailing ] characters auto-inserted by the [ pair handler.
      let endPos = to;
      while (
        endPos < view.state.doc.length &&
        view.state.sliceDoc(endPos, endPos + 1) === "]"
      ) {
        endPos++;
      }
      view.dispatch({
        changes: { from: match.from, to: endPos, insert: `[[${noteName}]]` },
        selection: { anchor: match.from + noteName.length + 4 },
      });
    };

  const options: { label: string; type: "file"; detail?: string; apply: ReturnType<typeof makeApplyFn> }[] = [];

  for (const n of noteIndex) {
    const nameHit = !query || n.name.toLowerCase().includes(query);
    if (nameHit) {
      options.push({ label: n.name, type: "file", apply: makeApplyFn(n.name) });
      continue;
    }
    // Fall through to alias search only when the name didn't match
    if (n.aliases?.length) {
      const matchedAlias = n.aliases.find((a) => a.toLowerCase().includes(query));
      if (matchedAlias) {
        options.push({
          label: n.name,
          type: "file",
          detail: `alias: ${matchedAlias}`,
          apply: makeApplyFn(n.name),
        });
      }
    }
  }

  return { from: match.from + 2, options, filter: false };
}

/**
 * Builds decorations for every [[wikilink]] in the visible viewport.
 * Each link gets a `cm-wikilink` class + `data-wikilink` attribute used
 * by the click handler below.
 */
function buildWikilinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const WIKI_RE = /\[\[([^\]]+)\]\]/g;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    WIKI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_RE.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      builder.add(
        start,
        end,
        Decoration.mark({
          class: "cm-wikilink",
          attributes: { "data-wikilink": m[1] },
        }),
      );
    }
  }
  return builder.finish();
}

/**
 * Collapses standard markdown links in source mode:
 *   [Display Name](https://example.com)
 * into a compact, styled display-name token while preserving source text.
 *
 * When the cursor/selection intersects a link range, collapse is disabled for
 * that link so users can manually edit full markdown syntax.
 */
function buildMarkdownLinkCollapseDecorations(view: EditorView): DecorationSet {
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  const LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  const sel = view.state.selection.main;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(text)) !== null) {
      // Don't treat image markdown as a collapsed text link: ![alt](url)
      if (m.index > 0 && text[m.index - 1] === "!") continue;

      const fullFrom = from + m.index;
      const fullTo = fullFrom + m[0].length;

      const selectionTouchesLink = sel.from <= fullTo && sel.to >= fullFrom;
      if (selectionTouchesLink) continue;

      const displayFrom = fullFrom + 1; // Skip opening '['
      const displayTo = displayFrom + m[1].length;

      // Hide leading '['
      ranges.push({
        from: fullFrom,
        to: displayFrom,
        deco: Decoration.replace({}),
      });
      // Hide trailing `](url)` section.
      ranges.push({
        from: displayTo,
        to: fullTo,
        deco: Decoration.replace({}),
      });
      // Style visible display name as a single collapsed-link token.
      ranges.push({
        from: displayFrom,
        to: displayTo,
        deco: Decoration.mark({
          class: "cm-markdown-link-collapsed",
          attributes: { "data-md-link-href": m[2].trim() },
        }),
      });
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of ranges) builder.add(from, to, deco);
  return builder.finish();
}

/**
 * Decorates Markdown task checkbox markers (`[ ]` / `[x]`) so clicks can be
 * routed through a precise data attribute instead of brittle coordinate checks.
 */
function buildTaskCheckboxDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const taskRe = /^([ \t]*(?:[-*+]|\d+\.)\s+)(\[[ xX]\])/;

  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).number;
    const endLine = view.state.doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = view.state.doc.line(n);
      const m = line.text.match(taskRe);
      if (!m) continue;
      const markerFrom = line.from + m[1].length;
      const markerTo = markerFrom + m[2].length;
      builder.add(
        markerFrom,
        markerTo,
        Decoration.mark({
          class: "cm-task-checkbox",
          attributes: { "data-task-checkbox": "true" },
        }),
      );
    }
  }

  return builder.finish();
}

const taskCheckboxDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildTaskCheckboxDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildTaskCheckboxDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const markdownLinkCollapsePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMarkdownLinkCollapseDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildMarkdownLinkCollapseDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Click handler: mousedown on task marker toggles `[ ]` ↔ `[x]`.
 */
const taskCheckboxClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const target = event.target as HTMLElement;
    const marker = target.closest("[data-task-checkbox]") as HTMLElement | null;
    if (!marker) return false;

    const pos = view.posAtDOM(marker, 0);
    const line = view.state.doc.lineAt(pos);
    const m = line.text.match(/^([ \t]*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/);
    if (!m) return false;

    event.preventDefault();
    const valueFrom = line.from + m[1].length;
    const valueTo = valueFrom + 1;
    const nextValue = m[2].toLowerCase() === "x" ? " " : "x";

    view.dispatch({
      changes: { from: valueFrom, to: valueTo, insert: nextValue },
      scrollIntoView: false,
    });

    return true;
  },
});

const wikilinkDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildWikilinkDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged)
        this.decorations = buildWikilinkDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Click handler: mousedown on a `.cm-wikilink` element opens the linked note.
 * Reads noteIndex at click-time so it's always fresh.
 */
const wikilinkClickHandler = EditorView.domEventHandlers({
  click(e) {
    if (e.button !== 0) return false;
    const linkEl = (e.target as HTMLElement).closest("[data-wikilink]") as HTMLElement | null;
    if (!linkEl?.dataset.wikilink) return false;

    e.preventDefault();
    e.stopPropagation();
    openNoteByWikilinkNameFromStore(linkEl.dataset.wikilink);
    return true;
  },
});

// ── 7. Slash menu  /command at the start of a line ────────────────────────────

interface SlashItem {
  label: string;
  detail: string;
  section: string;
  insert: string;
  /** Offset from insert start where cursor lands (-1 = end of insert) */
  cursorOffset?: number;
}

const SLASH_ITEMS: SlashItem[] = [
  // Headings
  { label: "Heading 1", detail: "# ",   section: "Headings", insert: "# " },
  { label: "Heading 2", detail: "## ",  section: "Headings", insert: "## " },
  { label: "Heading 3", detail: "### ", section: "Headings", insert: "### " },
  // Lists
  { label: "Bullet List",    detail: "- ",      section: "Lists", insert: "- " },
  { label: "Task List",      detail: "- [ ] ",  section: "Lists", insert: "- [ ] " },
  {
    label: "Task List (with Due Date)",
    detail: "- [ ] Task title (due: YYYY-MM-DD)",
    section: "Lists",
    insert: "- [ ] Task title (due: YYYY-MM-DD)",
    cursorOffset: 6,
  },
  { label: "Numbered List",  detail: "1. ",     section: "Lists", insert: "1. " },
  // Blocks
  {
    label: "Code Block",
    detail: "```",
    section: "Blocks",
    insert: "```\n\n```",
    cursorOffset: 4,   // blank line between fences
  },
  { label: "Blockquote", detail: "> ", section: "Blocks", insert: "> " },
  // Callout types — each inserts > [!TYPE]\n> and lands cursor on the body line
  { label: "Tip",       detail: "> [!TIP]",       section: "Callouts", insert: "> [!TIP]\n> "       },
  { label: "Info",      detail: "> [!INFO]",      section: "Callouts", insert: "> [!INFO]\n> "      },
  { label: "Note",      detail: "> [!NOTE]",      section: "Callouts", insert: "> [!NOTE]\n> "      },
  { label: "Warning",   detail: "> [!WARNING]",   section: "Callouts", insert: "> [!WARNING]\n> "   },
  { label: "Danger",    detail: "> [!DANGER]",    section: "Callouts", insert: "> [!DANGER]\n> "    },
  { label: "Success",   detail: "> [!SUCCESS]",   section: "Callouts", insert: "> [!SUCCESS]\n> "   },
  { label: "Question",  detail: "> [!QUESTION]",  section: "Callouts", insert: "> [!QUESTION]\n> "  },
  { label: "Important", detail: "> [!IMPORTANT]", section: "Callouts", insert: "> [!IMPORTANT]\n> " },
  { label: "Caution",   detail: "> [!CAUTION]",   section: "Callouts", insert: "> [!CAUTION]\n> "   },
  { label: "Failure",   detail: "> [!FAILURE]",   section: "Callouts", insert: "> [!FAILURE]\n> "   },
  { label: "Bug",       detail: "> [!BUG]",       section: "Callouts", insert: "> [!BUG]\n> "       },
  { label: "Example",   detail: "> [!EXAMPLE]",   section: "Callouts", insert: "> [!EXAMPLE]\n> "   },
  { label: "Quote",     detail: "> [!QUOTE]",     section: "Callouts", insert: "> [!QUOTE]\n> "     },
  {
    label: "Sticky Note",
    detail: ":::sticky",
    section: "Blocks",
    insert:
      ':::sticky {float="right" width="12rem" color="amber"}\nJot something down…\n:::\n',
    cursorOffset: 48,
  },
  {
    label: "Sticky + Wrap",
    detail: ":::stickywrap",
    section: "Blocks",
    insert:
      ':::sticky {float="right" width="12rem" color="amber"}\nJot something down…\n:::\n:::stickywrap\nText beside the sticky…\n:::\n',
    cursorOffset: 48,
  },
  // Misc
  { label: "Divider", detail: "---", section: "Misc", insert: "---\n" },
];

function slashMenuCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const textBefore = state.sliceDoc(line.from, pos);

  // Only activate when the line starts with optional whitespace + /
  const m = textBefore.match(/^([ \t]*)\/(\S*)$/);
  if (!m) return null;

  const slashPos = line.from + m[1].length; // position of the /
  const query = m[2].toLowerCase();

  const filtered = SLASH_ITEMS.filter(
    (item) => !query || item.label.toLowerCase().includes(query),
  );
  if (!filtered.length) return null;

  const options = filtered.map((item) => {
    const insert =
      item.label === "Sticky Note" ? buildDefaultStickySlashInsert() : item.insert;
    const isSticky = item.label === "Sticky Note";
    const bodyOffset = isSticky ? insert.indexOf(DEFAULT_STICKY_PLACEHOLDER) : -1;
    return {
      label: item.label,
      detail: item.detail,
      section: item.section,
      type: "text" as const,
      apply(view: EditorView, _c: unknown, _from: number, to: number) {
        const insertPos = slashPos;
        const bodyFrom = bodyOffset >= 0 ? insertPos + bodyOffset : insertPos + insert.length;
        const bodyTo =
          bodyOffset >= 0
            ? bodyFrom + DEFAULT_STICKY_PLACEHOLDER.length
            : insertPos + insert.length;
        view.dispatch({
          changes: { from: insertPos, to, insert },
          selection: EditorSelection.range(bodyFrom, bodyTo),
        });
        view.focus();
      },
    };
  });

  return { from: slashPos + 1, options, filter: false };
}

/**
 * All wikilink extensions bundled together:
 *  - `[[ ` completion dropdown sourced from the note index
 *  - `/command` slash menu for fast block insertion
 *  - Decorates existing [[links]] so they look clickable
 *  - Mousedown handler to open the linked file
 */
export const wikilinkExtensions = [
  autocompletion({
    override: [wikilinkCompletionSource, slashMenuCompletionSource],
    closeOnBlur: true,
  }),
  wikilinkDecoPlugin,
  wikilinkClickHandler,
];

/** Task checkbox UX in source mode: clickable `[ ]` and `[x]` markers. */
export const taskListClickExtension = [taskCheckboxDecoPlugin, taskCheckboxClickHandler];

/** Collapses [text](url) links to display-name tokens in source mode. */
export const markdownLinkCollapseExtension = [markdownLinkCollapsePlugin];

/** Live-preview extensions for planner markdown cells (dim markers, callouts, links, tasks). */
export const plannerMarkdownVisualExtensions = [
  createVisualModePlugin("", ""),
  calloutPlugin,
  ...markdownLinkCollapseExtension,
  ...taskListClickExtension,
];

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

      // Non-list line: plain newline at column 0.  This prevents
      // defaultKeymap's insertNewlineAndIndent from carrying over
      // whitespace from a manually-tabbed line.
      view.dispatch({
        changes: { from, to, insert: "\n" },
        selection: { anchor: from + 1 },
      });
      return true;
    },
  },
]);

// ── 9. Inline preview for source mode ────────────────────────────────────────
//
// Renders actual <img> elements directly below image markdown lines so the
// user doesn't need to switch to the Visual tab to see images.
// Links already receive blue/underline styling via metisHighlightStyle; here
// we also enable Cmd/Ctrl+Click to follow links without leaving source mode.

class InlineImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly revealAbsPath: string | null,
    readonly vaultPath: string,
  ) {
    super();
  }
  eq(other: InlineImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.revealAbsPath === this.revealAbsPath &&
      other.vaultPath === this.vaultPath
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-inline-img-wrap";
    if (this.revealAbsPath) {
      wrap.dataset.revealPath = this.revealAbsPath;
    }
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    // Constrain size; hide silently if the asset fails to load
    img.style.cssText =
      "display:block;max-width:100%;max-height:280px;" +
      "margin:6px 0 10px;border-radius:6px;object-fit:contain;";
    img.onerror = () => {
      img.style.display = "none";
    };
    if (this.revealAbsPath) {
      wrap.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDomContextMenu(e.clientX, e.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => {
              invoke("reveal_in_finder", { path: this.revealAbsPath!, vaultPath: this.vaultPath }).catch(
                console.error,
              );
            },
          },
        ]);
      };
    }
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent(event: Event): boolean {
    return event.type === "contextmenu";
  }
}


// Block decorations MUST come from a StateField, not from a ViewPlugin's
// `decorations` facet (CM6 throws "Block decorations may not be specified
// via plugins" otherwise).  We iterate the whole document so the StateField
// doesn't need viewport access; for typical note lengths this is negligible.
function buildInlineImageDecosFromState(
  state: EditorState,
  vaultPath: string,
  fileDir: string,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;

    // Standard markdown image: ![alt](src)
    const stdM = /!\[([^\]]*)\]\(([^)]+)\)/.exec(text);
    if (stdM) {
      const src = resolveMarkdownImageSrc(stdM[2].trim(), vaultPath, fileDir);
      const revealAbsPath = resolveMarkdownImageAbsPath(stdM[2].trim(), vaultPath, fileDir);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new InlineImageWidget(src, stdM[1], revealAbsPath, vaultPath),
          side: 1,
          block: true,
        }),
      );
      continue;
    }

    // Wikilink image: ![[filename.ext]]
    // Use vault-wide asset resolution (Obsidian-compatible): the file is
    // searched by name across the entire vault, not just the vault root.
    const wikiM = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i.exec(text);
    if (wikiM) {
      const { assetIndex } = useStore.getState();
      // resolveWikilinkAssetPath already normalises the path; validate it
      // still starts with the vault root before converting to asset:// URL.
      const resolvedPath = resolveWikilinkAssetPath(wikiM[1], assetIndex, vaultPath);
      const normalizedPath = normalizePosixPath(resolvedPath);
      if (!isPathWithinVault(normalizedPath, vaultPath)) continue;
      const src = convertFileSrc(normalizedPath);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new InlineImageWidget(src, wikiM[1], normalizedPath, vaultPath),
          side: 1,
          block: true,
        }),
      );
    }
  }

  return builder.finish();
}

// StateField that owns the block image decorations and exposes them via the
// EditorView.decorations facet.  filePath / vaultPath are closed over so the
// field is re-created whenever the active file changes (see Editor.tsx).
function makeImageDecosField(vaultPath: string, filePath: string) {
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
  return StateField.define<DecorationSet>({
    create(state) {
      return buildInlineImageDecosFromState(state, vaultPath, fileDir);
    },
    update(decos, tr) {
      // Rebuild on document changes; remap positions otherwise.
      if (tr.docChanged) {
        return buildInlineImageDecosFromState(tr.state, vaultPath, fileDir);
      }
      return decos.map(tr.changes);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
}

// ── GFM pipe tables: render preview while unfocused (caret outside table) ─────
//
// Mirrors link-collapse UX: raw markdown is editable whenever the primary
// selection intersects the table; moving the caret away replaces the pipe
// block with a read-only HTML preview widget. Clicking the preview jumps the
// caret back to the table start.

function splitPipeTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isPipeTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.length >= 3;
}

function isPipeTableSeparator(line: string): boolean {
  const cells = splitPipeTableCells(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

interface MdTableSpan {
  startLine: number;
  endLine: number;
}

function findCompleteMarkdownTables(doc: Text): MdTableSpan[] {
  const out: MdTableSpan[] = [];
  let lineNo = 1;
  while (lineNo <= doc.lines) {
    const rowText = doc.line(lineNo).text;
    if (!isPipeTableRow(rowText)) {
      lineNo++;
      continue;
    }
    const startLine = lineNo;
    const rows: string[] = [];
    while (lineNo <= doc.lines && isPipeTableRow(doc.line(lineNo).text)) {
      rows.push(doc.line(lineNo).text);
      lineNo++;
    }
    if (rows.length < 3 || !isPipeTableSeparator(rows[1])) continue;

    const headerCols = splitPipeTableCells(rows[0]);
    const sepCols = splitPipeTableCells(rows[1]);
    if (headerCols.length !== sepCols.length || headerCols.length < 2) continue;

    let consistent = true;
    for (let i = 2; i < rows.length; i++) {
      if (splitPipeTableCells(rows[i]).length !== headerCols.length) {
        consistent = false;
        break;
      }
    }
    if (consistent) {
      out.push({ startLine, endLine: startLine + rows.length - 1 });
    }
  }
  return out;
}

/** Lines that render a block image preview widget below the markdown syntax. */
function findInlineImageLines(doc: Text): number[] {
  const lines: number[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (/!\[([^\]]*)\]\(([^)]+)\)/.test(text)) {
      lines.push(n);
      continue;
    }
    if (/!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/i.test(text)) {
      lines.push(n);
    }
  }
  return lines;
}

function buildTablePreviewHtml(rows: string[]): string {
  const headerCells = splitPipeTableCells(rows[0]);
  const bodyRows = rows.slice(2);
  let html = '<table class="cm-md-table-preview-table"><thead><tr>';
  for (const h of headerCells) {
    html += `<th>${escapeHtmlCell(h)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of bodyRows) {
    html += "<tr>";
    for (const c of splitPipeTableCells(row)) {
      html += `<td>${escapeHtmlCell(c)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

class CollapsedMarkdownTableWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly tableFrom: number,
    readonly tableTo: number,
  ) {
    super();
  }
  eq(other: CollapsedMarkdownTableWidget) {
    return (
      other.html === this.html &&
      other.tableFrom === this.tableFrom &&
      other.tableTo === this.tableTo
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-preview cm-md-table-preview--collapsed";
    wrap.title = "Click to edit table";
    wrap.innerHTML = this.html;
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      view.dispatch({
        selection: EditorSelection.cursor(this.tableFrom),
        scrollIntoView: true,
      });
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/** True when the caret or selection should show raw fences (not collapsed preview). */
function selectionIntersectsRange(
  sel: EditorState["selection"],
  from: number,
  to: number,
): boolean {
  const { main } = sel;
  if (main.empty) {
    // Inclusive start, exclusive end — caret at `from` expands; at `to` stays collapsed.
    return main.head >= from && main.head < to;
  }
  return main.from < to && main.to > from;
}

function buildMarkdownTableCollapseDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (const span of findCompleteMarkdownTables(doc)) {
    const startLine = doc.line(span.startLine);
    const endLine = doc.line(span.endLine);
    const from = startLine.from;
    const to = endLine.to;

    if (selectionIntersectsRange(state.selection, from, to)) {
      continue;
    }

    const rows: string[] = [];
    for (let ln = span.startLine; ln <= span.endLine; ln++) {
      rows.push(doc.line(ln).text);
    }
    const html = buildTablePreviewHtml(rows);

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new CollapsedMarkdownTableWidget(html, from, to),
        block: true,
      }),
    );
  }

  return builder.finish();
}

function makeMarkdownTableCollapseField() {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildMarkdownTableCollapseDecorations(state);
    },
    update(_decos, tr) {
      // Selection affects collapse vs raw markdown — rebuild each transaction (cheap vs doc size).
      return buildMarkdownTableCollapseDecorations(tr.state);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
}

function isStickyDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = [...dt.types];
  return types.includes(METIS_STICKY_MIME) || types.includes("text/plain");
}

function readStickyDragPayload(dt: DataTransfer): string | null {
  const raw = dt.getData(METIS_STICKY_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { color?: string };
    if (parsed && typeof parsed.color === "string") return raw;
  } catch {
    /* not our payload */
  }
  return null;
}

function makeStickyDropHandler() {
  return EditorView.domEventHandlers({
    dragenter(event) {
      if (isStickyDrag(event.dataTransfer)) {
        event.preventDefault();
      }
    },
    dragover(event) {
      if (isStickyDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer!.dropEffect = "copy";
      }
    },
    drop(event, view) {
      const raw = readStickyDragPayload(event.dataTransfer!);
      if (!raw) return false;
      event.preventDefault();
      const coords = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (coords === null) return false;
      const attrs = parseStickyDragPayload(raw);
      insertStickyNoteAt(view, coords, attrs);
      return true;
    },
  });
}

/** Collapsed tables and inline image previews are atomic for vertical cursor motion. */
function makeInlinePreviewAtomicRanges() {
  return EditorView.atomicRanges.of((view) => {
    const { state } = view;
    const builder = new RangeSetBuilder<Decoration>();
    const mark = Decoration.mark({ class: "cm-inline-preview-atomic" });

    for (const span of findCompleteMarkdownTables(state.doc)) {
      const from = state.doc.line(span.startLine).from;
      const to = state.doc.line(span.endLine).to;
      if (!selectionIntersectsRange(state.selection, from, to)) {
        builder.add(from, to, mark);
      }
    }

    for (const lineNo of findInlineImageLines(state.doc)) {
      const line = state.doc.line(lineNo);
      if (!selectionIntersectsRange(state.selection, line.from, line.to)) {
        builder.add(line.from, line.to, mark);
      }
    }

    return builder.finish();
  });
}

function followMarkdownLinkAtColumn(
  text: string,
  col: number,
  fileDir: string,
  vaultPath: string,
  filePath: string,
): boolean {
  const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col < start || col > end) continue;
    followVaultHref(m[2].trim(), { fileDir, vaultPath, filePath });
    return true;
  }

  const wikiRe = /\[\[([^\]]+)\]\]/g;
  while ((m = wikiRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col < start || col > end) continue;
    openNoteByWikilinkNameFromStore(m[1]);
    return true;
  }

  return false;
}

/** Click wikilinks + collapsed/expanded link tokens; Cmd/Ctrl+Click also follows raw markdown links. */
function makeLinkClickHandler(vaultPath: string, filePath: string) {
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));

  return EditorView.domEventHandlers({
    click(event, view) {
      if (event.button !== 0) return false;

      const el = event.target as HTMLElement;
      const fromCollapsed = el.closest("[data-md-link-href]") as HTMLElement | null;
      const collapsedHref = fromCollapsed?.dataset.mdLinkHref?.trim();
      if (collapsedHref) {
        event.preventDefault();
        event.stopPropagation();
        followVaultHref(collapsedHref, { fileDir, vaultPath, filePath });
        return true;
      }

      const wikiEl = el.closest("[data-wikilink]") as HTMLElement | null;
      if (wikiEl?.dataset.wikilink) {
        event.preventDefault();
        event.stopPropagation();
        openNoteByWikilinkNameFromStore(wikiEl.dataset.wikilink);
        return true;
      }

      const coords = { x: event.clientX, y: event.clientY };
      const pos = view.posAtCoords(coords);
      if (pos !== null) {
        const line = view.state.doc.lineAt(pos);
        const col = pos - line.from;
        if (followMarkdownLinkAtColumn(line.text, col, fileDir, vaultPath, filePath)) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
      }

      return false;
    },
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false;

      const coords = { x: event.clientX, y: event.clientY };
      const pos = view.posAtCoords(coords);
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      if (followMarkdownLinkAtColumn(line.text, col, fileDir, vaultPath, filePath)) {
        event.preventDefault();
        return true;
      }

      return false;
    },
    contextmenu(event, view) {
      const imgWrap = (event.target as HTMLElement | null)?.closest(
        ".cm-inline-img-wrap[data-reveal-path]",
      ) as HTMLElement | null;
      const revealPath = imgWrap?.dataset.revealPath?.trim();
      if (revealPath) {
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => {
              invoke("reveal_in_finder", { path: revealPath, vaultPath }).catch(console.error);
            },
          },
        ]);
        return true;
      }

      const fromCollapsed = (event.target as HTMLElement | null)?.closest(
        "[data-md-link-href]",
      ) as HTMLElement | null;
      const collapsedHref = fromCollapsed?.dataset.mdLinkHref?.trim();
      if (collapsedHref) {
        event.preventDefault();
        openDomContextMenu(
          event.clientX,
          event.clientY,
          sourceLinkMenuItems(collapsedHref, fileDir, vaultPath),
        );
        return true;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const col = pos - line.from;

      // Standard image markdown: ![alt](src)
      const mdImageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdImageRe.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const src = m[2].trim();
        const items = sourceImageRevealMenuItems(src, fileDir, vaultPath);
        if (items) {
          event.preventDefault();
          openDomContextMenu(event.clientX, event.clientY, items);
          return true;
        }
        break;
      }

      // Wikilink image: ![[filename.ext]]
      const wikiImageRe = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))\]\]/gi;
      while ((m = wikiImageRe.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const filename = m[1].trim();
        const { assetIndex } = useStore.getState();
        const resolvedPath = normalizePosixPath(
          resolveWikilinkAssetPath(filename, assetIndex, vaultPath),
        );
        if (!resolvedPath.startsWith(`${vaultPath}/`)) break;
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: revealPlatformLabel(),
            onClick: () => {
              invoke("reveal_in_finder", { path: resolvedPath, vaultPath }).catch(console.error);
            },
          },
        ]);
        return true;
      }

      const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
      while ((m = mdLinkRe.exec(text)) !== null) {
        if (m.index > 0 && text[m.index - 1] === "!") continue;
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const url = m[2].trim();
        event.preventDefault();
        openDomContextMenu(
          event.clientX,
          event.clientY,
          sourceLinkMenuItems(url, fileDir, vaultPath),
        );
        return true;
      }

      const wikiRe = /\[\[([^\]]+)\]\]/g;
      while ((m = wikiRe.exec(text)) !== null) {
        if (m.index > 0 && text[m.index - 1] === "!") continue;
        const start = m.index;
        const end = start + m[0].length;
        if (col < start || col > end) continue;
        const name = m[1].trim();
        event.preventDefault();
        openDomContextMenu(event.clientX, event.clientY, [
          {
            label: "Open Note",
            onClick: () => openNoteByWikilinkNameFromStore(name),
          },
        ]);
        return true;
      }

      return false;
    },
  });
}

/**
 * Call this factory inside the editor's extension list, passing the active
 * vault path and file path so images resolve correctly.
 */
export function makeInlinePreviewExtension(
  vaultPath: string,
  filePath: string,
) {
  return [
    makeImageDecosField(vaultPath, filePath),
    makeMarkdownTableCollapseField(),
    makeInlinePreviewAtomicRanges(),
    makeLinkClickHandler(vaultPath, filePath),
    makeStickyDropHandler(),
  ];
}

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
              console.warn("No vault open — cannot save pasted image.");
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
            console.error("Failed to save pasted image:", err);
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
//
// The standard `lineNumbers()` still numbers the hidden frontmatter lines,
// which is confusing — line 1 of the visible document would show as e.g. "8".
// This extension:
//   • Shows no gutter label for lines inside the frontmatter block.
//   • Offsets all subsequent line numbers so the first visible line is "1".

import { lineNumbers } from "@codemirror/view";

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
