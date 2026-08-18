import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  fetchPlannerConfig,
  fetchPlannerMirrorStatus,
  formatMirrorSyncTime,
  syncSharedMirror,
  flushPlannerSaves,
  switchPlannerVaultMode,
  type PlannerStorageMode,
} from "@/planner/plannerPersistence";
import { appConfirm, toastError, toastSuccess } from "@/store/useToastStore";
import { FieldLabel, Hint, KV, Section, ccSelectCls } from "../shared/ui";
import { PlannerSyncIndicator } from "@/components/planner/PlannerSyncIndicator";

export function PlannerInfoSection() {
  const vaultPath = useStore((s) => s.vaultPath);
  const plannerMode = useStore((s) => s.plannerMode);
  const plannerReloadKey = useStore((s) => s.plannerReloadKey);
  const plannerSyncStatus = useStore((s) => s.plannerSyncStatus);
  const setPlannerConfig = useStore((s) => s.setPlannerConfig);
  const [activeDir, setActiveDir] = useState("");
  const [mirrorSyncedAt, setMirrorSyncedAt] = useState<number | null>(null);
  const [registeredVaultCount, setRegisteredVaultCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pathsLoading, setPathsLoading] = useState(false);

  const refreshStatus = async () => {
    if (!vaultPath) return;
    setPathsLoading(true);
    try {
      const [cfg, mirror] = await Promise.all([
        fetchPlannerConfig(vaultPath),
        fetchPlannerMirrorStatus(vaultPath),
      ]);
      setActiveDir(cfg.active_dir);
      setMirrorSyncedAt(mirror.mirror_last_synced_unix ?? null);
      setRegisteredVaultCount(mirror.registered_vault_count);
      setPlannerConfig(cfg.mode, cfg.setup_required);
    } catch (e) {
      toastError(typeof e === "string" ? e : "Could not load planner status.");
      throw e;
    } finally {
      setPathsLoading(false);
    }
  };

  useEffect(() => {
    if (!vaultPath) return;
    void refreshStatus().catch(() => {});
  }, [vaultPath, plannerMode, plannerReloadKey]);

  useEffect(() => {
    if (plannerSyncStatus === "saved" && vaultPath) {
      void refreshStatus().catch(() => {});
    }
  }, [plannerSyncStatus, vaultPath]);

  if (!vaultPath) {
    return (
      <Section title="Planner">
        <Hint>Open a vault to configure planner storage.</Hint>
      </Section>
    );
  }

  const handleModeChange = async (next: PlannerStorageMode) => {
    if (next === plannerMode || busy) return;
    const label = next === "vault" ? "Vault planner" : "Shared planner";
    const ok = await appConfirm(
      next === "vault"
        ? "Planner data for this vault will be stored under .metis/planner/. Existing vault planner files are kept; shared planner is not changed."
        : "Planner data will use the shared profile store. Backups auto-sync to every registered vault's .metis/planner/ folder on save and when vaults open.",
      { title: `Switch to ${label}?` },
    );
    if (!ok) return;

    setBusy(true);
    try {
      const seed =
        next === "vault"
          ? await appConfirm("Seed this vault's planner from the current shared planner?", {
              title: "Copy shared planner?",
            })
          : false;
      await switchPlannerVaultMode(vaultPath, next, seed);
      await refreshStatus();
      toastSuccess(`Planner mode set to ${label}.`);
    } catch (e) {
      toastError(typeof e === "string" ? e : "Could not change planner mode.");
    } finally {
      setBusy(false);
    }
  };

  const handleManualSync = async () => {
    if (plannerMode !== "shared") return;
    setBusy(true);
    try {
      await flushPlannerSaves();
      await syncSharedMirror(vaultPath);
      await refreshStatus();
      toastSuccess("Planner backup synced to registered vaults.");
    } catch (e) {
      toastError(typeof e === "string" ? e : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Planner">
      <div className="space-y-2.5">
        <div>
          <FieldLabel>Storage mode</FieldLabel>
          <select
            value={plannerMode}
            disabled={busy}
            onChange={(e) => void handleModeChange(e.target.value as PlannerStorageMode)}
            className={ccSelectCls}
          >
            <option value="shared">Shared planner</option>
            <option value="vault">Vault planner</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Status</FieldLabel>
          <PlannerSyncIndicator />
        </div>

        {plannerMode === "shared" && (
          <button
            type="button"
            disabled={busy || plannerSyncStatus === "saving" || plannerSyncStatus === "syncing"}
            onClick={() => void handleManualSync()}
            className="w-full rounded border border-border px-2 py-1.5 text-[10px] font-medium text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            {plannerSyncStatus === "syncing" ? "Syncing…" : "Sync backup now"}
          </button>
        )}

        <KV label="Active path" value={pathsLoading ? "Loading…" : activeDir || "—"} mono stacked />
        {plannerMode === "shared" && (
          <>
            <KV label="Last vault backup" value={formatMirrorSyncTime(mirrorSyncedAt)} />
            <KV label="Registered vaults" value={String(registeredVaultCount)} />
          </>
        )}
      </div>
    </Section>
  );
}
