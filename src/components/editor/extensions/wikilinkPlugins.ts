/** Wikilinks, slash menu, task toggles, and planner link handling. */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, EditorSelection, type Text } from "@codemirror/state";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { useStore } from "@/store/useStore";
import {
  openExternalUrl,
  openNoteByWikilinkNameFromStore,
  resolveExternalHref,
} from "@/utils/vaultNavigation";
import {
  buildDefaultStickySlashInsert,
  DEFAULT_STICKY_PLACEHOLDER,
} from "@/utils/stickyNotes";
import { calloutPlugin, createVisualModePlugin } from "./editorPluginsCore";
import { selectionIntersectsRange } from "./editorPluginUtils";


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

const STANDARD_MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
const WIKILINK_SPAN_RE = /\[\[([^\]]+)\]\]/g;

/** Non-image `[text](url)` spans in document order. */
function findStandardMarkdownLinks(doc: Text): Array<{ from: number; to: number }> {
  const links: Array<{ from: number; to: number }> = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    STANDARD_MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STANDARD_MD_LINK_RE.exec(text)) !== null) {
      if (m.index > 0 && text[m.index - 1] === "!") continue;
      links.push({
        from: line.from + m.index,
        to: line.from + m.index + m[0].length,
      });
    }
  }
  return links;
}

/** Wikilink `[[note]]` spans (excludes `![[image]]`). */
function findWikilinkSpans(doc: Text): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    WIKILINK_SPAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_SPAN_RE.exec(text)) !== null) {
      if (m.index > 0 && text[m.index - 1] === "!") continue;
      spans.push({
        from: line.from + m.index,
        to: line.from + m.index + m[0].length,
      });
    }
  }
  return spans;
}

/** List marker prefix spans (`- `, `- [ ] `, `1. `, …) for atomic caret motion. */
function findListMarkerPrefixSpans(doc: Text): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const taskMatch = line.text.match(/^([ \t]*(?:[-*+]|\d+\.)\s+\[[ xX]\] ?)/);
    const bulletMatch = !taskMatch
      ? line.text.match(/^([ \t]*(?:[-*+]|\d+\.)\s+)/)
      : null;
    const match = taskMatch ?? bulletMatch;
    if (!match) continue;
    spans.push({ from: line.from, to: line.from + match[0].length });
  }
  return spans;
}

/** Collapsed links and list markers skip as one unit unless the caret is editing them. */
export const markdownCaretAtomicExtension = EditorView.atomicRanges.of((view) => {
  const { state } = view;
  const builder = new RangeSetBuilder<Decoration>();
  const mark = Decoration.mark({ class: "cm-inline-preview-atomic" });

  for (const { from, to } of findStandardMarkdownLinks(state.doc)) {
    if (!selectionIntersectsRange(state.selection, from, to)) {
      builder.add(from, to, mark);
    }
  }

  for (const { from, to } of findWikilinkSpans(state.doc)) {
    if (!selectionIntersectsRange(state.selection, from, to)) {
      builder.add(from, to, mark);
    }
  }

  for (const { from, to } of findListMarkerPrefixSpans(state.doc)) {
    if (!selectionIntersectsRange(state.selection, from, to)) {
      builder.add(from, to, mark);
    }
  }

  return builder.finish();
});

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
  const sel = view.state.selection;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    STANDARD_MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STANDARD_MD_LINK_RE.exec(text)) !== null) {
      // Don't treat image markdown as a collapsed text link: ![alt](url)
      if (m.index > 0 && text[m.index - 1] === "!") continue;

      const fullFrom = from + m.index;
      const fullTo = fullFrom + m[0].length;

      if (selectionIntersectsRange(sel, fullFrom, fullTo)) continue;

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

    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.posAtDOM(marker, 0);
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
 * Cmd/Ctrl+click on a `.cm-wikilink` opens the linked note.
 * Plain click leaves caret placement to CodeMirror so wikilink text stays editable.
 */
const wikilinkClickHandler = EditorView.domEventHandlers({
  mousedown(e) {
    if (e.button !== 0 || (!e.metaKey && !e.ctrlKey)) return false;
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
 *  - Mousedown handler (Cmd/Ctrl+click) to open the linked file
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

/** Cmd/Ctrl+click opens external http(s) links in planner cells; plain click edits. */
const plannerLinkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return false;

    const el = event.target as HTMLElement;
    const collapsedHref = el.closest("[data-md-link-href]")?.getAttribute("data-md-link-href")?.trim();
    if (collapsedHref && resolveExternalHref(collapsedHref)) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(resolveExternalHref(collapsedHref)!);
      return true;
    }

    const coords = { x: event.clientX, y: event.clientY };
    const pos = view.posAtCoords(coords);
    if (pos === null) return false;

    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdLinkRe.exec(line.text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (col < start || col > end) continue;
      const href = m[2].trim();
      const external = resolveExternalHref(href);
      if (!external) return false;
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(external);
      return true;
    }

    return false;
  },
});

/** Live-preview extensions for planner markdown cells (dim markers, callouts, links, tasks). */
export const plannerMarkdownVisualExtensions = [
  createVisualModePlugin("", ""),
  calloutPlugin,
  ...markdownLinkCollapseExtension,
  markdownCaretAtomicExtension,
  plannerLinkClickHandler,
  ...taskListClickExtension,
];
