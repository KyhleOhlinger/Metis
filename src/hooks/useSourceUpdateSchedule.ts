import { useEffect } from "react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { useSourceUpdateStore } from "@/store/useSourceUpdateStore";

/** Re-check GitHub while Metis stays open (launch always checks once). */
export const SOURCE_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * On launch (after settings load), then once per day while the app is open.
 * When the window becomes visible again after a long idle period, re-check if
 * the last successful attempt is older than one day.
 */
export function useSourceUpdateSchedule() {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const runIfDue = () => {
      if (cancelled) return;
      const enabled =
        usePersonaStore.getState().settings.sourceUpdateCheckEnabled !== false;
      if (!enabled) return;
      void useSourceUpdateStore.getState().check();
    };

    void usePersonaStore.getState().loadFromDisk().then(() => {
      if (cancelled) return;
      runIfDue();
      intervalId = setInterval(runIfDue, SOURCE_UPDATE_CHECK_INTERVAL_MS);
    });

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const enabled =
        usePersonaStore.getState().settings.sourceUpdateCheckEnabled !== false;
      if (!enabled) return;
      const lastCheckedAt = useSourceUpdateStore.getState().lastCheckedAt;
      if (
        lastCheckedAt !== null &&
        Date.now() - lastCheckedAt < SOURCE_UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }
      runIfDue();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
