import { useState } from "react";
import type { HistoryEntry } from "@/types/persona";
import { Hint, SubsectionLabel } from "../shared/ui";

interface AITabHistoryProps {
  history: HistoryEntry[];
  onClearHistory: () => void;
  onRestore: (entry: HistoryEntry) => void;
}

export function AITabHistory({ history, onClearHistory, onRestore }: AITabHistoryProps) {
  const [showHistory, setShowHistory] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border px-3 py-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface-overlay">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex w-full items-center justify-between px-2.5 py-2 text-left transition-colors hover:bg-surface-base/30"
        >
          <SubsectionLabel>Session history ({history.length})</SubsectionLabel>
          <span className="text-[10px] text-text-muted">{showHistory ? "▾" : "▸"}</span>
        </button>
        {showHistory && (
          <div className="max-h-40 space-y-1 overflow-y-auto border-t border-border/60 px-2 pb-2 pt-1.5">
            {history.slice(0, 10).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onRestore(h)}
                className="w-full rounded border border-border/60 bg-surface-base/40 px-2 py-1.5 text-left transition-colors hover:border-accent/30 hover:bg-surface-base/60"
              >
                <span className="block truncate text-[10px] font-medium text-text-secondary">
                  {h.userMessage.slice(0, 60)}
                  {h.userMessage.length > 60 ? "…" : ""}
                </span>
                <span className="text-[9px] text-text-muted">
                  {new Date(h.timestamp).toLocaleTimeString()}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={onClearHistory}
              className="w-full py-1 text-center text-[10px] text-text-muted transition-colors hover:text-red-400"
            >
              Clear session history
            </button>
            <Hint>
              Session replay only (last 50). Use <span className="text-text-secondary">Run log ↗</span>{" "}
              above the agent chips or <span className="font-mono">⌘⇧L</span> for the full log.
            </Hint>
          </div>
        )}
      </div>
    </div>
  );
}
