import { useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import PlannerChrome from "./planner/PlannerChrome";
import PlannerDailyTab from "./planner/PlannerDailyTab";
import PlannerGoalsTab from "./planner/PlannerGoalsTab";
import PlannerMonthlyTab from "./planner/PlannerMonthlyTab";
import PlannerReviewsTab from "./planner/PlannerReviewsTab";
import PlannerTemplatesTab from "./planner/PlannerTemplatesTab";
import PlannerTrackerTab from "./planner/PlannerTrackerTab";
import PlannerWeeklyTab from "./planner/PlannerWeeklyTab";
import { useStore } from "@/store/useStore";
import { usePlanTemplates } from "@/planner/usePlanTemplates";
import { usePlannerBootstrap } from "@/planner/usePlannerBootstrap";
import { usePlannerManifest } from "@/planner/usePlannerManifest";
import { usePlannerTracker } from "@/planner/usePlannerTracker";
import { usePlannerGoals } from "@/planner/usePlannerGoals";
import { usePlannerReviews } from "@/planner/usePlannerReviews";
import { useDailyGridLayout } from "@/planner/useDailyGridLayout";
import { usePlannerNavigation } from "@/planner/usePlannerNavigation";
import { type PlannerTab, addDays, startOfDay, startOfWeekMonday } from "@/planner/plannerStorage";

export default function DailyTaskGrid() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const vaultPath = useStore((s) => s.vaultPath);
  const plannerMode = useStore((s) => s.plannerMode);
  const plannerReloadKey = useStore((s) => s.plannerReloadKey);
  const bumpPlannerReload = useStore((s) => s.bumpPlannerReload);
  const plannerNavigateTo = useStore((s) => s.plannerNavigateTo);
  const clearPlannerNavigateTo = useStore((s) => s.clearPlannerNavigateTo);

  const [tab, setTab] = useState<PlannerTab>("daily");
  const [anchorWeek, setAnchorWeek] = useState(() => startOfWeekMonday(new Date()));
  const [dailyExpandedCellKey, setDailyExpandedCellKey] = useState<string | null>(null);
  const [activePlannerFieldKey, setActivePlannerFieldKey] = useState<string | null>(null);

  const plannerToolbarViewRef = useRef<EditorView | null>(null);
  const plannerScrollRef = useRef<HTMLDivElement>(null);
  const dailyGridShellRef = useRef<HTMLDivElement>(null);

  const bootstrap = usePlannerBootstrap(vaultPath, plannerMode, plannerReloadKey);
  const manifestApi = usePlannerManifest(bootstrap.manifest, bootstrap.setManifest, anchorWeek, today);
  const trackerApi = usePlannerTracker(bootstrap.manifest, bootstrap.setManifest);
  const goalsApi = usePlannerGoals(bootstrap.goalSections, bootstrap.setGoalSections, bootstrap.hydrationComplete);
  const reviewsApi = usePlannerReviews(
    bootstrap.reviewsState,
    bootstrap.setReviewsState,
    bootstrap.hydrationComplete,
  );

  const visibleWeeks = useMemo(
    () => [0, 1, 2, 3].map((i) => addDays(anchorWeek, i * 7)),
    [anchorWeek],
  );

  const planTemplates = usePlanTemplates({
    plannerReady: bootstrap.plannerReady,
    plannerReloadKey,
    hydrationComplete: bootstrap.hydrationComplete,
    today,
    manifest: bootstrap.manifest,
    setManifest: bootstrap.setManifest,
    visibleWeeks,
  });

  const dailyGridLayout = useDailyGridLayout(dailyExpandedCellKey, visibleWeeks);

  usePlannerNavigation({
    plannerNavigateTo,
    clearPlannerNavigateTo,
    plannerScrollRef,
    tab,
    setTab,
    anchorWeek,
    setAnchorWeek,
    dailyExpandedCellKey,
    setDailyExpandedCellKey,
    setActivePlannerFieldKey,
    monthlyReviewYear: manifestApi.monthlyReviewYear,
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!bootstrap.plannerReady ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-text-muted">
          {bootstrap.plannerInitError ? (
            <>
              <p className="text-red-400">Could not load planner</p>
              <p className="max-w-md text-[10px]">{bootstrap.plannerInitError}</p>
              <button
                type="button"
                onClick={() => bumpPlannerReload()}
                className="mt-2 rounded border border-border px-3 py-1 text-[10px] text-text-primary hover:bg-surface-overlay"
              >
                Retry
              </button>
            </>
          ) : (
            <p>Loading planner…</p>
          )}
        </div>
      ) : (
        <>
          <PlannerChrome
            tab={tab}
            onTabChange={setTab}
            onAnchorWeekChange={setAnchorWeek}
            toolbarViewRef={plannerToolbarViewRef}
          />

          <div
            ref={plannerScrollRef}
            className={[
              "min-h-0 flex-1 overflow-auto p-3",
              tab === "daily" && dailyExpandedCellKey ? "flex flex-col" : "",
            ].join(" ")}
          >
            {tab === "daily" && (
              <PlannerDailyTab
                shellRef={dailyGridShellRef}
                visibleWeeks={visibleWeeks}
                manifest={bootstrap.manifest}
                today={today}
                layoutTemplates={bootstrap.layoutTemplates}
                dailyExpandedCellKey={dailyExpandedCellKey}
                onDailyExpandedCellKeyChange={setDailyExpandedCellKey}
                dailyGridWeighted={dailyGridLayout.dailyGridWeighted}
                dailyGridTemplateColumns={dailyGridLayout.dailyGridTemplateColumns}
                dailyGridTemplateRows={dailyGridLayout.dailyGridTemplateRows}
                onUpdateEntry={manifestApi.updateEntry}
                onNavigateToTracker={(focus) => {
                  setTab("tracker");
                  trackerApi.setTrackerFocus(focus);
                }}
                isOnOrAfterToday={manifestApi.isOnOrAfterToday}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}

            {tab === "templates" && (
              <PlannerTemplatesTab
                templates={planTemplates.templates}
                templateName={planTemplates.templateName}
                setTemplateName={planTemplates.setTemplateName}
                templateCadence={planTemplates.templateCadence}
                setTemplateCadence={planTemplates.setTemplateCadence}
                templateIntervalDaysInput={planTemplates.templateIntervalDaysInput}
                setTemplateIntervalDaysInput={planTemplates.setTemplateIntervalDaysInput}
                templateStartDate={planTemplates.templateStartDate}
                setTemplateStartDate={planTemplates.setTemplateStartDate}
                templateContent={planTemplates.templateContent}
                setTemplateContent={planTemplates.setTemplateContent}
                templateRecurrenceDay={planTemplates.templateRecurrenceDay}
                setTemplateRecurrenceDay={planTemplates.setTemplateRecurrenceDay}
                editingTemplateId={planTemplates.editingTemplateId}
                editTemplateName={planTemplates.editTemplateName}
                setEditTemplateName={planTemplates.setEditTemplateName}
                editTemplateCadence={planTemplates.editTemplateCadence}
                setEditTemplateCadence={planTemplates.setEditTemplateCadence}
                editTemplateIntervalDaysInput={planTemplates.editTemplateIntervalDaysInput}
                setEditTemplateIntervalDaysInput={planTemplates.setEditTemplateIntervalDaysInput}
                editTemplateStartDate={planTemplates.editTemplateStartDate}
                setEditTemplateStartDate={planTemplates.setEditTemplateStartDate}
                editTemplateContent={planTemplates.editTemplateContent}
                setEditTemplateContent={planTemplates.setEditTemplateContent}
                editTemplateRecurrenceDay={planTemplates.editTemplateRecurrenceDay}
                setEditTemplateRecurrenceDay={planTemplates.setEditTemplateRecurrenceDay}
                pendingTemplateAction={planTemplates.pendingTemplateAction}
                setPendingTemplateAction={planTemplates.setPendingTemplateAction}
                onAddTemplate={planTemplates.addTemplate}
                onToggleTemplate={planTemplates.toggleTemplate}
                onDeleteTemplate={planTemplates.deleteTemplate}
                onStartEditTemplate={planTemplates.startEditTemplate}
                onCancelEditTemplate={planTemplates.cancelEditTemplate}
                onCancelTemplateAction={planTemplates.cancelTemplateAction}
                onConfirmTemplateAction={planTemplates.confirmTemplateAction}
                onSaveTemplateEdits={planTemplates.saveTemplateEdits}
                layoutTemplates={bootstrap.layoutTemplates}
                onUpdateLayoutTemplates={bootstrap.updateLayoutTemplates}
                monthlyPromptDraft={bootstrap.monthlyPromptDraft}
                setMonthlyPromptDraft={bootstrap.setMonthlyPromptDraft}
                onApplyMonthlyPromptTemplate={bootstrap.applyMonthlyPromptTemplate}
                activeFieldKey={activePlannerFieldKey}
                onActivateField={setActivePlannerFieldKey}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}

            {tab === "reviews" && (
              <PlannerReviewsTab
                reviewsState={bootstrap.reviewsState}
                onAddRow={reviewsApi.addReviewRow}
                onHeaderChange={reviewsApi.updateReviewHeader}
                onRowPatch={reviewsApi.updateReviewRow}
                onRemoveRow={reviewsApi.removeReviewRow}
                activeFieldKey={activePlannerFieldKey}
                onActivateField={setActivePlannerFieldKey}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}

            {tab === "goals" && (
              <PlannerGoalsTab
                goalSections={bootstrap.goalSections}
                onAddSection={goalsApi.addGoalSection}
                onUpdateSection={goalsApi.updateGoalSection}
                onRemoveSection={goalsApi.removeGoalSection}
                activeFieldKey={activePlannerFieldKey}
                onActivateField={setActivePlannerFieldKey}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}

            {tab === "tracker" && (
              <PlannerTrackerTab
                tracker={trackerApi.tracker}
                ptoRemaining={trackerApi.ptoRemaining}
                trackerFocus={trackerApi.trackerFocus}
                today={today}
                importCountry={trackerApi.importCountry}
                setImportCountry={trackerApi.setImportCountry}
                importRegion={trackerApi.importRegion}
                setImportRegion={trackerApi.setImportRegion}
                importYear={trackerApi.importYear}
                setImportYear={trackerApi.setImportYear}
                importStatus={trackerApi.importStatus}
                importing={trackerApi.importing}
                importRegions={trackerApi.importRegions}
                onImportHolidays={trackerApi.importPublicHolidays}
                updateTracker={trackerApi.updateTracker}
                updateHoliday={trackerApi.updateHoliday}
                updatePto={trackerApi.updatePto}
                updateConference={trackerApi.updateConference}
                updateTrip={trackerApi.updateTrip}
              />
            )}

            {tab === "weekly" && (
              <PlannerWeeklyTab
                manifest={bootstrap.manifest}
                weeklyViewMonth={manifestApi.weeklyViewMonth}
                reviewWeeks={manifestApi.reviewWeeks}
                layoutTemplates={bootstrap.layoutTemplates}
                useWeeklyTemplateForDate={manifestApi.useWeeklyTemplateForDate}
                useMonthlyTemplateForDate={manifestApi.useMonthlyTemplateForDate}
                onUpdateWeeklyReview={manifestApi.updateWeeklyReview}
                activeFieldKey={activePlannerFieldKey}
                onActivateField={setActivePlannerFieldKey}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}

            {tab === "monthly" && (
              <PlannerMonthlyTab
                manifest={bootstrap.manifest}
                monthlyReviewYear={manifestApi.monthlyReviewYear}
                monthlyReviewMonths={manifestApi.monthlyReviewMonths}
                layoutTemplates={bootstrap.layoutTemplates}
                useMonthlyTemplateForDate={manifestApi.useMonthlyTemplateForDate}
                onUpdateMonthlyReview={manifestApi.updateMonthlyReview}
                onUpdateMonthlyAchievements={manifestApi.updateMonthlyAchievements}
                activeFieldKey={activePlannerFieldKey}
                onActivateField={setActivePlannerFieldKey}
                toolbarViewRef={plannerToolbarViewRef}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
