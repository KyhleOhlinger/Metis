import { useState, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, NotebookPen } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { usePersonaStore } from "@/store/usePersonaStore";
import { insertStickyNote, STICKY_COLOR_PRESETS, type StickyColor } from "@/utils/stickyNotes";
import {
  beginStickyToolbarDrag,
  STICKY_TOOLBAR_GHOST_ID,
  useStickyToolbarDrag,
} from "@/hooks/useStickyToolbarDrag";

export default function StickyNoteDropdown({
  viewRef,
  iconSize,
  btnCls,
}: {
  viewRef: RefObject<EditorView | null>;
  iconSize: number;
  btnCls: string;
}) {
  const [open, setOpen] = useState(false);
  const [includeWrap, setIncludeWrap] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
      setIncludeWrap(
        usePersonaStore.getState().settings.stickyDefaults?.includeWrapBlock === true,
      );
    }
    setOpen((v) => !v);
  };

  const { shouldSuppressClick } = useStickyToolbarDrag(viewRef, {
    onDragStart: () => setOpen(false),
  });

  const insertColor = (color: StickyColor) => {
    const view = viewRef.current;
    if (view) insertStickyNote(view, { color }, undefined, { includeWrap });
    setOpen(false);
  };

  const onColourPointerDown = (
    e: PointerEvent<HTMLButtonElement>,
    color: StickyColor,
    label: string,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginStickyToolbarDrag(color, label, e.clientX, e.clientY, includeWrap);
  };

  return (
    <>
      <div
        id={STICKY_TOOLBAR_GHOST_ID}
        style={{ opacity: 0, pointerEvents: "none" }}
        className="fixed z-[10000] rounded-md border border-white/25 px-2.5 py-1 text-xs font-medium text-slate-900 shadow-lg transition-opacity"
      />
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        title="Insert sticky note"
        onMouseDown={toggle}
        className={`${btnCls} flex items-center gap-0.5`}
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
            <label className="mb-1.5 flex items-start gap-2 px-1 cursor-pointer">
              <input
                type="checkbox"
                checked={includeWrap}
                onChange={(e) => setIncludeWrap(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-[10px] leading-snug text-text-muted">
                Add <code className="text-[9px]">:::stickywrap</code> block
              </span>
            </label>
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
