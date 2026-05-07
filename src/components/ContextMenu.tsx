import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: never;
}

export interface ContextMenuSeparator {
  separator: true;
  label?: never;
  onClick?: never;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust so the menu never overflows the viewport.
  // Cap at 70 vh so a long menu scrolls rather than clipping.
  const MAX_H = Math.min(window.innerHeight * 0.7, items.length * 30 + 8);
  const approxW = 180;
  const top = y + MAX_H > window.innerHeight ? Math.max(4, y - MAX_H) : y;
  const left = x + approxW > window.innerWidth ? x - approxW : x;

  return (
    <div
      ref={ref}
      style={{ top, left, maxHeight: MAX_H }}
      className="fixed z-50 min-w-[160px] overflow-y-auto rounded-lg border border-border bg-surface-overlay py-1 shadow-xl shadow-black/40"
    >
      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return <div key={i} className="my-1 border-t border-border" />;
        }
        const menuItem = item as ContextMenuItem;
        return (
          <button
            key={i}
            disabled={menuItem.disabled}
            onClick={() => {
              menuItem.onClick();
              onClose();
            }}
            className={[
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
              menuItem.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
              menuItem.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
            ].join(" ")}
          >
            {menuItem.icon && (
              <span className="shrink-0 opacity-70">{menuItem.icon}</span>
            )}
            {menuItem.label}
          </button>
        );
      })}
    </div>
  );
}
