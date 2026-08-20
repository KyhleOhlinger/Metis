import type { RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  type PlannerLayoutTemplates,
  type TaskManifest,
  DEFAULT_LAYOUT_TEMPLATES,
  MONTHLY_PROMPTS,
  PLANNER_GRID_HEADER,
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
  onToggleMonthlyComplete: (monday: Date) => void;
  onOpenWeeklyMonth: (monthDate: Date) => void;
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
  onToggleMonthlyComplete,
  onOpenWeeklyMonth,
  activeFieldKey,
  onActivateField,
  toolbarViewRef,
}: PlannerMonthlyTabProps) {
  const now = new Date();
  const currentMonthIndex = now.getFullYear() === monthlyReviewYear ? now.getMonth() : -1;
  const reviewHeader = useMonthlyTemplateForDate(monthlyReviewMonths[0] ?? now)
    ? layoutTemplates.monthlyRightHeader
    : DEFAULT_LAYOUT_TEMPLATES.monthlyRightHeader;

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-10 grid min-w-[920px] grid-cols-[120px_minmax(260px,1fr)_minmax(220px,1fr)] gap-1.5 bg-surface-base py-1">
        <div className={PLANNER_GRID_HEADER}>Month</div>
        <div className={PLANNER_GRID_HEADER}>{reviewHeader}</div>
        <div className={PLANNER_GRID_HEADER}>Monthly Achievements</div>
      </div>
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
        const completed = monthEntry.monthly_review.date_completed;
        const isCurrent = monthDate.getMonth() === currentMonthIndex;
        return (
          <div
            key={monthDate.toISOString()}
            data-monthly-row={monthDate.getMonth()}
            className={[
              "grid min-w-[920px] grid-cols-[120px_minmax(260px,1fr)_minmax(220px,1fr)] gap-1.5",
              isCurrent ? "rounded-md ring-1 ring-accent/40" : "",
            ].join(" ")}
          >
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-overlay/30 px-3 py-2">
              <button
                type="button"
                onClick={() => onOpenWeeklyMonth(monthDate)}
                title="Open Weekly Review for this month"
                className="text-left text-[11px] font-semibold text-text-primary hover:text-accent"
              >
                {monthName(monthDate)}
                {isCurrent && (
                  <span className="ml-1 text-[9px] font-medium text-accent">Now</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onToggleMonthlyComplete(monthDate)}
                className={[
                  "rounded border px-2 py-0.5 text-[9px] font-medium",
                  completed
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {completed ? `Complete · ${completed}` : "Mark complete"}
              </button>
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
