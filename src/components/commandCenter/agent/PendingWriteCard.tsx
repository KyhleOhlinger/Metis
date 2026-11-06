import { useState } from "react";
import type { PendingWrite, PendingWriteTool } from "./pendingWrite.types";
import { appendToEnd, insertAfterFrontmatter, insertAtOffset } from "./contentMerge";
import { noteContentHash, writeNoteReplacingAutosave } from "@/hooks/noteAutosave";
import { agentNoteCopyPath } from "@/utils/paths";

// ── Pending write confirmation card ───────────────────────────────────────────

const TOOL_LABELS: Record<PendingWriteTool, { icon: string; verb: string }> = {
  write_to_current_file:   { icon: "📝", verb: "Overwrite" },
  append_to_current_file:  { icon: "⬇", verb: "Append to end of" },
  prepend_to_current_file: { icon: "⬆", verb: "Prepend to start of" },
  insert_at_cursor:        { icon: "➤", verb: "Insert at cursor in" },
  create_new_note:         { icon: "✨", verb: "Create" },
};

export function PendingWriteCard({
  write,
  vaultPath,
  activeFileContent,
  onApply,
  onDone,
  onError,
  onDismiss,
  onConflict,
  onStale,
}: {
  write: PendingWrite;
  vaultPath: string | null;
  activeFileContent: string;
  onApply: (id: string) => void;
  onDone: (id: string, absPath: string, finalContent: string) => void;
  onError: (id: string, msg: string) => void;
  onDismiss: (id: string) => void;
  onConflict: (id: string) => void;
  onStale: (id: string) => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const PREVIEW_LEN = 400;
  const preview = write.content.length > PREVIEW_LEN && !showFull
    ? write.content.slice(0, PREVIEW_LEN) + "…"
    : write.content;

  const { icon, verb } = TOOL_LABELS[write.tool];
  const displayName = write.tool === "create_new_note"
    ? write.path
    : (write.path.split("/").pop() ?? write.path);

  function proposedContent(): string {
    if (write.tool === "append_to_current_file") return appendToEnd(activeFileContent, write.content);
    if (write.tool === "prepend_to_current_file") return insertAfterFrontmatter(activeFileContent, write.content);
    if (write.tool === "insert_at_cursor") {
      return insertAtOffset(activeFileContent, write.cursorOffset ?? 0, write.content);
    }
    return write.content;
  }

  function lineDiff(before: string, after: string): string {
    const left = before.split("\n");
    const right = after.split("\n");
    const lines: string[] = [];
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max && lines.length < 40; i++) {
      if (left[i] === right[i]) continue;
      if (left[i] !== undefined) lines.push(`- ${left[i]}`);
      if (right[i] !== undefined) lines.push(`+ ${right[i]}`);
    }
    return lines.join("\n") || "(no line changes)";
  }

  async function handleApply(
    mode: "create" | "overwrite" = "create",
    pathOverride?: string,
    allowStale = false,
  ) {
    if (
      write.baseHash &&
      !allowStale &&
      noteContentHash(activeFileContent) !== write.baseHash
    ) {
      onStale(write.id);
      return;
    }
    onApply(write.id);
    try {
      let finalContent = write.content;
      let relPath = pathOverride ?? write.path;
      let writeMode: "create" | "overwrite" = "overwrite";

      if (write.tool === "append_to_current_file") {
        finalContent = appendToEnd(activeFileContent, write.content);
      } else if (write.tool === "prepend_to_current_file") {
        finalContent = insertAfterFrontmatter(activeFileContent, write.content);
      } else if (write.tool === "insert_at_cursor") {
        finalContent = insertAtOffset(activeFileContent, write.cursorOffset ?? 0, write.content);
      } else if (write.tool === "create_new_note") {
        relPath = vaultPath ? `${vaultPath}/${pathOverride ?? write.path}` : (pathOverride ?? write.path);
        writeMode = mode;
      }

      const absPath = await writeNoteReplacingAutosave(relPath, finalContent, writeMode);
      // Pass finalContent back so the caller can sync the editor immediately
      // without a separate disk read.
      onDone(write.id, absPath, finalContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (write.tool === "create_new_note" && msg.includes("NOTE_EXISTS")) {
        onConflict(write.id);
        return;
      }
      onError(write.id, msg);
    }
  }

  return (
    <div className={[
      "rounded-md border overflow-hidden text-[11px]",
      write.status === "done"
        ? "border-green-500/30 bg-green-500/5"
        : write.status === "error"
        ? "border-red-500/30 bg-red-500/5"
        : "border-border bg-surface-overlay",
    ].join(" ")}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="text-base leading-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-text-muted">{verb}</p>
          <p className="truncate font-mono font-medium text-text-primary">{displayName}</p>
        </div>
        {write.status === "done" && (
          <span className="flex items-center gap-1 text-green-400 text-[10px]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Applied
          </span>
        )}
        {write.status === "error" && (
          <span className="text-red-400 text-[10px]" title={write.errorMsg}>Failed</span>
        )}
      </div>

      {write.tool === "write_to_current_file" && (
        <pre className="border-t border-border px-2 py-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-text-secondary">
          {lineDiff(activeFileContent, proposedContent())}
        </pre>
      )}
      {write.stale && (
        <p className="border-t border-amber-500/30 px-2 py-1 text-[10px] text-amber-200/90">
          This note changed after the suggestion was created. Apply will replace those edits.
        </p>
      )}

      {/* Content preview — shows the chunk being added (not the full merged file) */}
      <div className="border-t border-border px-2 pb-1.5 pt-1">
        <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-text-secondary leading-relaxed max-h-32 overflow-y-auto">
          {preview}
        </pre>
        {write.content.length > PREVIEW_LEN && (
          <button
            onClick={() => setShowFull((v) => !v)}
            className="mt-0.5 text-[9px] text-accent hover:underline"
          >
            {showFull ? "Show less" : `Show all (${write.content.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>

      {/* Action buttons */}
      {write.status === "pending" && write.conflict && write.tool === "create_new_note" && (
        <div className="flex flex-wrap gap-1.5 border-t border-amber-500/30 px-2 py-1.5">
          <p className="w-full text-[10px] text-amber-200/90">
            {write.path} already exists. The file was not changed.
          </p>
          <button
            onClick={() => void handleApply("overwrite")}
            className="rounded bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-200 hover:bg-amber-500/30"
          >
            Overwrite
          </button>
          <button
            onClick={() => void handleApply("create", agentNoteCopyPath(write.path))}
            className="rounded bg-accent/20 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/30"
          >
            Save as {agentNoteCopyPath(write.path).split("/").pop()}
          </button>
        </div>
      )}
      {write.status === "pending" && !write.conflict && (
        <div className="flex gap-1.5 border-t border-border px-2 py-1.5">
          <button
            onClick={() => void handleApply(write.tool === "create_new_note" ? "create" : "overwrite", undefined, write.stale)}
            className="flex-1 rounded bg-accent/20 py-1 text-[10px] font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            {write.stale ? "Apply anyway" : "Apply"}
          </button>
          <button
            onClick={() => onDismiss(write.id)}
            className="rounded px-2 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      {write.status === "applying" && (
        <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
          <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span className="text-[10px] text-text-muted">Writing…</span>
        </div>
      )}
      {write.status === "error" && (
        <div className="border-t border-red-500/20 px-2 py-1.5">
          <p className="text-[10px] text-red-400">{write.errorMsg}</p>
          <button
            onClick={() => void handleApply(write.tool === "create_new_note" ? "create" : "overwrite")}
            className="mt-1 text-[9px] text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

