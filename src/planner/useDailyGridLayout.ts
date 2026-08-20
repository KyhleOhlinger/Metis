import { useMemo } from "react";
import { DAY_NAMES, parseDailyExpandedFocus, weekKey } from "@/planner/plannerStorage";

export function useDailyGridLayout(
  dailyExpandedCellKey: string | null,
  visibleWeeks: Date[],
) {
  const dailyExpandedParsed = useMemo(
    () => parseDailyExpandedFocus(dailyExpandedCellKey),
    [dailyExpandedCellKey],
  );
  const dailyGridWeightedWeekIdx = useMemo(() => {
    if (!dailyExpandedParsed) return -1;
    return visibleWeeks.findIndex((m) => weekKey(m) === dailyExpandedParsed.wk);
  }, [dailyExpandedParsed, visibleWeeks]);
  const dailyGridWeightedDayIdx = useMemo(
    () => (dailyExpandedParsed ? DAY_NAMES.indexOf(dailyExpandedParsed.day) : -1),
    [dailyExpandedParsed],
  );
  const dailyGridWeighted =
    dailyExpandedParsed !== null && dailyGridWeightedWeekIdx >= 0 && dailyGridWeightedDayIdx >= 0;

  const weekCount = Math.max(1, visibleWeeks.length);
  const dailyGridTemplateColumns =
    dailyGridWeighted && dailyGridWeightedWeekIdx >= 0
      ? `110px ${Array.from({ length: weekCount }, (_, i) =>
          i === dailyGridWeightedWeekIdx ? "minmax(0, 4fr)" : "minmax(0, 1fr)",
        ).join(" ")}`
      : `110px repeat(${weekCount}, minmax(210px, 1fr))`;

  const dailyGridTemplateRows =
    dailyGridWeighted && dailyGridWeightedDayIdx >= 0
      ? `auto ${[0, 1, 2, 3, 4]
          .map((i) => (i === dailyGridWeightedDayIdx ? "minmax(0, 3fr)" : "minmax(0, 1fr)"))
          .join(" ")}`
      : undefined;

  return {
    dailyGridWeighted,
    dailyGridTemplateColumns,
    dailyGridTemplateRows,
  };
}
