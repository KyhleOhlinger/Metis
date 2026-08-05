/** Pure manifest read/write helpers for planner entries. */

import { monthName, weekKey } from "./plannerDates";
import {
  makeEmptyMonthEntry,
  makeEmptyTracker,
  type DayEntry,
  type DayName,
  type MonthEntry,
  type TaskManifest,
  type TrackerData,
  type YearEntry,
} from "./plannerTypes";

export function getYearEntry(manifest: TaskManifest, year: string): YearEntry {
  const value = manifest[year];
  if (!value || typeof value !== "object" || Array.isArray(value) || year === "tracker") return {};
  if ("public_holidays" in (value as object)) return {};
  return value as YearEntry;
}

export function getTracker(manifest: TaskManifest): TrackerData {
  return manifest.tracker ?? makeEmptyTracker();
}

export function monthEntryFor(manifest: TaskManifest, monday: Date): MonthEntry {
  const year = String(monday.getFullYear());
  const month = monthName(monday);
  return getYearEntry(manifest, year)[month] ?? makeEmptyMonthEntry();
}

export function getEntry(
  manifest: TaskManifest,
  monday: Date,
  day: DayName,
): DayEntry {
  const wk = weekKey(monday);
  return monthEntryFor(manifest, monday).daily_logs[wk]?.[day] ?? { status: "work", planned: "", did: "" };
}

export function setEntry(
  manifest: TaskManifest,
  monday: Date,
  day: DayName,
  entry: DayEntry,
): TaskManifest {
  const year = String(monday.getFullYear());
  const month = monthName(monday);
  const wk = weekKey(monday);
  const yearEntry = getYearEntry(manifest, year);
  const monthEntry = yearEntry[month] ?? makeEmptyMonthEntry();
  return {
    ...manifest,
    [year]: {
      ...yearEntry,
      [month]: {
        ...monthEntry,
        daily_logs: {
          ...monthEntry.daily_logs,
          [wk]: {
            ...(monthEntry.daily_logs[wk] ?? {}),
            [day]: entry,
          },
        },
      },
    },
  };
}

export function setWeeklyReview(manifest: TaskManifest, monday: Date, content: string): TaskManifest {
  const year = String(monday.getFullYear());
  const month = monthName(monday);
  const wk = weekKey(monday);
  const yearEntry = getYearEntry(manifest, year);
  const monthEntry = yearEntry[month] ?? makeEmptyMonthEntry();
  return {
    ...manifest,
    [year]: {
      ...yearEntry,
      [month]: {
        ...monthEntry,
        weekly_reviews: {
          ...monthEntry.weekly_reviews,
          [wk]: { content },
        },
      },
    },
  };
}

export function setMonthlyReview(
  manifest: TaskManifest,
  monday: Date,
  patch: { content?: string; achievements?: string },
  dateCompleted: string,
): TaskManifest {
  const year = String(monday.getFullYear());
  const month = monthName(monday);
  const yearEntry = getYearEntry(manifest, year);
  const monthEntry = yearEntry[month] ?? makeEmptyMonthEntry();
  return {
    ...manifest,
    [year]: {
      ...yearEntry,
      [month]: {
        ...monthEntry,
        monthly_review: {
          ...monthEntry.monthly_review,
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          ...(patch.achievements !== undefined ? { achievements: patch.achievements } : {}),
          date_completed: dateCompleted,
        },
      },
    },
  };
}
