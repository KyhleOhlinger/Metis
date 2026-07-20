import { useState } from "react";
import { useStore } from "@/store/useStore";
import { restoreSharedFromVault } from "@/planner/plannerPersistence";
import { toastError, toastSuccess } from "@/store/useToastStore";

export default function PlannerRestoreModal() {
  const vaultPath = useStore((s) => s.vaultPath);
  const plannerRestoreOffer = useStore((s) => s.plannerRestoreOffer);
  const setPlannerRestoreOffer = useStore((s) => s.setPlannerRestoreOffer);
  const bumpPlannerReload = useStore((s) => s.bumpPlannerReload);
  const [busy, setBusy] = useState(false);

  if (!vaultPath || !plannerRestoreOffer) return null;

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restoreSharedFromVault(vaultPath);
      setPlannerRestoreOffer(false);
      bumpPlannerReload();
      toastSuccess("Planner restored from vault backup.");
    } catch (e) {
      toastError(typeof e === "string" ? e : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface-base p-5 shadow-xl"
        role="dialog"
        aria-labelledby="planner-restore-title"
      >
        <h2 id="planner-restore-title" className="text-sm font-semibold text-text-primary">
          Restore planner from vault backup?
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          The shared planner in app data appears empty, but this vault has a backup under{" "}
          <code className="text-[10px]">.metis/planner/</code>. Restore it into the shared planner?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPlannerRestoreOffer(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay disabled:opacity-50"
          >
            Start fresh
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRestore()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Restoring…" : "Restore backup"}
          </button>
        </div>
      </div>
    </div>
  );
}
