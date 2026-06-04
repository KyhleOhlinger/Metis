import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, syncUiAfterDiskWrites } from "@/store/useStore";
import { usePersonaStore, selectProfileApiKey } from "@/store/usePersonaStore";
import { strategyLabel } from "@/services/contextBuilder";
import { EgressTransparency } from "../../EgressTransparency";
import { SystemPersonaPanels } from "@/systemPersonas/SystemPersonaPanels";
import { isSystemPersona, SYSTEM_PERSONA_IDS } from "@/systemPersonas/registry";
import { profileForPersona } from "@/utils/providerProfiles";
import type { ExecutionScope } from "@/types/persona";
import { HANDWRITING_OCR_PERSONA_ID } from "@/types/persona";
import type { ContextStrategy } from "@/services/contextBuilder";
import type { PendingWrite } from "../agent/pendingWrite.types";
import { PendingWriteCard } from "../agent/PendingWriteCard";
import type { AITabProps } from "./AITab.types";
import { useAgentRun } from "./hooks/useAgentRun";
import { useSystemPersonaRuns } from "./hooks/useSystemPersonaRuns";

export function AITab({
  activePersona, personas, activePersonaId, settings, history,
  activeFileContent, activeFilePath, vaultPath, files, initialScope,
  onSelectPersona, onAddHistory, onClearHistory, onNewPersona, onOpenSettings,
}: AITabProps) {
  const [scope, setScope] = useState<ExecutionScope>(initialScope ?? { type: "current-file" });

  // Apply an externally-injected scope (from sidebar context menu)
  useEffect(() => {
    if (initialScope) setScope(initialScope);
  }, [initialScope]);
  // System personas have their own dedicated run buttons; the generic Ask box is not for them.
  const isSystemPersonaActive = activePersona ? isSystemPersona(activePersona.id) : false;

  const [userMessage, setUserMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [response, setResponse] = useState("");
  const [strategy, setStrategy] = useState<ContextStrategy | null>(null);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  // Set to true when a selection quick-action requests an auto-run.
  // A dedicated effect watches this flag and only fires handleRun once
  // both this flag and the new userMessage have been committed by React,
  // avoiding the race condition that plagued the old setTimeout approach.
  const [autoRunQueued, setAutoRunQueued] = useState(false);

  // Cursor offset is updated by the editor on every caret move; read once per
  // run so the insertion point is frozen at the moment the user clicked Run.
  const cursorOffset = useStore((s) => s.cursorOffset);

  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);
  const responseRef = useRef<HTMLDivElement>(null);

  // Clear the response area whenever the active file changes so stale context
  // from a previous note doesn't linger.  If a stream is in flight it is
  // aborted first to avoid writing into the wrong context.
  useEffect(() => {
    // Invalidate any in-flight run so post-await work cannot continue against
    // stale file context after a note switch.
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
    // Intentionally NOT clearing userMessage — the user may have typed a
    // question they want to apply to the newly opened file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  // Scroll to bottom of response as chunks arrive
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  // Ref so the selectionQuery effect (placed after handleRun) can call it
  // without creating a circular dependency.
  const handleRunRef = useRef<(() => void) | null>(null);

  // Stash insertAfterSelection flags so onDone (inside handleRun) can read
  // them even though the selectionQuery store entry is cleared before the run.
  const insertAfterSelectionRef = useRef(false);
  const selectionEndOffsetRef   = useRef(0);

  // When a quick action has a dedicated persona, its ID is stashed here before
  // handleRun is called.  handleRun reads and clears the ref so the override
  // only affects that single run without changing the active persona chip.
  const overridePersonaIdRef = useRef<string | null>(null);

  const apiKey = usePersonaStore((s) => selectProfileApiKey(s, activePersona));

  const hasApiKey = apiKey.length > 0;

  const { handleRun, handleStop } = useAgentRun({
    userMessage,
    streaming,
    scope,
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
    insertAfterSelectionRef,
    selectionEndOffsetRef,
  });

  const {
    handleLibrarianScan,
    handleTaskScan,
    handleTaskSync,
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

  // Keep ref in sync so the selectionQuery effect can call handleRun
  handleRunRef.current = handleRun;

  // ── Selection query (from floating toolbar) ────────────────────────────────
  // Subscribe reactively so the effect fires when the store value changes.
  const selectionQuery = usePersonaStore((s) => s.selectionQuery);

  useEffect(() => {
    if (!selectionQuery) return;
    // Clear the store entry immediately to avoid re-triggering
    usePersonaStore.getState().setSelectionQuery(null);
    setUserMessage(selectionQuery.userMessage);
    setResponse("");
    setError("");
    setStatusMsg("");
    setStrategy(null);
    setPendingWrites([]);
    // Stash inline-insert flags so onDone can read them after the run
    insertAfterSelectionRef.current = selectionQuery.insertAfterSelection ?? false;
    selectionEndOffsetRef.current   = selectionQuery.selectionEndOffset ?? 0;
    // Stash the override persona ID so handleRun uses the action's dedicated persona
    overridePersonaIdRef.current = selectionQuery.personaId ?? null;
    if (selectionQuery.autoRun) {
      setAutoRunQueued(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionQuery]);

  // Fires after React has committed both autoRunQueued=true and the new
  // userMessage value, ensuring handleRun reads the correct message from
  // its closure.  The userMessage guard prevents false triggers while the
  // queue flag is still false (e.g. when userMessage changes via normal typing).
  useEffect(() => {
    if (!autoRunQueued || !userMessage.trim()) return;
    setAutoRunQueued(false);
    handleRunRef.current?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunQueued, userMessage]);

  // Scope label for display
  const scopeLabel =
    scope.type === "current-file"
      ? activeFilePath ? activeFilePath.split("/").pop() ?? "Current File" : "Current File"
      : scope.type === "specific-file"
      ? scope.filePath.split("/").pop() ?? "File"
      : scope.type === "specific-folder"
      ? scope.folderPath.split("/").pop() ?? "Folder"
      : "Full Vault";

  // Collect folders from file tree for the scope picker
  const folders = useMemo(() => {
    const result: { path: string; name: string }[] = [];
    function walk(nodes: typeof files, depth = 0) {
      for (const n of nodes) {
        if (n.is_dir) {
          result.push({ path: n.path, name: "  ".repeat(depth) + n.name });
          if (n.children) walk(n.children, depth + 1);
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  // Collect all .md files from the file tree for the file scope picker.
  // Indented with the folder name prefix so the hierarchy is readable in
  // a flat <select> element.
  const noteFiles = useMemo(() => {
    const result: { path: string; label: string }[] = [];
    function walk(nodes: typeof files, prefix = "") {
      for (const n of nodes) {
        if (n.is_dir) {
          if (n.children) walk(n.children, prefix + n.name + "/");
        } else if (n.name.endsWith(".md")) {
          result.push({ path: n.path, label: prefix + n.name });
        }
      }
    }
    walk(files);
    return result;
  }, [files]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* ── Persona chips ─────────────────────────────────────────── */}
      {/* max-h caps growth so the response area always gets usable space */}
      <div className="shrink-0 border-b border-border px-2 py-2 space-y-1.5 max-h-36 overflow-y-auto">
        {/* System Default personas */}
        {(() => {
          const systemChips = personas.filter((p) => !p.disabled && SYSTEM_PERSONA_IDS.has(p.id));
          const customChips = personas.filter((p) => !p.disabled && !SYSTEM_PERSONA_IDS.has(p.id));
          return (
            <>
              {systemChips.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">System</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {systemChips.map((p) => (
                      <button
                        key={p.id}
                        data-persona-id={p.id}
                        onClick={() => onSelectPersona(p.id)}
                        title={`${p.name} · ${p.model} — or drag a file/folder here to run`}
                        className={[
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                          streaming && activePersonaId === p.id
                            ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
                            : activePersonaId === p.id
                            ? "bg-accent/20 text-accent ring-1 ring-accent"
                            : "bg-surface-overlay text-text-muted hover:text-text-primary",
                        ].join(" ")}
                      >
                        <span>{p.icon}</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {customChips.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50">Custom</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {customChips.map((p) => (
                      <button
                        key={p.id}
                        data-persona-id={p.id}
                        onClick={() => onSelectPersona(p.id)}
                        title={`${p.name} · ${p.model} — or drag a file/folder here to run`}
                        className={[
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                          streaming && activePersonaId === p.id
                            ? "animate-pulse bg-accent/30 text-accent ring-1 ring-accent"
                            : activePersonaId === p.id
                            ? "bg-accent/20 text-accent ring-1 ring-accent"
                            : "bg-surface-overlay text-text-muted hover:text-text-primary",
                        ].join(" ")}
                      >
                        <span>{p.icon}</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
        <div className="flex items-center gap-1">
          <button
            onClick={onNewPersona}
            title="New persona"
            className="rounded-full px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            +
          </button>
          <button
            onClick={onOpenSettings}
            title="Manage personas"
            className="ml-auto rounded p-0.5 text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {settings.storeAiHistory === false && (
        <div className="shrink-0 border-b border-border bg-surface-overlay/70 px-3 py-1.5 text-[9px] text-text-muted">
          History recording is off — new runs are not saved to History. Change this in Settings → AI & privacy.
        </div>
      )}

      {/* ── Scope selector ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-text-muted font-semibold">Scope</p>
        <div className="flex gap-1 flex-wrap">
          {(["current-file", "specific-folder", "full-vault"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                if (t === "specific-folder" && folders.length > 0) {
                  setScope({ type: "specific-folder", folderPath: folders[0].path });
                } else if (t === "current-file") {
                  // Reset to current-file; the dropdown below lets the user
                  // pick a different file while staying in File scope.
                  setScope({ type: "current-file" });
                } else if (t === "full-vault") {
                  setScope({ type: "full-vault" });
                }
              }}
              className={[
                "rounded px-2 py-0.5 text-[10px] transition-colors",
                // specific-file is a sub-mode of File scope — keep the button active
                (scope.type === t || (t === "current-file" && scope.type === "specific-file"))
                  ? "bg-accent/20 text-accent"
                  : "bg-surface-overlay text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {t === "current-file" ? "File" : t === "specific-folder" ? "Folder" : "Vault"}
            </button>
          ))}
        </div>

        {/* File dropdown — visible when File scope is active */}
        {(scope.type === "current-file" || scope.type === "specific-file") && noteFiles.length > 0 && (
          <select
            value={scope.type === "specific-file" ? scope.filePath : (activeFilePath ?? "")}
            onChange={async (e) => {
              const selected = e.target.value;
              // Open the selected note in the editor so the left panel updates.
              try {
                const content = await invoke<string>("get_file_content", { path: selected });
                useStore.getState().setActiveFile(selected, content);
              } catch {
                // If the read fails, still update the scope so the AI can try.
              }
              // If the user picks the currently open note, revert to current-file
              // so the scope tracks the active editor automatically.
              if (selected === activeFilePath) {
                setScope({ type: "current-file" });
              } else {
                setScope({ type: "specific-file", filePath: selected });
              }
            }}
            className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
          >
            {noteFiles.map((f) => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </select>
        )}

        {/* Folder dropdown — visible when Folder scope is active */}
        {scope.type === "specific-folder" && folders.length > 0 && (
          <select
            value={scope.folderPath}
            onChange={(e) => setScope({ type: "specific-folder", folderPath: e.target.value })}
            className="mt-1.5 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
          >
            {folders.map((f) => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
        )}

        <p className="mt-1 text-[10px] text-text-muted">
          Running on: <span className="text-text-secondary font-medium">{scopeLabel}</span>
        </p>
      </div>

      <EgressTransparency
        scope={scope}
        userMessage={userMessage}
        persona={activePersona ?? null}
        profile={activePersona ? profileForPersona(settings, activePersona) : undefined}
        activeFileContent={activeFileContent}
        activeFilePath={activeFilePath}
        vaultPath={vaultPath}
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
        onHandwritingOcr={(mode) => void runHandwritingOcr(mode)}
      />

      {/* ── Response area ──────────────────────────────────────────── */}
      {/* min-h-0 overrides the default min-height:auto on flex items so the
          area can actually shrink and scroll rather than overflow the panel */}
      <div
        ref={responseRef}
        data-cc-scroll-region
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs text-text-secondary font-mono whitespace-pre-wrap leading-relaxed"
      >
        {/* Idle placeholder */}
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

        {/* Context-building status (shown before streaming starts) */}
        {statusMsg && !response && (
          <p className="text-text-muted text-[10px] italic mt-2">
            <span className="animate-pulse">⋯</span> {statusMsg}
          </p>
        )}

        {/* Thinking indicator — visible after context is built but before
            the first token arrives from the LLM */}
        {streaming && !response && !statusMsg && (
          <div className="flex flex-col items-center gap-3 mt-8">
            <svg
              width="24" height="24" viewBox="0 0 24 24"
              fill="none" className="animate-spin text-accent"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <p className="text-[11px] text-text-muted animate-pulse">
              {activePersona?.name ?? "Agent"} is thinking…
            </p>
          </div>
        )}

        {error && <p className="text-red-400 text-[11px]">{error}</p>}

        {response}

        {/* Blinking cursor while streaming */}
        {streaming && response && (
          <span className="inline-block h-3 w-1.5 animate-pulse bg-accent align-text-bottom ml-0.5 rounded-sm" />
        )}

        {/* ── Pending file writes (agent-initiated) ──────────────── */}
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
                    prev.map((w) => w.id === id ? { ...w, status: "applying" } : w),
                  );
                }}
                onDone={(id, absPath, finalContent) => {
                  setPendingWrites((prev) =>
                    prev.map((w) => w.id === id ? { ...w, status: "done" } : w),
                  );
                  if (absPath) {
                    const write = pendingWrites.find((w) => w.id === id);
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
                    prev.map((w) => w.id === id ? { ...w, status: "error", errorMsg: msg } : w),
                  );
                }}
                onDismiss={(id) => {
                  setPendingWrites((prev) => prev.filter((w) => w.id !== id));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Context strategy badge ─────────────────────────────────── */}
      {strategy && !streaming && (
        <div className="shrink-0 border-t border-border px-3 py-1">
          <p className="text-[9px] text-text-muted opacity-70">{strategyLabel(strategy)}</p>
        </div>
      )}

      {/* ── Input area ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        <textarea
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleRun();
            }
          }}
          placeholder={
            isSystemPersonaActive
              ? `Use the panel above to run ${activePersona?.name ?? "this agent"}`
              : activePersona
              ? `Ask ${activePersona.name}… (⌘↵ to run)`
              : "Select a persona first"
          }
          disabled={!activePersona || streaming || isSystemPersonaActive}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5">
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex-1 rounded-md bg-red-500/20 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!activePersona || !hasApiKey || !userMessage.trim() || isSystemPersonaActive}
              className="flex-1 rounded-md bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▶ Run {activePersona?.icon ?? ""}
            </button>
          )}
          {(response || pendingWrites.length > 0) && !streaming && (
            <button
              onClick={() => {
                setResponse("");
                setError("");
                setUserMessage("");
                setStrategy(null);
                setStatusMsg("");
                setPendingWrites([]);
              }}
              title="Clear"
              className="rounded-md px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── History ────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="shrink-0 border-t border-border">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          >
            <span className="font-semibold uppercase tracking-widest">History ({history.length})</span>
            <span>{showHistory ? "▾" : "▸"}</span>
          </button>
          {showHistory && (
            <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
              {history.slice(0, 10).map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setUserMessage(h.userMessage);
                    setResponse(h.response);
                  }}
                  className="w-full rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-left text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <span className="font-medium text-text-secondary truncate block">
                    {h.userMessage.slice(0, 60)}{h.userMessage.length > 60 ? "…" : ""}
                  </span>
                  <span className="opacity-60">
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </span>
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
      )}
    </div>
  );
}
