import { useState, useEffect, useMemo, useRef } from "react";
import Fuse from "fuse.js";
import { invoke } from "@tauri-apps/api/core";
import { useStore, NoteMetadata } from "../store/useStore";
import { STATUS_COLORS } from "../constants";

interface Props {
  onClose: () => void;
}

export default function CommandPalette({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const noteIndex   = useStore((s) => s.noteIndex);
  const setActiveFile = useStore((s) => s.setActiveFile);

  // Unique statuses present in the index (for filter chips)
  const availableStatuses = useMemo(
    () => [...new Set(noteIndex.map((n) => n.status).filter((s): s is string => Boolean(s)))],
    [noteIndex],
  );

  // Build a Fuse instance whenever the note index changes.
  // Search name AND aliases so alias-named notes are discoverable.
  const fuse = useMemo(
    () =>
      new Fuse<NoteMetadata>(noteIndex, {
        keys: ["name", "aliases"],
        threshold: 0.35,
        minMatchCharLength: 1,
      }),
    [noteIndex],
  );

  const results: NoteMetadata[] = useMemo(() => {
    let base: NoteMetadata[];
    if (!query.trim()) {
      base = noteIndex.slice(0, 50); // wider pool so status filter has something to work with
    } else {
      base = fuse.search(query).map((r) => r.item);
    }
    if (statusFilter) base = base.filter((n) => n.status === statusFilter);
    return base.slice(0, 12);
  }, [query, fuse, noteIndex, statusFilter]);

  // Reset selection when the result list changes
  useEffect(() => setSelectedIdx(0), [results]);

  // Focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const openFile = async (note: NoteMetadata) => {
    try {
      const content = await invoke<string>("get_file_content", {
        path: note.path,
      });
      setActiveFile(note.path, content);
      onClose();
    } catch (err) {
      console.error("CommandPalette: failed to open file", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIdx]) openFile(results[selectedIdx]);
        break;
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      {/* Panel — viewport-relative max-h keeps the footer visible on short screens */}
      <div
        className="flex flex-col w-full max-w-lg rounded-xl border border-border bg-surface-raised shadow-2xl overflow-hidden max-h-[min(36rem,calc(100vh-6rem))]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4">
          {/* Search icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes…"
            className="flex-1 bg-transparent py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            spellCheck={false}
          />

          <kbd className="shrink-0 rounded bg-surface-base px-1.5 py-0.5 text-[10px] text-text-muted font-mono">
            esc
          </kbd>
        </div>

        {/* Status filter chips */}
        {availableStatuses.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
            {availableStatuses.map((s) => (
              <button
                key={s}
                onMouseDown={(e) => { e.preventDefault(); setStatusFilter(statusFilter === s ? null : s); }}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  statusFilter === s
                    ? (STATUS_COLORS[s] ?? "text-accent bg-accent/15") + " ring-1 ring-current"
                    : "text-text-muted bg-surface-overlay hover:text-text-primary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Results — flex-1 + min-h-0 so the list fills whatever the panel height allows */}
        {results.length > 0 ? (
          <ul className="flex-1 min-h-0 overflow-y-auto p-1">
            {results.map((note, i) => (
              <li
                key={note.path}
                onMouseDown={() => openFile(note)}
                onMouseEnter={() => setSelectedIdx(i)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${
                  i === selectedIdx
                    ? "bg-accent/20 text-text-primary"
                    : "text-text-secondary hover:bg-surface-base"
                }`}
              >
                {/* File icon */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-text-muted"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="flex-1 truncate">{note.name}</span>
                {note.status && (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_COLORS[note.status] ?? "text-text-muted bg-surface-overlay"}`}>
                    {note.status}
                  </span>
                )}
                {i === selectedIdx && (
                  <kbd className="shrink-0 rounded bg-surface-base px-1.5 py-0.5 text-[10px] text-text-muted font-mono">
                    ↵
                  </kbd>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            {noteIndex.length === 0
              ? "No vault open."
              : `No notes match "${query}"`}
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2">
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">esc</kbd> close
          </span>
          <span className="ml-auto text-[10px] text-text-muted">
            {noteIndex.length} note{noteIndex.length !== 1 ? "s" : ""} indexed
            {statusFilter && <span className="ml-1 text-accent">· {statusFilter}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
