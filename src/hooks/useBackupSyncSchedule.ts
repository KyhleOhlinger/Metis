import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { BACKUP_SYNC_CHANGED, loadBackupSyncState, runBackupSync } from "@/services/backupSync";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";

/** Pushes the vault on the interval saved in Settings → Backup. Off when minutes are 0. */
export function useBackupSyncSchedule() {
  const vaultPath = useStore((s) => s.vaultPath);
  const backupOn = useCorePluginEnabled("backup");
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    if (!vaultPath || !backupOn) {
      setMinutes(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      void loadBackupSyncState()
        .then((state) => {
          if (cancelled) return;
          const ready = state.enabled && state.github && state.remoteUrl.trim().length > 0;
          setMinutes(ready ? state.scheduleMinutes : 0);
        })
        .catch(() => {
          if (!cancelled) setMinutes(0);
        });
    };
    load();
    window.addEventListener(BACKUP_SYNC_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_SYNC_CHANGED, load);
    };
  }, [vaultPath, backupOn]);

  useEffect(() => {
    if (!vaultPath || minutes <= 0) return;
    const id = window.setInterval(() => {
      void runBackupSync({ quiet: true });
    }, minutes * 60_000);
    return () => window.clearInterval(id);
  }, [vaultPath, minutes]);
}
