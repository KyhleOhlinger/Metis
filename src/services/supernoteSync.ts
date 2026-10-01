import { invoke } from "@tauri-apps/api/core";
import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import { isCorePluginEnabled } from "@/plugins/usePluginStore";
import { toastError, toastInfo, toastSuccess } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import { SUPERNOTE_DEFAULT_PORT, notifySupernoteFilesChanged } from "@/constants/supernote";
import { ensureSupernoteCompanionNotes } from "@/utils/openSupernoteCompanion";

export type SupernoteSyncResult = {
  downloaded: number;
  skipped: number;
  updated: number;
  destFolder: string;
};

export async function ensureSupernoteFolder(): Promise<void> {
  if (!useStore.getState().vaultPath) return;
  if (!isCorePluginEnabled("supernote")) return;
  await invoke<string>("ensure_supernote_folder");
}

export async function runSupernoteSync(): Promise<SupernoteSyncResult | null> {
  if (!isCorePluginEnabled("supernote")) {
    toastError("Enable the Supernote plugin in Settings → Plugins.");
    return null;
  }
  if (!useStore.getState().vaultPath) {
    toastError("Open a vault first.");
    return null;
  }
  const { supernoteDeviceIp, supernoteDevicePort } = usePersonaStore.getState().settings;
  const ip = (supernoteDeviceIp ?? "").trim();
  if (!ip) {
    toastError(
      import.meta.env.DEV
        ? "Set the Nomad IP on the Supernote folder (no port)."
        : "Set the Nomad IP on the Supernote folder. The packaged app does not use the IP saved in `tauri dev`.",
    );
    return null;
  }
  const port = supernoteDevicePort ?? SUPERNOTE_DEFAULT_PORT;
  try {
    await ensureSupernoteFolder();
    const result = await invoke<SupernoteSyncResult>("sync_supernote_browse_access", {
      ip,
      port,
    });
    await useStore.getState().refreshVault();
    await ensureSupernoteCompanionNotes();
    notifySupernoteFilesChanged();
    if (result.downloaded === 0 && result.skipped === 0 && (result.updated ?? 0) === 0) {
      toastInfo("No files found. Enable Browse & Access on the Nomad and confirm the popup.");
    } else if ((result.downloaded ?? 0) === 0 && (result.updated ?? 0) === 0) {
      toastInfo(`Supernote: nothing new (${result.skipped} already in ${result.destFolder}).`);
    } else {
      const bits: string[] = [];
      if (result.downloaded > 0) {
        bits.push(`${result.downloaded} new`);
      }
      if ((result.updated ?? 0) > 0) {
        bits.push(`${result.updated} updated`);
      }
      toastSuccess(`Supernote: ${bits.join(", ")} in ${result.destFolder}.`);
    }
    return result;
  } catch (err) {
    toastError(`Supernote sync failed: ${formatError(err)}`);
    return null;
  }
}
