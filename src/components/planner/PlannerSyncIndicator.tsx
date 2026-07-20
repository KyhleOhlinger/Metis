import { useStore } from "@/store/useStore";

export function plannerSyncStatusLabel(
  status: ReturnType<typeof useStore.getState>["plannerSyncStatus"],
  mode: "shared" | "vault",
): string {
  switch (status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
      return mode === "shared" ? "Saving & syncing…" : "Saving…";
    case "syncing":
      return "Syncing backup…";
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

  const label = plannerSyncStatusLabel(plannerSyncStatus, plannerMode);
  let className = "text-text-muted";
  if (plannerSyncStatus === "pending" || plannerSyncStatus === "saving" || plannerSyncStatus === "syncing") {
    className = "text-amber-400/90";
  } else if (plannerSyncStatus === "error") {
    className = "text-red-400";
  } else if (plannerSyncStatus === "saved") {
    className = "text-emerald-400/90";
  }

  return (
    <span
      className={`${compact ? "text-[10px]" : "text-[11px]"} font-medium ${className}`}
      title={plannerSyncError ?? undefined}
    >
      {label}
    </span>
  );
}
