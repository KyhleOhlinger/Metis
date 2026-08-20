import type { PlannerTab } from "@/planner/plannerStorage";

const TABS: ReadonlyArray<[PlannerTab, string]> = [
  ["daily", "Daily Log"],
  ["weekly", "Weekly Review"],
  ["monthly", "Monthly Review"],
  ["reviews", "Reviews"],
  ["goals", "Goals"],
  ["templates", "Templates"],
  ["tracker", "PTO & Events"],
];

export interface PlannerTabBarProps {
  tab: PlannerTab;
  onTabChange: (tab: PlannerTab) => void;
}

export default function PlannerTabBar({ tab, onTabChange }: PlannerTabBarProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-0.5">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          aria-current={tab === id ? "page" : undefined}
          className={[
            "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
            tab === id
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:bg-surface-overlay hover:text-text-primary",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
