import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { toastError } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";

export function useDebouncedSave(
  markSaved: () => void,
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error", error?: string | null) => void,
  delay = 1000,
) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  return useCallback(
    (path: string | null, content: string) => {
      if (!path) return;
      const existing = timers.current.get(path);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        setSaveStatus("saving");
        try {
          await invoke("save_note", { path, content });
          if (useStore.getState().activeFilePath === path) {
            markSaved();
          }
        } catch (err) {
          const msg = formatError(err);
          setSaveStatus("error", msg);
          toastError(`Auto-save failed: ${msg}`);
        } finally {
          timers.current.delete(path);
        }
      }, delay);
      timers.current.set(path, timer);
    },
    [markSaved, setSaveStatus, delay],
  );
}
