import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import {
  Bold,
  Italic,
  Code,
  Link,
  Image,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  SpellCheck,
  // Callout type icons
  Lightbulb,
  Info,
  StickyNote,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  HelpCircle,
  Star,
  AlertCircle,
  XCircle,
  Bug,
  BookOpen,
  ChevronDown,
  Table,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { ChangeSet, EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertStickyNote, STICKY_COLOR_PRESETS, type StickyColor } from "../utils/stickyNotes";
import {
  beginStickyToolbarDrag,
  STICKY_TOOLBAR_GHOST_ID,
  useStickyToolbarDrag,
} from "../hooks/useStickyToolbarDrag";
import { insertCallout, toggleInline } from "./toolbarActions";

// ── Formatting helpers ────────────────────────────────────────────────────────

function sel(view: EditorView) {
  return view.state.selection.main;
}

/**
 * Toggle a heading prefix (`# `, `## `, `### `) on the current line.
 * Cycles: none → H1 → H2 → H3 → none.
 * If `level` is provided, sets that level directly (or removes if already set).
 */
function toggleHeading(view: EditorView, level: 1 | 2 | 3) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const prefix = "#".repeat(level) + " ";

  // Strip any existing heading prefix
  const stripped = line.text.replace(/^#{1,6} /, "");
  const alreadySet = line.text.startsWith(prefix);

  view.dispatch({
    changes: {
      from: line.from,
      to: line.to,
      insert: alreadySet ? stripped : `${prefix}${stripped}`,
    },
    selection: {
      anchor: alreadySet
        ? line.from + stripped.length
        : line.from + prefix.length + stripped.length,
    },
  });
  view.focus();
}

/**
 * Wrap the selection (or an empty placeholder) in a fenced code block.
 */
function insertCodeBlock(view: EditorView) {
  const { from, to } = sel(view);
  const selected = view.state.sliceDoc(from, to);
  const code = selected.length > 0 ? selected : "code";
  const insert = `\`\`\`\n${code}\n\`\`\``;

  view.dispatch({
    changes: { from, to, insert },
    // Place cursor at start of code line
    selection: { anchor: from + 4, head: from + 4 + code.length },
  });
  view.focus();
}

/**
 * Insert / wrap a Markdown link `[label](url)`.
 * - Selected text becomes the label.
 * - Cursor lands on the URL placeholder.
 */
function insertLink(view: EditorView) {
  const { from, to } = sel(view);
  const label = view.state.sliceDoc(from, to) || "text";
  const insert = `[${label}](url)`;

  view.dispatch({
    changes: { from, to, insert },
    // Select "url" so the user can immediately type the address
    selection: { anchor: from + label.length + 3, head: from + insert.length - 1 },
  });
  view.focus();
}

/**
 * Insert an image `![alt](url)`.
 * - Selected text becomes alt text.
 * - Cursor lands on the URL placeholder.
 */
function insertImage(view: EditorView) {
  const { from, to } = sel(view);
  const alt = view.state.sliceDoc(from, to) || "image";
  const insert = `![${alt}](url)`;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + alt.length + 4, head: from + insert.length - 1 },
  });
  view.focus();
}

/**
 * Toggle a blockquote `> ` prefix on the current line.
 */
function toggleBlockquote(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);

  if (line.text.startsWith("> ")) {
    view.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: "" },
      selection: { anchor: from - 2 },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, insert: "> " },
      selection: { anchor: from + 2 },
    });
  }
  view.focus();
}

/** Strip one leading Markdown list / task prefix (for normalising multi-line toggles). */
function stripListPrefix(text: string): string {
  return text
    .replace(/^- \[[ xX]\] /, "")
    .replace(/^[-*+] /, "")
    .replace(/^\d+\. /, "");
}

/** All lines overlapping the primary selection (inclusive). */
function linesInSelection(view: EditorView) {
  const { from, to } = sel(view);
  const doc = view.state.doc;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const first = doc.lineAt(a);
  const last = doc.lineAt(b);
  const out: (typeof first)[] = [];
  for (let n = first.number; n <= last.number; n++) {
    out.push(doc.line(n));
  }
  return out;
}

function dispatchListChanges(view: EditorView, changes: ChangeSpec[]) {
  const { from, to } = sel(view);
  const cs = ChangeSet.of(changes, view.state.doc.length);
  view.dispatch({
    changes,
    selection: EditorSelection.range(cs.mapPos(from, 1), cs.mapPos(to, 1)),
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Toggle a bullet list `- ` on the current line, or on every line in the selection.
 *
 * Uses prefix-only changes (insert / delete at line start) instead of
 * full-line replacements so that `ChangeSet.mapPos` preserves the cursor
 * position relative to the line body.
 */
function toggleBulletList(view: EditorView) {
  const lines = linesInSelection(view);
  const allBulleted = lines.length > 0 && lines.every((l) => /^- /.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allBulleted) {
    for (const line of lines) {
      const m = line.text.match(/^- /);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: "- " });
    }
  }

  dispatchListChanges(view, changes);
}

/**
 * Toggle numbered list prefixes on the current line or on each line in the selection.
 */
function toggleOrderedList(view: EditorView) {
  const lines = linesInSelection(view);
  const allOrdered =
    lines.length > 0 && lines.every((l) => /^\d+\. /.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allOrdered) {
    for (const line of lines) {
      const m = line.text.match(/^\d+\. /);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    let n = 1;
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: `${n}. ` });
      n += 1;
    }
  }

  dispatchListChanges(view, changes);
}

/**
 * Toggle task-list items `- [ ] ` on the current line or each selected line.
 * Checked `- [x] ` lines count as task lines and are removed with the rest.
 */
function toggleTaskList(view: EditorView) {
  const lines = linesInSelection(view);
  const taskRe = /^- \[[ xX]\] /;
  const allTask = lines.length > 0 && lines.every((l) => taskRe.test(l.text));
  const changes: ChangeSpec[] = [];

  if (allTask) {
    for (const line of lines) {
      const m = line.text.match(taskRe);
      if (!m) continue;
      changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
    }
  } else {
    for (const line of lines) {
      const body = stripListPrefix(line.text);
      const oldPrefixLen = line.text.length - body.length;
      changes.push({ from: line.from, to: line.from + oldPrefixLen, insert: "- [ ] " });
    }
  }

  dispatchListChanges(view, changes);
}

/**
 * Insert a horizontal rule `---` on a new line.
 */
function insertHRule(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  // Insert after the current line
  const insertPos = line.to;
  view.dispatch({
    changes: { from: insertPos, insert: "\n\n---\n" },
    selection: { anchor: insertPos + 6 },
  });
  view.focus();
}

/** Insert a minimal GitHub-Flavored Markdown table with header, separator, and one body row. */
function insertTable(view: EditorView) {
  const { from } = sel(view);
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  const insert =
    "\n\n| Header | Header |\n| --- | --- |\n| Cell | Cell |\n";
  view.dispatch({
    changes: { from: insertPos, insert },
    selection: { anchor: insertPos + insert.indexOf("Cell") },
  });
  view.focus();
}

// ── Callout type definitions ──────────────────────────────────────────────────

const ICON_SIZE_NORMAL = 14;
const ICON_SIZE_COMPACT = 11;
const COMPACT_THRESHOLD = 480;

interface CalloutType {
  type: string;
  // Store the component constructor, not a pre-created JSX element.
  // Pre-created elements (React.ReactNode) are plain objects that React tracks
  // by identity — reusing the same object in multiple renders causes React to
  // skip re-rendering, resulting in an empty list.
  Icon: LucideIcon;
  color: string;
}

// Each entry maps a callout keyword to a Lucide component and a text colour.
// The colours intentionally echo the callout styles applied by calloutPlugin.
const CALLOUT_TYPES: CalloutType[] = [
  { type: "TIP",       Icon: Lightbulb,     color: "#4ade80" },
  { type: "INFO",      Icon: Info,          color: "#60a5fa" },
  { type: "NOTE",      Icon: StickyNote,    color: "#c084fc" },
  { type: "WARNING",   Icon: AlertTriangle, color: "#facc15" },
  { type: "DANGER",    Icon: AlertOctagon,  color: "#f87171" },
  { type: "SUCCESS",   Icon: CheckCircle2,  color: "#4ade80" },
  { type: "QUESTION",  Icon: HelpCircle,    color: "#22d3ee" },
  { type: "IMPORTANT", Icon: Star,          color: "#fb923c" },
  { type: "CAUTION",   Icon: AlertCircle,   color: "#fbbf24" },
  { type: "FAILURE",   Icon: XCircle,       color: "#f87171" },
  { type: "BUG",       Icon: Bug,           color: "#ef4444" },
  { type: "EXAMPLE",   Icon: BookOpen,      color: "#818cf8" },
  { type: "QUOTE",     Icon: Quote,         color: "#94a3b8" },
];

// ── Sticky note colour picker (insert or drag into editor) ───────────────────

function StickyNoteDropdown({
  viewRef,
  iconSize,
}: {
  viewRef: RefObject<EditorView | null>;
  iconSize: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  };

  const { shouldSuppressClick } = useStickyToolbarDrag(viewRef, {
    onDragStart: () => setOpen(false),
  });

  const insertColor = (color: StickyColor) => {
    const view = viewRef.current;
    if (view) insertStickyNote(view, { color });
    setOpen(false);
  };

  const onColourPointerDown = (
    e: PointerEvent<HTMLButtonElement>,
    color: StickyColor,
    label: string,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginStickyToolbarDrag(color, label, e.clientX, e.clientY);
  };

  return (
    <>
      <div
        id={STICKY_TOOLBAR_GHOST_ID}
        style={{ opacity: 0, pointerEvents: "none" }}
        className="fixed z-[10000] rounded-md border border-white/25 px-2.5 py-1 text-xs font-medium text-slate-900 shadow-lg transition-opacity"
      />
    <div className="relative">
      <button
        ref={triggerRef}
        title="Insert sticky note"
        onMouseDown={toggle}
        className="flex items-center gap-0.5 rounded p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary active:bg-accent/20 active:text-accent"
      >
        <NotebookPen size={iconSize} />
        <ChevronDown
          size={Math.max(7, iconSize - 5)}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && createPortal(
        <>
          <div
            className="fixed inset-0 z-[998]"
            onMouseDown={() => setOpen(false)}
          />
          <div
            className="fixed z-[999] w-44 rounded-lg border border-border bg-surface-raised p-1.5 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Sticky colour
            </p>
            <p className="mb-1.5 px-1 text-[9px] text-text-muted opacity-80">
              Click to insert · press and drag into the note
            </p>
            <div className="grid grid-cols-2 gap-0.5">
              {STICKY_COLOR_PRESETS.map(({ color, label, swatch }) => (
                <button
                  key={color}
                  title={`${label} sticky — drag into editor`}
                  onPointerDown={(e) => onColourPointerDown(e, color, label)}
                  onClick={() => {
                    if (shouldSuppressClick()) return;
                    insertColor(color);
                  }}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-surface-overlay"
                >
                  <span
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-white/20 shadow-sm"
                    style={{ backgroundColor: swatch }}
                  />
                  <span className="leading-none text-text-secondary">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
    </>
  );
}

// ── Callout dropdown ──────────────────────────────────────────────────────────

/**
 * Floating panel that lets the user pick a callout type to insert.
 *
 * The dropdown is rendered via a React portal directly on document.body so
 * that it always paints on top of every other element — including the
 * MetadataPanel which follows the Toolbar in the DOM and would otherwise
 * cover an absolutely-positioned dropdown regardless of z-index.
 */
function CalloutDropdown({ viewRef, iconSize }: { viewRef: RefObject<EditorView | null>; iconSize: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      // Position panel below the trigger button with a small gap
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        title="Insert callout block"
        onMouseDown={toggle}
        className="flex items-center gap-0.5 rounded p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary active:bg-accent/20 active:text-accent"
      >
        <StickyNote size={iconSize} />
        <ChevronDown
          size={Math.max(7, iconSize - 5)}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && createPortal(
        <>
          {/* Full-screen backdrop — closes the panel on click-away */}
          <div
            className="fixed inset-0 z-[998]"
            onMouseDown={() => setOpen(false)}
          />

          {/* Callout type grid — fixed so it escapes every stacking context */}
          <div
            className="fixed z-[999] w-44 rounded-lg border border-border bg-surface-raised p-1.5 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Callout type
            </p>
            <div className="grid grid-cols-2 gap-0.5">
              {CALLOUT_TYPES.map(({ type, Icon, color }) => (
                <button
                  key={type}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const view = viewRef.current;
                    if (view) insertCallout(view, type);
                    setOpen(false);
                  }}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-surface-overlay"
                  style={{ color }}
                >
                  <Icon size={ICON_SIZE_NORMAL} />
                  <span className="capitalize leading-none">
                    {type.charAt(0) + type.slice(1).toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── Toolbar component ─────────────────────────────────────────────────────────

interface ToolbarProps {
  viewRef: RefObject<EditorView | null>;
  spellcheck: boolean;
  onToggleSpellcheck: () => void;
}

interface ToolbarItem {
  label: string;
  Icon: LucideIcon | null;
  renderIcon?: (size: number) => React.ReactNode;
  action: (view: EditorView) => void;
  group?: string;
}

const ITEMS: ToolbarItem[] = [
  { label: "Heading 1 (Ctrl+Alt+1)", Icon: Heading1, action: (v) => toggleHeading(v, 1), group: "heading" },
  { label: "Heading 2 (Ctrl+Alt+2)", Icon: Heading2, action: (v) => toggleHeading(v, 2), group: "heading" },
  { label: "Heading 3 (Ctrl+Alt+3)", Icon: Heading3, action: (v) => toggleHeading(v, 3), group: "heading" },
  { label: "Bold (Cmd+B)",           Icon: Bold,     action: (v) => toggleInline(v, "**"), group: "inline" },
  { label: "Italic (Cmd+I)",         Icon: Italic,   action: (v) => toggleInline(v, "_"),  group: "inline" },
  { label: "Inline code",            Icon: Code,     action: (v) => toggleInline(v, "`"),  group: "inline" },
  { label: "Insert link",            Icon: Link,     action: insertLink,       group: "insert" },
  { label: "Insert image",           Icon: Image,    action: insertImage,      group: "insert" },
  {
    label: "Code block",
    Icon: null,
    renderIcon: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    action: insertCodeBlock,
    group: "block",
  },
  { label: "Blockquote",     Icon: Quote,       action: toggleBlockquote,  group: "block" },
  { label: "Bullet list",    Icon: List,        action: toggleBulletList,  group: "block" },
  { label: "Numbered list",  Icon: ListOrdered, action: toggleOrderedList, group: "block" },
  { label: "Task list",      Icon: ListChecks,  action: toggleTaskList,    group: "block" },
  { label: "Insert table",   Icon: Table,       action: insertTable,       group: "block" },
  { label: "Horizontal rule", Icon: Minus,      action: insertHRule,       group: "misc"  },
];

export default function Toolbar({ viewRef, spellcheck, onToggleSpellcheck }: ToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // Watch the toolbar container width and switch to compact mode when tight
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < COMPACT_THRESHOLD);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iconSize = compact ? ICON_SIZE_COMPACT : ICON_SIZE_NORMAL;
  const btnCls = compact
    ? "rounded p-0.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary active:bg-accent/20 active:text-accent"
    : "rounded p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary active:bg-accent/20 active:text-accent";
  const dividerCls = compact ? "mx-0.5 h-3 w-px bg-border" : "mx-1 h-4 w-px bg-border";

  const handleAction = useCallback((action: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (!view) return;
    action(view);
  }, [viewRef]);

  const groups = ITEMS.reduce<Record<string, ToolbarItem[]>>((acc, item) => {
    const g = item.group ?? "misc";
    (acc[g] ??= []).push(item);
    return acc;
  }, {});

  const orderedGroups = ["heading", "inline", "insert", "block", "misc"];

  return (
    <div
      ref={containerRef}
      className={`flex shrink-0 items-center border-b border-border bg-surface-raised/70 backdrop-blur-sm ${
        compact ? "gap-0 px-1 py-0.5" : "gap-0.5 px-2 py-1"
      }`}
    >
      {orderedGroups.map((groupKey, gi) => {
        const groupItems = groups[groupKey];
        if (!groupItems) return null;
        return (
          <div key={groupKey} className={`flex items-center ${compact ? "gap-0" : "gap-0.5"}`}>
            {gi > 0 && <div className={dividerCls} />}
            {groupItems.map((item) => (
              <button
                key={item.label}
                title={item.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleAction(item.action);
                }}
                className={btnCls}
              >
                {item.Icon
                  ? <item.Icon size={iconSize} />
                  : item.renderIcon?.(iconSize)}
              </button>
            ))}
          </div>
        );
      })}

      <div className={dividerCls} />
      <CalloutDropdown viewRef={viewRef} iconSize={iconSize} />
      <StickyNoteDropdown viewRef={viewRef} iconSize={iconSize} />

      <div className={dividerCls} />
      <button
        title={spellcheck ? "Disable spellcheck" : "Enable spellcheck"}
        onMouseDown={(e) => {
          e.preventDefault();
          onToggleSpellcheck();
        }}
        className={`rounded transition-colors ${compact ? "p-0.5" : "p-1.5"} ${
          spellcheck
            ? "bg-accent/20 text-accent"
            : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"
        }`}
      >
        <SpellCheck size={iconSize} />
      </button>
    </div>
  );
}
