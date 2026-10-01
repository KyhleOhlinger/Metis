import { useEffect, useRef } from "react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";
import { ensureSupernoteFolder, runSupernoteSync } from "@/services/supernoteSync";
import { ensureSupernoteCompanionNotes } from "@/utils/openSupernoteCompanion";
import { SUPERNOTE_DEFAULT_INTERVAL_MIN } from "@/constants/supernote";

/** Creates handwritten/Supernote/ and polls Browse & Access while the plugin is on. */
export function useSupernoteSyncSchedule() {
  const enabled = useCorePluginEnabled("supernote");
  const vaultPath = useStore((s) => s.vaultPath);
  const intervalMin = usePersonaStore(
    (s) => s.settings.supernoteSyncIntervalMinutes ?? SUPERNOTE_DEFAULT_INTERVAL_MIN,
  );
  const ip = usePersonaStore((s) => (s.settings.supernoteDeviceIp ?? "").trim());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || !vaultPath) return;
    void ensureSupernoteFolder()
      .then(() => useStore.getState().refreshVault())
      .then(() => ensureSupernoteCompanionNotes())
      .catch(() => {
      /* folder create surfaced on next manual sync */
    });
  }, [enabled, vaultPath]);

  useEffect(() => {
    if (!enabled || !vaultPath || !ip || intervalMin <= 0) return;
    const ms = Math.max(intervalMin, 5) * 60_000;
    const tick = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      void runSupernoteSync().finally(() => {
        inFlight.current = false;
      });
    };
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [enabled, vaultPath, ip, intervalMin]);
}
