import { useEffect, type RefObject } from "react";
import type { PlannerTab } from "@/planner/plannerStorage";
import {
  dayNameFromDate,
  monthStart,
  parseIsoDateLocal,
  startOfWeekMonday,
  weekKey,
} from "@/planner/plannerStorage";
import type { PlannerNavigateTarget } from "@/store/plannerNavigation";

export function usePlannerNavigation(options: {
  plannerNavigateTo: PlannerNavigateTarget | null;
  clearPlannerNavigateTo: () => void;
  plannerScrollRef: RefObject<HTMLDivElement | null>;
  tab: PlannerTab;
  setTab: (tab: PlannerTab) => void;
  anchorWeek: Date;
  setAnchorWeek: React.Dispatch<React.SetStateAction<Date>>;
  dailyExpandedCellKey: string | null;
  setDailyExpandedCellKey: React.Dispatch<React.SetStateAction<string | null>>;
  setActivePlannerFieldKey: React.Dispatch<React.SetStateAction<string | null>>;
  monthlyReviewYear: number;
}) {
  const {
    plannerNavigateTo,
    clearPlannerNavigateTo,
    plannerScrollRef,
    tab,
    setTab,
    setAnchorWeek,
    dailyExpandedCellKey,
    setDailyExpandedCellKey,
    setActivePlannerFieldKey,
    monthlyReviewYear,
  } = options;

  useEffect(() => {
    if (!plannerNavigateTo) return;
    const target = plannerNavigateTo;

    if (target.kind === "daily") {
      const d = parseIsoDateLocal(target.dateIso);
      if (d) {
        const monday = startOfWeekMonday(d);
        setTab("daily");
        setAnchorWeek(monday);
        const day = dayNameFromDate(d);
        if (day) {
          setDailyExpandedCellKey(`${weekKey(monday)}_${day}`);
        } else {
          setDailyExpandedCellKey(null);
        }
      }
    } else if (target.kind === "weekly") {
      const d = parseIsoDateLocal(target.dateIso);
      if (d) {
        setTab("weekly");
        setAnchorWeek(startOfWeekMonday(d));
      }
    } else if (target.kind === "monthly") {
      setTab("monthly");
      setAnchorWeek(startOfWeekMonday(monthStart(target.year, target.monthIndex)));
      requestAnimationFrame(() => {
        const el = plannerScrollRef.current;
        const row = el?.querySelector<HTMLElement>(`[data-monthly-row="${target.monthIndex}"]`);
        row?.scrollIntoView({ block: "start" });
      });
    }

    clearPlannerNavigateTo();
  }, [
    plannerNavigateTo,
    clearPlannerNavigateTo,
    plannerScrollRef,
    setTab,
    setAnchorWeek,
    setDailyExpandedCellKey,
  ]);

  useEffect(() => {
    const el = plannerScrollRef.current;
    if (!el || (tab === "daily" && dailyExpandedCellKey)) return;
    requestAnimationFrame(() => {
      if (tab === "monthly") {
        const now = new Date();
        const targetMonth = monthlyReviewYear === now.getFullYear() ? now.getMonth() : 0;
        const row = el.querySelector<HTMLElement>(`[data-monthly-row="${targetMonth}"]`);
        if (row) {
          row.scrollIntoView({ block: "start" });
          return;
        }
      }
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
  }, [tab, dailyExpandedCellKey, monthlyReviewYear, plannerScrollRef]);

  useEffect(() => {
    if (tab !== "daily") setDailyExpandedCellKey(null);
    setActivePlannerFieldKey(null);
  }, [tab, setDailyExpandedCellKey, setActivePlannerFieldKey]);

  useEffect(() => {
    setDailyExpandedCellKey(null);
  }, [options.anchorWeek, setDailyExpandedCellKey]);
}
