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
    <div className="mt-2 flex items-center gap-1.5">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={[
            "rounded border px-2.5 py-1 text-[10px] font-medium transition-colors",
            tab === id
              ? "border-accent/40 bg-accent/20 text-accent"
              : "border-border bg-surface-overlay text-text-secondary hover:text-text-primary",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
