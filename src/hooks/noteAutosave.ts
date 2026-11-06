import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { appConfirm, toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { recordVaultActivity } from "@/store/useVaultActivityStore";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Handlers = {
  markSaved: () => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
};

/**
 * One in-flight write per path. A newer edit replaces `desired` and is written
 * only after the previous invoke finishes, so an older snapshot cannot land last.
 */
let handlers: Handlers = {
  markSaved: () => useStore.getState().markSaved(),
  setSaveStatus: (status, error) => useStore.getState().setSaveStatus(status, error),
};

const desired = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const chains = new Map<string, Promise<void>>();
/** Last content known to match disk, so a discarded in-flight write can be undone. */
const committed = new Map<string, string>();
/** Bumped on discard. An invoke that started under an older value restores `committed`. */
const generation = new Map<string, number>();
/** Disk mtime in milliseconds, captured when the note was opened or last saved. */
const diskStamp = new Map<string, number>();

export function rememberCommittedNote(path: string, content: string) {
  if (!path) return;
  committed.set(path, content);
}

export function rememberNoteDiskStamp(path: string, mtimeMs: number) {
  if (!path) return;
  diskStamp.set(path, mtimeMs);
}

function currentGeneration(path: string): number {
  return generation.get(path) ?? 0;
}

export function registerNoteAutosaveHandlers(next: Handlers) {
  handlers = next;
}

function clearTimer(path: string) {
  const timer = timers.get(path);
  if (timer) clearTimeout(timer);
  timers.delete(path);
}

function markIfCurrent(path: string, content: string) {
  const state = useStore.getState();
  if (state.activeFilePath === path && state.activeFileContent === content) {
    handlers.markSaved();
  }
}

function enqueue(path: string): Promise<void> {
  const prev = chains.get(path) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const content = desired.get(path);
      if (content === undefined) return;
      if (!path.toLowerCase().endsWith(".md")) {
        desired.delete(path);
        return;
      }
      // Discard or a newer schedule may have cleared this snapshot while we waited.
      if (desired.get(path) !== content) return;
      const gen = currentGeneration(path);
      handlers.setSaveStatus("saving");
      const stamp = diskStamp.get(path);
      try {
        const written = await invoke<number>("save_note", {
          path,
          content,
          baselineMtimeMs: stamp ?? null,
          mustExist: stamp !== undefined,
        });
        diskStamp.set(path, written);
        if (currentGeneration(path) !== gen) {
          const restore = committed.get(path);
          if (restore !== undefined && restore !== content) {
            await invoke("save_note", { path, content: restore });
          }
          return;
        }
        if (desired.get(path) === content) {
          desired.delete(path);
          committed.set(path, content);
          markIfCurrent(path, content);
          recordVaultActivity(useStore.getState().vaultPath, { saveAt: Date.now(), saveError: null });
        }
      } catch (err) {
        const msg = formatError(err);
        handlers.setSaveStatus("error", msg);
        recordVaultActivity(useStore.getState().vaultPath, { saveError: msg });
        if (msg.includes("NOTE_CONFLICT")) {
          const reload = await appConfirm(
            "This note changed outside the editor. Reload the saved version? Your unsaved edits stay in the editor if you cancel.",
            { title: "Note changed", confirmLabel: "Reload" },
          );
          if (reload) {
            const { loadVaultFile } = await import("@/utils/vaultRead");
            const fresh = await loadVaultFile(path);
            const stamp = await invoke<number>("note_file_stamp", { path });
            diskStamp.set(path, stamp);
            useStore.getState().setActiveFile(path, fresh);
          }
          return;
        }
        if (msg.includes("NOT_FOUND")) {
          toastError("Save failed: the note is no longer on disk.");
          return;
        }
        toastError(`Save failed: ${msg}`);
      }
    });
  chains.set(path, run);
  return run;
}

export function scheduleNoteAutosave(path: string | null, content: string, delay = 1000) {
  if (!path || !path.toLowerCase().endsWith(".md")) return;
  desired.set(path, content);
  clearTimer(path);
  const timer = setTimeout(() => {
    timers.delete(path);
    void enqueue(path);
  }, delay);
  timers.set(path, timer);
}

/** Write the current buffer immediately and cancel a pending debounced write of this path. */
export function saveNoteNow(path: string, content: string): Promise<void> {
  if (!path.toLowerCase().endsWith(".md")) return Promise.resolve();
  desired.set(path, content);
  clearTimer(path);
  return enqueue(path);
}

/** Drop a pending debounced write so Discard does not persist the buffer. */
export function cancelNoteAutosave(path: string | null) {
  if (!path) return;
  generation.set(path, currentGeneration(path) + 1);
  desired.delete(path);
  clearTimer(path);
}

/** Cancel pending saves for a file and everything inside a deleted or moved folder. */
export function cancelAutosavesUnder(path: string) {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  for (const key of new Set([...desired.keys(), ...timers.keys()])) {
    if (key === path || key.startsWith(prefix)) cancelNoteAutosave(key);
  }
}

/** Move a pending save onto the path a rename or move just created. */
export function retargetNoteAutosave(from: string, to: string) {
  if (!from || from === to) return;
  const content = desired.get(from);
  const saved = committed.get(from);
  const stamp = diskStamp.get(from);
  cancelNoteAutosave(from);
  committed.delete(from);
  diskStamp.delete(from);
  if (saved !== undefined) committed.set(to, saved);
  if (stamp !== undefined) diskStamp.set(to, stamp);
  if (content !== undefined) scheduleNoteAutosave(to, content);
}

export function retargetAutosavesUnder(from: string, to: string) {
  const prefix = from.endsWith("/") ? from : `${from}/`;
  const keys = new Set([...desired.keys(), ...committed.keys(), ...diskStamp.keys()]);
  for (const key of keys) {
    if (key === from || key.startsWith(prefix)) {
      retargetNoteAutosave(key, to + key.slice(from.length));
    }
  }
}

/** Hash used to detect edits made after an AI suggestion was created. */
export function noteHasUnsavedEdits(path: string): boolean {
  if (!path) return false;
  if (desired.has(path) || timers.has(path)) return true;
  const state = useStore.getState();
  return state.activeFilePath === path && state.isDirty;
}

/** Write a note that has no pending editor edits. A dirty buffer is left untouched. */
export async function saveCleanNote(path: string, content: string): Promise<void> {
  if (noteHasUnsavedEdits(path)) {
    throw new Error(`NOTE_DIRTY: ${path}`);
  }
  clearTimer(path);
  const inflight = chains.get(path);
  if (inflight) await inflight.catch(() => undefined);
  const mtime = await invoke<number>("save_note", {
    path,
    content,
    baselineMtimeMs: diskStamp.get(path),
    mustExist: diskStamp.has(path),
  });
  committed.set(path, content);
  desired.delete(path);
  diskStamp.set(path, mtime);
}

export function noteContentHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Cancel a pending autosave, wait for an in-flight write of this path, then
 * write `content`. An older buffer cannot land after this call.
 */
export async function writeNoteReplacingAutosave(
  path: string,
  content: string,
  mode: "create" | "overwrite",
): Promise<string> {
  clearTimer(path);
  desired.delete(path);
  const inflight = chains.get(path);
  if (inflight) await inflight.catch(() => undefined);
  generation.set(path, currentGeneration(path) + 1);
  const absPath = await invoke<string>("agent_write_note", {
    relPath: path,
    content,
    mode,
  });
  committed.set(path, content);
  desired.delete(path);
  return absPath;
}

export function pendingNoteSnapshots(): Array<{ path: string; content: string }> {
  const notes = new Map<string, string>(desired);
  const state = useStore.getState();
  if (state.activeFilePath && state.isDirty && state.activeFileContent != null) {
    notes.set(state.activeFilePath, state.activeFileContent);
  }
  return [...notes].map(([path, content]) => ({ path, content }));
}

export function discardPendingNoteSaves(): void {
  for (const path of [...desired.keys(), ...timers.keys()]) cancelNoteAutosave(path);
}

export async function flushNoteAutosaves(): Promise<void> {
  const paths = new Set<string>([...desired.keys(), ...timers.keys()]);
  const jobs: Promise<void>[] = [];
  for (const path of paths) {
    clearTimer(path);
    if (desired.has(path)) jobs.push(enqueue(path));
  }
  await Promise.all(jobs);
}
