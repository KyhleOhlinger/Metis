import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  type PlannerLayoutTemplates,
  type TaskManifest,
  DEFAULT_LAYOUT_TEMPLATES,
  MONTHLY_PROMPTS,
  PLANNER_PURPLE_HEADER,
  makeMonthlyTemplateContent,
  monthEntryFor,
  monthName,
} from "@/planner/plannerStorage";
import PlannerMarkdownCell from "./PlannerMarkdownCell";

export interface PlannerMonthlyTabProps {
  manifest: TaskManifest;
  monthlyReviewYear: number;
  monthlyReviewMonths: Date[];
  layoutTemplates: PlannerLayoutTemplates;
  useMonthlyTemplateForDate: (monthDate: Date) => boolean;
  onUpdateMonthlyReview: (monday: Date, content: string) => void;
  onUpdateMonthlyAchievements: (monday: Date, achievements: string) => void;
  activeFieldKey: string | null;
  onActivateField: (key: string | null) => void;
  toolbarViewRef: RefObject<EditorView | null>;
}

export default function PlannerMonthlyTab({
  manifest,
  monthlyReviewYear,
  monthlyReviewMonths,
  layoutTemplates,
  useMonthlyTemplateForDate,
  onUpdateMonthlyReview,
  onUpdateMonthlyAchievements,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerMonthlyTabProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-text-primary">
        Monthly Reviews — {monthlyReviewYear}
      </p>
      {monthlyReviewMonths.map((monthDate) => {
        const monthEntry = monthEntryFor(manifest, monthDate);
        const prompts = useMonthlyTemplateForDate(monthDate)
          ? layoutTemplates.monthlyPrompts
          : MONTHLY_PROMPTS;
        const monthlyDefault = makeMonthlyTemplateContent(prompts);
        const monthlyLegacyDefault = makeMonthlyTemplateContent();
        const monthlyLegacyAuto = monthEntry.monthly_review.content === monthlyLegacyDefault;
        const content =
          monthEntry.monthly_review.content &&
          !(useMonthlyTemplateForDate(monthDate) && monthlyLegacyAuto)
            ? monthEntry.monthly_review.content
            : monthlyDefault;
        const achievementsValue = monthEntry.monthly_review.achievements ?? "";
        return (
          <div
            key={monthDate.toISOString()}
            data-monthly-row={monthDate.getMonth()}
            className="grid min-w-[920px] grid-cols-[120px_minmax(260px,1fr)_minmax(220px,1fr)] gap-1.5"
          >
            <div className={PLANNER_PURPLE_HEADER}>{monthName(monthDate)}</div>
            <div className={PLANNER_PURPLE_HEADER}>
              {useMonthlyTemplateForDate(monthDate)
                ? layoutTemplates.monthlyRightHeader
                : DEFAULT_LAYOUT_TEMPLATES.monthlyRightHeader}
            </div>
            <div className={PLANNER_PURPLE_HEADER}>Monthly Achievements</div>

            <div className="rounded-md border border-border bg-surface-overlay/30 px-3 py-2 text-[11px] font-semibold text-text-primary">
              {monthName(monthDate)}
            </div>
            <div className="rounded-md border border-border bg-surface-overlay/30 p-2">
              <PlannerMarkdownCell
                fieldKey={`monthly-r-${monthDate.toISOString()}`}
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={content}
                onChange={(next) => onUpdateMonthlyReview(monthDate, next)}
                minHeightPx={200}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
            <div className="rounded-md border border-border bg-surface-overlay/30 p-2">
              <PlannerMarkdownCell
                fieldKey={`monthly-a-${monthDate.toISOString()}`}
                activeFieldKey={activeFieldKey}
                onActivateField={onActivateField}
                value={achievementsValue}
                onChange={(next) => onUpdateMonthlyAchievements(monthDate, next)}
                minHeightPx={130}
                toolbarViewRef={toolbarViewRef}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
