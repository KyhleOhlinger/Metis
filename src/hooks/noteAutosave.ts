import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";

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

export function rememberCommittedNote(path: string, content: string) {
  if (!path) return;
  committed.set(path, content);
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
      try {
        await invoke("save_note", { path, content });
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
        }
      } catch (err) {
        const msg = formatError(err);
        handlers.setSaveStatus("error", msg);
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

export async function flushNoteAutosaves(): Promise<void> {
  const paths = new Set<string>([...desired.keys(), ...timers.keys()]);
  const jobs: Promise<void>[] = [];
  for (const path of paths) {
    clearTimer(path);
    if (desired.has(path)) jobs.push(enqueue(path));
  }
  await Promise.all(jobs);
}
