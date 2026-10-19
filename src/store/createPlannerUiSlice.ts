import type { StateCreator } from "zustand";
import type { MetisState } from "./metisState";
import { isCorePluginEnabled } from "@/plugins/usePluginStore";

export type PlannerUiSlice = Pick<
  MetisState,
  | "setEditorTab"
  | "openPlannerTab"
  | "bumpPlannerReload"
  | "setPlannerSyncStatus"
  | "navigatePlannerTo"
  | "clearPlannerNavigateTo"
  | "requestCommandCenter"
  | "clearCommandCenterRequest"
  | "setPendingMenuAction"
  | "setSidebarView"
>;

export const createPlannerUiSlice: StateCreator<MetisState, [], [], PlannerUiSlice> = (
  set,
  get,
) => ({
  setEditorTab: (tab) => set({ editorTab: tab }),

  openPlannerTab: () => {
    if (!isCorePluginEnabled("planner")) return;
    const { vaultPath } = get();
    if (!vaultPath) return;
    set({ editorTab: "planner" });
  },

  bumpPlannerReload: () => set((s) => ({ plannerReloadKey: s.plannerReloadKey + 1 })),

  setPlannerSyncStatus: (status, error = null) =>
    set({ plannerSyncStatus: status, plannerSyncError: error ?? null }),

  navigatePlannerTo: (target) => {
    if (!isCorePluginEnabled("planner")) return;
    const { vaultPath } = get();
    if (!vaultPath) return;
    set({ plannerNavigateTo: target, editorTab: "planner" });
  },

  clearPlannerNavigateTo: () => set({ plannerNavigateTo: null }),

  requestCommandCenter: (tab) => set({ commandCenterRequest: tab }),

  clearCommandCenterRequest: () => set({ commandCenterRequest: null }),

  setPendingMenuAction: (action) => set({ pendingMenuAction: action }),

  setSidebarView: (view) => set({ sidebarView: view }),
});
