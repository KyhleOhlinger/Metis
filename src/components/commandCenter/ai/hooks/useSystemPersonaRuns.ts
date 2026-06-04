import { useCallback, useMemo, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, syncUiAfterDiskWrites, type DiskWrite } from "@/store/useStore";
import { usePersonaStore, selectProfileForPersona } from "@/store/usePersonaStore";
import { streamResponse } from "@/services/aiService";
import { buildOrphanReport } from "@/systemPersonas/librarianContext";
import {
  buildTaskContext,
  parseTodoTaskEntries,
  applyTaskStatusUpdates,
  collectVaultTasksForTodo,
  buildTodoSyncContent,
} from "@/systemPersonas/taskManagerContext";
import { transcribeHandwritingImage } from "@/services/ocrService";
import {
  buildHandwritingNoteMarkdown,
  collectHandwritingImages,
  mimeTypeForImagePath,
} from "@/utils/handwriting";
import { MAX_HANDWRITING_OCR_BATCH } from "@/systemPersonas/registry";
import type { Persona, HistoryEntry } from "@/types/persona";
import type { ContextStrategy } from "@/services/contextBuilder";
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

  let orphanContext: string;
  try {
    const { noteIndex } = useStore.getState();
    orphanContext = await buildOrphanReport(noteIndex, setStatusMsg);
  } catch (e) {
    setError(`Vault scan failed: ${String(e)}`);
    setStreaming(false);
    return;
  }

  setStatusMsg("");
  setStrategy({ type: "single-file", chars: orphanContext.length });

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
      onDone: (text) => {
        setStreaming(false);
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
      },
    },
  );
  abortRef.current = controller;
}, [activePersona, hasApiKey, streaming, settings, onAddHistory]);

// ── Task Manager: vault-wide task scan + todo.md auto-write ────────────────
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

  let taskContext: string;
  try {
    const { noteIndex } = useStore.getState();
    taskContext = await buildTaskContext(noteIndex, setStatusMsg);
  } catch (e) {
    setError(`Task scan failed: ${String(e)}`);
    setStreaming(false);
    return;
  }

  setStatusMsg("");
  setStrategy({ type: "single-file", chars: taskContext.length });

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
      onDone: async (text) => {
        setStreaming(false);
        // Auto-write the result to summaries/todo.md using agent_write_note
        if (vaultPath && text.trim()) {
          try {
            const relPath = `${vaultPath}/summaries/todo.md`;
            const absPath = await invoke<string>("agent_write_note", { relPath, content: text });
            await syncUiAfterDiskWrites([{ path: absPath, content: text }]);
            setStatusMsg("✓ todo.md written to summaries/");
          } catch (e) {
            setStatusMsg(`Could not write todo.md: ${String(e)}`);
          }
        }
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
      },
    },
  );
  abortRef.current = controller;
  }, [activePersona, hasApiKey, streaming, settings, vaultPath, onAddHistory]);

// ── Task Manager: bi-directional checkbox sync (todo.md ↔ source notes) ───
const handleTaskSync = useCallback(async () => {
  if (streaming || !vaultPath) return;

  setError("");
  setResponse("");
  setStrategy(null);
  setPendingWrites([]);
  setStatusMsg("Syncing todo.md with source notes…");
  setStreaming(true);

  const todoPath = `${vaultPath}/summaries/todo.md`;
  const { noteIndex } = useStore.getState();
  const byName = new Map(
    noteIndex.map((n) => [n.name.replace(/\.md$/i, "").toLowerCase(), n]),
  );

  try {
    // 1) Apply todo.md checkbox state changes back into source notes.
    const todoContent = await invoke<string>("get_file_content", { path: todoPath }).catch(() => "");
    const todoEntries = parseTodoTaskEntries(todoContent);

    const updatesByPath = new Map<string, Array<{ text: string; checked: boolean }>>();
    for (const e of todoEntries) {
      const src = byName.get(e.sourceName.toLowerCase());
      if (!src) continue;
      const list = updatesByPath.get(src.path) ?? [];
      list.push({ text: e.text, checked: e.checked });
      updatesByPath.set(src.path, list);
    }

    let updatedNotes = 0;
    const diskWrites: DiskWrite[] = [];
    for (const [path, updates] of updatesByPath) {
      const content = await invoke<string>("get_file_content", { path }).catch(() => "");
      if (!content) continue;
      const applied = applyTaskStatusUpdates(content, updates);
      if (!applied.changed) continue;
      await invoke("save_note", { path, content: applied.content });
      diskWrites.push({ path, content: applied.content });
      updatedNotes += 1;
    }

    // 2) Rebuild todo.md from current source task state (both open + completed).
    const tasksByNote = await collectVaultTasksForTodo(noteIndex, setStatusMsg);
    const syncedTodo = buildTodoSyncContent(tasksByNote);
    const todoAbsPath = await invoke<string>("agent_write_note", { relPath: todoPath, content: syncedTodo });
    diskWrites.push({ path: todoAbsPath, content: syncedTodo });
    await syncUiAfterDiskWrites(diskWrites);

    setResponse(
      `Task sync complete.\n\n` +
      `- Updated source notes: ${updatedNotes}\n` +
      `- Synced task notes: ${tasksByNote.length}\n` +
      `- Wrote: summaries/todo.md`,
    );
    setStatusMsg("✓ Vault task sync complete");
  } catch (e) {
    setError(`Task sync failed: ${String(e)}`);
  } finally {
    setStreaming(false);
  }
  }, [streaming, vaultPath]);

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
    if (!window.confirm(confirmMsg)) return;

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

    const lines: string[] = [];
    const diskWrites: DiskWrite[] = [];

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

        const content = buildHandwritingNoteMarkdown(
          img.relativePath,
          img.fileName,
          result.text,
        );
        const absPath = await invoke<string>("agent_write_note", {
          relPath: img.mdPath,
          content,
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
        userMessage: `Handwriting OCR (${mode}): ${images.length} image(s)`,
        response: lines.join("\n"),
      });
    } catch (e) {
      setError(`Handwriting OCR failed: ${String(e)}`);
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
    runHandwritingOcr,
    handwritingPendingCount,
    handwritingTotalCount,
  };
}
