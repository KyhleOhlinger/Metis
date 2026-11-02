import { useStore } from "@/store/useStore";

function plannerSyncStatusLabel(
  status: ReturnType<typeof useStore.getState>["plannerSyncStatus"],
): string {
  switch (status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
    case "syncing":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "Up to date";
  }
}

export function PlannerSyncIndicator({ compact = false }: { compact?: boolean }) {
  const plannerSyncStatus = useStore((s) => s.plannerSyncStatus);
  const plannerSyncError = useStore((s) => s.plannerSyncError);

  const label = plannerSyncStatusLabel(plannerSyncStatus);
  let className = "text-text-muted";
  if (plannerSyncStatus === "pending" || plannerSyncStatus === "saving" || plannerSyncStatus === "syncing") {
    className = "text-amber-400/90";
  } else if (plannerSyncStatus === "error") {
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
