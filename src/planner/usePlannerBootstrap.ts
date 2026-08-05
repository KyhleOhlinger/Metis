import { useEffect, useState } from "react";
import type { PlannerStorageMode } from "@/planner/plannerPersistence";
import {
  initPlannerPersistence,
  resetPlannerPersistence,
} from "@/planner/plannerPersistence";
import {
  type GoalSection,
  type PlannerLayoutTemplates,
  type ReviewsTableState,
  type TaskManifest,
  DEFAULT_LAYOUT_TEMPLATES,
  defaultReviewsState,
  loadGoals,
  loadLayoutTemplates,
  loadManifest,
  loadReviews,
  saveLayoutTemplates,
} from "@/planner/plannerStorage";

export function usePlannerBootstrap(
  vaultPath: string | null,
  plannerMode: PlannerStorageMode,
  plannerReloadKey: number,
) {
  const [plannerReady, setPlannerReady] = useState(false);
  const [plannerInitError, setPlannerInitError] = useState<string | null>(null);
  const [hydrationComplete, setHydrationComplete] = useState(false);
  const [manifest, setManifest] = useState<TaskManifest>({});
  const [layoutTemplates, setLayoutTemplates] = useState<PlannerLayoutTemplates>(
    () => DEFAULT_LAYOUT_TEMPLATES,
  );
  const [monthlyPromptDraft, setMonthlyPromptDraft] = useState("");
  const [goalSections, setGoalSections] = useState<GoalSection[]>([]);
  const [reviewsState, setReviewsState] = useState<ReviewsTableState>(() => defaultReviewsState());

  useEffect(() => {
    if (!vaultPath) {
      setPlannerReady(false);
      setPlannerInitError(null);
      setHydrationComplete(false);
      return;
    }
    let cancelled = false;
    setPlannerReady(false);
    setPlannerInitError(null);
    setHydrationComplete(false);
    void (async () => {
      try {
        await initPlannerPersistence(vaultPath, plannerMode);
        if (cancelled) return;
        const layout = loadLayoutTemplates();
        setManifest(loadManifest());
        setLayoutTemplates(layout);
        setMonthlyPromptDraft(layout.monthlyPrompts.join("\n"));
        setGoalSections(loadGoals());
        setReviewsState(loadReviews());
        setPlannerReady(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPlannerInitError(message || "Could not load planner data.");
        setPlannerReady(false);
      }
    })();
    return () => {
      cancelled = true;
      void resetPlannerPersistence();
    };
  }, [vaultPath, plannerMode, plannerReloadKey]);

  useEffect(() => {
    if (!plannerReady) {
      setHydrationComplete(false);
      return;
    }
    const id = requestAnimationFrame(() => setHydrationComplete(true));
    return () => cancelAnimationFrame(id);
  }, [plannerReady, vaultPath, plannerMode, plannerReloadKey]);

  useEffect(() => {
    if (!hydrationComplete) return;
    saveLayoutTemplates(layoutTemplates);
  }, [layoutTemplates, hydrationComplete]);

  const updateLayoutTemplates = (patch: Partial<PlannerLayoutTemplates>) => {
    setLayoutTemplates((prev) => ({ ...prev, ...patch }));
  };

  const applyMonthlyPromptTemplate = () => {
    const prompts = monthlyPromptDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!prompts.length) return;
    updateLayoutTemplates({ monthlyPrompts: prompts });
  };

  return {
    plannerReady,
    plannerInitError,
    hydrationComplete,
    manifest,
    setManifest,
    layoutTemplates,
    monthlyPromptDraft,
    setMonthlyPromptDraft,
    goalSections,
    setGoalSections,
    reviewsState,
    setReviewsState,
    updateLayoutTemplates,
    applyMonthlyPromptTemplate,
  };
}
