import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { useVaultActivityStore, type VaultActivity } from "@/store/useVaultActivityStore";
import { BACKUP_SYNC_CHANGED, loadBackupSyncState } from "@/services/backupSync";

function clock(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function item(label: string, when: number | null, error: string | null) {
  const failed = Boolean(error);
  return (
    <span
      className={failed ? "text-red-400" : "text-text-muted"}
      title={error || undefined}
    >
      {label} {failed ? "failed" : clock(when)}
    </span>
  );
}

export default function VaultActivityBar() {
  const vaultPath = useStore((s) => s.vaultPath);
  const activity = useVaultActivityStore((s) =>
    vaultPath ? s.byVault[vaultPath] : undefined,
  );
  const [backup, setBackup] = useState<{ at: number | null; error: string | null }>({
    at: null,
    error: null,
  });

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    const load = () => {
      void loadBackupSyncState()
        .then((state) => {
          if (cancelled) return;
          setBackup({
            at: state.lastSuccessMs > 0 ? state.lastSuccessMs : null,
            error: state.lastError?.trim() || null,
          });
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener(BACKUP_SYNC_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_SYNC_CHANGED, load);
    };
  }, [vaultPath]);

  if (!vaultPath) return null;
  const row: VaultActivity = activity ?? {
    saveAt: null,
    saveError: null,
    backupAt: null,
    backupError: null,
    syncAt: null,
    syncError: null,
    closeError: null,
  };

  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-border bg-surface px-3 py-1 text-[10px]">
      {item("Save", row.saveAt, row.saveError)}
      {item("Backup", backup.at ?? row.backupAt, backup.error ?? row.backupError)}
      {item("Sync", row.syncAt, row.syncError)}
      {row.closeError && (
        <span className="text-red-400" title={row.closeError}>
          Close failed
        </span>
      )}
    </div>
  );
}
