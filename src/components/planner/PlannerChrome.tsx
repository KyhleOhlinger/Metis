import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { EditorView } from "@codemirror/view";
import type { DailyWeekSpan, PlannerTab } from "@/planner/plannerStorage";
import { usePersonaStore } from "@/store/usePersonaStore";
import { useStore } from "@/store/useStore";
import Toolbar from "../Toolbar";
import { PlannerSyncIndicator } from "./PlannerSyncIndicator";
import PlannerTabBar from "./PlannerTabBar";
import PlannerDateNav from "./PlannerDateNav";

const TAB_COPY: Record<PlannerTab, { title: string; subtitle: string }> = {
  daily: {
    title: "Daily Log",
    subtitle: "Week grid · auto-saved to disk",
  },
  weekly: {
    title: "Weekly Review",
    subtitle: "One note per week in the selected month",
  },
  monthly: {
    title: "Monthly Review",
    subtitle: "Review and achievements for each month of the year",
  },
  reviews: {
    title: "Reviews",
    subtitle: "Performance review cycles in a grid",
  },
  goals: {
    title: "Goals",
    subtitle: "Named sections for ongoing goals",
  },
  templates: {
    title: "Templates",
    subtitle: "Cadence fill for Daily Log, plus layout labels for current and future dates",
  },
  tracker: {
    title: "PTO & Events",
    subtitle: "Holidays, PTO, conferences, and office trips",
  },
};

export interface PlannerChromeProps {
  tab: PlannerTab;
  onTabChange: (tab: PlannerTab) => void;
  anchorWeek: Date;
  onAnchorWeekChange: Dispatch<SetStateAction<Date>>;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  showToolbar: boolean;
  weekSpan?: DailyWeekSpan;
  onWeekSpanChange?: (span: DailyWeekSpan) => void;
  onJumpToday?: () => void;
  onExport?: () => void;
}

export default function PlannerChrome({
  tab,
  onTabChange,
  anchorWeek,
  onAnchorWeekChange,
  toolbarViewRef,
  showToolbar,
  weekSpan,
  onWeekSpanChange,
  onJumpToday,
  onExport,
}: PlannerChromeProps) {
  const copy = TAB_COPY[tab];
  const spellcheckEnabled = usePersonaStore((s) => s.settings.spellcheckEnabled === true);
  const updateSettings = usePersonaStore((s) => s.updateSettings);
  const requestCommandCenter = useStore((s) => s.requestCommandCenter);
  const dailySubtitle =
    tab === "daily" && weekSpan
      ? `${weekSpan}-week grid · auto-saved to disk`
      : copy.subtitle;

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-text-primary">{copy.title}</p>
          <p className="mt-0.5 text-[10px] text-text-muted">{dailySubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => requestCommandCenter("info-planner")}
          className="shrink-0 rounded px-1 py-0.5 text-left hover:bg-surface-overlay"
          title="Open Command Center Info → Planner"
        >
          <PlannerSyncIndicator compact />
        </button>
      </div>
      <PlannerTabBar tab={tab} onTabChange={onTabChange} />
      <PlannerDateNav
        tab={tab}
        anchorWeek={anchorWeek}
        onAnchorWeekChange={onAnchorWeekChange}
        weekSpan={weekSpan}
        onWeekSpanChange={onWeekSpanChange}
        onJumpToday={onJumpToday}
        onExport={onExport}
      />
      {showToolbar && (
        <div className="mt-2 min-w-0 border-t border-border pt-2" data-metis-planner-toolbar>
          <Toolbar
            viewRef={toolbarViewRef}
            spellcheck={spellcheckEnabled}
            onToggleSpellcheck={() => updateSettings({ spellcheckEnabled: !spellcheckEnabled })}
          />
        </div>
      )}
    </div>
  );
}
