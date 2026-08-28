import { useState, useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";
import { usePersonaStore, selectProfileApiKey } from "@/store/usePersonaStore";
import { strategyLabel } from "@/services/contextBuilder";
import { EgressTransparency } from "../../EgressTransparency";
import { InlineBanner } from "../shared/ui";
import { SystemPersonaPanels } from "@/systemPersonas/SystemPersonaPanels";
import { isSystemPersona } from "@/systemPersonas/registry";
import { PLANNER_PERSONA_ID } from "@/types/persona";
import { profileForPersona } from "@/utils/providerProfiles";
import type { ExecutionScope } from "@/types/persona";
import type { ContextStrategy } from "@/services/contextBuilder";
import type { PendingWrite } from "../agent/pendingWrite.types";
import type { AITabProps } from "./AITab.types";
import { useAgentRun } from "./hooks/useAgentRun";
import { useSystemPersonaRuns } from "./hooks/useSystemPersonaRuns";
import { scopeLabelFor, useAITabScopeOptions } from "./hooks/useAITabScopeOptions";
import { AITabPersonaBar } from "./AITabPersonaBar";
import { AITabScopeSelector } from "./AITabScopeSelector";
import { AITabResponsePanel } from "./AITabResponsePanel";
import { AITabInputBar, AITabStrategyBadge } from "./AITabInputBar";
import { AITabHistory } from "./AITabHistory";

export function AITab({
  activePersona, personas, activePersonaId, settings, history,
  activeFileContent, activeFilePath, vaultPath, files, initialScope,
  onSelectPersona, onAddHistory, onClearHistory, onNewPersona, onOpenSettings,
}: AITabProps) {
  const [scope, setScope] = useState<ExecutionScope>(initialScope ?? { type: "current-file" });
  const [includeImages, setIncludeImages] = useState(false);

  useEffect(() => {
    if (initialScope) setScope(initialScope);
  }, [initialScope]);

  const isSystemPersonaActive = activePersona ? isSystemPersona(activePersona.id) : false;

  const [userMessage, setUserMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [response, setResponse] = useState("");
  const [strategy, setStrategy] = useState<ContextStrategy | null>(null);
  const [error, setError] = useState("");
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [autoRunQueued, setAutoRunQueued] = useState(false);

  const cursorOffset = useStore((s) => s.cursorOffset);

  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);
  const responseRef = useRef<HTMLDivElement>(null);
  const handleRunRef = useRef<(() => void) | null>(null);
  const insertAfterSelectionRef = useRef(false);
  const selectionEndOffsetRef = useRef(0);
  const overridePersonaIdRef = useRef<string | null>(null);
  const useDefaultProviderRef = useRef(false);

  useEffect(() => {
    runTokenRef.current += 1;
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
    }
    setResponse("");
    setError("");
    setStatusMsg("");
    setStrategy(null);
    setPendingWrites([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  const apiKey = usePersonaStore((s) => selectProfileApiKey(s, activePersona));
  const hasApiKey = apiKey.length > 0;

  const { handleRun, handleStop } = useAgentRun({
    userMessage,
    streaming,
    scope,
    includeImages,
    activePersona,
    activeFileContent,
    activeFilePath,
    vaultPath,
    hasApiKey,
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
    useDefaultProviderRef,
    insertAfterSelectionRef,
    selectionEndOffsetRef,
  });

  const {
    handleLibrarianScan,
    handleTaskScan,
    handleTaskSync,
    handlePlannerJob,
    runHandwritingOcr,
    handwritingPendingCount,
    handwritingTotalCount,
  } = useSystemPersonaRuns({
    activePersona,
    hasApiKey,
    streaming,
    vaultPath,
    files,
    settings,
    onAddHistory,
    setError,
    setResponse,
    setStrategy,
    setStatusMsg,
    setPendingWrites,
    setStreaming,
    abortRef,
  });

  handleRunRef.current = handleRun;

  const selectionQuery = usePersonaStore((s) => s.selectionQuery);

  useEffect(() => {
    if (!selectionQuery) return;
    usePersonaStore.getState().setSelectionQuery(null);
    setUserMessage(selectionQuery.userMessage);
    setResponse("");
    setError("");
    setStatusMsg("");
    setStrategy(null);
    setPendingWrites([]);
    insertAfterSelectionRef.current = selectionQuery.insertAfterSelection ?? false;
    selectionEndOffsetRef.current = selectionQuery.selectionEndOffset ?? 0;
    overridePersonaIdRef.current = selectionQuery.personaId ?? null;
    useDefaultProviderRef.current = selectionQuery.useDefaultProvider ?? false;
    if ((settings.quickActionScopeDefault ?? "none") === "none") {
      setScope({ type: "none" });
    }
    if (selectionQuery.autoRun) {
      setAutoRunQueued(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionQuery]);

  useEffect(() => {
    if (!autoRunQueued || !userMessage.trim()) return;
    setAutoRunQueued(false);
    handleRunRef.current?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunQueued, userMessage]);

  const { folders, noteFiles } = useAITabScopeOptions(files);
  const scopeLabel = scopeLabelFor(scope, activeFilePath);

  const clearResponse = () => {
    setResponse("");
    setError("");
    setUserMessage("");
    setStrategy(null);
    setStatusMsg("");
    setPendingWrites([]);
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <AITabPersonaBar
        personas={personas}
        activePersonaId={activePersonaId}
        streaming={streaming}
        onSelectPersona={(id) => {
          onSelectPersona(id);
          if (id === PLANNER_PERSONA_ID) {
            setScope({ type: "planner" });
          }
        }}
        onNewPersona={onNewPersona}
        onOpenSettings={onOpenSettings}
      />

      {settings.storeAiHistory === false && (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <InlineBanner tone="accent">
            History recording is off — new runs are not saved here. Enable in AI settings → AI & privacy.
          </InlineBanner>
        </div>
      )}

      <AITabScopeSelector
        scope={scope}
        setScope={setScope}
        scopeLabel={scopeLabel}
        activeFilePath={activeFilePath}
        folders={folders}
        noteFiles={noteFiles}
        includeImages={includeImages}
        setIncludeImages={setIncludeImages}
        showIncludeImages={!isSystemPersonaActive}
      />

      <EgressTransparency
        scope={scope}
        userMessage={userMessage}
        persona={activePersona ?? null}
        profile={activePersona ? profileForPersona(settings, activePersona) : undefined}
        activeFileContent={activeFileContent}
        activeFilePath={activeFilePath}
        vaultPath={vaultPath}
        includeImages={includeImages}
        hidden={isSystemPersonaActive || streaming}
      />

      <SystemPersonaPanels
        activePersonaId={activePersona?.id}
        hasApiKey={hasApiKey}
        streaming={streaming}
        vaultPath={vaultPath}
        handwritingPendingCount={handwritingPendingCount}
        handwritingTotalCount={handwritingTotalCount}
        onLibrarianScan={() => void handleLibrarianScan()}
        onTaskScan={() => void handleTaskScan()}
        onTaskSync={() => void handleTaskSync()}
        onPlannerJob={(job) => void handlePlannerJob(job)}
        onHandwritingOcr={(mode) => void runHandwritingOcr(mode)}
      />

      <AITabResponsePanel
        responseRef={responseRef}
        response={response}
        error={error}
        statusMsg={statusMsg}
        streaming={streaming}
        hasApiKey={hasApiKey}
        activePersona={activePersona}
        vaultPath={vaultPath}
        activeFileContent={activeFileContent}
        pendingWrites={pendingWrites}
        setPendingWrites={setPendingWrites}
      />

      <AITabStrategyBadge
        strategy={strategy}
        streaming={streaming}
        label={strategy ? strategyLabel(strategy) : ""}
      />

      <AITabInputBar
        userMessage={userMessage}
        setUserMessage={setUserMessage}
        streaming={streaming}
        hasApiKey={hasApiKey}
        activePersona={activePersona}
        isSystemPersonaActive={isSystemPersonaActive}
        response={response}
        pendingWrites={pendingWrites}
        handleRun={handleRun}
        handleStop={handleStop}
        onClear={clearResponse}
      />

      <AITabHistory
        history={history}
        onClearHistory={onClearHistory}
        onRestore={(h) => {
          setUserMessage(h.userMessage);
          setResponse(h.response);
        }}
      />
    </div>
  );
}
