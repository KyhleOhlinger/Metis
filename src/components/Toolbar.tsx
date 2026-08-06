import { useState, useRef, useEffect, useCallback } from "react";
import type { RefObject } from "react";
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
  Table,
  type LucideIcon,
} from "lucide-react";
import { EditorView } from "@codemirror/view";
import { toggleInline } from "./toolbarActions";
import ToolbarCalendarPopover from "./toolbar/ToolbarCalendarPopover";
import ToolbarCalculatorPopover from "./toolbar/ToolbarCalculatorPopover";
import StickyNoteDropdown from "./toolbar/StickyNoteDropdown";
import CalloutDropdown from "./toolbar/CalloutDropdown";
import {
  insertCodeBlock,
  insertHRule,
  insertImage,
  insertLink,
  insertTable,
  toggleBlockquote,
  toggleHeading,
} from "./toolbar/toolbarBlockFormat";
import { toggleBulletList, toggleOrderedList, toggleTaskList } from "./toolbar/toolbarListFormat";

const ICON_SIZE_NORMAL = 14;
const ICON_SIZE_COMPACT = 11;
const COMPACT_THRESHOLD = 640;

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
  { label: "Bold (Cmd+B)", Icon: Bold, action: (v) => toggleInline(v, "**"), group: "inline" },
  { label: "Italic (Cmd+I)", Icon: Italic, action: (v) => toggleInline(v, "_"), group: "inline" },
  { label: "Inline code", Icon: Code, action: (v) => toggleInline(v, "`"), group: "inline" },
  { label: "Insert link", Icon: Link, action: insertLink, group: "insert" },
  { label: "Insert image", Icon: Image, action: insertImage, group: "insert" },
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
  { label: "Blockquote", Icon: Quote, action: toggleBlockquote, group: "block" },
  { label: "Bullet list", Icon: List, action: toggleBulletList, group: "block" },
  { label: "Numbered list", Icon: ListOrdered, action: toggleOrderedList, group: "block" },
  { label: "Task list", Icon: ListChecks, action: toggleTaskList, group: "block" },
  { label: "Insert table", Icon: Table, action: insertTable, group: "block" },
  { label: "Horizontal rule", Icon: Minus, action: insertHRule, group: "misc" },
];

export default function Toolbar({ viewRef, spellcheck, onToggleSpellcheck }: ToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

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
  const dividerCls = compact ? "mx-0.5 h-3 w-px shrink-0 bg-border" : "mx-1 h-4 w-px shrink-0 bg-border";

  const handleAction = useCallback(
    (action: (view: EditorView) => void) => {
      const view = viewRef.current;
      if (!view) return;
      action(view);
    },
    [viewRef],
  );

  const groups = ITEMS.reduce<Record<string, ToolbarItem[]>>((acc, item) => {
    const g = item.group ?? "misc";
    (acc[g] ??= []).push(item);
    return acc;
  }, {});

  const orderedGroups = ["heading", "inline", "insert", "block", "misc"];

  return (
    <div
      ref={containerRef}
      className="metis-toolbar-scroll min-w-0 w-full shrink-0 overflow-x-auto overflow-y-hidden border-b border-border bg-surface-raised/70 backdrop-blur-sm"
    >
      <div
        className={`flex w-max min-w-full flex-nowrap items-center ${
          compact ? "gap-0 px-1 py-0.5" : "gap-0.5 px-2 py-1"
        }`}
      >
        {orderedGroups.map((groupKey, gi) => {
          const groupItems = groups[groupKey];
          if (!groupItems) return null;
          return (
            <div key={groupKey} className={`flex shrink-0 items-center ${compact ? "gap-0" : "gap-0.5"}`}>
              {gi > 0 && <div className={dividerCls} />}
              {groupItems.map((item) => (
                <button
                  key={item.label}
                  title={item.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleAction(item.action);
                  }}
                  className={`${btnCls} shrink-0`}
                >
                  {item.Icon ? <item.Icon size={iconSize} /> : item.renderIcon?.(iconSize)}
                </button>
              ))}
            </div>
          );
        })}

        <div className={dividerCls} />
        <CalloutDropdown viewRef={viewRef} iconSize={iconSize} btnCls={btnCls} />
        <StickyNoteDropdown viewRef={viewRef} iconSize={iconSize} btnCls={btnCls} />

        <div className={dividerCls} />
        <ToolbarCalendarPopover iconSize={iconSize} btnCls={`${btnCls} shrink-0 flex items-center gap-0.5`} />
        <ToolbarCalculatorPopover viewRef={viewRef} iconSize={iconSize} btnCls={`${btnCls} shrink-0 flex items-center gap-0.5`} />

        <div className={dividerCls} />
        <button
          title={spellcheck ? "Disable spellcheck" : "Enable spellcheck"}
          onMouseDown={(e) => {
            e.preventDefault();
            onToggleSpellcheck();
          }}
          className={`shrink-0 rounded transition-colors ${compact ? "p-0.5" : "p-1.5"} ${
            spellcheck
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"
          }`}
        >
          <SpellCheck size={iconSize} />
        </button>
      </div>
    </div>
  );
}
