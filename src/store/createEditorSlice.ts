import type { StateCreator } from "zustand";
import { applyNoteMeta, parseNoteMeta } from "./noteIndexUtils";
import type { MetisState } from "./metisState";

export type EditorSlice = Pick<
  MetisState,
  | "setActiveFile"
  | "setActiveFileContent"
  | "setCursorOffset"
  | "setSelection"
  | "clearSelection"
  | "setActiveFolderPath"
  | "markSaved"
  | "setSaveStatus"
  | "navigateEditorTo"
  | "clearEditorNavigateTo"
>;

export const createEditorSlice: StateCreator<MetisState, [], [], EditorSlice> = (set, get) => ({
  setActiveFile: (path, content) => {
    const meta = parseNoteMeta(content);
    set((s) => ({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      editorTab:
        s.editorTab === "planner" || s.editorTab === "agent-history" ? "source" : s.editorTab,
      noteIndex: s.noteIndex.map((n) => (n.path === path ? applyNoteMeta(n, meta) : n)),
    }));
  },

  setActiveFileContent: (content) => {
    const path = get().activeFilePath;
    const meta = path ? parseNoteMeta(content) : null;
    set((s) => ({
      activeFileContent: content,
      isDirty: true,
      saveStatus: "idle",
      noteIndex:
        meta && path
          ? s.noteIndex.map((n) => (n.path === path ? applyNoteMeta(n, meta) : n))
          : s.noteIndex,
    }));
  },

  setCursorOffset: (offset) => set({ cursorOffset: offset }),

  setSelection: (text, coords, endOffset) =>
    set({ selectedText: text, selectionCoords: coords, selectionEndOffset: endOffset }),

  clearSelection: () =>
    set({ selectedText: "", selectionCoords: null, selectionEndOffset: 0 }),

  setActiveFolderPath: (path) => set({ activeFolderPath: path }),

  markSaved: () => set({ isDirty: false, saveStatus: "saved", saveError: null }),

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error ?? null }),

  navigateEditorTo: (target) => set({ editorNavigateTo: target, editorTab: "source" }),

  clearEditorNavigateTo: () => set({ editorNavigateTo: null }),
});
