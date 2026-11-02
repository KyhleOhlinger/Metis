import { invoke } from "@tauri-apps/api/core";
import { appConfirm, toastError, toastSuccess } from "@/store/useToastStore";
import { isCorePluginEnabled } from "@/plugins/usePluginStore";
import { PINNED_SPACE_NAMES } from "@/constants/vaultSpaces";

export interface BackupSpaceFlags {
  daily: boolean;
  meetings: boolean;
  summaries: boolean;
  handwritten: boolean;
  assets: boolean;
}

export interface BackupSyncState {
  enabled: boolean;
  github: boolean;
  remoteUrl: string;
  spaces: BackupSpaceFlags;
  files: boolean;
  vaultPlanner: boolean;
  scheduleMinutes: number;
  vaultPath: string;
}

interface BackupSyncReport {
  status: "ok" | "remote_ahead";
  message: string;
}

export const BACKUP_SCHEDULE_OPTIONS = [
  { minutes: 0, label: "Off" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Hourly" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Daily" },
] as const;

export const BACKUP_SYNC_CHANGED = "metis-backup-sync-changed";

export function notifyBackupSyncChanged(): void {
  window.dispatchEvent(new Event(BACKUP_SYNC_CHANGED));
}

export function backupScheduleLabel(minutes: number): string {
  return BACKUP_SCHEDULE_OPTIONS.find((opt) => opt.minutes === minutes)?.label ?? "Off";
}

export function loadBackupSyncState(): Promise<BackupSyncState> {
  return invoke<BackupSyncState>("backup_sync_get");
}

let running = false;

/**
 * Commit and push the open vault's selected backup scopes.
 * Scheduled runs pass `quiet` so a missing setup does not toast on every tick.
 */
export async function runBackupSync(options?: {
  confirm?: boolean;
  quiet?: boolean;
}): Promise<void> {
  if (running) return;
  if (!isCorePluginEnabled("backup")) {
    if (!options?.quiet) {
      toastError("Turn on the Backup plugin in Settings → Plugins.");
    }
    return;
  }
  running = true;
  try {
    const state = await loadBackupSyncState();
    if (!state.enabled || !state.github || !state.remoteUrl.trim()) {
      if (!options?.quiet) {
        toastError("Turn on GitHub backup in Settings → Backup, and set a remote.");
      }
      return;
    }
    if (options?.confirm) {
      const included = PINNED_SPACE_NAMES.filter((name) => state.spaces[name]);
      const lines = [
        "Option: GitHub",
        included.length ? `Spaces: ${included.join(", ")}` : "Spaces: none",
        `Files: ${state.files ? "on" : "off"}`,
        `Vault planner: ${state.vaultPlanner && isCorePluginEnabled("planner") ? "on" : "off"}`,
      ];
      const proceed = await appConfirm(lines.join("\n"), {
        title: "Push this vault?",
        confirmLabel: "Sync",
      });
      if (!proceed) return;
    }
    const report = await invoke<BackupSyncReport>("backup_sync_run");
    if (report.status === "remote_ahead") {
      toastError(report.message);
      return;
    }
    toastSuccess(report.message);
  } catch (err) {
    if (!options?.quiet) toastError(String(err));
  } finally {
    running = false;
  }
}
