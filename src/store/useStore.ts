import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { buildBacklinkIndex } from "../utils/linkGraph";
import { formatError } from "../utils/formatError";
import { toastError } from "./useToastStore";
import type { PlannerNavigateTarget } from "./plannerNavigation";
import type { PlannerStorageMode } from "../planner/plannerPersistence";
import { resetPlannerPersistence } from "../planner/plannerPersistence";
import {
  applyNoteMeta,
  flattenAssets,
  flattenNotes,
  parseNoteMeta,
} from "./noteIndexUtils";
import type {
  AssetMetadata,
  DiskWrite,
  EditorNavigateTarget,
  FileNode,
  NoteMetadata,
  VaultData,
} from "./vaultTypes";

export type { AssetMetadata, DiskWrite, EditorNavigateTarget, FileNode, NoteMetadata, VaultData };

// ── State interface ───────────────────────────────────────────────────────────

interface MetisState {
  // Vault
  vaultPath: string | null;
  /** True when a `.metis/vault.json` marker is present — false for foreign vaults. */
  isMetisVault: boolean;
  files: FileNode[];

  // Editor
  activeFilePath: string | null;
  activeFileContent: string;
  isDirty: boolean;
  /**
   * Character offset of the cursor (CodeMirror `selection.main.head`) in the
   * active document.  Updated on every cursor move so the AI agent can insert
   * content at the correct position.  0 when no file is open.
   */
  cursorOffset: number;
  /** Currently selected text in the editor (empty string when nothing is selected). */
  selectedText: string;
  /**
   * Viewport-relative coordinates for the start of the selection, used to
   * position the floating AI toolbar above the highlighted text.
   * Null when nothing is selected.
   */
  selectionCoords: { top: number; left: number } | null;
  /**
   * Character offset of the END of the current selection (`selection.main.to`).
   * Used by "insert after selection" actions so content always lands below the
   * highlighted block regardless of which direction the user dragged.
   */
  selectionEndOffset: number;

  /** The folder whose context is currently "selected" in the sidebar. */
  activeFolderPath: string | null;

  /**
   * MetadataCache — flat index of every note in the vault.
   * Rebuilt whenever the file tree changes; read directly by extensions
   * via `useStore.getState().noteIndex` so no React re-render is needed.
   */
  noteIndex: NoteMetadata[];

  /**
   * Flat index of every non-markdown asset (images, PDFs, etc.) in the vault.
   * Enables Obsidian-compatible ![[image.png]] resolution: the wikilink name
   * is matched against this list so files are found regardless of where in the
   * vault they are stored.
   */
  assetIndex: AssetMetadata[];

  /** Vault-relative default folder for pasted/saved images. */
  defaultImageFolder: string;

  plannerMode: PlannerStorageMode;
  plannerSetupRequired: boolean;
  plannerReloadKey: number;
  plannerSetupModalOpen: boolean;
  plannerRestoreOffer: boolean;

  /** Incoming wikilink map: target note path → source note paths. */
  backlinkIndex: Record<string, string[]>;

  /** Auto-save / manual save feedback for the editor header. */
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;

  /** Planner disk write / vault backup sync feedback. */
  plannerSyncStatus: "idle" | "pending" | "saving" | "syncing" | "saved" | "error";
  plannerSyncError: string | null;

  // UI state shared between menu events and components
  /** Which editor tab is active.  Lifted here so the native menu can switch it. */
  editorTab: "source" | "visual" | "planner" | "agent-history";
  /**
   * A pending action dispatched by the native menu bar.
   * Components watch this via useEffect, execute the action, then clear it by
   * calling setPendingMenuAction(null).
   */
  pendingMenuAction: string | null;

  /** Which sidebar view is active: file tree or vault-wide search. */
  sidebarView: "files" | "search";

  /** Consumed by Editor to scroll/select after opening a file from search, etc. */
  editorNavigateTo: EditorNavigateTarget | null;

  /** Consumed by DailyTaskGrid to jump to daily / weekly / monthly planner views. */
  plannerNavigateTo: PlannerNavigateTarget | null;

  // Actions
  setEditorTab: (tab: "source" | "visual" | "planner" | "agent-history") => void;
  openPlannerTab: () => void;
  setPlannerSetupModalOpen: (open: boolean) => void;
  setPlannerRestoreOffer: (offer: boolean) => void;
  setPlannerConfig: (mode: PlannerStorageMode, setupRequired: boolean) => void;
  bumpPlannerReload: () => void;
  setPendingMenuAction: (action: string | null) => void;
  setSidebarView: (view: "files" | "search") => void;
  setVault: (data: VaultData) => void;
  /** Mark the current vault as a Metis vault (called after successful conversion). */
  setIsMetisVault: (v: boolean) => void;
  /** Re-fetch the file tree from disk (call after any mutating operation). */
  refreshVault: () => Promise<void>;
  /**
   * Batch-read every note in the vault and populate enriched metadata fields
   * (status, date, aliases, parent, related).  Called once on vault open;
   * individual notes are also updated lazily when opened via setActiveFile.
   */
  enrichNoteIndex: () => Promise<void>;
  setActiveFile: (path: string, content: string) => void;
  setActiveFileContent: (content: string) => void;
  setCursorOffset: (offset: number) => void;
  setSelection: (text: string, coords: { top: number; left: number } | null, endOffset: number) => void;
  clearSelection: () => void;
  setActiveFolderPath: (path: string | null) => void;
  markSaved: () => void;
  setSaveStatus: (status: MetisState["saveStatus"], error?: string | null) => void;
  setPlannerSyncStatus: (
    status: MetisState["plannerSyncStatus"],
    error?: string | null,
  ) => void;
  clearVault: () => void;
  /** Persist vault-relative default image folder (e.g. `assets`). */
  setDefaultImageFolder: (relativeDir: string) => Promise<void>;
  navigateEditorTo: (target: EditorNavigateTarget) => void;
  clearEditorNavigateTo: () => void;
  navigatePlannerTo: (target: PlannerNavigateTarget) => void;
  clearPlannerNavigateTo: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStore = create<MetisState>((set, get) => ({
  vaultPath: null,
  isMetisVault: false,
  files: [],
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
  defaultImageFolder: "assets",
  plannerMode: "shared",
  plannerSetupRequired: false,
  plannerReloadKey: 0,
  plannerSetupModalOpen: false,
  plannerRestoreOffer: false,
  backlinkIndex: {},
  saveStatus: "idle",
  saveError: null,
  plannerSyncStatus: "idle",
  plannerSyncError: null,
  editorTab: "source",
  pendingMenuAction: null,
  sidebarView: "files",
  editorNavigateTo: null,
  plannerNavigateTo: null,

  setEditorTab: (tab) => set({ editorTab: tab }),

  openPlannerTab: () => {
    const { vaultPath, isMetisVault, plannerSetupRequired } = get();
    if (!vaultPath) return;
    if (isMetisVault && plannerSetupRequired) {
      set({ plannerSetupModalOpen: true });
      return;
    }
    set({ editorTab: "planner" });
  },

  setPlannerSetupModalOpen: (open) => set({ plannerSetupModalOpen: open }),

  setPlannerRestoreOffer: (offer) => set({ plannerRestoreOffer: offer }),

  setPlannerConfig: (mode, setupRequired) =>
    set({ plannerMode: mode, plannerSetupRequired: setupRequired }),

  bumpPlannerReload: () => set((s) => ({ plannerReloadKey: s.plannerReloadKey + 1 })),

  setPendingMenuAction: (action) => set({ pendingMenuAction: action }),

  setSidebarView: (view) => set({ sidebarView: view }),

  setVault: (data) => {
    const noteIndex  = flattenNotes(data.files);
    const assetIndex = flattenAssets(data.files);
    // Clear the active editor when switching vaults so stale content from the
    // previous vault is never shown inside a different vault's context.
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
    });
    // Enrich metadata in the background so the store is never blocked.
    setTimeout(() => get().enrichNoteIndex(), 0);
  },

  setIsMetisVault: (v) => set({ isMetisVault: v }),

  refreshVault: async () => {
    const { vaultPath, noteIndex: prevIndex } = get();
    if (!vaultPath) return;
    try {
      const data = await invoke<VaultData>("open_vault", { path: vaultPath });
      const freshIndex = flattenNotes(data.files);
      // Preserve previously enriched fields (status, aliases, etc.) by
      // merging the cached entry for each path into the fresh skeleton.
      const prevMap = new Map(prevIndex.map((n) => [n.path, n]));
      const merged  = freshIndex.map((n) => {
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
    /** One `get_file_contents_batch` IPC per slice (max 100 paths); falls back to per-file reads if the command fails. */
    const BATCH = 100;
    const updatedByPath = new Map(noteIndex.map((n) => [n.path, n]));
    const contentsByPath = new Map<string, string>();
    for (let i = 0; i < noteIndex.length; i += BATCH) {
      // Abort stale enrichment runs after a vault switch.
      if (get().vaultPath !== runVaultPath) return;
      const slice = noteIndex.slice(i, i + BATCH);
      const paths = slice.map((n) => n.path);

      let contents: string[];
      try {
        const batch = await invoke<string[]>("get_file_contents_batch", { paths });
        contents =
          Array.isArray(batch) && batch.length === paths.length
            ? batch
            : await Promise.all(paths.map((path) => invoke<string>("get_file_content", { path }).catch(() => "")));
      } catch {
        contents = await Promise.all(paths.map((path) => invoke<string>("get_file_content", { path }).catch(() => "")));
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
      return {
        noteIndex: s.noteIndex.map((n) => updatedByPath.get(n.path) ?? n),
        backlinkIndex,
      };
    });
  },

  setActiveFile: (path, content) => {
    // Lazily enrich this note's index entry so status/date/aliases are current.
    const meta = parseNoteMeta(content);
    set((s) => ({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      // If a workspace view is visible and the user opens a note, return to source mode.
      editorTab:
        s.editorTab === "planner" || s.editorTab === "agent-history"
          ? "source"
          : s.editorTab,
      noteIndex: s.noteIndex.map((n) =>
        n.path === path ? applyNoteMeta(n, meta) : n,
      ),
    }));
  },

  setActiveFileContent: (content) => {
    // Re-parse frontmatter so noteIndex (and sidebar status colours) reflect the
    // latest content immediately — not just after the next enrichNoteIndex pass.
    const path = get().activeFilePath;
    const meta = path ? parseNoteMeta(content) : null;
    set((s) => ({
      activeFileContent: content,
      isDirty: true,
      saveStatus: "idle",
      noteIndex: meta && path
        ? s.noteIndex.map((n) => (n.path === path ? applyNoteMeta(n, meta) : n))
        : s.noteIndex,
    }));
  },

  setCursorOffset: (offset) => set({ cursorOffset: offset }),

  setSelection: (text, coords, endOffset) =>
    set({ selectedText: text, selectionCoords: coords, selectionEndOffset: endOffset }),
  clearSelection: () => set({ selectedText: "", selectionCoords: null, selectionEndOffset: 0 }),

  setActiveFolderPath: (path) => set({ activeFolderPath: path }),

  markSaved: () => set({ isDirty: false, saveStatus: "saved", saveError: null }),

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error ?? null }),

  setPlannerSyncStatus: (status, error = null) =>
    set({ plannerSyncStatus: status, plannerSyncError: error ?? null }),

  setDefaultImageFolder: async (relativeDir) => {
    const { vaultPath } = get();
    if (!vaultPath) return;
    const saved = await invoke<string>("set_vault_default_image_dir", {
      vaultPath,
      relativeDir,
    });
    set({ defaultImageFolder: saved });
  },

  navigateEditorTo: (target) =>
    set({ editorNavigateTo: target, editorTab: "source" }),

  clearEditorNavigateTo: () => set({ editorNavigateTo: null }),

  navigatePlannerTo: (target) => {
    const { vaultPath, isMetisVault, plannerSetupRequired } = get();
    if (vaultPath && isMetisVault && plannerSetupRequired) {
      set({ plannerNavigateTo: target, plannerSetupModalOpen: true });
      return;
    }
    set({ plannerNavigateTo: target, editorTab: "planner" });
  },

  clearPlannerNavigateTo: () => set({ plannerNavigateTo: null }),

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
    });
  },
}));
