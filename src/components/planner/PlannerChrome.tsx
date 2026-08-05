import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { PlannerTab } from "@/planner/plannerStorage";
import Toolbar from "../Toolbar";
import { PlannerSyncIndicator } from "./PlannerSyncIndicator";
import PlannerTabBar from "./PlannerTabBar";
import PlannerDateNav from "./PlannerDateNav";

export interface PlannerChromeProps {
  tab: PlannerTab;
  onTabChange: (tab: PlannerTab) => void;
  onAnchorWeekChange: React.Dispatch<React.SetStateAction<Date>>;
  toolbarViewRef: MutableRefObject<EditorView | null>;
}

export default function PlannerChrome({
  tab,
  onTabChange,
  onAnchorWeekChange,
  toolbarViewRef,
}: PlannerChromeProps) {
  const showToolbar =
    tab === "weekly" ||
    tab === "monthly" ||
    tab === "templates" ||
    tab === "goals" ||
    tab === "reviews" ||
    tab === "daily";

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-text-primary">Daily Task View</p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Weekly planning/logging and review workspace (auto-saved to JSON on disk).
          </p>
        </div>
        <PlannerSyncIndicator compact />
      </div>
      <PlannerTabBar tab={tab} onTabChange={onTabChange} />
      <PlannerDateNav tab={tab} onAnchorWeekChange={onAnchorWeekChange} />
      {showToolbar && (
        <div className="mt-2 min-w-0 border-t border-border pt-2" data-metis-planner-toolbar>
          <Toolbar viewRef={toolbarViewRef} spellcheck={false} onToggleSpellcheck={() => {}} />
        </div>
      )}
    </div>
  );
}
