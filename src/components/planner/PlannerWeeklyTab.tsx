import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  type PlannerLayoutTemplates,
  type TaskManifest,
  DEFAULT_LAYOUT_TEMPLATES,
  PLANNER_GRID_HEADER,
  WEEKLY_TEMPLATE,
  monthEntryFor,
  startOfWeekMonday,
  weekHeader,
} from "@/planner/plannerStorage";
import PlannerMarkdownCell from "./PlannerMarkdownCell";

export interface PlannerWeeklyTabProps {
  manifest: TaskManifest;
  weeklyViewMonth: Date;
  reviewWeeks: Array<{ wk: string; monday: Date }>;
  layoutTemplates: PlannerLayoutTemplates;
  useWeeklyTemplateForDate: (monday: Date) => boolean;
  useMonthlyTemplateForDate: (monthDate: Date) => boolean;
  onUpdateWeeklyReview: (monday: Date, content: string) => void;
  onOpenDailyWeek: (monday: Date) => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

export default function PlannerWeeklyTab({
  manifest,
  weeklyViewMonth,
  reviewWeeks,
  layoutTemplates,
  useWeeklyTemplateForDate,
  useMonthlyTemplateForDate,
  onUpdateWeeklyReview,
  onOpenDailyWeek,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerWeeklyTabProps) {
  const currentWeekStart = startOfWeekMonday(new Date()).getTime();

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[220px_minmax(420px,1fr)] gap-1.5">
        <div className={PLANNER_GRID_HEADER}>
          {useMonthlyTemplateForDate(weeklyViewMonth)
            ? layoutTemplates.weeklyLeftHeader
            : DEFAULT_LAYOUT_TEMPLATES.weeklyLeftHeader}
        </div>
        <div className={PLANNER_GRID_HEADER}>
          {useMonthlyTemplateForDate(weeklyViewMonth)
            ? layoutTemplates.weeklyRightHeader
            : DEFAULT_LAYOUT_TEMPLATES.weeklyRightHeader}
        </div>
      </div>
      {reviewWeeks.map(({ wk, monday }) => {
        const review = monthEntryFor(manifest, monday).weekly_reviews[wk];
        const weeklyDefault = useWeeklyTemplateForDate(monday)
          ? layoutTemplates.weeklyDefaultContent
          : WEEKLY_TEMPLATE;
        const weeklyLegacyAuto = review?.content === WEEKLY_TEMPLATE;
        const content =
          review && !(useWeeklyTemplateForDate(monday) && weeklyLegacyAuto)
            ? review.content
            : weeklyDefault;
        const isTemplate = content === weeklyDefault || weeklyLegacyAuto;
        const isCurrentWeek = monday.getTime() === currentWeekStart;
        return (
          <div
            key={wk}
            className={[
              "grid grid-cols-[220px_minmax(420px,1fr)] gap-1.5",
              isCurrentWeek ? "rounded-md ring-1 ring-accent/40" : "",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => onOpenDailyWeek(monday)}
              title="Open Daily Log for this week"
              className="rounded-md border border-border bg-surface-overlay/30 px-3 py-2 text-left text-[11px] font-medium text-text-secondary hover:border-accent/40 hover:text-accent"
            >
              {weekHeader(monday)}
              {isCurrentWeek && (
                <span className="ml-1.5 text-[9px] font-semibold text-accent">This week</span>
              )}
            </button>
            <div
              className={[
                "rounded-md border border-border bg-surface-overlay/30 p-2",
                isTemplate ? "italic text-text-muted" : "",
              ].join(" ")}
            >
              {isTemplate && (
                <p className="mb-1 text-[9px] font-medium not-italic text-text-muted">Template</p>
              )}
              <PlannerMarkdownCell
                fieldKey={`weekly-${wk}`}
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={content}
                onChange={(next) => onUpdateWeeklyReview(monday, next)}
                minHeightPx={110}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
