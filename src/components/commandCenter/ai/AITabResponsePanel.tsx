import type { RefObject } from "react";
import { useStore } from "@/store/useStore";
import { syncUiAfterDiskWrites } from "@/store/vaultSync";
import { appConfirm, toastSuccess } from "@/store/useToastStore";
import { HANDWRITING_OCR_PERSONA_ID } from "@/types/persona";
import type { Persona } from "@/types/persona";
import type { PendingWrite } from "../agent/pendingWrite.types";
import { PendingWriteCard } from "../agent/PendingWriteCard";

interface AITabResponsePanelProps {
  responseRef: RefObject<HTMLDivElement>;
  response: string;
  error: string;
  statusMsg: string;
  streaming: boolean;
  hasApiKey: boolean;
  activePersona: Persona | undefined;
  vaultPath: string | null;
  activeFileContent: string;
  pendingWrites: PendingWrite[];
  setPendingWrites: React.Dispatch<React.SetStateAction<PendingWrite[]>>;
}

export function AITabResponsePanel({
  responseRef,
  response,
  error,
  statusMsg,
  streaming,
  hasApiKey,
  activePersona,
  vaultPath,
  activeFileContent,
  pendingWrites,
  setPendingWrites,
}: AITabResponsePanelProps) {
  return (
    <div
      ref={responseRef}
      data-cc-ai-response-scroll
      className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs text-text-secondary font-mono whitespace-pre-wrap leading-relaxed"
    >
      {!response && !error && !streaming && !statusMsg && (
        <p className="text-text-muted text-center mt-6 text-[11px]">
          {!hasApiKey
            ? "⚙ Configure your API key in the Settings tab"
            : !activePersona
              ? "Select or create a persona to get started"
              : activePersona.id === HANDWRITING_OCR_PERSONA_ID
                ? "Transcribe images from handwritten/ using the buttons above"
                : "Ask the persona anything about your note…"}
        </p>
      )}

      {statusMsg && !response && (
        <p className="text-text-muted text-[10px] italic mt-2">
          <span className="animate-pulse">⋯</span> {statusMsg}
        </p>
      )}

      {streaming && !response && !statusMsg && (
        <div className="flex flex-col items-center gap-3 mt-8">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin text-accent"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-[11px] text-text-muted animate-pulse">
            {activePersona?.name ?? "Agent"} is thinking…
          </p>
        </div>
      )}

      {error && <p className="text-red-400 text-[11px]">{error}</p>}

      {response}

      {streaming && response && (
        <span className="inline-block h-3 w-1.5 animate-pulse bg-accent align-text-bottom ml-0.5 rounded-sm" />
      )}

      {pendingWrites.length > 0 && !streaming && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            File changes
          </p>
          {pendingWrites.map((pw) => (
            <PendingWriteCard
              key={pw.id}
              write={pw}
              vaultPath={vaultPath}
              activeFileContent={activeFileContent}
              onApply={(id) => {
                setPendingWrites((prev) =>
                  prev.map((w) => (w.id === id ? { ...w, status: "applying" } : w)),
                );
              }}
              onDone={(id, absPath, finalContent) => {
                setPendingWrites((prev) =>
                  prev.map((w) => (w.id === id ? { ...w, status: "done" } : w)),
                );
                const write = pendingWrites.find((w) => w.id === id);
                toastSuccess(
                  write?.tool === "create_new_note" ? "Note created." : "Changes applied.",
                );
                if (absPath) {
                  void syncUiAfterDiskWrites(
                    [{ path: absPath, content: finalContent }],
                    write?.tool === "create_new_note" ? { openPath: absPath } : undefined,
                  );
                } else {
                  void useStore.getState().refreshVault();
                }
              }}
              onError={(id, msg) => {
                setPendingWrites((prev) =>
                  prev.map((w) => (w.id === id ? { ...w, status: "error", errorMsg: msg } : w)),
                );
              }}
              onDismiss={async (id) => {
                const ok = await appConfirm("Dismiss this suggested change without applying?", {
                  title: "Dismiss change",
                  confirmLabel: "Dismiss",
                });
                if (!ok) return;
                setPendingWrites((prev) => prev.filter((w) => w.id !== id));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
