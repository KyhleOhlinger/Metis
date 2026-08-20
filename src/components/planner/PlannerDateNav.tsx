import type { Dispatch, SetStateAction } from "react";
import type { DailyWeekSpan, PlannerTab } from "@/planner/plannerStorage";
import {
  addDays,
  monthName,
  resolveWeeklyViewMonth,
  startOfWeekMonday,
  weekHeader,
} from "@/planner/plannerStorage";

export interface PlannerDateNavProps {
  tab: PlannerTab;
  anchorWeek: Date;
  onAnchorWeekChange: Dispatch<SetStateAction<Date>>;
  weekSpan?: DailyWeekSpan;
  onWeekSpanChange?: (span: DailyWeekSpan) => void;
  onJumpToday?: () => void;
  onExport?: () => void;
}

function periodLabel(tab: PlannerTab, anchorWeek: Date): string {
  if (tab === "monthly") {
    return String(anchorWeek.getFullYear());
  }
  if (tab === "weekly") {
    const month = resolveWeeklyViewMonth(anchorWeek);
    return `${monthName(month)} ${month.getFullYear()}`;
  }
  return weekHeader(anchorWeek);
}

const navBtn =
  "rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-secondary transition-colors hover:text-text-primary";
const spanBtn = (active: boolean) =>
  [
    "rounded px-2 py-1 text-[10px] font-medium transition-colors",
    active ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary",
  ].join(" ");

export default function PlannerDateNav({
  tab,
  anchorWeek,
  onAnchorWeekChange,
  weekSpan = 4,
  onWeekSpanChange,
  onJumpToday,
  onExport,
}: PlannerDateNavProps) {
  const showDateNav = tab === "daily" || tab === "weekly" || tab === "monthly";
  if (!showDateNav) return null;

  const prevLabel =
    tab === "monthly" ? "Previous Year" : tab === "weekly" ? "Previous Month" : "Previous Week";
  const nextLabel =
    tab === "monthly" ? "Next Year" : tab === "weekly" ? "Next Month" : "Next Week";
  const midLabel = tab === "monthly" ? "This Year" : tab === "weekly" ? "This Month" : "Today";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() =>
          onAnchorWeekChange((w) =>
            tab === "monthly"
              ? startOfWeekMonday(new Date(w.getFullYear() - 1, w.getMonth(), w.getDate()))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(w.getFullYear(), w.getMonth() - 1, w.getDate()))
                : addDays(w, -7),
          )
        }
        className={navBtn}
      >
        {prevLabel}
      </button>
      <button
        type="button"
        onClick={() => {
          onAnchorWeekChange(
            tab === "monthly"
              ? startOfWeekMonday(new Date(new Date().getFullYear(), 0, 1))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
                : startOfWeekMonday(new Date()),
          );
          if (tab === "daily") onJumpToday?.();
        }}
        className="rounded border border-accent/30 bg-accent/15 px-2 py-1 text-[10px] text-accent"
      >
        {midLabel}
      </button>
      <button
        type="button"
        onClick={() =>
          onAnchorWeekChange((w) =>
            tab === "monthly"
              ? startOfWeekMonday(new Date(w.getFullYear() + 1, w.getMonth(), w.getDate()))
              : tab === "weekly"
                ? startOfWeekMonday(new Date(w.getFullYear(), w.getMonth() + 1, w.getDate()))
                : addDays(w, 7),
          )
        }
        className={navBtn}
      >
        {nextLabel}
      </button>
      <span className="ml-0.5 text-[10px] font-medium text-text-secondary">
        {periodLabel(tab, anchorWeek)}
      </span>
      {tab === "daily" && onWeekSpanChange && (
        <span className="ml-1 flex items-center gap-0.5 rounded border border-border bg-surface-overlay p-0.5">
          {([1, 2, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onWeekSpanChange(n)}
              className={spanBtn(weekSpan === n)}
              title={`Show ${n} week${n === 1 ? "" : "s"}`}
            >
              {n}w
            </button>
          ))}
        </span>
      )}
      {onExport && (
        <button type="button" onClick={onExport} className={`${navBtn} ml-auto`}>
          Export markdown
        </button>
      )}
    </div>
  );
}
