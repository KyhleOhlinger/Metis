import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store/useStore";
import { parseMarkdownToHtml } from "../../utils/markdownHtml";
import { bindPreviewAnchorHandlers } from "../../utils/previewLinkHandlers";
import type { PreviewAnchorContext } from "../../utils/previewLinkHandlers";

interface Props {
  content: string;
  fontSizePx?: number;
  minHeightPx?: number;
  fillHeight?: boolean;
  className?: string;
  onClick?: () => void;
}

/**
 * Read-only rendered markdown for planner cells — compact padding aligned with
 * CodeMirror (top-left, full block width).
 */
export default function PlannerMarkdownPreview({
  content,
  fontSizePx = 10,
  minHeightPx = 64,
  fillHeight = false,
  className = "",
  onClick,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<PreviewAnchorContext>({
    fileDir: "",
    vaultPath: "",
  });

  const { vaultPath, noteIndex, setActiveFile } = useStore(
    useShallow((s) => ({
      vaultPath: s.vaultPath ?? "",
      noteIndex: s.noteIndex,
      setActiveFile: s.setActiveFile,
    })),
  );

  ctxRef.current = {
    fileDir: vaultPath,
    vaultPath,
    noteIndex,
    setActiveFile,
  };

  const html = useMemo(
    () =>
      parseMarkdownToHtml(content, {
        gfm: true,
        breaks: true,
        sanitize: { taskLists: true },
      }),
    [content],
  );
  const empty = !content.trim();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return bindPreviewAnchorHandlers(root, () => ctxRef.current);
  }, []);

  const sizeStyle = fillHeight
    ? { flex: "1 1 0%", minHeight: `${Math.max(48, minHeightPx)}px` }
    : { minHeight: `${minHeightPx}px`, maxHeight: `${minHeightPx}px` };

  return (
    <div
      ref={rootRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        onClick?.();
      }}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[
        "planner-markdown-preview block w-full overflow-auto rounded border border-border bg-surface-raised text-left",
        fillHeight ? "min-h-0 flex-1 self-stretch" : "self-start",
        onClick ? "cursor-text hover:ring-1 hover:ring-accent/25" : "",
        empty ? "text-text-muted opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...sizeStyle, fontSize: `${fontSizePx}px`, lineHeight: fontSizePx <= 10 ? 1.42 : 1.45 }}
      dangerouslySetInnerHTML={!empty && html ? { __html: html } : undefined}
    >
      {empty ? "Click to edit" : undefined}
    </div>
  );
}
