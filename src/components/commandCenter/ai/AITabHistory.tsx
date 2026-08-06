import { useState } from "react";
import { useStore } from "@/store/useStore";
import type { HistoryEntry } from "@/types/persona";

interface AITabHistoryProps {
  history: HistoryEntry[];
  onClearHistory: () => void;
  onRestore: (entry: HistoryEntry) => void;
}

export function AITabHistory({ history, onClearHistory, onRestore }: AITabHistoryProps) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="flex flex-1 items-center justify-between text-[10px] text-text-muted hover:text-text-primary transition-colors"
        >
          <span className="font-semibold uppercase tracking-widest">
            History ({history.length})
          </span>
          <span>{showHistory ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          onClick={() => useStore.getState().setEditorTab("agent-history")}
          className="ml-2 shrink-0 text-[10px] text-accent hover:underline"
          title="Open full run log in main view"
        >
          Run log ↗
        </button>
      </div>
      {history.length > 0 && showHistory && (
        <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
          {history.slice(0, 10).map((h) => (
            <button
              key={h.id}
              onClick={() => onRestore(h)}
              className="w-full rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-left text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
            >
              <span className="font-medium text-text-secondary truncate block">
                {h.userMessage.slice(0, 60)}
                {h.userMessage.length > 60 ? "…" : ""}
              </span>
              <span className="opacity-60">{new Date(h.timestamp).toLocaleTimeString()}</span>
            </button>
          ))}
          <button
            onClick={onClearHistory}
            className="w-full text-center text-[10px] text-text-muted hover:text-red-400 transition-colors py-0.5"
          >
            Clear history
          </button>
        </div>
      )}
    </div>
  );
}
