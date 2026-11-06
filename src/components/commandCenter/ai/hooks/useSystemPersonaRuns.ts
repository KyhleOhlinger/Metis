import { useCallback, useMemo, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadVaultFile, loadVaultFiles } from "@/utils/vaultRead";
import { useStore, type DiskWrite } from "@/store/useStore";
import { syncUiAfterDiskWrites } from "@/store/vaultSync";
import { usePersonaStore, selectProfileForPersona } from "@/store/usePersonaStore";
import { streamResponse } from "@/services/llmService";
import { buildOrphanReport } from "@/systemPersonas/librarianContext";
import {
  buildTaskContext,
  parseTodoTaskEntries,
  applyTaskStatusUpdates,
  collectVaultTasksForTodo,
  buildTodoSyncContent,
  planTaskSync,
  snapshotFromNotes,
  vaultRelativeNote,
  type TaskSyncSnapshot,
} from "@/systemPersonas/taskManagerContext";
import {
  buildPlannerContext,
  plannerJobTrigger,
  type PlannerPersonaJob,
} from "@/systemPersonas/plannerContext";
import { estimateContextEgress } from "@/services/contextBuilder";
import { confirmEstimatedEgress, destinationHostOf } from "@/components/egressConfirm";
import { transcribeHandwritingImage } from "@/services/ocrService";
import {
  recordAgentRun,
} from "@/services/agentRunLogService";
import {
  buildHandwritingNoteMarkdown,
  collectHandwritingImages,
  mimeTypeForImagePath,
} from "@/utils/handwriting";
import { MAX_HANDWRITING_OCR_BATCH } from "@/systemPersonas/registry";
import type { Persona, HistoryEntry } from "@/types/persona";
import type { ContextStrategy } from "@/services/contextBuilder";
import { appConfirm } from "@/store/useToastStore";
import type { FileNode } from "@/store/useStore";
import type { PendingWrite } from "../../agent/pendingWrite.types";

export type SystemPersonaRunUi = {
  activePersona: Persona | undefined;
  hasApiKey: boolean;
  streaming: boolean;
  vaultPath: string | null;
  files: FileNode[];
  settings: ReturnType<typeof usePersonaStore.getState>["settings"];
  onAddHistory: (entry: HistoryEntry) => void;
  setError: (v: string) => void;
  setResponse: (v: string | ((p: string) => string)) => void;
  setStrategy: (v: ContextStrategy | null) => void;
  setStatusMsg: (v: string) => void;
  setPendingWrites: (v: PendingWrite[]) => void;
  setStreaming: (v: boolean) => void;
  abortRef: MutableRefObject<AbortController | null>;
};

export function useSystemPersonaRuns(ui: SystemPersonaRunUi) {
  const {
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
  } = ui;

  const handleLibrarianScan = useCallback(async () => {
  if (!activePersona || !hasApiKey || streaming) return;

  setError("");
  setResponse("");
  setStrategy(null);
  setStatusMsg("Preparing vault scan…");
  setPendingWrites([]);
  setStreaming(true);

  const profile = selectProfileForPersona(
    { ...usePersonaStore.getState(), settings },
    activePersona,
  );
  if (!profile) {
    setStreaming(false);
    setError("No API provider configured for this persona.");
    return;
  }

  const { noteIndex } = useStore.getState();
  const gate = await confirmEstimatedEgress(async () => ({
    noteCount: noteIndex.length,
    totalCharsInScope: noteIndex.length,
    estimatedContextChars: noteIndex.length,
    plannedTier: "direct",
    budgetChars: 0,
    extraScoutApiCall: false,
    scopeLabel: "Librarian vault scan",
    requiresConfirm: true,
    providerLabel: profile.name?.trim() || profile.baseUrl,
    destinationHost: destinationHostOf(profile.baseUrl),
    profileId: profile.id,
    fileNames: noteIndex.slice(0, 8).map((note) => note.name),
    estimatedImageCount: 0,
    imagesMayBeAttached: false,
    contentKind: "notes",
  }));
  if (!gate.proceed) {
    setStreaming(false);
    if (gate.reason === "error") setError(gate.message);
    return;
  }

  let orphanContext: string;
  try {
    orphanContext = await buildOrphanReport(noteIndex, setStatusMsg);
  } catch (e) {
    setError(`Vault scan failed: ${String(e)}`);
    setStreaming(false);
    return;
  }

  setStatusMsg("");
  setStrategy({ type: "single-file", chars: orphanContext.length });

  const startedAt = Date.now();
  const trigger =
    "Analyse the vault link graph above. Provide your full Librarian report: " +
    "list every orphaned note, suggest specific [[wikilinks]] to fix each one, " +
    "and close with a summary of overall graph health.";

  const controller = streamResponse(
    activePersona,
    orphanContext,
    trigger,
    profile,
    {
      onChunk: (chunk) => setResponse((prev) => prev + chunk),
      onDone: (text, _toolCalls, meta) => {
        setStreaming(false);
        void recordAgentRun({
          startedAt,
          status: "success",
          persona: activePersona,
          profile,
          agentType: "librarian",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: trigger,
          response: text,
          context: orphanContext,
          systemPrompt: activePersona.systemPrompt,
          contextStrategy: { type: "single-file", chars: orphanContext.length },
          meta,
        });
        onAddHistory({
          id: `h-${Date.now()}`,
          timestamp: Date.now(),
          personaId: activePersona.id,
          scope: { type: "full-vault" },
          userMessage: trigger,
          response: text,
        });
      },
      onError: (err) => {
        setStreaming(false);
        setError(err.message);
        void recordAgentRun({
          startedAt,
          status: "error",
          persona: activePersona,
          profile,
          agentType: "librarian",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: trigger,
          errorMessage: err.message,
          context: orphanContext,
          systemPrompt: activePersona.systemPrompt,
          contextStrategy: { type: "single-file", chars: orphanContext.length },
        });
      },
    },
  );
  abortRef.current = controller;
}, [activePersona, hasApiKey, streaming, settings, onAddHistory, vaultPath]);

// ── Task Manager: vault-wide task scan → pending Apply for todo.md ────────
const handleTaskScan = useCallback(async () => {
  if (!activePersona || !hasApiKey || streaming) return;

  setError("");
  setResponse("");
  setStrategy(null);
  setStatusMsg("Scanning for tasks…");
  setPendingWrites([]);
  setStreaming(true);

  const profile = selectProfileForPersona(
    { ...usePersonaStore.getState(), settings },
    activePersona,
  );
  if (!profile) {
    setStreaming(false);
    setError("No API provider configured for this persona.");
    return;
  }

  const { noteIndex } = useStore.getState();
  const gate = await confirmEstimatedEgress(async () => ({
    noteCount: noteIndex.length,
    totalCharsInScope: noteIndex.length,
    estimatedContextChars: noteIndex.length,
    plannedTier: "direct",
    budgetChars: 0,
    extraScoutApiCall: false,
    scopeLabel: "Task Manager vault scan",
    requiresConfirm: true,
    providerLabel: profile.name?.trim() || profile.baseUrl,
    destinationHost: destinationHostOf(profile.baseUrl),
    profileId: profile.id,
    fileNames: noteIndex.slice(0, 8).map((note) => note.name),
    estimatedImageCount: 0,
    imagesMayBeAttached: false,
    contentKind: "notes",
  }));
  if (!gate.proceed) {
    setStreaming(false);
    if (gate.reason === "error") setError(gate.message);
    return;
  }

  let taskContext: string;
  try {
    taskContext = await buildTaskContext(noteIndex, setStatusMsg, vaultPath);
  } catch (e) {
    setError(`Task scan failed: ${String(e)}`);
    setStreaming(false);
    return;
  }

  setStatusMsg("");
  setStrategy({ type: "single-file", chars: taskContext.length });

  const startedAt = Date.now();
  const trigger =
    "Using only the incomplete open tasks listed above, produce the complete contents of todo.md. " +
    "Do not include completed/checked items. " +
    "Follow your system-prompt format exactly: frontmatter → ## Overview → one ## [[Note]] section per source note, " +
    "and ensure each task line includes its source-note wikilink.";

  const controller = streamResponse(
    activePersona,
    taskContext,
    trigger,
    profile,
    {
      onChunk: (chunk) => setResponse((prev) => prev + chunk),
      onDone: (text, _toolCalls, meta) => {
        setStreaming(false);
        if (vaultPath && text.trim()) {
          setPendingWrites([{
            id: `task-scan-todo-${Date.now()}`,
            tool: "create_new_note",
            path: "summaries/todo.md",
            content: text,
            status: "pending",
          }]);
          setStatusMsg("Review the draft below, then Apply to write summaries/todo.md.");
        }
        void recordAgentRun({
          startedAt,
          status: "success",
          persona: activePersona,
          profile,
          agentType: "task-scan",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: trigger,
          response: text,
          context: taskContext,
          systemPrompt: activePersona.systemPrompt,
          contextStrategy: { type: "single-file", chars: taskContext.length },
          meta,
        });
        onAddHistory({
          id: `h-${Date.now()}`,
          timestamp: Date.now(),
          personaId: activePersona.id,
          scope: { type: "full-vault" },
          userMessage: trigger,
          response: text,
        });
      },
      onError: (err) => {
        setStreaming(false);
        setError(err.message);
        void recordAgentRun({
          startedAt,
          status: "error",
          persona: activePersona,
          profile,
          agentType: "task-scan",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: trigger,
          errorMessage: err.message,
          context: taskContext,
          systemPrompt: activePersona.systemPrompt,
          contextStrategy: { type: "single-file", chars: taskContext.length },
        });
      },
    },
  );
  abortRef.current = controller;
  }, [activePersona, hasApiKey, streaming, settings, vaultPath, onAddHistory]);

// ── Task Manager: bi-directional checkbox sync (todo.md ↔ source notes) ───
const handleTaskSync = useCallback(async () => {
  if (streaming || !vaultPath) return;

  const ok = await appConfirm(
    "Apply checkbox changes from summaries/todo.md to source notes, then rebuild todo.md from the vault?",
    { title: "Vault task sync", confirmLabel: "Sync" },
  );
  if (!ok) return;

  setError("");
  setResponse("");
  setStrategy(null);
  setPendingWrites([]);
  setStatusMsg("Syncing todo.md with source notes…");
  setStreaming(true);
  const startedAt = Date.now();

  const todoPath = `${vaultPath}/summaries/todo.md`;
  const { noteIndex } = useStore.getState();

  try {
    const { saveCleanNote, noteHasUnsavedEdits } = await import("@/hooks/noteAutosave");
    const todoContent = await loadVaultFile(todoPath).catch(() => "");
    const todoEntries = parseTodoTaskEntries(todoContent);
    const rawSnapshot = await invoke<string>("load_task_sync_snapshot").catch(() => "{}");
    const snapshot = JSON.parse(rawSnapshot) as TaskSyncSnapshot;
    const sources = [...new Set(todoEntries.map((entry) => entry.sourcePath))];
    const absPaths = sources.map((source) => `${vaultPath}/${source}.md`);
    const bodies = await loadVaultFiles(absPaths);
    const planned = planTaskSync({
      todoEntries,
      snapshot: snapshot.tasks ? snapshot : { tasks: [] },
      notes: sources.map((source, index) => ({ source, content: bodies[index] ?? "" })),
    });
    const preview = [...planned.updates.entries()].flatMap(([source, lines]) =>
      lines.map((line) => `${source}.md: ${line.checked ? "check" : "uncheck"} ${line.text}`),
    );
    if (preview.length || planned.conflicts.length) {
      const lines = [
        preview.length ? `Will change:\n${preview.slice(0, 12).join("\n")}` : "No checkbox changes to apply.",
        planned.conflicts.length ? `\nLeft unchanged:\n${planned.conflicts.slice(0, 8).join("\n")}` : "",
      ];
      const proceed = await appConfirm(lines.join("\n"), {
        title: "Task sync preview",
        confirmLabel: "Apply sync",
      });
      if (!proceed) {
        setStreaming(false);
        setStatusMsg("");
        return;
      }
    }

    let updatedNotes = 0;
    const diskWrites: DiskWrite[] = [];
    const skippedDirty: string[] = [];
    for (const [source, updates] of planned.updates) {
      const path = `${vaultPath}/${source}.md`;
      if (noteHasUnsavedEdits(path)) {
        skippedDirty.push(vaultRelativeNote(path, vaultPath));
        continue;
      }
      const content = bodies[sources.indexOf(source)] ?? "";
      if (!content) continue;
      const applied = applyTaskStatusUpdates(content, updates);
      if (!applied.changed) continue;
      await saveCleanNote(path, applied.content);
      diskWrites.push({ path, content: applied.content });
      updatedNotes += 1;
    }

    const tasksByNote = await collectVaultTasksForTodo(noteIndex, setStatusMsg);
    const syncedTodo = buildTodoSyncContent(tasksByNote, vaultPath);
    if (noteHasUnsavedEdits(todoPath)) {
      skippedDirty.push("summaries/todo.md");
    } else {
      await saveCleanNote(todoPath, syncedTodo).catch(async () => {
        await invoke("agent_write_note", {
          relPath: "summaries/todo.md",
          content: syncedTodo,
          mode: "overwrite",
        });
      });
      diskWrites.push({ path: todoPath, content: syncedTodo });
    }
    await invoke("save_task_sync_snapshot", {
      json: JSON.stringify(snapshotFromNotes(tasksByNote, vaultPath)),
    });
    await syncUiAfterDiskWrites(diskWrites);
    const dirtyNote = skippedDirty.length ? `\n- Skipped unsaved notes: ${skippedDirty.join(", ")}` : "";
    const conflictNote = planned.conflicts.length ? `\n- Conflicts left unchanged: ${planned.conflicts.length}` : "";

    setResponse(
      `Task sync complete.\n\n` +
      `- Updated source notes: ${updatedNotes}\n` +
      `- Synced task notes: ${tasksByNote.length}\n` +
      `- Wrote: summaries/todo.md${dirtyNote}${conflictNote}`,
    );
    setStatusMsg("✓ Vault task sync complete");
    if (activePersona) {
      const profile = selectProfileForPersona(
        { ...usePersonaStore.getState(), settings },
        activePersona,
      );
      if (profile) {
        void recordAgentRun({
          startedAt,
          status: "success",
          persona: activePersona,
          profile,
          agentType: "task-sync",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: "Task sync (todo.md ↔ source notes)",
          response: `Updated ${updatedNotes} note(s); synced ${tasksByNote.length} task note(s).`,
          systemPrompt: activePersona.systemPrompt,
        });
      }
    }
  } catch (e) {
    setError(`Task sync failed: ${String(e)}`);
    if (activePersona) {
      const profile = selectProfileForPersona(
        { ...usePersonaStore.getState(), settings },
        activePersona,
      );
      if (profile) {
        void recordAgentRun({
          startedAt,
          status: "error",
          persona: activePersona,
          profile,
          agentType: "task-sync",
          scope: { type: "full-vault" },
          activeFilePath: null,
          vaultPath,
          userMessage: "Task sync (todo.md ↔ source notes)",
          errorMessage: String(e),
          systemPrompt: activePersona.systemPrompt,
        });
      }
    }
  } finally {
    setStreaming(false);
  }
  }, [streaming, vaultPath, activePersona, settings]);

  const handlePlannerJob = useCallback(
    async (job: PlannerPersonaJob) => {
      if (!activePersona || !hasApiKey || streaming || !vaultPath) return;

      const profile = selectProfileForPersona(
        { ...usePersonaStore.getState(), settings },
        activePersona,
      );
      if (!profile) {
        setError("No API provider configured for this persona.");
        return;
      }

      const trigger = plannerJobTrigger(job);
      const runScope = { type: "planner" as const };

      const gate = await confirmEstimatedEgress(() =>
        estimateContextEgress(
          runScope,
          trigger,
          activePersona,
          profile,
          "",
          null,
          vaultPath,
          false,
        ),
      );
      if (!gate.proceed) {
        if (gate.reason === "error") setError(gate.message);
        return;
      }

      setError("");
      setResponse("");
      setStrategy(null);
      setStatusMsg("Loading active planner…");
      setPendingWrites([]);
      setStreaming(true);

      let plannerContext: string;
      try {
        const built = await buildPlannerContext(vaultPath);
        plannerContext = built.context;
      } catch (e) {
        setError(`Planner load failed: ${String(e)}`);
        setStreaming(false);
        return;
      }

      setStatusMsg("");
      setStrategy({ type: "planner", chars: plannerContext.length });

      const startedAt = Date.now();
      const controller = streamResponse(
        activePersona,
        plannerContext,
        trigger,
        profile,
        {
          onChunk: (chunk) => setResponse((prev) => prev + chunk),
          onDone: (text, _toolCalls, meta) => {
            setStreaming(false);
            void recordAgentRun({
              startedAt,
              status: "success",
              persona: activePersona,
              profile,
              agentType: "planner",
              scope: runScope,
              activeFilePath: null,
              vaultPath,
              userMessage: trigger,
              response: text,
              context: plannerContext,
              systemPrompt: activePersona.systemPrompt,
              contextStrategy: { type: "planner", chars: plannerContext.length },
              meta,
            });
            onAddHistory({
              id: `h-${Date.now()}`,
              timestamp: Date.now(),
              personaId: activePersona.id,
              scope: runScope,
              userMessage: trigger,
              response: text,
            });
          },
          onError: (err) => {
            setStreaming(false);
            setError(err.message);
            void recordAgentRun({
              startedAt,
              status: "error",
              persona: activePersona,
              profile,
              agentType: "planner",
              scope: runScope,
              activeFilePath: null,
              vaultPath,
              userMessage: trigger,
              errorMessage: err.message,
              context: plannerContext,
              systemPrompt: activePersona.systemPrompt,
              contextStrategy: { type: "planner", chars: plannerContext.length },
            });
          },
        },
      );
      abortRef.current = controller;
    },
    [activePersona, hasApiKey, streaming, vaultPath, settings, onAddHistory],
  );

  const runHandwritingOcr = useCallback(
  async (mode: "pending" | "all") => {
    if (!activePersona || !hasApiKey || streaming || !vaultPath) return;

    let images = collectHandwritingImages(files, vaultPath, mode);
    if (!images.length) {
      setError(
        mode === "pending"
          ? "No new images in handwritten/ — add photos there, or use Re-transcribe all."
          : "No images in handwritten/. Add photos to that Space in the sidebar first.",
      );
      return;
    }

    let batchNote = "";
    if (images.length > MAX_HANDWRITING_OCR_BATCH) {
      images = images.slice(0, MAX_HANDWRITING_OCR_BATCH);
      batchNote = ` (first ${MAX_HANDWRITING_OCR_BATCH} only)`;
    }

    const willOverwrite = images.some((i) => i.hasExistingNote);
    const confirmMsg = willOverwrite
      ? `Transcribe ${images.length} image(s)${batchNote}? Existing .md files with the same name will be overwritten.`
      : `Transcribe ${images.length} image(s)${batchNote} into Markdown notes in handwritten/?`;
    const ok = await appConfirm(confirmMsg, {
      title: "Handwriting OCR",
      confirmLabel: "Transcribe",
      danger: willOverwrite,
    });
    if (!ok) return;

    const profile = selectProfileForPersona(
      { ...usePersonaStore.getState(), settings },
      activePersona,
    );
    if (!profile) {
      setError("No API provider configured for this persona.");
      return;
    }

    setError("");
    setResponse("");
    setStrategy(null);
    setPendingWrites([]);
    setStreaming(true);
    const startedAt = Date.now();
    const ocrTrigger = `Handwriting OCR (${mode}): ${images.length} image(s)`;

    const lines: string[] = [];
    const diskWrites: DiskWrite[] = [];
    let totalDurationMs = 0;
    let totalPrompt = 0;
    let totalCompletion = 0;

    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i]!;
        setStatusMsg(`Reading ${img.fileName} (${i + 1}/${images.length})…`);

        const payload = await invoke<{ data_base64: string; mime_type: string }>(
          "read_vault_image_base64",
          { path: img.path },
        );

        setStatusMsg(`Transcribing ${img.fileName} (${i + 1}/${images.length})…`);
        const mime =
          payload.mime_type || mimeTypeForImagePath(img.path);
        const result = await transcribeHandwritingImage(
          activePersona,
          profile,
          payload.data_base64,
          mime,
          img.fileName,
        );

        if (!result.ok) {
          lines.push(`✗ ${img.fileName}: ${result.error}`);
          continue;
        }

        if (result.meta) {
          totalDurationMs += result.meta.durationMs;
          if (result.meta.usage) {
            totalPrompt += result.meta.usage.promptTokens;
            totalCompletion += result.meta.usage.completionTokens;
          }
        }

        const content = buildHandwritingNoteMarkdown(
          img.relativePath,
          img.fileName,
          result.text,
        );
        const absPath = await invoke<string>("agent_write_note", {
          relPath: img.mdPath,
          content,
          mode: "overwrite",
        });
        diskWrites.push({ path: absPath, content });
        lines.push(`✓ ${img.fileName} → ${img.fileName.replace(/\.[^.]+$/i, ".md")}`);
      }

      if (diskWrites.length) {
        await syncUiAfterDiskWrites(diskWrites);
        await useStore.getState().refreshVault();
      }

      setResponse(lines.join("\n"));
      setStatusMsg(
        diskWrites.length
          ? `✓ Wrote ${diskWrites.length} note${diskWrites.length !== 1 ? "s" : ""} to handwritten/`
          : "No notes were written.",
      );
      onAddHistory({
        id: `h-${Date.now()}`,
        timestamp: Date.now(),
        personaId: activePersona.id,
        scope: { type: "specific-folder", folderPath: `${vaultPath}/handwritten` },
        userMessage: ocrTrigger,
        response: lines.join("\n"),
      });
      void recordAgentRun({
        startedAt,
        status: "success",
        persona: activePersona,
        profile,
        agentType: "handwriting-ocr",
        scope: { type: "specific-folder", folderPath: `${vaultPath}/handwritten` },
        activeFilePath: null,
        vaultPath,
        userMessage: ocrTrigger,
        response: lines.join("\n"),
        systemPrompt: activePersona.systemPrompt,
        attachedImages: images.map((img) => img.fileName),
        meta: {
          durationMs: totalDurationMs || Date.now() - startedAt,
          usage:
            totalPrompt + totalCompletion > 0
              ? {
                  promptTokens: totalPrompt,
                  completionTokens: totalCompletion,
                  totalTokens: totalPrompt + totalCompletion,
                }
              : undefined,
        },
      });
    } catch (e) {
      setError(`Handwriting OCR failed: ${String(e)}`);
      void recordAgentRun({
        startedAt,
        status: "error",
        persona: activePersona,
        profile,
        agentType: "handwriting-ocr",
        scope: { type: "specific-folder", folderPath: `${vaultPath}/handwritten` },
        activeFilePath: null,
        vaultPath,
        userMessage: ocrTrigger,
        errorMessage: String(e),
        systemPrompt: activePersona.systemPrompt,
        attachedImages: images.map((img) => img.fileName),
      });
    } finally {
      setStreaming(false);
    }
  },
    [activePersona, hasApiKey, streaming, vaultPath, files, settings, onAddHistory],
  );

  const handwritingPendingCount = useMemo(() => {
    if (!vaultPath) return 0;
    return collectHandwritingImages(files, vaultPath, "pending").length;
  }, [files, vaultPath]);

  const handwritingTotalCount = useMemo(() => {
    if (!vaultPath) return 0;
    return collectHandwritingImages(files, vaultPath, "all").length;
  }, [files, vaultPath]);

  return {
    handleLibrarianScan,
    handleTaskScan,
    handleTaskSync,
    handlePlannerJob,
    runHandwritingOcr,
    handwritingPendingCount,
    handwritingTotalCount,
  };
}
