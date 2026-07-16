import { useState, useEffect, useMemo, useRef } from "react";
import Fuse from "fuse.js";
import { invoke } from "@tauri-apps/api/core";
import { useStore, NoteMetadata } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import { STATUS_COLORS } from "../constants";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  onClose: () => void;
}

export default function CommandPalette({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const noteIndex = useStore((s) => s.noteIndex);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setEditorTab = useStore((s) => s.setEditorTab);
  const setPendingMenuAction = useStore((s) => s.setPendingMenuAction);
  const setSidebarView = useStore((s) => s.setSidebarView);
  const openSettings = usePersonaStore((s) => s.openSettings);

  const commandMode = query.startsWith(">");

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: "planner",
        label: "Open Planner",
        hint: "workspace",
        run: () => {
          setEditorTab("planner");
          onClose();
        },
      },
      {
        id: "run-log",
        label: "Open Agent Run Log",
        hint: "workspace",
        run: () => {
          setEditorTab("agent-history");
          onClose();
        },
      },
      {
        id: "export",
        label: "Export…",
        run: () => {
          setPendingMenuAction("export-hub");
          onClose();
        },
      },
      {
        id: "settings",
        label: "Open Settings",
        hint: "⌘,",
        run: () => {
          openSettings();
          onClose();
        },
      },
      {
        id: "vault-search",
        label: "Search Vault",
        hint: "⌘⇧F",
        run: () => {
          setSidebarView("search");
          onClose();
        },
      },
      {
        id: "source",
        label: "Switch to Source",
        run: () => {
          setEditorTab("source");
          onClose();
        },
      },
      {
        id: "visual",
        label: "Switch to Visual",
        run: () => {
          setEditorTab("visual");
          onClose();
        },
      },
    ],
    [onClose, openSettings, setEditorTab, setPendingMenuAction, setSidebarView],
  );

  const actionQuery = commandMode ? query.slice(1).trim() : "";
  const actionFuse = useMemo(
    () =>
      new Fuse(actions, {
        keys: ["label", "id"],
        threshold: 0.4,
      }),
    [actions],
  );

  const filteredActions = useMemo(() => {
    if (!commandMode) return [];
    if (!actionQuery) return actions;
    return actionFuse.search(actionQuery).map((r) => r.item);
  }, [actionQuery, actionFuse, actions, commandMode]);

  const availableStatuses = useMemo(
    () => [...new Set(noteIndex.map((n) => n.status).filter((s): s is string => Boolean(s)))],
    [noteIndex],
  );

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
    if (commandMode) return [];
    let base: NoteMetadata[];
    if (!query.trim()) {
      base = noteIndex.slice(0, 50);
    } else {
      base = fuse.search(query).map((r) => r.item);
    }
    if (statusFilter) base = base.filter((n) => n.status === statusFilter);
    return base.slice(0, 12);
  }, [query, fuse, noteIndex, statusFilter, commandMode]);

  const listLength = commandMode ? filteredActions.length : results.length;

  useEffect(() => setSelectedIdx(0), [listLength, commandMode, query, statusFilter]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const openFile = async (note: NoteMetadata) => {
    try {
      const content = await invoke<string>("get_file_content", { path: note.path });
      setActiveFile(note.path, content);
      onClose();
    } catch (err) {
      console.error("CommandPalette: failed to open file", err);
    }
  };

  const activateSelection = () => {
    if (commandMode) {
      const action = filteredActions[selectedIdx];
      if (action) action.run();
      return;
    }
    if (results[selectedIdx]) openFile(results[selectedIdx]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, listLength - 1)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        activateSelection();
        break;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-20"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[min(36rem,calc(100vh-6rem))] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
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
            placeholder="Search notes…  (type > for commands)"
            className="flex-1 bg-transparent py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            spellCheck={false}
          />

          <kbd className="shrink-0 rounded bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            esc
          </kbd>
        </div>

        {!commandMode && availableStatuses.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
            {availableStatuses.map((s) => (
              <button
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setStatusFilter(statusFilter === s ? null : s);
                }}
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

        {commandMode ? (
          filteredActions.length > 0 ? (
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {filteredActions.map((action, i) => (
                <li
                  key={action.id}
                  onMouseDown={() => action.run()}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                    i === selectedIdx
                      ? "bg-accent/20 text-text-primary"
                      : "text-text-secondary hover:bg-surface-base"
                  }`}
                >
                  <span className="shrink-0 font-mono text-[10px] text-accent">{">"}</span>
                  <span className="flex-1 truncate">{action.label}</span>
                  {action.hint && (
                    <span className="shrink-0 text-[10px] text-text-muted">{action.hint}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-text-muted">No commands match.</div>
          )
        ) : results.length > 0 ? (
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {results.map((note, i) => (
              <li
                key={note.path}
                onMouseDown={() => openFile(note)}
                onMouseEnter={() => setSelectedIdx(i)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  i === selectedIdx
                    ? "bg-accent/20 text-text-primary"
                    : "text-text-secondary hover:bg-surface-base"
                }`}
              >
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
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_COLORS[note.status] ?? "text-text-muted bg-surface-overlay"}`}
                  >
                    {note.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            {noteIndex.length === 0 ? "No vault open." : `No notes match "${query}"`}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border px-4 py-2">
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">↵</kbd> {commandMode ? "run" : "open"}
          </span>
          <span className="text-[10px] text-text-muted">
            <kbd className="font-mono">{">"}</kbd> commands
          </span>
          <span className="ml-auto text-[10px] text-text-muted">
            {commandMode
              ? `${filteredActions.length} command${filteredActions.length !== 1 ? "s" : ""}`
              : `${noteIndex.length} note${noteIndex.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>
    </div>
  );
}
