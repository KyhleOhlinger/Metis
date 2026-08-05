/** Tracker-driven day overrides and office trip banners. */

import {
  dayDate,
  dayNameFromDate,
  eachDateInclusive,
  mondayForDate,
  parseIsoDateLocal,
  parseWeekStartFromKey,
  startOfDay,
  toIsoDate,
} from "./plannerDates";
import { getEntry, getTracker, getYearEntry, monthEntryFor, setEntry } from "./plannerManifestOps";
import {
  DAY_NAMES,
  MONTH_INDEX,
  SPECIAL_LABELS,
  type TaskManifest,
  type TaskStatus,
  type TrackerData,
  type TrackerStatus,
} from "./plannerTypes";

type TrackerOverride = {
  status: TaskStatus;
  label: string;
  sourceType: "holiday" | "pto" | "conference" | "trip";
  sourceId: string;
};

type OfficeTripBanner = {
  label: string;
  sourceId: string;
};

export function isTrackerActive(status: TrackerStatus): boolean {
  return status === "Complete" || status === "Coming Up";
}

export function isLongWeekendHoliday(dateIso: string): boolean {
  const d = parseIsoDateLocal(dateIso);
  if (!d) return false;
  const day = d.getDay();
  return day === 1 || day === 5; // Monday or Friday
}

export function buildTrackerOverrides(tracker: TrackerData): Map<string, TrackerOverride> {
  const out = new Map<string, TrackerOverride>();
  for (const row of tracker.public_holidays) {
    if (!isTrackerActive(row.status)) continue;
    const label = row.name || SPECIAL_LABELS.holiday;
    out.set(row.date, {
      status: "holiday",
      label: isLongWeekendHoliday(row.date) ? `${label} · Long Weekend` : label,
      sourceType: "holiday",
      sourceId: row.id,
    });
  }
  for (const row of tracker.pto) {
    if (!isTrackerActive(row.status)) continue;
    eachDateInclusive(row.startDate, row.endDate, (d) => {
      out.set(toIsoDate(d), {
        status: "pto",
        label: row.description ? `PTO · ${row.description}` : SPECIAL_LABELS.pto,
        sourceType: "pto",
        sourceId: row.id,
      });
    });
  }
  for (const row of tracker.conferences) {
    if (!isTrackerActive(row.status) && row.activity !== "Booked") continue;
    eachDateInclusive(row.startDate, row.endDate, (d) => {
      out.set(toIsoDate(d), {
        status: "offsite",
        label: row.eventName || SPECIAL_LABELS.offsite,
        sourceType: "conference",
        sourceId: row.id,
      });
    });
  }
  return out;
}

export function buildOfficeTripBanners(tracker: TrackerData): Map<string, OfficeTripBanner> {
  const out = new Map<string, OfficeTripBanner>();
  for (const row of tracker.office_trips) {
    if (!isTrackerActive(row.status) && row.activity !== "Booked") continue;
    eachDateInclusive(row.startDate, row.endDate, (d) => {
      out.set(toIsoDate(d), {
        label: row.tripName || "Office Trip",
        sourceId: row.id,
      });
    });
  }
  return out;
}

export function applyTrackerOverrides(manifest: TaskManifest): { manifest: TaskManifest; changed: boolean } {
  const tracker = getTracker(manifest);
  const overrides = buildTrackerOverrides(tracker);
  const officeTripBanners = buildOfficeTripBanners(tracker);
  let updated = manifest;
  let changed = false;

  // Remove stale tracker-controlled states if the event no longer exists.
  for (const year of Object.keys(manifest)) {
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) continue;
    const yearEntry = getYearEntry(manifest, year);
    for (const [month, monthEntry] of Object.entries(yearEntry)) {
      const monthIdx = MONTH_INDEX[month];
      if (monthIdx === undefined) continue;
      for (const wk of Object.keys(monthEntry.daily_logs)) {
        const monday = parseWeekStartFromKey(yearNum, monthIdx, wk);
        if (!monday) continue;
        for (const day of DAY_NAMES) {
          const cell = monthEntryFor(updated, monday).daily_logs[wk]?.[day];
          const d = dayDate(monday, day);
          const key = toIsoDate(d);
          const next = overrides.get(key);
          const nextTrip = officeTripBanners.get(key);
          let nextCell = cell;

          if (nextCell?.trackerSourceType) {
            const keepTrackerState =
              next &&
              next.sourceType === nextCell.trackerSourceType &&
              next.sourceId === nextCell.trackerSourceId;
            if (!keepTrackerState) {
              nextCell = {
                ...nextCell,
                status: "work",
                label: undefined,
                trackerSourceType: undefined,
                trackerSourceId: undefined,
              };
            }
          }

          // Backward compatibility: old office trips previously used hard override status.
          if (nextCell?.trackerSourceType === "trip" && !nextTrip) {
            nextCell = {
              ...nextCell,
              status: "work",
              label: undefined,
              trackerSourceType: undefined,
              trackerSourceId: undefined,
            };
          }

          if (nextCell?.officeTripEventId) {
            const keepBanner = nextTrip && nextTrip.sourceId === nextCell.officeTripEventId;
            if (!keepBanner) {
              nextCell = {
                ...nextCell,
                officeTripBanner: undefined,
                officeTripEventId: undefined,
              };
            }
          }

          if (nextCell !== cell && nextCell) {
            updated = setEntry(updated, monday, day, nextCell);
            changed = true;
          }
        }
      }
    }
  }

  // Apply active overrides from tracker.
  for (const [dateIso, event] of overrides.entries()) {
    const parsed = parseIsoDateLocal(dateIso);
    if (!parsed) continue;
    const d = startOfDay(parsed);
    const day = dayNameFromDate(d);
    if (!day) continue; // planner grid is weekdays only
    const monday = mondayForDate(d);
    const cell = getEntry(updated, monday, day);
    if (
      cell.status === event.status &&
      cell.label === event.label &&
      cell.trackerSourceType === event.sourceType &&
      cell.trackerSourceId === event.sourceId
    ) {
      continue;
    }
    updated = setEntry(updated, monday, day, {
      ...cell,
      status: event.status,
      label: event.label,
      trackerSourceType: event.sourceType,
      trackerSourceId: event.sourceId,
    });
    changed = true;
  }

  // Apply office trip banners without overriding day status/content blocks.
  for (const [dateIso, banner] of officeTripBanners.entries()) {
    const parsed = parseIsoDateLocal(dateIso);
    if (!parsed) continue;
    const d = startOfDay(parsed);
    const day = dayNameFromDate(d);
    if (!day) continue;
    const monday = mondayForDate(d);
    const cell = getEntry(updated, monday, day);
    if (cell.officeTripBanner === banner.label && cell.officeTripEventId === banner.sourceId) {
      continue;
    }
    updated = setEntry(updated, monday, day, {
      ...cell,
      officeTripBanner: banner.label,
      officeTripEventId: banner.sourceId,
    });
    changed = true;
  }

  return { manifest: updated, changed };
}
