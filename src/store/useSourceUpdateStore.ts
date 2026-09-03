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
  /** Epoch ms of the last check attempt (success or network error). */
  lastCheckedAt: number | null;
  check: (opts?: { force?: boolean }) => Promise<void>;
  dismiss: () => void;
}

export const useSourceUpdateStore = create<SourceUpdateState>((set) => ({
  status: "idle",
  currentVersion: null,
  latestVersion: null,
  sourceUrl: METIS_SOURCE_URL,
  error: null,
  lastCheckedAt: null,

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
        lastCheckedAt: Date.now(),
      });
    } catch (err) {
      set({
        status: "error",
        error: formatError(err),
        lastCheckedAt: Date.now(),
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
