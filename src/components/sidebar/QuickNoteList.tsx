import { useState } from "react";
import type { NoteMetadata } from "@/store/useStore";
import { noteDisplayTitle } from "@/utils/noteNavigation";
import { openVaultNotePath } from "@/utils/openVaultNote";

export const RECENT_DROPDOWN_LIMIT = 5;

interface QuickNoteListProps {
  title: string;
  notes: NoteMetadata[];
  activeFilePath: string | null;
  /** Max items shown (default: all). */
  limit?: number;
  compact?: boolean;
  /** Collapsible dropdown instead of always-expanded list. */
  dropdown?: boolean;
  defaultOpen?: boolean;
}

export function QuickNoteList({
  title,
  notes,
  activeFilePath,
  limit,
  compact = false,
  dropdown = false,
  defaultOpen = false,
}: QuickNoteListProps) {
  const [open, setOpen] = useState(defaultOpen);
  const visible = limit ? notes.slice(0, limit) : notes;
  if (visible.length === 0) return null;

  const list = (
    <ul className="flex flex-col gap-0.5 px-1.5 pb-1">
      {visible.map((note) => {
        const active = activeFilePath === note.path;
        return (
          <li key={note.path}>
            <button
              type="button"
              onClick={() => void openVaultNotePath(note.path)}
              className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                active
                  ? "bg-accent/15 text-text-primary"
                  : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
                compact ? "text-[11px]" : "text-xs",
              ].join(" ")}
              title={note.path}
            >
              <span className="truncate">{noteDisplayTitle(note)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (!dropdown) {
    return (
      <div className={compact ? "mb-2" : "mb-3"}>
        <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-text-muted opacity-60">
          {title}
        </p>
        {list}
      </div>
    );
  }

  return (
    <div className={compact ? "mb-1" : "mb-1.5"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-surface-overlay"
        aria-expanded={open}
      >
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">
          {title}
          <span className="ml-1.5 font-normal normal-case tracking-normal text-text-muted/80">
            ({visible.length})
          </span>
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && list}
    </div>
  );
}
