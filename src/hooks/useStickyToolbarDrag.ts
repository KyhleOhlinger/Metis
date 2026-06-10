import { useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  insertStickyNoteAt,
  STICKY_COLOR_PRESETS,
  type StickyColor,
} from "@/utils/stickyNotes";

const THRESHOLD_PX = 5;
const GHOST_ID = "metis-sticky-drag-ghost";

interface StickyToolbarDrag {
  color: StickyColor;
  label: string;
  swatch: string;
  includeWrap: boolean;
  startX: number;
  startY: number;
  active: boolean;
}

let _drag: StickyToolbarDrag | null = null;

function swatchForColor(color: StickyColor): string {
  return STICKY_COLOR_PRESETS.find((p) => p.color === color)?.swatch ?? "#fbbf24";
}

function updateGhost(drag: StickyToolbarDrag, x: number, y: number, visible: boolean) {
  const ghost = document.getElementById(GHOST_ID);
  if (!ghost) return;
  if (!visible) {
    ghost.style.opacity = "0";
    return;
  }
  ghost.style.left = `${x + 14}px`;
  ghost.style.top = `${y + 4}px`;
  ghost.style.opacity = "1";
  ghost.style.backgroundColor = drag.swatch;
  ghost.textContent = drag.label;
}

function editorPosAt(view: EditorView, x: number, y: number): number | null {
  const rect = view.dom.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }
  return view.posAtCoords({ x, y });
}

/** Begin a potential pointer drag from the sticky colour toolbar. */
export function beginStickyToolbarDrag(
  color: StickyColor,
  label: string,
  clientX: number,
  clientY: number,
  includeWrap = false,
) {
  _drag = {
    color,
    label,
    swatch: swatchForColor(color),
    includeWrap,
    startX: clientX,
    startY: clientY,
    active: false,
  };
}

/**
 * Pointer-based sticky drag (WKWebView does not reliably support HTML5 DnD from toolbar buttons).
 * Mirrors the Sidebar file-tree drag pattern.
 */
export function useStickyToolbarDrag(
  viewRef: RefObject<EditorView | null>,
  options?: { onDragStart?: () => void },
) {
  const suppressClickRef = useRef(false);

  const onDragStart = options?.onDragStart;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!_drag) return;

      const dx = e.clientX - _drag.startX;
      const dy = e.clientY - _drag.startY;

      if (!_drag.active) {
        if (Math.hypot(dx, dy) < THRESHOLD_PX) return;
        _drag.active = true;
        onDragStart?.();
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }

      updateGhost(_drag, e.clientX, e.clientY, true);
    };

    const onUp = (e: PointerEvent) => {
      const drag = _drag;
      _drag = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      updateGhost(
        drag ?? {
          color: "amber",
          label: "",
          swatch: "",
          includeWrap: false,
          startX: 0,
          startY: 0,
          active: false,
        },
        0,
        0,
        false,
      );

      if (!drag?.active) return;

      const view = viewRef.current;
      if (!view) return;

      const pos = editorPosAt(view, e.clientX, e.clientY);
      if (pos === null) return;

      insertStickyNoteAt(view, pos, { color: drag.color }, undefined, {
        includeWrap: drag.includeWrap,
      });
      suppressClickRef.current = true;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [viewRef, onDragStart]);

  return {
    shouldSuppressClick: () => {
      if (!suppressClickRef.current) return false;
      suppressClickRef.current = false;
      return true;
    },
  };
}

export { GHOST_ID as STICKY_TOOLBAR_GHOST_ID };
