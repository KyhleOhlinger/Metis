import { useEffect, useState } from "react";
import { usePersonaStore } from "@/store/usePersonaStore";
import {
  BACKUP_SYNC_CHANGED,
  backupScheduleLabel,
  loadBackupSyncState,
  runBackupSync,
  type BackupSyncState,
} from "@/services/backupSync";
import { Hint, Section, SectionAction } from "../shared/ui";

export function BackupInfoSection() {
  const [state, setState] = useState<BackupSyncState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadBackupSyncState()
        .then((next) => {
          if (!cancelled) setState(next);
        })
        .catch(() => {
          if (!cancelled) setState(null);
        });
    };
    load();
    window.addEventListener(BACKUP_SYNC_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_SYNC_CHANGED, load);
    };
  }, []);

  const ready = Boolean(state?.enabled && state.github && state.remoteUrl.trim());

  return (
    <Section title="Backup">
      <div className="space-y-2">
        <p className="text-[10px] text-text-secondary">
          {ready
            ? `GitHub · ${backupScheduleLabel(state?.scheduleMinutes ?? 0)}`
            : "GitHub backup is off."}
        </p>
        {ready && (
          <p className="break-all font-mono text-[10px] text-text-muted">{state?.remoteUrl}</p>
        )}
        {state?.lastSuccessMs ? (
          <p className="text-[10px] text-text-secondary">
            Last success: {new Date(state.lastSuccessMs).toLocaleString()}
          </p>
        ) : null}
        {state?.lastError ? (
          <p className="text-[10px] text-red-400">{state.lastError}</p>
        ) : null}
        {!ready && <Hint>Choose GitHub in Settings → Backup. Sync uses this vault.</Hint>}
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => {
            setBusy(true);
            void runBackupSync({ confirm: true }).finally(() => setBusy(false));
          }}
          className="w-full rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
        <Hint>⌘⇧B</Hint>
        <SectionAction onClick={() => usePersonaStore.getState().openSettings("backup")}>
          Backup settings…
        </SectionAction>
      </div>
    </Section>
  );
}
