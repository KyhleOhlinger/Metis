import { create } from "zustand";
import {
  METIS_SOURCE_URL,
  checkSourceUpdate,
} from "@/services/sourceUpdateCheck";
import { formatError } from "@/utils/formatError";
import { usePersonaStore } from "./usePersonaStore";

export type SourceUpdateStatus = "idle" | "checking" | "current" | "available" | "error";

interface SourceUpdateState {
  status: SourceUpdateStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  sourceUrl: string;
  error: string | null;
  check: (opts?: { force?: boolean }) => Promise<void>;
  dismiss: () => void;
}

export const useSourceUpdateStore = create<SourceUpdateState>((set) => ({
  status: "idle",
  currentVersion: null,
  latestVersion: null,
  sourceUrl: METIS_SOURCE_URL,
  error: null,

  check: async (opts) => {
    const enabled = usePersonaStore.getState().settings.sourceUpdateCheckEnabled !== false;
    if (!enabled && !opts?.force) {
      set({ status: "idle", error: null });
      return;
    }
    set({ status: "checking", error: null });
    try {
      const result = await checkSourceUpdate();
      const dismissed = usePersonaStore.getState().settings.sourceUpdateDismissedVersion;
      const available = result.updateAvailable && result.latestVersion !== dismissed;
      set({
        status: available ? "available" : "current",
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        sourceUrl: result.sourceUrl,
        error: null,
      });
    } catch (err) {
      set({
        status: "error",
        error: formatError(err),
      });
    }
  },

  dismiss: () => {
    const latest = useSourceUpdateStore.getState().latestVersion;
    if (latest) {
      usePersonaStore.getState().updateSettings({ sourceUpdateDismissedVersion: latest });
    }
    set({ status: "current" });
  },
}));
