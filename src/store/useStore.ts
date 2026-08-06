import { create } from "zustand";
import type {
  AssetMetadata,
  DiskWrite,
  EditorNavigateTarget,
  FileNode,
  NoteMetadata,
  VaultData,
} from "./vaultTypes";
import { metisInitialState, type MetisState } from "./metisState";
import { createVaultSlice } from "./createVaultSlice";
import { createEditorSlice } from "./createEditorSlice";
import { createPlannerUiSlice } from "./createPlannerUiSlice";

export type { AssetMetadata, DiskWrite, EditorNavigateTarget, FileNode, NoteMetadata, VaultData };

export const useStore = create<MetisState>((set, get, api) => ({
  ...metisInitialState,
  ...createVaultSlice(set, get, api),
  ...createEditorSlice(set, get, api),
  ...createPlannerUiSlice(set, get, api),
}));
