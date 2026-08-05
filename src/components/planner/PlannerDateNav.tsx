import type { PlannerTab } from "@/planner/plannerStorage";
import { addDays, startOfWeekMonday } from "@/planner/plannerStorage";

export interface PlannerDateNavProps {
  tab: PlannerTab;
  onAnchorWeekChange: React.Dispatch<React.SetStateAction<Date>>;
}

export default function PlannerDateNav({ tab, onAnchorWeekChange }: PlannerDateNavProps) {
  const showDateNav = tab === "daily" || tab === "weekly" || tab === "monthly";
  if (!showDateNav) return null;

  const prevLabel =
    tab === "monthly" ? "Previous Year" : tab === "weekly" ? "Previous Month" : "Previous Week";
  const nextLabel =
    tab === "monthly" ? "Next Year" : tab === "weekly" ? "Next Month" : "Next Week";
  const midLabel = tab === "monthly" ? "This Year" : tab === "weekly" ? "This Month" : "Today";

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <button
        onClick={() =>
          onAnchorWeekChange((w) =>
            tab === "monthly"
              ? startOfWeekMonday(new Date(w.getFullYear() - 1, w.getMonth(), w.getDate()))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(w.getFullYear(), w.getMonth() - 1, w.getDate()))
                : addDays(w, -7),
          )
        }
        className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
      >
        {prevLabel}
      </button>
      <button
        onClick={() =>
          onAnchorWeekChange(
            tab === "monthly"
              ? startOfWeekMonday(new Date(new Date().getFullYear(), 0, 1))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
                : startOfWeekMonday(new Date()),
          )
        }
        className="rounded border border-accent/30 bg-accent/15 px-2 py-1 text-[10px] text-accent"
      >
        {midLabel}
      </button>
      <button
        onClick={() =>
          onAnchorWeekChange((w) =>
            tab === "monthly"
              ? startOfWeekMonday(new Date(w.getFullYear() + 1, w.getMonth(), w.getDate()))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(w.getFullYear(), w.getMonth() + 1, w.getDate()))
                : addDays(w, 7),
          )
        }
        className="rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
      >
        {nextLabel}
      </button>
    </div>
  );
}
