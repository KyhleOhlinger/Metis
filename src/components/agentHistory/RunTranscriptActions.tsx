import { useState } from "react";
import {
  formatTranscriptRequest,
  formatTranscriptResponse,
  loadAgentRunTranscript,
} from "../../services/agentRunLogService";
import type { AgentRunTranscript } from "../../types/agentRunLog";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatError } from "../../utils/formatError";

type TranscriptPane = "request" | "response";

const btnCls =
  "rounded border border-border px-2 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40";

export function RunTranscriptActions({
  runId,
  hasTranscript,
  showRequest,
  showResponse,
}: {
  runId: string;
  hasTranscript?: boolean;
  showRequest: boolean;
  showResponse: boolean;
}) {
  const [transcript, setTranscript] = useState<AgentRunTranscript | null>(null);
  const [openPane, setOpenPane] = useState<TranscriptPane | null>(null);
  const [loadingPane, setLoadingPane] = useState<TranscriptPane | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPane = async (pane: TranscriptPane) => {
    if (openPane === pane) {
      setOpenPane(null);
      return;
    }
    if (transcript) {
      setOpenPane(pane);
      setError(null);
      return;
    }
    setLoadingPane(pane);
    setError(null);
    try {
      const loaded = await loadAgentRunTranscript(runId);
      if (!loaded) {
        setError("Transcript file was empty.");
        return;
      }
      setTranscript(loaded);
      setOpenPane(pane);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoadingPane(null);
    }
  };

  if (!hasTranscript) {
    return (
      <p className="text-[10px] text-text-muted/80">
        Full request/response was not stored for this run. New runs keep a sidecar transcript in app
        data.
      </p>
    );
  }

  const requestText = transcript ? formatTranscriptRequest(transcript) : "";
  const responseText = transcript ? formatTranscriptResponse(transcript) : "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {showRequest && (
          <button
            type="button"
            className={btnCls}
            disabled={loadingPane !== null}
            onClick={() => void loadPane("request")}
          >
            {loadingPane === "request"
              ? "Loading…"
              : openPane === "request"
                ? "Hide full request"
                : "Show full request"}
          </button>
        )}
        {showResponse && (
          <button
            type="button"
            className={btnCls}
            disabled={loadingPane !== null}
            onClick={() => void loadPane("response")}
          >
            {loadingPane === "response"
              ? "Loading…"
              : openPane === "response"
                ? "Hide full response"
                : "Show full response"}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {openPane === "request" && transcript && (
        <TranscriptBody
          label="Full request"
          text={requestText}
          copyMessage="Full request copied."
        />
      )}
      {openPane === "response" && transcript && (
        <TranscriptBody
          label="Full response"
          text={responseText}
          copyMessage="Full response copied."
        />
      )}
    </div>
  );
}

function TranscriptBody({
  label,
  text,
  copyMessage,
}: {
  label: string;
  text: string;
  copyMessage: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text-secondary">{label}</span>
        <button
          type="button"
          className={btnCls}
          onClick={() => void copyTextToClipboard(text, { successMessage: copyMessage })}
        >
          Copy
        </button>
      </div>
      <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border/70 bg-surface-overlay/50 p-2 font-mono text-[10px] leading-relaxed text-text-primary">
        {text}
      </pre>
    </div>
  );
}
