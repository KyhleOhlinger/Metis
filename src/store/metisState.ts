import type { PlannerNavigateTarget } from "./plannerNavigation";
import type { PlannerStorageMode } from "../planner/plannerPersistence";
import type {
  AssetMetadata,
  EditorNavigateTarget,
  FileNode,
  NoteMetadata,
  VaultData,
} from "./vaultTypes";

export interface MetisState {
  vaultPath: string | null;
  isMetisVault: boolean;
  files: FileNode[];
  activeFilePath: string | null;
  activeFileContent: string;
  isDirty: boolean;
  cursorOffset: number;
  selectedText: string;
  selectionCoords: { top: number; left: number } | null;
  selectionEndOffset: number;
  activeFolderPath: string | null;
  noteIndex: NoteMetadata[];
  assetIndex: AssetMetadata[];
  defaultImageFolder: string;
  plannerMode: PlannerStorageMode;
  plannerSetupRequired: boolean;
  plannerReloadKey: number;
  plannerSetupModalOpen: boolean;
  plannerRestoreOffer: boolean;
  backlinkIndex: Record<string, string[]>;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  plannerSyncStatus: "idle" | "pending" | "saving" | "syncing" | "saved" | "error";
  plannerSyncError: string | null;
  editorTab: "source" | "visual" | "planner" | "agent-history";
  pendingMenuAction: string | null;
  sidebarView: "files" | "search";
  editorNavigateTo: EditorNavigateTarget | null;
  plannerNavigateTo: PlannerNavigateTarget | null;
  setEditorTab: (tab: "source" | "visual" | "planner" | "agent-history") => void;
  openPlannerTab: () => void;
  setPlannerSetupModalOpen: (open: boolean) => void;
  setPlannerRestoreOffer: (offer: boolean) => void;
  setPlannerConfig: (mode: PlannerStorageMode, setupRequired: boolean) => void;
  bumpPlannerReload: () => void;
  setPendingMenuAction: (action: string | null) => void;
  setSidebarView: (view: "files" | "search") => void;
  setVault: (data: VaultData) => void;
  setIsMetisVault: (v: boolean) => void;
  refreshVault: () => Promise<void>;
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
  setDefaultImageFolder: (relativeDir: string) => Promise<void>;
  navigateEditorTo: (target: EditorNavigateTarget) => void;
  clearEditorNavigateTo: () => void;
  navigatePlannerTo: (target: PlannerNavigateTarget) => void;
  clearPlannerNavigateTo: () => void;
}

export const metisInitialState = {
  vaultPath: null,
  isMetisVault: false,
  files: [] as FileNode[],
  activeFilePath: null,
  activeFileContent: "",
  isDirty: false,
  cursorOffset: 0,
  selectedText: "",
  selectionCoords: null,
  selectionEndOffset: 0,
  activeFolderPath: null,
  noteIndex: [] as NoteMetadata[],
  assetIndex: [] as AssetMetadata[],
  defaultImageFolder: "assets",
  plannerMode: "shared" as PlannerStorageMode,
  plannerSetupRequired: false,
  plannerReloadKey: 0,
  plannerSetupModalOpen: false,
  plannerRestoreOffer: false,
  backlinkIndex: {} as Record<string, string[]>,
  saveStatus: "idle" as const,
  saveError: null,
  plannerSyncStatus: "idle" as const,
  plannerSyncError: null,
  editorTab: "source" as const,
  pendingMenuAction: null,
  sidebarView: "files" as const,
  editorNavigateTo: null,
  plannerNavigateTo: null,
};
