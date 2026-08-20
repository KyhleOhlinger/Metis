import { addDays, toIsoDate } from "./plannerDates";
import type { TrackerData } from "./plannerTypes";

export type UpcomingKind = "holiday" | "pto" | "conference" | "trip";

export interface UpcomingPlannerItem {
  id: string;
  kind: UpcomingKind;
  dateIso: string;
  endIso?: string;
  title: string;
}

function overlapsRange(start: string, end: string, from: string, to: string): boolean {
  return start <= to && end >= from;
}

/** Tracker events that overlap today through the next `days - 1` calendar days. */
export function collectUpcomingPlannerItems(
  tracker: TrackerData,
  today: Date,
  days = 7,
): UpcomingPlannerItem[] {
  const from = toIsoDate(today);
  const to = toIsoDate(addDays(today, days - 1));
  const items: UpcomingPlannerItem[] = [];

  for (const row of tracker.public_holidays) {
    if (row.status === "Complete") continue;
    if (row.date >= from && row.date <= to) {
      items.push({ id: row.id, kind: "holiday", dateIso: row.date, title: row.name || "Holiday" });
    }
  }
  for (const row of tracker.pto) {
    if (row.status === "Complete") continue;
    if (overlapsRange(row.startDate, row.endDate, from, to)) {
      items.push({
        id: row.id,
        kind: "pto",
        dateIso: row.startDate,
        endIso: row.endDate,
        title: row.description || "PTO",
      });
    }
  }
  for (const row of tracker.conferences) {
    if (row.status === "Complete") continue;
    if (overlapsRange(row.startDate, row.endDate, from, to)) {
      items.push({
        id: row.id,
        kind: "conference",
        dateIso: row.startDate,
        endIso: row.endDate,
        title: row.eventName || "Conference",
      });
    }
  }
  for (const row of tracker.office_trips) {
    if (row.status === "Complete") continue;
    if (overlapsRange(row.startDate, row.endDate, from, to)) {
      items.push({
        id: row.id,
        kind: "trip",
        dateIso: row.startDate,
        endIso: row.endDate,
        title: row.tripName || "Office trip",
      });
    }
  }

  items.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.title.localeCompare(b.title));
  return items;
}

export function upcomingKindLabel(kind: UpcomingKind): string {
  switch (kind) {
    case "holiday":
      return "Holiday";
    case "pto":
      return "PTO";
    case "conference":
      return "Conference";
    case "trip":
      return "Trip";
  }
}
