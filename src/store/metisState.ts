import type { PlannerNavigateTarget } from "./plannerNavigation";
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
  plannerReloadKey: number;
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
  commandCenterRequest: "info" | "ai" | "settings" | null;
  setEditorTab: (tab: "source" | "visual" | "planner" | "agent-history") => void;
  openPlannerTab: () => void;
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
  requestCommandCenter: (tab: "info" | "ai" | "settings") => void;
  clearCommandCenterRequest: () => void;
}

/** Note session and panel chrome cleared when a vault opens or closes. */
export function clearedVaultSession() {
  return {
    activeFilePath: null as string | null,
    activeFileContent: "",
    isDirty: false,
    cursorOffset: 0,
    selectedText: "",
    selectionCoords: null as { top: number; left: number } | null,
    selectionEndOffset: 0,
    activeFolderPath: null as string | null,
    backlinkIndex: {} as Record<string, string[]>,
    saveStatus: "idle" as const,
    saveError: null as string | null,
    plannerSyncStatus: "idle" as const,
    plannerSyncError: null as string | null,
    pendingMenuAction: null as string | null,
    sidebarView: "files" as const,
    editorNavigateTo: null as EditorNavigateTarget | null,
    plannerNavigateTo: null as PlannerNavigateTarget | null,
    commandCenterRequest: null as "info" | "ai" | "settings" | null,
  };
}

export const metisInitialState = {
  vaultPath: null,
  isMetisVault: false,
  files: [] as FileNode[],
  ...clearedVaultSession(),
  noteIndex: [] as NoteMetadata[],
  assetIndex: [] as AssetMetadata[],
  defaultImageFolder: "assets",
  plannerReloadKey: 0,
  editorTab: "source" as const,
};
