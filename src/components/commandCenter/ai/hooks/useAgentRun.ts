import { useCallback, type MutableRefObject } from "react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { streamResponse, AGENT_FILE_TOOLS, type ParsedToolCall } from "@/services/aiService";
import { buildSmartContext, estimateContextEgress } from "@/services/contextBuilder";
import { confirmEgressBeforeRun } from "@/components/egressConfirm";
import { isSystemPersona } from "@/systemPersonas/registry";
import { profileForPersona } from "@/utils/providerProfiles";
import { sanitizeAgentNoteRelativePath } from "@/utils/paths";
import type { ExecutionScope, Persona, HistoryEntry } from "@/types/persona";
import type { ContextStrategy } from "@/services/contextBuilder";
import type { PendingWrite, PendingWriteTool } from "../../agent/pendingWrite.types";

export type AgentRunUi = {
  userMessage: string;
  streaming: boolean;
  scope: ExecutionScope;
  activePersona: Persona | undefined;
  activeFileContent: string;
  activeFilePath: string | null;
  vaultPath: string | null;
  hasApiKey: boolean;
  cursorOffset: number;
  onAddHistory: (entry: HistoryEntry) => void;
  setError: (v: string) => void;
  setResponse: (v: string | ((p: string) => string)) => void;
  setStrategy: (v: ContextStrategy | null) => void;
  setStatusMsg: (v: string) => void;
  setPendingWrites: (v: PendingWrite[]) => void;
  setUserMessage: (v: string) => void;
  setStreaming: (v: boolean) => void;
  runTokenRef: MutableRefObject<number>;
  abortRef: MutableRefObject<AbortController | null>;
  overridePersonaIdRef: MutableRefObject<string | null>;
  insertAfterSelectionRef: MutableRefObject<boolean>;
  selectionEndOffsetRef: MutableRefObject<number>;
};

export function useAgentRun(ui: AgentRunUi) {
  const {
    userMessage,
    streaming,
    scope,
    activePersona,
    activeFileContent,
    activeFilePath,
    vaultPath,
    cursorOffset,
    onAddHistory,
    setError,
    setResponse,
    setStrategy,
    setStatusMsg,
    setPendingWrites,
    setUserMessage,
    setStreaming,
    runTokenRef,
    abortRef,
    overridePersonaIdRef,
    insertAfterSelectionRef,
    selectionEndOffsetRef,
  } = ui;

  const handleRun = useCallback(async () => {
  // Resolve the persona for this run.  A quick action may pin a specific
  // persona via overridePersonaIdRef; otherwise fall back to the active one.
  const { personas: allPersonas, settings: liveSettings } =
    usePersonaStore.getState();
  const runPersona = overridePersonaIdRef.current
    ? (allPersonas.find((p) => p.id === overridePersonaIdRef.current) ?? activePersona)
    : activePersona;
  overridePersonaIdRef.current = null; // consume — only affects this run

  const runProfile = runPersona
    ? profileForPersona(liveSettings, runPersona)
    : undefined;

  const runMessage = userMessage.trim();
  if (!runPersona || !runProfile?.apiKey?.trim() || !runMessage || streaming) return;

  if (!isSystemPersona(runPersona.id)) {
    try {
      const egress = await estimateContextEgress(
        scope,
        runMessage,
        runPersona,
        runProfile,
        activeFileContent,
        activeFilePath,
        vaultPath,
      );
      if (!confirmEgressBeforeRun(egress)) return;
    } catch {
      // If estimation fails, proceed — buildSmartContext will surface errors.
    }
  }

  // Freeze mutable run inputs so async steps and callbacks can't drift.
  const runToken = ++runTokenRef.current;
  const runScope = scope;
  const runActiveFilePath = activeFilePath;
  const runActiveFileContent = activeFileContent;
  const runCursorOffset = cursorOffset;

  setError("");
  setResponse("");
  setStrategy(null);
  setStatusMsg("");
  setPendingWrites([]);
  setUserMessage("");
  setStreaming(true);

  // Build context using the smart tiered strategy
  let context = "";
  try {
    const result = await buildSmartContext(
      runScope,
      runMessage,
      runPersona,
      runProfile,
      runActiveFileContent,
      vaultPath,
      (msg) => setStatusMsg(msg),
    );
    if (runToken !== runTokenRef.current) return;
    context = result.context;
    setStrategy(result.strategy);
  } catch (e) {
    if (runToken !== runTokenRef.current) return;
    setError(`Failed to build context: ${String(e)}`);
    setStreaming(false);
    return;
  }

  setStatusMsg("");

  const controller = streamResponse(
    runPersona,
    context,
    runMessage,
    runProfile,
    {
      onChunk: (chunk) => {
        if (runToken !== runTokenRef.current) return;
        setResponse((prev) => prev + chunk);
      },
      onDone: (text, toolCalls) => {
        if (runToken !== runTokenRef.current) return;
        setStreaming(false);

        // If the action requested an inline insert and the model returned
        // plain text (no tool calls), auto-create a pending insert write so
        // the user can Apply directly below the highlighted section.
        if (
          insertAfterSelectionRef.current &&
          toolCalls.length === 0 &&
          text.trim() &&
          runActiveFilePath
        ) {
          setPendingWrites([{
            id: `sel-insert-${Date.now()}`,
            tool: "insert_at_cursor",
            path: runActiveFilePath,
            content: text.trim(),
            cursorOffset: selectionEndOffsetRef.current,
            status: "pending",
          }]);
          insertAfterSelectionRef.current = false;
          selectionEndOffsetRef.current   = 0;
        }

        // Agent file tools: always require explicit "Apply" in the UI (no silent disk writes).
        // Task Manager's todo.md path is the intentional exception — handled in handleTaskScan.
        if (toolCalls.length > 0) {
          const writes: PendingWrite[] = [];
          for (const tc of toolCalls as ParsedToolCall[]) {
            if (
              (tc.name === "write_to_current_file" ||
                tc.name === "append_to_current_file" ||
                tc.name === "prepend_to_current_file") &&
              runActiveFilePath
            ) {
              writes.push({
                id: tc.id,
                tool: tc.name as PendingWriteTool,
                path: runActiveFilePath,
                content: String(tc.args.content ?? ""),
                status: "pending",
              });
            } else if (tc.name === "insert_at_cursor" && runActiveFilePath) {
              writes.push({
                id: tc.id,
                tool: "insert_at_cursor",
                path: runActiveFilePath,
                content: String(tc.args.content ?? ""),
                cursorOffset: runCursorOffset,
                status: "pending",
              });
            } else if (tc.name === "create_new_note") {
              const rel =
                sanitizeAgentNoteRelativePath(
                  String(tc.args.relative_path ?? "agent-note.md"),
                ) ?? "agent-note.md";
              writes.push({
                id: tc.id,
                tool: "create_new_note",
                path: rel,
                content: String(tc.args.content ?? ""),
                status: "pending",
              });
            }
          }
          if (writes.length > 0) setPendingWrites(writes);
        }

        onAddHistory({
          id: `h-${Date.now()}`,
          timestamp: Date.now(),
          personaId: runPersona.id,
          scope: runScope,
          userMessage: runMessage,
          response: text,
        });
      },
      onError: (err) => {
        if (runToken !== runTokenRef.current) return;
        setStreaming(false);
        setError(err.message);
      },
    },
    AGENT_FILE_TOOLS,
  );
  if (runToken !== runTokenRef.current) {
    controller.abort();
    return;
  }
  abortRef.current = controller;
  }, [
    activePersona,
    ui.hasApiKey,
    userMessage,
    streaming,
    scope,
    activeFileContent,
    activeFilePath,
    vaultPath,
    onAddHistory,
    cursorOffset,
    setError,
    setResponse,
    setStrategy,
    setStatusMsg,
    setPendingWrites,
    setUserMessage,
    setStreaming,
    runTokenRef,
    abortRef,
    overridePersonaIdRef,
    insertAfterSelectionRef,
    selectionEndOffsetRef,
  ]);

  const handleStop = () => {
    runTokenRef.current += 1;
    abortRef.current?.abort();
    setStreaming(false);
  };

  return { handleRun, handleStop };
}
