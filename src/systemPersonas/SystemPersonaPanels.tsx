import {
  HANDWRITING_OCR_PERSONA_ID,
  LIBRARIAN_PERSONA_ID,
  TASK_PERSONA_ID,
} from "../types/persona";

export interface SystemPersonaPanelsProps {
  activePersonaId: string | undefined;
  hasApiKey: boolean;
  streaming: boolean;
  vaultPath: string | null;
  handwritingPendingCount: number;
  handwritingTotalCount: number;
  onLibrarianScan: () => void;
  onTaskScan: () => void;
  onTaskSync: () => void;
  onHandwritingOcr: (mode: "pending" | "all") => void;
}

export function SystemPersonaPanels({
  activePersonaId,
  hasApiKey,
  streaming,
  vaultPath,
  handwritingPendingCount,
  handwritingTotalCount,
  onLibrarianScan,
  onTaskScan,
  onTaskSync,
  onHandwritingOcr,
}: SystemPersonaPanelsProps) {
  if (activePersonaId === LIBRARIAN_PERSONA_ID) {
    return (
      <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none shrink-0">📚</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-text-primary mb-0.5">Vault Health Scan</p>
            <p className="text-[10px] text-text-muted leading-relaxed mb-2">
              Reads every note, maps [[wikilinks]], and asks the LLM to
              identify orphaned notes and suggest specific connections.
            </p>
            <button
              type="button"
              onClick={onLibrarianScan}
              disabled={!hasApiKey || streaming}
              className="flex items-center gap-1.5 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {streaming ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="animate-spin">
                    <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" opacity=".3"/>
                    <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z"/>
                  </svg>
                  Scanning…
                </>
              ) : (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  Scan Vault for Orphaned Notes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activePersonaId === TASK_PERSONA_ID) {
    return (
      <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none shrink-0">✅</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-text-primary mb-0.5">Vault Task Scan</p>
            <p className="text-[10px] text-text-muted leading-relaxed mb-2">
              Reads every note for <code className="font-mono">- [ ]</code> checkboxes, then asks
              the LLM to produce an organised <code className="font-mono">summaries/todo.md</code> with links back
              to each source note. Optional due date metadata is supported inline as{" "}
              <code className="font-mono">(due: YYYY-MM-DD)</code>.
            </p>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[10px] text-amber-200/90 leading-relaxed">
              <span className="font-semibold text-amber-100">No confirmation step:</span>{" "}
              when the LLM finishes, Metis writes <code className="font-mono text-[9px]">summaries/todo.md</code>{" "}
              under your vault immediately (overwriting any existing file). This is unlike normal agent edits,
              which use Apply.
            </div>
            <button
              type="button"
              onClick={onTaskScan}
              disabled={!hasApiKey || streaming}
              className="flex items-center gap-1.5 rounded-md bg-green-500/15 border border-green-500/30 px-3 py-1.5 text-[11px] font-medium text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {streaming ? "Scanning…" : "Scan & Update todo.md"}
            </button>
            <div className="mt-2 rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1.5 text-[10px] text-sky-100/90 leading-relaxed">
              <span className="font-semibold text-sky-100">Vault Task Sync:</span>{" "}
              applies checkbox changes from <code className="font-mono text-[9px]">summaries/todo.md</code> back
              to source notes, then rebuilds <code className="font-mono text-[9px]">todo.md</code> from current vault task state.
            </div>
            <button
              type="button"
              onClick={onTaskSync}
              disabled={streaming || !vaultPath}
              className="mt-2 flex items-center gap-1.5 rounded-md bg-sky-500/15 border border-sky-500/30 px-3 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {streaming ? "Syncing…" : "Vault Task Sync (bi-directional)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activePersonaId === HANDWRITING_OCR_PERSONA_ID) {
    return (
      <div className="shrink-0 border-b border-border bg-surface-overlay/40 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none shrink-0">📷</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-text-primary mb-0.5">
              Handwriting → Markdown
            </p>
            <p className="text-[10px] text-text-muted leading-relaxed mb-2">
              Add photos of handwritten notes to the{" "}
              <code className="font-mono text-[9px]">handwritten/</code> Space (sidebar).
              Vision AI transcribes each image into a sibling{" "}
              <code className="font-mono text-[9px]">.md</code> note with the image embedded.
              Use a vision model (e.g. <code className="font-mono text-[9px]">gpt-4o</code>,{" "}
              <code className="font-mono text-[9px]">gemini-1.5-flash</code>).
            </p>
            {vaultPath && (
              <p className="text-[10px] text-text-muted mb-2">
                {handwritingPendingCount} new · {handwritingTotalCount} total image
                {handwritingTotalCount !== 1 ? "s" : ""} in handwritten/
              </p>
            )}
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[10px] text-amber-200/90 leading-relaxed">
              <span className="font-semibold text-amber-100">Writes immediately:</span>{" "}
              each transcription is saved to{" "}
              <code className="font-mono text-[9px]">handwritten/&lt;name&gt;.md</code>{" "}
              after you confirm (overwrites existing notes when re-transcribing).
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onHandwritingOcr("pending")}
                disabled={!hasApiKey || streaming || !vaultPath || handwritingPendingCount === 0}
                className="flex items-center gap-1.5 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? "Working…" : `Transcribe new (${handwritingPendingCount})`}
              </button>
              <button
                type="button"
                onClick={() => onHandwritingOcr("all")}
                disabled={!hasApiKey || streaming || !vaultPath || handwritingTotalCount === 0}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Re-transcribe all
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
