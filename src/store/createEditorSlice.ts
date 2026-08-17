import type { StateCreator } from "zustand";
import { applyNoteMeta, parseNoteMeta } from "./noteIndexUtils";
import type { MetisState } from "./metisState";
import { usePersonaStore } from "./usePersonaStore";
import { patchBacklinkIndexForSource } from "../utils/linkGraph";
import {
  mergeVaultNavigation,
  recordRecentNote,
} from "../utils/noteNavigation";

let backlinkPatchTimer: ReturnType<typeof setTimeout> | null = null;

function trackRecentNoteOpen(path: string, vaultPath: string | null) {
  if (!vaultPath || !path.toLowerCase().endsWith(".md")) return;
  const persona = usePersonaStore.getState();
  const nav = persona.settings.vaultNoteNavigation?.[vaultPath];
  const next = recordRecentNote(nav, path);
  persona.updateSettings({
    vaultNoteNavigation: mergeVaultNavigation(persona.settings.vaultNoteNavigation, vaultPath, next),
  });
}

function scheduleBacklinkPatch(
  get: () => MetisState,
  set: (partial: Partial<MetisState>) => void,
  path: string,
  content: string,
) {
  if (backlinkPatchTimer) clearTimeout(backlinkPatchTimer);
  backlinkPatchTimer = setTimeout(() => {
    const state = get();
    if (state.activeFilePath !== path || !state.vaultPath) return;
    if (!path.toLowerCase().endsWith(".md")) return;
    const backlinkIndex = patchBacklinkIndexForSource(
      state.backlinkIndex,
      path,
      content,
      state.noteIndex,
      state.vaultPath,
    );
    set({ backlinkIndex });
  }, 500);
}

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
    const vaultPath = get().vaultPath;
    set((s) => ({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      editorTab:
        s.editorTab === "planner" || s.editorTab === "agent-history" ? "source" : s.editorTab,
      noteIndex: s.noteIndex.map((n) => (n.path === path ? applyNoteMeta(n, meta) : n)),
    }));
    trackRecentNoteOpen(path, vaultPath);
  },

  setActiveFileContent: (content) => {
    const path = get().activeFilePath;
    const vaultPath = get().vaultPath;
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
    if (path && vaultPath) scheduleBacklinkPatch(get, set, path, content);
  },

  setCursorOffset: (offset) => set({ cursorOffset: offset }),

  setSelection: (text, coords, endOffset) =>
    set({ selectedText: text, selectionCoords: coords, selectionEndOffset: endOffset }),

  clearSelection: () =>
    set({ selectedText: "", selectionCoords: null, selectionEndOffset: 0 }),

  setActiveFolderPath: (path) => set({ activeFolderPath: path }),

  markSaved: () => {
    const { activeFilePath, activeFileContent, noteIndex, vaultPath, backlinkIndex } = get();
    let nextBacklinks = backlinkIndex;
    if (
      activeFilePath &&
      vaultPath &&
      activeFilePath.toLowerCase().endsWith(".md")
    ) {
      nextBacklinks = patchBacklinkIndexForSource(
        backlinkIndex,
        activeFilePath,
        activeFileContent,
        noteIndex,
        vaultPath,
      );
    }
    set({
      isDirty: false,
      saveStatus: "saved",
      saveError: null,
      backlinkIndex: nextBacklinks,
    });
  },

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error ?? null }),

  navigateEditorTo: (target) => set({ editorNavigateTo: target, editorTab: "source" }),

  clearEditorNavigateTo: () => set({ editorNavigateTo: null }),
});
