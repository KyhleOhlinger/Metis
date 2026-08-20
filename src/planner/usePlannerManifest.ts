import { useEffect, useMemo } from "react";
import {
  type DayName,
  type DayEntry,
  type TaskManifest,
  applyTrackerOverrides,
  getTracker,
  getYearEntry,
  makeEmptyMonthEntry,
  mondaysInCalendarMonth,
  monthEntryFor,
  monthName,
  monthStart,
  parseWeekStartFromKey,
  resolveWeeklyViewMonth,
  saveManifest,
  setEntry,
  setMonthlyReview,
  setWeeklyReview,
  startOfDay,
  startOfWeekMonday,
  toIsoDate,
  weekKey,
} from "@/planner/plannerStorage";

export function usePlannerManifest(
  manifest: TaskManifest,
  setManifest: React.Dispatch<React.SetStateAction<TaskManifest>>,
  anchorWeek: Date,
  today: Date,
) {
  const weeklyViewMonth = useMemo(() => resolveWeeklyViewMonth(anchorWeek), [anchorWeek]);
  const reviewWeeks = useMemo(() => {
    const year = weeklyViewMonth.getFullYear();
    const monthIndex = weeklyViewMonth.getMonth();
    const monthLabel = monthName(weeklyViewMonth);
    const monthEntry = getYearEntry(manifest, String(year))[monthLabel] ?? makeEmptyMonthEntry();

    const dedup = new Map<string, Date>();
    for (const monday of mondaysInCalendarMonth(year, monthIndex)) {
      dedup.set(weekKey(monday), monday);
    }
    for (const wk of Object.keys(monthEntry.weekly_reviews)) {
      if (dedup.has(wk)) continue;
      const parsed = parseWeekStartFromKey(year, monthIndex, wk);
      if (parsed && parsed.getMonth() === monthIndex && parsed.getFullYear() === year) {
        dedup.set(wk, parsed);
      }
    }
    return [...dedup.entries()]
      .sort((a, b) => a[1].getTime() - b[1].getTime())
      .map(([wk, monday]) => ({ wk, monday }));
  }, [manifest, weeklyViewMonth]);

  const monthlyReviewYear = anchorWeek.getFullYear();
  const monthlyReviewMonths = useMemo(
    () => Array.from({ length: 12 }, (_, i) => monthStart(monthlyReviewYear, i)),
    [monthlyReviewYear],
  );

  const todayWeekStart = useMemo(() => startOfWeekMonday(today), [today]);
  const todayMonthStart = useMemo(() => monthStart(today.getFullYear(), today.getMonth()), [today]);

  const tracker = useMemo(() => getTracker(manifest), [manifest]);
  const trackerSyncKey = useMemo(
    () =>
      JSON.stringify({
        holidays: tracker.public_holidays,
        pto: tracker.pto,
        conferences: tracker.conferences,
        trips: tracker.office_trips,
      }),
    [tracker],
  );

  const isOnOrAfterToday = (date: Date) => startOfDay(date).getTime() >= today.getTime();
  const useWeeklyTemplateForDate = (monday: Date) => monday.getTime() >= todayWeekStart.getTime();
  const useMonthlyTemplateForDate = (monthDate: Date) =>
    monthStart(monthDate.getFullYear(), monthDate.getMonth()).getTime() >= todayMonthStart.getTime();

  const updateEntry = (monday: Date, day: DayName, next: DayEntry) => {
    setManifest((prev) => {
      const updated = setEntry(prev, monday, day, next);
      saveManifest(updated);
      return updated;
    });
  };

  const updateWeeklyReview = (monday: Date, content: string) => {
    setManifest((prev) => {
      const updated = setWeeklyReview(prev, monday, content);
      saveManifest(updated);
      return updated;
    });
  };

  const updateMonthlyReview = (monday: Date, content: string) => {
    setManifest((prev) => {
      const updated = setMonthlyReview(prev, monday, { content });
      saveManifest(updated);
      return updated;
    });
  };

  const updateMonthlyAchievements = (monday: Date, achievements: string) => {
    setManifest((prev) => {
      const updated = setMonthlyReview(prev, monday, { achievements });
      saveManifest(updated);
      return updated;
    });
  };

  const toggleMonthlyComplete = (monday: Date) => {
    setManifest((prev) => {
      const current = monthEntryFor(prev, monday).monthly_review.date_completed;
      const updated = setMonthlyReview(prev, monday, {
        date_completed: current ? null : toIsoDate(new Date()),
      });
      saveManifest(updated);
      return updated;
    });
  };

  useEffect(() => {
    setManifest((prev) => {
      const result = applyTrackerOverrides(prev);
      if (!result.changed) return prev;
      saveManifest(result.manifest);
      return result.manifest;
    });
  }, [trackerSyncKey, setManifest]);

  return {
    weeklyViewMonth,
    reviewWeeks,
    monthlyReviewYear,
    monthlyReviewMonths,
    isOnOrAfterToday,
    useWeeklyTemplateForDate,
    useMonthlyTemplateForDate,
    updateEntry,
    updateWeeklyReview,
    updateMonthlyReview,
    updateMonthlyAchievements,
    toggleMonthlyComplete,
  };
}
