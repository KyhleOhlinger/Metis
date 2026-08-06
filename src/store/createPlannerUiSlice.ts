import type { StateCreator } from "zustand";
import type { MetisState } from "./metisState";

export type PlannerUiSlice = Pick<
  MetisState,
  | "setEditorTab"
  | "openPlannerTab"
  | "setPlannerSetupModalOpen"
  | "setPlannerRestoreOffer"
  | "setPlannerConfig"
  | "bumpPlannerReload"
  | "setPlannerSyncStatus"
  | "navigatePlannerTo"
  | "clearPlannerNavigateTo"
  | "setPendingMenuAction"
  | "setSidebarView"
>;

export const createPlannerUiSlice: StateCreator<MetisState, [], [], PlannerUiSlice> = (
  set,
  get,
) => ({
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

  setPlannerSyncStatus: (status, error = null) =>
    set({ plannerSyncStatus: status, plannerSyncError: error ?? null }),

  navigatePlannerTo: (target) => {
    const { vaultPath, isMetisVault, plannerSetupRequired } = get();
    if (vaultPath && isMetisVault && plannerSetupRequired) {
      set({ plannerNavigateTo: target, plannerSetupModalOpen: true });
      return;
    }
    set({ plannerNavigateTo: target, editorTab: "planner" });
  },

  clearPlannerNavigateTo: () => set({ plannerNavigateTo: null }),

  setPendingMenuAction: (action) => set({ pendingMenuAction: action }),

  setSidebarView: (view) => set({ sidebarView: view }),
});
