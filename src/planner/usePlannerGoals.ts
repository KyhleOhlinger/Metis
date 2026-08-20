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

  const updateGoalSection = (
    id: string,
    patch: Partial<Pick<GoalSection, "title" | "content" | "targetDate" | "archived">>,
  ) => {
    setGoalSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addGoalSection = () => {
    setGoalSections((prev) => [...prev, { id: makeRowId(), title: "New goal section", content: "" }]);
  };

  const removeGoalSection = (id: string) => {
    setGoalSections((prev) => prev.filter((s) => s.id !== id));
  };

  const moveGoalSection = (id: string, dir: -1 | 1) => {
    setGoalSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(j, 0, row!);
      return next;
    });
  };

  const reorderGoalSection = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setGoalSections((prev) => {
      const from = prev.findIndex((s) => s.id === fromId);
      const to = prev.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  };

  return { updateGoalSection, addGoalSection, removeGoalSection, moveGoalSection, reorderGoalSection };
}
