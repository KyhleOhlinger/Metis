import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  type PlannerLayoutTemplates,
  type TaskManifest,
  DEFAULT_LAYOUT_TEMPLATES,
  PLANNER_PURPLE_HEADER,
  WEEKLY_TEMPLATE,
  monthEntryFor,
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
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerWeeklyTabProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[220px_minmax(420px,1fr)] gap-1.5">
        <div className={PLANNER_PURPLE_HEADER}>
          {useMonthlyTemplateForDate(weeklyViewMonth)
            ? layoutTemplates.weeklyLeftHeader
            : DEFAULT_LAYOUT_TEMPLATES.weeklyLeftHeader}
        </div>
        <div className={PLANNER_PURPLE_HEADER}>
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
        return (
          <div key={wk} className="grid grid-cols-[220px_minmax(420px,1fr)] gap-1.5">
            <div className="rounded-md border border-border bg-surface-overlay/30 px-3 py-2 text-[11px] font-medium text-text-secondary">
              {weekHeader(monday)}
            </div>
            <div className="rounded-md border border-border bg-surface-overlay/30 p-2">
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
