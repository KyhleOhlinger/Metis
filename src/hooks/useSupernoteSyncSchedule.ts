import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { useCorePluginEnabled, usePluginStore } from "@/plugins/usePluginStore";
import type { VaultPluginStateDto } from "@/plugins/corePlugins";
import { ensureSupernoteFolder, runSupernoteSync } from "@/services/supernoteSync";
import { appConfirm } from "@/store/useToastStore";
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
  const asked = useRef<string | null>(null);
  const pending = usePluginStore((s) => (s.pendingSuggestions ?? []).includes("supernote"));

  useEffect(() => {
    if (!vaultPath || !pending || asked.current === vaultPath) return;
    asked.current = vaultPath;
    void (async () => {
      const approved = await appConfirm(
        "This vault asks to use your Supernote. Metis will not contact the device until you allow it for this vault.",
        { title: "Supernote", confirmLabel: "Use my Supernote", cancelLabel: "Don't contact" },
      );
      const state = await invoke<VaultPluginStateDto>("decide_supernote_consent", { approved });
      usePluginStore.getState().apply(state);
    })();
  }, [vaultPath, pending]);

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
      void runSupernoteSync({ quiet: true }).finally(() => {
        inFlight.current = false;
      });
    };
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [enabled, vaultPath, ip, intervalMin]);
}
