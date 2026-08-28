import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { PLANNER_AI_SECTION_OPTIONS, type PlannerTab } from "@/planner/plannerTypes";
import {
  copySharedPlannerToVault,
  copyVaultPlannerToShared,
  fetchPlannerConfig,
  fetchPlannerMirrorStatus,
  formatMirrorSyncTime,
  syncSharedMirror,
  flushPlannerSaves,
  switchPlannerVaultMode,
  type PlannerStorageMode,
} from "@/planner/plannerPersistence";
import { appConfirm, toastError, toastSuccess } from "@/store/useToastStore";
import { PlannerSyncIndicator } from "@/components/planner/PlannerSyncIndicator";

const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-text-muted";

export function PlannerSettingsSection() {
  const vaultPath = useStore((s) => s.vaultPath);
  const plannerMode = useStore((s) => s.plannerMode);
  const plannerReloadKey = useStore((s) => s.plannerReloadKey);
  const plannerSyncStatus = useStore((s) => s.plannerSyncStatus);
  const setPlannerConfig = useStore((s) => s.setPlannerConfig);
  const bumpPlannerReload = useStore((s) => s.bumpPlannerReload);
  const plannerAiExcludedSections =
    usePersonaStore((s) => s.settings.plannerAiExcludedSections) ?? [];
  const updateSettings = usePersonaStore((s) => s.updateSettings);
  const [activeDir, setActiveDir] = useState("");
  const [mirrorDir, setMirrorDir] = useState("");
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
      setMirrorDir(cfg.mirror_dir);
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
    return <p className="text-[11px] text-text-muted">Open a vault to configure planner storage.</p>;
  }

  const switchMode = async (next: PlannerStorageMode) => {
    if (next === plannerMode) return;
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
      const seed = next === "vault"
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

  const runMirrorSync = async () => {
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

  const promoteVaultToShared = async () => {
    const ok = await appConfirm(
      "This overwrites the shared planner with this vault's planner data. This cannot be undone automatically.",
      { title: "Replace shared planner?", danger: true },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await flushPlannerSaves();
      await copyVaultPlannerToShared(vaultPath);
      await refreshStatus();
      bumpPlannerReload();
      toastSuccess("Vault planner copied to shared planner.");
    } catch (e) {
      toastError(typeof e === "string" ? e : "Copy failed.");
    } finally {
      setBusy(false);
    }
  };

  const importSharedToVault = async () => {
    const ok = await appConfirm(
      "This replaces this vault's planner files with the shared planner. Vault-only data may be lost.",
      { title: "Overwrite vault planner?", danger: true },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await flushPlannerSaves();
      await copySharedPlannerToVault(vaultPath);
      await refreshStatus();
      bumpPlannerReload();
      toastSuccess("Shared planner copied into this vault.");
    } catch (e) {
      toastError(typeof e === "string" ? e : "Copy failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-[11px] text-text-muted">
      <div>
        <p className={labelCls}>AI context</p>
        <p className="mt-1">
          Agents receive every planner tab by default. Check a tab to exclude it from AI runs
          (Scope → Planner, Planner persona, and Task Manager calendar).
        </p>
        <div className="mt-2 space-y-1.5">
          {PLANNER_AI_SECTION_OPTIONS.map((opt) => {
            const excluded = plannerAiExcludedSections.includes(opt.id);
            return (
              <label key={opt.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={excluded}
                  onChange={() => {
                    const next: PlannerTab[] = excluded
                      ? plannerAiExcludedSections.filter((id) => id !== opt.id)
                      : [...plannerAiExcludedSections, opt.id];
                    updateSettings({ plannerAiExcludedSections: next });
                  }}
                  className="rounded border-border"
                />
                <span className="text-text-primary">Exclude {opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <p className={labelCls}>Storage mode</p>
        <p className="mt-1">
          Current:{" "}
          <span className="font-medium text-text-primary">
            {plannerMode === "vault" ? "Vault planner" : "Shared planner"}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || plannerMode === "shared"}
            onClick={() => void switchMode("shared")}
            className="rounded border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            Use shared planner
          </button>
          <button
            type="button"
            disabled={busy || plannerMode === "vault"}
            onClick={() => void switchMode("vault")}
            className="rounded border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            Use vault planner
          </button>
        </div>
      </div>

      <div>
        <p className={labelCls}>Paths</p>
        <p className="mt-1 break-all font-mono text-[10px] text-text-secondary">
          {pathsLoading ? "Loading…" : activeDir || "—"}
        </p>
        {plannerMode === "shared" && mirrorDir && (
          <>
            <p className="mt-2 text-[10px]">
              Vault backup mirror: <span className="font-mono text-text-secondary">{mirrorDir}</span>
            </p>
            <p className="mt-1 text-[10px]">
              Last backup sync:{" "}
              <span className="text-text-secondary">{formatMirrorSyncTime(mirrorSyncedAt)}</span>
            </p>
            <p className="mt-1 text-[10px]">
              Registered vaults for auto-backup:{" "}
              <span className="text-text-secondary">{registeredVaultCount}</span>
            </p>
          </>
        )}
      </div>

      {plannerMode === "shared" && (
        <div>
          <p className={labelCls}>Automatic backup</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted">Sync status</span>
            <PlannerSyncIndicator compact />
          </div>
          <p className="mt-1">
            Shared planner mirrors to every registered vault on save, vault open, and app close.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runMirrorSync()}
            className="mt-2 rounded border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            Sync backup now
          </button>
        </div>
      )}

      <div>
        <p className={labelCls}>Manual copy</p>
        <p className="mt-1">One-way copies with confirmation.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void importSharedToVault()}
            className="rounded border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            Shared → this vault
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void promoteVaultToShared()}
            className="rounded border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-overlay disabled:opacity-50"
          >
            This vault → shared
          </button>
        </div>
      </div>
    </div>
  );
}
