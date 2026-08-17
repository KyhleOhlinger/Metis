import { useState } from "react";
import { useStore } from "@/store/useStore";
import { toastSuccess } from "@/store/useToastStore";
import { formatError } from "@/utils/formatError";
import {
  switchPlannerVaultMode,
  type PlannerStorageMode,
} from "@/planner/plannerPersistence";

interface Props {
  onComplete: () => void;
  onDismiss: () => void;
}

export default function PlannerSetupModal({ onComplete, onDismiss }: Props) {
  const vaultPath = useStore((s) => s.vaultPath);
  const [mode, setMode] = useState<PlannerStorageMode>("shared");
  const [seedFromShared, setSeedFromShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vaultPath) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await switchPlannerVaultMode(vaultPath, mode, mode === "vault" && seedFromShared);
      toastSuccess(mode === "vault" ? "Vault planner enabled." : "Shared planner enabled.");
      onComplete();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface-base p-5 shadow-xl"
        role="dialog"
        aria-labelledby="planner-setup-title"
      >
        <h2 id="planner-setup-title" className="text-sm font-semibold text-text-primary">
          How should Planner store data?
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          Choose once per vault. You can change this later in Settings → Planner. Cancel keeps
          planner unavailable until you complete setup.
        </p>

        <div className="mt-4 space-y-3 text-xs">
          <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 hover:border-accent/40">
            <input
              type="radio"
              name="planner-mode"
              checked={mode === "shared"}
              onChange={() => setMode("shared")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text-primary">Shared planner</span>
              <span className="mt-1 block text-text-muted">
                One planner across all vaults (stored in app data). A backup copy auto-syncs to{" "}
                <code className="text-[10px]">.metis/planner/</code> in every registered vault on
                save, vault open, and app close.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 hover:border-accent/40">
            <input
              type="radio"
              name="planner-mode"
              checked={mode === "vault"}
              onChange={() => setMode("vault")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text-primary">Vault planner</span>
              <span className="mt-1 block text-text-muted">
                Planner data lives only in this vault under{" "}
                <code className="text-[10px]">.metis/planner/</code> so vault backups include it.
                Does not change the shared planner unless you explicitly copy it in Settings.
              </span>
            </span>
          </label>

          {mode === "vault" && (
            <label className="ml-7 flex cursor-pointer items-start gap-2 text-text-muted">
              <input
                type="checkbox"
                checked={seedFromShared}
                onChange={(e) => setSeedFromShared(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span>Copy existing shared planner into this vault</span>
            </label>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
