import { useEffect } from "react";
import {
  type GoalSection,
  makeRowId,
  saveGoals,
} from "@/planner/plannerStorage";

export function usePlannerGoals(
  goalSections: GoalSection[],
  setGoalSections: React.Dispatch<React.SetStateAction<GoalSection[]>>,
  hydrationComplete: boolean,
) {
  useEffect(() => {
    if (!hydrationComplete) return;
    saveGoals(goalSections);
  }, [goalSections, hydrationComplete]);

  const updateGoalSection = (id: string, patch: Partial<Pick<GoalSection, "title" | "content">>) => {
    setGoalSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addGoalSection = () => {
    setGoalSections((prev) => [...prev, { id: makeRowId(), title: "New goal section", content: "" }]);
  };

  const removeGoalSection = (id: string) => {
    setGoalSections((prev) => prev.filter((s) => s.id !== id));
  };

  return { updateGoalSection, addGoalSection, removeGoalSection };
}
