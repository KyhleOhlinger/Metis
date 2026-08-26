/** Date and calendar helpers for the planner. */

import { DAY_INDEX, DAY_NAMES, type DayName } from "./plannerTypes";

export function isDayName(value: unknown): value is DayName {
  return value === "Monday" || value === "Tuesday" || value === "Wednesday" || value === "Thursday" || value === "Friday";
}

export function jsDayFromDayName(day: DayName): number {
  return DAY_INDEX[day] + 1; // Monday->1 ... Friday->5
}

export function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay(); // 0 Sun .. 6 Sat
  const delta = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + delta);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function monthName(d: Date): string {
  return d.toLocaleString("en-US", { month: "long" });
}

export function monthShort(d: Date): string {
  return d.toLocaleString("en-US", { month: "short" });
}

export function weekKey(monday: Date): string {
  const friday = addDays(monday, 4);
  return `week_${String(monday.getDate()).padStart(2, "0")}_${String(friday.getDate()).padStart(2, "0")}`;
}

/** Parse `${weekKey}_${DayName}` from Daily Log expanded-cell state. */
export function parseDailyExpandedFocus(key: string | null): { wk: string; day: DayName } | null {
  if (!key) return null;
  for (const d of DAY_NAMES) {
    const suf = `_${d}`;
    if (key.endsWith(suf)) {
      return { wk: key.slice(0, -suf.length), day: d };
    }
  }
  return null;
}

export function weekHeader(monday: Date): string {
  const friday = addDays(monday, 4);
  const sameMonth = monday.getMonth() === friday.getMonth();
  if (sameMonth) {
    return `${monday.getDate()} - ${friday.getDate()} ${monthShort(monday)}`;
  }
  return `${monday.getDate()} ${monthShort(monday)} - ${friday.getDate()} ${monthShort(friday)}`;
}

export function parseWeekStartFromKey(year: number, monthIndex: number, wk: string): Date | null {
  const m = /^week_(\d{2})_(\d{2})$/.exec(wk);
  if (!m) return null;
  const day = Number(m[1]);
  const d = new Date(year, monthIndex, day);
  if (Number.isNaN(d.getTime())) return null;
  return startOfWeekMonday(d);
}

/** Calendar month selected in Weekly Review navigation (the week containing the 1st). */
export function resolveWeeklyViewMonth(anchorWeek: Date): Date {
  const weekStart = startOfDay(anchorWeek);
  const weekEnd = addDays(weekStart, 6);
  for (let y = weekStart.getFullYear() - 1; y <= weekStart.getFullYear() + 1; y++) {
    for (let m = 0; m < 12; m++) {
      const first = monthStart(y, m);
      if (first.getTime() >= weekStart.getTime() && first.getTime() <= weekEnd.getTime()) {
        return first;
      }
    }
  }
  return monthStart(anchorWeek.getFullYear(), anchorWeek.getMonth());
}

/** Every Monday that falls inside the given calendar month. */
export function mondaysInCalendarMonth(year: number, monthIndex: number): Date[] {
  const result: Date[] = [];
  const first = monthStart(year, monthIndex);
  let monday = startOfWeekMonday(first);
  if (monday.getTime() < first.getTime()) {
    monday = addDays(monday, 7);
  }
  while (monday.getFullYear() === year && monday.getMonth() === monthIndex) {
    result.push(new Date(monday));
    monday = addDays(monday, 7);
  }
  return result;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDateLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIdx, day);
  d.setHours(0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== monthIdx || d.getDate() !== day) {
    return null;
  }
  return d;
}

export function normalizeDateRange(startIso: string, endIso: string): { start: Date; end: Date } | null {
  const start = parseIsoDateLocal(startIso);
  const end = parseIsoDateLocal(endIso);
  if (!start || !end) return null;
  if (start.getTime() <= end.getTime()) return { start, end };
  return { start: end, end: start };
}

export function eachDateInclusive(startIso: string, endIso: string, fn: (d: Date) => void) {
  const range = normalizeDateRange(startIso, endIso);
  if (!range) return;
  let cursor = startOfDay(range.start);
  const end = startOfDay(range.end);
  while (cursor.getTime() <= end.getTime()) {
    fn(cursor);
    cursor = addDays(cursor, 1);
  }
}

/**
 * PTO span vs actual leave used.
 * - daysTotal: every calendar day in the inclusive range (weekends + holidays + PTO).
 * - daysTaken: Mon–Fri only, excluding public-holiday dates (actual PTO used).
 */
export function ptoDayCountsFromRange(
  startIso: string,
  endIso: string,
  holidayIsos?: Iterable<string>,
): { daysTotal: number; daysTaken: number } {
  const holidays = holidayIsos ? new Set(holidayIsos) : null;
  let daysTotal = 0;
  let daysTaken = 0;
  eachDateInclusive(startIso, endIso, (d) => {
    daysTotal += 1;
    if (!dayNameFromDate(d)) return;
    if (holidays?.has(toIsoDate(d))) return;
    daysTaken += 1;
  });
  return { daysTotal, daysTaken };
}

export function lastFridayOfMonth(anchor: Date): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const d = new Date(year, month + 1, 0);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== 5) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export function monthStart(year: number, monthIndex: number): Date {
  const d = new Date(year, monthIndex, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dayDate(monday: Date, day: DayName): Date {
  return addDays(monday, DAY_INDEX[day]);
}

export function dayNameFromDate(date: Date): DayName | null {
  const day = date.getDay();
  if (day === 1) return "Monday";
  if (day === 2) return "Tuesday";
  if (day === 3) return "Wednesday";
  if (day === 4) return "Thursday";
  if (day === 5) return "Friday";
  return null;
}

export function mondayForDate(date: Date): Date {
  return startOfWeekMonday(date);
}

export function nextWeekdayOnOrAfter(date: Date, day: DayName): Date {
  const out = startOfDay(date);
  const target = jsDayFromDayName(day);
  const delta = (target - out.getDay() + 7) % 7;
  return addDays(out, delta);
}

export function weekdayOccurrenceInMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}
