import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import { PLANNER_AI_SECTION_OPTIONS, type PlannerTab } from "@/planner/plannerTypes";
import { fetchPlannerConfig } from "@/planner/plannerPersistence";
import { toastError } from "@/store/useToastStore";
import { PlannerSyncIndicator } from "@/components/planner/PlannerSyncIndicator";

const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-text-muted";

export function PlannerSettingsSection() {
  const vaultPath = useStore((s) => s.vaultPath);
  const plannerReloadKey = useStore((s) => s.plannerReloadKey);
  const plannerAiExcludedSections =
    usePersonaStore((s) => s.settings.plannerAiExcludedSections) ?? [];
  const updateSettings = usePersonaStore((s) => s.updateSettings);
  const [activeDir, setActiveDir] = useState("");
  const [pathsLoading, setPathsLoading] = useState(false);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    setPathsLoading(true);
    void fetchPlannerConfig(vaultPath)
      .then((cfg) => {
        if (cancelled) return;
        setActiveDir(cfg.active_dir);
      })
      .catch((e) => {
        if (!cancelled) toastError(typeof e === "string" ? e : "Could not load planner status.");
      })
      .finally(() => {
        if (!cancelled) setPathsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, plannerReloadKey]);

  if (!vaultPath) {
    return <p className="text-[11px] text-text-muted">Open a vault to configure planner storage.</p>;
  }

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
        <p className={labelCls}>Storage</p>
        <p className="mt-1">
          This vault’s planner is stored under <span className="font-mono">.metis/planner/</span>.
        </p>
        <p className="mt-2 break-all font-mono text-[10px] text-text-secondary">
          {pathsLoading ? "Loading…" : activeDir || "—"}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-text-muted">Save status</span>
          <PlannerSyncIndicator compact />
        </div>
      </div>
    </div>
  );
}
