import { useEffect, useMemo, useRef } from "react";
import { parseMarkdownToHtml } from "../../utils/markdownHtml";
import { isExternalHttpUrl, openExternalUrl } from "../../utils/vaultNavigation";

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

  const html = useMemo(
    () =>
      parseMarkdownToHtml(content, {
        gfm: true,
        breaks: true,
        sanitize: { taskLists: true },
      }),
    [content],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
      if (!a || !root.contains(a)) return;

      const href = a.getAttribute("href") ?? "";
      if (!isExternalHttpUrl(href)) return;

      e.preventDefault();
      e.stopPropagation();
      openExternalUrl(href);
    };

    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, []);

  const sizeStyle = fillHeight
    ? { flex: "1 1 0%", minHeight: `${Math.max(48, minHeightPx)}px` }
    : { minHeight: `${minHeightPx}px`, maxHeight: `${minHeightPx}px` };

  return (
    <div
      ref={rootRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
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
        !html ? "text-text-muted opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...sizeStyle, fontSize: `${fontSizePx}px`, lineHeight: fontSizePx <= 10 ? 1.42 : 1.45 }}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}
