import { useEffect, useRef, type ReactNode } from "react";
import { setPlannerFieldHeight } from "@/planner/plannerFieldHeights";

interface Props {
  fieldId: string;
  minHeightPx: number;
  heightPx: number;
  onHeightPxChange: (px: number) => void;
  children: ReactNode;
}

/**
 * Wraps an active planner CodeMirror field so the user can drag the bottom edge
 * to resize (CSS `resize: vertical`). Heights persist via `plannerFieldHeights`.
 */
export default function PlannerResizableEditorShell({
  fieldId,
  minHeightPx,
  heightPx,
  onHeightPxChange,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const sync = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h < minHeightPx - 4) return;
      onHeightPxChange(h);
      setPlannerFieldHeight(fieldId, h);
    };

    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fieldId, minHeightPx, onHeightPxChange]);

  return (
    <div
      ref={shellRef}
      data-planner-resize-shell
      className="flex w-full min-w-0 flex-col overflow-hidden rounded border border-border bg-surface-raised resize-y"
      style={{
        height: heightPx,
        minHeight: minHeightPx,
        maxHeight: "min(70vh, 720px)",
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
