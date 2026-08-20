export type DailyWeekSpan = 1 | 2 | 4;

const STORAGE_KEY = "metis_planner_daily_week_span_v1";

export function loadDailyWeekSpan(): DailyWeekSpan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "1" || raw === "2" || raw === "4") return Number(raw) as DailyWeekSpan;
  } catch {
    /* ignore */
  }
  return 4;
}

export function saveDailyWeekSpan(span: DailyWeekSpan): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(span));
  } catch {
    /* ignore */
  }
}
