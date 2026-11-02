import { useCallback, useEffect, useRef } from "react";
import {
  flushNoteAutosaves,
  registerNoteAutosaveHandlers,
  scheduleNoteAutosave,
} from "@/hooks/noteAutosave";

export function useDebouncedSave(
  markSaved: () => void,
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error", error?: string | null) => void,
  delay = 1000,
) {
  const markRef = useRef(markSaved);
  const statusRef = useRef(setSaveStatus);
  markRef.current = markSaved;
  statusRef.current = setSaveStatus;

  useEffect(() => {
    registerNoteAutosaveHandlers({
      markSaved: () => markRef.current(),
      setSaveStatus: (status, error) => statusRef.current(status, error),
    });
    return () => {
      void flushNoteAutosaves();
    };
  }, []);

  return useCallback(
    (path: string | null, content: string) => {
      scheduleNoteAutosave(path, content, delay);
    },
    [delay],
  );
}
