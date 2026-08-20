import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import { buildBacklinkIndex } from "../utils/linkGraph";
import { formatError } from "../utils/formatError";
import { toastError } from "./useToastStore";
import { resetPlannerPersistence } from "../planner/plannerPersistence";
import { usePersonaStore } from "./usePersonaStore";
import {
  mergeVaultNavigation,
  pruneVaultNavigation,
} from "../utils/noteNavigation";
import {
  applyNoteMeta,
  flattenAssets,
  flattenNotes,
  parseNoteMeta,
} from "./noteIndexUtils";
import type { VaultData } from "./vaultTypes";
import type { MetisState } from "./metisState";

export type VaultSlice = Pick<
  MetisState,
  | "setVault"
  | "setIsMetisVault"
  | "refreshVault"
  | "enrichNoteIndex"
  | "setDefaultImageFolder"
  | "clearVault"
>;

export const createVaultSlice: StateCreator<MetisState, [], [], VaultSlice> = (set, get) => ({
  setVault: (data: VaultData) => {
    const noteIndex = flattenNotes(data.files);
    const assetIndex = flattenAssets(data.files);
    set({
      vaultPath: data.path,
      isMetisVault: data.is_metis_vault,
      files: data.files,
      defaultImageFolder: data.default_image_dir ?? "assets",
      plannerMode: data.planner_mode === "vault" ? "vault" : "shared",
      plannerSetupRequired: data.planner_setup_required === true,
      plannerReloadKey: get().plannerReloadKey + 1,
      plannerRestoreOffer: false,
      noteIndex,
      assetIndex,
      backlinkIndex: {},
      saveStatus: "idle",
      saveError: null,
      activeFilePath: null,
      activeFileContent: "",
      isDirty: false,
      cursorOffset: 0,
      selectedText: "",
      selectionCoords: null,
      selectionEndOffset: 0,
      activeFolderPath: null,
      editorNavigateTo: null,
      plannerNavigateTo: null,
      commandCenterRequest: null,
    });
    setTimeout(() => get().enrichNoteIndex(), 0);
  },

  setIsMetisVault: (v) => set({ isMetisVault: v }),

  refreshVault: async () => {
    const { vaultPath, noteIndex: prevIndex } = get();
    if (!vaultPath) return;
    try {
      const data = await invoke<VaultData>("open_vault", { path: vaultPath });
      const freshIndex = flattenNotes(data.files);
      const prevMap = new Map(prevIndex.map((n) => [n.path, n]));
      const merged = freshIndex.map((n) => {
        const prev = prevMap.get(n.path);
        return prev ? { ...prev, name: n.name, path: n.path } : n;
      });
      set({
        files: data.files,
        isMetisVault: data.is_metis_vault,
        defaultImageFolder: data.default_image_dir ?? "assets",
        plannerMode: data.planner_mode === "vault" ? "vault" : "shared",
        plannerSetupRequired: data.planner_setup_required === true,
        noteIndex: merged,
        assetIndex: flattenAssets(data.files),
      });
    } catch (err) {
      toastError(`Could not refresh vault: ${formatError(err)}`);
    }
  },

  enrichNoteIndex: async () => {
    const { noteIndex, vaultPath } = get();
    if (!noteIndex.length || !vaultPath) return;
    const runVaultPath = vaultPath;
    const BATCH = 100;
    const updatedByPath = new Map(noteIndex.map((n) => [n.path, n]));
    const contentsByPath = new Map<string, string>();
    for (let i = 0; i < noteIndex.length; i += BATCH) {
      if (get().vaultPath !== runVaultPath) return;
      const slice = noteIndex.slice(i, i + BATCH);
      const paths = slice.map((n) => n.path);

      let contents: string[];
      try {
        const batch = await invoke<string[]>("get_file_contents_batch", { paths });
        contents =
          Array.isArray(batch) && batch.length === paths.length
            ? batch
            : await Promise.all(
                paths.map((path) =>
                  invoke<string>("get_file_content", { path }).catch(() => ""),
                ),
              );
      } catch {
        contents = await Promise.all(
          paths.map((path) =>
            invoke<string>("get_file_content", { path }).catch(() => ""),
          ),
        );
      }

      contents.forEach((content, j) => {
        const path = slice[j].path;
        contentsByPath.set(path, content);
        const existing = updatedByPath.get(path);
        if (!existing) return;
        updatedByPath.set(path, applyNoteMeta(existing, parseNoteMeta(content)));
      });
    }

    const backlinkMap = buildBacklinkIndex(noteIndex, contentsByPath, runVaultPath);
    const backlinkIndex: Record<string, string[]> = {};
    for (const [path, sources] of backlinkMap) {
      backlinkIndex[path] = sources;
    }

    set((s) => {
      if (s.vaultPath !== runVaultPath) return s;
      const validPaths = new Set(noteIndex.map((n) => n.path));
      const persona = usePersonaStore.getState();
      const nav = persona.settings.vaultNoteNavigation?.[runVaultPath];
      if (nav) {
        const pruned = pruneVaultNavigation(nav, validPaths);
        persona.updateSettings({
          vaultNoteNavigation: mergeVaultNavigation(
            persona.settings.vaultNoteNavigation,
            runVaultPath,
            pruned,
          ),
        });
      }
      return {
        noteIndex: s.noteIndex.map((n) => updatedByPath.get(n.path) ?? n),
        backlinkIndex,
      };
    });
  },

  setDefaultImageFolder: async (relativeDir) => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    const saved = await invoke<string>("set_vault_default_image_dir", {
      vaultPath,
      relativeDir,
    });
    set({ defaultImageFolder: saved });
  },

  clearVault: () => {
    resetPlannerPersistence();
    set({
      vaultPath: null,
      isMetisVault: false,
      files: [],
      defaultImageFolder: "assets",
      plannerMode: "shared",
      plannerSetupRequired: false,
      plannerReloadKey: 0,
      plannerSetupModalOpen: false,
      plannerRestoreOffer: false,
      activeFilePath: null,
      activeFileContent: "",
      isDirty: false,
      cursorOffset: 0,
      selectedText: "",
      selectionCoords: null,
      selectionEndOffset: 0,
      activeFolderPath: null,
      noteIndex: [],
      assetIndex: [],
      backlinkIndex: {},
      saveStatus: "idle",
      saveError: null,
      plannerSyncStatus: "idle",
      plannerSyncError: null,
      pendingMenuAction: null,
      sidebarView: "files",
      editorNavigateTo: null,
      plannerNavigateTo: null,
      commandCenterRequest: null,
    });
  },
});
