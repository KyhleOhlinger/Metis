import { useStore } from "@/store/useStore";

export function plannerSyncStatusLabel(
  status: ReturnType<typeof useStore.getState>["plannerSyncStatus"],
  mode: "shared" | "vault",
  mirrorWarning?: string | null,
): string {
  if (status === "saved" && mirrorWarning) {
    return mode === "shared" ? "Saved (backup failed)" : "Saved";
  }
  switch (status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
      return mode === "shared" ? "Saving & syncing…" : "Saving…";
    case "syncing":
      return mode === "shared" ? "Syncing backup…" : "Saving…";
    case "saved":
      return mode === "shared" ? "Saved & synced" : "Saved";
    case "error":
      return "Sync failed";
    default:
      return "Up to date";
  }
}

export function PlannerSyncIndicator({ compact = false }: { compact?: boolean }) {
  const plannerSyncStatus = useStore((s) => s.plannerSyncStatus);
  const plannerSyncError = useStore((s) => s.plannerSyncError);
  const plannerMode = useStore((s) => s.plannerMode);

  const mirrorWarning =
    plannerSyncStatus === "saved" && plannerSyncError ? plannerSyncError : null;
  const label = plannerSyncStatusLabel(plannerSyncStatus, plannerMode, mirrorWarning);
  let className = "text-text-muted";
  if (plannerSyncStatus === "pending" || plannerSyncStatus === "saving" || plannerSyncStatus === "syncing") {
    className = "text-amber-400/90";
  } else if (plannerSyncStatus === "error" || mirrorWarning) {
    className = "text-red-400";
  } else if (plannerSyncStatus === "saved") {
    className = "text-emerald-400/90";
  }

  const detail = plannerSyncError ?? undefined;

  return (
    <span
      className={`${compact ? "text-[10px]" : "text-[11px]"} font-medium ${className}`}
      title={detail}
    >
      {label}
      {!compact && detail && plannerSyncStatus === "error" && (
        <span className="mt-0.5 block max-w-xs truncate font-normal opacity-80">{detail}</span>
      )}
    </span>
  );
}
